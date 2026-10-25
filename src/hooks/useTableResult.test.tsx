// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useTableResult, TABLE_BLOCK_SIZE, TABLE_CACHE_BLOCKS } from './useTableResult';
import { createTableExecutionStore } from '../stores/tableExecutionStore';
import { createWorkerExecutor } from '../lib/tableExecution/workerClient';
import { Boundary } from '../test/tableWorkerBoundary';
import { input } from '../lib/tableExecution/fixtures';
import { ExecutionProtocolError } from '../lib/tableExecution/validation';
import type { Dashboard } from '../lib/types';
import type { RowBlock, TotalResult } from '../lib/tableExecution/types';
async function setup(dataset = input) {
  const store = createTableExecutionStore({ executor: id => createWorkerExecutor(id, () => new Boundary() as unknown as Worker), source: () => ({ acquire: async () => ({ kind: 'dataset', dataset: structuredClone(dataset) }) }) });
  store.syncDashboard({ id: 'd', name: 'D', tabs: [{ id: 't', name: 'T', cards: [{ id: 'w', widgetId: 'local_table', backendId: 'builtin', params: { file: 'x' }, layout: { x: 0, y: 0, w: 1, h: 1 } }] }] } as Dashboard);
  store.ensureTable('d', 'w'); await store.settled('d');
  return store;
}
it('totalAndRowsActivateTogether and oldRowsStayVisibleWhileUpdating', async () => {
  const store = await setup();
  const hook = renderHook(() => useTableResult('d', 'w', store));
  await waitFor(() => expect(hook.result.current.blocks).toHaveLength(1));
  const old = hook.result.current.blocks[0];
  const e = store.readExecutor('d', 'w')!;
  const totals = e.totals.bind(e); let release!: (t: TotalResult) => void;
  e.totals = async (...args) => { const t = await totals(...args); return new Promise(r => { release = () => r(t); }); };
  await act(async () => { store.updateDefinition('d', 'w', { table: {}, search: 'A' }, { kind: 'none' }); await store.settled('d'); });
  expect(hook.result.current.blocks[0]).toBe(old);
  expect(hook.result.current.view.status).toBe('updating');
  await act(async () => release(undefined as never));
  await waitFor(() => expect(hook.result.current.blocks[0].rows).toHaveLength(2));
  expect(hook.result.current.totals?.revision).toEqual(hook.result.current.blocks[0].revision);
});
it('lateExpandedBlockCannotAttachToNewSchema', async () => {
  const store = await setup(); const hook = renderHook(() => useTableResult('d', 'w', store));
  await waitFor(() => expect(hook.result.current.blocks).toHaveLength(1));
  const e = store.readExecutor('d', 'w')!; const rows = e.rows.bind(e); let release!: () => void;
  e.rows = async (...args) => { const b = await rows(...args); if (args[1].offset !== 0) return new Promise<RowBlock>(r => { release = () => r(b); }); return b; };
  act(() => hook.result.current.requestRows({ groupPath: [], offset: 2, limit: 1 }));
  await waitFor(() => expect(release).toBeDefined());
  await act(async () => { store.updateDefinition('d', 'w', { table: { hidden: ['team'] }, search: '' }, { kind: 'none' }); await store.settled('d'); });
  await waitFor(() => expect(hook.result.current.view.ready?.columns.some(c => c.id === 'team')).toBe(false));
  await act(async () => release());
  expect(hook.result.current.blocks).toHaveLength(1);
});
it('selectAllDoesNotEnumerateCachedRows', async () => {
  const store = await setup(); const hook = renderHook(() => useTableResult('d', 'w', store));
  await waitFor(() => expect(hook.result.current.blocks).toHaveLength(1));
  await act(async () => { store.updateDefinition('d', 'w', store.readView('d', 'w').definition, { kind: 'allMatching', excludedIds: [] }); await store.settled('d'); });
  expect(store.readView('d', 'w').selection).toEqual({ kind: 'allMatching', excludedIds: [] });
});

