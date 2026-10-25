// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

vi.mock('../lib/plotly', () => ({ renderPlot: async () => {}, purgePlot: () => {}, resizePlot: () => {}, REGISTERED_TRACE_TYPES: new Set(['bar', 'scatter']) }));
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
import { card } from '../test/fixtures';
import { tableExecutionStore } from '../stores/tableExecutionStore';
import { TableExecutionRuntime } from './TableExecutionRuntime';
import { createWorkerHandler } from '../lib/tableExecution/table.worker';
import type { ExecutionRequest } from '../lib/tableExecution/types';
import { saveLocalFile } from '../lib/localFiles';
import { writeFile } from '@tauri-apps/plugin-fs';
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
  await writeFile(`files/${file}`, new TextEncoder().encode('region,revenue,gone\nA,15,yes\nB,95,yes\n'));
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
