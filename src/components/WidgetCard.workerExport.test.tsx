// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// D-018: worker tables (local files and linked tables) carry the same ⋯
// Export menu as a backend table, and write what the worker presents.
vi.mock('../lib/plotly', () => ({ renderPlot: async () => {}, purgePlot: () => {}, resizePlot: () => {}, REGISTERED_TRACE_TYPES: new Set(['bar', 'scatter']) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(), open: vi.fn(), confirm: vi.fn() }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: globalThis.fetch }));
vi.mock('@tanstack/react-virtual', () => ({ useVirtualizer: ({ count }: { count: number }) => ({ getVirtualItems: () => Array.from({ length: Math.min(count, 8) }, (_, index) => ({ index, start: index * 28, end: (index + 1) * 28 })), getTotalSize: () => count * 28, measureElement: () => {}, scrollToIndex: () => {} }) }));
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { save } from '@tauri-apps/plugin-dialog';
import { WidgetCard } from './WidgetCard';
import { TableExecutionRuntime } from './TableExecutionRuntime';
import { useDashboardStore } from '../stores/dashboardStore';
import { useWidgetRegistryStore } from '../stores/widgetRegistryStore';
import { tableExecutionStore } from '../stores/tableExecutionStore';
import { __read, __readBytes, __reset } from '../test/memfs';
import { __resetJsonStoreForTests } from '../lib/jsonStore';
import { backend, card, widget } from '../test/fixtures';
import { useBackendsStore } from '../stores/backendsStore';
import { startMockServer } from '../test/mockServer';
import { page } from '../lib/temporal/fixtures';
import type { TableExecutor } from '../lib/tableExecution/types';
import { Boundary } from '../test/tableWorkerBoundary';
import { saveLocalFile } from '../lib/localFiles';
import type { DashboardCard } from '../lib/types';
import type { TableModelV1 } from '../lib/tableModel/types';

afterEach(() => { cleanup(); tableExecutionStore.disposeDashboard('d'); vi.unstubAllGlobals(); });
beforeEach(() => {
  __reset(); __resetJsonStoreForTests(); useWidgetRegistryStore.getState().seedBuiltins();
  vi.stubGlobal('Worker', Boundary);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.mocked(save).mockReset();
});

