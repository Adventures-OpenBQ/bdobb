// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createTableExecutionStore } from '../../stores/tableExecutionStore';
import { createWorkerExecutor } from '../../lib/tableExecution/workerClient';
import { Boundary } from '../../test/tableWorkerBoundary';
import { input } from '../../lib/tableExecution/fixtures';
import type { Dashboard } from '../../lib/types';
import type { ChartResult } from '../../lib/tableExecution/types';
import { useSettingsStore } from '../../stores/settingsStore';
import { DEFAULT_SETTINGS } from '../../lib/settingsFile';
import { useEffect, useState, type ComponentProps } from 'react';
import { LinkedChartRenderer as Renderer } from './LinkedChartRenderer';
import { liveDailyPriceDataset } from '../../test/fixtures/liveDailyPrices';
import type { ReturnSummaryOptions } from '../../lib/widgetData/chartRecipes/types';

function LinkedChartRenderer(props: Omit<ComponentProps<typeof Renderer>, 'parametersTarget' | 'onOpenParameters'>) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  return <>
    <div ref={setTarget}/>
    <Renderer {...props} parametersTarget={target} onOpenParameters={() => {}}/>
  </>;
}

vi.mock('./ChartRenderer', () => {
    const size = { width: 900, height: 540 };
    return {
        ChartRenderer: ({ data, onDrawingSurfaceChange }: {
            data: unknown;
            onDrawingSurfaceChange?: (size: { width: number; height: number }) => void;
        }) => {
            useEffect(() => onDrawingSurfaceChange?.(size), [onDrawingSurfaceChange]);
            return <div className="chart-plot">{data === undefined && onDrawingSurfaceChange ? null : <pre data-testid="figure">{JSON.stringify(data)}</pre>}</div>;
        },
        readDrawingSurface: () => size,
    };
});
const settings = { type: 'column' as const, category: 'region', measures: ['revenue'], display: 'grouped' as const };
const chart = { id: 'c', widgetId: 'linked_chart', backendId: 'builtin', params: {}, layout: { x: 0, y: 0, w: 1, h: 1 }, linkedSource: { kind: 'widget' as const, sourceWidgetId: 's' }, linkedChart: settings };
async function setup(context = {}) { const store = createTableExecutionStore({ executor: id => createWorkerExecutor(id, () => new Boundary() as unknown as Worker), source: () => ({ acquire: async () => ({ kind: 'dataset', dataset: { ...input, ...context, rows: Array.from({ length: 1600 }, (_, i) => ({ id: `r${i}`, values: { region: 'A', revenue: i } })) } }) }) }); store.syncDashboard({ id: 'd', name: 'D', tabs: [{ id: 't', name: 'T', cards: [{ ...chart, id: 's', widgetId: 'local_table', params: { file: 'x' }, linkedSource: undefined, linkedChart: undefined }, chart] }] } as Dashboard); store.ensureTable('d', 'c'); await store.settled('d'); return store; }
afterEach(cleanup);
it('consumes all eligible worker rows and changes only presentation settings through durable callback', async () => { const store = await setup(); const before = store.readView('d', 's'); const commit = vi.fn(async () => true); render(<LinkedChartRenderer dashboardId="d" card={chart} refreshKey={0} store={store} onSettingsChange={commit}/>); await screen.findByTestId('figure'); const f = JSON.parse(screen.getByTestId('figure').textContent!); expect(f.data[0].y).toHaveLength(1600); fireEvent.change(screen.getByLabelText('Chart type'), { target: { value: 'line' } }); await waitFor(() => expect(commit).toHaveBeenCalledWith({ ...settings, type: 'line' })); expect(store.readView('d', 's')).toBe(before); cleanup(); store.disposeDashboard('d'); });
it('retains the coherent completed figure while newer delivery is pending or fails, then fences stale mapping response', async () => { const store = await setup(); const e = store.readExecutor('d', 's')!; const real = e.chartData.bind(e); let release!: () => void; const { rerender } = render(<LinkedChartRenderer dashboardId="d" card={chart} refreshKey={0} store={store} onSettingsChange={async () => true}/>); await screen.findByTestId('figure'); const old = screen.getByTestId('figure').textContent; e.chartData = async (...args) => { const result = await real(...args); return new Promise<ChartResult>(resolve => { release = () => resolve(result); }); }; await act(async () => { store.updateDefinition('d', 's', { table: {}, search: 'A' }, { kind: 'none' }); await store.settled('d'); }); await waitFor(() => expect(release).toBeDefined()); expect(screen.getByTestId('figure').textContent).toBe(old); expect(screen.getByText(/Updating chart/)).toBeTruthy(); rerender(<LinkedChartRenderer dashboardId="d" card={{ ...chart, linkedChart: { ...settings, measures: ['missing'] } }} refreshKey={0} store={store} onSettingsChange={async () => true}/>); expect(await screen.findByRole('alert')).toHaveTextContent(/missing.*unavailable/); await act(async () => release()); expect(screen.getByTestId('figure').textContent).toBe(old); cleanup(); store.disposeDashboard('d'); });
it('refresh requests root once and never on initial mount; persistence failure remains actionable', async () => { const store = await setup(); const refresh = vi.spyOn(store, 'refresh'); const props = { dashboardId: 'd', card: chart, store, onSettingsChange: async () => { throw new Error('disk failed'); } }; const { rerender } = render(<LinkedChartRenderer {...props} refreshKey={0}/>); await screen.findByTestId('figure'); expect(refresh).not.toHaveBeenCalled(); rerender(<LinkedChartRenderer {...props} refreshKey={1}/>); expect(refresh).toHaveBeenCalledTimes(1); fireEvent.change(screen.getByLabelText('Chart type'), { target: { value: 'line' } }); expect(await screen.findByRole('alert')).toHaveTextContent('disk failed'); expect(screen.getByLabelText('Chart type')).toHaveValue('column'); cleanup(); store.disposeDashboard('d'); });
it('replacement and unmount abort pending reads and late old-source data cannot overwrite completed data', async () => {
    const store = await setup();
    const e = store.readExecutor('d', 's')!;
    const real = e.chartData.bind(e);
    let release!: () => void;
    let signal!: AbortSignal;
    const props = { dashboardId: 'd', card: chart, refreshKey: 0, store, onSettingsChange: async () => true };
    const { rerender, unmount } = render(<LinkedChartRenderer {...props}/>);
    await screen.findByTestId('figure');
    const old = screen.getByTestId('figure').textContent;
    e.chartData = async (...args) => { signal = args[2]; const result = await real(...args); return new Promise<ChartResult>(resolve => { release = () => resolve(result); }); };
    await act(async () => { store.updateDefinition('d', 's', { table: {}, search: 'A' }, { kind: 'none' }); await store.settled('d'); });
    await waitFor(() => expect(release).toBeDefined());
    rerender(<LinkedChartRenderer {...props} card={{ ...chart, linkedSource: { kind: 'widget', sourceWidgetId: 'other' } }}/>);
    expect(signal.aborted).toBe(true);
    await act(async () => release());
    expect(screen.getByTestId('figure').textContent).toBe(old);
    rerender(<LinkedChartRenderer {...props}/>);
    await waitFor(() => expect(signal.aborted).toBe(false));
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => release());
    store.disposeDashboard('d');
});
it('failed chart transport retains its completed figure and exposes the delivery diagnostic', async () => {
    const store = await setup();
    const props = { dashboardId: 'd', card: chart, refreshKey: 0, store, onSettingsChange: async () => true };
    render(<LinkedChartRenderer {...props}/>);
    await screen.findByTestId('figure');
    const old = screen.getByTestId('figure').textContent;
    store.readExecutor('d', 's')!.chartData = async () => { throw new Error('transport down'); };
    await act(async () => { store.updateDefinition('d', 's', { table: {}, search: 'A' }, { kind: 'none' }); await store.settled('d'); });
    expect(await screen.findByRole('alert')).toHaveTextContent('transport down');
    expect(screen.getByTestId('figure').textContent).toBe(old);
    cleanup();
    store.disposeDashboard('d');
});
it('shows the completed sample context and upstream diagnostics with its figure', async () => {
    const store = await setup({ completeness: { kind: 'sample', warnings: ['Only 1600 sampled rows'] }, diagnostics: [{ code: 'PARTIAL', message: 'Provider coverage incomplete', severity: 'warning' }] });
    render(<LinkedChartRenderer dashboardId="d" card={chart} refreshKey={0} store={store} onSettingsChange={async () => true}/>);
    await screen.findByTestId('figure');
    expect(screen.getByText('sample data')).toBeTruthy();
    expect(screen.getByText('Only 1600 sampled rows')).toBeTruthy();
    expect(screen.getByText('Provider coverage incomplete')).toBeTruthy();
    cleanup();
    store.disposeDashboard('d');
});

