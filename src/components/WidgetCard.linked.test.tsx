// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

vi.mock('../lib/plotly', () => ({ renderPlot: vi.fn(async () => {}), purgePlot: () => {}, resizePlot: () => {}, REGISTERED_TRACE_TYPES: new Set(['bar', 'scatter', 'indicator', 'waterfall', 'sankey']) }));
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../hooks/useWidgetData', async () => {
  const { useState } = await import('react');
  return { useWidgetData: () => {
    const [attempt, setAttempt] = useState(0);
    return { status: 'ready', data: null, loading: false, error: null, attempt, retry: () => setAttempt(a => a + 1), query: {} };
  } };
});
vi.mock('@tanstack/react-virtual', () => ({ useVirtualizer: ({ count }: { count: number }) => ({ getVirtualItems: () => Array.from({ length: Math.min(count, 8) }, (_, index) => ({ index, start: index * 28, end: (index + 1) * 28 })), getTotalSize: () => count * 28, measureElement: () => {}, scrollToIndex: () => {} }) }));
import { WidgetCard } from './WidgetCard';
import { useDashboardStore } from '../stores/dashboardStore';
import { useWidgetRegistryStore } from '../stores/widgetRegistryStore';
import { __reset } from '../test/memfs';
import { __resetJsonStoreForTests } from '../lib/jsonStore';
import { card, widget } from '../test/fixtures';
import { tableExecutionStore } from '../stores/tableExecutionStore';
import { TableExecutionRuntime } from './TableExecutionRuntime';
import { createWorkerHandler } from '../lib/tableExecution/table.worker';
import type { ExecutionRequest } from '../lib/tableExecution/types';
import { saveLocalFile } from '../lib/localFiles';
import { KEY_SEP, LABEL_FIELD } from '../lib/pivotTable';
import { pivotValueKey } from '../lib/pivotKeys';
import type { Dashboard, DashboardCard } from '../lib/types';
import { exportCompatibleApp, importApps } from '../lib/appsJson';
import type { RecipeOptions } from '../lib/widgetData/chartRecipes/types';
import { priceFields, dailyPriceRows } from '../lib/widgetData/chartRecipes/fixtures';
import * as recipeWorkers from '../lib/widgetData/chartRecipes/workerClient';
import { runRecipe } from '../lib/widgetData/chartRecipes/run';
import { backendFinancialResponse, readFinancialEvidence } from '../lib/widgetData/chartRecipes/financialEvidence';
import { renderPlot } from '../lib/plotly';
import { fixture as incomeFixture } from '../lib/statementModel/compileFixtures';
import { intent as statementIntent } from '../lib/statementModel/testFixtures';
import { incomeStatementIds } from '../lib/statementModel/incomeChartProof';
import { dividendEvidence, dividendRow, emptyDividendEvidence, incomeEvidence, incomeRow, screenerEvidence } from '../test/fixtures/financialEvidence';
import * as fs from '@tauri-apps/plugin-fs';
class Boundary {
  static failChild = false;
  onmessage: ((e: MessageEvent) => void) | null = null;
  handler = createWorkerHandler(data => this.onmessage?.({ data } as MessageEvent));
  postMessage(data: ExecutionRequest) {
    if (Boundary.failChild && data.kind === 'applyModel' && data.revision.widgetId === 'child') {
      Boundary.failChild = false;
      throw new Error('Worker delivery failed; retry the table');
    }
    void this.handler(data);
  }
  terminate() {}
}
afterEach(() => { cleanup(); tableExecutionStore.disposeDashboard('d'); Boundary.failChild = false; vi.unstubAllGlobals(); });
const source = card({ id: 's', widgetId: 'local_table', backendId: 'builtin', title: 'Prices', params: { file: 'missing.csv' } });
beforeEach(() => { __reset(); __resetJsonStoreForTests(); useWidgetRegistryStore.getState().seedBuiltins(); useDashboardStore.setState({ dashboards: [{ id: 'd', name: 'D', tabs: [{ id: 't', name: 'First', cards: [source] }] }], activeId: 'd', activeTabId: 't', viewer: false, pendingCardRemoval: null }); });
it.each(['chart', 'table'] as const)('source menu creates a linked %s with the automatic source', async presentation => {
  render(<WidgetCard card={source} onRemove={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Card menu' }));
  fireEvent.click(screen.getByRole('menuitem', { name: `Create linked ${presentation}` }));
  await waitFor(() => expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1]?.linkedSource?.sourceWidgetId).toBe('s'));
});
it('foreign sources show exact repair state, never cached content, and retain dependent settings', async () => {
  const linked = card({ id: 'child', widgetId: 'linked_table', backendId: 'builtin', linkedSource: { kind: 'widget', sourceWidgetId: 'foreign' }, tableSelection: { kind: 'explicit', ids: ['r0'] } });
  act(() => useDashboardStore.setState(s => ({ dashboards: s.dashboards.map(d => ({ ...d, tabs: [{ ...d.tabs[0], cards: [source, linked] }] })) })));
  render(<><TableExecutionRuntime /><WidgetCard card={linked} onRemove={() => {}} /></>);
  expect(await screen.findByText('Source unavailable')).toBeTruthy();
  expect(tableExecutionStore.readExecutor('d', 'child')).toBeUndefined();
  fireEvent.click(screen.getByRole('button', { name: 'Choose source' }));
  fireEvent.change(screen.getByLabelText('Source table'), { target: { value: 's' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Choose source' }).at(-1)!);
  await waitFor(() => expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1].linkedSource?.sourceWidgetId).toBe('s'));
  expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1].tableSelection).toEqual(linked.tableSelection);
});
it('transposed sources retain ordinary card actions without offering analytical links', async () => {
  render(<WidgetCard card={{ ...source, view: 'transposed' }} onRemove={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Card menu' }));
  expect(screen.queryByRole('menuitem', { name: 'Create linked chart' })).toBeNull();
  expect(screen.queryByRole('menuitem', { name: 'Create linked table' })).toBeNull();
  await screen.findByText('File missing: Prices');
});
it('external backend widgets sharing a linked built-in ID retain ordinary rendering', () => {
  useWidgetRegistryStore.setState(s => ({ widgets: [...s.widgets, { id: 'linked_table', backendId: 'external', name: 'External prices', type: 'table', endpoint: '/prices', description: '', params: [], category: '', subCategory: '', source: [], gridData: { w: 10, h: 8 } }] }));
  const external = card({ id: 'external-card', widgetId: 'linked_table', backendId: 'external' });
  render(<WidgetCard card={external} onRemove={() => {}} />);
  expect(screen.getByText('No data for these parameters.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Choose source' })).toBeNull();
  expect(screen.queryByText('Source unavailable')).toBeNull();
});

it.each(['missing field', 'execution failure', 'parent missing field'] as const)('retains completed linked rows and controls after %s, then retries through card Refresh', async failure => {
  vi.stubGlobal('Worker', Boundary);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const file = await saveLocalFile(new File(['region,revenue\nA,10\nB,90\n'], 'prices.csv'));
  const root = { ...source, params: { file } };
  const child = card({ id: 'child', widgetId: 'linked_table', backendId: 'builtin', linkedSource: { kind: 'widget', sourceWidgetId: 's' } });
  useDashboardStore.setState(s => ({ dashboards: s.dashboards.map(d => ({ ...d, tabs: [{ ...d.tabs[0], cards: [root, child] }] })) }));
  const { container } = render(<><TableExecutionRuntime /><WidgetCard card={child} onRemove={() => {}} /></>);
  await waitFor(() => expect(container.querySelector('tbody')?.textContent).toContain('90'));
  const rows = container.querySelector('tbody')!.textContent;
  const initial = tableExecutionStore.readView('d', 'child').active;
  if (failure === 'execution failure') Boundary.failChild = true;
  await act(async () => {
    tableExecutionStore.updateDefinition('d', failure === 'parent missing field' ? 's' : 'child', {
      table: failure === 'execution failure' ? {} : { sorting: [{ id: 'gone', desc: false }] }, search: failure === 'execution failure' ? 'B' : '',
    }, { kind: 'none' });
    await tableExecutionStore.settled('d');
  });
  expect(tableExecutionStore.readView('d', 'child')).toMatchObject({ status: failure === 'execution failure' ? 'failed' : 'blocked', stale: true, active: initial });
  expect(container.querySelector('tbody')?.textContent).toBe(rows);
  expect(screen.getByRole('alert').textContent).toContain(failure === 'execution failure' ? 'Worker delivery failed' : 'Missing source field');
  expect(screen.getByRole('button', { name: 'Pivot' })).toBeTruthy();
  expect(screen.getByText('Showing completed data (stale).')).toBeTruthy();
  expect(screen.queryByText('Source unavailable')).toBeNull();
  await fs.writeFile(`files/${file}`, new TextEncoder().encode('region,revenue,gone\nA,15,yes\nB,95,yes\n'));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(container.querySelector('tbody')?.textContent).toContain('95'));
  expect(tableExecutionStore.readView('d', 'child').status).toBe('ready');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByText('Showing completed data (stale).')).toBeNull();
});
it.each(['deleted', 'foreign', 'cyclic'] as const)('masks completed rows for a %s source and keeps Choose source actionable', async invalid => {
  vi.stubGlobal('Worker', Boundary);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const file = await saveLocalFile(new File(['region,revenue\nA,10\nB,90\n'], 'prices.csv'));
  const root = { ...source, params: { file } };
  const child = card({ id: 'child', widgetId: 'linked_table', backendId: 'builtin', linkedSource: { kind: 'widget', sourceWidgetId: 's' }, tableSelection: { kind: 'none' } });
  useDashboardStore.setState(s => ({ dashboards: s.dashboards.map(d => ({ ...d, tabs: [{ ...d.tabs[0], cards: [root, child] }] })) }));
  const { container, rerender } = render(<><TableExecutionRuntime /><WidgetCard card={child} onRemove={() => {}} /></>);
  await waitFor(() => expect(container.querySelector('tbody')?.textContent).toContain('90'));
  if (invalid === 'deleted') {
    await act(async () => { await useDashboardStore.getState().removeCard('s'); });
  } else {
    const imported = { ...child, linkedSource: { kind: 'widget' as const, sourceWidgetId: invalid === 'cyclic' ? 'child' : 'foreign' } };
    await act(async () => {
      useDashboardStore.setState(s => ({ dashboards: s.dashboards.map(d => ({ ...d, tabs: [{ ...d.tabs[0], cards: [root, imported] }] })) }));
      tableExecutionStore.syncDashboard(useDashboardStore.getState().dashboards[0]);
    });
  }
  // Card props are normally supplied by DashboardGrid's store subscription.
  const current = useDashboardStore.getState().dashboards[0].tabs[0].cards.find(c => c.id === 'child')!;
  rerender(<><TableExecutionRuntime /><WidgetCard card={current} onRemove={() => {}} /></>);
  expect(await screen.findByText('Source unavailable')).toBeTruthy();
  expect(container.querySelector('tbody')).toBeNull();
  expect(screen.getByRole('button', { name: 'Choose source' })).toBeTruthy();
  expect(current.tableSelection).toEqual({ kind: 'none' });
});
it('keeps the chart presentation branch and completed metadata during recoverable parent blocking', async () => {
  vi.stubGlobal('Worker', Boundary);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const file = await saveLocalFile(new File(['region,revenue\nA,10\nB,90\n'], 'prices.csv'));
  const root = { ...source, params: { file } };
  const chart = card({ id: 'chart', widgetId: 'linked_chart', backendId: 'builtin', linkedSource: { kind: 'widget', sourceWidgetId: 's' }, linkedChart: { type: 'column', measures: ['revenue'], category: 'region', display: 'grouped' } });
  useDashboardStore.setState(s => ({ dashboards: s.dashboards.map(d => ({ ...d, tabs: [{ ...d.tabs[0], cards: [root, chart] }] })) }));
  render(<><TableExecutionRuntime /><WidgetCard card={chart} onRemove={() => {}} /></>);
  await screen.findByTestId('chart-plot');
  const ready = tableExecutionStore.readView('d', 'chart').ready;
  await act(async () => {
    tableExecutionStore.updateDefinition('d', 's', { table: { sorting: [{ id: 'gone', desc: false }] }, search: '' }, { kind: 'none' });
    await tableExecutionStore.settled('d');
  });
  expect(tableExecutionStore.readView('d', 'chart')).toMatchObject({ status: 'blocked', stale: true, ready });
  expect(screen.getByTestId('chart-plot')).toBeTruthy();
  expect(screen.getByText('Showing completed data (stale).')).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain('Missing source field');
  expect(screen.queryByText('Source unavailable')).toBeNull();
});

