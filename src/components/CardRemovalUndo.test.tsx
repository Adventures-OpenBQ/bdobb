// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CardRemovalUndo } from './CardRemovalUndo';
import { useDashboardStore } from '../stores/dashboardStore';
import { __reset, __failPath } from '../test/memfs';
import { __resetJsonStoreForTests } from '../lib/jsonStore';
import { widget } from '../test/fixtures';
import { readLocalFile, saveLocalFile } from '../lib/localFiles';
beforeEach(() => {
  __reset(); __resetJsonStoreForTests();
  useDashboardStore.setState({ dashboards: [], activeId: null, activeTabId: null, viewer: false, pendingCardRemoval: null });
});
async function removed() {
  await useDashboardStore.getState().load();
  const file = await saveLocalFile(new File(['value\n7'], 'rows.csv'));
  const id = (await useDashboardStore.getState().addCard(widget({ id: 'local_table', backendId: 'builtin' }), { file }))!;
  await useDashboardStore.getState().removeCard(id);
  return { id, file, dashboardId: useDashboardStore.getState().activeId! };
}
it('Undo restores the source identity and retained file', async () => {
  const { id, file } = await removed();
  render(<CardRemovalUndo />);
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(useDashboardStore.getState().activeDashboard()!.tabs[0].cards[0]?.id).toBe(id));
  expect(await readLocalFile(file)).toBeInstanceOf(Uint8Array);
  expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
});
it('failed Undo shows an error and retains the control', async () => {
  const { dashboardId } = await removed(); __failPath(`dashboards/${dashboardId}.json`);
  render(<CardRemovalUndo />); fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not undo/i));
  expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
});
it('viewer exposes no mutation controls', async () => {
  await removed(); useDashboardStore.setState({ viewer: true });
  render(<CardRemovalUndo />);
  expect(screen.queryByRole('button')).toBeNull();
});

it('Undo restores the same source and recovers its worker-backed dependent cascade', async () => {
  const { createTableExecutionStore } = await import('../stores/tableExecutionStore');
  const { createWorkerExecutor } = await import('../lib/tableExecution/workerClient');
  const { createWorkerHandler } = await import('../lib/tableExecution/table.worker');
  const { TableExecutionRuntime } = await import('./TableExecutionRuntime');
  class Boundary {
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror = null; onmessageerror = null;
    handler = createWorkerHandler(data => this.onmessage?.({ data } as MessageEvent));
    postMessage(data: import('../lib/tableExecution/types').ExecutionRequest) { void this.handler(data); }
    terminate() {}
  }
  await useDashboardStore.getState().load();
  const file = await saveLocalFile(new File(['value\n7'], 'rows.csv'));
  const id = (await useDashboardStore.getState().addCard(widget({ id: 'local_table', backendId: 'builtin' }), { file }))!;
  const dashboard = useDashboardStore.getState().activeDashboard()!;
  const source = dashboard.tabs[0].cards[0];
  const child = { ...source, id: 'child', linkedSource: { kind: 'widget' as const, sourceWidgetId: id } };
  useDashboardStore.setState({ dashboards: [{ ...dashboard, tabs: [{ ...dashboard.tabs[0], cards: [source, child] }] }] });
  const execution = createTableExecutionStore({ executor: widgetId => createWorkerExecutor(widgetId, () => new Boundary() as unknown as Worker), source: card => ({ acquire: async () => ({ kind: 'file', name: card.params.file, bytes: await readLocalFile(card.params.file) }) }) });
  render(<><TableExecutionRuntime store={execution} /><CardRemovalUndo /></>);
  await waitFor(() => expect(execution.readView(dashboard.id, 'child').status).toBe('ready'));
  await act(async () => { await useDashboardStore.getState().removeCard(id); });
  await waitFor(() => expect(execution.readView(dashboard.id, 'child').status).toBe('unavailable'));
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(execution.readView(dashboard.id, 'child').status).toBe('ready'));
  const view = execution.readView(dashboard.id, 'child');
  const rows = await execution.readExecutor(dashboard.id, 'child')!.rows(view.active!, { groupPath: [], offset: 0, limit: 10 }, new AbortController().signal);
  expect(rows.rows[0].values).toEqual({ value: 7 });
  expect(view.sourceRevision?.widgetId).toBe(id);
});
it('Dismiss releases the retained file and removal control', async () => {
  const { file } = await removed(); render(<CardRemovalUndo />);
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull());
  await expect(readLocalFile(file)).rejects.toThrow();
});