it('binds both duplicate instances and blocks a deleted binding even after another instance is added', async () => {
    const measures = [{ id: 'revenue', sourceFieldId: 'revenue', aggregation: 'mean' as const }, { id: 'total-copy', sourceFieldId: 'revenue', aggregation: 'sum' as const }];
    const store = createTableExecutionStore({ executor: id => createWorkerExecutor(id, () => new Boundary() as unknown as Worker), source: () => ({ acquire: async () => ({ kind: 'dataset', dataset: input }) }) });
    const source = { ...chart, id: 's', widgetId: 'local_table', params: { file: 'x' }, linkedSource: undefined, linkedChart: undefined, table: { pivot: { enabled: true, grouping: ['region'], split: [], measures } } };
    const child = { ...chart, id: 'child', widgetId: 'linked_table', linkedChart: undefined };
    store.syncDashboard({ id: 'd', name: 'D', tabs: [{ id: 't', name: 'T', cards: [source, child, chart] }] } as Dashboard);
    store.ensureTable('d', 'child'); store.ensureTable('d', 'c'); await store.settled('d');
    expect(store.readView('d', 'child').ready!.inspection.inputColumns.map(c => c.id)).toEqual(store.readView('d', 's').ready!.columns.map(c => c.id));
    const category = store.readView('d', 's').ready!.columns[0].id;
    const boundChart = { ...chart, linkedChart: { ...settings, category, measures: measures.map(m => m.id) } };
    render(<LinkedChartRenderer dashboardId="d" card={boundChart} refreshKey={0} store={store} onSettingsChange={async () => true} />);
    await screen.findByTestId('figure');
    const figure = JSON.parse(screen.getByTestId('figure').textContent!);
    expect(figure.data.map((t: { name: string; y: number[] }) => ({ name: t.name, y: t.y }))).toEqual([{ name: 'Revenue — Average', y: [15, 90] }, { name: 'Revenue — Total', y: [30, 90] }]);
    await act(async () => { store.updateDefinition('d', 's', { table: { pivot: { ...source.table.pivot, measures: [measures[0], { ...measures[1], id: 'new-copy' }] } }, search: '' }, { kind: 'none' }); await store.settled('d'); });
    expect(await screen.findByRole('alert')).toHaveTextContent('total-copy is unavailable. Repair chart fields.');
    const totalChoices = screen.getAllByRole('checkbox', { name: 'Revenue — Total' });
    expect(totalChoices[0]).toBeChecked();
    expect(totalChoices[1]).not.toBeChecked();
    expect(screen.getByTestId('figure').textContent).toBe(JSON.stringify(figure));
    cleanup(); store.disposeDashboard('d');
});

