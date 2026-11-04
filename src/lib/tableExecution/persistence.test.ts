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
it('missing local file reopens in explicit failed state without losing the saved source reference',async()=>{
 const file=await saveLocalFile(new File(['value\n7'],'rows.csv'));
 const d:Dashboard={id:'missing',name:'Missing',tabs:[{id:'t',name:'Main',cards:[{id:'source',widgetId:'local_table',backendId:'builtin',params:{file},layout:{x:0,y:0,w:1,h:1}}]}]};
 await saveDashboard(d);
 const {deleteLocalFile}=await import('../localFiles');await deleteLocalFile(file);
 const reopened=(await loadDashboards())[0];const store=runtime();store.syncDashboard(reopened);store.ensureTable(d.id,'source');await store.settled(d.id);
 expect(store.readView(d.id,'source').status).toBe('failed');
 expect(store.readView(d.id,'source').error).toMatch(/ENOENT|not found/i);
 expect(JSON.parse(__read('dashboards/missing.json')!).tabs[0].cards[0].params.file).toBe(file);
 store.disposeDashboard(d.id);
});
it('replaced local file requests repair for a persisted unavailable sorting field',async()=>{
 const file=await saveLocalFile(new File(['value\n7'],'rows.csv'));
 const d:Dashboard={id:'replaced',name:'Replaced',tabs:[{id:'t',name:'Main',cards:[{id:'source',widgetId:'local_table',backendId:'builtin',params:{file},layout:{x:0,y:0,w:1,h:1},tableDefinition:{table:{sorting:[{id:'value',desc:true}]},search:''}}]}]};
 await saveDashboard(d);
 const {__seed}=await import('../../test/memfs');__seed('files/'+file,Array.from(new TextEncoder().encode('other\n9')));
 const store=runtime();store.syncDashboard((await loadDashboards())[0]);store.ensureTable(d.id,'source');await store.settled(d.id);
 expect(store.readView(d.id,'source').status).toBe('blocked');
 expect(store.readView(d.id,'source').error).toMatch(/value|field|column/i);
 expect(JSON.parse(__read('dashboards/replaced.json')!).tabs[0].cards[0].tableDefinition.table.sorting).toEqual([{id:'value',desc:true}]);
 store.disposeDashboard(d.id);
});
it('saved SEC intent recomputes cell errors and source provenance after reopen without private evaluator state',async()=>{
 const {default:reference}=await import('../../test/fixtures/sec-statements/reference.json');
 const {dashboardLayout}=await import('../../../e2e/fixtures/sec-statements/dashboard');
 const {__seed,__readBytes}=await import('../../test/memfs');
 const dashboard=structuredClone(dashboardLayout) as unknown as Dashboard;
 dashboard.tabs[0].cards[1].tableDefinition=structuredClone(reference.companies.NVDA.definition) as unknown as Dashboard['tabs'][number]['cards'][number]['tableDefinition'];
 const columns=['sec_source_row_id',...reference.companies.NVDA.dataset.columns.map(c=>c.id)];
 const quote=(v:unknown)=>JSON.stringify(String(v??''));
 const csv=[columns.map(quote).join(','),...Object.values(reference.companies).flatMap(c=>c.dataset.rows).map(r=>columns.map(k=>quote(k==='sec_source_row_id'?r.id:r.values[k as keyof typeof r.values])).join(','))].join('\n');
 const built={dashboard,files:{['files/'+dashboard.tabs[0].cards[0].params.file]:csv}};
 const facts=built.dashboard.tabs[0].cards[0];
 const model=facts.tableDefinition!.analytical as {checklists:{memberKeys:string[]}[]};
 model.checklists[0].memberKeys=['["string","CIK:0001045810"]','["string","CIK:0001652044"]'];
 for(const [path,csv] of Object.entries(built.files))__seed(path,Array.from(new TextEncoder().encode(csv)));
 await saveDashboard(built.dashboard);
 const collect=async(d:Dashboard)=>{
  const store=runtime();store.syncDashboard(d);store.ensureTable(d.id,'statement');await store.settled(d.id);
  const view=store.readView(d.id,'statement');expect(view.status).toBe('ready');
  const batches=[];for await(const b of store.readExecutor(d.id,'statement')!.presented(view.active!,new AbortController().signal))batches.push(b);
  store.disposeDashboard(d.id);return batches.flatMap(b=>b.rows);
 };
 const before=await collect(built.dashboard);expect(before).toHaveLength(1);expect(before[0].cellErrors).toBeTruthy();
 const after=await collect((await loadDashboards())[0]);expect(after).toEqual(before);
 expect(Object.values(after[0].cellErrors!)).toEqual(expect.arrayContaining([expect.objectContaining({code:'scope',recordPreview:expect.any(Array)})]));
 const saved=JSON.parse(__read('dashboards/d1.json')!);
 expect(saved.tabs[0].cards[1].tableDefinition).toEqual(built.dashboard.tabs[0].cards[1].tableDefinition);
 for(const c of saved.tabs[0].cards)for(const key of ['rows','active','ready','execution','cellErrors','provenance'])expect(c).not.toHaveProperty(key);
 for(const path of Object.keys(built.files))expect(new TextDecoder().decode(__readBytes(path)!)).toBe(built.files[path]);
});
