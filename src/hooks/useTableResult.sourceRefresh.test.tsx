// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useTableResult } from './useTableResult';
import { createTableExecutionStore } from '../stores/tableExecutionStore';
import { createWorkerExecutor } from '../lib/tableExecution/workerClient';
import { Boundary } from '../test/tableWorkerBoundary';
import { input } from '../lib/tableExecution/fixtures';
import type { ExecutionRequest } from '../lib/tableExecution/types';
import type { Dashboard } from '../lib/types';

// A real store/hook/worker protocol, with only worker scheduling held at the boundary.
it.each(['initial', 'scroll'] as const)('source refresh supersedes an admitted %s read without displaying a delivery error', async (phase) => {
  let holdNew = false;
  const workers: HeldBoundary[] = [];
  class HeldBoundary extends Boundary {
    hold = holdNew;
    held: ExecutionRequest[] = [];
    constructor() { super(); workers.push(this); }
    postMessage(request: ExecutionRequest) { if (this.hold) this.held.push(request); else super.postMessage(request); }
    release() { this.hold = false; for (const request of this.held.splice(0)) super.postMessage(request); }
  }
  const store = createTableExecutionStore({
    executor: id => createWorkerExecutor(id, () => new HeldBoundary() as unknown as Worker),
    source: () => ({ acquire: async () => ({ kind: 'dataset', dataset: structuredClone(input) }) }),
  });
  store.syncDashboard({ id: 'd', name: 'D', tabs: [{ id: 't', name: 'T', cards: [{ id: 'w', widgetId: 'local_table', backendId: 'builtin', params: { file: 'fixture.csv' }, layout: { x: 0, y: 0, w: 1, h: 1 } }] }] } as Dashboard);
  store.ensureTable('d', 'w'); await store.settled('d');
  let hook = renderHook(() => useTableResult('d', 'w', store));
  try {
    await waitFor(() => expect(hook.result.current.blocks).toHaveLength(1));
    const oldBlock = hook.result.current.blocks[0];
    if (phase === 'initial') {
      hook.unmount(); workers[0].hold = true;
      hook = renderHook(() => useTableResult('d', 'w', store));
    } else {
      workers[0].hold = true;
      act(() => hook.result.current.requestRows({ groupPath: [], offset: 2, limit: 1 }));
    }
    await waitFor(() => expect(workers[0].held.filter(r => r.kind === 'rows' || r.kind === 'totals')).toHaveLength(phase === 'initial' ? 2 : 1));
    holdNew = true;
    await act(async () => { store.refresh('d', 'w'); });
    await waitFor(() => expect(workers).toHaveLength(2));
    expect(hook.result.current.view.status).toBe('updating');
    expect(hook.result.current.view.error).toBeUndefined();
    if (phase === 'scroll') expect(hook.result.current.blocks[0]).toBe(oldBlock);
    await act(async () => { workers[1].release(); await store.settled('d'); });
    await waitFor(() => expect(hook.result.current.view.status).toBe('ready'));
    expect(hook.result.current.view.error).toBeUndefined();
    expect(hook.result.current.blocks[0].rows).toHaveLength(input.rows.length);
    expect(hook.result.current.totals?.revision).toEqual(hook.result.current.blocks[0].revision);
  } finally { hook.unmount(); store.disposeDashboard('d'); }
});