it('keeps a settings save failure visible after a successful source recalculation until a settings retry succeeds', async () => {
    const store = await setup();
    let canSave = false;
    render(<LinkedChartRenderer dashboardId="d" card={chart} refreshKey={0} store={store} onSettingsChange={async () => canSave}/>);
    await screen.findByTestId('figure');
    fireEvent.change(screen.getByLabelText('Chart type'), { target: { value: 'line' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Chart settings could not be saved.');
    await act(async () => { store.updateDefinition('d', 's', { table: {}, search: 'A' }, { kind: 'none' }); await store.settled('d'); });
    expect(screen.getByRole('alert')).toHaveTextContent('Chart settings could not be saved.');
    canSave = true;
    fireEvent.change(screen.getByLabelText('Chart type'), { target: { value: 'line' } });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    cleanup(); store.disposeDashboard('d');
});

it.each([false, true])('keeps split bindings through filters and fresh reopen without showing stale companies (analytical=%s)', async analytical => {
    const { migratePivot } = await import('../../lib/tableModel/migration');
    const pivot = { enabled: true, grouping: ['region'], split: ['team'], measures: [{ id: 'sales', sourceFieldId: 'revenue', aggregation: 'sum' as const }] };
    const data = { ...input, rows: [{ id: 'amd', values: { region: '2024', team: 'AMD', revenue: 100 } }, { id: 'avgo', values: { region: '2024', team: 'AVGO', revenue: 200 } }] };
    const store = createTableExecutionStore({ executor: id => createWorkerExecutor(id, () => new Boundary() as unknown as Worker), source: () => ({ acquire: async () => ({ kind: 'dataset', dataset: data }) }) });
    const source = { ...chart, id: 's', widgetId: 'local_table', params: { file: 'x' }, linkedSource: undefined, linkedChart: undefined, table: { pivot } };
    store.syncDashboard({ id: 'd', name: 'D', tabs: [{ id: 't', name: 'T', cards: [source, chart] }] } as Dashboard);
    store.ensureTable('d', 'c'); await store.settled('d');
    const definition = { table: { pivot }, search: '', ...(analytical ? { analytical: migratePivot(pivot, { columns: data.columns }) } : {}) };
    await act(async () => { store.updateDefinition('d', 's', definition, { kind: 'none' }); await store.settled('d'); });
    const columns = store.readView('d', 's').ready!.columns;
    const category = columns[0].id, measures = columns.filter(c => c.measureId === 'sales').map(c => c.id);
    expect(measures).toHaveLength(2);
    const boundChart = { ...chart, linkedChart: { ...settings, category, measures } };
    const props = { dashboardId: 'd', card: boundChart, refreshKey: 0, store, onSettingsChange: async () => true };
    render(<LinkedChartRenderer {...props}/>); await screen.findByTestId('figure');
    const apply = async (search: string) => act(async () => { store.updateDefinition('d', 's', { ...definition, search }, { kind: 'none' }); await store.settled('d'); });
    await apply('AMD');
    await waitFor(() => expect(JSON.parse(screen.getByTestId('figure').textContent!).data).toHaveLength(1));
    expect(JSON.parse(screen.getByTestId('figure').textContent!).data[0]).toMatchObject({ name: 'AMD — Revenue — Total', y: [100] });
    expect(screen.queryByRole('alert')).toBeNull();
    cleanup(); render(<LinkedChartRenderer {...props}/>); await screen.findByTestId('figure');
    expect(JSON.parse(screen.getByTestId('figure').textContent!).data).toHaveLength(1);
    await apply('no matching company');
    await screen.findByText('No selected series match the current filter.');
    expect(screen.queryByTestId('figure')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    await apply(''); await screen.findByTestId('figure');
    expect(JSON.parse(screen.getByTestId('figure').textContent!).data).toHaveLength(2);
    expect(boundChart.linkedChart.measures).toEqual(measures);
    cleanup(); store.disposeDashboard('d');
});

async function setupRows(rows: { region: string; revenue: number | null; cost?: number }[]) {
    const store = createTableExecutionStore({ executor: id => createWorkerExecutor(id, () => new Boundary() as unknown as Worker), source: () => ({ acquire: async () => ({ kind: 'dataset', dataset: { ...input, columns: [...input.columns, { id: 'cost', label: 'Cost', dtype: 'number' as const }], rows: rows.map((r, i) => ({ id: `r${i}`, values: { cost: 1, ...r } })) } }) }) });
    store.syncDashboard({ id: 'd', name: 'D', tabs: [{ id: 't', name: 'T', cards: [{ ...chart, id: 's', widgetId: 'local_table', params: { file: 'x' }, linkedSource: undefined, linkedChart: undefined }, chart] }] } as Dashboard);
    store.ensureTable('d', 'c'); await store.settled('d'); return store;
}
const withSettings = (store: Awaited<ReturnType<typeof setup>>, s: object, commit = vi.fn(async (_: unknown) => true)) => ({ dashboardId: 'd', card: { ...chart, linkedChart: { ...settings, ...s } }, refreshKey: 0, store, onSettingsChange: commit });
it('offers 100% stacked and series-from only for the types that use them', async () => {
    const store = await setup();
    const opts = () => [...screen.getByLabelText('Display').querySelectorAll('option')].map(o => o.value);
    for (const type of ['column', 'bar']) {
        const { unmount } = render(<LinkedChartRenderer {...withSettings(store, { type })}/>);
        expect(opts()).toEqual(['grouped', 'stacked', 'percent']);
        expect(screen.getByRole('option', { name: '100% stacked' })).toHaveValue('percent');
        expect(screen.getByLabelText('Series from')).toBeTruthy();
        unmount();
    }
    const line = render(<LinkedChartRenderer {...withSettings(store, { type: 'line' })}/>);
    expect(screen.queryByLabelText('Display')).toBeNull(); expect(screen.getByLabelText('Series from')).toBeTruthy(); line.unmount();
    render(<LinkedChartRenderer {...withSettings(store, { type: 'pie' })}/>);
    expect(screen.queryByLabelText('Display')).toBeNull(); expect(screen.queryByLabelText('Series from')).toBeNull();
    expect(screen.getByRole('option', { name: 'Pie' })).toHaveValue('pie');
    cleanup();
    render(<LinkedChartRenderer {...withSettings(store, { type: 'waterfall' })}/>);
    expect(screen.queryByLabelText('Display')).toBeNull(); expect(screen.queryByLabelText('Series from')).toBeNull();
    expect(screen.getByRole('option', { name: 'Waterfall' })).toHaveValue('waterfall');
    cleanup(); store.disposeDashboard('d');
});
it('switching to waterfall drops series-from and 100% stacked', async () => {
    const store = await setup(); const commit = vi.fn(async (_: unknown) => true);
    render(<LinkedChartRenderer {...withSettings(store, { display: 'percent', seriesFrom: 'rows' }, commit)}/>);
    fireEvent.change(screen.getByLabelText('Chart type'), { target: { value: 'waterfall' } });
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    expect(commit.mock.lastCall![0]).toMatchObject({ type: 'waterfall', display: 'stacked' }); expect(commit.mock.lastCall![0]).not.toHaveProperty('seriesFrom');
    cleanup(); store.disposeDashboard('d');
});
it('a waterfall refusal clears a drawn chart and shows a status line, not an alert', async () => {
    const store = await setupRows([{ region: 'cash', revenue: 10 }]);
    const { rerender } = render(<LinkedChartRenderer {...withSettings(store, {})}/>);
    await screen.findByTestId('figure');
    rerender(<LinkedChartRenderer {...withSettings(store, { type: 'waterfall' })}/>);
    await waitFor(() => expect(screen.queryByTestId('figure')).toBeNull());
    expect(screen.getByText('Waterfall needs an income statement table')).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('alert')).toBeNull(); expect(screen.queryByText(/stale/)).toBeNull();
    cleanup(); store.disposeDashboard('d');
});
it('bullet commits grouped without seriesFrom, hides Display and Series from, and leaving it drops period', async () => {
    const store = await setup(); const commit = vi.fn(async (_: unknown) => true);
    render(<LinkedChartRenderer {...withSettings(store, { display: 'percent', seriesFrom: 'rows' }, commit)}/>);
    fireEvent.change(screen.getByLabelText('Chart type'), { target: { value: 'bullet' } });
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    expect(commit.mock.lastCall![0]).toMatchObject({ type: 'bullet', display: 'grouped' }); expect(commit.mock.lastCall![0]).not.toHaveProperty('seriesFrom');
    cleanup(); const c2 = vi.fn(async (_: unknown) => true);
    render(<LinkedChartRenderer {...withSettings(store, { type: 'bullet', display: 'grouped', period: 'FQ3 2026' }, c2)}/>);
    expect(screen.queryByLabelText('Display')).toBeNull(); expect(screen.queryByLabelText('Series from')).toBeNull();
    fireEvent.change(screen.getByLabelText('Chart type'), { target: { value: 'column' } });
    await waitFor(() => expect(c2).toHaveBeenCalledTimes(1));
    expect(c2.mock.lastCall![0]).toMatchObject({ type: 'column' }); expect(c2.mock.lastCall![0]).not.toHaveProperty('period');
    cleanup(); store.disposeDashboard('d');
});
it('commits new values and resets fields the new type cannot use', async () => {
    const store = await setup(); const commit = vi.fn(async (_: unknown) => true);
    render(<LinkedChartRenderer {...withSettings(store, { display: 'percent', seriesFrom: 'rows' }, commit)}/>);
    fireEvent.change(screen.getByLabelText('Chart type'), { target: { value: 'line' } });
    await waitFor(() => expect(commit).toHaveBeenLastCalledWith({ ...settings, type: 'line', display: 'stacked', seriesFrom: 'rows' }));
    fireEvent.change(screen.getByLabelText('Chart type'), { target: { value: 'pie' } });
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(2));
    expect(commit.mock.lastCall![0]).toMatchObject({ type: 'pie', display: 'stacked' }); expect(commit.mock.lastCall![0]).not.toHaveProperty('seriesFrom');
    cleanup(); const c2 = vi.fn(async (_: unknown) => true);
    render(<LinkedChartRenderer {...withSettings(store, {}, c2)}/>);
    fireEvent.change(screen.getByLabelText('Display'), { target: { value: 'percent' } });
    await waitFor(() => expect(c2).toHaveBeenLastCalledWith({ ...settings, display: 'percent' }));
    fireEvent.change(screen.getByLabelText('Series from'), { target: { value: 'rows' } });
    await waitFor(() => expect(c2).toHaveBeenLastCalledWith({ ...settings, seriesFrom: 'rows' }));
    cleanup(); store.disposeDashboard('d');
});
it('a refusal clears a drawn chart and shows a status line, not an alert', async () => {
    const store = await setupRows([{ region: 'cash', revenue: 10 }, { region: 'treasury_stock', revenue: -5 }]);
    const { rerender } = render(<LinkedChartRenderer {...withSettings(store, {})}/>);
    await screen.findByTestId('figure');
    rerender(<LinkedChartRenderer {...withSettings(store, { type: 'pie' })}/>);
    await waitFor(() => expect(screen.queryByTestId('figure')).toBeNull());
    expect(screen.getByText(/^Can't show shares of negative values: treasury_stock/)).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('alert')).toBeNull(); expect(screen.queryByText(/stale/)).toBeNull();
    rerender(<LinkedChartRenderer {...withSettings(store, {})}/>);
    await screen.findByTestId('figure'); expect(screen.queryByText(/^Can't show shares/)).toBeNull();
    cleanup(); store.disposeDashboard('d');
});
it('a failed fetch after a refusal shows the load error, not the old refusal', async () => {
    const store = await setupRows([{ region: 'cash', revenue: 10 }, { region: 'treasury_stock', revenue: -5 }]);
    render(<LinkedChartRenderer {...withSettings(store, { type: 'pie' })}/>);
    expect(await screen.findByText(/^Can't show shares of negative values/)).toBeTruthy();
    store.readExecutor('d', 's')!.chartData = async () => { throw new Error('transport down'); };
    await act(async () => { store.updateDefinition('d', 's', { table: {}, search: 'cash' }, { kind: 'none' }); await store.settled('d'); });
    expect(await screen.findByRole('alert')).toHaveTextContent('transport down');
    expect(screen.queryByText(/^Can't show shares/)).toBeNull();
    cleanup(); store.disposeDashboard('d');
});
it('pie with two measures says choose one as a status line', async () => {
    const store = await setupRows([{ region: 'cash', revenue: 10 }]);
    render(<LinkedChartRenderer {...withSettings(store, { type: 'pie', measures: ['revenue', 'cost'] })}/>);
    expect(await screen.findByText('Pie shows one measure — choose one')).toHaveAttribute('role', 'status');
    expect(screen.queryByTestId('figure')).toBeNull(); expect(screen.queryByRole('alert')).toBeNull();
    cleanup(); store.disposeDashboard('d');
});
it('missing values are listed under a drawn share chart', async () => {
    const store = await setupRows([{ region: 'cash', revenue: 10 }, { region: 'inventory', revenue: null }]);
    render(<LinkedChartRenderer {...withSettings(store, { type: 'pie' })}/>);
    await screen.findByTestId('figure'); expect(screen.getByText(/^Missing: inventory/)).toBeTruthy();
    cleanup(); store.disposeDashboard('d');
});
it('rows mode gives duplicate category values disambiguated names', async () => {
    const store = await setup();
    render(<LinkedChartRenderer {...withSettings(store, { seriesFrom: 'rows' })}/>);
    await screen.findByTestId('figure'); const f = JSON.parse(screen.getByTestId('figure').textContent!);
    expect(f.data).toHaveLength(1600); expect(f.data[0].name).toBe('A'); expect(f.data[1].name).toBe('A (2)');
    cleanup(); store.disposeDashboard('d');
});

const bulletColumns = [['fiscal_period', 'text'], ['period_ending', 'date'], ['eps_actual', 'number'], ['eps_low', 'number'], ['eps_avg', 'number'], ['eps_high', 'number'], ['eps_consensus', 'number'], ['revenue_actual', 'number'], ['revenue_low', 'number']].map(([id, dtype]) => ({ id, label: id, dtype: dtype as 'text' | 'date' | 'number' }));
const quarter = (fiscal_period: string, period_ending: string, eps: number) => ({ id: fiscal_period, values: { fiscal_period, period_ending, eps_actual: eps, eps_low: eps - 0.1, eps_avg: eps - 0.02, eps_high: eps + 0.1, eps_consensus: eps - 0.03, revenue_actual: eps * 1000, revenue_low: eps * 900 } });
const bulletSettings = { type: 'bullet' as const, category: 'fiscal_period', measures: ['eps_actual'], display: 'grouped' as const };
async function bulletSetup(hidden: string[] = []) {
    const data = { ...input, provenance: { ...input.provenance, receipt: { symbol: 'ALDER' } }, columns: bulletColumns, rows: [quarter('Q1', '2026-03-31', 1.2345), quarter('Q2', '2026-06-30', 1.3456)] };
    const store = createTableExecutionStore({ executor: id => createWorkerExecutor(id, () => new Boundary() as unknown as Worker), source: () => ({ acquire: async () => ({ kind: 'dataset', dataset: data }) }) });
    const card = { ...chart, linkedChart: bulletSettings };
    store.syncDashboard({ id: 'd', name: 'D', tabs: [{ id: 't', name: 'T', cards: [{ ...chart, id: 's', widgetId: 'local_table', params: { file: 'x' }, linkedSource: undefined, linkedChart: undefined }, card] }] } as Dashboard);
    store.ensureTable('d', 'c'); await store.settled('d');
    if (hidden.length)
        await act(async () => { store.updateDefinition('d', 's', { table: { hidden }, search: '' }, { kind: 'none' }); await store.settled('d'); });
    return { store, card };
}
const requested = (store: Awaited<ReturnType<typeof bulletSetup>>['store']) => { const e = store.readExecutor('d', 's')!, real = e.chartData.bind(e), calls: string[][] = []; e.chartData = (...args) => { calls.push(args[1] as string[]); return real(...args); }; return calls; };

it('bullet lists only *_actual metrics, offers the delivered quarters, and commits the chosen period', async () => {
    const { store, card } = await bulletSetup();
    const commit = vi.fn(async () => true);
    render(<LinkedChartRenderer dashboardId="d" card={card} refreshKey={0} store={store} onSettingsChange={commit}/>);
    await screen.findByTestId('figure');
    expect(screen.getAllByRole('checkbox').map(c => c.parentElement!.textContent)).toEqual(['eps_actual', 'revenue_actual']);
    const select = screen.getByLabelText('Quarter');
    expect([...select.querySelectorAll('option')].map(o => o.textContent)).toEqual(['Latest', 'Q1', 'Q2']);
    fireEvent.change(select, { target: { value: 'Q1' } });
    await waitFor(() => expect(commit).toHaveBeenCalledWith({ ...bulletSettings, period: 'Q1' }));
    cleanup(); store.disposeDashboard('d');
});

const quarterOptions = () => [...screen.getByLabelText('Quarter').querySelectorAll('option')].map(o => o.textContent);

it('keeps a bullet settings-save error visible alongside a failed chart read', async () => {
    const { store, card } = await bulletSetup();
    try {
        render(<LinkedChartRenderer dashboardId="d" card={card} refreshKey={0} store={store} onSettingsChange={async () => false}/>);
        const figure = await screen.findByTestId('figure');
        fireEvent.change(screen.getByLabelText('Quarter'), { target: { value: 'Q1' } });
        expect(await screen.findByRole('alert')).toHaveTextContent('Chart settings could not be saved.');

        vi.spyOn(store.readExecutor('d', 's')!, 'chartData').mockRejectedValueOnce(new Error('Chart data unavailable'));
        await act(async () => {
            store.updateDefinition('d', 's', { table: {}, search: 'Q2' }, { kind: 'none' });
            await store.settled('d');
        });
        expect(await screen.findByText('Could not load chart: Chart data unavailable')).toBeVisible();
        expect(screen.getAllByRole('alert').map(alert => alert.textContent)).toEqual([
            'Chart settings could not be saved.', 'Could not load chart: Chart data unavailable',
        ]);
        expect(screen.getByTestId('figure')).toBe(figure);
    } finally { cleanup(); store.disposeDashboard('d'); }
});

it('keeps replacement quarters after refusing a saved quarter that is unavailable', async () => {
    const { store, card } = await bulletSetup();
    const props = { dashboardId: 'd', card, refreshKey: 0, store, onSettingsChange: async () => true };
    const { rerender } = render(<LinkedChartRenderer {...props}/>);
    await screen.findByTestId('figure');

    rerender(<LinkedChartRenderer {...props} card={{ ...card, linkedChart: { ...bulletSettings, period: 'Q9' } }}/>);
    await screen.findByText('Quarter Q9 is not in the linked table.');
    expect(screen.queryByTestId('figure')).toBeNull();
    expect(quarterOptions()).toEqual(['Latest', 'Q9 (unavailable)', 'Q1', 'Q2']);
    expect(screen.getByLabelText('Quarter')).toHaveValue('Q9');
    cleanup(); store.disposeDashboard('d');
});

it('lets the user recover by choosing a quarter when the linked table hides period ending', async () => {
    const { store, card } = await bulletSetup(['period_ending']);
    const onSettingsChange = vi.fn(async () => true);
    const props = { dashboardId: 'd', card, refreshKey: 0, store, onSettingsChange };
    const { rerender } = render(<LinkedChartRenderer {...props}/>);
    await screen.findByText('Choose a quarter.');
    expect(screen.queryByTestId('figure')).toBeNull();
    expect(quarterOptions()).toEqual(['Latest', 'Q1', 'Q2']);

    fireEvent.change(screen.getByLabelText('Quarter'), { target: { value: 'Q2' } });
    await waitFor(() => expect(onSettingsChange).toHaveBeenCalledWith({ ...bulletSettings, period: 'Q2' }));
    rerender(<LinkedChartRenderer {...props} card={{ ...card, linkedChart: { ...bulletSettings, period: 'Q2' } }}/>);
    const figure = JSON.parse((await screen.findByTestId('figure')).textContent!);
    expect(figure.data[0]).toMatchObject({ type: 'indicator', value: 1.3456 });
    expect(figure.data[0].gauge).not.toHaveProperty('threshold');
    expect(screen.queryByText('Choose a quarter.')).toBeNull();
    cleanup(); store.disposeDashboard('d');
});

it('keeps quarter choices from the current table when an older chart request resolves last', async () => {
    const { store, card } = await bulletSetup(['period_ending']);
    const executor = store.readExecutor('d', 's')!;
    const chartData = executor.chartData.bind(executor);
    let releaseOld: (() => void) | undefined;
    executor.chartData = async (...args) => {
        const result = await chartData(...args);
        if (releaseOld) return result;
        return new Promise<ChartResult>(resolve => { releaseOld = () => resolve(result); });
    };
    render(<LinkedChartRenderer dashboardId="d" card={card} refreshKey={0} store={store} onSettingsChange={async () => true}/>);
    await waitFor(() => expect(releaseOld).toBeDefined());

    await act(async () => {
        store.updateDefinition('d', 's', { table: { hidden: ['period_ending'] }, search: 'Q2' }, { kind: 'none' });
        await store.settled('d');
    });
    await screen.findByText('Choose a quarter.');
    expect(quarterOptions()).toEqual(['Latest', 'Q2']);

    await act(async () => releaseOld!());
    expect(quarterOptions()).toEqual(['Latest', 'Q2']);
    expect(screen.queryByTestId('figure')).toBeNull();
    cleanup(); store.disposeDashboard('d');
});

it('switching to bullet defaults the category to fiscal_period when the table has it', async () => {
    const { store, card } = await bulletSetup();
    const commit = vi.fn(async () => true);
    render(<LinkedChartRenderer dashboardId="d" card={{ ...card, linkedChart: { ...bulletSettings, type: 'column', category: undefined } }} refreshKey={0} store={store} onSettingsChange={commit}/>);
    await waitFor(() => expect(screen.getByLabelText('Chart type')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Chart type'), { target: { value: 'bullet' } });
    await waitFor(() => expect(commit).toHaveBeenCalledWith(expect.objectContaining({ type: 'bullet', category: 'fiscal_period' })));
    cleanup(); store.disposeDashboard('d');
});

it('requests the category, actuals and the presented estimate columns only', async () => {
    const { store, card } = await bulletSetup();
    const calls = requested(store);
    render(<LinkedChartRenderer dashboardId="d" card={card} refreshKey={0} store={store} onSettingsChange={async () => true}/>);
    await screen.findByTestId('figure');
    expect([...calls[0]].sort()).toEqual(['eps_actual', 'eps_avg', 'eps_consensus', 'eps_high', 'eps_low', 'fiscal_period', 'period_ending']);
    cleanup(); store.disposeDashboard('d');
});

it('never requests a range column the linked table hides, and notes the missing band', async () => {
    const { store, card } = await bulletSetup(['eps_low', 'eps_high']);
    const calls = requested(store);
    render(<LinkedChartRenderer dashboardId="d" card={card} refreshKey={0} store={store} onSettingsChange={async () => true}/>);
    await screen.findByTestId('figure');
    expect(calls.length).toBeGreaterThan(0);
    for (const ids of calls) {
        expect(ids).not.toContain('eps_low');
        expect(ids).not.toContain('eps_high');
    }
    expect(screen.getByText('Range columns for eps_actual are not shown in the linked table')).toBeTruthy();
    const figure = JSON.parse(screen.getByTestId('figure').textContent!);
    expect(figure.data[0].gauge.steps.some((s: { range: number[] }) => s.range[1] - s.range[0] > 0.1)).toBe(false);
    cleanup(); store.disposeDashboard('d');
});

it('redraws the bullet when the decimal-places setting changes', async () => {
    const { store, card } = await bulletSetup();
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, maxDecimalPlaces: 2 } });
    render(<LinkedChartRenderer dashboardId="d" card={card} refreshKey={0} store={store} onSettingsChange={async () => true}/>);
    await screen.findByTestId('figure');
    const text = () => JSON.parse(screen.getByTestId('figure').textContent!).layout.annotations[0].text as string;
    const before = text();
    act(() => useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, maxDecimalPlaces: 4 } }));
    await waitFor(() => expect(text()).not.toBe(before));
    act(() => useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } }));
    cleanup(); store.disposeDashboard('d');
});

it('offers five financial recipes and explains missing fields on an incompatible table', async () => {
  const store = await setup();
  render(<LinkedChartRenderer {...withSettings(store, {})}/>);
  for (const kind of ['drawdown', 'yield-curve', 'estimate-range', 'monthly-returns', 'correlation'])
    expect(screen.getByLabelText('Chart type').querySelector(`option[value="${kind}"]`)).toBeDisabled();
  expect(screen.getByLabelText('Chart type').querySelector('option[value=drawdown]')).toHaveTextContent(/adjusted.price/i);
  cleanup(); store.disposeDashboard('d');
});

const curve = { version: 1, kind: 'yield-curve', fields: { date: 'date', maturity: 'maturity', rate: 'rate' } } as const;
async function setupCurve(inputDataset?: import('../../lib/widgetData/types').WidgetDataset) {
  const { datasetFromRows } = await import('../../lib/localTableData');
  const data = inputDataset ?? datasetFromRows([{ date: '2026-01-02', maturity: 'year_10', rate: .04 }], 's', 1, 'localFile');
  data.provenance.receipt ??= { start_date: '2026-01-01', end_date: '2026-01-31' };
  const acquire = vi.fn(async () => ({ kind: 'dataset' as const, dataset: data }));
  const store = createTableExecutionStore({ executor: id => createWorkerExecutor(id, () => new Boundary() as unknown as Worker), source: () => ({ acquire }) });
  const source = { ...chart, id: 's', widgetId: 'local_table', params: { file: 'x' }, linkedSource: undefined, linkedChart: undefined };
  store.syncDashboard({ id: 'd', name: 'D', tabs: [{ id: 't', name: 'T', cards: [source, chart] }] } as Dashboard);
  store.ensureTable('d', 'c'); await store.settled('d');
  const { runRecipe } = await import('../../lib/widgetData/chartRecipes/run');
  const run = vi.fn(async (...[dataset, options, context]: Parameters<typeof runRecipe>) => runRecipe(dataset, options, context));
  const worker = await import('../../lib/widgetData/chartRecipes/workerClient');
  const factory = vi.spyOn(worker, 'createRecipeWorker').mockReturnValue({ run, dispose: vi.fn() });
  const props = { ...withSettings(store, { type: curve.kind, recipe: curve, category: undefined, measures: [] }), viewer: true };
  const executor = store.readExecutor('d', 's')!;
  const actualRead = executor.chartData.bind(executor);
  const read = vi.spyOn(executor, 'chartData');
  const change = async (hidden?: string[]) => act(async () => { store.updateDefinition('d', 's', { table: { hidden }, search: '' }, { kind: 'none' }); await store.settled('d'); });
  return { store, run, props, change, factory, read, actualRead, acquire };
}

const returnsRecipe: ReturnSummaryOptions = {
  version: 1, kind: 'return-summary', view: 'box', fields: { date: 'date', price: 'close' },
  symbols: ['AAPL.US'], window: { mode: 'own' },
};
const returnsRows = Array.from({ length: 21 }, (_, index) => ({
  date: '2026-01-' + String(index + 1).padStart(2, '0'), adjusted_close: 100 + 10 * (index % 5),
}));
function liveReturnsWithAlias() {
  const data = liveDailyPriceDataset(returnsRows, ['AAPL.US']);
  return { ...data,
    columns: data.columns.map(column => column.id === 'adjusted_close'
      ? { ...column, id: 'close', label: 'Presented price', sourceFieldId: 'adjusted_close' } : column),
    rows: data.rows.map(({ values: { adjusted_close, ...values }, ...row }) => ({ ...row, values: { ...values, close: adjusted_close } })),
  };
}

it('drafts and renders box and violin from the same verified live prices through a presented alias', async () => {
  const { store, props, factory, run } = await setupCurve(liveReturnsWithAlias());
  const save = vi.fn(async () => true);
  const withQuestion = (recipe: ReturnSummaryOptions) => ({
    ...props, onSettingsChange: save, viewer: false,
    card: { ...props.card, linkedChart: { ...settings, type: recipe.kind, recipe } },
  });
  try {
    const { rerender } = render(<LinkedChartRenderer {...withQuestion(returnsRecipe)}/>);
    expect(await screen.findByText('Observed quote-to-quote returns; exchange-session completeness unknown.')).toBeVisible();
    fireEvent.click(screen.getByText('Return listing details'));
    expect(screen.getByText(/pair may span multiple exchange sessions/i)).toBeVisible();
    expect(screen.getByText(/20 observed adjusted-price returns/)).toBeVisible();
    expect(screen.getByLabelText('Adjusted price')).toHaveValue('close');
    expect(screen.getByLabelText('AAPL.US')).toBeChecked();
    const initial = await run.mock.results.find(call => call.type === 'return')!.value;
    fireEvent.change(screen.getByLabelText('Return view'), { target: { value: 'violin' } });
    const apply = screen.getByRole('button', { name: 'Apply chart settings' });
    await waitFor(() => expect(apply).toBeEnabled());
    fireEvent.click(apply);
    const violin = { ...returnsRecipe, view: 'violin' } as const;
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ recipe: violin }), expect.any(Function));
    rerender(<LinkedChartRenderer {...withQuestion(violin)}/>);
    await waitFor(() => expect(screen.getByTestId('figure')).toHaveTextContent('Observed return density'));
    const latest = await run.mock.results.at(-1)!.value;
    expect(initial.ok && initial.returnSummary?.series[0].samples).toHaveLength(20);
    expect(latest.ok && latest.returnSummary?.series[0].samples)
      .toEqual(initial.ok && initial.returnSummary?.series[0].samples);
  } finally { cleanup(); factory.mockRestore(); store.disposeDashboard('d'); }
});

