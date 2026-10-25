// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, expect, it } from 'vitest';
import { __reset, __read } from '../../test/memfs';
import { __resetJsonStoreForTests } from '../jsonStore';
import { loadDashboards, saveDashboard } from '../dashboardsFile';
import { readLocalFile, saveLocalFile } from '../localFiles';
import { createTableExecutionStore } from '../../stores/tableExecutionStore';
import { createWorkerExecutor } from './workerClient';
import { createWorkerHandler } from './table.worker';
import type { ExecutionRequest } from './types';
import type { Dashboard } from '../types';
class WorkerBoundary {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror = null; onmessageerror = null;
  handler = createWorkerHandler(data => this.onmessage?.({ data } as MessageEvent));
  postMessage(data: ExecutionRequest) { void this.handler(data); }
  terminate() {}
}
beforeEach(() => { __reset(); __resetJsonStoreForTests(); });
it('savedFilesRehydrateWithoutRedrop uses original bytes in a new worker/store', async () => {
  const file = await saveLocalFile(new File(['region,value\nA,12\nB,9'], 'rows.csv'));
  const d: Dashboard = { id: 'durable', name: 'Durable', tabs: [{ id: 't', name: 'Main', cards: [{ id: 'source', widgetId: 'local_table', backendId: 'builtin', params: { file }, layout: { x: 0, y: 0, w: 1, h: 1 }, tableDefinition: { table: { sorting: [{ id: 'value', desc: true }] }, search: '' }, tableSelection: { kind: 'allMatching', excludedIds: [] } }] }] };
  await saveDashboard(d);
  const first = runtime(); first.syncDashboard(d); first.ensureTable(d.id, 'source'); await first.settled(d.id);
  const firstView = first.readView(d.id, 'source');
  expect(firstView.status).toBe('ready');
  first.disposeDashboard(d.id);
  const loaded = (await loadDashboards())[0];
  const reopened = runtime(); reopened.syncDashboard(loaded); reopened.ensureTable(d.id, 'source'); await reopened.settled(d.id);
  const view = reopened.readView(d.id, 'source');
  const rows = await reopened.readExecutor(d.id, 'source')!.rows(view.active!, { groupPath: [], offset: 0, limit: 10 }, new AbortController().signal);
  expect(rows.rows.map(r => r.values)).toEqual([{ region: 'A', value: 12 }, { region: 'B', value: 9 }]);
  expect(view.selection).toEqual({ kind: 'allMatching', excludedIds: [] });
  const disk = JSON.parse(__read('dashboards/durable.json')!);
  expect(disk.tabs[0].cards[0]).not.toHaveProperty('rows');
  expect(disk.tabs[0].cards[0]).not.toHaveProperty('ready');
});
function runtime() {
  return createTableExecutionStore({ executor: id => createWorkerExecutor(id, () => new WorkerBoundary() as unknown as Worker), source: card => ({ acquire: async () => ({ kind: 'file', name: card.params.file, bytes: await readLocalFile(card.params.file) }) }) });
}
it.each([
  { table: {}, search: '', analytical: { expression: 'globalThis.compromised = true' } },
  { table: {}, search: '', unrecognizedCompiler: {} },
  { table: { sorting: [{ id: 'value', desc: 'yes' }] }, search: '' },
])('invalid imported definition stays inspectable but never starts workers: %j', definition => {
  let starts = 0, reads = 0;
  const store = createTableExecutionStore({ executor: () => { starts++; throw Error('must remain inert'); }, source: () => ({ acquire: async () => { reads++; throw Error('must remain inert'); } }) });
  const d = { id: 'd', name: 'Invalid', tabs: [{ id: 't', name: 'Main', cards: [{ id: 'c', widgetId: 'local_table', backendId: 'builtin', params: { file: 'raw.csv' }, layout: { x: 0, y: 0, w: 1, h: 1 }, tableDefinition: definition }] }] } as unknown as Dashboard;
  store.syncDashboard(d); store.ensureTable('d', 'c');
  expect(store.readView('d', 'c').status).toBe('blocked');
  expect(store.readView('d', 'c').definition).toEqual(definition);
  expect(starts).toBe(0); expect(reads).toBe(0);
});
it('save stores only card intent and source references, never calculated datasets or revisions', async () => {
  const card = { id: 'c', widgetId: 'local_table', backendId: 'builtin', params: { file: 'reference.csv' }, layout: { x: 0, y: 0, w: 1, h: 1 }, tableDefinition: { table: {}, search: '' }, tableSelection: { kind: 'none' }, linkedSource: { kind: 'widget', sourceWidgetId: 'source' }, rows: [{ value: 99 }], dataset: { rows: Array(100).fill({ value: 99 }) }, ready: { topLevelCount: 100 }, active: { output: 9 } };
  await saveDashboard({ id: 'd', name: 'Intent', tabs: [{ id: 't', name: 'Main', cards: [card] }] } as unknown as Dashboard);
  const persisted = JSON.parse(__read('dashboards/d.json')!).tabs[0].cards[0];
  expect(persisted).toEqual({ id: 'c', widgetId: 'local_table', backendId: 'builtin', params: { file: 'reference.csv' }, layout: { x: 0, y: 0, w: 1, h: 1 }, tableDefinition: { table: {}, search: '' }, tableSelection: { kind: 'none' }, linkedSource: { kind: 'widget', sourceWidgetId: 'source' } });
});
it('invalid definition blocks its dependent closure while unrelated tables still execute', async () => {
  const file = await saveLocalFile(new File(['value\n7'], 'rows.csv'));
  const root = { id: 'bad', widgetId: 'local_table', backendId: 'builtin', params: { file }, layout: { x: 0, y: 0, w: 1, h: 1 }, tableDefinition: { table: {}, search: '', analytical: {} } };
  const independent = { ...root, id: 'good', tableDefinition: { table: {}, search: '' } };
  const child = { ...independent, id: 'child', linkedSource: { kind: 'widget' as const, sourceWidgetId: 'bad' } };
  const store = runtime(); store.syncDashboard({ id: 'd', name: 'Mixed', tabs: [{ id: 't', name: 'Main', cards: [root, independent, child] }] });
  store.ensureTable('d', 'child'); store.ensureTable('d', 'good'); await store.settled('d');
  expect(store.readView('d', 'child').status).toBe('blocked');
  expect(store.readExecutor('d', 'child')).toBeUndefined(); expect(store.readExecutor('d', 'bad')).toBeUndefined();
  expect(store.readView('d', 'good').status).toBe('ready');
});
it.each([null, { search: '' }, { table: null, search: '' }])('malformed raw persisted definition is blocked rather than silently defaulted: %j', raw => {
  let starts = 0;
  const store = createTableExecutionStore({ executor: () => { starts++; throw Error(); }, source: () => undefined });
  const d = { id: 'd', name: 'Invalid', tabs: [{ id: 't', name: 'Main', cards: [{ id: 'c', widgetId: 'local_table', backendId: 'builtin', params: {}, layout: { x: 0, y: 0, w: 1, h: 1 }, tableDefinition: raw }] }] } as unknown as Dashboard;
  store.syncDashboard(d); store.ensureTable('d', 'c');
  expect(store.readView('d', 'c').status).toBe('blocked'); expect(starts).toBe(0);
  expect(d.tabs[0].cards[0].tableDefinition).toEqual(raw);
});
it.each([{ kind: 'widget' }, { kind: 'url', sourceWidgetId: 'root' }, null])('invalidImportedGraphNeverStartsWorkers for malformed source descriptor %j', linkedSource => {
  let starts = 0;
  const store = createTableExecutionStore({ executor: () => { starts++; throw Error(); }, source: () => undefined });
  const base = { widgetId: 'local_table', backendId: 'builtin', params: {}, layout: { x: 0, y: 0, w: 1, h: 1 } };
  store.syncDashboard({ id: 'd', name: 'Invalid', tabs: [{ id: 't', name: 'Main', cards: [{ ...base, id: 'root' }, { ...base, id: 'child', linkedSource }] }] } as unknown as Dashboard);
  store.ensureTable('d', 'root'); store.ensureTable('d', 'child');
  expect(store.readView('d', 'root').status).toBe('blocked');
  expect(store.readView('d', 'child').status).toBe('blocked'); expect(starts).toBe(0);
});
