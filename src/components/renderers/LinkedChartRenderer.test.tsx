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
    const delivery = screen.getByTestId('figure').closest('.linked-chart-renderer')!;
    const priorRevision = store.readView('d', 'c').sourceRevision;
    expect(delivery).toHaveAttribute('data-delivered-revision', JSON.stringify(priorRevision));
    store.readExecutor('d', 's')!.chartData = async () => { throw new Error('transport down'); };
    await act(async () => { store.updateDefinition('d', 's', { table: {}, search: 'A' }, { kind: 'none' }); await store.settled('d'); });
    expect(await screen.findByRole('alert')).toHaveTextContent('transport down');
    expect(screen.getByText(/showing completed data \(stale\)/)).toBeVisible();
    expect(screen.getByTestId('figure').textContent).toBe(old);
    expect(store.readView('d', 'c').sourceRevision).not.toEqual(priorRevision);
    expect(delivery).toHaveAttribute('data-delivered-revision', JSON.stringify(priorRevision));
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
    expect(screen.getByText(/showing completed data \(stale\)/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /^Measures/ }));
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

it('discards a delivered figure when its privileged activation is evicted', async () => {
 const store=await setup();render(<LinkedChartRenderer dashboardId="d" card={chart} refreshKey={0} store={store} onSettingsChange={async()=>true}/>);
 await screen.findByTestId('figure');act(()=>store.disposeDashboard('d'));expect(screen.queryByTestId('figure')).toBeNull();
});
it('clears a completed figure when a successful empty linked scope loses its generated series, then restores fresh data', async () => {
    const pivot = { enabled: true, grouping: ['region'], split: ['team'], measures: [{ id: 'sales', sourceFieldId: 'revenue', aggregation: 'sum' as const }] };
    const data = { ...input, rows: [{ id: 'nvda', values: { region: 'FY2024', team: 'NVDA', revenue: 60922000000 } }] };
    const store = createTableExecutionStore({ executor: id => createWorkerExecutor(id, () => new Boundary() as unknown as Worker), source: () => ({ acquire: async () => ({ kind: 'dataset', dataset: data }) }) });
    const source = { ...chart, id: 's', widgetId: 'local_table', params: { file: 'x' }, linkedSource: undefined, linkedChart: undefined, table: { pivot } };
    const selected = { ...chart, id: 'selected', widgetId: 'local_table', linkedChart: undefined };
    const target = { ...chart, linkedSource: { kind: 'widget' as const, sourceWidgetId: 'selected' } };
    store.syncDashboard({ id: 'd', name: 'D', tabs: [{ id: 't', name: 'T', cards: [source, selected, target] }] } as Dashboard);
    store.ensureTable('d', 'c'); await store.settled('d');
    const columns = store.readView('d', 'selected').ready!.columns;
    const category = columns[0].id, measures = columns.filter(column => column.measureId === 'sales').map(column => column.id);
    expect(measures).toHaveLength(1);
    const bound = { ...target, linkedChart: { ...settings, category, measures } };
    render(<LinkedChartRenderer dashboardId="d" card={bound} refreshKey={0} store={store} onSettingsChange={async () => true}/>);
    await screen.findByTestId('figure');
    expect(JSON.parse(screen.getByTestId('figure').textContent!).data[0].y).toEqual([60922000000]);
    const apply = async (search: string) => act(async () => { store.updateDefinition('d', 's', { table: { pivot }, search }, { kind: 'none' }); await store.settled('d'); });
    await apply('no matching company');
    const empty = store.readView('d', 'c');
    expect(empty.status).toBe('empty');
    expect(empty.ready!.columns.some(column => column.id === measures[0])).toBe(false);
    expect((empty.ready!.chartColumns ?? empty.ready!.columns).some(column => column.id === measures[0])).toBe(false);
    await waitFor(() => expect(screen.queryByTestId('figure')).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('No selected series match the current filter.')).toBeVisible();
    await apply(''); await screen.findByTestId('figure');
    expect(JSON.parse(screen.getByTestId('figure').textContent!).data[0].y).toEqual([60922000000]);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/stale/)).toBeNull();
    cleanup(); store.disposeDashboard('d');
});