it.each(['bullet', 'waterfall'] as const)('announces a failed %s relink once and redraws on recovery', async type => {
  vi.stubGlobal('Worker', Boundary);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const { statement, ids } = incomeFixture();
  const mapping = type === 'bullet'
    ? { category: 'fiscal_period', measures: ['eps_actual'], period: 'Q2' }
    : { category: LABEL_FIELD, measures: [`${pivotValueKey('FY2025')}${KEY_SEP}${ids.value}`] };
  const root = async (id: string, value: number) => {
    const csv = type === 'bullet'
      ? `fiscal_period,period_ending,eps_actual\nQ2,2025-06-30,${value}\n`
      : `symbol,period,date,year,start,end,revenue,cost_of_revenue\nACME,FY,2025-12-31,2025,2025-01-01,2025-12-31,${value},60\n`;
    const file = await saveLocalFile(new File([csv], 'source.csv'));
    return { ...source, id, title: id, params: { file },
      ...(type === 'waterfall' ? { tableDefinition: { table: {}, search: '', analytical: statement } } : {}) };
  };
  const a = await root('A', 100);
  const b = await root('B', 150);
  const chart = card({ id: 'chart', widgetId: 'linked_chart', backendId: 'builtin',
    linkedSource: { kind: 'widget', sourceWidgetId: a.id }, linkedChart: { ...mapping, type, display: 'grouped' } });
  useDashboardStore.setState(s => ({ dashboards: s.dashboards.map(d => ({ ...d, tabs: [{ ...d.tabs[0], cards: [a, b, chart] }] })) }));
  // Follow persisted card changes as DashboardGrid does.
  function LinkedCard() {
    const current = useDashboardStore(s => s.dashboards[0].tabs[0].cards.find(c => c.id === chart.id)!);
    return <WidgetCard card={current} onRemove={() => {}} />;
  }
  let rejectRead!: (error: Error) => void;
  const heldRead = new Promise<Uint8Array<ArrayBuffer>>((_, reject) => { rejectRead = reject; });
  const readFile = fs.readFile;
  const read = vi.spyOn(fs, 'readFile').mockImplementation((path, options) =>
    path === `files/${b.params.file}` ? heldRead : readFile(path, options));
  const diagnostic = 'Source B: File read failed';
  const plot = vi.mocked(renderPlot);
  try {
    render(<><TableExecutionRuntime /><LinkedCard /></>);
    const first = await screen.findByTestId('chart-plot');
    expect(screen.getByText(/^Source A ·/)).toBeVisible();
    const revisionA = plot.mock.lastCall?.[2];

    fireEvent.click(screen.getByRole('button', { name: 'Choose source' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Choose source' }));
    fireEvent.change(dialog.getByLabelText('Source table'), { target: { value: b.id } });
    fireEvent.click(dialog.getByRole('button', { name: 'Choose source' }));
    expect(await screen.findByText('Loading source B…')).toBeVisible();
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    expect(first).not.toBeInTheDocument();

    await act(async () => {
      rejectRead(new Error('File read failed'));
      await tableExecutionStore.settled('d');
    });
    expect(tableExecutionStore.readView('d', chart.id)).toMatchObject({ status: 'blocked', error: diagnostic });
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    expect(screen.queryByText('Loading source B…')).toBeNull();
    expect(screen.getAllByRole('alert').map(alert => alert.textContent)).toEqual([diagnostic]);
    expect(screen.getByText(diagnostic)).toBeVisible();

    read.mockImplementation(readFile);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    const recovered = await screen.findByTestId('chart-plot');
    expect(screen.getByText(/^Source B ·/)).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect(plot.mock.lastCall?.[0]).toBe(recovered));
    const [, figure, revisionB] = plot.mock.lastCall!;
    expect(revisionB).not.toBe(revisionA);
    expect(figure.data[0]).toMatchObject(type === 'bullet'
      ? { type: 'indicator', value: 150 } : { type: 'waterfall', y: expect.arrayContaining([150]) });
  } finally {
    read.mockRestore();
  }
});

const riskRecipes = [
  { version: 1, kind: 'return-distribution', fields: priceFields, symbol: 'A', bins: 5 },
  { version: 1, kind: 'small-multiples', fields: priceFields, symbols: ['A'] },
  { version: 1, kind: 'etf-pareto', fields: { holding: 'symbol', weight: 'weight' } },
  { version: 1, kind: 'etf-exposure', mode: 'sector', fields: { category: 'sector', weight: 'weight' } },
] satisfies RecipeOptions[];

const incomeColumn = (year: number) => `${pivotValueKey('FY' + year)}${KEY_SEP}${incomeStatementIds.value}`;
const screeningRecipes = [
  { version: 1, kind: 'bubble-regression', priceDate: 'latest', regression: true, fields: {
    symbol: 'symbol', date: 'last_day_data_date', dividendYield: 'dividend_yield',
    priceChange: 'price_change_5d', marketCap: 'market_cap', exchange: 'exchange', currency: 'currency_symbol',
  } },
  { version: 1, kind: 'dividend-steps', instrument: 'SHEL.LSE',
    fields: { date: 'ex_dividend_date', amount: 'amount', currency: 'currency' } },
  { version: 1, kind: 'income-sankey', periodColumn: incomeColumn(2026) },
] as const satisfies readonly RecipeOptions[];

function screeningSnapshot(recipe: RecipeOptions, id: string) {
  const first = id === 'A';
  if (recipe.kind === 'bubble-regression') {
    const dates = ['2026-08-28', '2026-08-31'];
    const rows = dates.flatMap((date, i) => [1, 2, 3].map(n => ({
      symbol: `${id}${n}.US`, last_day_data_date: date, dividend_yield: n / 100,
      price_change_5d: (n + i) / (first ? 10 : 20), market_cap: n * 1e6,
      currency_symbol: '$', exchange: 'US', name: `Listing ${id}${n}`,
    })));
    return { rows, completeness: 'paged', chart_evidence: { ...screenerEvidence,
      raw_count: rows.length, normalized_count: rows.length, delivered_count: rows.length,
      cohorts: dates.map(price_date => ({ ...screenerEvidence.cohorts[0], price_date, raw_count: 3 })),
    } };
  }
  if (recipe.kind === 'dividend-steps') return { rows: [{ ...dividendRow, amount: first ? .2 : .4 }],
    completeness: 'unknown', chart_evidence: dividendEvidence };
  if (recipe.kind === 'income-sankey') {
    const rows = [2026, 2025].map(year => ({ ...incomeRow, fiscal_year: year, period_ending: `${year}-06-30`,
      revenue: first ? 100 : 120, gross_profit: first ? 60 : 80, start: `${year}-01-01`, end: `${year}-12-31` }));
    return { rows, completeness: 'unknown', chart_evidence: {
      ...incomeEvidence, requested_limit: 2, raw_count: 2, normalized_count: 2, delivered_count: 2,
      periods: rows.map(row => ({ ...incomeEvidence.periods[0], fiscal_year: row.fiscal_year, period_end: row.period_ending })),
    } };
  }
}

function snapshotFor(recipe: RecipeOptions, sourceId: string, conflict = false) {
  const first = sourceId === 'A';
  if (recipe.kind === 'etf-pareto' || recipe.kind === 'etf-exposure') {
    const holdings = recipe.kind === 'etf-pareto';
    return { completeness: 'unknown', receipt: { fund_symbol: sourceId, etf_kind: holdings ? 'holdings' : 'sector',
      weight_basis: holdings ? 'fund-assets' : 'equity-exposure' },
    rows: [{ symbol: holdings ? 'Constituent ' + sourceId : sourceId, sector: 'Sector ' + sourceId,
      weight: first ? .2 : .4, fund_symbol: conflict ? 'CONFLICT' : sourceId }] };
  }
  return { completeness: 'bounded', receipt: { interval: '1d', start_date: '2026-01-01', end_date: '2026-01-04' },
    rows: dailyPriceRows(first ? [10, 20, 10, 20] : [10, 30, 15, 45]).map((r, i) =>
      ({ ...r, currency: conflict && i === 1 ? 'EUR' : 'USD' })) };
}

async function riskSource(recipe: RecipeOptions, id: string) {
  const file = await saveLocalFile(new File([JSON.stringify(snapshotFor(recipe, id))], 'snapshot.json'));
  return { ...source, id, title: id, params: { file } };
}
async function screeningSource(recipe: RecipeOptions, id: string) {
  const file = await saveLocalFile(new File([JSON.stringify(screeningSnapshot(recipe, id))], 'screening.json'));
  const root = { ...source, id, title: id, params: { file } };
  if (recipe.kind !== 'income-sankey') return root;
  const analytical = statementIntent();
  analytical.bindings.periodKindFieldId = 'period_kind';
  analytical.bindings.fiscal = { companyFieldId: 'symbol', dateFieldId: 'period_ending', fiscalYearFieldId: 'fiscal_year',
    periodStartFieldId: 'start', periodEndFieldId: 'end', periodKind: 'FY' };
  analytical.bindings.mappings = incomeEvidence.periods[0].present_fields.map(sourceFieldId =>
    ({ sourceFieldId, lineId: incomeStatementIds.line(sourceFieldId) }));
  return { ...root, tableDefinition: { table: {}, search: '', analytical } };
}

function riskChart(recipe: RecipeOptions) {
  return card({ id: 'chart', widgetId: 'linked_chart', backendId: 'builtin', linkedSource: { kind: 'widget', sourceWidgetId: 'A' },
    linkedChart: { type: recipe.kind, recipe, measures: [], display: 'grouped' } });
}
function installDashboard(dashboard: Dashboard) {
  useDashboardStore.setState({ dashboards: [dashboard], activeId: dashboard.id, activeTabId: dashboard.tabs[0].id });
}
function riskDashboard(cards: DashboardCard[]) {
  return { id: 'd', name: 'Analysis', tabs: [{ id: 't', name: 'Main', cards }] };
}
function LiveRiskChart() {
  const current = useDashboardStore(s => s.dashboards[0].tabs[0].cards.find(c => c.widgetId === 'linked_chart')!);
  return <><TableExecutionRuntime /><WidgetCard card={current} onRemove={() => {}} /></>;
}
function riskRuntime() {
  vi.stubGlobal('Worker', Boundary);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const run = vi.fn(async (...args: Parameters<typeof runRecipe>) => runRecipe(...args));
  const factory = vi.spyOn(recipeWorkers, 'createRecipeWorker').mockReturnValue({ run, dispose: vi.fn() });
  return { run, factory };
}
async function chooseRiskSource(id: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Choose source' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Choose source' }));
  fireEvent.change(dialog.getByLabelText('Source table'), { target: { value: id } });
  fireEvent.click(dialog.getByRole('button', { name: 'Choose source' }));
  await waitFor(() => expect(useDashboardStore.getState().dashboards[0].tabs[0].cards.at(-1)?.linkedSource?.sourceWidgetId).toBe(id));
}
it.each(riskRecipes)('fences $kind across a failed relink, late calculation and same-source failure', async recipe => {
  const { run, factory } = riskRuntime();
  const a = await riskSource(recipe, 'A'), b = await riskSource(recipe, 'B');
  installDashboard(riskDashboard([a, b, riskChart(recipe)]));
  const readFile = fs.readFile;
  let rejectB!: (error: Error) => void;
  const held = new Promise<Uint8Array<ArrayBuffer>>((_, reject) => { rejectB = reject; });
  const read = vi.spyOn(fs, 'readFile').mockImplementation((path, opts) => path === 'files/' + b.params.file ? held : readFile(path, opts));
  try {
    render(<LiveRiskChart/>);
    const first = await screen.findByTestId('chart-plot');
    const plot = vi.mocked(renderPlot);
    const figureA = plot.mock.lastCall![1];
    const tall = recipe.kind === 'small-multiples' || recipe.kind === 'etf-exposure';
    expect(first.style.height).toBe(tall ? figureA.layout.height + 'px' : '');
    expect(first.parentElement?.classList.contains('chart-scroll-viewport')).toBe(tall);
    expect(screen.getByLabelText('Chart type')).toHaveValue(recipe.kind);
    expect(screen.getByText(/^Source A ·/)).toBeVisible();
    let release!: () => void;
    run.mockImplementationOnce(async (...args) => {
      const result = runRecipe(...args);
      await new Promise<void>(resolve => { release = resolve; });
      return result;
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(release).toBeDefined());

    await chooseRiskSource('B');
    expect(await screen.findByText('Loading source B…')).toBeVisible();
    expect(first).not.toBeInTheDocument();
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    await act(async () => { rejectB(new Error('File read failed')); await tableExecutionStore.settled('d'); });
    const diagnostic = 'Source B: File read failed';
    expect(screen.getAllByText(diagnostic)).toHaveLength(1);
    expect(screen.getAllByRole('alert').map(n => n.textContent)).toEqual([diagnostic]);
    expect(screen.queryByTestId('chart-plot')).toBeNull();

    read.mockImplementation(readFile);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    const second = await screen.findByTestId('chart-plot');
    const figureB = plot.mock.lastCall![1];
    expect(screen.getByText(/^Source B ·/)).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
    const expectedTrace = {
      'return-distribution': { type: 'bar', x: [-.5, 0, .5, 1, 1.5], y: [1, 0, 0, 0, 2] },
      'small-multiples': { type: 'scatter', y: [100, 300, 150, 450] },
      'etf-pareto': { type: 'bar', x: ['holding:Constituent B'], y: [.4] },
      'etf-exposure': { type: 'scatter', mode: 'markers', x: [.4], y: ['Sector B'] },
    }[recipe.kind];
    expect(figureB.data).toContainEqual(expect.objectContaining(expectedTrace));
    expect(figureB.data).not.toEqual(figureA.data);
    expect(figureB.layout.uirevision).not.toEqual(figureA.layout.uirevision);
    const count = plot.mock.calls.length;
    await act(async () => release());
    expect(plot).toHaveBeenCalledTimes(count);
    expect(plot.mock.lastCall![0]).toBe(second);

    read.mockImplementation((path, opts) => path === 'files/' + b.params.file ? Promise.reject(new Error('File read failed')) : readFile(path, opts));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByText('Showing completed data (stale).');
    expect(screen.getAllByRole('alert').map(n => n.textContent)).toEqual([diagnostic]);
    expect(screen.getAllByText(/showing completed data \(stale\)/i)).toHaveLength(1);
    expect(screen.getByTestId('chart-plot')).toBe(second);
  } finally { read.mockRestore(); factory.mockRestore(); }
});

it.each([riskRecipes[0], riskRecipes[2]])('reopens $kind settings and rechecks hidden acquisition conflicts before plotting', async recipe => {
  const { run, factory } = riskRuntime();
  const def = widget({ id: 'snapshot', name: 'Acquired snapshot' });
  useWidgetRegistryStore.setState(s => ({ widgets: [...s.widgets, def] }));
  const root = card({ id: 'A', widgetId: def.id, backendId: def.backendId });
  const hidden = recipe.kind === 'etf-pareto' ? 'fund_symbol' : 'currency';
  const dashboard = riskDashboard([{ ...root, table: { hidden: [hidden] } }, riskChart(recipe)]);
  let activeId = dashboard.id;
  try {
    installDashboard(dashboard);
    tableExecutionStore.setBackendRows(activeId, root.id, snapshotFor(recipe, 'A'));
    const initial = render(<LiveRiskChart/>);
    await screen.findByTestId('chart-plot');
    const exported = exportCompatibleApp(dashboard);
    if (!exported.ok) throw new Error(exported.issue.message);
    const serialized = JSON.stringify([exported.value]);
    expect(serialized).not.toMatch(/etfEvidence|priceDimensionsChecked|acquiredRowCount|viewportWidth|weight_basis/);
    initial.unmount();
    tableExecutionStore.disposeDashboard(activeId);
    const imported = importApps(JSON.parse(serialized), useWidgetRegistryStore.getState().widgets).dashboards[0];
    expect(imported.tabs[0].cards.find(c => c.linkedChart)?.linkedChart?.recipe).toEqual(recipe);
    const source = imported.tabs[0].cards.find(c => c.widgetId === def.id)!;
    expect(source.table?.hidden).toEqual([hidden]);
    installDashboard(imported);
    activeId = imported.id;
    tableExecutionStore.setBackendRows(activeId, source.id, snapshotFor(recipe, 'A', true));
    render(<LiveRiskChart/>);
    const problem = recipe.kind === 'etf-pareto' ? /inconsistent ETF fund identity/i : /currenc/i;
    await waitFor(() => expect(screen.getAllByText(problem, { selector: 'p' }).length).toBeGreaterThan(0));
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    expect(tableExecutionStore.readView(activeId, source.id).ready!.columns.map(c => c.id)).not.toContain(hidden);
    expect(run.mock.lastCall![0].rows.every(row => !(hidden in row.values))).toBe(true);
    await act(async () => {
      tableExecutionStore.setBackendRows(activeId, source.id, snapshotFor(recipe, 'A'));
      await tableExecutionStore.settled(activeId);
    });
    await screen.findByTestId('chart-plot');
    expect(screen.queryByText(problem, { selector: 'p' })).toBeNull();
  } finally { cleanup(); tableExecutionStore.disposeDashboard(activeId); factory.mockRestore(); }
});

it('announces chart-read, worker and settings-save errors from a mounted financial card', async () => {
  const { run, factory } = riskRuntime();
  const recipe = riskRecipes[2];
  const a = await riskSource(recipe, 'A');
  installDashboard(riskDashboard([a, riskChart(recipe)]));
  const save = vi.spyOn(useDashboardStore.getState(), 'commitLinkedChartSettings').mockRejectedValue(new Error('settings write failed'));
  try {
    render(<LiveRiskChart/>);
    await screen.findByTestId('chart-plot');
    fireEvent.click(screen.getByRole('button', { name: /apply chart settings/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('settings write failed');
    const executor = tableExecutionStore.readExecutor('d', a.id)!;
    vi.spyOn(executor, 'chartData').mockRejectedValueOnce(new Error('chart read failed'));
    await act(async () => {
      tableExecutionStore.updateDefinition('d', a.id, { table: { hidden: ['sector'] }, search: '' }, { kind: 'none' });
      await tableExecutionStore.settled('d');
    });
    expect(await screen.findByText('chart read failed')).toHaveAttribute('role', 'alert');
    expect(screen.getByText('settings write failed')).toBeVisible();
    expect(screen.getByTestId('chart-plot')).toBeVisible();
    run.mockRejectedValueOnce(new Error('chart worker failed'));
    await act(async () => {
      tableExecutionStore.updateDefinition('d', a.id, { table: {}, search: '' }, { kind: 'none' });
      await tableExecutionStore.settled('d');
    });
    expect(await screen.findByText('chart worker failed')).toHaveAttribute('role', 'alert');
    expect(screen.getByText('settings write failed')).toBeVisible();
  } finally { save.mockRestore(); factory.mockRestore(); }
});

it('revalidates exposure mode against the linked snapshot without acquiring another source', async () => {
  const { factory } = riskRuntime();
  const recipe = riskRecipes[3];
  const a = await riskSource(recipe, 'A');
  const snapshot = snapshotFor(recipe, 'A');
  const rows = [...snapshot.rows, { symbol: 'A', sector: 'Utilities', weight: .3, fund_symbol: 'A' }].map(row => ({ ...row, country: 'Canada' }));
  await fs.writeFile('files/' + a.params.file, new TextEncoder().encode(JSON.stringify({ ...snapshot, rows })));
  installDashboard(riskDashboard([a, riskChart(recipe)]));
  const reads = vi.spyOn(fs, 'readFile');
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  try {
    render(<LiveRiskChart/>);
    await screen.findByTestId('chart-plot');
    expect(screen.getByText(/transport coverage is unknown/i)).toBeVisible();
    expect(screen.getByText(/snapshot as-of date not supplied/i)).toBeVisible();
    await act(async () => {
      tableExecutionStore.updateDefinition('d', a.id, { table: {}, search: 'Utilities' }, { kind: 'none' });
      await tableExecutionStore.settled('d');
    });
    expect(await screen.findByText('Filtered source delivered 1 of 2 acquired rows.')).toBeVisible();
    const snapshotReads = () => reads.mock.calls.filter(([path]) => path === 'files/' + a.params.file).length;
    const before = snapshotReads();
    fireEvent.change(screen.getByLabelText('Exposure mode'), { target: { value: 'region' } });
    fireEvent.click(screen.getByRole('button', { name: /apply chart settings/i }));
    expect(await screen.findByText(/choose an ETF source with the requested exposure kind/i)).toBeVisible();
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    expect(snapshotReads()).toBe(before);
    expect(fetch).not.toHaveBeenCalled();
  } finally { reads.mockRestore(); factory.mockRestore(); }
});

it.each(screeningRecipes)('fences $kind on a failed source change and retains only same-source completed output', async recipe => {
  const { run, factory } = riskRuntime();
  const plot = vi.mocked(renderPlot);
  let rejectDraw!: (error: Error) => void;
  plot.mockReturnValueOnce(new Promise<void>((_, reject) => { rejectDraw = reject; }));
  const a = await screeningSource(recipe, 'A'), b = await screeningSource(recipe, 'B');
  installDashboard(riskDashboard([a, b, riskChart(recipe)]));
  const readFile = fs.readFile;
  let rejectB!: (error: Error) => void;
  const held = new Promise<Uint8Array<ArrayBuffer>>((_, reject) => { rejectB = reject; });
  const read = vi.spyOn(fs, 'readFile').mockImplementation((path, opts) => path === 'files/' + b.params.file ? held : readFile(path, opts));
  try {
    render(<LiveRiskChart/>);
    const first = await screen.findByTestId('chart-plot');
    await waitFor(() => expect(plot.mock.lastCall?.[0]).toBe(first));
    const figureA = plot.mock.lastCall![1];
    expect(first.style.height).toBe(recipe.kind === 'income-sankey' ? figureA.layout.height + 'px' : '');
    expect(screen.getByText(/^Source A ·/)).toBeVisible();
    let rejectWorker!: (error: Error) => void;
    run.mockImplementationOnce(async () => new Promise((_, reject) => { rejectWorker = reject; }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(rejectWorker).toBeDefined());

    await chooseRiskSource('B');
    expect(await screen.findByText('Loading source B…')).toBeVisible();
    expect(first).not.toBeInTheDocument();
    await act(async () => { rejectB(new Error('File read failed')); await tableExecutionStore.settled('d'); });
    const diagnostic = 'Source B: File read failed';
    expect(screen.getAllByRole('alert').map(n => n.textContent)).toEqual([diagnostic]);
    expect(screen.queryByTestId('chart-plot')).toBeNull();

    read.mockImplementation(readFile);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    const second = await screen.findByTestId('chart-plot');
    await waitFor(() => expect(plot.mock.lastCall?.[0]).toBe(second));
    const figureB = plot.mock.lastCall![1];
    expect(screen.getByText(/^Source B ·/)).toBeVisible();
    expect(figureB.data).not.toEqual(figureA.data);
    expect(figureB.layout.uirevision).not.toEqual(figureA.layout.uirevision);
    const count = plot.mock.calls.length;
    await act(async () => {
      rejectDraw(new Error('late Plotly failure'));
      rejectWorker(new Error('late chart worker failure'));
    });
    expect(plot).toHaveBeenCalledTimes(count);
    expect(screen.queryByRole('alert')).toBeNull();

    read.mockImplementation((path, opts) => path === 'files/' + b.params.file ? Promise.reject(new Error('File read failed')) : readFile(path, opts));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByText('Showing completed data (stale).');
    expect(screen.getAllByRole('alert').map(n => n.textContent)).toEqual([diagnostic]);
    expect(screen.getAllByText(/showing completed data \(stale\)/i)).toHaveLength(1);
    expect(screen.getByTestId('chart-plot')).toBe(second);
    expect(await screen.findByText(/fix the source or choose another table to load chart choices/i)).toBeVisible();
    expect(screen.queryByText(/wait for the selected source table/i)).toBeNull();

    read.mockImplementation(readFile);
    plot.mockRejectedValueOnce(new Error('current Plotly failure'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be drawn.*current Plotly failure/i);
    expect(screen.queryByText(diagnostic)).toBeNull();
  } finally { read.mockRestore(); factory.mockRestore(); }
});

it('keeps the applied bubble visible through an incompatible draft and clears it for an invalid applied binding', async () => {
  const { factory } = riskRuntime();
  const recipe = screeningRecipes[0];
  const root = await screeningSource(recipe, 'A');
  const chart = riskChart(recipe);
  const snapshot = screeningSnapshot(recipe, 'A')!;
  await fs.writeFile('files/' + root.params.file, new TextEncoder().encode(JSON.stringify({
    ...snapshot, rows: snapshot.rows.map(row => ({ ...row, ...dividendRow })),
  })));
  installDashboard(riskDashboard([root, chart]));
  try {
    render(<LiveRiskChart/>);
    const plot = await screen.findByTestId('chart-plot');
    await waitFor(() => expect(vi.mocked(renderPlot).mock.lastCall?.[0]).toBe(plot));
    const revision = vi.mocked(renderPlot).mock.lastCall![2];
    const type = screen.getByLabelText('Chart type');
    fireEvent.change(type, { target: { value: 'dividend-steps' } });
    expect(await screen.findByText(/acquire dividend data with a qualified instrument receipt/i)).toBeVisible();
    expect(screen.getByRole('button', { name: /apply chart/i })).toBeDisabled();
    expect(screen.getByTestId('chart-plot')).toBe(plot);
    fireEvent.change(type, { target: { value: 'bubble-regression' } });
    const date = screen.getByLabelText('Price date');
    expect(date).toHaveValue('latest');
    await screen.findByRole('option', { name: '2026-08-28' });
    expect(screen.getByLabelText('Show regression')).toBeChecked();
    fireEvent.change(screen.getByLabelText('Fractional dividend yield'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: /apply chart/i })).toBeDisabled();
    expect(screen.getByTestId('chart-plot')).toBe(plot);
    fireEvent.change(screen.getByLabelText('Fractional dividend yield'), { target: { value: 'dividend_yield' } });
    fireEvent.change(date, { target: { value: '2026-08-28' } });
    fireEvent.click(screen.getByLabelText('Show regression'));
    fireEvent.click(screen.getByRole('button', { name: /apply chart/i }));
    await waitFor(() => expect(vi.mocked(renderPlot).mock.lastCall![2]).not.toBe(revision));
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1].linkedChart?.recipe)
      .toMatchObject({ priceDate: '2026-08-28', regression: false });
    const dateRevision = vi.mocked(renderPlot).mock.lastCall![2];
    await waitFor(() => expect(screen.getByRole('button', { name: /apply chart/i })).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'name' } });
    fireEvent.click(screen.getByRole('button', { name: /apply chart/i }));
    await waitFor(() => expect(vi.mocked(renderPlot).mock.lastCall![2]).not.toBe(dateRevision));
    expect(vi.mocked(renderPlot).mock.lastCall![1].data[0]).toMatchObject({ text: expect.arrayContaining([expect.stringContaining('Listing A1')]) });
    act(() => {
      installDashboard(riskDashboard([root, { ...chart, linkedChart: { ...chart.linkedChart!, recipe: {
        ...recipe, fields: { ...recipe.fields, dividendYield: 'unavailable' },
      } } }]));
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(/unavailable.*repair/i);
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    act(() => installDashboard(riskDashboard([root, { ...chart, linkedChart: { ...chart.linkedChart!, recipe: undefined } }])));
    expect(await screen.findByText(/version 1 recipe options/i)).toBeVisible();
    expect(screen.queryByTestId('chart-plot')).toBeNull();
  } finally { factory.mockRestore(); }
});

it.each([
  ['an absent receipt', undefined, undefined],
  ['a malformed receipt', { ...screenerEvidence, units: { ...screenerEvidence.units, price_change_5d: 'percentage-point' } }, undefined],
  ['a dividend receipt', dividendEvidence, 'dividends'],
] as const)('keeps the applied chart when a screening draft has %s', async (_, receipt, acquiredKind) => {
  const { factory } = riskRuntime();
  const rows = [{
    ...dividendRow, symbol: acquiredKind ? 'SHEL.LSE' : 'A.US', last_day_data_date: '2026-08-28',
    market_cap: 200, dividend_yield: .02, price_change_5d: .01,
    exchange: acquiredKind ? 'LSE' : 'US', currency_symbol: acquiredKind ? 'GBP' : '$',
  }];
  const url = new URL(acquiredKind
    ? 'https://example.test/api/v1/eodhd/equity/fundamental/dividends?chart_source=true&symbol=SHEL.LSE&start_date=2026-01-01&end_date=2026-06-30'
    : 'https://example.test/api/v1/eodhd/equity/screener?chart_source=true&exchange=us');
  const def = widget({ id: 'screen-fields', name: 'Screening fields', endpoint: url.pathname });
  useWidgetRegistryStore.setState(s => ({ widgets: [...s.widgets, def] }));
  const root = card({ id: 'A', widgetId: def.id, backendId: def.backendId });
  const linkedChart = { type: 'column' as const, category: 'symbol', display: 'grouped' as const, measures: ['market_cap'] };
  const chart = { ...riskChart(screeningRecipes[0]), linkedChart };
  const acquired = backendFinancialResponse({ results: rows, extra: { results_metadata: { chart_evidence: receipt } } }, url);
  installDashboard(riskDashboard([root, chart]));
  tableExecutionStore.setBackendRows('d', root.id, rows, { endpoint: url.pathname, parameters: Object.fromEntries(url.searchParams),
    retrievedAt: Date.parse(screenerEvidence.retrieved_at), financialEvidence: acquired?.evidence });
  try {
    render(<LiveRiskChart/>);
    const applied = await screen.findByTestId('chart-plot');
    const revision = tableExecutionStore.readView('d', 'chart').sourceRevision!;
    const executor = tableExecutionStore.readExecutor('d', 'A')!;
    const data = await executor.chartData(revision, ['last_day_data_date'], new AbortController().signal);
    expect(readFinancialEvidence(data.provenance)?.kind).toBe(acquiredKind);

    fireEvent.change(screen.getByLabelText('Chart type'), { target: { value: 'bubble-regression' } });
    expect(await screen.findByText(/acquire screening data with a validated screener receipt/i)).toBeVisible();
    expect(screen.queryByRole('option', { name: '2026-08-28' })).toBeNull();
    const apply = screen.getByRole('button', { name: /apply chart/i });
    expect(apply).toBeDisabled();
    fireEvent.click(apply);
    expect(screen.getByTestId('chart-plot')).toBe(applied);
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1].linkedChart).toEqual(linkedChart);
  } finally { factory.mockRestore(); }
});

it('projects only presented fiscal periods and defaults Sankey to the newest actual report date', async () => {
  const { factory } = riskRuntime();
  const recipe = screeningRecipes[2];
  const root = await screeningSource(recipe, 'A');
  const chart = riskChart(recipe);
  installDashboard(riskDashboard([root, { ...chart, linkedChart: { type: 'column', display: 'grouped', measures: [] } }]));
  try {
    render(<LiveRiskChart/>);
    const read = await waitFor(() => {
      const executor = tableExecutionStore.readExecutor('d', 'A');
      expect(tableExecutionStore.readView('d', 'chart').status).toBe('ready');
      return vi.spyOn(executor!, 'chartData');
    });
    fireEvent.change(screen.getByLabelText('Chart type'), { target: { value: 'income-sankey' } });
    await screen.findByRole('option', { name: /FY 2025.*2025-06-30/i });
    const period = screen.getByLabelText('Income statement period');
    expect(period).toHaveValue(incomeColumn(2026));
    expect(read.mock.lastCall![1]).toEqual(expect.arrayContaining([incomeColumn(2026), incomeColumn(2025)]));
    expect(read.mock.lastCall![1]).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /apply chart/i }));
    const plot = await screen.findByTestId('chart-plot');
    await waitFor(() => expect(vi.mocked(renderPlot).mock.lastCall?.[0]).toBe(plot));
    const revision = vi.mocked(renderPlot).mock.lastCall![2];
    fireEvent.change(screen.getByLabelText('Income statement period'), { target: { value: incomeColumn(2025) } });
    expect(vi.mocked(renderPlot).mock.lastCall![2]).toBe(revision);
    fireEvent.click(screen.getByRole('button', { name: /apply chart/i }));
    await waitFor(() => expect(vi.mocked(renderPlot).mock.lastCall![2]).not.toBe(revision));
    expect(vi.mocked(renderPlot).mock.lastCall![1].layout.title).toMatchObject({ text: expect.stringContaining('2025-06-30') });
    read.mockRestore();
  } finally { factory.mockRestore(); }
});