it('keeps an ordinary price table ineligible for both return views', async () => {
  const { datasetFromRows } = await import('../../lib/localTableData');
  const data = datasetFromRows(returnsRows, 's', 1, 'backend');
  const { store, props, factory, run } = await setupCurve(data);
  try {
    render(<LinkedChartRenderer {...props} viewer={false} card={chart}/>);
    fireEvent.change(screen.getByLabelText('Chart type'), { target: { value: 'return-summary' } });
    expect(await screen.findByText(/verified EODHD daily-price acquisition/)).toBeVisible();
    expect(screen.getByLabelText('Return view')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply chart settings' })).toBeDisabled();
    expect(run).not.toHaveBeenCalled();
  } finally { cleanup(); factory.mockRestore(); store.disposeDashboard('d'); }
});

it('passes a columnless counted-empty live acquisition to the recipe for the insufficient-prices result', async () => {
  const { store, props, factory, read } = await setupCurve(liveDailyPriceDataset([], ['AAPL.US']));
  try {
    render(<LinkedChartRenderer {...props} card={{ ...chart, linkedChart: { ...settings, type: returnsRecipe.kind, recipe: returnsRecipe } }}/>);
    expect(await screen.findByText(/No valid daily prices remain/)).toBeVisible();
    expect(read.mock.calls[0][1]).toEqual([]);
    expect(screen.queryByTestId('figure')).toBeNull();
  } finally { cleanup(); factory.mockRestore(); store.disposeDashboard('d'); }
});

it('retires a completed live chart and fences a held worker projection after acquisition replacement', async () => {
  const { store, props, factory, read, actualRead } = await setupCurve(liveReturnsWithAlias());
  const card = { ...props.card, linkedChart: { ...settings, type: returnsRecipe.kind, recipe: returnsRecipe } };
  let release: (() => void) | undefined;
  let signal: AbortSignal | undefined;
  try {
    const { rerender } = render(<LinkedChartRenderer {...props} card={card} sourceAcquisitionKey="original"/>);
    await waitFor(() => expect(screen.getByTestId('figure')).toHaveTextContent('Observed return boxes'));
    read.mockImplementation(async (...args) => {
      const result = await actualRead(...args);
      signal = args[2];
      return new Promise(resolve => { release = () => resolve(result); });
    });
    await act(async () => { store.refresh('d', 'c'); await store.settled('d'); });
    await waitFor(() => expect(release).toBeDefined());
    expect(screen.getByText(/showing completed data \(stale\)/i)).toBeVisible();
    const readCurrentSource = () => ({ view: store.readView('d', 'c'), sourceCurrent: false, card });
    rerender(<LinkedChartRenderer {...props} card={card} sourceAcquisitionKey="replacement" readCurrentSource={readCurrentSource}/>);
    expect(signal?.aborted).toBe(true);
    expect(screen.queryByTestId('figure')).toBeNull();
    await act(async () => release?.());
    expect(screen.queryByTestId('figure')).toBeNull();
  } finally { cleanup(); factory.mockRestore(); store.disposeDashboard('d'); }
});

it('runs worker-only financial charts without legacy measures, preserves refresh zoom, clears hidden binding and limits source reads', async () => {
  const { store, props, run, change, factory, read, acquire } = await setupCurve();
  try {
    render(<LinkedChartRenderer {...props}/>);
    const first = JSON.parse((await screen.findByTestId('figure')).textContent!);
    expect(screen.queryByLabelText('Chart type')).toBeNull();
    expect(read.mock.calls[0][1]).toEqual(['date', 'maturity', 'rate']);
    expect(screen.getByText(/^Source s ·/)).toHaveTextContent(/2026-01-01.*2026-01-31/);
    expect(run).toHaveBeenCalledTimes(1);
    const original = useSettingsStore.getState().settings;
    try {
      act(() => useSettingsStore.setState({ settings: { ...original, theme: 'light', maxDecimalPlaces: 5 } }));
      await waitFor(() => expect(run.mock.calls.at(-1)![2]).toMatchObject({ theme: 'light', maxDecimals: 5 }));
      expect(read).toHaveBeenCalledTimes(1);
    } finally { act(() => useSettingsStore.setState({ settings: original })); }
    await change([]);
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(1));
    expect(JSON.parse(screen.getByTestId('figure').textContent!).layout.uirevision).toBe(first.layout.uirevision);
    const reads = read.mock.calls.length;
    await change(['rate']);
    expect(await screen.findByText(/rate.*repair/i)).toBeTruthy();
    expect(screen.queryByTestId('figure')).toBeNull();
    expect(read).toHaveBeenCalledTimes(reads);
    expect(acquire).toHaveBeenCalledTimes(1);
  } finally { cleanup(); factory.mockRestore(); store.disposeDashboard('d'); }
});
it('retains only a stale same-question success on transport failure; a refusal clears the chart', async () => {
  const { store, props, change, factory, run, read } = await setupCurve();
  try {
    render(<LinkedChartRenderer {...props}/>);
    await screen.findByTestId('figure');
    read.mockRejectedValueOnce(new Error('snapshot offline'));
    await change([]);
    expect(await screen.findByText(/snapshot offline/)).toBeTruthy();
    expect(screen.getByText(/stale/i)).toBeTruthy();
    expect(screen.getByTestId('figure')).toBeTruthy();
    run.mockResolvedValueOnce({ ok: false, refused: true, message: 'The source must be fully loaded.' });
    await change(['unrelated']);
    expect(await screen.findByText(/fully loaded/)).toBeTruthy();
    expect(screen.queryByTestId('figure')).toBeNull();
  } finally { cleanup(); factory.mockRestore(); store.disposeDashboard('d'); }
});
it('shows financial recipe source failures alongside the stale completed chart', async () => {
  const { store, props, acquire, factory } = await setupCurve();
  try {
    render(<LinkedChartRenderer {...props}/>);
    const figure = await screen.findByTestId('figure');
    acquire.mockRejectedValue(new Error('Source acquisition failed'));
    await act(async () => { store.refresh('d', 'c'); await store.settled('d'); });
    expect(screen.getByRole('alert')).toHaveTextContent('Source s: Source acquisition failed');
    expect(screen.getByText(/updating chart.*stale/i)).toBeVisible();
    expect(screen.getByTestId('figure')).toBe(figure);
  } finally { cleanup(); factory.mockRestore(); store.disposeDashboard('d'); }
});
it('fences late results when the source disappears or the saved recipe changes', async () => {
  const { store, props, run, factory } = await setupCurve();
  try {
    let release!: () => void;
    const impl = run.getMockImplementation()!;
    run.mockImplementationOnce(async (...args) => {
      const result = await impl(...args);
      await new Promise<void>(resolve => { release = resolve; });
      return result;
    });
    const { rerender } = render(<LinkedChartRenderer {...props}/>);
    await waitFor(() => expect(release).toBeDefined());
    rerender(<LinkedChartRenderer {...props} card={{ ...props.card, linkedSource: undefined }}/>);
    await act(async () => release());
    expect(screen.queryByTestId('figure')).toBeNull();
    rerender(<LinkedChartRenderer {...props}/>);
    await screen.findByTestId('figure');
    rerender(<LinkedChartRenderer {...props} card={{ ...props.card, linkedChart: { ...props.card.linkedChart, type: 'monthly-returns', recipe: undefined } }}/>);
    expect(screen.queryByTestId('figure')).toBeNull();
    expect(await screen.findByText(/version 1 recipe/)).toBeTruthy();
  } finally { cleanup(); factory.mockRestore(); store.disposeDashboard('d'); }
});