// These seams hold only delivery: the real executor has already computed each chart.
it('late_A_cannot_replace_completed_B', async () => {
    const store = await setup();
    const executor = store.readExecutor('d', 's')!, real = executor.chartData.bind(executor);
    const props = { dashboardId: 'd', card: chart, refreshKey: 0, store, onSettingsChange: async () => true };
    render(<LinkedChartRenderer {...props}/>); await screen.findByTestId('figure');
    let release!: () => void;
    executor.chartData = async (...args) => {
        const result = await real(...args);
        executor.chartData = real;
        await new Promise<void>(resolve => { release = resolve; });
        return result;
    };
    const apply = async (id: string) => act(async () => { store.updateDefinition('d', 's', { table: {}, search: '' }, { kind: 'explicit', ids: [id] }); await store.settled('d'); });
    await apply('r1'); await waitFor(() => expect(release).toBeDefined());
    expect(screen.getByText(/Updating chart/)).toBeVisible();
    await apply('r2');
    await waitFor(() => expect(JSON.parse(screen.getByTestId('figure').textContent!).data[0].y).toEqual([2]));
    const completed = screen.getByTestId('figure').textContent, revision = store.readView('d', 'c').sourceRevision;
    expect(store.readView('d', 's').active).toEqual(revision);
    await act(async () => release());
    expect(screen.getByTestId('figure').textContent).toBe(completed);
    expect(store.readView('d', 'c').sourceRevision).toEqual(revision);
    expect(screen.queryByText(/stale/)).toBeNull();
    cleanup(); store.disposeDashboard('d');
});
it('disposed_generation_cannot_publish into remounted reused widget IDs', async () => {
    const oldStore = await setup(), executor = oldStore.readExecutor('d', 's')!, real = executor.chartData.bind(executor);
    let release!: () => void;
    executor.chartData = async (...args) => { const result = await real(...args); await new Promise<void>(resolve => { release = resolve; }); return result; };
    const props = { dashboardId: 'd', card: chart, refreshKey: 0, onSettingsChange: async () => true };
    const mounted = render(<LinkedChartRenderer {...props} store={oldStore}/>);
    await waitFor(() => expect(release).toBeDefined());
    mounted.unmount(); oldStore.disposeDashboard('d');
    const store = await setup();
    store.updateDefinition('d', 's', { table: {}, search: '' }, { kind: 'explicit', ids: ['r7'] }); await store.settled('d');
    render(<LinkedChartRenderer {...props} store={store}/>); await screen.findByTestId('figure');
    expect(JSON.parse(screen.getByTestId('figure').textContent!).data[0].y).toEqual([7]);
    const completed = screen.getByTestId('figure').textContent, revision = store.readView('d', 'c').sourceRevision;
    await act(async () => release());
    expect(screen.getByTestId('figure').textContent).toBe(completed);
    expect(store.readView('d', 'c').sourceRevision).toEqual(revision);
    cleanup(); store.disposeDashboard('d');
});
it('missing_series_marks_old_figure_stale and repairing settings restores current data', async () => {
    const store = await setup();
    const props = { dashboardId: 'd', card: chart, refreshKey: 0, store, onSettingsChange: async () => true };
    const { rerender } = render(<LinkedChartRenderer {...props}/>); await screen.findByTestId('figure');
    const completed = screen.getByTestId('figure').textContent;
    rerender(<LinkedChartRenderer {...props} card={{ ...chart, linkedChart: { ...settings, measures: ['missing'] } }}/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Field missing is unavailable. Repair chart fields.');
    expect(screen.getByText(/showing completed data \(stale\)/)).toBeVisible();
    expect(screen.getByTestId('figure').textContent).toBe(completed);
    rerender(<LinkedChartRenderer {...props}/>);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.queryByText(/stale/)).toBeNull();
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
    render(<LinkedChartRenderer {...withSettings(store, { type: 'surface' })}/>);
    expect(screen.queryByLabelText('Display')).toBeNull(); expect(screen.queryByLabelText('Series from')).toBeNull();
    expect(screen.getByRole('option', { name: 'Surface (3-D)' })).toHaveValue('surface');
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

it('picking Surface with no fields chosen takes them from the source chartDataType hints, and never overwrites a choice', async () => {
    const store = await setup(); const commit = vi.fn(async (_: unknown) => true);
    const hints = [{ field: 'region', chartDataType: 'category' as const }, { field: 'revenue', chartDataType: 'series' as const }, { field: 'gone', chartDataType: 'series' as const }, { field: 'note', chartDataType: 'excluded' as const }];
    render(<LinkedChartRenderer {...withSettings(store, { category: undefined, measures: [] }, commit)} hints={hints}/>);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Revenue' })).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Chart type'), { target: { value: 'surface' } });
    await waitFor(() => expect(commit).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'surface', category: 'region', measures: ['revenue'] })));
    cleanup(); commit.mockClear();
    render(<LinkedChartRenderer {...withSettings(store, { measures: [] }, commit)} hints={hints}/>);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Revenue' })).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Chart type'), { target: { value: 'surface' } });
    await waitFor(() => expect(commit).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'surface', category: settings.category, measures: [] })));
    cleanup(); store.disposeDashboard('d');
});

