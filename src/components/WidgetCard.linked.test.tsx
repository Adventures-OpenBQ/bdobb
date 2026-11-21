// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

vi.mock('../lib/plotly', () => ({ renderPlot: vi.fn(async () => {}), purgePlot: () => {}, resizePlot: () => {}, followSunburstLevel: () => () => {}, followTreemapLevel: () => () => {}, followPlotYAxisTicks: () => () => {}, followPlotZoom: () => () => {}, restorePlotZoom: async () => {}, REGISTERED_TRACE_TYPES: new Set(['bar', 'scatter', 'indicator', 'waterfall', 'sankey', 'heatmap', 'box', 'sunburst', 'treemap']) }));
import { capMap, marketSession } from '../test/fixtures/marketMap';
import marketIndex from '../test/fixtures/marketMapIndex.json';
import { revisionBump, revisionDenseValues, revisionHistory, revisionSlope, revisionTieValues } from '../test/fixtures/estimateRevisions';
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
import type { DualAxisOverlayOptions, EtfSunburstOptions, OwnershipSnapshotOptions, RecipeOptions, ReturnSummaryOptions } from '../lib/widgetData/chartRecipes/types';
import { priceFields, dailyPriceRows } from '../lib/widgetData/chartRecipes/fixtures';
import * as recipeWorkers from '../lib/widgetData/chartRecipes/workerClient';
import { runRecipe } from '../lib/widgetData/chartRecipes/run';
import { backendFinancialResponse, readFinancialEvidence } from '../lib/widgetData/chartRecipes/financialEvidence';
import { renderPlot } from '../lib/plotly';
import { fixture as incomeFixture } from '../lib/statementModel/compileFixtures';
import { intent as statementIntent } from '../lib/statementModel/testFixtures';
import { incomeStatementIds } from '../lib/statementModel/incomeChartProof';
import { dividendEvidence, dividendRow, emptyDividendEvidence, incomeEvidence, incomeRow, screenerEvidence } from '../test/fixtures/financialEvidence';
import { liveOwnershipReceipt, liveOwnershipRows } from '../test/fixtures/ownershipEvidence';
import { calendarArticle, calendarOptions, calendarSnapshot } from '../test/fixtures/newsCalendar';
import * as fs from '@tauri-apps/plugin-fs';
import { buildKpiSnapshot } from '../lib/widgetData/kpi/build';
import type { LinkedKpiOptions } from '../lib/widgetData/kpi/types';
import * as kpiWorkers from '../lib/widgetData/kpi/workerClient';
import { metricReceipt, metricRows } from '../test/fixtures/metricEvidence';
import { local as etfReceipt, rows as etfRows } from '../test/fixtures/etfHierarchyEvidence';
import overlaySnapshots from '../test/fixtures/overlaySnapshots.json';
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
let restoreViewportWidth: (() => void) | undefined;
afterEach(() => { restoreViewportWidth?.(); restoreViewportWidth = undefined; cleanup(); tableExecutionStore.disposeDashboard('d'); Boundary.failChild = false; vi.unstubAllGlobals(); });
const source = card({ id: 's', widgetId: 'local_table', backendId: 'builtin', title: 'Prices', params: { file: 'missing.csv' } });
// A store update copies a spied method into its next state; restore that property too, not only the old spy target.
beforeEach(() => { __reset(); __resetJsonStoreForTests(); useWidgetRegistryStore.getState().seedBuiltins(); useDashboardStore.setState({ commitLinkedChartSettings: useDashboardStore.getInitialState().commitLinkedChartSettings, dashboards: [{ id: 'd', name: 'D', tabs: [{ id: 't', name: 'First', cards: [source] }] }], activeId: 'd', activeTabId: 't', viewer: false, pendingCardRemoval: null }); });
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
  const plot = await screen.findByTestId('chart-plot');
  const parameters = openParameters();
  expect(parameters.getByLabelText('Chart type')).toHaveValue('column');
  expect(parameters.getByLabelText('Category')).toHaveValue('region');
  expect(parameters.getByRole('button', { name: /^Measures/ })).toBeVisible();
  expect(parameters.getByLabelText('Series from')).toHaveValue('columns');
  fireEvent.click(screen.getByRole('button', { name: 'Hide parameters' }));
  expect(screen.getByTestId('chart-plot')).toBe(plot);
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

    const parameters = openParameters();
    expect(parameters.getByLabelText('Chart type')).toHaveValue(type);
    expect(parameters.getByLabelText('Category')).toHaveValue(mapping.category);
    expect(parameters.getByRole('button', { name: /^Measures/ })).toBeVisible();
    if (type === 'bullet') expect(parameters.getByLabelText('Quarter')).toHaveValue('Q2');
    fireEvent.click(parameters.getByRole('button', { name: 'Choose source' }));
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

const returnOptions: ReturnSummaryOptions = {
  version: 1, kind: 'return-summary', fields: priceFields, symbols: ['A.US'], view: 'box', window: { mode: 'own' },
};

const ownershipOptions: OwnershipSnapshotOptions = {
  version: 1, kind: 'ownership-snapshot', issuer: 'AAPL.US', view: 'bars', fields: liveOwnershipReceipt.field_origins,
};
function ownershipSnapshot(id: string, issuer = 'AAPL.US') {
  return { completeness: 'complete', rows: [{
    ...liveOwnershipRows[0], symbol: issuer, share_class: null, percent_insiders: id === 'A' ? 1.687 : 2.875,
  }], chart_sources: { version: 1, receipts: [{ ...liveOwnershipReceipt, origin: 'acquired-snapshot', issuer }] } };
}

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

function acquiredSnapshot(recipe: RecipeOptions, id: string) {
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
function newsSnapshot(first: boolean) {
  return calendarSnapshot([
    [calendarArticle('first', '2026-11-17T12:00:00Z', first ? .1 : .2), '2026-11-17'],
    [calendarArticle('last', '2026-11-19T00:30:00+01:00', null), '2026-11-18'],
  ]);
}
async function acquiredSource(recipe: RecipeOptions, id: string) {
  const snapshot = recipe.kind === 'news-sentiment-calendar' ? newsSnapshot(id === 'A')
    : recipe.kind === 'return-summary' ? returnSnapshot(id)
      : recipe.kind === 'ownership-snapshot' ? ownershipSnapshot(id) : acquiredSnapshot(recipe, id);
  const file = await saveLocalFile(new File([JSON.stringify(snapshot)], 'acquired.json'));
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
function LiveRiskChart({ viewer = false }: { viewer?: boolean }) {
  const current = useDashboardStore(s => s.dashboards[0].tabs[0].cards.find(c => c.widgetId === 'linked_chart')!);
  return <><TableExecutionRuntime /><WidgetCard card={current} viewer={viewer} onRemove={() => {}} /></>;
}
function riskRuntime() {
  vi.stubGlobal('Worker', Boundary);
  const resizeListeners = new Set<(entries: ResizeObserverEntry[]) => void>();
  vi.stubGlobal('ResizeObserver', class {
    constructor(private readonly notify: (entries: ResizeObserverEntry[]) => void) {}
    observe() { resizeListeners.add(this.notify); }
    disconnect() { resizeListeners.delete(this.notify); }
  });
  let measured = 900;
  let measuredHeight = 430;
  const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.matches('.chart-scroll-viewport--measured, .chart-scroll-viewport--wide > .chart-plot') ? measured : 0;
  });
  const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.matches('.chart-scroll-viewport--wide > .chart-plot') ? measuredHeight : 0;
  });
  restoreViewportWidth = () => { width.mockRestore(); height.mockRestore(); };
  const run = vi.fn<ReturnType<typeof recipeWorkers.createRecipeWorker>['run']>(
    async (dataset, options, context) => runRecipe(dataset, options, context),
  );
  const factory = vi.spyOn(recipeWorkers, 'createRecipeWorker').mockReturnValue({ run, dispose: vi.fn() });
  function setSize(next: number, nextHeight = measuredHeight) {
    measured = next;
    measuredHeight = nextHeight;
  }
  function resize(next: number, nextHeight = measuredHeight) {
    setSize(next, nextHeight);
    for (const notify of resizeListeners) notify([]);
  }
  return { run, factory, resize, setSize };
}
it('keeps the applied chart and its unsaved draft when the Parameters panel closes', async () => {
  const { factory } = riskRuntime();
  const a = await estimateHistorySource('A', marketSession());
  const linked = riskChart(capMap);
  installDashboard(riskDashboard([a, linked]));
  try {
    render(<LiveRiskChart/>);
    const plot = await screen.findByTestId('chart-plot');
    const question = vi.mocked(renderPlot).mock.lastCall![2];
    expect(screen.queryByRole('region', { name: 'Parameters' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Chart type' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Choose source' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show parameters' }));
    const parameters = screen.getByRole('region', { name: 'Parameters' });
    expect(within(parameters).getByRole('button', { name: 'Choose source' })).toHaveFocus();
    expect(within(parameters).getByLabelText('Chart type')).toHaveValue('market-map');
    const mode = within(parameters).getByLabelText('Completed session');
    await waitFor(() => expect(within(mode).getByRole('option', { name: '2026-11-13' })).toBeEnabled());
    fireEvent.change(mode, { target: { value: '2026-11-13' } });
    await waitFor(() => expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1].paramsOpen).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Hide parameters' }));
    expect(screen.queryByRole('region', { name: 'Parameters' })).toBeNull();
    expect(mode).not.toBeVisible();
    expect(screen.getByTestId('chart-plot')).toBe(plot);
    await waitFor(() => expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1]).not.toHaveProperty('paramsOpen'));
    fireEvent.click(screen.getByRole('button', { name: 'Card menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Parameters' }));
    expect(screen.getAllByRole('region', { name: 'Parameters' })).toEqual([parameters]);
    expect(within(parameters).getByLabelText('Completed session')).toBe(mode);
    expect(mode).toHaveValue('2026-11-13');
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1].linkedChart).toEqual(linked.linkedChart);
    expect(vi.mocked(renderPlot).mock.lastCall![2]).toBe(question);
    const apply = within(parameters).getByRole('button', { name: 'Apply chart settings' });
    await waitFor(() => expect(apply).toBeEnabled());
    const commit = useDashboardStore.getState().commitLinkedChartSettings;
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const queued = vi.spyOn(useDashboardStore.getState(), 'commitLinkedChartSettings').mockImplementationOnce(async (...args) => {
      await pending;
      return commit(...args);
    });
    try {
      fireEvent.click(apply);
      fireEvent.click(screen.getByRole('button', { name: 'Hide parameters' }));
      await act(async () => finish());
      expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1].linkedChart?.recipe)
        .toEqual({ ...capMap, session: '2026-11-13' });
      expect(screen.queryByRole('region', { name: 'Parameters' })).toBeNull();
    } finally { finish(); queued.mockRestore(); }
  } finally { factory.mockRestore(); }
});

it('keeps the measured source job and question when toggling Parameters', async () => {
  const { factory, run } = riskRuntime();
  const a = await estimateHistorySource('A', marketSession());
  installDashboard(riskDashboard([a, riskChart(capMap)]));
  try {
    render(<LiveRiskChart/>);
    const plot = await screen.findByTestId('chart-plot');
    const question = vi.mocked(renderPlot).mock.lastCall![2];
    const view = tableExecutionStore.readView('d', 'chart');
    const count = run.mock.calls.length;
    const read = vi.spyOn(tableExecutionStore.readExecutor('d', a.id)!, 'chartData');
    try {
      for (const open of [true, false, true]) {
        await act(async () => fireEvent.click(screen.getByRole('button', { name: open ? 'Show parameters' : 'Hide parameters' })));
        expect(screen.getByTestId('chart-plot')).toBe(plot);
        expect(tableExecutionStore.readView('d', 'chart').sourceRevision).toBe(view.sourceRevision);
      }
      expect(read).not.toHaveBeenCalled();
      expect(run).toHaveBeenCalledTimes(count);
      expect(vi.mocked(renderPlot).mock.lastCall![2]).toBe(question);
    } finally { read.mockRestore(); }
  } finally { factory.mockRestore(); }
});

it('retains the exact admitted chart while a changed Parameters viewport is checked', async () => {
  const { factory, run, resize } = riskRuntime();
  const a = await estimateHistorySource('A', marketSession());
  installDashboard(riskDashboard([a, riskChart(capMap)]));
  try {
    render(<LiveRiskChart/>);
    const draw = vi.mocked(renderPlot);
    const plot = await screen.findByTestId('chart-plot');
    const [node, figure, question] = draw.mock.lastCall!;
    const details = screen.getByText('Market map details', { exact: true }).closest('details');
    details!.open = true;
    let finish!: () => void;
    run.mockImplementationOnce(async (data, options, context) => {
      await new Promise<void>(resolve => { finish = resolve; });
      return runRecipe(data, options, context);
    });
    openParameters();
    act(() => resize(640, 320));
    await waitFor(() => expect(finish).toBeDefined());
    expect(screen.getByTestId('chart-plot')).toBe(plot);
    expect(screen.getByText('Market map details', { exact: true }).closest('details')).toBe(details);
    expect(details).toHaveAttribute('open');
    expect(draw.mock.lastCall).toEqual([node, figure, question]);
    act(() => resize(900, 430));
    expect(screen.getByTestId('chart-plot')).toBe(plot);
    expect(details).toHaveAttribute('open');
    await act(async () => finish());
    act(() => resize(640, 320));
    await waitFor(() => expect(draw.mock.lastCall?.[1].layout.width).toBe(640));
    expect(screen.getByTestId('chart-plot')).toBe(plot);
    expect(draw.mock.lastCall?.[1].layout).toMatchObject({ width: 640, height: 320 });
    expect(draw.mock.lastCall?.[2]).toBe(question);
    run.mockResolvedValueOnce({ ok: false, refused: true, message: 'The new geometry cannot be drawn.' });
    act(() => resize(620, 300));
    expect(await screen.findByText('The new geometry cannot be drawn.')).toBeVisible();
    expect(screen.queryByTestId('chart-plot')).toBeNull();
  } finally { factory.mockRestore(); }
});

it.each([{ viewer: true }, { locked: true }])('omits linked-chart editing and repair actions in %j mode', async mode => {
  const { factory } = riskRuntime();
  const a = await estimateHistorySource('A', marketSession());
  const linked = { ...riskChart(capMap), paramsOpen: true };
  installDashboard(riskDashboard([a, linked]));
  try {
    render(<><TableExecutionRuntime/><WidgetCard card={linked} onRemove={() => {}} {...mode}/></>);
    expect(await screen.findByTestId('chart-plot')).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Parameters' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Chart type' })).toBeNull();
    expect(screen.queryByRole('button', { name: /parameters|choose source/i })).toBeNull();
  } finally { factory.mockRestore(); }
});

function openParameters() {
  const show = screen.queryByRole('button', { name: 'Show parameters' });
  if (show) fireEvent.click(show);
  return within(screen.getByRole('region', { name: 'Parameters' }));
}