it('persists an estimate-range form once, requests only presented identity evidence, and resets zoom for a metric change', async () => {
  const { datasetFromRows } = await import('../../lib/localTableData');
  const { runRecipe } = await import('../../lib/widgetData/chartRecipes/run');
  const worker = await import('../../lib/widgetData/chartRecipes/workerClient');
  const factory = vi.spyOn(worker, 'createRecipeWorker').mockReturnValue({ run: async (...[data, opts, ctx]) => runRecipe(data, opts, ctx), dispose: vi.fn() });
  const data = datasetFromRows([{ period_ending: '2026-06-27', band_status: 'ok', eps_low: 1, eps_avg: 2, eps_high: 3,
    revenue_low: 10, revenue_avg: 20, revenue_high: 30, TICKER: 'A', Currency: 'USD', unit: 'shares' }], 's', 1, 'localFile');
  const store = createTableExecutionStore({ executor: id => createWorkerExecutor(id, () => new Boundary() as unknown as Worker),
    source: () => ({ acquire: async () => ({ kind: 'dataset', dataset: data }) }) });
  try {
    store.syncDashboard({ id: 'd', tabs: [{ id: 't', cards: [{ ...chart, id: 's', widgetId: 'local_table', linkedChart: undefined, linkedSource: undefined, table: { hidden: ['unit'] } }, chart] }] } as Dashboard);
    store.ensureTable('d', 'c'); await store.settled('d');
    const read = vi.spyOn(store.readExecutor('d', 's')!, 'chartData');
    const save = vi.fn(async (_settings: import('../../lib/widgetData/types').LinkedChartSettings) => true);
    const props = { dashboardId: 'd', card: chart, store, refreshKey: 0, onSettingsChange: save };
    const { rerender } = render(<LinkedChartRenderer {...props}/>);
    fireEvent.change(screen.getByLabelText('Chart type'), { target: { value: 'estimate-range' } });
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const eps = save.mock.calls[0][0];
    rerender(<LinkedChartRenderer {...props} card={{ ...chart, linkedChart: eps }}/>);
    const first = JSON.parse((await screen.findByTestId('figure')).textContent!);
    expect(read.mock.lastCall![1]).toEqual(['period_ending', 'band_status', 'eps_low', 'eps_avg', 'eps_high', 'TICKER', 'Currency']);
    fireEvent.change(screen.getByLabelText('Metric'), { target: { value: 'revenue' } });
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    rerender(<LinkedChartRenderer {...props} card={{ ...chart, linkedChart: save.mock.calls[1][0] }}/>);
    const second = JSON.parse((await screen.findByTestId('figure')).textContent!);
    expect(second.layout.uirevision).not.toBe(first.layout.uirevision);
    expect(second.data[0].x).toEqual([10, 30]);
  } finally { cleanup(); factory.mockRestore(); store.disposeDashboard('d'); }
});

