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
import { LinkedChartRenderer } from './LinkedChartRenderer';
vi.mock('./ChartRenderer', () => ({ ChartRenderer: ({ data }: {
        data: unknown;
    }) => <pre data-testid="figure">{JSON.stringify(data)}</pre> }));
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
    const data = { ...input, columns: bulletColumns, rows: [quarter('Q1', '2026-03-31', 1.2345), quarter('Q2', '2026-06-30', 1.3456)] };
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