it('lists the measures in source column order in a checklist that publishes once, in that order', async () => {
    const store = await setupRows([{ region: 'A', revenue: 1, cost: 2 }, { region: 'B', revenue: 3, cost: 4 }]); const commit = vi.fn(async (_: unknown) => true);
    const labels = () => [...screen.getByRole('dialog', { name: 'Measures' }).querySelectorAll('.opts label')].map(l => l.textContent);
    const { rerender } = render(<LinkedChartRenderer {...withSettings(store, { measures: ['cost'] }, commit)}/>);
    await screen.findByTestId('figure');
    // Unticked Revenue keeps its place ahead of Cost; the button says what is chosen.
    expect(screen.getByRole('button', { name: 'Measures: Cost' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Measures/ }));
    expect(labels()).toEqual(['Revenue', 'Cost']);
    expect(screen.getByRole('checkbox', { name: 'Cost' })).toBeChecked(); expect(screen.getByRole('checkbox', { name: 'Revenue' })).not.toBeChecked();
    // Ticking does not publish; Apply publishes once, in listed order whatever order the boxes were ticked in.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Revenue' }));
    expect(commit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    expect(commit.mock.lastCall![0]).toMatchObject({ measures: ['revenue', 'cost'] });
    expect(screen.queryByRole('dialog', { name: 'Measures' })).toBeNull();
    rerender(<LinkedChartRenderer {...withSettings(store, { measures: ['revenue', 'cost'] }, commit)}/>);
    expect(screen.getByRole('button', { name: 'Measures: All (2)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Measures/ })); fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(commit.mock.lastCall![0]).toMatchObject({ measures: [] }));
    cleanup(); store.disposeDashboard('d');
});

it('a Surface on a pivoted source offers Height and spacing values and requests the label plus their columns', async () => {
    const { LABEL_FIELD } = await import('../../lib/pivotTable');
    const pivot = { enabled: true, grouping: ['region'], split: ['team'], measures: [{ id: 'sales', sourceFieldId: 'revenue', aggregation: 'sum' as const }] };
    const data = { ...input, rows: [{ id: 'amd', values: { region: '2024', team: 'AMD', revenue: 100 } }, { id: 'avgo', values: { region: '2024', team: 'AVGO', revenue: 200 } }] };
    const store = createTableExecutionStore({ executor: id => createWorkerExecutor(id, () => new Boundary() as unknown as Worker), source: () => ({ acquire: async () => ({ kind: 'dataset', dataset: data }) }) });
    const source = { ...chart, id: 's', widgetId: 'local_table', params: { file: 'x' }, linkedSource: undefined, linkedChart: undefined, table: { pivot } };
    store.syncDashboard({ id: 'd', name: 'D', tabs: [{ id: 't', name: 'T', cards: [source, chart] }] } as Dashboard);
    store.ensureTable('d', 'c'); await store.settled('d');
    await act(async () => { store.updateDefinition('d', 's', { table: { pivot }, search: '' }, { kind: 'none' }); await store.settled('d'); });
    const sales = store.readView('d', 's').ready!.columns.filter(c => c.measureId === 'sales').map(c => c.id);
    const surface = { type: 'surface' as const, measures: [], display: 'grouped' as const };
    const commit = vi.fn(async (_: unknown) => true);
    const props = (s: object) => ({ dashboardId: 'd', card: { ...chart, linkedChart: { ...surface, ...s } }, refreshKey: 0, store, onSettingsChange: commit });
    const { rerender } = render(<LinkedChartRenderer {...props({})}/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose chart fields: select a value for Height.');
    expect(screen.queryByLabelText('Category')).toBeNull();
    expect([...(screen.getByLabelText('Space rows by') as HTMLSelectElement).options].map(o => [o.value, o.text])).toEqual([['', 'Default'], ['sales', expect.any(String)]]);
    fireEvent.change(screen.getByLabelText('Height'), { target: { value: 'sales' } });
    await waitFor(() => expect(commit).toHaveBeenLastCalledWith({ ...surface, height: 'sales' }));
    const e = store.readExecutor('d', 's')!; const request = vi.spyOn(e, 'chartData');
    rerender(<LinkedChartRenderer {...props({ height: 'sales', spaceRowsBy: 'sales' })}/>);
    await waitFor(() => expect(request).toHaveBeenCalled());
    expect(request.mock.calls.at(-1)![1]).toEqual([LABEL_FIELD, ...sales]);
    fireEvent.click(screen.getByRole('button', { name: /^Measures/ }));
    expect(screen.getAllByRole('checkbox').map(b => b.parentElement!.textContent)).toEqual(['AMD', 'AVGO']);
    fireEvent.change(screen.getByLabelText('Space rows by'), { target: { value: '' } });
    await waitFor(() => expect(commit).toHaveBeenLastCalledWith({ ...surface, height: 'sales' }));
    fireEvent.change(screen.getByLabelText('Chart type'), { target: { value: 'line' } });
    await waitFor(() => expect(commit).toHaveBeenLastCalledWith({ ...surface, type: 'line' }));
    cleanup(); store.disposeDashboard('d');
});

it('changing Height clears the ticked expiries; changing a spacing value keeps them', async () => {
    const pivot = { enabled: true, grouping: ['region'], split: ['team'], measures: [{ id: 'sales', sourceFieldId: 'revenue', aggregation: 'sum' as const }, { id: 'peak', sourceFieldId: 'revenue', aggregation: 'max' as const }] };
    const data = { ...input, rows: [{ id: 'amd', values: { region: '2024', team: 'AMD', revenue: 100 } }, { id: 'avgo', values: { region: '2024', team: 'AVGO', revenue: 200 } }] };
    const store = createTableExecutionStore({ executor: id => createWorkerExecutor(id, () => new Boundary() as unknown as Worker), source: () => ({ acquire: async () => ({ kind: 'dataset', dataset: data }) }) });
    const source = { ...chart, id: 's', widgetId: 'local_table', params: { file: 'x' }, linkedSource: undefined, linkedChart: undefined, table: { pivot } };
    store.syncDashboard({ id: 'd', name: 'D', tabs: [{ id: 't', name: 'T', cards: [source, chart] }] } as Dashboard);
    store.ensureTable('d', 'c'); await store.settled('d');
    await act(async () => { store.updateDefinition('d', 's', { table: { pivot }, search: '' }, { kind: 'none' }); await store.settled('d'); });
    const ticked = store.readView('d', 's').ready!.columns.filter(c => c.measureId === 'sales').map(c => c.id);
    const settings = { type: 'surface' as const, measures: ticked, display: 'grouped' as const, height: 'sales', spaceRowsBy: 'peak' };
    const commit = vi.fn(async (_: unknown) => true);
    render(<LinkedChartRenderer dashboardId="d" card={{ ...chart, linkedChart: settings }} refreshKey={0} store={store} onSettingsChange={commit}/>);
    await screen.findByLabelText('Height');
    fireEvent.change(screen.getByLabelText('Space rows by'), { target: { value: '' } });
    await waitFor(() => expect(commit).toHaveBeenLastCalledWith({ type: 'surface', measures: ticked, display: 'grouped', height: 'sales' }));
    fireEvent.change(screen.getByLabelText('Height'), { target: { value: 'peak' } });
    await waitFor(() => expect(commit).toHaveBeenLastCalledWith({ ...settings, height: 'peak', measures: [] }));
    fireEvent.change(screen.getByLabelText('Height'), { target: { value: '' } });
    await waitFor(() => expect(commit).toHaveBeenLastCalledWith({ type: 'surface', measures: [], display: 'grouped', spaceRowsBy: 'peak' }));
    cleanup(); store.disposeDashboard('d');
});

it('on a pivoted Surface, All saves "every expiry the report offers" (an empty list) and an empty list reads and ticks as all', async () => {
    const pivot = { enabled: true, grouping: ['region'], split: ['team'], measures: [{ id: 'sales', sourceFieldId: 'revenue', aggregation: 'sum' as const }] };
    const data = { ...input, rows: ['2024', '2025'].flatMap((region, r) => ['AMD', 'AVGO'].map((team, t) => ({ id: region + team, values: { region, team, revenue: 100 * (r + 1) + t } }))) };
    const store = createTableExecutionStore({ executor: id => createWorkerExecutor(id, () => new Boundary() as unknown as Worker), source: () => ({ acquire: async () => ({ kind: 'dataset', dataset: data }) }) });
    const source = { ...chart, id: 's', widgetId: 'local_table', params: { file: 'x' }, linkedSource: undefined, linkedChart: undefined, table: { pivot } };
    store.syncDashboard({ id: 'd', name: 'D', tabs: [{ id: 't', name: 'T', cards: [source, chart] }] } as Dashboard);
    store.ensureTable('d', 'c'); await store.settled('d');
    await act(async () => { store.updateDefinition('d', 's', { table: { pivot }, search: '' }, { kind: 'none' }); await store.settled('d'); });
    const [amd] = store.readView('d', 's').ready!.columns.filter(c => c.measureId === 'sales').map(c => c.id);
    const base = { type: 'surface' as const, display: 'grouped' as const, height: 'sales' };
    const commit = vi.fn(async (_: unknown) => true);
    const props = (measures: string[]) => ({ dashboardId: 'd', card: { ...chart, linkedChart: { ...base, measures } }, refreshKey: 0, store, onSettingsChange: commit });
    const { rerender } = render(<LinkedChartRenderer {...props([])}/>);
    // No explicit list: every expiry is drawn, so the button and the checklist say all.
    expect(await screen.findByRole('button', { name: 'Measures: All (2)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Measures/ }));
    expect(screen.getAllByRole('checkbox').map(b => (b as HTMLInputElement).checked)).toEqual([true, true]);
    // All does not freeze the current ids; unticking one and Apply still saves an explicit list.
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    await waitFor(() => expect(commit).toHaveBeenLastCalledWith({ ...base, measures: [] }));
    fireEvent.click(screen.getByRole('button', { name: /^Measures/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'AVGO' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(commit).toHaveBeenLastCalledWith({ ...base, measures: [amd] }));
    rerender(<LinkedChartRenderer {...props([amd])}/>);
    expect(screen.getByRole('button', { name: 'Measures: AMD' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Measures/ }));
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    await waitFor(() => expect(commit).toHaveBeenLastCalledWith({ ...base, measures: [] }));
    cleanup(); store.disposeDashboard('d');
});

it('a Surface on a report whose checklist hides a column member requests only the columns the report offers', async () => {
    const { LABEL_FIELD } = await import('../../lib/pivotTable');
    const { pivotValueKey } = await import('../../lib/pivotKeys');
    const analytical = { schemaVersion: 1, enabled: true, params: { promotePage: true, filters: [] }, formulas: [], resultFilters: [], subtotals: { grandTotal: false, groups: false },
        categories: [{ id: 'region_cat', name: 'Region', sourceFieldId: 'region', transform: 'native' }, { id: 'team_cat', name: 'Team', sourceFieldId: 'team', transform: 'native' }],
        measures: [{ id: 'sales', sourceFieldId: 'revenue', aggregation: 'sum' }],
        layout: { rows: ['region_cat'], columns: ['team_cat'], values: ['sales'] },
        checklists: [{ categoryId: 'team_cat', memberKeys: [pivotValueKey('AMD'), pivotValueKey('AVGO')] }] };
    const data = { ...input, rows: ['2024', '2025'].flatMap((region, r) => ['AMD', 'AVGO', 'NVDA'].map((team, t) => ({ id: `${region}${team}`, values: { region, team, revenue: 100 * (r + 1) + t } }))) };
    const store = createTableExecutionStore({ executor: id => createWorkerExecutor(id, () => new Boundary() as unknown as Worker), source: () => ({ acquire: async () => ({ kind: 'dataset', dataset: data }) }) });
    const source = { ...chart, id: 's', widgetId: 'local_table', params: { file: 'x' }, linkedSource: undefined, linkedChart: undefined };
    store.syncDashboard({ id: 'd', name: 'D', tabs: [{ id: 't', name: 'T', cards: [source, chart] }] } as Dashboard);
    store.ensureTable('d', 'c'); await store.settled('d');
    await act(async () => { store.updateDefinition('d', 's', { table: {}, search: '', analytical } as never, { kind: 'none' }); await store.settled('d'); });
    const ready = store.readView('d', 's').ready!;
    const sales = ready.columns.filter(c => c.measureId === 'sales').map(c => c.id);
    expect(sales).toHaveLength(2);
    expect(ready.chartColumns!.filter(c => c.measureId === 'sales')).toHaveLength(3);
    const request = vi.spyOn(store.readExecutor('d', 's')!, 'chartData');
    render(<LinkedChartRenderer dashboardId="d" card={{ ...chart, linkedChart: { type: 'surface', measures: [], display: 'grouped', height: 'sales' } }} refreshKey={0} store={store} onSettingsChange={async () => true}/>);
    await screen.findByTestId('figure');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(request.mock.calls.at(-1)![1]).toEqual([LABEL_FIELD, ...sales]);
    cleanup(); store.disposeDashboard('d');
});