it('qualifies the Plotly layout question by the selected source when two tables share an acquisition', async () => {
  const { store, props, factory } = await setupCurve();
  try {
    const { rerender } = render(<LinkedChartRenderer {...props}/>);
    const first = JSON.parse((await screen.findByTestId('figure')).textContent!);
    const parent = { ...chart, id: 's', widgetId: 'local_table', params: { file: 'x' }, linkedSource: undefined, linkedChart: undefined };
    const child = { ...chart, id: 'subset', widgetId: 'linked_table', linkedChart: undefined };
    const next = { ...props.card, linkedSource: { kind: 'widget' as const, sourceWidgetId: 'subset' } };
    await act(async () => {
      store.syncDashboard({ id: 'd', name: 'D', tabs: [{ id: 't', name: 'T', cards: [parent, child, next] }] } as Dashboard);
      store.ensureTable('d', 'c'); await store.settled('d');
    });
    rerender(<LinkedChartRenderer {...props} card={next}/>);
    const second = JSON.parse((await screen.findByTestId('figure')).textContent!);
    expect(second.layout.uirevision).not.toBe(first.layout.uirevision);
  } finally { cleanup(); factory.mockRestore(); store.disposeDashboard('d'); }
});

it('ignores a late worker success after switching to another question', async () => {
  const { store, props, run, factory } = await setupCurve();
  let release!: () => void;
  try {
    const calculate = run.getMockImplementation()!;
    run.mockImplementationOnce(async (...args) => {
      const result = await calculate(...args);
      await new Promise<void>(resolve => { release = resolve; });
      return result;
    });
    const { rerender } = render(<LinkedChartRenderer {...props}/>);
    await waitFor(() => expect(release).toBeDefined());
    rerender(<LinkedChartRenderer {...props} card={{ ...props.card, linkedChart: { ...props.card.linkedChart,
      recipe: { ...curve, fields: { ...curve.fields, rate: 'missing' } } } }}/>);
    expect(await screen.findByRole('alert')).toHaveTextContent(/missing.*repair/i);
    await act(async () => release());
    expect(screen.queryByTestId('figure')).toBeNull();
  } finally { cleanup(); factory.mockRestore(); store.disposeDashboard('d'); }
});