it('cache evicts old blocks and caps each read without materializing the full result', async () => {
  const dataset = { ...input, rows: Array.from({ length: 2000 }, (_, i) => ({ id: `r${i}`, values: { revenue: i, region: 'A', team: String(i), date: '2026-01-01' } })) };
  const store = await setup(dataset); const hook = renderHook(() => useTableResult('d', 'w', store));
  await waitFor(() => expect(hook.result.current.blocks).toHaveLength(1));
  for (let offset = 100; offset < 1600; offset += 100) {
    act(() => hook.result.current.requestRows({ groupPath: [], offset, limit: 2000 }));
    await waitFor(() => expect(hook.result.current.blocks.some(b => b.offset === offset)).toBe(true));
  }
  expect(hook.result.current.blocks).toHaveLength(TABLE_CACHE_BLOCKS);
  expect(hook.result.current.blocks.every(b => b.rows.length <= TABLE_BLOCK_SIZE)).toBe(true);
  expect(hook.result.current.blocks.some(b => b.offset === 0)).toBe(false);
  expect(hook.result.current.view.ready?.topLevelCount).toBe(2000);
  act(() => hook.result.current.requestRows({ groupPath: [], offset: 0, limit: 100 }));
  await waitFor(() => expect(hook.result.current.blocks.some(b => b.offset === 0)).toBe(true));
  hook.unmount(); store.disposeDashboard('d');
});
it('bounds outstanding scroll reads when the worker is slow', async () => {
  const store = await setup(); const hook = renderHook(() => useTableResult('d', 'w', store));
  await waitFor(() => expect(hook.result.current.blocks).toHaveLength(1));
  const signals: AbortSignal[] = [];
  store.readExecutor('d', 'w')!.rows = async (_revision, _request, signal) => {
    signals.push(signal); return new Promise<RowBlock>(() => {});
  };
  act(() => { for (let offset = 100; offset < 5000; offset += 100) hook.result.current.requestRows({ groupPath: [], offset, limit: 100 }); });
  expect(signals.filter(s => !s.aborted).length).toBeLessThanOrEqual(TABLE_CACHE_BLOCKS);
  hook.unmount();
  expect(signals.every(signal => signal.aborted)).toBe(true);
  store.disposeDashboard('d');
});
it('successful block retry clears its delivery error', async () => {
  const store = await setup(); const hook = renderHook(() => useTableResult('d', 'w', store));
  await waitFor(() => expect(hook.result.current.blocks).toHaveLength(1));
  const executor = store.readExecutor('d', 'w')!, rows = executor.rows.bind(executor);
  let fail = true;
  executor.rows = async (...args) => { if (fail) { fail = false; throw new Error('transport failure'); } return rows(...args); };
  act(() => hook.result.current.requestRows({ groupPath: [], offset: 2, limit: 1 }));
  await waitFor(() => expect(hook.result.current.view.error).toBe('Could not load table rows'));
  act(() => hook.result.current.requestRows({ groupPath: [], offset: 2, limit: 1 }));
  await waitFor(() => expect(hook.result.current.blocks).toHaveLength(2));
  expect(hook.result.current.view.error).toBeUndefined();
  hook.unmount(); store.disposeDashboard('d');
});
it('a read superseded by a newer view shows no error', async () => {
  const store = await setup(); const hook = renderHook(() => useTableResult('d', 'w', store));
  await waitFor(() => expect(hook.result.current.blocks).toHaveLength(1));
  const executor = store.readExecutor('d', 'w')!;
  executor.rows = async () => { throw new ExecutionProtocolError('REVISION_MISMATCH', 'Table view superseded'); };
  act(() => hook.result.current.requestRows({ groupPath: [], offset: 2, limit: 1 }));
  await new Promise(r => setTimeout(r, 20));
  expect(hook.result.current.view.error).toBeUndefined();
  store.disposeDashboard('d');
});