it.each([
  ['covered empty', emptyDividendEvidence, /no dividend events were supplied/i],
  ['all invalid', { ...dividendEvidence, normalized_count: 0, delivered_count: 0,
    diagnostics: ['invalid_amount'], invalid_amount_dates: dividendEvidence.event_dates }, /no usable historical dividends.*1 invalid amount/i],
  ['unknown coverage', { ...emptyDividendEvidence, diagnostics: ['unknown_coverage'], coverage: { status: 'unknown' } }, /dividend coverage is unknown/i],
] as const)('keeps %s dividend status through a columnless result without drawing empty traces', async (_, evidence, message) => {
  const { run, factory } = riskRuntime();
  const recipe = screeningRecipes[1];
  const root = await screeningSource(recipe, 'A');
  installDashboard(riskDashboard([root, riskChart(recipe)]));
  try {
    render(<LiveRiskChart/>);
    await screen.findByTestId('chart-plot');
    const instrument = screen.getByLabelText('Acquired instrument');
    await waitFor(() => expect(instrument).toHaveValue('SHEL.LSE'));
    expect([...within(instrument).getAllByRole('option')].map(option => option.textContent)).toEqual(['Choose instrument', 'SHEL.LSE']);
    const count = vi.mocked(renderPlot).mock.calls.length;
    await fs.writeFile('files/' + root.params.file, new TextEncoder().encode(JSON.stringify({
      completeness: 'unknown', rows: [], chart_evidence: evidence,
    })));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText(message)).toBeVisible();
    expect(run.mock.lastCall![0]).toMatchObject({ rows: [], columns: [] });
    expect(vi.mocked(renderPlot)).toHaveBeenCalledTimes(count);
    expect(screen.queryByTestId('chart-plot')).toBeNull();
  } finally { factory.mockRestore(); }
});