async function chooseRiskSource(id: string) {
  fireEvent.click(openParameters().getByRole('button', { name: 'Choose source' }));
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
    openParameters();
    expect(screen.getByLabelText('Chart type')).toHaveValue(recipe.kind);
    expect(screen.getByText(/^Source A ·/)).toBeVisible();
    let release!: () => void;
    run.mockImplementationOnce(async (dataset, options, context) => {
      const result = runRecipe(dataset, options, context);
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
    await waitFor(() => expect(plot.mock.lastCall?.[0]).toBe(second));
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
    tableExecutionStore.setBackendRows(tableExecutionStore.beginBackendRequest(activeId, root), snapshotFor(recipe, 'A'));
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
    tableExecutionStore.setBackendRows(tableExecutionStore.beginBackendRequest(activeId, source), snapshotFor(recipe, 'A', true));
    render(<LiveRiskChart/>);
    const problem = recipe.kind === 'etf-pareto' ? /inconsistent ETF fund identity/i : /currenc/i;
    await waitFor(() => expect(screen.getAllByText(problem, { selector: 'p' }).length).toBeGreaterThan(0));
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    expect(tableExecutionStore.readView(activeId, source.id).ready!.columns.map(c => c.id)).not.toContain(hidden);
    expect(run.mock.lastCall![0].rows.every(row => !(hidden in row.values))).toBe(true);
    await act(async () => {
      tableExecutionStore.setBackendRows(tableExecutionStore.beginBackendRequest(activeId, source), snapshotFor(recipe, 'A'));
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
    openParameters();
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
    openParameters();
    fireEvent.change(screen.getByLabelText('Exposure mode'), { target: { value: 'region' } });
    fireEvent.click(screen.getByRole('button', { name: /apply chart settings/i }));
    expect(await screen.findByText(/choose an ETF source with the requested exposure kind/i)).toBeVisible();
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    expect(snapshotReads()).toBe(before);
    expect(fetch).not.toHaveBeenCalled();
  } finally { reads.mockRestore(); factory.mockRestore(); }
});

it.each([...screeningRecipes, calendarOptions, returnOptions])('fences $kind on a failed source change and retains only same-source completed output', async recipe => {
  const { run, factory } = riskRuntime();
  const plot = vi.mocked(renderPlot);
  let rejectDraw!: (error: Error) => void;
  plot.mockReturnValueOnce(new Promise<void>((_, reject) => { rejectDraw = reject; }));
  const a = await acquiredSource(recipe, 'A'), b = await acquiredSource(recipe, 'B');
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
    if (recipe.kind === 'return-summary') expect(screen.getByText('Return listing details')).toBeVisible();
    else expect(first.style.height).toBe(recipe.kind === 'news-sentiment-calendar' ? '260px' : recipe.kind === 'income-sankey' ? figureA.layout.height + 'px' : '');
    if (recipe.kind === 'news-sentiment-calendar') expect(screen.getByText(/^AAPL.US · Delivered news sentiment ·/)).toBeVisible();
    else expect(screen.getByText(/^Source A ·/)).toBeVisible();
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
    if (recipe.kind !== 'news-sentiment-calendar') expect(screen.getByText(/^Source B ·/)).toBeVisible();
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
  const root = await acquiredSource(recipe, 'A');
  const chart = riskChart(recipe);
  const snapshot = acquiredSnapshot(recipe, 'A')!;
  await fs.writeFile('files/' + root.params.file, new TextEncoder().encode(JSON.stringify({
    ...snapshot, rows: snapshot.rows.map(row => ({ ...row, ...dividendRow })),
  })));
  installDashboard(riskDashboard([root, chart]));
  try {
    render(<LiveRiskChart/>);
    const plot = await screen.findByTestId('chart-plot');
    await waitFor(() => expect(vi.mocked(renderPlot).mock.lastCall?.[0]).toBe(plot));
    const revision = vi.mocked(renderPlot).mock.lastCall![2];
    openParameters();
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
  tableExecutionStore.setBackendRows(tableExecutionStore.beginBackendRequest('d', root), rows, { endpoint: url.pathname, parameters: Object.fromEntries(url.searchParams),
    retrievedAt: Date.parse(screenerEvidence.retrieved_at), financialEvidence: acquired?.evidence });
  try {
    render(<LiveRiskChart/>);
    const applied = await screen.findByTestId('chart-plot');
    const revision = tableExecutionStore.readView('d', 'chart').sourceRevision!;
    const executor = tableExecutionStore.readExecutor('d', 'A')!;
    const data = await executor.chartData(revision, ['last_day_data_date'], new AbortController().signal);
    expect(readFinancialEvidence(data.provenance)?.kind).toBe(acquiredKind);

    openParameters();
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
  const root = await acquiredSource(recipe, 'A');
  const chart = riskChart(recipe);
  installDashboard(riskDashboard([root, { ...chart, linkedChart: { type: 'column', display: 'grouped', measures: [] } }]));
  try {
    render(<LiveRiskChart/>);
    const read = await waitFor(() => {
      const executor = tableExecutionStore.readExecutor('d', 'A');
      expect(tableExecutionStore.readView('d', 'chart').status).toBe('ready');
      return vi.spyOn(executor!, 'chartData');
    });
    openParameters();
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
  const root = await acquiredSource(recipe, 'A');
  installDashboard(riskDashboard([root, riskChart(recipe)]));
  try {
    render(<LiveRiskChart/>);
    await screen.findByTestId('chart-plot');
    openParameters();
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
  const root = await acquiredSource(recipe, 'A');
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
  const root = await acquiredSource(recipe, 'A');
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
    openParameters();
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
  const root = await acquiredSource(screeningRecipes[1], 'A');
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
    openParameters();
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
  const root = await acquiredSource(screeningRecipes[1], 'A');
  const chart = { ...riskChart(screeningRecipes[1]), linkedChart: { type: 'column' as const, display: 'grouped' as const, measures: [] } };
  await fs.writeFile('files/' + root.params.file, new TextEncoder().encode(JSON.stringify({
    completeness: 'bounded', rows: [], chart_evidence: emptyDividendEvidence,
  })));
  installDashboard(riskDashboard([root, chart]));
  try {
    render(<LiveRiskChart/>);
    openParameters();
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
  const root = await acquiredSource(recipe, 'A');
  const snapshot = acquiredSnapshot(recipe, 'A')!;
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
    openParameters();
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
  const root = await acquiredSource(recipe, 'A');
  const snapshot = acquiredSnapshot(recipe, 'A')!;
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
    openParameters();
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
  const root = await acquiredSource(recipe, 'A');
  const snapshot = acquiredSnapshot(recipe, 'A')!;
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
    openParameters();
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

it('discovers a news calendar draft on a table of unverified article-shaped rows and preserves the applied columns', async () => {
  const { factory } = riskRuntime();
  const snapshot = newsSnapshot(true);
  const file = await saveLocalFile(new File([JSON.stringify(snapshot.rows)], 'unverified.json'));
  const root = { ...source, id: 'A', params: { file } };
  const chart = { ...riskChart(calendarOptions), linkedChart: {
    type: 'column' as const, category: 'url', display: 'grouped' as const, measures: ['polarity'],
  } };
  installDashboard(riskDashboard([root, chart]));
  try {
    render(<LiveRiskChart/>);
    const applied = await screen.findByTestId('chart-plot');
    openParameters();
    fireEvent.change(screen.getByLabelText('Chart type'), { target: { value: calendarOptions.kind } });
    await screen.findByRole('group', { name: 'News sentiment calendar settings' });
    expect(await screen.findByText(/acquire CompanyNews with verified article identity/i)).toBeVisible();
    expect(screen.getByRole('button', { name: /apply chart settings/i })).toBeDisabled();
    expect(screen.getByLabelText('Acquired instrument')).toHaveValue('');
    expect(screen.getByTestId('chart-plot')).toBe(applied);
  } finally { factory.mockRestore(); }
});

it('lets a newly linked chart use a verified columnless empty news acquisition', async () => {
  const { factory } = riskRuntime();
  const file = await saveLocalFile(new File([JSON.stringify(calendarSnapshot([], {
    scope: { kind: 'sample', start: null, end: null, limit: 50, offset: 0 },
  }))], 'empty-news.json'));
  const root = { ...source, id: 'A', params: { file } };
  const chart = { ...riskChart(calendarOptions), linkedChart: { type: 'column' as const, display: 'grouped' as const, measures: [] } };
  installDashboard(riskDashboard([root, chart]));
  try {
    render(<LiveRiskChart/>);
    openParameters();
    const type = screen.getByLabelText('Chart type');
    await waitFor(() => expect(within(type).getByRole('option', { name: 'News sentiment calendar' })).toBeEnabled());
    fireEvent.change(type, { target: { value: calendarOptions.kind } });
    const apply = screen.getByRole('button', { name: /apply chart settings/i });
    await waitFor(() => expect(apply).toBeEnabled());
    fireEvent.click(apply);
    expect(await screen.findByText('0 delivered articles · 0 scored in this calendar view.')).toBeVisible();
    expect(screen.queryByTestId('chart-plot')).toBeNull();
  } finally { factory.mockRestore(); }
});

it('clears a completed news chart immediately for an unsupported applied declaration', async () => {
  const { factory } = riskRuntime();
  const root = await acquiredSource(calendarOptions, 'A');
  const chart = riskChart(calendarOptions);
  installDashboard(riskDashboard([root, chart]));
  try {
    render(<LiveRiskChart/>);
    const plot = await screen.findByTestId('chart-plot');
    expect(screen.getByText('Calendar day details')).toBeVisible();
    const invalid = { ...calendarOptions, version: 2 } as unknown as RecipeOptions;
    act(() => installDashboard(riskDashboard([root, { ...chart, linkedChart: { ...chart.linkedChart!, recipe: invalid } }])));
    expect(plot).not.toBeInTheDocument();
    expect(screen.queryByText('Calendar day details')).toBeNull();
    expect(screen.getAllByText(/version 1 recipe options/i).length).toBeGreaterThan(0);
  } finally { factory.mockRestore(); }
});

it.each(['options', 'source revision', 'width'] as const)('fences an obsolete news draft check after changing %s', async change => {
  const { run, factory, resize } = riskRuntime();
  const root = await acquiredSource(calendarOptions, 'A');
  const linkedChart = { type: 'column' as const, category: 'url', measures: ['polarity'], display: 'grouped' as const };
  installDashboard(riskDashboard([root, { ...riskChart(calendarOptions), linkedChart }]));
  const requests: { width?: number; signal: AbortSignal; resolve: () => void }[] = [];
  run.mockImplementation(async (dataset, options, context, signal) => {
    const result = runRecipe(dataset, options, context);
    await new Promise<void>(resolve => requests.push({ width: context.viewportWidth, signal, resolve }));
    return result;
  });
  try {
    render(<LiveRiskChart/>);
    const applied = await screen.findByTestId('chart-plot');
    openParameters();
    fireEvent.change(screen.getByLabelText('Chart type'), { target: { value: calendarOptions.kind } });
    const apply = screen.getByRole('button', { name: /apply chart settings/i });
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(apply).toBeDisabled();
    expect(apply).toHaveAttribute('aria-busy', 'true');

    if (change === 'options') fireEvent.change(screen.getByLabelText('Calendar window'), { target: { value: 'pinned' } });
    else if (change === 'width') act(() => resize(320));
    else await act(async () => {
      tableExecutionStore.updateDefinition('d', root.id, { table: {}, search: 'first' }, { kind: 'none' });
      await tableExecutionStore.settled('d');
    });
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests.map(request => request.width)).toEqual([900, change === 'width' ? 320 : 900]);
    expect(requests[0].signal.aborted).toBe(true);
    await act(async () => requests[0].resolve());
    expect(apply).toBeDisabled();
    expect(screen.getByTestId('chart-plot')).toBe(applied);
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1].linkedChart).toEqual(linkedChart);

    await act(async () => requests[1].resolve());
    expect(apply).toBeEnabled();
    expect(apply).not.toHaveAttribute('aria-busy');
  } finally { factory.mockRestore(); }
});


function returnSnapshot(id: string) {
  return {
    completeness: 'bounded', receipt: { interval: '1d', start_date: '2026-01-01', end_date: '2026-01-09' },
    rows: dailyPriceRows(id === 'A' ? [16, 4, 1, 1, 1, 1, 1, 1, 1] : [4, 2, 1, 1, 1, 1, 1, 1, 1])
      .map(row => ({ ...row, symbol: 'A.US' })),
  };
}

it('discovers a Return summaries draft and requires a documented acquisition before applying', async () => {
  const { factory } = riskRuntime();
  try {
    const { rows } = returnSnapshot('A');
    const file = await saveLocalFile(new File([JSON.stringify(rows)], 'undocumented.json'));
    const root = { ...source, id: 'A', params: { file } };
    const linkedChart = { type: 'column' as const, category: 'date', measures: ['adjusted_close'], display: 'grouped' as const };
    installDashboard(riskDashboard([root, { ...riskChart(returnOptions), linkedChart }]));
    render(<LiveRiskChart/>);
    const displayed = await screen.findByTestId('chart-plot');
    openParameters();
    expect(screen.getByRole('option', { name: 'Return summaries' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Chart type'), { target: { value: 'return-summary' } });
    expect(screen.getByLabelText('Return view')).toHaveValue('box');
    expect(await screen.findByText(/local adjusted-price snapshot with an acquisition receipt/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Apply chart settings' })).toBeDisabled();
    expect(screen.getByTestId('chart-plot')).toBe(displayed);
  } finally { factory.mockRestore(); }
});

it.each(['options', 'source revision', 'height'] as const)('fences an obsolete return draft check after changing %s', async change => {
  const { run, factory, resize } = riskRuntime();
  const file = await saveLocalFile(new File([JSON.stringify(returnSnapshot('A'))], 'snapshot.json'));
  const root = { ...source, id: 'A', params: { file } };
  const linkedChart = { type: 'column' as const, category: 'date', measures: ['adjusted_close'], display: 'grouped' as const };
  installDashboard(riskDashboard([root, { ...riskChart(returnOptions), linkedChart }]));
  const requests: { size: (number | undefined)[]; signal: AbortSignal; release: () => void }[] = [];
  run.mockImplementation(async (dataset, options, context, signal) => {
    const result = runRecipe(dataset, options, context);
    await new Promise<void>(release => requests.push({ size: [context.viewportWidth, context.viewportHeight], signal, release }));
    return result;
  });
  try {
    render(<LiveRiskChart/>);
    const displayed = await screen.findByTestId('chart-plot');
    openParameters();
    fireEvent.change(screen.getByLabelText('Chart type'), { target: { value: 'return-summary' } });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'A.US' }));
    const apply = screen.getByRole('button', { name: 'Apply chart settings' });
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(apply).toBeDisabled();
    expect(apply).toHaveAttribute('aria-busy', 'true');

    if (change === 'options') fireEvent.change(screen.getByLabelText('Return view'), { target: { value: 'violin' } });
    if (change === 'height') act(() => resize(900, 330));
    if (change === 'source revision') await act(async () => {
      tableExecutionStore.updateDefinition('d', root.id, { table: { hidden: ['memo'] }, search: '' }, { kind: 'none' });
      await tableExecutionStore.settled('d');
    });
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[0].size).toEqual([900, 430]);
    expect(requests[1].size).toEqual([900, change === 'height' ? 330 : 430]);
    expect(requests[0].signal.aborted).toBe(true);
    await act(async () => requests[0].release());
    expect(apply).toBeDisabled();
    expect(screen.getByTestId('chart-plot')).toBe(displayed);
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1].linkedChart).toEqual(linkedChart);
    await act(async () => requests[1].release());
    expect(apply).toBeEnabled();
  } finally { factory.mockRestore(); }
});

it('keeps applied return details through a refused pinned draft and clears invalid applied options', async () => {
  const { factory } = riskRuntime();
  const file = await saveLocalFile(new File([JSON.stringify(returnSnapshot('A'))], 'snapshot.json'));
  const root = { ...source, id: 'A', params: { file } };
  const chart = riskChart(returnOptions);
  installDashboard(riskDashboard([root, chart]));
  try {
    render(<LiveRiskChart/>);
    const displayed = await screen.findByTestId('chart-plot');
    const detail = screen.getByText('Return listing details', { exact: true });
    openParameters();
    fireEvent.change(screen.getByLabelText('Return window'), { target: { value: 'common' } });
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-01-06' } });
    expect(await screen.findByText(/at least 5 finite daily returns.*A\.US/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Apply chart settings' })).toBeDisabled();
    expect(screen.getByTestId('chart-plot')).toBe(displayed);
    expect(detail).toBeVisible();
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1].linkedChart?.recipe).toEqual(returnOptions);
    const invalid = { ...returnOptions, viewportHeight: 900 };
    act(() => installDashboard(riskDashboard([root, { ...chart, linkedChart: { ...chart.linkedChart!, recipe: invalid } }])));
    expect(displayed).not.toBeInTheDocument();
    expect(detail).not.toBeInTheDocument();
    expect(screen.getByText(/unsupported recipe option "viewportHeight"/i)).toBeVisible();
  } finally { factory.mockRestore(); }
});


it('requires exact worker admission when Apply sees a newly oversized return draft surface', async () => {
  const { run, factory, resize, setSize } = riskRuntime();
  const root = await acquiredSource(returnOptions, 'A');
  const linkedChart = { type: 'column' as const, category: 'date', measures: ['adjusted_close'], display: 'grouped' as const };
  installDashboard(riskDashboard([root, { ...riskChart(returnOptions), linkedChart }]));
  setSize(10_000);
  try {
    render(<LiveRiskChart/>);
    const displayed = await screen.findByTestId('chart-plot');
    openParameters();
    fireEvent.change(screen.getByLabelText('Chart type'), { target: { value: 'return-summary' } });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'A.US' }));
    const apply = screen.getByRole('button', { name: 'Apply chart settings' });
    await waitFor(() => expect(apply).toBeEnabled());

    // The click precedes the observer's next notification.
    setSize(10_000.5);
    fireEvent.click(apply);
    expect(apply).toBeDisabled();
    expect(await screen.findByText(/viewport width greater than 0 and at most 10,000/)).toBeVisible();
    act(() => resize(10_010));
    await waitFor(() => expect(run.mock.lastCall?.[2].viewportWidth).toBe(10_010));
    expect(apply).toBeDisabled();
    expect(screen.getByTestId('chart-plot')).toBe(displayed);
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1].linkedChart).toEqual(linkedChart);

    act(() => resize(999));
    await waitFor(() => expect(apply).toBeEnabled());
    expect(run.mock.calls.map(([, , { viewportWidth }]) => viewportWidth)).toEqual([10_000, 10_000.5, 10_010, 999]);
  } finally { factory.mockRestore(); }
});