it('refuses a contradicted provenance symbol without requesting a hidden symbol column', async () => {
  const { priceDataset } = await import('../../lib/widgetData/chartRecipes/fixtures');
  const data = priceDataset([{ date: '2026-01-03', adjusted_close: 2, symbol: 'CONFLICT' }]);
  data.provenance.receipt!.symbol = 'DECLARED';
  const store = createTableExecutionStore({ executor: id => createWorkerExecutor(id, () => new Boundary() as unknown as Worker),
    source: () => ({ acquire: async () => ({ kind: 'dataset', dataset: data }) }) });
  try {
    store.syncDashboard({ id: 'd', tabs: [{ id: 't', cards: [{ ...chart, id: 's', widgetId: 'local_table', linkedSource: undefined,
      linkedChart: undefined, table: { hidden: ['symbol'] } }, chart] }] } as Dashboard);
    store.ensureTable('d', 'c'); await store.settled('d');
    const read = vi.spyOn(store.readExecutor('d', 's')!, 'chartData');
    render(<LinkedChartRenderer {...withSettings(store, {})}/>);
    fireEvent.change(screen.getByLabelText('Chart type'), { target: { value: 'monthly-returns' } });
    expect(await screen.findByText(/repair mixed or missing price symbol identities/i)).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'DECLARED' })).toBeNull();
    expect(read.mock.calls.map(call => call[1])).toEqual([[]]);
  } finally { cleanup(); store.disposeDashboard('d'); }
});

it('rejects a malformed legacy recipe declaration before reading fields or executing an accessor', async () => {
  const store = await setup();
  try {
    const read = vi.spyOn(store.readExecutor('d', 's')!, 'chartData');
    const get = vi.fn(() => { throw new Error('Unexpected recipe execution'); });
    const invalid = Object.defineProperty({ ...settings }, 'recipe', { enumerable: true, get });
    render(<LinkedChartRenderer {...withSettings(store, {})} viewer card={{ ...chart, linkedChart: invalid }}/>);
    expect(await screen.findByText(/declare recipe options as enumerable json data/i)).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  } finally { cleanup(); store.disposeDashboard('d'); }
});

