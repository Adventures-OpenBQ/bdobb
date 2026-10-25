// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { StrictMode } from 'react';
import { render, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { TableExecutionRuntime } from './TableExecutionRuntime';
import { createTableExecutionStore } from '../stores/tableExecutionStore';
import { createWorkerExecutor } from '../lib/tableExecution/workerClient';
import { createWorkerHandler } from '../lib/tableExecution/table.worker';
import { input } from '../lib/tableExecution/fixtures';
import type { ExecutionRequest } from '../lib/tableExecution/types';
import type { Dashboard } from '../lib/types';
it('offTabSourceStillExecutes and strictModeDoesNotDuplicateOwnership', async () => {
  let acquisitions = 0, workers = 0, disposals = 0;
  class Boundary {
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror = null;
    onmessageerror = null;
    handler = createWorkerHandler(data => this.onmessage?.({ data } as MessageEvent));
    postMessage(data: ExecutionRequest) {
      void this.handler(data);
    }
    terminate() {
      disposals++;
    }
  }
  const store = createTableExecutionStore({ executor: id => {
      workers++;
      return createWorkerExecutor(id, () => new Boundary() as unknown as Worker);
    }, source: () => ({ acquire: async () => {
        acquisitions++;
        return { kind: 'dataset', dataset: input };
      } }) });
  const card = (id: string, source?: string) => ({ id, widgetId: 'local_table', backendId: 'builtin', params: {}, layout: { x: 0, y: 0, w: 1, h: 1 }, ...(source ? { linkedSource: { kind: 'widget' as const, sourceWidgetId: source } } : {}) });
  const dashboard = { id: 'd', tabs: [{ id: 'inactive', name: 'Inactive', cards: [card('root')] }, { id: 'active', name: 'Active', cards: [card('child', 'root')] }] } as Dashboard;
  const screen = render(<StrictMode><TableExecutionRuntime dashboard={dashboard} store={store}/></StrictMode>);
  await waitFor(() => expect(store.readView('d', 'child').status).toBe('ready'));
  expect(acquisitions).toBe(1);
  expect(workers).toBe(2);
  expect(disposals).toBe(0);
  screen.unmount();
  await Promise.resolve();
  expect(disposals).toBe(2);
});

it('native file parsing serves two off-tab dependents once and refresh retains completed output until replacement', async () => {
  let acquisitions = 0, disposals = 0;
  let finishRefresh!: (value: { kind: 'file'; name: string; bytes: Uint8Array }) => void;
  class Boundary {
    onmessage: ((e: MessageEvent) => void) | null = null;
    handler = createWorkerHandler(data => this.onmessage?.({ data } as MessageEvent));
    postMessage(data: ExecutionRequest) { void this.handler(data); }
    terminate() { disposals++; }
  }
  const file = { kind: 'file' as const, name: 'rows.csv', bytes: new TextEncoder().encode('region,revenue\n' + Array.from({ length: 1503 }, () => 'A,2').join('\n')) };
  const store = createTableExecutionStore({
    executor: id => createWorkerExecutor(id, () => new Boundary() as unknown as Worker),
    source: () => ({ acquire: async () => {
      acquisitions++;
      return acquisitions === 1 ? file : new Promise(resolve => { finishRefresh = resolve; });
    } }),
  });
  const card = (id: string, source?: string) => ({ id, widgetId: 'local_table', backendId: 'builtin', params: { file: 'rows.csv' }, table: { pivot: { enabled: false, grouping: [], split: [], aggregationFns: { revenue: 'sum' as const } } }, layout: { x: 0, y: 0, w: 1, h: 1 }, ...(source ? { linkedSource: { kind: 'widget' as const, sourceWidgetId: source } } : {}) });
  const dashboard = { id: 'native', name: 'Native', tabs: [{ id: 'inactive', name: 'Inactive', cards: [card('root')] }, { id: 'active', name: 'Active', cards: [card('a', 'root'), card('b', 'root')] }] } as Dashboard;
  const mounted = render(<StrictMode><TableExecutionRuntime dashboard={dashboard} store={store}/></StrictMode>);
  await waitFor(() => expect(store.readView('native', 'b').status).toBe('ready'));
  expect(acquisitions).toBe(1);
  const old = store.readView('native', 'a');
  const signal = new AbortController().signal;
  const executor = store.readExecutor('native', 'a')!;
  expect((await executor.rows(old.active!, { groupPath: [], offset: 0, limit: 8 }, signal)).rows).toHaveLength(8);
  expect((await executor.totals(old.active!, signal)).values.revenue).toBe(3006);
  store.refresh('native', 'b');
  expect(store.readView('native', 'a').stale).toBe(true);
  expect(store.readView('native', 'a').active).toEqual(old.active);
  expect(acquisitions).toBe(2);
  finishRefresh({ ...file, bytes: new TextEncoder().encode('region,revenue\n') });
  await waitFor(() => expect(store.readView('native', 'a').status).toBe('empty'));
  expect(store.readView('native', 'b').status).toBe('empty');
  expect(store.readView('native', 'a').stale).toBe(false);
  expect(acquisitions).toBe(2);
  mounted.unmount();
  await Promise.resolve();
  // Refresh replaces the root worker; unmount then disposes all three owners.
  expect(disposals).toBe(6);
});
