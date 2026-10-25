// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under Apache-2.0.
// SPDX-License-Identifier: AGPL-3.0-only
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { StatementWorkerView } from './StatementWorkerView';
import type { StatementSnapshot } from '../../lib/statementExecution';
const state = vi.hoisted(() => ({ view: { active: {widgetId:'cash',input:1,model:1,output:1}, ready: {}, status:'ready', stale:false }, listeners: new Set<() => void>(), load: vi.fn() }));
vi.mock('../../stores/tableExecutionStore', () => ({ tableExecutionStore: {
  subscribe: (listener: () => void) => { state.listeners.add(listener); return () => state.listeners.delete(listener); },
  readView: () => state.view, ensureTable: vi.fn(), readExecutor: () => ({}),
} }));
vi.mock('../../lib/statementExecution', () => ({ loadStatementSnapshot: state.load }));
const registered = vi.hoisted(() => ({ inputs: [] as unknown[] }));
vi.mock('../../lib/tableExecution/workerClient', () => ({ createWorkerExecutor: () => ({
  registerInput: async (dataset: unknown) => { registered.inputs.push(dataset); }, applyModel: async () => {}, dispose: () => {},
}) }));
function snapshot(revision: StatementSnapshot['revision']): StatementSnapshot { return {revision,statement:null,completeness:{kind:'complete',warnings:[]},freshness:{availability:'available',stale:false}}; }
beforeEach(() => { state.listeners.clear(); state.load.mockReset(); state.view = { active:{widgetId:'cash',input:1,model:1,output:1},ready:{},status:'ready',stale:false }; });
it('labels retained Statement data stale until the new ready revision completes its transfer', async () => {
  state.load.mockResolvedValueOnce(snapshot(state.view.active));
  let finish!: (value: StatementSnapshot) => void;
  state.load.mockImplementationOnce(() => new Promise<StatementSnapshot>(resolve => { finish = resolve; }));
  render(<StatementWorkerView dashboardId="d" widgetId="cash" owned data={null} collapsed={new Set()} onToggle={() => {}}/>);
  await waitFor(() => expect(state.load).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByText('Loading Statement…')).not.toBeInTheDocument());
  await act(async () => { state.view = {...state.view,active:{widgetId:'cash',input:2,model:2,output:2}}; state.listeners.forEach(listener => listener()); });
  await waitFor(() => expect(state.load).toHaveBeenCalledTimes(2));
  expect(screen.getByText('Updating Statement — showing completed data (stale).')).toBeVisible();
  await act(async () => finish(snapshot(state.view.active)));
  expect(screen.queryByText('Updating Statement — showing completed data (stale).')).not.toBeInTheDocument();
});
it('reads a plain backend response as the whole answer: no completeness banner', async () => {
  // Ruling 2026-10-16: a non-paged backend response is the provider's whole answer; caps travel as their own notice.
  registered.inputs.length = 0;
  state.load.mockResolvedValueOnce({ ...snapshot({widgetId:'cash',input:1,model:1,output:1}) });
  render(<StatementWorkerView dashboardId="d" widgetId="cash" owned={false} data={[{ fiscal_year: 2026, fiscal_period: 'Q3', revenue: 1 }]} collapsed={new Set()} onToggle={() => {}}/>);
  await waitFor(() => expect(registered.inputs).toHaveLength(1));
  expect(registered.inputs[0]).toMatchObject({ completeness: { kind: 'complete', warnings: [] } });
});
