// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { backend, card, widget } from '../test/fixtures';
import { startMockServer, type MockServer } from '../test/mockServer';
import { useBackendsStore } from '../stores/backendsStore';
import { useWidgetRegistryStore } from '../stores/widgetRegistryStore';
import { useSettingsStore } from '../stores/settingsStore';
import { DEFAULT_SETTINGS } from '../lib/settingsFile';
import { armedRequestOf, useWidgetData } from './useWidgetData';
import { cardRequestSync } from './useCardRequest';
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: globalThis.fetch }));
let server: MockServer;
afterEach(async () => { await server?.close(); });
it('keeps the last Run across a visible/off-tab/remount handoff and scopes duplicate card ids by dashboard', async () => {
 server = await startMockServer({ '/quote': (url: URL) => [{ symbol: url.searchParams.get('symbol') }] });
 const b = backend({ baseUrl: server.url });
 const w = widget({ endpoint: '/quote', type: 'table', runButton: true, dataKey: undefined });
 const c = card({ params: { symbol: 'AAPL' } });
 const d = { id: crypto.randomUUID(), name: 'Run owner', groups: undefined, tabs: [{ id: 'tab', name: 'Tab', cards: [c] }] };
 useBackendsStore.setState({ backends: [b] });
 useWidgetRegistryStore.setState({ widgets: [w] });
 useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, autoRefreshMinutes: undefined } });
 const mounted = renderHook(({ value }) => useWidgetData({ ...c, params: value }, value, true, undefined, undefined, undefined, d), { initialProps: { value: c.params } });
 await waitFor(() => expect(mounted.result.current.status).toBe('ready'));
 mounted.rerender({ value: { symbol: 'MSFT' } });
 expect(mounted.result.current.stale).toBe(true);
 mounted.unmount();
 const draft = { ...c, params: { symbol: 'MSFT' } };
 const armed = armedRequestOf(draft, w, b, d.id);
 expect(armed?.params).toEqual({ symbol: 'AAPL' });
 expect(cardRequestSync(draft, w, b, d, armed).query).toEqual({ symbol: 'AAPL' });
 const offTab = renderHook(() => useWidgetData(draft, draft.params, true, undefined, undefined, undefined, d));
 await waitFor(() => expect(offTab.result.current.status).toBe('ready'));
 expect(offTab.result.current.data).toEqual([{ symbol: 'AAPL' }]);
 offTab.unmount();
 const remounted = renderHook(() => useWidgetData(draft, draft.params, true, undefined, undefined, undefined, d));
 await waitFor(() => expect(remounted.result.current.status).toBe('ready'));
 expect(remounted.result.current.data).toEqual([{ symbol: 'AAPL' }]);
 const other = { ...d, id: crypto.randomUUID() };
 const duplicate = renderHook(() => useWidgetData(draft, draft.params, true, undefined, undefined, undefined, other));
 await waitFor(() => expect(duplicate.result.current.status).toBe('ready'));
 expect(duplicate.result.current.data).toEqual([{ symbol: 'MSFT' }]);
 act(() => remounted.result.current.run());
 await waitFor(() => expect(remounted.result.current.data).toEqual([{ symbol: 'MSFT' }]));
 expect(server.requests.map(r => new URLSearchParams(r.search).get('symbol'))).toEqual(['AAPL','AAPL','AAPL','MSFT','MSFT']);
 remounted.unmount();duplicate.unmount();
});

it('releases a held fiscal Run under the landed map after a runner handoff', async () => {
 server = await startMockServer({ '/quote': [{ close: 1 }] });
 const b = backend({ baseUrl: server.url });
 const w = widget({ endpoint: '/quote', type: 'table', runButton: true, params: [{ paramName: 'symbol', type: 'text' }, { paramName: 'quarter', type: 'quarter' }] });
 const c = card({ id: crypto.randomUUID(), params: { symbol: 'AAPL', quarter: 'T' } });
 const d = { id: crypto.randomUUID(), name: 'Fiscal owner', groups: undefined, tabs: [{ id: 'tab', name: 'Tab', cards: [c] }] };
 useBackendsStore.setState({ backends: [b] });useWidgetRegistryStore.setState({ widgets: [w] });
 useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
 vi.useFakeTimers({ shouldAdvanceTime: true });vi.setSystemTime(new Date(2026,7,26,12));
 try {
  const first = renderHook(() => useWidgetData(c, c.params, true, {quarter:12}, {calendars:{},pending:true,key:'fiscal-pending',intent:'original-intent'}, undefined, d));
  await waitFor(() => expect(first.result.current.status).toBe('loading'));
  expect(server.requests).toHaveLength(0);
  expect(() => cardRequestSync(c,w,b,d,armedRequestOf(c,w,b,d.id))).toThrow(/Waiting for the source card/);
  first.unmount();
  const next = renderHook(() => useWidgetData(c, c.params, true, {quarter:9}, {calendars:{},pending:false,key:'',intent:'original-intent'}, undefined, d));
  await waitFor(() => expect(next.result.current.status).toBe('ready'));
  expect(server.requests.map(r => new URLSearchParams(r.search).get('quarter'))).toEqual(['2026-Q4']);
  expect(next.result.current.stale).toBe(false);
  next.unmount();
 } finally {vi.useRealTimers();}
});