it('refuses an oversized applied return height and recovers with the same question', async () => {
  const { run, factory, resize } = riskRuntime();
  const root = await acquiredSource(returnOptions, 'A');
  installDashboard(riskDashboard([root, riskChart(returnOptions)]));
  try {
    render(<LiveRiskChart/>);
    await screen.findByTestId('chart-plot');
    const revision = vi.mocked(renderPlot).mock.lastCall?.[2];
    expect(revision).toBeDefined();

    act(() => resize(900, 10_001));
    const viewportError = /viewport height greater than 0 and at most 10,000/;
    await waitFor(() => expect(screen.getAllByText(viewportError)).toHaveLength(2));
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => resize(900, 10_002));
    await waitFor(() => expect(run.mock.calls.filter(([, , { viewportHeight }]) => viewportHeight === 10_002)).toHaveLength(2));
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1].linkedChart?.recipe).toEqual(returnOptions);

    act(() => resize(900, 480));
    await screen.findByTestId('chart-plot');
    expect(vi.mocked(renderPlot).mock.lastCall?.[2]).toBe(revision);
  } finally { factory.mockRestore(); }
});

it('discovers ownership draft settings but ordinary data cannot enable Apply or waffle', async () => {
  const { factory } = riskRuntime();
  const file = await saveLocalFile(new File([JSON.stringify(liveOwnershipRows)], 'ordinary.json'));
  const root = { ...source, id: 'A', params: { file } };
  const linkedChart = { type: 'column' as const, category: 'symbol', measures: ['percent_insiders'], display: 'grouped' as const };
  installDashboard(riskDashboard([root, { ...riskChart(ownershipOptions), linkedChart }]));
  try {
    render(<LiveRiskChart/>);
    const applied = await screen.findByTestId('chart-plot');
    openParameters();
    expect(screen.getByRole('option', { name: 'Ownership snapshot' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Chart type'), { target: { value: 'ownership-snapshot' } });
    expect(screen.getByLabelText('Ownership view')).toHaveValue('bars');
    expect(screen.getByRole('option', { name: 'Waffle' })).toBeDisabled();
    expect(await screen.findByText(/acquire an ownership snapshot with verified field and issuer evidence/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Apply chart settings' })).toBeDisabled();
    expect(screen.getByTestId('chart-plot')).toBe(applied);
  } finally { factory.mockRestore(); }
});

it.each(['field', 'output', 'height'] as const)('admits only the exact ownership draft after a change to %s', async change => {
  const { run, factory, resize, setSize } = riskRuntime();
  const root = await acquiredSource(ownershipOptions, 'A');
  const linkedChart = { type: 'column' as const, category: 'symbol', measures: ['percent_insiders'], display: 'grouped' as const };
  installDashboard(riskDashboard([root, { ...riskChart(ownershipOptions), linkedChart }]));
  const requests: { context: Parameters<typeof run>[2]; signal: AbortSignal; release: () => void }[] = [];
  run.mockImplementation(async (dataset, options, context, signal) => {
    const result = runRecipe(dataset, options, context);
    await new Promise<void>(release => requests.push({ context, signal, release }));
    return result;
  });
  try {
    render(<LiveRiskChart/>);
    const displayed = await screen.findByTestId('chart-plot');
    openParameters();
    fireEvent.change(screen.getByLabelText('Chart type'), { target: { value: 'ownership-snapshot' } });
    const apply = screen.getByRole('button', { name: 'Apply chart settings' });
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(apply).toBeDisabled();
    expect(apply).toHaveAttribute('aria-busy', 'true');
    if (change === 'field') fireEvent.change(screen.getByLabelText('Insider ownership'), { target: { value: '' } });
    if (change === 'height') act(() => resize(900, 330));
    if (change === 'output') await act(async () => {
      tableExecutionStore.updateDefinition('d', root.id, { table: { hidden: ['date'] }, search: '' }, { kind: 'none' });
      await tableExecutionStore.settled('d');
    });
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests.map(({ context }) => [context.viewportWidth, context.viewportHeight]))
      .toEqual([[900, 430], [900, change === 'height' ? 330 : 430]]);
    expect(requests[0].signal.aborted).toBe(true);
    await act(async () => requests[0].release());
    expect(apply).toBeDisabled();
    expect(screen.getByTestId('chart-plot')).toBe(displayed);
    await act(async () => requests[1].release());
    expect(apply).toBeEnabled();

    setSize(10_000.5, 430);
    fireEvent.click(apply);
    expect(apply).toBeDisabled();
    await waitFor(() => expect(requests).toHaveLength(3));
    expect(requests[2].context.viewportWidth).toBe(10_000.5);
    await act(async () => requests[2].release());
    expect(await screen.findByText(/viewport width greater than 0 and at most 10,000/)).toBeVisible();
    expect(screen.getByTestId('chart-plot')).toBe(displayed);
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1].linkedChart).toEqual(linkedChart);
  } finally { requests.forEach(request => request.release()); factory.mockRestore(); }
});

it('clears invalid applied ownership settings and repairs an unavailable saved issuer only explicitly', async () => {
  const { factory, resize } = riskRuntime();
  const root = await acquiredSource(ownershipOptions, 'A');
  const chart = riskChart(ownershipOptions);
  const plot = vi.mocked(renderPlot);
  installDashboard(riskDashboard([root, chart]));
  try {
    render(<LiveRiskChart/>);
    const displayed = await screen.findByTestId('chart-plot');
    expect(screen.getByText('Ownership snapshot details')).toBeVisible();
    const revision = plot.mock.lastCall?.[2];
    act(() => resize(900, 350));
    await waitFor(() => expect(plot.mock.calls.filter(([node]) => node === displayed)).toHaveLength(2));
    expect(plot.mock.lastCall?.[2]).toBe(revision);
    expect(screen.getByTestId('chart-plot')).toBe(displayed);

    const invalid = { ...ownershipOptions, resolvedAsOf: '2026-11-19' };
    act(() => installDashboard(riskDashboard([root, { ...chart, linkedChart: { ...chart.linkedChart!, recipe: invalid } }])));
    expect(displayed).not.toBeInTheDocument();
    expect(screen.queryByText('Ownership snapshot details')).not.toBeInTheDocument();
    expect(screen.getByText(/unsupported recipe option "resolvedAsOf"/)).toBeVisible();

    const pinned = { ...ownershipOptions, issuer: 'MSFT.US' };
    act(() => installDashboard(riskDashboard([root, { ...chart, linkedChart: { ...chart.linkedChart!, recipe: pinned } }])));
    expect(await screen.findByText(/selected issuer.*unavailable|acquired issuer AAPL\.US/i, { selector: '.linked-chart-status p' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Open Parameters' }));
    const issuer = screen.getByLabelText('Acquired issuer');
    await waitFor(() => expect(issuer).toHaveValue('MSFT.US'));
    expect(await screen.findByRole('option', { name: 'MSFT.US (unavailable)' })).toBeDisabled();
    const apply = screen.getByRole('button', { name: 'Apply chart settings' });
    expect(apply).toBeDisabled();
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    fireEvent.change(issuer, { target: { value: 'AAPL.US' } });
    await waitFor(() => expect(apply).toBeEnabled());
    fireEvent.click(apply);
    await screen.findByTestId('chart-plot');
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1].linkedChart?.recipe).toEqual(ownershipOptions);
  } finally { factory.mockRestore(); }
});

it('fences ownership worker and draw errors across a relink and retains a same-source stale result', async () => {
  const { run, factory } = riskRuntime();
  const a = await acquiredSource(ownershipOptions, 'A'), b = await acquiredSource(ownershipOptions, 'B');
  installDashboard(riskDashboard([a, b, riskChart(ownershipOptions)]));
  const readFile = fs.readFile;
  let rejectB!: (error: Error) => void;
  const held = new Promise<Uint8Array<ArrayBuffer>>((_, reject) => { rejectB = reject; });
  const read = vi.spyOn(fs, 'readFile').mockImplementation((path, opts) => path === 'files/' + b.params.file ? held : readFile(path, opts));
  const plot = vi.mocked(renderPlot);
  let oldDraw!: (error: Error) => void;
  plot.mockImplementationOnce(async () => new Promise<void>((_, reject) => { oldDraw = reject; }));
  try {
    render(<LiveRiskChart/>);
    const first = await screen.findByTestId('chart-plot');
    expect(await screen.findByText('Ownership snapshot details')).toBeVisible();
    let finishA!: () => void;
    let signalA: AbortSignal | undefined;
    run.mockImplementation(async (data, options, context, signal) => {
      const result = runRecipe(data, options, context);
      if (data.provenance.sourceWidgetId === 'A') {
        signalA = signal;
        await new Promise<void>(resolve => { finishA = resolve; });
      }
      return result;
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(finishA).toBeDefined());
    await chooseRiskSource('B');
    expect(await screen.findByText('Loading source B…')).toBeVisible();
    expect(first).not.toBeInTheDocument();
    expect(signalA?.aborted).toBe(true);
    expect(screen.queryByText('Ownership snapshot details')).not.toBeInTheDocument();
    await act(async () => { rejectB(new Error('File read failed')); await tableExecutionStore.settled('d'); });
    const diagnostic = 'Source B: File read failed';
    expect(screen.getAllByRole('alert').map(node => node.textContent)).toEqual([diagnostic]);
    expect(screen.queryByTestId('chart-plot')).toBeNull();

    read.mockImplementation(readFile);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    const second = await screen.findByTestId('chart-plot');
    expect(await screen.findByText('Ownership snapshot details')).toBeVisible();
    const calls = plot.mock.calls.length;
    await act(async () => { finishA(); oldDraw(new Error('Obsolete draw')); });
    expect(plot).toHaveBeenCalledTimes(calls);
    expect(screen.queryByRole('alert')).toBeNull();

    read.mockImplementation((path, opts) => path === 'files/' + b.params.file ? Promise.reject(new Error('File read failed')) : readFile(path, opts));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByText('Showing completed data (stale).');
    expect(screen.getAllByText(/showing completed data \(stale\)/i)).toHaveLength(1);
    expect(screen.getAllByRole('alert').map(node => node.textContent)).toEqual([diagnostic]);
    expect(screen.getByTestId('chart-plot')).toBe(second);

    read.mockImplementation(readFile);
    plot.mockRejectedValueOnce(new Error('Current ownership draw failed'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Chart could not be drawn. Current ownership draw failed');
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    expect(screen.getByText('Ownership snapshot details')).toBeVisible();
  } finally { read.mockRestore(); factory.mockRestore(); }
});

it('creates a native linked metric widget with no inferred KPI question', async () => {
  render(<WidgetCard card={source} onRemove={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Card menu' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Create linked metric' }));
  await waitFor(() => expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1]).toMatchObject({
    widgetId: 'linked_metric', linkedSource: { kind: 'widget', sourceWidgetId: 's' },
  }));
  const metric = useDashboardStore.getState().dashboards[0].tabs[0].cards[1];
  expect(metric).not.toHaveProperty('linkedMetric');
  expect(useWidgetRegistryStore.getState().find('builtin', 'linked_metric')?.type).toBe('metric');
  expect(metric).not.toHaveProperty('linkedChart');
});

const focusedKpi: LinkedKpiOptions = {
  version: 1, metric: 'eps_ttm', valueField: 'eps_ttm', observation: { mode: 'latest' },
  view: 'gauge', range: { min: -100, max: 100, label: 'Planning range' },
};
function LiveKpi() {
  const current = useDashboardStore(s => s.dashboards[0].tabs[0].cards.find(c => c.widgetId === 'linked_metric')!);
  return <><TableExecutionRuntime /><WidgetCard card={current} onRemove={() => {}} /></>;
}
async function localKpiSource(id: string, amount: number) {
  const content = { rows: [{ ...metricRows[0], eps_ttm: amount }, metricRows[1]], completeness: 'complete',
    chart_sources: { version: 1, receipts: [metricReceipt] } };
  const file = await saveLocalFile(new File([JSON.stringify(content)], id + '.json'));
  return card({ id, widgetId: 'local_table', backendId: 'builtin', params: { file } });
}
function mockKpiWorker() {
  vi.stubGlobal('Worker', Boundary);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  return vi.spyOn(kpiWorkers, 'createKpiWorker').mockImplementation(() => ({
    run: vi.fn(async (data, options) => buildKpiSnapshot(data, options)), dispose() {},
  }));
}
function kpiCard(linkedMetric = focusedKpi) {
  return { ...card({ id: 'kpi', widgetId: 'linked_metric', backendId: 'builtin',
    linkedSource: { kind: 'widget', sourceWidgetId: 'A' } }), linkedMetric };
}

it('shows missing evidence in a new linked KPI body while Parameters is closed', async () => {
  const factory = mockKpiWorker();
  const file = await saveLocalFile(new File([JSON.stringify([{ eps_ttm: 11 }])], 'ordinary.json'));
  const local = { ...source, id: 'A', params: { file } };
  installDashboard(riskDashboard([local, { ...kpiCard(), linkedMetric: undefined }]));
  try {
    const { container } = render(<LiveKpi/>);
    const body = within(container.querySelector('.card-body')!);
    expect(await body.findByText(/acquire a source with verified KPI observation evidence/i)).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Parameters' })).toBeNull();
    fireEvent.click(body.getByRole('button', { name: 'Open Parameters' }));
    expect(openParameters().getByRole('button', { name: 'Apply KPI settings' })).toBeDisabled();
  } finally { factory.mockRestore(); }
});

it('clears linked KPI settings with an unsupported applied version and never renders their value', async () => {
  const factory = mockKpiWorker();
  const a = await localKpiSource('A', 18.125);
  const linked = kpiCard();
  installDashboard(riskDashboard([a, linked]));
  try {
    render(<LiveKpi/>);
    await screen.findByText('18.125 USD per share');
    act(() => installDashboard(riskDashboard([a, { ...linked, linkedMetric: { ...focusedKpi, version: 2 } as unknown as LinkedKpiOptions }])));
    expect(await screen.findByRole('alert')).toHaveTextContent(/version 1 linked KPI/i);
    expect(screen.queryByText('18.125 USD per share')).toBeNull();
    expect(screen.queryByTestId('chart-plot')).toBeNull();
  } finally { factory.mockRestore(); }
});

it('clears KPI output on A to B pending and failure, fences obsolete worker and draw errors, and retains same-source stale output', async () => {
  const factory = mockKpiWorker();
  const a = await localKpiSource('A', 18.125), b = await localKpiSource('B', 33.25);
  const plot = vi.mocked(renderPlot);
  let rejectDraw!: (e: Error) => void;
  plot.mockReturnValueOnce(new Promise<void>((_, reject) => { rejectDraw = reject; }));
  installDashboard(riskDashboard([a, b, kpiCard()]));
  const readFile = fs.readFile;
  let rejectB!: (e: Error) => void;
  const held = new Promise<Uint8Array<ArrayBuffer>>((_, reject) => { rejectB = reject; });
  const read = vi.spyOn(fs, 'readFile').mockImplementation((path, opts) => path === 'files/' + b.params.file ? held : readFile(path, opts));
  try {
    render(<LiveKpi/>);
    const first = await screen.findByTestId('chart-plot');
    await screen.findByText('18.125 USD per share');
    await waitFor(() => expect(plot.mock.lastCall?.[0]).toBe(first));
    const appliedWorker = factory.mock.results.find(result => vi.mocked(result.value.run).mock.calls.length)?.value;
    let rejectWorker!: (e: Error) => void;
    vi.mocked(appliedWorker.run).mockImplementationOnce(async () => new Promise((_, reject) => { rejectWorker = reject; }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(rejectWorker).toBeDefined());
    await chooseRiskSource('B');
    expect(await screen.findByText('Loading source B…')).toBeVisible();
    expect(screen.queryByText('Showing completed data (stale).')).toBeNull();
    expect(screen.queryByText('18.125 USD per share')).toBeNull();
    expect(first).not.toBeInTheDocument();
    await act(async () => { rejectB(new Error('File read failed')); await tableExecutionStore.settled('d'); });
    expect(screen.getAllByRole('alert').map(el => el.textContent)).toEqual(['Source B: File read failed']);
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    read.mockImplementation(readFile);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByText('33.25 USD per share');
    const second = await screen.findByTestId('chart-plot');
    await act(async () => {
      rejectDraw(new Error('Obsolete Plotly draw'));
      rejectWorker(new Error('Obsolete KPI calculation'));
    });
    expect(screen.queryByRole('alert')).toBeNull();
    read.mockImplementation((path, opts) => path === 'files/' + b.params.file ? Promise.reject(new Error('File read failed')) : readFile(path, opts));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByText('Showing completed data (stale).');
    expect(screen.getAllByRole('alert').map(el => el.textContent)).toEqual(['Source B: File read failed']);
    expect(screen.getByTestId('chart-plot')).toBe(second);
    expect(screen.getByText('33.25 USD per share')).toBeVisible();
  } finally { read.mockRestore(); factory.mockRestore(); }
});

it('announces a current KPI draw failure locally while retaining the exact value', async () => {
  const factory = mockKpiWorker();
  const a = await localKpiSource('A', -9.125);
  vi.mocked(renderPlot).mockRejectedValueOnce(new Error('Indicator failed'));
  installDashboard(riskDashboard([a, kpiCard()]));
  try {
    render(<LiveKpi/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Chart could not be drawn. Indicator failed');
    expect(screen.getByText('-9.125 USD per share')).toBeVisible();
  } finally { factory.mockRestore(); }
});

it('clears the prior gauge while a ready revision checks a filtered latest KPI and leaves the earlier observation for repair', async () => {
  const factory = mockKpiWorker();
  const a = await localKpiSource('A', 0);
  installDashboard(riskDashboard([a, kpiCard()]));
  try {
    render(<LiveKpi/>);
    expect(await screen.findByText('0 USD per share', { selector: '.metric-value' })).toBeVisible();
    await screen.findByTestId('chart-plot');
    const worker: ReturnType<typeof kpiWorkers.createKpiWorker> = factory.mock.results.find(result => vi.mocked(result.value.run).mock.calls.length)!.value;
    let release!: () => void;
    vi.mocked(worker.run).mockImplementationOnce(async (dataset, options) => {
      const result = buildKpiSnapshot(dataset, options);
      await new Promise<void>(done => { release = done; });
      return result;
    });
    await act(async () => {
      tableExecutionStore.updateDefinition('d', 'A', { table: {}, search: 'first-report' }, { kind: 'none' });
      await tableExecutionStore.settled('d');
    });
    await waitFor(() => expect(release).toBeDefined());
    expect(tableExecutionStore.readView('d', 'kpi')).toMatchObject({ status: 'ready', stale: false });
    const heldOutput = {
      value: screen.queryByText('0 USD per share', { selector: '.metric-value' })?.textContent,
      gauge: !!screen.queryByTestId('chart-plot'),
      status: screen.queryByText('Calculating linked KPI…')?.textContent,
    };
    await act(async () => release());
    expect(heldOutput).toEqual({ value: undefined, gauge: false, status: 'Calculating linked KPI…' });
    expect(await screen.findByRole('alert')).toHaveTextContent(/latest KPI observation is unavailable in the source presentation/i);
    expect(screen.queryByText('76.544 USD per share', { selector: '.metric-value' })).toBeNull();
    openParameters();
    expect(screen.getByLabelText('Observation', { exact: true })).toHaveValue('@latest');
    fireEvent.change(screen.getByLabelText('Observation', { exact: true }), { target: { value: 'first-report' } });
    fireEvent.change(screen.getByLabelText('KPI view', { exact: true }), { target: { value: 'card' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply KPI settings' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Apply KPI settings' }));
    expect(await screen.findByText('76.544 USD per share', { selector: '.metric-value' })).toBeVisible();
  } finally { factory.mockRestore(); }
});

it.each(['relink', 'same-ID File replacement'] as const)('clears the KPI on %s, then retains a same-acquisition refresh', async change => {
  const factory = mockKpiWorker();
  const a = await localKpiSource('A', 18.125), b = await localKpiSource(change === 'relink' ? 'B' : 'A', 33.25);
  const table = card({ id: 'T', widgetId: 'linked_table', backendId: 'builtin', linkedSource: { kind: 'widget', sourceWidgetId: 'A' } });
  const metric = { ...kpiCard(), linkedSource: { kind: 'widget' as const, sourceWidgetId: table.id } };
  installDashboard(riskDashboard(change === 'relink' ? [a, b, table, metric] : [a, table, metric]));
  const originalSync = tableExecutionStore.syncDashboard;
  const sync = vi.spyOn(tableExecutionStore, 'syncDashboard');
  const readFile = fs.readFile;
  let rejectB!: (error: Error) => void;
  const held = new Promise<Uint8Array<ArrayBuffer>>((_, reject) => { rejectB = reject; });
  const pathB = 'files/' + b.params.file;
  const read = vi.spyOn(fs, 'readFile').mockImplementation((path, options) => path === pathB ? held : readFile(path, options));
  const oldPresentation = () => ({
    value: screen.queryByText('18.125 USD per share', { selector: '.metric-value' })?.textContent,
    gauge: !!screen.queryByTestId('chart-plot'),
    stale: !!screen.queryByText('Showing completed data (stale).'),
  });
  const cleared = { value: undefined, gauge: false, stale: false };
  try {
    render(<LiveKpi/>);
    await screen.findByText('18.125 USD per share');
    await screen.findByTestId('chart-plot');
    if (change === 'relink') {
      await act(async () => { expect(await useDashboardStore.getState().replaceLinkedSource('T', 'B')).toBe(true); });
    } else {
      sync.mockImplementation(() => {});
      act(() => installDashboard(riskDashboard([b, table, metric])));
      expect(oldPresentation()).toEqual(cleared);
      sync.mockImplementation(originalSync);
      act(() => tableExecutionStore.syncDashboard(useDashboardStore.getState().dashboards[0]));
    }
    await waitFor(() => expect(read.mock.calls.some(([path]) => path === pathB)).toBe(true));
    expect(tableExecutionStore.readView('d', 'kpi').status).toBe('updating');
    const pending = oldPresentation();
    await act(async () => { rejectB(new Error('File read failed')); await tableExecutionStore.settled('d'); });
    expect(screen.getAllByRole('alert').map(el => el.textContent)).toEqual([`Source T: Source ${b.id}: File read failed`]);
    expect({ pending, failed: oldPresentation() }).toEqual({ pending: cleared, failed: cleared });

    read.mockImplementation(readFile);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('33.25 USD per share')).toBeVisible();
    const gauge = await screen.findByTestId('chart-plot');
    let rejectRefresh!: (error: Error) => void;
    const refresh = new Promise<Uint8Array<ArrayBuffer>>((_, reject) => { rejectRefresh = reject; });
    read.mockImplementation((path, options) => path === pathB ? refresh : readFile(path, options));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Showing completed data (stale).')).toBeVisible();
    expect(screen.getByTestId('chart-plot')).toBe(gauge);
    expect(screen.getByText('33.25 USD per share', { selector: '.metric-value' })).toBeVisible();
    await act(async () => { rejectRefresh(new Error('Refresh failed')); await tableExecutionStore.settled('d'); });
    expect(screen.getAllByRole('alert').map(el => el.textContent)).toEqual([`Source T: Source ${b.id}: Refresh failed`]);
    expect(screen.getByText('Showing completed data (stale).')).toBeVisible();
    expect(screen.getByTestId('chart-plot')).toBe(gauge);
    expect(screen.getByText('33.25 USD per share', { selector: '.metric-value' })).toBeVisible();
  } finally { read.mockRestore(); sync.mockRestore(); factory.mockRestore(); }
});

it('reports a current KPI worker failure locally and clears its previously completed presentation', async () => {
  const factory = mockKpiWorker();
  const a = await localKpiSource('A', 18);
  installDashboard(riskDashboard([a, kpiCard()]));
  try {
    render(<LiveKpi/>);
    await screen.findByTestId('chart-plot');
    const worker = factory.mock.results.find(result => vi.mocked(result.value.run).mock.calls.length)!.value;
    vi.mocked(worker.run).mockRejectedValueOnce(new Error('KPI worker delivery failed'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not calculate the linked KPI. KPI worker delivery failed');
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    expect(screen.queryByText('18 USD per share')).toBeNull();
    const readFile = fs.readFile;
    const read = vi.spyOn(fs, 'readFile').mockImplementation((path, options) => path === 'files/' + a.params.file
      ? Promise.reject(new Error('Current source failed')) : readFile(path, options));
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Source A: Current source failed');
      expect(screen.queryByText('Showing completed data (stale).')).toBeNull();
    } finally { read.mockRestore(); }
  } finally { factory.mockRestore(); }
});

it('fences KPI drafts across option, geometry and source revision changes before Apply', async () => {
  const { factory: recipeFactory, resize, setSize } = riskRuntime();
  resize(400, 164);
  const run = vi.fn<ReturnType<typeof kpiWorkers.createKpiWorker>['run']>();
  const factory = vi.spyOn(kpiWorkers, 'createKpiWorker').mockReturnValue({ run, dispose() {} });
  const requests: { max: number; signal: AbortSignal; release: () => void }[] = [];
  run.mockImplementation(async (data, options, signal) => {
    const result = buildKpiSnapshot(data, options);
    if (options.range?.max !== 100) await new Promise<void>(release => requests.push({ max: options.range!.max, signal, release }));
    return result;
  });
  const a = await localKpiSource('A', 18);
  installDashboard(riskDashboard([a, kpiCard()]));
  try {
    render(<LiveKpi/>);
    const displayed = await screen.findByTestId('chart-plot');
    openParameters();
    const rangeMax = screen.getByLabelText('Range maximum');
    const apply = screen.getByRole('button', { name: 'Apply KPI settings' });
    fireEvent.change(rangeMax, { target: { value: '110' } });
    await waitFor(() => expect(requests).toHaveLength(1));
    fireEvent.change(rangeMax, { target: { value: '120' } });
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[0].signal.aborted).toBe(true);
    await act(async () => requests[0].release());
    expect(apply).toBeDisabled();
    expect(screen.getByTestId('chart-plot')).toBe(displayed);
    await act(async () => requests[1].release());
    expect(apply).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Hide parameters' }));
    setSize(0, 0);
    expect(apply).not.toBeVisible();
    expect(screen.getByTestId('chart-plot')).toBe(displayed);
    openParameters();
    expect(screen.getByLabelText('Range maximum')).toBe(rangeMax);
    expect(rangeMax).toHaveValue(120);
    fireEvent.click(apply);
    expect(await screen.findByRole('alert')).toHaveTextContent(/source or drawing size changed/i);
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1].linkedMetric).toEqual(focusedKpi);
    act(() => resize(296, 164));
    await waitFor(() => expect(requests).toHaveLength(3));
    await act(async () => {
      tableExecutionStore.updateDefinition('d', a.id, { table: { sorting: [{ id: 'eps_ttm', desc: true }] }, search: '' }, { kind: 'none' });
      await tableExecutionStore.settled('d');
    });
    await waitFor(() => expect(requests).toHaveLength(4));
    expect(requests.map(request => request.max)).toEqual([110, 120, 120, 120]);
    expect(requests[2].signal.aborted).toBe(true);
    await act(async () => requests[2].release());
    expect(apply).toBeDisabled();
    await act(async () => requests[3].release());
    fireEvent.click(apply);
    await waitFor(() => expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1].linkedMetric?.range?.max).toBe(120));
    // The committed settings are independently rendered with the same projection.
    await waitFor(() => expect(requests).toHaveLength(5));
    await act(async () => requests[4].release());
  } finally { factory.mockRestore(); recipeFactory.mockRestore(); }
});