it('rebuilds the income flow for measured plot width without changing its question or querying the source again', async () => {
  const { run, factory } = riskRuntime();
  const sizes = new Map<Element, (width: number) => void>();
  vi.stubGlobal('ResizeObserver', class {
    constructor(private notify: ResizeObserverCallback) {}
    observe(el: Element) {
      sizes.set(el, width => this.notify([{ contentRect: { width, height: 600 } }] as ResizeObserverEntry[], this as unknown as ResizeObserver));
    }
    disconnect() {}
  });
  const recipe = screeningRecipes[2];
  const root = await screeningSource(recipe, 'A');
  installDashboard(riskDashboard([root, riskChart(recipe)]));
  try {
    render(<LiveRiskChart/>);
    const plot = await screen.findByTestId('chart-plot');
    await waitFor(() => expect(vi.mocked(renderPlot).mock.lastCall?.[0]).toBe(plot));
    const read = vi.spyOn(tableExecutionStore.readExecutor('d', 'A')!, 'chartData');
    const initial = vi.mocked(renderPlot).mock.lastCall![1];
    const resize = sizes.get(plot)!;
    act(() => resize(760));
    await waitFor(() => expect(vi.mocked(renderPlot).mock.lastCall![1].layout.width).toBe(760));
    const resized = vi.mocked(renderPlot).mock.lastCall![1];
    expect(resized.layout.uirevision).toBe(initial.layout.uirevision);
    expect(resized.data).not.toEqual(initial.data);
    expect(plot.style.height).toBe(resized.layout.height + 'px');
    expect(run.mock.lastCall![2].viewportWidth).toBe(760);
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
  } finally { factory.mockRestore(); }
});

