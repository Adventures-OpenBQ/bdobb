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

async function mountKpi(mode: string, { runButton = false, secondOrigin = false, headerName = '', dated = false } = {}) {
  const path = '/api/v1/eodhd/equity/fundamental/metrics';
  const calendarPath = '/api/v1/calendar/trading';
  const serve = (replacement = false) => startMockServer({ [calendarPath]: { data: {
    Name: 'Test exchange', Timezone: 'America/New_York',
    TradingHours: { Open: '09:30:00', Close: '16:00:00', WorkingDays: 'Mon, Tue, Wed, Thu, Fri' }, ExchangeHolidays: {},
  } }, [path]: (url: URL) => {
    const issuer = url.searchParams.get('symbol') + '.US';
    return { results: [{ ...liveMetricRows[0], symbol: issuer, ...(dated ? { date: url.searchParams.get('date') } : {}), pe_ratio: !replacement && issuer === 'AAPL.US' ? 19.875 : 33.25 }],
      extra: { results_metadata: { chart_sources: { version: 1, receipts: [{ ...liveMetricReceipt, issuer, listing: issuer }] } } } };
  } });
  const server = await serve();
  const alternate = mode === 'connection' || secondOrigin ? await serve(true) : undefined;
  const replacementSymbol = alternate ? 'AAPL' : 'TSLA';
  const waiting: Array<{ symbol: string; finish: (fail?: boolean) => void }> = [];
  let releaseCalendar!: () => void;
  const calendarGate = new Promise<void>(resolve => { releaseCalendar = resolve; });
  vi.mocked(httpFetch).mockImplementation(async (input, init) => {
    const response = await globalThis.fetch(input, init);
    const url = new URL(response.url);
    if (url.pathname === calendarPath) {
      if (url.searchParams.get('year') === '2027') await calendarGate;
      return response;
    }
    await new Promise<void>((resolve, reject) => waiting.push({
      symbol: url.searchParams.get('symbol')!,
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
    endpoint: path, dataKey: 'results', params: [
      ...(dated ? [{ paramName: 'date', type: 'date' as const, exchange: 'XNYS' }] : []),
      { paramName: 'symbol', type: 'text', label: 'Symbol' }, { paramName: 'chart_source', type: 'text', label: 'Source' },
      { paramName: 'order', label: 'Order', type: 'form', form: { endpoint: '/order', inputs: [{ paramName: 'note', label: 'Note', type: 'text' }] } }] })] }));
  const board = (symbol: string): Dashboard => {
    const root = card({ id: 'source', widgetId: 'metrics-source', params: { symbol: mode === 'group' ? 'unchanged' : symbol, chart_source: 'true', ...(dated ? { date: 'T-1bd' } : {}) },
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
    view.unmount(); releaseCalendar(); sync.mockRestore(); factory.mockRestore(); vi.unstubAllGlobals();
    tableExecutionStore.disposeDashboard(b.id); await server.close(); await alternate?.close();
  });
  return { next, value, refresh, board, b, view, server, alternate, sync, connect, install, matches, originalSync, waiting, replacementSymbol, releaseCalendar };
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

it.each(['header', 'URL scheme'])('retains the completed KPI across a case-only %s refresh failure', async change => {
  const { next, value, server, view, connect } = await mountKpi('mounted', { headerName: 'X-Demo' });
  const completeA = await next('AAPL');
  act(() => completeA());
  await waitFor(() => expect(value()).toBe('19.875×'));
  act(() => change === 'header' ? connect(server.url, 'x-demo') : connect(server.url.replace('http:', 'HTTP:')));
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

it.each([false, true])('admits only the committed source across a held exchange calendar year (explicit Run=%s)', async explicitRun => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-12-30T17:00:00Z'));
  onTestFinished(() => { vi.useRealTimers(); });
  const { next, board, install, server, view, releaseCalendar } = await mountKpi('mounted', { runButton: true, dated: true });
  const root = () => tableExecutionStore.readView('backend-kpi', 'source');
  const matches = (symbol: string) => tableExecutionStore.sourceMatches('backend-kpi', 'kpi', board(symbol).tabs.flatMap(tab => tab.cards));
  const rows = async () => (await tableExecutionStore.readExecutor('backend-kpi', 'source')!
    .chartData(root().active!, ['symbol', 'date', 'pe_ratio'], new AbortController().signal)).rows.map(row => row.values);
  const metricsRequests = () => server.requests.filter(r => r.path.endsWith('/metrics'));
  const finishA = await next('AAPL');
  act(() => finishA());
  await waitFor(() => expect(matches('AAPL')).toBe(true));
  expect(await rows()).toEqual([{ symbol: 'AAPL.US', date: '2026-12-29', pe_ratio: 19.875 }]);
  vi.setSystemTime(new Date('2027-01-06T17:00:00Z'));
  act(() => install(board('TSLA')));
  await waitFor(() => expect(server.requests.some(r => r.path === '/api/v1/calendar/trading'
    && new URLSearchParams(r.search).get('year') === '2027' && new URLSearchParams(r.search).get('exchange') === 'XNYS')).toBe(true));
  if (explicitRun) fireEvent.click(within(view.container.querySelector<HTMLElement>('[data-card-id="source"]')!).getByRole('button', { name: 'Run' }));
  act(() => install(board('AAPL')));
  // Allow any already-resolved acquisition to activate while the calendar remains held.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
  expect(metricsRequests()).toHaveLength(1);
  if (!explicitRun) {
    expect(matches('AAPL')).toBe(true);
    expect(await rows()).toEqual([{ symbol: 'AAPL.US', date: '2026-12-29', pe_ratio: 19.875 }]);
    await act(async () => releaseCalendar());
    expect(metricsRequests()).toHaveLength(1);
    return;
  }
  expect({ ready: root().status === 'ready', matches: matches('AAPL') }).toEqual({ ready: false, matches: false });
  act(() => install(board('TSLA')));
  act(() => releaseCalendar());
  const finishB = await next('TSLA');
  act(() => finishB());
  await waitFor(() => expect(matches('TSLA')).toBe(true));
  expect(await rows()).toEqual([{ symbol: 'TSLA.US', date: '2027-01-05', pe_ratio: 33.25 }]);
  expect(metricsRequests()).toHaveLength(2);
});

it('retires the old result and reports an invalid replacement URL through the source error', async () => {
  const { next, value, server, view, connect } = await mountKpi('mounted');
  const finish = await next('AAPL');
  act(() => finish());
  await waitFor(() => expect(value()).toBe('19.875×'));
  act(() => connect('invalid address'));
  await waitFor(() => expect(tableExecutionStore.readView('backend-kpi', 'kpi').error).toMatch(/invalid URL/i));
  expect(value()).toBeUndefined();
  expect(view.queryByText('Showing completed data (stale).')).toBeNull();
  expect(server.requests).toHaveLength(1);
});

it('keeps the committed GET through both tab handoffs until Run', async () => {
  const { next, value, board, server, view } = await mountKpi('off-tab', { runButton: true });
  const tab = (activeTabId: string) => act(() => useDashboardStore.setState({ activeTabId }));
  const edit = (symbol: string) => act(() => useDashboardStore.setState({ dashboards: [board(symbol)] }));
  const sent = () => server.requests.map(r => new URLSearchParams(r.search).get('symbol'));
  const matches = (symbol: string) => tableExecutionStore.sourceMatches('backend-kpi', 'kpi', board(symbol).tabs.flatMap(t => t.cards));
  const finish = await next('AAPL');
  act(() => finish());
  await waitFor(() => expect(value()).toBe('19.875×'));

  tab('b');
  const lateSuccess = await next('AAPL');
  edit('TSLA');
  expect(sent()).toEqual(['AAPL', 'AAPL']);
  tab('a');
  const lateError = await next('AAPL');
  await act(async () => lateSuccess());
  expect(matches('TSLA')).toBe(false);
  expect(value()).toBeUndefined();

  tab('b');
  const refresh = await next('AAPL');
  await act(async () => lateError(true));
  expect(matches('TSLA')).toBe(false);
  await act(async () => refresh());
  edit('AAPL');
  await waitFor(() => expect(matches('AAPL')).toBe(true));
  expect(sent()).toEqual(Array(4).fill('AAPL'));

  edit('TSLA');
  fireEvent.click(within(view.container.querySelector<HTMLElement>('[data-card-id="source"]')!).getByRole('button', { name: 'Run' }));
  const formerOwner = await next('TSLA');
  tab('a');
  const current = await next('TSLA');
  await act(async () => formerOwner());
  expect(matches('TSLA')).toBe(false);
  await act(async () => current());
  await waitFor(() => expect(value()).toBe('33.25×'));
  expect(matches('TSLA')).toBe(true);
  expect(sent()).toEqual([...Array(4).fill('AAPL'), 'TSLA', 'TSLA']);
});

it('keeps the last wire date when a successor releases a calendar hold', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-12-30T17:00:00Z'));
  onTestFinished(() => { vi.useRealTimers(); });
  const { next, board, server, view, releaseCalendar } = await mountKpi('off-tab', { runButton: true, dated: true });
  const sent = () => server.requests.filter(r => r.path.endsWith('/metrics')).map(r => {
    const query = new URLSearchParams(r.search);
    return [query.get('symbol'), query.get('date')];
  });
  const first = await next('AAPL');
  await act(async () => first());
  expect(sent()).toEqual([['AAPL', '2026-12-29']]);
  vi.setSystemTime(new Date('2027-01-06T17:00:00Z'));
  act(() => useDashboardStore.setState({ dashboards: [board('TSLA')], activeTabId: 'b' }));
  await waitFor(() => expect(server.requests.some(r => r.path.endsWith('/trading') && r.search.includes('2027'))).toBe(true));
  await act(async () => releaseCalendar());
  const run = within(view.container.querySelector<HTMLElement>('[data-card-id="source"]')!).getByRole('button', { name: 'Run' });
  await waitFor(() => expect(view.getByText(/Parameters changed.*press Run/)).toBeVisible());
  expect(sent()).toEqual([['AAPL', '2026-12-29']]);
  fireEvent.click(run);
  const second = await next('TSLA');
  await act(async () => second());
  expect(sent()).toEqual([['AAPL', '2026-12-29'], ['TSLA', '2027-01-05']]);
});