const etfOptions: EtfSunburstOptions = {
  version: 1, kind: 'etf-sunburst', fund: 'VTI.US', depth: 2, snapshot: 'latest',
  fields: { holding: 'symbol', sector: 'sector', weight: 'weight' },
};
async function etfSource(id: string, weight: number, withEvidence = true) {
  // One positive holding plus one zero. This uses the real builder's full
  // circles, which do not need a native partial-path fill check in jsdom.
  const rows = [{ ...etfRows[0], weight }, { ...etfRows[1], weight: 0 }];
  const content = { rows, completeness: 'partial',
    ...(withEvidence && { chart_sources: { version: 1, receipts: [etfReceipt] } }) };
  const file = await saveLocalFile(new File([JSON.stringify(content)], id + '.json'));
  return card({ id, widgetId: 'local_table', backendId: 'builtin', params: { file } });
}

it('requires acquired ETF evidence and clears invalid applied options', async () => {
  const { factory } = riskRuntime();
  const ordinary = await etfSource('A', .27, false);
  const certified = await etfSource('B', .34);
  const chart = riskChart(etfOptions);
  installDashboard(riskDashboard([ordinary, certified, chart]));
  try {
    render(<LiveRiskChart/>);
    expect(await screen.findByText(/Acquire the fund holdings with verified fractional weights/i)).toBeVisible();
    openParameters();
    expect(screen.getByRole('button', { name: 'Apply chart settings' })).toBeDisabled();
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    await chooseRiskSource('B');
    expect(await screen.findByText(/Original total fraction 0\.34/i)).toBeVisible();
    await screen.findByTestId('chart-plot');
    const invalid = { ...chart.linkedChart!, recipe: { ...etfOptions, version: 2 } as unknown as EtfSunburstOptions };
    act(() => installDashboard(riskDashboard([ordinary, certified, { ...chart, linkedSource: { kind: 'widget', sourceWidgetId: 'B' }, linkedChart: invalid }])));
    expect(await screen.findByText(/plain version 1 recipe options/i)).toBeVisible();
    expect(screen.queryByText(/Original total fraction 0\.34/i)).toBeNull();
    expect(screen.queryByTestId('chart-plot')).toBeNull();
  } finally { factory.mockRestore(); }
});