it('requires repairing the dividend instrument after reacquisition and resets the question when applied', async () => {
  const { factory } = riskRuntime();
  const recipe = screeningRecipes[1];
  const root = await screeningSource(recipe, 'A');
  installDashboard(riskDashboard([root, riskChart(recipe)]));
  try {
    render(<LiveRiskChart/>);
    const plot = await screen.findByTestId('chart-plot');
    await waitFor(() => expect(vi.mocked(renderPlot).mock.lastCall?.[0]).toBe(plot));
    const revision = vi.mocked(renderPlot).mock.lastCall![2];
    await fs.writeFile('files/' + root.params.file, new TextEncoder().encode(JSON.stringify({
      completeness: 'unknown', rows: [dividendRow], chart_evidence: { ...dividendEvidence, qualified_symbol: 'BP.LSE' },
    })));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText(/choose the acquired instrument BP.LSE/i)).toBeVisible();
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    await screen.findByRole('option', { name: 'BP.LSE' });
    const apply = screen.getByRole('button', { name: /apply chart/i });
    expect(apply).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Acquired instrument'), { target: { value: 'BP.LSE' } });
    fireEvent.click(apply);
    await screen.findByTestId('chart-plot');
    await waitFor(() => expect(vi.mocked(renderPlot).mock.lastCall![2]).not.toBe(revision));
    expect(vi.mocked(renderPlot).mock.lastCall![1].data[0]).toMatchObject({ name: 'BP.LSE' });
  } finally { factory.mockRestore(); }
});