async function setUp(extra: (file: string) => DashboardCard[] = () => []) {
  const file = await saveLocalFile(new File(['Company,Amount\nAAPL,100\nAAPL,\nMSFT,200\n'], 'practice.csv'));
  const source = card({ id: 's', widgetId: 'local_table', backendId: 'builtin', title: 'practice.csv', params: { file } });
  const cards = [source, ...extra(file)];
  useDashboardStore.setState({ dashboards: [{ id: 'd', name: 'D', tabs: [{ id: 't', name: 'First', cards }] }], activeId: 'd', activeTabId: 't', viewer: false, pendingCardRemoval: null });
  return cards;
}
async function exportAs(target: DashboardCard, item: 'CSV' | 'JSON' | 'Excel', path: string) {
  const { container } = render(<><TableExecutionRuntime /><WidgetCard card={target} onRemove={() => {}} /></>);
  await waitFor(() => expect(container.querySelector('tbody')?.textContent).toContain('MSFT'));
  vi.mocked(save).mockResolvedValue(path);
  fireEvent.click(screen.getByRole('button', { name: 'Card menu' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Export ▸' }));
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
  await waitFor(() => expect(__read(path) ?? __readBytes(path)).toBeDefined());
  return __read(path);
}

it('offers Export on a local-file card and writes its raw rows, the missing value left empty', async () => {
  const [source] = await setUp();
  expect(await exportAs(source, 'CSV', '/out.csv')).toBe('Company,Amount\r\nAAPL,100\r\nAAPL,\r\nMSFT,200');
  // Named for the file the person dropped, never the stored copy's id.
  expect(vi.mocked(save).mock.calls[0][0]?.defaultPath).toMatch(/^practice\.csv \d{4}-\d{2}-\d{2}\.csv$/);
});

it('exports the committed arranged result, not the input rows', async () => {
  const [source] = await setUp();
  const analytical: TableModelV1 = { schemaVersion: 1, params: { promotePage: true, filters: [] }, enabled: true,
    categories: [{ id: 'co', name: 'Company', sourceFieldId: 'Company', transform: 'native' }],
    measures: [{ id: 'sum', sourceFieldId: 'Amount', aggregation: 'sum' }], formulas: [],
    layout: { rows: ['co'], columns: [], values: ['sum'] }, checklists: [], resultFilters: [], subtotals: { grandTotal: true, groups: true } };
  const { container } = render(<><TableExecutionRuntime /><WidgetCard card={source} onRemove={() => {}} /></>);
  await waitFor(() => expect(container.querySelector('tbody')?.textContent).toContain('MSFT'));
  await act(async () => { tableExecutionStore.updateDefinition('d', 's', { table: {}, search: '', analytical }, { kind: 'none' }); await tableExecutionStore.settled('d'); });
  vi.mocked(save).mockResolvedValue('/arranged.json');
  fireEvent.click(screen.getByRole('button', { name: 'Card menu' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Export ▸' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'JSON' }));
  await waitFor(() => expect(__read('/arranged.json')).toBeDefined());
  expect(JSON.parse(__read('/arranged.json')!)).toEqual([{ Company: 'AAPL', 'Amount — Total': 100 }, { Company: 'MSFT', 'Amount — Total': 200 }]);
});

it('offers Export on a linked table through the same worker-table predicate', async () => {
  const [, child] = await setUp(() => [card({ id: 'child', widgetId: 'linked_table', backendId: 'builtin', title: 'Linked', linkedSource: { kind: 'widget', sourceWidgetId: 's' } })]);
  expect(await exportAs(child, 'CSV', '/linked.csv')).toBe('Company,Amount\r\nAAPL,100\r\nAAPL,\r\nMSFT,200');
});

it('exports every row the table shows, not only the rows selected for linked children', async () => {
  const [source] = await setUp();
  const { container } = render(<><TableExecutionRuntime /><WidgetCard card={source} onRemove={() => {}} /></>);
  await waitFor(() => expect(container.querySelector('tbody')?.textContent).toContain('MSFT'));
  const view = tableExecutionStore.readView('d', 's');
  const block = await tableExecutionStore.readExecutor('d', 's')!.rows(view.active!, { groupPath: [], offset: 0, limit: 10 }, new AbortController().signal);
  await act(async () => { tableExecutionStore.updateDefinition('d', 's', view.definition, { kind: 'explicit', ids: [block.rows[0].id] }); await tableExecutionStore.settled('d'); });
  vi.mocked(save).mockResolvedValue('/all.csv');
  fireEvent.click(screen.getByRole('button', { name: 'Card menu' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Export ▸' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'CSV' }));
  await waitFor(() => expect(__read('/all.csv')).toBeDefined());
  expect(__read('/all.csv')).toBe('Company,Amount\r\nAAPL,100\r\nAAPL,\r\nMSFT,200');
});

// v8 pinned cards: a card pinned to an edge exports through the same full-scope worker path.
it('exports every row of a pinned worker table', async () => {
  const [source] = await setUp();
  const pinned = { ...source, pinned: 'bottom' as const };
  useDashboardStore.setState({ dashboards: [{ id: 'd', name: 'D', tabs: [{ id: 't', name: 'First', cards: [pinned] }] }] });
  expect(await exportAs(pinned, 'CSV', '/pinned.csv')).toBe('Company,Amount\r\nAAPL,100\r\nAAPL,\r\nMSFT,200');
});

it('writes a date column as Excel date cells, not text (#28)', async () => {
  const XLSX = await import('xlsx');
  const file = await saveLocalFile(new File(['Date,Company,Amount\n2025-01-02,AAPL,100\n2025-01-03,MSFT,200\n'], 'practice.csv'));
  const source = card({ id: 's', widgetId: 'local_table', backendId: 'builtin', title: 'practice.csv', params: { file } });
  useDashboardStore.setState({ dashboards: [{ id: 'd', name: 'D', tabs: [{ id: 't', name: 'First', cards: [source] }] }], activeId: 'd', activeTabId: 't', viewer: false, pendingCardRemoval: null });
  await exportAs(source, 'Excel', '/out.xlsx');
  const sheet = XLSX.read(__readBytes('/out.xlsx')!, { cellNF: true }).Sheets.Data;
  expect(sheet.A2).toMatchObject({ t: 'n', v: 45659 });
  expect(XLSX.SSF.format(sheet.A2.z as string, sheet.A2.v as number)).toBe('2025-01-02');
  expect(sheet.B2).toMatchObject({ t: 's', v: 'AAPL' });
  expect(sheet.C3).toMatchObject({ t: 'n', v: 200 });
});

/** The real worker's presented() batches, merged with `stamp` (what a TemporalDB source adds); `during` runs mid-stream. */
function wrapPresented(stamp: object, during: () => void = () => {}) {
  const read = tableExecutionStore.readExecutor.bind(tableExecutionStore);
  return vi.spyOn(tableExecutionStore, 'readExecutor').mockImplementation((...args) => {
    const executor = read(...args);
    return executor && { ...executor, async *presented(...p: Parameters<TableExecutor['presented']>) { for await (const batch of executor.presented(...p)) { during(); yield { ...batch, ...stamp }; } } } as ReturnType<typeof read>;
  });
}
/** readView reporting a newer active revision once the export has started reading, as a refresh-interval card re-activating would. */
function reactivateDuringExport() {
  let reactivated = false;
  const read = tableExecutionStore.readView.bind(tableExecutionStore);
  // Memoised per view: readView feeds a store subscription, which needs a stable snapshot.
  const next = new WeakMap<object, ReturnType<typeof read>>();
  const view = vi.spyOn(tableExecutionStore, 'readView').mockImplementation((...args) => {
    const v = read(...args);
    if (!reactivated || !v.active) return v;
    if (!next.has(v)) next.set(v, { ...v, active: { ...v.active, output: v.active.output + 1 } });
    return next.get(v)!;
  });
  return { view, during: () => { reactivated = true; } };
}

// v11: a TemporalDB result's batches carry its receipt; the export writes it as provenance metadata.
it('exports a temporal receipt batch with its provenance and completeness in CSV and JSON', async () => {
  const [source] = await setUp();
  const provenance = { sourceWidgetId: 's', receipt: { temporal: { executionId: page.receipt.execution_id, queryId: page.receipt.query_id, queryRevision: 2, resultHash: page.receipt.result_hash } } };
  const completeness = { kind: 'paged' as const, acquiredRowCount: 4, totalRowCount: 2000, totalRowCountKind: 'exact' as const, warnings: [] };
  const spy = wrapPresented({ provenance, completeness });
  try {
    const csv = await exportAs(source, 'CSV', '/temporal.csv');
    const [header, first] = csv!.split('\r\n');
    expect(header).toBe('Company,Amount,__temporaldb_record_kind_v1,__temporaldb_provenance_v1,__temporaldb_completeness_v1,__temporaldb_export_v1');
    expect(first.startsWith('AAPL,100,data,')).toBe(true);
    cleanup();
    const json = JSON.parse((await exportAs(source, 'JSON', '/temporal.json'))!);
    expect(json).toMatchObject({ schemaVersion: 1, provenance, completeness });
    expect(json.rows).toEqual([{ Company: 'AAPL', Amount: 100 }, { Company: 'AAPL', Amount: null }, { Company: 'MSFT', Amount: 200 }]);
  } finally { spy.mockRestore(); }
});

// The v10 contract for an ordinary backend table: plain CSV, no TemporalDB columns.
it('exports a plain backend table on the worker exactly as v10 did', async () => {
  const server = await startMockServer({ '/prices': [{ Company: 'AAPL', Amount: 100 }, { Company: 'MSFT', Amount: 200 }] });
  try {
    useBackendsStore.setState({ backends: [backend({ baseUrl: server.url })], statuses: { b1: 'online' } });
    useWidgetRegistryStore.setState((st) => ({ widgets: [...st.widgets, widget({ id: 'prices', type: 'table', endpoint: 'prices' })] }));
    const table = card({ id: 'bt', widgetId: 'prices', title: 'Prices' });
    useDashboardStore.setState({ dashboards: [{ id: 'd', name: 'D', tabs: [{ id: 't', name: 'First', cards: [table] }] }], activeId: 'd', activeTabId: 't', viewer: false, pendingCardRemoval: null });
    expect(await exportAs(table, 'CSV', '/backend.csv')).toBe('Company,Amount\r\nAAPL,100\r\nMSFT,200');
  } finally { await server.close(); }
});

// The export is revision-bound (collectPresentedExport), so a card re-activating mid-export still writes the revision it read.
it('still exports a plain worker table whose view re-activates mid-export', async () => {
  const [source] = await setUp();
  const { view, during } = reactivateDuringExport();
  const spy = wrapPresented({}, during);
  try {
    expect(await exportAs(source, 'CSV', '/refreshed.csv')).toBe('Company,Amount\r\nAAPL,100\r\nAAPL,\r\nMSFT,200');
  } finally { spy.mockRestore(); view.mockRestore(); }
});

// A TemporalDB result is scope-bound: a re-activation (e.g. scope eviction) mid-export refuses the stale result.
it('refuses a temporal export whose view re-activates mid-export', async () => {
  const [source] = await setUp();
  const { container } = render(<><TableExecutionRuntime /><WidgetCard card={source} onRemove={() => {}} /></>);
  await waitFor(() => expect(container.querySelector('tbody')?.textContent).toContain('MSFT'));
  const { view, during } = reactivateDuringExport();
  const spy = wrapPresented({ provenance: { sourceWidgetId: 's', receipt: { temporal: { executionId: page.receipt.execution_id, queryId: page.receipt.query_id, queryRevision: 2, resultHash: page.receipt.result_hash } } } }, during);
  try {
    vi.mocked(save).mockResolvedValue('/stale.csv');
    fireEvent.click(screen.getByRole('button', { name: 'Card menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export ▸' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'CSV' }));
    await waitFor(() => expect(screen.getByText('Export failed: Table changed during export')).toBeDefined());
    expect(__read('/stale.csv')).toBeUndefined();
  } finally { spy.mockRestore(); view.mockRestore(); }
});