it('clears ETF output while a ready filtered producer waits for its exact worker job', async () => {
  const { factory, run } = riskRuntime();
  const a = await etfSource('A', .27);
  installDashboard(riskDashboard([a, riskChart(etfOptions)]));
  try {
    render(<LiveRiskChart/>);
    expect(await screen.findByText(/2 of 2 acquired/i)).toBeVisible();
    await screen.findByTestId('chart-plot');
    let release!: () => void;
    run.mockImplementationOnce(async (dataset, options, context) => {
      const result = runRecipe(dataset, options, context);
      await new Promise<void>(done => { release = done; });
      return result;
    });
    await act(async () => {
      tableExecutionStore.updateDefinition('d', a.id, { table: {}, search: 'keep this' }, { kind: 'none' });
      await tableExecutionStore.settled('d');
    });
    await waitFor(() => expect(release).toBeDefined());
    expect(tableExecutionStore.readView('d', 'chart')).toMatchObject({ status: 'ready', stale: false });
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    expect(screen.queryByText(/2 of 2 acquired/i)).toBeNull();
    expect(screen.queryByText('Showing completed data (stale).')).toBeNull();
    await act(async () => release());
    expect(await screen.findByText(/1 of 2 acquired.*excluded weight unavailable/i)).toBeVisible();
    await screen.findByTestId('chart-plot');
  } finally { factory.mockRestore(); }
});

it.each(['relink', 'same-ID File replacement'] as const)('fences ETF on %s before sync and retains same-acquisition refresh', async change => {
  const { factory, run } = riskRuntime();
  const a = await etfSource('A', .27), b = await etfSource(change === 'relink' ? 'B' : 'A', .34);
  const table = card({ id: 'T', widgetId: 'linked_table', backendId: 'builtin', linkedSource: { kind: 'widget', sourceWidgetId: 'A' } });
  const chart = { ...riskChart(etfOptions), linkedSource: { kind: 'widget' as const, sourceWidgetId: table.id } };
  installDashboard(riskDashboard(change === 'relink' ? [a, b, table, chart] : [a, table, chart]));
  const originalSync = tableExecutionStore.syncDashboard;
  const sync = vi.spyOn(tableExecutionStore, 'syncDashboard');
  const readFile = fs.readFile;
  let rejectB!: (error: Error) => void;
  const held = new Promise<Uint8Array<ArrayBuffer>>((_, reject) => { rejectB = reject; });
  const pathB = 'files/' + b.params.file;
  const read = vi.spyOn(fs, 'readFile').mockImplementation((path, options) => path === pathB ? held : readFile(path, options));
  try {
    render(<LiveRiskChart/>);
    expect(await screen.findByText(/Original total fraction 0\.27/i)).toBeVisible();
    await screen.findByTestId('chart-plot');
    sync.mockImplementation(() => {});
    const previousJobs = run.mock.calls.length;
    if (change === 'relink') {
      await act(async () => { expect(await useDashboardStore.getState().replaceLinkedSource('T', 'B')).toBe(true); });
    } else {
      act(() => installDashboard(riskDashboard([b, table, chart])));
    }
    expect(tableExecutionStore.readView('d', 'chart').status).toBe('ready');
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    expect(screen.queryByText(/Original total fraction 0\.27/i)).toBeNull();
    expect(run).toHaveBeenCalledTimes(previousJobs);
    sync.mockImplementation(originalSync);
    act(() => tableExecutionStore.syncDashboard(useDashboardStore.getState().dashboards[0]));
    await waitFor(() => expect(read.mock.calls.some(([path]) => path === pathB)).toBe(true));
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    await act(async () => { rejectB(new Error('File read failed')); await tableExecutionStore.settled('d'); });
    expect(screen.getAllByRole('alert').map(element => element.textContent)).toEqual([`Source T: Source ${b.id}: File read failed`]);
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    read.mockImplementation(readFile);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText(/Original total fraction 0\.34/i)).toBeVisible();
    await screen.findByTestId('chart-plot');
    let rejectRefresh!: (error: Error) => void;
    const refresh = new Promise<Uint8Array<ArrayBuffer>>((_, reject) => { rejectRefresh = reject; });
    read.mockImplementation((path, options) => path === pathB ? refresh : readFile(path, options));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Showing completed data (stale).')).toBeVisible();
    expect(screen.getByText(/Original total fraction 0\.34/i)).toBeVisible();
    await act(async () => { rejectRefresh(new Error('Refresh failed')); await tableExecutionStore.settled('d'); });
    expect(screen.getAllByRole('alert').map(element => element.textContent)).toEqual([`Source T: Source ${b.id}: Refresh failed`]);
    expect(screen.getByText(/Original total fraction 0\.34/i)).toBeVisible();
  } finally { read.mockRestore(); sync.mockRestore(); factory.mockRestore(); }
});

it('clears old ETF worker and draw replies on direct relink and reports current draw failure locally', async () => {
  const { factory, run, resize } = riskRuntime();
  const a = await etfSource('A', .27), b = await etfSource('B', .34);
  const plot = vi.mocked(renderPlot);
  let rejectDraw!: (error: Error) => void;
  plot.mockReturnValueOnce(new Promise<void>((_, reject) => { rejectDraw = reject; }));
  installDashboard(riskDashboard([a, b, riskChart(etfOptions)]));
  try {
    render(<LiveRiskChart/>);
    await screen.findByTestId('chart-plot');
    let rejectWorker!: (error: Error) => void;
    run.mockImplementationOnce(() => new Promise((_, reject) => { rejectWorker = reject; }));
    act(() => resize(498.5, 379.5));
    await waitFor(() => expect(rejectWorker).toBeDefined());
    plot.mockRejectedValueOnce(new Error('Current sunburst draw failed'));
    await chooseRiskSource('B');
    expect(await screen.findByRole('alert')).toHaveTextContent('Chart could not be drawn. Current sunburst draw failed');
    expect(screen.getByText(/Original total fraction 0\.34/i)).toBeVisible();
    await act(async () => {
      rejectDraw(new Error('Obsolete draw'));
      rejectWorker(new Error('Obsolete calculation'));
    });
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByText(/Obsolete/i)).toBeNull();
    run.mockRejectedValueOnce(new Error('Current sunburst calculation failed'));
    act(() => resize(483.5, 364.5));
    expect(await screen.findByText('Current sunburst calculation failed')).toHaveAttribute('role', 'alert');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByText(/Original total fraction 0\.34/i)).toBeNull();
    expect(screen.queryByTestId('chart-plot')).toBeNull();
  } finally { factory.mockRestore(); }
});

it('fences obsolete ETF draft results and applies only at the exact checked viewport', async () => {
  const { factory, run, setSize, resize } = riskRuntime();
  const a = await etfSource('A', .27);
  installDashboard(riskDashboard([a, riskChart(etfOptions)]));
  try {
    render(<LiveRiskChart/>);
    const original = await screen.findByTestId('chart-plot');
    openParameters();
    const depth = screen.getByRole('combobox', { name: 'Hierarchy depth' });
    const snapshot = screen.getByRole('combobox', { name: 'Snapshot' });
    const apply = screen.getByRole('button', { name: 'Apply chart settings' });
    const held: { signal: AbortSignal; release: () => void; width?: number }[] = [];
    run.mockImplementation(async (data, options, context, signal) => {
      const result = runRecipe(data, options, context);
      if (options.kind === 'etf-sunburst' && options.depth === 1)
        await new Promise<void>(release => held.push({ signal, release, width: context.viewportWidth }));
      return result;
    });
    fireEvent.change(depth, { target: { value: '1' } });
    await waitFor(() => expect(held).toHaveLength(1));
    expect(apply).toBeDisabled();
    expect(screen.getByTestId('chart-plot')).toBe(original);
    expect(screen.getByText(/Original total fraction 0\.27/i)).toBeVisible();
    fireEvent.change(snapshot, { target: { value: etfReceipt.snapshot } });
    await waitFor(() => expect(held).toHaveLength(2));
    expect(held[0].signal.aborted).toBe(true);
    await act(async () => held[0].release());
    expect(apply).toBeDisabled();
    await act(async () => held[1].release());
    expect(apply).toBeEnabled();
    setSize(10000.5);
    fireEvent.click(apply);
    expect(await screen.findByRole('alert')).toHaveTextContent(/source or drawing size changed/i);
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1].linkedChart?.recipe).toEqual(etfOptions);
    act(() => resize(10000.5));
    await waitFor(() => expect(held).toHaveLength(3));
    expect(held[2].width).toBe(10000.5);
    await act(async () => held[2].release());
    expect(apply).toBeDisabled();
    act(() => resize(540.5));
    await waitFor(() => expect(held).toHaveLength(4));
    expect(held[3].width).toBe(540.5);
    await act(async () => held[3].release());
    fireEvent.click(apply);
    await waitFor(() => expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1].linkedChart?.recipe)
      .toEqual({ ...etfOptions, depth: 1, snapshot: etfReceipt.snapshot }));
    await waitFor(() => expect(held).toHaveLength(5));
    await act(async () => held[4].release());
    await screen.findByTestId('chart-plot');
  } finally { factory.mockRestore(); }
});


const overlayOptions: DualAxisOverlayOptions = {
  kind: 'dual-axis-overlay', version: 1, recipe: 'price-eps',
  fields: { series: 'series', date: 'date', value: 'value', availableAt: 'available_at', targetStart: 'target_start', targetEnd: 'target_end' },
};
async function overlaySource(id: string, value: number, withEvidence = true) {
  const snapshot = structuredClone(overlaySnapshots['price-eps']);
  snapshot.rows[0].value = snapshot.rows[0].source_value = value;
  const file = await saveLocalFile(new File([JSON.stringify(withEvidence ? snapshot : snapshot.rows)], id + '.json'));
  return card({ id, widgetId: 'local_table', backendId: 'builtin', params: { file } });
}

it('requires prepared overlay evidence and clears invalid applied options', async () => {
  const { factory } = riskRuntime();
  const ordinary = await overlaySource('A', 310, false);
  const prepared = await overlaySource('B', 365);
  const chart = riskChart(overlayOptions);
  installDashboard(riskDashboard([ordinary, prepared, chart]));
  try {
    render(<LiveRiskChart/>);
    expect(await screen.findByText(/Acquire an explicitly prepared overlay snapshot/i)).toBeVisible();
    openParameters();
    expect(screen.getByRole('button', { name: 'Apply chart settings' })).toBeDisabled();
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    await chooseRiskSource('B');
    await screen.findByTestId('chart-plot');
    expect(screen.getByText(/currently restated/i)).toBeVisible();
    const invalid = { ...chart.linkedChart!, recipe: { ...overlayOptions, version: 2 } as unknown as RecipeOptions };
    act(() => installDashboard(riskDashboard([ordinary, prepared, { ...chart, linkedSource: { kind: 'widget', sourceWidgetId: 'B' }, linkedChart: invalid }])));
    expect(await screen.findByText(/plain version 1 recipe options/i)).toBeVisible();
    expect(screen.queryByText(/currently restated/i)).toBeNull();
    expect(screen.queryByTestId('chart-plot')).toBeNull();
  } finally { factory.mockRestore(); }
});

it('keeps the applied overlay on an incompatible draft and fences checked settings at an exact drawing size', async () => {
  const { factory, run, setSize, resize } = riskRuntime();
  const a = await overlaySource('A', 310);
  const chart = riskChart(overlayOptions);
  // Use an unavailable saved alias, then repair it and an incompatible draft in the same source.
  const repair = { ...overlayOptions, fields: { ...overlayOptions.fields, value: 'gone' } } as unknown as RecipeOptions;
  installDashboard(riskDashboard([a, chart]));
  try {
    render(<LiveRiskChart/>);
    const original = await screen.findByTestId('chart-plot');
    openParameters();
    const pair = screen.getByLabelText('Overlay recipe');
    fireEvent.change(pair, { target: { value: 'cpi-ten-year' } });
    expect(await screen.findByText(/recipe certified by this prepared snapshot/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Apply chart settings' })).toBeDisabled();
    expect(screen.getByTestId('chart-plot')).toBe(original);
    expect(screen.getByText(/currently restated/i)).toBeVisible();
    act(() => installDashboard(riskDashboard([a, { ...chart, linkedChart: { ...chart.linkedChart!, recipe: repair } }])));
    expect(await screen.findByText(/Repair the overlay bindings/i)).toBeVisible();
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    openParameters();
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'value' } });
    const apply = screen.getByRole('button', { name: 'Apply chart settings' });
    await waitFor(() => expect(apply).toBeEnabled());
    setSize(319.5, 210);
    fireEvent.click(apply);
    expect(await screen.findByRole('alert')).toHaveTextContent(/source or drawing size changed/i);
    act(() => resize(319.5, 210));
    await waitFor(() => expect(apply).toBeDisabled());
    await waitFor(() => expect(run.mock.calls.some(([, , context]) => context.viewportWidth === 319.5 && context.viewportHeight === 210)).toBe(true));
    act(() => resize(420.5, 220.5));
    await waitFor(() => expect(apply).toBeEnabled());
    fireEvent.click(apply);
    await screen.findByTestId('chart-plot');
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1].linkedChart?.recipe).toEqual(overlayOptions);
  } finally { factory.mockRestore(); }
});

it.each(['relink', 'same-ID File replacement'] as const)('fences overlay on %s before sync and retains same-acquisition refresh', async change => {
  const { factory, run } = riskRuntime();
  const a = await overlaySource('A', 310), b = await overlaySource(change === 'relink' ? 'B' : 'A', 365);
  const table = card({ id: 'T', widgetId: 'linked_table', backendId: 'builtin', linkedSource: { kind: 'widget', sourceWidgetId: 'A' } });
  const chart = { ...riskChart(overlayOptions), linkedSource: { kind: 'widget' as const, sourceWidgetId: table.id } };
  installDashboard(riskDashboard(change === 'relink' ? [a, b, table, chart] : [a, table, chart]));
  const originalSync = tableExecutionStore.syncDashboard;
  const sync = vi.spyOn(tableExecutionStore, 'syncDashboard');
  const readFile = fs.readFile;
  let rejectB!: (error: Error) => void;
  const held = new Promise<Uint8Array<ArrayBuffer>>((_, reject) => { rejectB = reject; });
  const pathB = 'files/' + b.params.file;
  const read = vi.spyOn(fs, 'readFile').mockImplementation((path, options) => path === pathB ? held : readFile(path, options));
  try {
    render(<LiveRiskChart/>);
    await screen.findByTestId('chart-plot');
    sync.mockImplementation(() => {});
    const previousJobs = run.mock.calls.length;
    if (change === 'relink') {
      await act(async () => { expect(await useDashboardStore.getState().replaceLinkedSource('T', 'B')).toBe(true); });
    } else {
      act(() => installDashboard(riskDashboard([b, table, chart])));
    }
    expect(tableExecutionStore.readView('d', 'chart').status).toBe('ready');
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    expect(screen.queryByText(/currently restated/i)).toBeNull();
    expect(run).toHaveBeenCalledTimes(previousJobs);
    sync.mockImplementation(originalSync);
    act(() => tableExecutionStore.syncDashboard(useDashboardStore.getState().dashboards[0]));
    await waitFor(() => expect(read.mock.calls.some(([path]) => path === pathB)).toBe(true));
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    await act(async () => { rejectB(new Error('File read failed')); await tableExecutionStore.settled('d'); });
    expect(screen.getAllByRole('alert').map(element => element.textContent)).toEqual([`Source T: Source ${b.id}: File read failed`]);
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    read.mockImplementation(readFile);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByTestId('chart-plot');
    expect(vi.mocked(renderPlot).mock.lastCall?.[1].data[0]).toMatchObject({ y: [365] });
    let rejectRefresh!: (error: Error) => void;
    const refresh = new Promise<Uint8Array<ArrayBuffer>>((_, reject) => { rejectRefresh = reject; });
    read.mockImplementation((path, options) => path === pathB ? refresh : readFile(path, options));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Showing completed data (stale).')).toBeVisible();
    await act(async () => { rejectRefresh(new Error('Refresh failed')); await tableExecutionStore.settled('d'); });
    expect(screen.getAllByRole('alert').map(element => element.textContent)).toEqual([`Source T: Source ${b.id}: Refresh failed`]);
    expect(screen.getByText(/currently restated/i)).toBeVisible();
  } finally { read.mockRestore(); sync.mockRestore(); factory.mockRestore(); }
});