it('keeps a working chart while a valid dividend receipt requires verified coverage', async () => {
  const { factory } = riskRuntime();
  const root = await screeningSource(screeningRecipes[1], 'A');
  const linkedChart = { type: 'column', category: 'ex_dividend_date', display: 'grouped', measures: ['amount'] } as const;
  const chart = { ...riskChart(screeningRecipes[1]), linkedChart: { ...linkedChart, measures: [...linkedChart.measures] } };
  await fs.writeFile('files/' + root.params.file, new TextEncoder().encode(JSON.stringify({
    completeness: 'unknown', rows: [dividendRow],
    chart_evidence: { ...dividendEvidence, coverage: { status: 'unknown' }, diagnostics: ['unknown_coverage'] },
  })));
  installDashboard(riskDashboard([root, chart]));
  try {
    render(<LiveRiskChart/>);
    const plot = await screen.findByTestId('chart-plot');
    fireEvent.change(screen.getByLabelText('Chart type'), { target: { value: 'dividend-steps' } });
    await screen.findByRole('option', { name: 'SHEL.LSE' });
    expect(screen.getByRole('button', { name: /apply chart/i })).toBeDisabled();
    expect(screen.getByText(/dividend coverage is unknown/i)).toBeVisible();
    expect(screen.getByTestId('chart-plot')).toBe(plot);
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1].linkedChart).toEqual(linkedChart);
  } finally { factory.mockRestore(); }
});

