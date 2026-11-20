// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import { expect, it, onTestFinished, vi } from 'vitest';
import { fetch as httpFetch } from '@tauri-apps/plugin-http';
import { DashboardGrid } from './DashboardGrid';
import { TableExecutionRuntime } from './TableExecutionRuntime';
import { useBackendsStore } from '../stores/backendsStore';
import { useWidgetRegistryStore } from '../stores/widgetRegistryStore';
import { useDashboardStore } from '../stores/dashboardStore';
import { tableExecutionStore } from '../stores/tableExecutionStore';
import { backend, card, widget } from '../test/fixtures';
import { startMockServer } from '../test/mockServer';
import { Boundary } from '../test/tableWorkerBoundary';
import { liveMetricReceipt, liveMetricRows } from '../test/fixtures/metricEvidence';
import { buildKpiSnapshot } from '../lib/widgetData/kpi/build';
import * as kpiWorkers from '../lib/widgetData/kpi/workerClient';
import type { Dashboard } from '../lib/types';

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
vi.mock('react-grid-layout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, WidthProvider: (c: unknown) => c }));

async function mountKpi(mode: string, { runButton = false, secondOrigin = false, headerName = '' } = {}) {
  const path = '/api/v1/eodhd/equity/fundamental/metrics';
  const serve = (replacement = false) => startMockServer({ [path]: (url: URL) => {
    const issuer = url.searchParams.get('symbol') + '.US';
    return { results: [{ ...liveMetricRows[0], symbol: issuer, pe_ratio: !replacement && issuer === 'AAPL.US' ? 19.875 : 33.25 }],
      extra: { results_metadata: { chart_sources: { version: 1, receipts: [{ ...liveMetricReceipt, issuer, listing: issuer }] } } } };
  } });
  const server = await serve();
  const alternate = mode === 'connection' || secondOrigin ? await serve(true) : undefined;
  const replacementSymbol = alternate ? 'AAPL' : 'TSLA';
  const waiting: Array<{ symbol: string; finish: (fail?: boolean) => void }> = [];
  vi.mocked(httpFetch).mockImplementation(async (input, init) => {
    const response = await globalThis.fetch(input, init);
    await new Promise<void>((resolve, reject) => waiting.push({
      symbol: new URL(response.url).searchParams.get('symbol')!,
      finish: fail => fail ? reject(new Error('held request failed')) : resolve(),
    }));
    return response;
  });
  const factory = vi.spyOn(kpiWorkers, 'createKpiWorker').mockImplementation(() => ({
    run: async (data, options) => buildKpiSnapshot(data, options), dispose() {},
  }));
  vi.stubGlobal('Worker', Boundary);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const connect = (url: string, header = headerName) => useBackendsStore.setState({
    backends: [backend({ baseUrl: url, authLocation: 'header', headerName: header, headerValue: header ? 'demo' : '' })],
    statuses: { b1: 'online' },
  });
  connect(server.url);
  useWidgetRegistryStore.getState().seedBuiltins();
  useWidgetRegistryStore.setState(s => ({ widgets: [...s.widgets.filter(w => w.id !== 'metrics-source'), widget({ id: 'metrics-source', type: 'table', runButton,
    endpoint: path, dataKey: 'results', params: [{ paramName: 'symbol', type: 'text', label: 'Symbol' }, { paramName: 'chart_source', type: 'text', label: 'Source' },
      { paramName: 'order', label: 'Order', type: 'form', form: { endpoint: '/order', inputs: [{ paramName: 'note', label: 'Note', type: 'text' }] } }] })] }));
  const board = (symbol: string): Dashboard => {
    const root = card({ id: 'source', widgetId: 'metrics-source', params: { symbol: mode === 'group' ? 'unchanged' : symbol, chart_source: 'true' },
      bindings: mode === 'group' ? [{ groupId: 'ticker', paramName: 'symbol' }] : undefined });
    const metric = card({ id: 'kpi', backendId: 'builtin', widgetId: 'linked_metric', linkedSource: { kind: 'widget', sourceWidgetId: root.id },
      linkedMetric: { version: 1, metric: 'pe_ratio', valueField: 'pe_ratio', view: 'card', observation: { mode: 'latest' } } });
    return { id: 'backend-kpi', name: 'Metrics', groups: mode === 'group' ? [{ id: 'ticker', name: 'Ticker', paramName: 'symbol', groupType: 'symbol', value: symbol }] : [],
      tabs: mode !== 'off-tab' ? [{ id: 'a', name: 'A', cards: [root, metric] }]
      : [{ id: 'a', name: 'A', cards: [metric] }, { id: 'b', name: 'B', cards: [root] }] };
  };
  const b = board(replacementSymbol);
  const install = (dash: Dashboard) => useDashboardStore.setState({ dashboards: [dash], activeId: dash.id, activeTabId: 'a' });
  const next = async (symbol: string) => {
    await waitFor(() => expect(waiting[0]?.symbol).toBe(symbol));
    return waiting.shift()!.finish;
  };
  install(board('AAPL'));
  const originalSync = tableExecutionStore.syncDashboard;
  const sync = vi.spyOn(tableExecutionStore, 'syncDashboard');
  const view = render(<><TableExecutionRuntime /><DashboardGrid onOpenLibrary={() => {}} /></>);
  const refresh = () => {
    if (mode === 'off-tab') act(() => useDashboardStore.setState(s => ({ refreshEpoch: s.refreshEpoch + 1 })));
    else fireEvent.click(within(view.container.querySelector<HTMLElement>('[data-card-id="source"]')!).getByRole('button', { name: 'Refresh' }));
  };
  const value = () => view.container.querySelector('.metric-value')?.textContent;
  const matches = () => tableExecutionStore.sourceMatches(b.id, 'kpi', b.tabs.flatMap(t => t.cards));
  onTestFinished(async () => {
    view.unmount(); sync.mockRestore(); factory.mockRestore(); vi.unstubAllGlobals();
    tableExecutionStore.disposeDashboard(b.id); await server.close(); await alternate?.close();
  });
  return { next, value, refresh, board, b, view, server, alternate, sync, connect, install, matches, originalSync, waiting, replacementSymbol };
}

it.each(['mounted', 'off-tab', 'group', 'connection'])('matches only its current backend response through the %s KPI source', async mode => {
  const { next, value, refresh, board, b, view, alternate, sync, install, matches, originalSync, waiting, replacementSymbol } = await mountKpi(mode);
  const first = await next('AAPL');
  act(() => first());
  await waitFor(() => expect(value()).toBe('19.875×'));
  const editedForm = board('AAPL');
  const editedRoot = editedForm.tabs.flatMap(t => t.cards).find(c => c.id === 'source')!;
  editedRoot.params['order.note'] = 'Unsubmitted draft';
  act(() => install(editedForm));
  await waitFor(() => expect(tableExecutionStore.sourceMatches(b.id, 'kpi', editedForm.tabs.flatMap(t => t.cards))).toBe(true));
  await waitFor(() => expect(value()).toBe('19.875×'));
  expect(waiting).toHaveLength(0);
  refresh();
  const lateSuccess = await next('AAPL');
  refresh();
  const lateFailure = await next('AAPL');
  sync.mockImplementation(() => {});
  act(() => {
    install(b);
    if (alternate) useBackendsStore.setState({ backends: [backend({ baseUrl: alternate.url })] });
  });
  expect(value()).toBeUndefined();
  expect(matches()).toBe(false);
  sync.mockImplementation(originalSync);
  act(() => originalSync(b));
  const failed = await next(replacementSymbol);
  // Drain already-resolved worker jobs while keeping the replacement HTTP response held.
  await act(async () => { await new Promise(r => setTimeout(r, 20)); });
  expect(matches()).toBe(false);
  expect(value()).toBeUndefined();
  await act(async () => { lateSuccess(); lateFailure(true); });
  expect(matches()).toBe(false);
  expect(value()).toBeUndefined();
  act(() => failed(true));
  await waitFor(() => expect(tableExecutionStore.readView(b.id, 'kpi').error).toContain('held request failed'));
  expect(value()).toBeUndefined();
  refresh();
  const recover = await next(replacementSymbol);
  act(() => recover());
  await waitFor(() => expect(value()).toBe('33.25×'));
  expect(matches()).toBe(true);
  refresh();
  const same = await next(replacementSymbol);
  await waitFor(() => expect(view.queryByText('Showing completed data (stale).')).toBeVisible());
  expect(value()).toBe('33.25×');
  act(() => same(true));
  await waitFor(() => expect(tableExecutionStore.readView(b.id, 'kpi').error).toContain('held request failed'));
  expect(view.getByText('Showing completed data (stale).')).toBeVisible();
  expect(value()).toBe('33.25×');
});

it.each([
  { mode: 'mounted', selectorOnly: false }, { mode: 'off-tab', selectorOnly: false },
  { mode: 'mounted', selectorOnly: true },
])('retires the prior producer before a $mode replacement can issue a GET (selector-only=$selectorOnly)', async ({ mode, selectorOnly }) => {
  const { next, value, view, server, alternate, connect } = await mountKpi(mode, { secondOrigin: true });
  const completeA = await next('AAPL');
  act(() => completeA());
  await waitFor(() => expect(value()).toBe('19.875×'));
  const scope = (required: boolean) => useWidgetRegistryStore.setState(s => ({
    widgets: s.widgets.map(w => w.id !== 'metrics-source' ? w : { ...w, dataKey: selectorOnly && required ? 'replacement' : 'results',
      params: [...w.params.filter(p => p.paramName !== 'scope'), ...(required ? [{ paramName: 'scope', label: 'Scope', type: 'text' as const, optional: false }] : [])] }),
  }));
  act(() => { if (!selectorOnly) connect(alternate!.url); scope(true); });
  await waitFor(() => expect(tableExecutionStore.readView('backend-kpi', 'kpi').error).toContain('Enter Scope'));
  expect(value()).toBeUndefined();
  expect(view.queryByText('Showing completed data (stale).')).toBeNull();
  expect(alternate!.requests).toHaveLength(0);
  expect(server.requests).toHaveLength(1);
  act(() => scope(false));
  const recover = await next('AAPL');
  expect(value()).toBeUndefined();
  act(() => recover());
  await waitFor(() => expect(value()).toBe(selectorOnly ? '19.875×' : '33.25×'));
  expect(alternate!.requests.length + server.requests.length).toBe(2);
});

it('recovers an armed source after reverting a draft and fences a late response after explicit Run', async () => {
  const { next, value, board, install, server, view } = await mountKpi('mounted', { runButton: true });
  const run = () => fireEvent.click(within(view.container.querySelector<HTMLElement>('[data-card-id="source"]')!).getByRole('button', { name: 'Run' }));
  const completeA = await next('AAPL');
  act(() => completeA());
  await waitFor(() => expect(value()).toBe('19.875×'));
  act(() => install(board('TSLA')));
  expect(value()).toBeUndefined();
  act(() => install(board('AAPL')));
  await waitFor(() => expect(value()).toBe('19.875×'));
  expect(server.requests).toHaveLength(1);
  run();
  const lateA = await next('AAPL');
  act(() => install(board('TSLA')));
  run();
  const completeB = await next('TSLA');
  act(() => lateA());
  expect(value()).toBeUndefined();
  act(() => completeB());
  await waitFor(() => expect(value()).toBe('33.25×'));
  expect(server.requests).toHaveLength(3);
});

it('retains the completed KPI across a case-only HTTP header refresh failure', async () => {
  const { next, value, server, view, connect } = await mountKpi('mounted', { headerName: 'X-Demo' });
  const completeA = await next('AAPL');
  act(() => completeA());
  await waitFor(() => expect(value()).toBe('19.875×'));
  act(() => connect(server.url, 'x-demo'));
  const fail = await next('AAPL');
  act(() => fail(true));
  await waitFor(() => expect(tableExecutionStore.readView('backend-kpi', 'kpi').error).toContain('held request failed'));
  expect(value()).toBe('19.875×');
  expect(view.getByText('Showing completed data (stale).')).toBeVisible();
});

it('recovers the un-run off-tab source without another GET', async () => {
  const { next, value, board, install, server, refresh } = await mountKpi('off-tab', { runButton: true });
  const complete = await next('AAPL');
  act(() => complete());
  await waitFor(() => expect(value()).toBe('19.875×'));
  act(() => install(board('TSLA')));
  expect(value()).toBeUndefined();
  act(() => install(board('AAPL')));
  await waitFor(() => expect(value()).toBe('19.875×'));
  expect(server.requests).toHaveLength(1);
  act(() => install(board('TSLA')));
  refresh();
  const refreshA = await next('AAPL');
  await act(async () => refreshA());
  expect(value()).toBeUndefined();
  act(() => install(board('AAPL')));
  await waitFor(() => expect(value()).toBe('19.875×'));
  expect(server.requests).toHaveLength(2);
});