it('drops an overlay from the outgoing ready revision and ignores its late draw or worker failure', async () => {
  const { factory, run, resize } = riskRuntime();
  const a = await overlaySource('A', 310), b = await overlaySource('B', 365);
  installDashboard(riskDashboard([a, b, riskChart(overlayOptions)]));
  const plot = vi.mocked(renderPlot);
  let rejectDraw!: (error: Error) => void;
  plot.mockReturnValueOnce(new Promise<void>((_, reject) => { rejectDraw = reject; }));
  try {
    render(<LiveRiskChart/>);
    await screen.findByTestId('chart-plot');
    let release!: () => void;
    run.mockImplementationOnce(async (data, options, context) => {
      const result = runRecipe(data, options, context);
      await new Promise<void>(done => { release = done; });
      return result;
    });
    await act(async () => {
      tableExecutionStore.updateDefinition('d', a.id, { table: {}, search: 'sample' }, { kind: 'none' });
      await tableExecutionStore.settled('d');
    });
    await waitFor(() => expect(release).toBeDefined());
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    expect(screen.queryByText(/currently restated/i)).toBeNull();
    await act(async () => release());
    let rejectWorker!: (error: Error) => void;
    run.mockImplementationOnce(() => new Promise((_, reject) => { rejectWorker = reject; }));
    act(() => resize(498.5, 379.5));
    await waitFor(() => expect(rejectWorker).toBeDefined());
    plot.mockRejectedValueOnce(new Error('Current overlay draw failed'));
    await chooseRiskSource('B');
    expect(await screen.findByRole('alert')).toHaveTextContent('Chart could not be drawn. Current overlay draw failed');
    await act(async () => {
      rejectDraw(new Error('Obsolete draw'));
      rejectWorker(new Error('Obsolete calculation'));
    });
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByText(/Obsolete/i)).toBeNull();
    run.mockRejectedValueOnce(new Error('Current overlay calculation failed'));
    act(() => resize(483.5, 364.5));
    expect(await screen.findByText('Current overlay calculation failed')).toHaveAttribute('role', 'alert');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByTestId('chart-plot')).toBeNull();
  } finally { factory.mockRestore(); }
});

it('retains an omitted optional overlay binding and fences pending drafts and queued saves', async () => {
  const { factory, run, setSize } = riskRuntime();
  const file = await saveLocalFile(new File([JSON.stringify(overlaySnapshots['cpi-ten-year'])], 'macro.json'));
  const input = card({ id: 'A', widgetId: 'local_table', backendId: 'builtin', params: { file } });
  const macro: DualAxisOverlayOptions = { kind: 'dual-axis-overlay', version: 1, recipe: 'cpi-ten-year',
    fields: { series: 'series', date: 'date', value: 'value' } };
  installDashboard(riskDashboard([input, riskChart(macro)]));
  let releaseSave!: () => void;
  const waitForSave = new Promise<void>(resolve => { releaseSave = resolve; });
  const write = fs.writeTextFile;
  const pendingSave = vi.spyOn(fs, 'writeTextFile').mockImplementation(async (path, data, options) => {
    if (data.includes('Held display name')) await waitForSave;
    return write(path, data, options);
  });
  try {
    render(<LiveRiskChart/>);
    const original = await screen.findByTestId('chart-plot');
    openParameters();
    const field = screen.getByRole('combobox', { name: 'Release availability' });
    expect(field).toHaveValue('');
    const apply = screen.getByRole('button', { name: 'Apply chart settings' });
    expect(apply).toBeDisabled();
    let reject!: (error: Error) => void;
    run.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    fireEvent.change(field, { target: { value: 'available_at' } });
    await waitFor(() => expect(reject).toBeDefined());
    expect(apply).toBeDisabled();
    expect(screen.getByTestId('chart-plot')).toBe(original);
    expect(screen.getByText(/^US CPI-U.*Release date\/time unavailable for 2 shown observations/i)).toBeInTheDocument();
    fireEvent.change(field, { target: { value: '' } });
    await act(async () => reject(new Error('Superseded draft error')));
    expect(screen.queryByText(/Superseded/)).toBeNull();
    expect(screen.getByTestId('chart-plot')).toBe(original);
    fireEvent.change(field, { target: { value: 'available_at' } });
    await waitFor(() => expect(apply).toBeEnabled());
    const saving = useDashboardStore.getState().renameDashboard('d', 'Held display name');
    await waitFor(() => expect(pendingSave.mock.calls.some(([, data]) => data.includes('Held display name'))).toBe(true));
    fireEvent.click(apply);
    // The click saw a matching surface. The durable guard must see this change
    // even before a ResizeObserver report and refuse the queued write.
    setSize(480.5, 230);
    await act(async () => { releaseSave(); await saving; });
    expect(await screen.findByRole('alert')).toHaveTextContent(/source or drawing size changed/i);
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1].linkedChart?.recipe).toEqual(macro);
    expect(screen.getByTestId('chart-plot')).toBe(original);
  } finally { releaseSave(); pendingSave.mockRestore(); factory.mockRestore(); }
});

async function estimateHistorySource(id: string, content: unknown) {
  const file = await saveLocalFile(new File([JSON.stringify(content)], id + '.json'));
  return card({ id, widgetId: 'local_table', backendId: 'builtin', params: { file } });
}
const revisionApply = () => screen.getByRole('button', { name: 'Apply chart settings' });
const vintage = (name: RegExp) => screen.getByRole('checkbox', { name });

it('requires estimate vintage evidence, protects the applied question from an incompatible draft and clears invalid saved settings', async () => {
  const { factory } = riskRuntime();
  const sample = revisionHistory([[0, null, 12]], { unknown: true });
  const ordinary = await estimateHistorySource('A', sample.rows), recorded = await estimateHistorySource('B', sample);
  const linked = riskChart(revisionSlope);
  installDashboard(riskDashboard([ordinary, recorded, linked]));
  try {
    render(<LiveRiskChart/>);
    expect(await screen.findByText(/Load a verified local history/i)).toBeVisible();
    openParameters();
    expect(revisionApply()).toBeDisabled();
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    await chooseRiskSource('B');
    const plot = await screen.findByTestId('chart-plot');
    openParameters();
    const view = screen.getByLabelText('Revision view');
    expect(view).toHaveValue('slope');
    expect(within(view).getByRole('option', { name: /Bump/ })).toBeDisabled();
    fireEvent.change(view, { target: { value: 'path' } });
    expect(screen.getByText(/at least three acquired vintages/i)).toBeVisible();
    expect(revisionApply()).toBeDisabled();
    expect(screen.getByTestId('chart-plot')).toBe(plot);
    const invalid = { ...linked.linkedChart!, recipe: { ...revisionSlope, version: 2 } as unknown as RecipeOptions };
    act(() => useDashboardStore.setState({ dashboards: [riskDashboard([ordinary, recorded,
      { ...linked, linkedSource: { kind: 'widget', sourceWidgetId: 'B' }, linkedChart: invalid }])] }));
    expect(await screen.findByText(/Supply plain version 1 recipe options/i)).toBeVisible();
    expect(screen.queryByTestId('chart-plot')).toBeNull();
  } finally { factory.mockRestore(); }
});

it('remeasures applied revision sizing once, discards obsolete sizing and allows the current source to resize without a new question', async () => {
  const { factory, run, resize, setSize } = riskRuntime();
  setSize(320, 230);
  const a = await estimateHistorySource('A', revisionHistory(revisionTieValues));
  const b = await estimateHistorySource('B', revisionHistory([[10, 15, 20], [20, 30, 40]]));
  const plot = vi.mocked(renderPlot);
  let release!: () => void;
  run.mockImplementationOnce(async (data, options, context) => {
    const result = runRecipe(data, options, context);
    await new Promise<void>(done => { release = done; });
    return result;
  });
  installDashboard(riskDashboard([a, b, riskChart(revisionBump)]));
  try {
    const { container } = render(<LiveRiskChart/>);
    const drawing = () => container.querySelector<HTMLElement>('.linked-chart-plot--revisions .chart-plot')!;
    await waitFor(() => expect(release).toBeDefined());
    await chooseRiskSource('B');
    await screen.findByTestId('chart-plot');
    const question = plot.mock.lastCall![2];
    await act(async () => release());
    expect(drawing().style.height).toBe('230px');
    expect(run).toHaveBeenCalledTimes(2);
    await chooseRiskSource('A');
    await waitFor(() => expect(drawing().style.height).toBe('352px'));
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    act(() => resize(320, 230));
    expect(run).toHaveBeenCalledTimes(3);
    act(() => resize(320, 352));
    await screen.findByTestId('chart-plot');
    expect(plot.mock.lastCall![2]).not.toBe(question);
    const current = plot.mock.lastCall![2];
    act(() => resize(403.5, 390));
    await waitFor(() => expect(plot.mock.lastCall![1].layout.width).toBe(404));
    expect(plot.mock.lastCall![2]).toBe(current);
    expect(drawing().style.height).toBe('352px');
  } finally { factory.mockRestore(); }
});

it('accepts draft sizing only for the current pins and waits for a successful worker at the measured size', async () => {
  const { factory, run, resize, setSize } = riskRuntime();
  setSize(325, 230);
  const a = await estimateHistorySource('A', revisionHistory([revisionDenseValues]));
  installDashboard(riskDashboard([a, riskChart(revisionSlope)]));
  try {
    const { container } = render(<LiveRiskChart/>);
    const probe = () => container.querySelector<HTMLElement>('.estimate-revisions-draft-probe .chart-plot')!;
    const applied = await screen.findByTestId('chart-plot');
    openParameters();
    let releaseDraft!: () => void;
    run.mockImplementationOnce(async (data, options, context) => {
      const result = runRecipe(data, options, context);
      await new Promise<void>(done => { releaseDraft = done; });
      return result;
    });
    fireEvent.change(screen.getByLabelText('Revision view'), { target: { value: 'path' } });
    fireEvent.click(vintage(/snap-b/));
    await waitFor(() => expect(releaseDraft).toBeDefined());
    fireEvent.click(vintage(/snap-b/));
    await act(async () => releaseDraft());
    expect(probe().style.minWidth).toBe('320px');
    expect(revisionApply()).toBeDisabled();
    fireEvent.click(vintage(/snap-b/));
    await waitFor(() => expect(probe().style.minWidth).toBe('379px'));
    expect(revisionApply()).toBeDisabled();
    const before = run.mock.calls.length;
    const draftProbe = probe();
    fireEvent.click(screen.getByRole('button', { name: 'Hide parameters' }));
    act(() => resize(0, 0));
    expect(screen.queryByRole('button', { name: 'Apply chart settings' })).toBeNull();
    expect(run).toHaveBeenCalledTimes(before);
    openParameters();
    expect(probe()).toBe(draftProbe);
    expect(screen.getByLabelText('Revision view')).toHaveValue('path');
    expect(revisionApply()).toBeDisabled();
    act(() => resize(325, 230));
    expect(run).toHaveBeenCalledTimes(before);
    act(() => resize(379, 230));
    await waitFor(() => expect(revisionApply()).toBeEnabled());
    expect(screen.getByTestId('chart-plot')).toBe(applied);
    expect(probe().style.minWidth).toBe('379px');
  } finally { factory.mockRestore(); }
});

it.each(['relink', 'same-ID File replacement'] as const)('fences estimate revisions on %s before sync and retains same-acquisition refresh', async change => {
  const { factory, run } = riskRuntime();
  const a = await estimateHistorySource('A', revisionHistory([[10, null, 12]])), b = await estimateHistorySource(change === 'relink' ? 'B' : 'A', revisionHistory([[20, null, 24]]));
  const table = card({ id: 'T', widgetId: 'linked_table', backendId: 'builtin', linkedSource: { kind: 'widget', sourceWidgetId: 'A' } });
  const chart = { ...riskChart(revisionSlope), linkedSource: { kind: 'widget' as const, sourceWidgetId: table.id } };
  installDashboard(riskDashboard(change === 'relink' ? [a, b, table, chart] : [a, table, chart]));
  const originalSync = tableExecutionStore.syncDashboard;
  const sync = vi.spyOn(tableExecutionStore, 'syncDashboard');
  const readFile = fs.readFile;
  let rejectB!: (error: Error) => void;
  const held = new Promise<Uint8Array<ArrayBuffer>>((_, reject) => { rejectB = reject; });
  const pathB = 'files/' + b.params.file;
  const read = vi.spyOn(fs, 'readFile').mockImplementation((path, options) => path === pathB ? held : readFile(path, options));
  try {
    render(<LiveRiskChart/>);
    await screen.findByTestId('chart-plot');
    sync.mockImplementation(() => {});
    const previousJobs = run.mock.calls.length;
    if (change === 'relink') {
      await act(async () => { expect(await useDashboardStore.getState().replaceLinkedSource('T', 'B')).toBe(true); });
    } else {
      act(() => installDashboard(riskDashboard([b, table, chart])));
    }
    expect(tableExecutionStore.readView('d', 'chart').status).toBe('ready');
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    expect(screen.queryByText(/uses acquired USD\/share/i)).toBeNull();
    expect(run).toHaveBeenCalledTimes(previousJobs);
    sync.mockImplementation(originalSync);
    act(() => tableExecutionStore.syncDashboard(useDashboardStore.getState().dashboards[0]));
    await waitFor(() => expect(read.mock.calls.some(([path]) => path === pathB)).toBe(true));
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    await act(async () => { rejectB(new Error('File read failed')); await tableExecutionStore.settled('d'); });
    expect(screen.getAllByRole('alert').map(element => element.textContent)).toEqual([`Source T: Source ${b.id}: File read failed`]);
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    read.mockImplementation(readFile);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByTestId('chart-plot');
    expect(vi.mocked(renderPlot).mock.lastCall?.[1].data[0]).toMatchObject({ y: [20, 24] });
    let rejectRefresh!: (error: Error) => void;
    const refresh = new Promise<Uint8Array<ArrayBuffer>>((_, reject) => { rejectRefresh = reject; });
    read.mockImplementation((path, options) => path === pathB ? refresh : readFile(path, options));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Showing completed data (stale).')).toBeVisible();
    await act(async () => { rejectRefresh(new Error('Refresh failed')); await tableExecutionStore.settled('d'); });
    expect(screen.getAllByRole('alert').map(element => element.textContent)).toEqual([`Source T: Source ${b.id}: Refresh failed`]);
    expect(screen.getByText(/uses acquired USD\/share/i)).toBeVisible();
  } finally { read.mockRestore(); sync.mockRestore(); factory.mockRestore(); }
});

it('drops an estimate revision chart from the outgoing ready revision and ignores its late draw or worker failure', async () => {
  const { factory, run, resize } = riskRuntime();
  const a = await estimateHistorySource('A', revisionHistory([[10, null, 12]])), b = await estimateHistorySource('B', revisionHistory([[20, null, 24]]));
  installDashboard(riskDashboard([a, b, riskChart(revisionSlope)]));
  const plot = vi.mocked(renderPlot);
  let rejectDraw!: (error: Error) => void;
  plot.mockReturnValueOnce(new Promise<void>((_, reject) => { rejectDraw = reject; }));
  try {
    render(<LiveRiskChart/>);
    await screen.findByTestId('chart-plot');
    let release!: () => void;
    run.mockImplementationOnce(async (data, options, context) => {
      const result = runRecipe(data, options, context);
      await new Promise<void>(done => { release = done; });
      return result;
    });
    await act(async () => {
      tableExecutionStore.updateDefinition('d', a.id, { table: {}, search: 'ALFA.US' }, { kind: 'none' });
      await tableExecutionStore.settled('d');
    });
    await waitFor(() => expect(release).toBeDefined());
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    expect(screen.queryByText(/uses acquired USD\/share/i)).toBeNull();
    await act(async () => release());
    let rejectWorker!: (error: Error) => void;
    run.mockImplementationOnce(() => new Promise((_, reject) => { rejectWorker = reject; }));
    act(() => resize(498.5, 379.5));
    await waitFor(() => expect(rejectWorker).toBeDefined());
    plot.mockRejectedValueOnce(new Error('Current revision draw failed'));
    await chooseRiskSource('B');
    expect(await screen.findByRole('alert')).toHaveTextContent('Chart could not be drawn. Current revision draw failed');
    await act(async () => {
      rejectDraw(new Error('Obsolete draw'));
      rejectWorker(new Error('Obsolete calculation'));
    });
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByText(/Obsolete/i)).toBeNull();
    run.mockRejectedValueOnce(new Error('Current revision calculation failed'));
    act(() => resize(483.5, 364.5));
    expect(await screen.findByText('Current revision calculation failed')).toHaveAttribute('role', 'alert');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByTestId('chart-plot')).toBeNull();
  } finally { factory.mockRestore(); }
});


