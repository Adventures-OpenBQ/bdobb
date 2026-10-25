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
