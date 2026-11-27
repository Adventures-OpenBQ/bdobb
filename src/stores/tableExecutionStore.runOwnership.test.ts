// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import { backendTableSource, createTableExecutionStore } from './tableExecutionStore';
import { card, widget } from '../test/fixtures';
import { useWidgetRegistryStore } from './widgetRegistryStore';
import { createWorkerExecutor } from '../lib/tableExecution/workerClient';
import { Boundary } from '../test/tableWorkerBoundary';
it('pairs backend rows with their dashboard and refuses an un-run draft source configuration', async () => {
 const source = card({ id: crypto.randomUUID(), widgetId: 'run-owned', params: { symbol: 'AAPL' } });
 useWidgetRegistryStore.setState({ widgets: [widget({ id: source.widgetId, type: 'table', runButton: true })] });
 const store = createTableExecutionStore({ source: backendTableSource, executor: id => createWorkerExecutor(id, () => new Boundary() as unknown as Worker) });
 const waiting = backendTableSource(source, 'first-dashboard').acquire(new AbortController().signal);
 const config = [source.widgetId, source.backendId, { symbol: 'AAPL' }];
 const first = store.observeBackendQuestion(source.id, 'first question', 'first-dashboard', config);
 const other = store.observeBackendQuestion(source.id, 'other question', 'other-dashboard', config);
 store.setBackendRows('first-dashboard', source.id, [{ price: 10 }], undefined, first);
 store.setBackendRows('other-dashboard', source.id, [{ price: 20 }], undefined, other);
 const read = (dashboardId: string, c = source) => backendTableSource(c, dashboardId).acquire(new AbortController().signal);
 expect((await waiting).kind).toBe('dataset');
 const a = await read('first-dashboard'), b = await read('other-dashboard');
 expect(a.kind === 'dataset' && a.dataset.rows[0].values.price).toBe(10);
 expect(b.kind === 'dataset' && b.dataset.rows[0].values.price).toBe(20);
 await expect(read('first-dashboard', { ...source, params: { symbol: 'MSFT' } })).rejects.toThrow(/Run the source card/);
 store.disposeDashboard('first-dashboard');store.disposeDashboard('other-dashboard');
});

it('invalidates linked authoring when a bound group changes before dashboard synchronization', async () => {
 const root = card({ id: crypto.randomUUID(), widgetId: 'group-owned', params: {}, bindings: [{ groupId: 'symbol', paramName: 'symbol' }] });
 useWidgetRegistryStore.setState({ widgets: [widget({ id: root.widgetId, type: 'table', params: [{ paramName: 'symbol', label: 'Symbol', type: 'text' }] })] });
 const child = card({ id: crypto.randomUUID(), widgetId: 'linked_table', linkedSource: { kind: 'widget', sourceWidgetId: root.id } });
 const live = { id: crypto.randomUUID(), name: 'Groups', groups: [{ id: 'symbol', name: 'Symbol', paramName: 'symbol', value: 'AAPL', groupType: 'symbol' }], tabs: [{ id: 'tab', name: 'Tab', cards: [root, child] }] };
 const { datasetFromRows } = await import('../lib/localTableData');
 const store = createTableExecutionStore({ liveDashboard: () => live, source: c => ({ async acquire() { return { kind: 'dataset', dataset: datasetFromRows([{ price: 10 }], c.id, 0, 'backend') }; } }), executor: id => createWorkerExecutor(id, () => new Boundary() as unknown as Worker) });
 store.syncDashboard(live);store.ensureTable(live.id, child.id);await store.settled(live.id);
 expect(store.sourceMatches(live.id, child.id, [root, child])).toBe(true);
 live.groups[0].value = 'MSFT';
 expect(store.sourceMatches(live.id, child.id, [root, child])).toBe(false);
 store.disposeDashboard(live.id);
});