it.each([0, -2, null])('disables bump with an ineligible baseline %j', async baseline => {
  const { factory } = riskRuntime();
  const local = await estimateHistorySource('A', revisionHistory([[baseline, 4, 5]]));
  installDashboard(riskDashboard([local, riskChart(revisionSlope)]));
  try {
    render(<LiveRiskChart/>);
    openParameters();
    expect(await within(screen.getByLabelText('Consensus value')).findByRole('option', { name: 'value' })).toBeEnabled();
    expect(screen.getByRole('option', { name: /Bump/ })).toBeDisabled();
  } finally { factory.mockRestore(); }
});

it('creates a bump chart with a current rank gap after pinning both declared endpoint batches', async () => {
  const { factory } = riskRuntime();
  const local = await estimateHistorySource('A', revisionHistory([[10, 12, 14], [5, 6, null]]));
  const chart = { ...riskChart(revisionBump), linkedChart: { type: 'column' as const, measures: [], display: 'grouped' as const } };
  installDashboard(riskDashboard([local, chart]));
  try {
    render(<LiveRiskChart/>);
    openParameters();
    fireEvent.change(screen.getByRole('combobox', { name: 'Chart type' }), { target: { value: 'estimate-revisions' } });
    expect(await within(screen.getByLabelText('Consensus value')).findByRole('option', { name: 'value' })).toBeEnabled();
    expect(screen.getByRole('option', { name: /Bump/ })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Revision view'), { target: { value: 'bump' } });
    fireEvent.click(vintage(/snap-a/));
    fireEvent.click(vintage(/snap-b/));
    expect(await screen.findByText(/Pin the exact declared baseline and current batches/i)).toBeVisible();
    expect(revisionApply()).toBeDisabled();

    fireEvent.click(vintage(/snap-c/));
    await waitFor(() => expect(revisionApply()).toBeEnabled());
    fireEvent.click(revisionApply());
    expect(await screen.findByText(/Whole rank columns unavailable at snap-c/i)).toBeVisible();
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards.at(-1)?.linkedChart?.recipe).toEqual(revisionBump);
    expect(vi.mocked(renderPlot).mock.lastCall?.[1].data).toEqual([
      expect.objectContaining({ name: 'ALFA.US', y: [1, 1, null] }),
      expect.objectContaining({ name: 'BETA.CA', y: [1, 1, null] }),
    ]);
  } finally { factory.mockRestore(); }
});

it('discards sizing from a relinked estimate draft and rechecks the drawing size before a queued Apply', async () => {
  const { factory, run, setSize } = riskRuntime();
  setSize(325, 230);
  const a = await estimateHistorySource('A', revisionHistory([revisionDenseValues]));
  const b = await estimateHistorySource('B', revisionHistory([[10, 11, 12]]));
  installDashboard(riskDashboard([a, b, riskChart(revisionSlope)]));
  let releaseSave!: () => void;
  const heldSave = new Promise<void>(done => { releaseSave = done; });
  const write = fs.writeTextFile;
  const pendingSave = vi.spyOn(fs, 'writeTextFile').mockImplementation(async (path, data, options) => {
    if (data.includes('Held revisions workspace')) await heldSave;
    return write(path, data, options);
  });
  try {
    const { container } = render(<LiveRiskChart/>);
    await screen.findByTestId('chart-plot');
    openParameters();
    let releaseDraft!: () => void;
    run.mockImplementationOnce(async (data, options, context) => {
      const result = runRecipe(data, options, context);
      await new Promise<void>(done => { releaseDraft = done; });
      return result;
    });
    fireEvent.change(screen.getByLabelText('Revision view'), { target: { value: 'path' } });
    fireEvent.click(vintage(/snap-b/));
    await waitFor(() => expect(releaseDraft).toBeDefined());
    await chooseRiskSource('B');
    await screen.findByTestId('chart-plot');
    openParameters();
    fireEvent.change(screen.getByLabelText('Revision view'), { target: { value: 'path' } });
    fireEvent.click(vintage(/snap-b/));
    await waitFor(() => expect(revisionApply()).toBeEnabled());
    await act(async () => releaseDraft());
    expect(container.querySelector<HTMLElement>('.estimate-revisions-draft-probe .chart-plot')!.style.minWidth).toBe('320px');
    expect(revisionApply()).toBeEnabled();

    const saving = useDashboardStore.getState().renameDashboard('d', 'Held revisions workspace');
    await waitFor(() => expect(pendingSave.mock.calls.some(([, data]) => data.includes('Held revisions workspace'))).toBe(true));
    fireEvent.click(revisionApply());
    setSize(345, 230);
    await act(async () => { releaseSave(); await saving; });
    expect(await screen.findByRole('alert')).toHaveTextContent(/estimate history source or drawing size changed/i);
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards.at(-1)?.linkedChart?.recipe).toEqual(revisionSlope);
  } finally { releaseSave(); pendingSave.mockRestore(); factory.mockRestore(); }
});


it('requires a prepared market-map receipt and keeps the applied map and details through a pending or refused draft', async () => {
  const { factory, run } = riskRuntime();
  const cap = marketSession();
  const ordinary = await estimateHistorySource('A', cap.rows), recorded = await estimateHistorySource('B', cap);
  const saved = { ...capMap, session: '2026-11-11' };
  const chart = riskChart(saved);
  installDashboard(riskDashboard([ordinary, recorded, chart]));
  try {
    render(<LiveRiskChart/>);
    expect(await screen.findByText(/Relink a verified local market-map acquisition/i)).toBeVisible();
    openParameters();
    expect(revisionApply()).toBeDisabled();
    const mode = screen.getByLabelText('Area basis');
    expect(within(mode).getByRole('option', { name: 'Named index weights' })).toBeDisabled();
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    await chooseRiskSource('B');
    expect(await screen.findByText(/pinned market-map session is unavailable/i)).toBeVisible();
    openParameters();
    fireEvent.change(screen.getByLabelText('Completed session'), { target: { value: 'latest' } });
    await waitFor(() => expect(revisionApply()).toBeEnabled());
    fireEvent.click(revisionApply());
    const plot = await screen.findByTestId('chart-plot');
    fireEvent.click(screen.getByText('Market map details', { exact: true }));
    expect(await screen.findByRole('table', { name: 'Original listing values' })).toHaveTextContent('98765.4321 USD');
    openParameters();
    let rejectDraft!: (error: Error) => void;
    run.mockImplementationOnce(() => new Promise((_, reject) => { rejectDraft = reject; }));
    fireEvent.change(screen.getByLabelText('Completed session'), { target: { value: '2026-11-13' } });
    await waitFor(() => expect(rejectDraft).toBeDefined());
    expect(revisionApply()).toBeDisabled();
    expect(screen.getByTestId('chart-plot')).toBe(plot);
    fireEvent.change(screen.getByLabelText('Area value'), { target: { value: '' } });
    await act(async () => rejectDraft(new Error('Obsolete market-map draft')));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(revisionApply()).toBeDisabled();
    expect(screen.getByTestId('chart-plot')).toBe(plot);
    expect(screen.getByRole('table', { name: 'Original listing values' })).toHaveTextContent('98765.4321 USD');
    act(() => useDashboardStore.setState({ dashboards: [riskDashboard([ordinary, recorded, {
      ...chart, linkedSource: { kind: 'widget', sourceWidgetId: 'B' },
      linkedChart: { ...chart.linkedChart!, recipe: { ...capMap, version: 2 } as unknown as RecipeOptions },
    }])] }));
    expect(await screen.findByText(/Supply plain version 1 recipe options/i)).toBeVisible();
    expect(screen.queryByTestId('chart-plot')).toBeNull();
  } finally { factory.mockRestore(); }
});

it('preflights a market-map draft at the exact applied drawing size and discards a queued Apply when it changes', async () => {
  const { factory, run, setSize, resize } = riskRuntime();
  setSize(319.5, 260);
  const a = await estimateHistorySource('A', marketIndex);
  const linked = riskChart(capMap);
  installDashboard(riskDashboard([a, linked]));
  try {
    const { container } = render(<LiveRiskChart/>);
    openParameters();
    const mode = screen.getByLabelText('Area basis');
    await waitFor(() => expect(within(mode).getByRole('option', { name: 'Named index weights' })).toBeEnabled());
    fireEvent.change(mode, { target: { value: 'index-weight' } });
    expect(await screen.findAllByText(/at least 320 × 260/i)).not.toHaveLength(0);
    expect(revisionApply()).toBeDisabled();
    const probe = container.querySelector<HTMLElement>('.market-map-draft-probe .chart-plot')!;
    expect(probe.style.minWidth).toBe('320px');
    expect(probe.style.height).toBe('260px');
    act(() => resize(320.5, 260));
    await waitFor(() => expect(revisionApply()).toBeEnabled());
    const draftCall = run.mock.lastCall!;
    expect(draftCall[2]).toMatchObject({ viewportWidth: 320.5, viewportHeight: 260 });
    expect(draftCall[0].columns.map(c => c.id)).toEqual(expect.arrayContaining(['listing', 'sector', 'area', 'change', 'session', 'universe', 'weight_valid_for', 'membership_as_of']));
    const commit = useDashboardStore.getState().commitLinkedChartSettings;
    let release!: () => void;
    const pending = new Promise<void>(done => { release = done; });
    const save = vi.spyOn(useDashboardStore.getState(), 'commitLinkedChartSettings').mockImplementationOnce(async (...args) => {
      await pending;
      return commit(...args);
    });
    try {
      fireEvent.click(revisionApply());
      setSize(337.5, 260);
      await act(async () => release());
      expect(await screen.findByRole('alert')).toHaveTextContent(/market-map source or drawing size changed/i);
      expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1].linkedChart?.recipe).toEqual(capMap);
      act(() => resize(337.5, 260));
      await waitFor(() => expect(revisionApply()).toBeEnabled());
      const checked = run.mock.calls.filter(([, options]) => options.kind === 'market-map' && options.mode === 'index-weight').at(-1)!;
      fireEvent.click(revisionApply());
      await screen.findByTestId('chart-plot');
      const applied = run.mock.lastCall!;
      expect(applied[0].revision).toEqual(checked[0].revision);
      expect(applied[1]).toEqual(checked[1]);
      expect(applied[2]).toEqual(checked[2]);
      const draw = vi.mocked(renderPlot);
      const question = draw.mock.lastCall![2];
      act(() => resize(490.5, 311.5));
      await waitFor(() => expect(draw.mock.lastCall![1].layout.width).toBe(490.5));
      expect(draw.mock.lastCall![2]).toBe(question);
    } finally { release(); save.mockRestore(); }
  } finally { factory.mockRestore(); }
});

it('fences recursive market map relinks before runtime sync, then keeps only same-chain stale output', async () => {
  const { factory, run } = riskRuntime();
  const a = await estimateHistorySource('A', marketSession()), b = await estimateHistorySource('B', marketSession('2026-11-12', '2026-11-11'));
  const table = card({ id: 'T', widgetId: 'linked_table', backendId: 'builtin', linkedSource: { kind: 'widget', sourceWidgetId: 'A' } });
  const chart = { ...riskChart(capMap), linkedSource: { kind: 'widget' as const, sourceWidgetId: table.id } };
  installDashboard(riskDashboard([a, b, table, chart]));
  const originalSync = tableExecutionStore.syncDashboard;
  const sync = vi.spyOn(tableExecutionStore, 'syncDashboard');
  const readFile = fs.readFile;
  let rejectB!: (error: Error) => void;
  const held = new Promise<Uint8Array<ArrayBuffer>>((_, reject) => { rejectB = reject; });
  const pathB = 'files/' + b.params.file;
  const read = vi.spyOn(fs, 'readFile').mockImplementation((path, options) => path === pathB ? held : readFile(path, options));
  try {
    render(<LiveRiskChart/>);
    await screen.findByTestId('chart-plot');
    sync.mockImplementation(() => {});
    const previousJobs = run.mock.calls.length;
    await act(async () => { expect(await useDashboardStore.getState().replaceLinkedSource('T', 'B')).toBe(true); });
    expect(tableExecutionStore.readView('d', 'chart').status).toBe('ready');
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    expect(screen.queryByText(/Capitalization retrieved/i)).toBeNull();
    expect(run).toHaveBeenCalledTimes(previousJobs);
    sync.mockImplementation(originalSync);
    act(() => tableExecutionStore.syncDashboard(useDashboardStore.getState().dashboards[0]));
    await waitFor(() => expect(read.mock.calls.some(([path]) => path === pathB)).toBe(true));
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    await act(async () => { rejectB(new Error('File read failed')); await tableExecutionStore.settled('d'); });
    expect(screen.getAllByRole('alert').map(element => element.textContent)).toEqual(['Source T: Source B: File read failed']);
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    read.mockImplementation(readFile);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByTestId('chart-plot');
    expect(vi.mocked(renderPlot).mock.lastCall?.[1].layout.title).toMatchObject({ text: expect.stringContaining('2026-11-12') });
    let rejectRefresh!: (error: Error) => void;
    const refresh = new Promise<Uint8Array<ArrayBuffer>>((_, reject) => { rejectRefresh = reject; });
    read.mockImplementation((path, options) => path === pathB ? refresh : readFile(path, options));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Showing completed data (stale).')).toBeVisible();
    await act(async () => { rejectRefresh(new Error('Refresh failed')); await tableExecutionStore.settled('d'); });
    expect(screen.getAllByRole('alert').map(element => element.textContent)).toEqual(['Source T: Source B: Refresh failed']);
    expect(screen.getByText(/Capitalization retrieved/i)).toBeVisible();
  } finally { read.mockRestore(); sync.mockRestore(); factory.mockRestore(); }
});

it('drops an market map chart from the outgoing ready revision and ignores its late draw or worker failure', async () => {
  const { factory, run, resize } = riskRuntime();
  const a = await estimateHistorySource('A', marketSession()), b = await estimateHistorySource('B', marketSession('2026-11-12', '2026-11-11'));
  installDashboard(riskDashboard([a, b, riskChart(capMap)]));
  const plot = vi.mocked(renderPlot);
  let rejectDraw!: (error: Error) => void;
  plot.mockReturnValueOnce(new Promise<void>((_, reject) => { rejectDraw = reject; }));
  try {
    render(<LiveRiskChart/>);
    await screen.findByTestId('chart-plot');
    let release!: () => void;
    run.mockImplementationOnce(async (data, options, context) => {
      const result = runRecipe(data, options, context);
      await new Promise<void>(done => { release = done; });
      return result;
    });
    await act(async () => {
      tableExecutionStore.updateDefinition('d', a.id, { table: {}, search: 'ALFA.US' }, { kind: 'none' });
      await tableExecutionStore.settled('d');
    });
    await waitFor(() => expect(release).toBeDefined());
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    expect(screen.queryByText(/Capitalization retrieved/i)).toBeNull();
    await act(async () => release());
    let rejectWorker!: (error: Error) => void;
    run.mockImplementationOnce(() => new Promise((_, reject) => { rejectWorker = reject; }));
    act(() => resize(498.5, 379.5));
    await waitFor(() => expect(rejectWorker).toBeDefined());
    plot.mockRejectedValueOnce(new Error('Current revision draw failed'));
    await chooseRiskSource('B');
    expect(await screen.findByRole('alert')).toHaveTextContent('Chart could not be drawn. Current revision draw failed');
    await act(async () => {
      rejectDraw(new Error('Obsolete draw'));
      rejectWorker(new Error('Obsolete calculation'));
    });
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByText(/Obsolete/i)).toBeNull();
    run.mockRejectedValueOnce(new Error('Current revision calculation failed'));
    act(() => resize(483.5, 364.5));
    expect(await screen.findByText('Current revision calculation failed')).toHaveAttribute('role', 'alert');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByTestId('chart-plot')).toBeNull();
  } finally { factory.mockRestore(); }
});