it('applies Dividend steps to a newly linked columnless verified-empty file', async () => {
  const { factory } = riskRuntime();
  const root = await screeningSource(screeningRecipes[1], 'A');
  const chart = { ...riskChart(screeningRecipes[1]), linkedChart: { type: 'column' as const, display: 'grouped' as const, measures: [] } };
  await fs.writeFile('files/' + root.params.file, new TextEncoder().encode(JSON.stringify({
    completeness: 'bounded', rows: [], chart_evidence: emptyDividendEvidence,
  })));
  installDashboard(riskDashboard([root, chart]));
  try {
    render(<LiveRiskChart/>);
    const option = screen.getByRole('option', { name: /Dividend steps/i });
    await waitFor(() => expect(option).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Chart type'), { target: { value: 'dividend-steps' } });
    const apply = screen.getByRole('button', { name: /apply chart/i });
    await waitFor(() => expect(apply).toBeEnabled());
    expect(screen.getByLabelText('Acquired instrument')).toHaveValue('SHEL.LSE');
    fireEvent.click(apply);
    expect(await screen.findByText(/no dividend events were supplied/i)).toBeVisible();
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1].linkedChart?.recipe).toEqual(screeningRecipes[1]);
  } finally { factory.mockRestore(); }
});

it('checks the selected screening cohort before applying a draft over a working chart', async () => {
  const { factory } = riskRuntime();
  const recipe = screeningRecipes[0];
  const root = await screeningSource(recipe, 'A');
  const snapshot = screeningSnapshot(recipe, 'A')!;
  const evidence = snapshot.chart_evidence;
  if (!('cohorts' in evidence)) throw new Error('Expected screener evidence');
  Object.assign(snapshot, { rows: [...snapshot.rows, { ...snapshot.rows.at(-1), market_cap: 1 }] });
  evidence.raw_count++;
  evidence.normalized_count++;
  evidence.delivered_count++;
  evidence.cohorts[1].raw_count++;
  evidence.cohorts[1].conflicting_duplicates = true;
  Object.assign(evidence, { diagnostics: ['screener_duplicate_conflict'] });
  await fs.writeFile('files/' + root.params.file, new TextEncoder().encode(JSON.stringify(snapshot)));
  const linkedChart = { type: 'column' as const, category: 'symbol', display: 'grouped' as const, measures: ['market_cap'] };
  installDashboard(riskDashboard([root, { ...riskChart(recipe), linkedChart }]));
  try {
    render(<LiveRiskChart/>);
    const plot = await screen.findByTestId('chart-plot');
    fireEvent.change(screen.getByLabelText('Chart type'), { target: { value: 'bubble-regression' } });
    expect(await screen.findByText(/2026-08-31.*conflicting duplicate listings/)).toBeVisible();
    const apply = screen.getByRole('button', { name: /apply chart/i });
    expect(apply).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Price date'), { target: { value: '2026-08-28' } });
    expect(apply).toBeEnabled();
    expect(screen.getByTestId('chart-plot')).toBe(plot);
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1].linkedChart).toEqual(linkedChart);
  } finally { factory.mockRestore(); }
});