it('clears a saved adjusted-price chart before projected reads when its bound ID changes provider role', async () => {
  const { priceDataset, drawdownOptions } = await import('../../lib/widgetData/chartRecipes/fixtures');
  const data = priceDataset([{ date: '2026-01-02', symbol: 'A', px: 12 }]);
  const price = data.columns.find(c => c.id === 'px')!;
  price.dtype = 'number';
  price.sourceFieldId = 'adjusted_close';
  const { store, props, read, run, factory } = await setupCurve(data);
  try {
    const recipe = { ...drawdownOptions, fields: { ...drawdownOptions.fields, price: 'px' } };
    render(<LinkedChartRenderer {...props} card={{ ...chart, linkedChart: { ...settings, type: 'drawdown', recipe } }}/>);
    expect(await screen.findByTestId('figure')).toBeTruthy();
    const reads = read.mock.calls.length;
    price.sourceFieldId = 'eps_low';
    await act(async () => { store.refresh('d', 'c'); await store.settled('d'); });
    expect(store.readView('d', 'c').ready!.columns.find(c => c.id === 'px')).toMatchObject({ sourceFieldId: 'eps_low' });
    expect(screen.queryByTestId('figure')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(/px.*adjusted price.*repair/i);
    expect(read).toHaveBeenCalledTimes(reads);
    expect(run).toHaveBeenCalledTimes(1);
  } finally { cleanup(); factory.mockRestore(); store.disposeDashboard('d'); }
});

it('accepts equivalent revision fields received in a different property order for both figure and symbol choices', async () => {
  const { priceDataset, drawdownOptions } = await import('../../lib/widgetData/chartRecipes/fixtures');
  const data = priceDataset([{ date: '2026-01-02', symbol: 'A', adjusted_close: 12 }]);
  const { store, props, read, actualRead, factory } = await setupCurve(data);
  try {
    read.mockImplementation(async (...args) => {
      const delivered = await actualRead(...args);
      const { widgetId, input, model, output } = delivered.revision;
      return { ...delivered, revision: { output, model, input, widgetId } };
    });
    render(<LinkedChartRenderer {...props} viewer={false} card={{ ...chart, linkedChart: { ...settings, type: 'drawdown', recipe: drawdownOptions } }}/>);
    await screen.findByTestId('figure');
    await waitFor(() => expect(screen.getByRole('button', { name: /apply/i })).toBeEnabled());
    expect(screen.getByLabelText('A')).toBeChecked();
  } finally { cleanup(); factory.mockRestore(); store.disposeDashboard('d'); }
});

it.each(['bullet', 'waterfall'] as const)('fences %s on a pending or failed relink and redraws for the new source', async type => {
  const wf = type === 'waterfall';
  const mapping = wf ? { ...settings, type, category: 'item', measures: ['year'] } : bulletSettings;
  const dataset = wf ? { ...input, columns: [{ id: 'item', label: 'Item' }, { id: 'year', label: 'Year',
    splitPath: [{ field: 'Period', categoryId: 'statement/income/1.0.0/category/period', value: 'FY2026' }] }],
    rows: [{ id: 'income', values: { item: 'Revenue', year: 100 }, groupPath: [{ field: 'Item',
      categoryId: 'statement/income/1.0.0/category/item', value: 'statement/income/1.0.0/line/revenue' }] }] }
    : { ...input, columns: bulletColumns, rows: [quarter('Q2', '2026-06-30', 1.3456)] };
  let rejectRead: ((error: Error) => void) | undefined;
  let hold = true;
  const store = createTableExecutionStore({ executor: id => createWorkerExecutor(id, () => new Boundary() as unknown as Worker),
    source: source => ({ acquire: async () => {
      if (source.id === 'B' && hold) await new Promise<void>((_, reject) => { rejectRead = reject; });
      return { kind: 'dataset', dataset };
    } }) });
  const root = (id: string) => ({ ...chart, id, widgetId: 'local_table', params: { file: id }, linkedChart: undefined, linkedSource: undefined });
  const linked = (sourceWidgetId: string) => ({ ...chart, linkedChart: mapping, linkedSource: { kind: 'widget' as const, sourceWidgetId } });
  const sync = (source: string) => store.syncDashboard({ id: 'd', name: 'D', tabs: [{ id: 't', name: 'T', cards: [root('A'), root('B'), linked(source)] }] } as Dashboard);
  const props = { store, dashboardId: 'd', refreshKey: 0, onSettingsChange: async () => true };
  try {
    sync('A'); store.ensureTable('d', 'c');
    const { rerender } = render(<LinkedChartRenderer {...props} card={linked('A')}/>);
    const first = JSON.parse((await screen.findByTestId('figure')).textContent!);
    act(() => { sync('B'); store.ensureTable('d', 'c'); });
    rerender(<LinkedChartRenderer {...props} card={linked('B')}/>);
    expect(screen.queryByTestId('figure')).toBeNull();
    await waitFor(() => expect(rejectRead).toBeDefined());
    await act(async () => { rejectRead!(new Error('B acquisition failed')); await store.settled('d'); });
    expect(screen.queryByTestId('figure')).toBeNull();
    expect(store.readView('d', 'c')).toMatchObject({ status: 'blocked', error: 'Source B: B acquisition failed' });
    expect(screen.queryByText('Loading source B…')).toBeNull();
    hold = false;
    await act(async () => { store.refresh('d', 'c'); await store.settled('d'); });
    const second = JSON.parse((await screen.findByTestId('figure')).textContent!);
    expect(second.layout.uirevision).not.toEqual(first.layout.uirevision);
    expect(screen.getByText(/Source B.*available/)).toBeVisible();
  } finally { cleanup(); store.disposeDashboard('d'); }
});

it('reflows small multiples only when the panel grid changes, retaining zoom and the acquired snapshot', async () => {
  const { priceDataset, priceFields, dailyPriceRows } = await import('../../lib/widgetData/chartRecipes/fixtures');
  const symbols = ['A', 'B', 'C'];
  const rows = symbols.flatMap(s => dailyPriceRows([10, 11, 12], s).map((r, i) => ({ ...r, scope: i < 2 ? 'included' : 'omitted' })));
  const { store, props, run, acquire, read, factory } = await setupCurve(priceDataset(rows));
  const sizes = new Map<Element, (width: number) => void>();
  vi.stubGlobal('ResizeObserver', class {
    constructor(private notify: ResizeObserverCallback) {}
    observe(el: Element) {
      sizes.set(el, width => this.notify([{ contentRect: { width } }] as ResizeObserverEntry[], this as unknown as ResizeObserver));
    }
    disconnect() {}
  });
  try {
    const recipe = { version: 1, kind: 'small-multiples', symbols, fields: priceFields } as const;
    const { container } = render(<LinkedChartRenderer {...props} card={{ ...chart, linkedChart: { ...settings, type: recipe.kind, recipe } }}/>);
    const initial = JSON.parse((await screen.findByTestId('figure')).textContent!);
    expect(initial.layout.grid.columns).toBe(2);
    expect(screen.getByText('3 panels · A, B, C')).toBeVisible();
    const observe = sizes.get(container.querySelector('.linked-chart-plot')!);
    expect(observe).toBeDefined();
    const runs = run.mock.calls.length;
    act(() => { observe!(850); observe!(800); });
    expect(run).toHaveBeenCalledTimes(runs);
    act(() => observe!(470));
    await waitFor(() => expect(JSON.parse(screen.getByTestId('figure').textContent!).layout.grid.columns).toBe(1));
    act(() => { observe!(500); observe!(550); });
    expect(run).toHaveBeenCalledTimes(runs + 1);
    act(() => observe!(1000));
    await waitFor(() => expect(JSON.parse(screen.getByTestId('figure').textContent!).layout.grid.columns).toBe(3));
    expect(JSON.parse(screen.getByTestId('figure').textContent!).layout.uirevision).toBe(initial.layout.uirevision);
    expect(read).toHaveBeenCalledTimes(1);
    expect(acquire).toHaveBeenCalledTimes(1);
    await act(async () => {
      store.updateDefinition('d', 's', { table: {}, search: 'included' }, { kind: 'none' });
      await store.settled('d');
    });
    expect(await screen.findByText('Filtered source delivered 6 of 9 acquired rows.')).toBeVisible();
    expect(screen.getByTestId('figure')).toBeVisible();
  } finally { cleanup(); vi.unstubAllGlobals(); factory.mockRestore(); store.disposeDashboard('d'); }
});