it('does not retain chart data when a market-map acquisition File changes under the same root card ID', async () => {
  const { factory } = riskRuntime();
  const a = await estimateHistorySource('A', marketSession());
  const replacement = await estimateHistorySource('A', marketSession('2026-11-12', '2026-11-11'));
  const table = card({ id: 'T', widgetId: 'linked_table', backendId: 'builtin', linkedSource: { kind: 'widget', sourceWidgetId: 'A' } });
  const chart = { ...riskChart(capMap), linkedSource: { kind: 'widget' as const, sourceWidgetId: table.id } };
  installDashboard(riskDashboard([a, table, chart]));
  const originalSync = tableExecutionStore.syncDashboard;
  const sync = vi.spyOn(tableExecutionStore, 'syncDashboard');
  const readFile = fs.readFile;
  let rejectReplacement!: (error: Error) => void;
  const held = new Promise<Uint8Array<ArrayBuffer>>((_, reject) => { rejectReplacement = reject; });
  const path = 'files/' + replacement.params.file;
  const read = vi.spyOn(fs, 'readFile').mockImplementation((name, options) => name === path ? held : readFile(name, options));
  try {
    render(<LiveRiskChart/>);
    await screen.findByTestId('chart-plot');
    sync.mockImplementation(() => {});
    act(() => installDashboard(riskDashboard([replacement, table, chart])));
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    sync.mockImplementation(originalSync);
    act(() => tableExecutionStore.syncDashboard(useDashboardStore.getState().dashboards[0]));
    await waitFor(() => expect(read.mock.calls.some(([name]) => name === path)).toBe(true));
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    expect(screen.queryByText('Showing completed data (stale).')).toBeNull();
    await act(async () => { rejectReplacement(new Error('Replacement failed')); await tableExecutionStore.settled('d'); });
    expect(screen.getAllByRole('alert').map(node => node.textContent)).toEqual(['Source T: Source A: Replacement failed']);
    expect(screen.queryByText(/Capitalization retrieved/)).toBeNull();
    read.mockImplementation(readFile);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByTestId('chart-plot');
    expect(vi.mocked(renderPlot).mock.lastCall?.[1].layout.title).toMatchObject({ text: expect.stringContaining('2026-11-12') });
  } finally { read.mockRestore(); sync.mockRestore(); factory.mockRestore(); }
});

it.each([calendarOptions, returnOptions, ownershipOptions])('retires $kind when a linked ancestor replaces its File under the same ID', async recipe => {
  const { factory, run } = riskRuntime();
  const a = await acquiredSource(recipe, 'A');
  const b = { ...a, params: (await acquiredSource(recipe, 'B')).params };
  const table = card({ id: 'T', widgetId: 'linked_table', backendId: 'builtin',
    linkedSource: { kind: 'widget', sourceWidgetId: a.id } });
  const chart = { ...riskChart(recipe), linkedSource: { kind: 'widget' as const, sourceWidgetId: table.id } };
  installDashboard(riskDashboard([a, table, chart]));
  const originalSync = tableExecutionStore.syncDashboard;
  const sync = vi.spyOn(tableExecutionStore, 'syncDashboard');
  const readFile = fs.readFile;
  const pathB = 'files/' + b.params.file;
  let rejectB!: (error: Error) => void;
  const held = new Promise<Uint8Array<ArrayBuffer>>((_, reject) => { rejectB = reject; });
  const read = vi.spyOn(fs, 'readFile').mockImplementation((path, opts) => path === pathB ? held : readFile(path, opts));
  try {
    render(<LiveRiskChart/>);
    const first = await screen.findByTestId('chart-plot');
    const figureA = vi.mocked(renderPlot).mock.lastCall![1];
    const jobs = run.mock.calls.length;
    sync.mockImplementation(() => {});
    await act(async () => installDashboard(riskDashboard([b, table, chart])));
    expect(first).not.toBeInTheDocument();
    expect(run).toHaveBeenCalledTimes(jobs);
    sync.mockImplementation(originalSync);
    act(() => tableExecutionStore.syncDashboard(useDashboardStore.getState().dashboards[0]));
    await waitFor(() => expect(read.mock.calls.some(([path]) => path === pathB)).toBe(true));
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    expect(screen.queryByText(/showing completed data \(stale\)/i)).toBeNull();
    await act(async () => { rejectB(new Error('Replacement failed')); await tableExecutionStore.settled('d'); });
    expect(screen.getAllByRole('alert').map(node => node.textContent)).toEqual(['Source T: Source A: Replacement failed']);
    expect(screen.queryByTestId('chart-plot')).toBeNull();
    read.mockImplementation(readFile);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByTestId('chart-plot');
    expect(vi.mocked(renderPlot).mock.lastCall![1].data).not.toEqual(figureA.data);
    read.mockImplementation((path, opts) => path === pathB ? Promise.reject(new Error('Refresh failed')) : readFile(path, opts));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByRole('alert');
    expect(screen.getByTestId('chart-plot')).toBeVisible();
    expect(screen.getAllByText(/showing completed data \(stale\)/i)).toHaveLength(1);
  } finally { read.mockRestore(); sync.mockRestore(); factory.mockRestore(); }
});

it.each([
  { recipe: etfOptions, details: 'ETF holdings details', acquire: (id: string) => etfSource(id, .27) },
  { recipe: overlayOptions, details: 'Overlay observations', acquire: (id: string) => overlaySource(id, 310) },
  { recipe: revisionSlope, details: 'Estimate revision observations', acquire: (id: string) => estimateHistorySource(id, revisionHistory([[10, null, 12]])) },
  { recipe: capMap, details: 'Market map details', acquire: (id: string) => estimateHistorySource(id, marketSession()) },
])('keeps stale $recipe.kind at the admitted size while Parameters toggles', async ({ recipe, details, acquire }) => {
  const { factory, run, resize } = riskRuntime();
  const a = await acquire('A'), b = await acquire('B');
  installDashboard(riskDashboard([a, b, riskChart(recipe)]));
  const readFile = fs.readFile;
  let rejectRefresh!: (error: Error) => void;
  const held = new Promise<Uint8Array<ArrayBuffer>>((_, reject) => { rejectRefresh = reject; });
  const read = vi.spyOn(fs, 'readFile');
  try {
    render(<LiveRiskChart/>);
    const plot = await screen.findByTestId('chart-plot');
    const draw = vi.mocked(renderPlot);
    const admitted = draw.mock.lastCall!;
    const summary = screen.getByText(details, { exact: true });
    fireEvent.click(summary);
    const requests = run.mock.calls.length;
    read.mockImplementation((path, options) => path === 'files/' + a.params.file ? held : readFile(path, options));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Showing completed data (stale).')).toBeVisible();
    openParameters();
    act(() => resize(660, 310));
    expect(screen.getByTestId('chart-plot')).toBe(plot);
    expect(draw.mock.lastCall).toEqual(admitted);
    await act(async () => { rejectRefresh(new Error('Refresh failed')); await tableExecutionStore.settled('d'); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Refresh failed');
    fireEvent.click(screen.getByRole('button', { name: 'Hide parameters' }));
    act(() => resize(850, 390));
    openParameters();
    act(() => resize(660, 310));
    expect(screen.getByTestId('chart-plot')).toBe(plot);
    expect(screen.getByText(details, { exact: true })).toBe(summary);
    expect(summary.closest('details')).toHaveAttribute('open');
    expect(draw.mock.lastCall).toEqual(admitted);
    expect(run).toHaveBeenCalledTimes(requests);
    read.mockImplementation(readFile);
    await chooseRiskSource('B');
    expect(plot).not.toBeInTheDocument();
    expect(screen.queryByText('Showing completed data (stale).')).toBeNull();
  } finally { read.mockRestore(); factory.mockRestore(); }
});

it.each(['before observer', 'after observer'])('rejects a zero-width news draft %s', async timing => {
  const { factory, resize, setSize } = riskRuntime();
  const a = await acquiredSource(calendarOptions, 'A');
  const linkedChart = { type: 'column' as const, category: 'url', measures: ['polarity'], display: 'grouped' as const };
  installDashboard(riskDashboard([a, { ...riskChart(calendarOptions), linkedChart }]));
  const save = vi.spyOn(useDashboardStore.getState(), 'commitLinkedChartSettings');
  try {
    render(<LiveRiskChart/>);
    const plot = await screen.findByTestId('chart-plot');
    const parameters = openParameters();
    fireEvent.change(parameters.getByLabelText('Chart type'), { target: { value: calendarOptions.kind } });
    const apply = parameters.getByRole('button', { name: 'Apply chart settings' });
    await waitFor(() => expect(apply).toBeEnabled());
    if (timing === 'before observer') setSize(0);
    else act(() => resize(0));
    fireEvent.click(apply);
    expect(save).not.toHaveBeenCalled();
    act(() => resize(0));
    expect(apply).toBeDisabled();
    expect(screen.getByTestId('chart-plot')).toBe(plot);
    act(() => resize(900));
    await waitFor(() => expect(apply).toBeEnabled());
  } finally { save.mockRestore(); factory.mockRestore(); }
});

it('rejects a queued news draft when its probe unmounts with the source still ready', async () => {
  const { factory } = riskRuntime();
  const a = await acquiredSource(calendarOptions, 'A');
  const linkedChart = { type: 'column' as const, category: 'url', measures: ['polarity'], display: 'grouped' as const };
  installDashboard(riskDashboard([a, { ...riskChart(calendarOptions), linkedChart }]));
  const commit = useDashboardStore.getState().commitLinkedChartSettings;
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const save = vi.spyOn(useDashboardStore.getState(), 'commitLinkedChartSettings').mockImplementationOnce(async (...args) => {
    await pending;
    return commit(...args);
  });
  try {
    const { container, rerender } = render(<LiveRiskChart/>);
    const plot = await screen.findByTestId('chart-plot');
    const parameters = openParameters();
    fireEvent.change(parameters.getByLabelText('Chart type'), { target: { value: calendarOptions.kind } });
    const apply = parameters.getByRole('button', { name: 'Apply chart settings' });
    await waitFor(() => expect(apply).toBeEnabled());
    fireEvent.click(apply);
    expect(save).toHaveBeenCalledTimes(1);
    rerender(<LiveRiskChart viewer/>);
    expect(container.querySelector('.news-calendar-width-probe')).toBeNull();
    expect(tableExecutionStore.readView('d', 'chart').status).toBe('ready');
    await act(async () => finish());
    expect(screen.getByRole('alert')).toHaveTextContent(/source or drawing size changed/i);
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1].linkedChart).toEqual(linkedChart);
    expect(screen.getByTestId('chart-plot')).toBe(plot);
  } finally { finish(); save.mockRestore(); factory.mockRestore(); }
});

it.each([
  { recipe: calendarOptions, category: 'url', measure: 'polarity', initialWidth: 900, changedSize: [800, 430] as const },
  { recipe: calendarOptions, category: 'url', measure: 'polarity', initialWidth: 10_010, changedSize: [10_020, 430] as const },
  { recipe: returnOptions, category: 'date', measure: 'adjusted_close', initialWidth: 900, changedSize: [900, 380] as const },
  { recipe: ownershipOptions, category: 'symbol', measure: 'percent_insiders', initialWidth: 900, changedSize: [900, 380] as const },
])('fences $recipe.kind queued Apply against the live drawing size from width $initialWidth', async ({ recipe, category, measure, initialWidth, changedSize }) => {
  const { factory, resize, setSize } = riskRuntime();
  setSize(initialWidth);
  const a = await acquiredSource(recipe, 'A');
  const linkedChart = { type: 'column' as const, category, measures: [measure], display: 'grouped' as const };
  installDashboard(riskDashboard([a, { ...riskChart(recipe), linkedChart }]));
  expect(vi.isMockFunction(useDashboardStore.getState().commitLinkedChartSettings), 'fresh test state must use the real commit method').toBe(false);
  const commit = useDashboardStore.getState().commitLinkedChartSettings;
  const save = vi.spyOn(useDashboardStore.getState(), 'commitLinkedChartSettings');
  let finish: (() => void) | undefined;
  const holdSave = () => {
    const pending = new Promise<void>(resolve => { finish = resolve; });
    save.mockImplementationOnce(async (...args) => { await pending; return commit(...args); });
  };
  const current = () => useDashboardStore.getState().dashboards[0].tabs[0].cards[1].linkedChart;
  try {
    render(<LiveRiskChart/>);
    const plot = await screen.findByTestId('chart-plot');
    const parameters = openParameters();
    fireEvent.change(parameters.getByLabelText('Chart type'), { target: { value: recipe.kind } });
    if (recipe.kind === 'return-summary') fireEvent.click(await parameters.findByRole('checkbox', { name: 'A.US' }));
    const apply = parameters.getByRole('button', { name: 'Apply chart settings' });
    await waitFor(() => expect(apply).toBeEnabled());
    holdSave();
    fireEvent.click(apply);
    expect(save).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Hide parameters' }));
    setSize(changedSize[0], changedSize[1]);
    await act(async () => finish?.());
    expect(current()).toEqual(linkedChart);
    expect(screen.getByRole('alert')).toHaveTextContent(/source or drawing size changed/i);
    expect(screen.getByTestId('chart-plot')).toBe(plot);

    act(() => resize(changedSize[0], changedSize[1]));
    openParameters();
    await waitFor(() => expect(apply).toBeEnabled());
    holdSave();
    fireEvent.click(apply);
    expect(save).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Hide parameters' }));
    await act(async () => finish?.());
    expect(current()?.type).toBe(recipe.kind);
  } finally { finish?.(); save.mockRestore(); factory.mockRestore(); }
});

it.each(['missing binding', 'filtered series'])('opens Parameters from the basic chart diagnosis for %s', async failure => {
  const { factory } = riskRuntime();
  const file = await saveLocalFile(new File(['region,team,revenue\n2024,AMD,100\n2024,AVGO,200\n'], 'prices.csv'));
  const pivot = { enabled: true, grouping: ['region'], split: ['team'], measures: [
    { id: 'sales', sourceFieldId: 'revenue', aggregation: 'sum' as const },
  ] };
  const root = { ...source, id: 'A', params: { file }, table: { pivot } };
  const draft = riskChart(capMap);
  const workspace = riskDashboard([root, draft]);
  installDashboard(workspace);
  try {
    tableExecutionStore.syncDashboard(workspace);
    tableExecutionStore.ensureTable('d', draft.id);
    await tableExecutionStore.settled('d');
    const columns = tableExecutionStore.readView('d', draft.id).ready!.columns;
    const measures = columns.filter(column => column.measureId === 'sales').map(column => column.id);
    expect(measures).toHaveLength(2);
    const linkedChart = { type: 'column' as const, category: columns[0].id, measures, display: 'grouped' as const };
    act(() => installDashboard(riskDashboard([root, { ...draft, linkedChart }])));
    render(<LiveRiskChart/>);
    const plot = await screen.findByTestId('chart-plot');
    await act(async () => {
      const definition = failure === 'missing binding'
        ? { table: { pivot: { ...pivot, measures: [{ ...pivot.measures[0], id: 'new-sales' }] } }, search: '' }
        : { table: { pivot }, search: 'no matching company' };
      tableExecutionStore.updateDefinition('d', root.id, definition, { kind: 'none' });
      await tableExecutionStore.settled('d');
    });
    if (failure === 'missing binding') {
      expect(await screen.findByRole('alert')).toHaveTextContent('Repair chart fields');
      expect(screen.getByTestId('chart-plot')).toBe(plot);
    } else {
      expect(await screen.findByText('No selected series match the current filter.')).toBeVisible();
      expect(screen.queryByTestId('chart-plot')).toBeNull();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Open Parameters' }));
    const parameters = screen.getByRole('region', { name: 'Parameters' });
    expect(within(parameters).getByRole('button', { name: 'Choose source' })).toHaveFocus();
    expect(within(parameters).getByRole('button', { name: /^Measures/ })).toBeVisible();
  } finally { factory.mockRestore(); }
});