it('checks record coverage for the selected income period before saving its draft', async () => {
  const { factory } = riskRuntime();
  const recipe = screeningRecipes[2];
  const root = await screeningSource(recipe, 'A');
  const snapshot = screeningSnapshot(recipe, 'A')!;
  const evidence = snapshot.chart_evidence;
  if (!('periods' in evidence)) throw new Error('Expected income evidence');
  evidence.periods[0].record_coverage = 'unknown';
  Object.assign(evidence, { diagnostics: ['unknown_record_coverage'] });
  await fs.writeFile('files/' + root.params.file, new TextEncoder().encode(JSON.stringify(snapshot)));
  const linkedChart = { type: 'column' as const, display: 'grouped' as const, measures: [] };
  installDashboard(riskDashboard([root, { ...riskChart(recipe), linkedChart }]));
  try {
    render(<LiveRiskChart/>);
    await waitFor(() => expect(tableExecutionStore.readView('d', 'chart').status).toBe('ready'));
    fireEvent.change(screen.getByLabelText('Chart type'), { target: { value: 'income-sankey' } });
    expect(await screen.findByText(/complete income statement record/i)).toBeVisible();
    const apply = screen.getByRole('button', { name: /apply chart/i });
    expect(apply).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Income statement period'), { target: { value: incomeColumn(2025) } });
    expect(apply).toBeEnabled();
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1].linkedChart).toEqual(linkedChart);
  } finally { factory.mockRestore(); }
});

it('keeps the applied income plot and period when another full record lacks its net-income anchor', async () => {
  const { factory } = riskRuntime();
  const recipe = screeningRecipes[2];
  const root = await screeningSource(recipe, 'A');
  const snapshot = screeningSnapshot(recipe, 'A')!;
  const evidence = snapshot.chart_evidence;
  if (!('periods' in evidence)) throw new Error('Expected income evidence');
  const omitAnchor = async (index: number) => {
    Object.assign(snapshot.rows[index], { net_income: null });
    const period = evidence.periods[index];
    period.present_fields = period.present_fields.filter(field => field !== 'net_income');
    await fs.writeFile('files/' + root.params.file, new TextEncoder().encode(JSON.stringify(snapshot)));
  };
  await omitAnchor(1);
  installDashboard(riskDashboard([root, riskChart(recipe)]));
  try {
    render(<LiveRiskChart/>);
    const plot = await screen.findByTestId('chart-plot');
    const selector = screen.getByLabelText('Income statement period');
    await screen.findByRole('option', { name: /FY 2025/ });
    fireEvent.change(selector, { target: { value: incomeColumn(2025) } });
    const apply = screen.getByRole('button', { name: /apply chart/i });
    expect(apply).toBeDisabled();
    const repair = /finite, source-verified Net income anchor/;
    expect(screen.getByText(repair)).toBeVisible();
    expect(screen.getByTestId('chart-plot')).toBe(plot);
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1].linkedChart?.recipe).toEqual(recipe);
    fireEvent.change(selector, { target: { value: incomeColumn(2026) } });
    expect(apply).toBeEnabled();
    await omitAnchor(0);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.queryByTestId('chart-plot')).toBeNull());
    expect(screen.getAllByText(repair).length).toBeGreaterThan(0);
  } finally { factory.mockRestore(); }
});
