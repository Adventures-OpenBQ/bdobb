// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { render, waitFor, act } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
vi.mock('../stores/tableExecutionStore', async importOriginal => {
  const actual = await importOriginal<typeof import('../stores/tableExecutionStore')>();
  const { createWorkerExecutor } = await import('../lib/tableExecution/workerClient');
  const { createWorkerHandler } = await import('../lib/tableExecution/table.worker');
  const { input } = await import('../lib/tableExecution/fixtures');
  class Boundary {
    onmessage: ((e: MessageEvent) => void) | null = null;
    handler = createWorkerHandler(data => this.onmessage?.({ data } as MessageEvent));
    postMessage(data: import('../lib/tableExecution/types').ExecutionRequest) { void this.handler(data); }
    terminate() {}
  }
  return { ...actual, tableExecutionStore: actual.createTableExecutionStore({
    executor: id => createWorkerExecutor(id, () => new Boundary() as unknown as Worker),
    source: () => ({ acquire: async () => ({ kind: 'dataset' as const, dataset: input }) }),
  }) };
});
vi.mock('./WidgetCard', () => ({ WidgetCard: () => <div>Card</div> }));
import { DashboardGrid } from './DashboardGrid';
import { tableExecutionStore } from '../stores/tableExecutionStore';
import { useDashboardStore } from '../stores/dashboardStore';
import type { Dashboard } from '../lib/types';

it('keeps actual worker owners alive for both workspace dashboards as focus moves', async () => {
  const dashboards: Dashboard[] = ['alpha', 'beta'].map(id => ({ id, name: id,
    tabs: [{ id: `${id}-tab`, name: 'One', cards: [{ id: `${id}-card`, widgetId: 'local_table', backendId: 'builtin', params: { file: 'rows.csv' }, layout: { x: 0, y: 0, w: 10, h: 10 } }] }],
  }));
  useDashboardStore.setState({ dashboards, activeId: 'alpha', activeTabId: 'alpha-tab', activeTabIds: { alpha: 'alpha-tab', beta: 'beta-tab' } });
  const mounted = render(<><DashboardGrid dashboardId="alpha" onOpenLibrary={() => undefined}/><DashboardGrid dashboardId="beta" onOpenLibrary={() => undefined}/></>);
  await waitFor(() => expect(tableExecutionStore.readView('alpha', 'alpha-card').status).toBe('ready'));
  await waitFor(() => expect(tableExecutionStore.readView('beta', 'beta-card').status).toBe('ready'));
  const alpha = tableExecutionStore.readExecutor('alpha', 'alpha-card');
  const beta = tableExecutionStore.readExecutor('beta', 'beta-card');
  act(() => useDashboardStore.getState().setActive('beta', { keepMaximized: true }));
  expect(tableExecutionStore.readExecutor('alpha', 'alpha-card')).toBe(alpha);
  expect(tableExecutionStore.readExecutor('beta', 'beta-card')).toBe(beta);
  mounted.unmount();
  await Promise.resolve();
  expect(tableExecutionStore.readExecutor('alpha', 'alpha-card')).toBeUndefined();
  expect(tableExecutionStore.readExecutor('beta', 'beta-card')).toBeUndefined();
});
