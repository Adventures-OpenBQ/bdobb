// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { createWorkerExecutor } from './workerClient';
import { createWorkerHandler } from './table.worker';
import { input, definition, revision } from './fixtures';
import type { ExecutionRequest } from './types';
import type { CategoryDef, TableModelV1 } from '../tableModel/types';
import { validateTableModel } from '../tableModel/validation';
class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  held: ExecutionRequest[] = [];
  hold = false;
  handler = createWorkerHandler(data => this.onmessage?.({ data } as MessageEvent));
  postMessage(data: ExecutionRequest) { if (this.hold) this.held.push(data); else void this.handler(data); }
  terminate() { this.terminated = true; }
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const setup = () => {
  const workers: FakeWorker[] = [];
  const executor = createWorkerExecutor('source', () => { const worker = new FakeWorker(); workers.push(worker); return worker as unknown as Worker; });
  return { executor, workers, signal: new AbortController().signal };
};
it('ignoresLateResponses', async () => {
  const { executor, workers, signal } = setup();
  await executor.registerInput(input, 1, signal);
  await executor.applyModel(definition, { kind: 'none' }, revision, signal);
  workers[0].hold = true;
  const pending = executor.totals(revision, signal);
  await flush();
  const request = workers[0].held[0];
  workers[0].onmessage?.({ data: { ...request, kind: 'totals', scope: 'filtered', values: { revenue: 999 }, completeness: input.completeness, diagnostics: [], revision: { ...revision, output: 0 } } } as MessageEvent);
  await workers[0].handler(request);
  expect((await pending).values.revenue).toBe(40);
  executor.dispose();
});
it('cancelledTransferRejectsPendingReaders', async () => {
  const { executor, workers, signal } = setup();
  await executor.registerInput(input, 1, signal);
  await executor.applyModel(definition, { kind: 'none' }, revision, signal);
  workers[0].hold = true;
  const controller = new AbortController();
  const reader = executor.presented(revision, controller.signal)[Symbol.asyncIterator]();
  const pending = reader.next();
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  executor.dispose();
});
it('workerCrashRejectsRequestsAndCanRehydrate', async () => {
  const { executor, workers, signal } = setup();
  await executor.registerInput(input, 1, signal);
  workers[0].hold = true;
  const pending = executor.applyModel(definition, { kind: 'none' }, revision, signal);
  await flush();
  workers[0].onerror?.();
  await expect(pending).rejects.toThrow('Worker failed');
  expect((await executor.applyModel(definition, { kind: 'none' }, revision, signal)).topLevelCount).toBe(2);
  executor.dispose();
});
it('disposeTerminatesWorker', async () => {
  const { executor, workers, signal } = setup();
  await executor.registerInput(input, 1, signal);
  workers[0].hold = true;
  const pending = executor.totals(revision, signal);
  executor.dispose();
  await expect(pending).rejects.toThrow('disposed');
  expect(workers[0].terminated).toBe(true);
  await expect(executor.registerInput(input, 1, signal)).rejects.toThrow('disposed');
});
it('supersededSynchronousCalculationAllowsLatestToFinish', async () => {
  const { executor, workers, signal } = setup();
  await executor.registerInput(input, 1, signal);
  workers[0].hold = true;
  const old = executor.applyModel(definition, { kind: 'none' }, revision, signal);
  await flush();
  const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' });
  const latest = await executor.applyModel({ table: {}, search: '' }, { kind: 'none' }, { ...revision, model: 2, output: 2 }, signal);
  await rejected;
  expect(workers[0].terminated).toBe(true);
  expect(latest.topLevelCount).toBe(3);
  await workers[0].handler(workers[0].held[0]);
  expect((await executor.rows({ ...revision, model: 2, output: 2 }, { groupPath: [], offset: 0, limit: 1 }, signal)).rows[0].values.revenue).toBe(10);
  executor.dispose();
});
it('imports files in worker and streams complete empty input', async () => {
  const { executor, signal } = setup();
  await executor.importFile('data.json', new TextEncoder().encode('[]'), 1, signal);
  await executor.applyModel({ table: {}, search: '' }, { kind: 'none' }, revision, signal);
  const batches = [];
  for await (const batch of executor.presented(revision, signal)) batches.push(batch);
  expect(batches).toHaveLength(1);
  expect(batches[0].rows).toEqual([]);
  expect(batches[0].final).toBe(true);
  expect(batches[0].completeness.kind).toBe('complete');
  executor.dispose();
});
it('recovers reads from cloned input and the last completed model after a crash', async () => {
  const { executor, workers, signal } = setup();
  const registered = structuredClone(input);
  await executor.registerInput(registered, 1, signal);
  registered.rows[0].values.revenue = 999;
  await executor.applyModel(definition, { kind: 'none' }, revision, signal);
  workers[0].onmessageerror?.();
  expect((await executor.totals(revision, signal)).values.revenue).toBe(40);
  executor.dispose();
});
it('pulls batches only on demand and abort releases a paused transfer', async () => {
  const { executor, workers, signal } = setup();
  await executor.registerInput({ ...input, rows: Array.from({ length: 1200 }, (_, i) => ({ id: `r${i}`, values: { revenue: i } })) }, 1, signal);
  await executor.applyModel({ search: '', table: {} }, { kind: 'none' }, revision, signal);
  const controller = new AbortController();
  const iterator = executor.presented(revision, controller.signal)[Symbol.asyncIterator]();
  expect((await iterator.next()).value?.rows).toHaveLength(500);
  const second = (await iterator.next()).value;
  expect(second?.sequence).toBe(1);
  expect(second?.rows).toHaveLength(500);
  expect(second?.rows[0].values.revenue).toBe(500);
  const third = (await iterator.next()).value;
  expect(third?.rows).toHaveLength(200);
  expect(third?.final).toBe(true);
  controller.abort();
  expect((await iterator.next()).done).toBe(true);
  // A cancelled paused stream must not occupy any worker transfer slots.
  for (let i = 0; i < 35; i++) {
    const c = new AbortController();
    const next = executor.presented(revision, c.signal)[Symbol.asyncIterator]();
    expect((await next.next()).value?.sequence).toBe(0);
    c.abort();
    // No next()/return() call: cancellation alone must release the worker slot.
  }
  expect(workers[0].terminated).toBe(false);
  executor.dispose();
});
it('rejects bounded excess pending requests without disturbing earlier readers', async () => {
  const { executor, workers, signal } = setup();
  await executor.registerInput(input, 1, signal);
  await executor.applyModel(definition, { kind: 'none' }, revision, signal);
  workers[0].hold = true;
  const requests = Array.from({ length: 32 }, () => executor.totals(revision, signal));
  await flush();
  await expect(executor.totals(revision, signal)).rejects.toThrow('Too many pending');
  for (const request of workers[0].held) await workers[0].handler(request);
  expect((await Promise.all(requests)).every(result => result.values.revenue === 40)).toBe(true);
  executor.dispose();
});
it('rehydrates cloned file bytes after replacement', async () => {
  const { executor, workers, signal } = setup();
  const bytes = new TextEncoder().encode('[{"revenue":12}]');
  await executor.importFile('data.json', bytes, 1, signal);
  bytes.fill(0);
  await executor.applyModel({ table: {}, search: '' }, { kind: 'none' }, revision, signal);
  workers[0].onerror?.();
  const result = await executor.rows(revision, { groupPath: [], offset: 0, limit: 10 }, signal);
  expect(result.rows[0].values.revenue).toBe(12);
  expect(result.completeness.acquiredRowCount).toBe(1);
  executor.dispose();
});
it('malformed matching responses reject readers rather than hanging', async () => {
  const { executor, workers, signal } = setup();
  await executor.registerInput(input, 1, signal);
  workers[0].hold = true;
  const pending = executor.totals(revision, signal);
  await flush();
  const request = workers[0].held[0];
  workers[0].onmessage?.({ data: { requestId: request.requestId, revision, kind: 'totals', completeness: input.completeness, diagnostics: [], scope: 'bogus', values: {} } } as MessageEvent);
  await expect(pending).rejects.toMatchObject({ descriptor: { code: 'INVALID_RESPONSE' } });
  executor.dispose();
});
it('worker rejects invalid analytical requests with unknown acquisition context', async () => {
  const responses: unknown[] = [];
  const handle = createWorkerHandler(response => responses.push(response));
  await handle({ kind: 'applyModel', requestId: 'invalid', revision, definition: { ...definition, analytical: {} }, selection: { kind: 'none' } });
  expect(responses).toMatchObject([{ kind: 'error', requestId: 'invalid', error: { code: 'INVALID_REQUEST' }, completeness: { kind: 'unknown' }, diagnostics: [] }]);
});
it('preserves acquisition diagnostics and partial completeness in ready and derived reads', async () => {
  const { executor, signal } = setup();
  await executor.registerInput({ ...input, completeness: { kind: 'partial', warnings: ['Provider stopped early'] }, freshness: { ...input.freshness, diagnostics: ['Source warning'] } }, 1, signal);
  const ready = await executor.applyModel(definition, { kind: 'none' }, revision, signal);
  expect(ready.completeness.kind).toBe('partial');
  expect(ready.diagnostics).toContainEqual({ code: 'INPUT', severity: 'warning', message: 'Source warning' });
  expect((await executor.totals(revision, signal)).diagnostics).toContainEqual({ code: 'INPUT', severity: 'warning', message: 'Source warning' });
  executor.dispose();
});
it('recovery retains the sent model selection and revision when caller inputs mutate', async () => {
  const { executor, workers, signal } = setup();
  await executor.registerInput(input, 1, signal);
  workers[0].hold = true;
  const suppliedDefinition = { table: {}, search: "" };
  const suppliedSelection = { kind: 'explicit' as const, ids: ['r0'] };
  const suppliedRevision = { ...revision };
  const ready = executor.applyModel(suppliedDefinition, suppliedSelection, suppliedRevision, signal);
  await flush();
  suppliedDefinition.search = 'no match';
  suppliedSelection.ids.splice(0, 1, 'r2');
  suppliedRevision.model = 99;
  suppliedRevision.output = 99;
  await workers[0].handler(workers[0].held[0]);
  expect((await ready).revision).toEqual({ widgetId: 'source', input: 1, model: 1, output: 1 });
  workers[0].hold = false;
  const before = await executor.rows(revision, { groupPath: [], offset: 0, limit: 10 }, signal);
  const total = await executor.totals(revision, signal);
  const chart = await executor.chartData(revision, ['revenue'], signal);
  expect(chart.rows.map(row => row.values.revenue)).toEqual([10]);
  workers[0].onerror?.();
  const recovered = await executor.rows(revision, { groupPath: [], offset: 0, limit: 10 }, signal);
  expect(recovered.rows).toEqual(before.rows);
  expect(recovered.revision).toEqual({ widgetId: 'source', input: 1, model: 1, output: 1 });
  expect((await executor.totals(revision, signal)).values).toEqual(total.values);
  expect((await executor.chartData(revision, ['revenue'], signal)).rows).toEqual(chart.rows);
  executor.dispose();
});
it('matching request with malformed revision rejects its pending reader', async () => {
  const { executor, workers, signal } = setup();
  await executor.registerInput(input, 1, signal);
  workers[0].hold = true;
  const pending = executor.totals(revision, signal);
  await flush();
  const request = workers[0].held[0];
  workers[0].onmessage?.({ data: { requestId: request.requestId, revision: {}, kind: 'totals', completeness: input.completeness, diagnostics: [], scope: 'filtered', values: {} } } as MessageEvent);
  await expect(pending).rejects.toMatchObject({ descriptor: { code: 'INVALID_RESPONSE' } });
  executor.dispose();
});
it('worker revision errors with a valid matching envelope reject the reader', async () => {
  const { executor, signal } = setup();
  await executor.registerInput(input, 1, signal);
  await executor.applyModel(definition, { kind: 'none' }, revision, signal);
  await expect(executor.totals({ ...revision, output: 2 }, signal)).rejects.toMatchObject({ descriptor: { code: 'REVISION_MISMATCH' } });
  executor.dispose();
});

it('selection transport returns bounded revision-bound candidate without publishing until applied', async () => {
  const { executor, signal } = setup();
  await executor.registerInput(input, 1, signal);
  await executor.applyModel({ table: {}, search: '' }, { kind: 'none' }, revision, signal);
  const one = await executor.rows(revision, { groupPath: [], offset: 0, limit: 1 }, signal);
  expect(one.selection?.selectedCount).toBe(0);
  const all = await executor.selection(revision, { kind: 'all' }, ['r0'], signal);
  expect(all.selection).toEqual({ kind: 'allMatching', excludedIds: [] });
  expect(all.selectedCount).toBe(3);
  expect((await executor.selection(revision, { kind: 'summary' }, [], signal)).selection).toEqual({ kind: 'none' });
  await expect(executor.selection(revision, { kind: 'summary' }, Array(1201).fill('r0'), signal)).rejects.toThrow('bounded');
  await expect(executor.selection({ ...revision, output: 8 }, { kind: 'all' }, [], signal)).rejects.toThrow('revision');
  executor.dispose();
});

it('identity witnesses prove direct raw groups privately and keep aggregate ancestry unknown', async () => {
  const { executor, signal } = setup();
  await executor.registerInput(input, 1, signal);
  const plain = { table: {}, search: '' };
  await executor.applyModel(plain, { kind: 'none' }, revision, signal);
  const a = '["group","[[\\"region\\",\\"native\\"]]","[\\"string\\",\\"A\\"]"]';
  const missing = '["group","[[\\"region\\",\\"native\\"]]","[\\"string\\",\\"C\\"]"]';
  const pivot = { table: { pivot: { enabled: true, grouping: ['region'], split: [] } }, search: '' };
  const result = await executor.identityWitness(revision, [plain, plain, pivot], [a, missing], signal);
  expect(result.identities).toEqual([{ id: a, state: 'present' }, { id: missing, state: 'absent' }]);
  expect(result).not.toHaveProperty('rows');
  const ambiguous = await executor.identityWitness(revision, [plain, pivot, plain], ['r0'], signal);
  expect(ambiguous.identities).toEqual([{ id: 'r0', state: 'unknown' }]);
  await expect(executor.identityWitness({ ...revision, output: 0 }, [plain, plain], ['r0'], signal)).rejects.toMatchObject({ descriptor: { code: 'REVISION_MISMATCH' } });
  executor.dispose();
});

it('identity proof survives worker rehydration and split-only empty input has no identity', async () => {
  const { executor, workers, signal } = setup();
  const plain = { table: {}, search: '' };
  await executor.registerInput(input, 1, signal);
  await executor.applyModel(plain, { kind: 'none' }, revision, signal);
  workers[0].onerror?.();
  expect((await executor.identityWitness(revision, [plain, plain], ['r0', 'missing'], signal)).identities).toEqual([{ id: 'r0', state: 'present' }, { id: 'missing', state: 'absent' }]);
  const split = { table: { pivot: { enabled: true, grouping: [], split: ['region'] } }, search: '' };
  const aggregate = '["group","[{\\"grouping\\":[],\\"split\\":[\\"region\\"]},{}]",""]';
  expect((await executor.identityWitness(revision, [plain, split], [aggregate], signal)).identities).toEqual([{ id: aggregate, state: 'present' }]);
  await executor.registerInput({ ...input, rows: [] }, 2, signal);
  const next = { ...revision, input: 2 };
  await executor.applyModel(plain, { kind: 'none' }, next, signal);
  expect((await executor.identityWitness(next, [plain, split], [aggregate], signal)).identities).toEqual([{ id: aggregate, state: 'absent' }]);
  executor.dispose();
});

it('rehydration retains proven absence and previous namespace when restoring linked model intent', async () => {
  const { executor, workers, signal } = setup();
  await executor.registerInput(input, 1, signal);
  const model = { table: {}, search: '' };
  await executor.applyModel(model, { kind: 'explicit', ids: ['missing'] }, revision, signal, false, 'prior-local-namespace', ['missing']);
  workers[0].onerror?.();
  const block = await executor.rows(revision, { groupPath: [], offset: 0, limit: 1 }, signal);
  expect(block.selection?.selection).toEqual({ kind: 'none' });
  expect(block.diagnostics).toContainEqual(expect.objectContaining({ code: 'SELECTION_RECONCILED' }));
  executor.dispose();
});

it('bucket identity proof uses preserved root dtype and returns unknown when children may infer a different kind', async () => {
  const plain = { table: {}, search: '' };
  const pivot = { table: { pivot: { enabled: true, grouping: ['date'], split: [], buckets: { date: 'year' as const } } }, search: '' };
  const year = '["group","[[\\"date\\",\\"year\\"]]","[\\"string\\",\\"2026\\"]"]';
  for (const ambiguous of [true, false]) {
    const { executor, signal } = setup();
    const data = { ...input, columns: [{ id: 'date', label: 'Date' }], rows: [
      ...(ambiguous ? [{ id: 'object', values: { date: { x: 1 } } }] : []),
      { id: 'date', values: { date: '2026-01-01' } },
    ] };
    await executor.registerInput(data, 1, signal);
    await executor.applyModel(plain, { kind: 'none' }, revision, signal);
    const proof = await executor.identityWitness(revision, [plain, plain, pivot], [year, year.replace('2026', '2027')], signal);
    expect(proof.identities).toEqual([{ id: year, state: ambiguous ? 'unknown' : 'present' }, { id: year.replace('2026', '2027'), state: ambiguous ? 'unknown' : 'absent' }]);
    executor.dispose();
  }
});
it('inspector reads are revision correlated and cancelled independently',async()=>{
 const {executor,workers,signal}=setup();
 await executor.registerInput(input,1,signal);await executor.applyModel(definition,{kind:'none'},revision,signal);
 workers[0].hold=true;
 const pending=executor.inspect!(revision,{collection:'definitions',offset:0,limit:1},signal);await flush();
 const request=workers[0].held[0];
 workers[0].onmessage?.({data:{...request,kind:'inspect',rows:[],total:0,truncated:false,completeness:input.completeness,diagnostics:[],revision:{...revision,output:0}}} as MessageEvent);
 await workers[0].handler(request);
 expect(await pending).toMatchObject({kind:'inspect',revision,total:0,rows:[]});
 const controller=new AbortController();const cancelled=executor.inspect!(revision,{collection:'warnings',offset:0,limit:1},controller.signal);
 await flush();controller.abort();await expect(cancelled).rejects.toMatchObject({name:'AbortError'});executor.dispose();
});
it('restart restores successful runtime overlay separately from its untouched saved definition',async()=>{
 const {executor,workers,signal}=setup();
 const model:import('../tableModel/types').TableModelV1={schemaVersion:1,enabled:false,params:{promotePage:true,filters:[{id:'p',categoryId:'cat',label:'Region',multiSelect:true}]},categories:[{id:'cat',name:'Region',sourceFieldId:'region',transform:'native'}],measures:[],formulas:[],layout:{rows:[],columns:[],values:[]},checklists:[{categoryId:'cat',memberKeys:['["string","A"]']}],resultFilters:[],subtotals:{grandTotal:false,groups:false}};
 const definition={table:{},search:'',analytical:model};const overlay={['pivot:filter:cat']:{source:'viewer' as const,memberKeys:['["string","B"]']}};
 await executor.registerInput(input,1,signal);await executor.applyModel(definition,{kind:'none'},revision,signal,true,undefined,[],overlay);overlay['pivot:filter:cat'].memberKeys[0]='["string","A"]';workers[0].onerror?.();
 const rows=await executor.rows(revision,{groupPath:[],offset:0,limit:10},signal);expect(rows.rows.map(r=>r.id)).toEqual(['r2']);expect(workers).toHaveLength(2);
 const ready=await executor.applyModel(definition,{kind:'none'},{...revision,model:2,output:2},signal,true,undefined,[],{'pivot:filter:cat':{source:'viewer',memberKeys:null}});expect(ready.inspection.definition).toEqual(definition);expect(ready.topLevelCount).toBe(3);executor.dispose();
});
it('restart hydrates cloned lossless group baseline and bounded group match metadata',async()=>{
 const {executor,workers,signal}=setup();const model:import('../tableModel/types').TableModelV1={schemaVersion:1,enabled:false,params:{promotePage:false,filters:[{id:'p',categoryId:'cat',label:'Region',multiSelect:false}]},categories:[{id:'cat',name:'Region',sourceFieldId:'region',transform:'native'}],measures:[],formulas:[],layout:{rows:[],columns:[],values:[]},checklists:[],resultFilters:[],subtotals:{grandTotal:false,groups:false}};
 const definition={table:{},search:'',analytical:model};const runtime={'pivot:filter:cat':{source:'group' as const,groupId:'g',transportValue:'B,missing'}};
 await executor.registerInput(input,1,signal);const ready=await executor.applyModel(definition,{kind:'none'},revision,signal,true,undefined,[],runtime);expect(ready.inspection.paramMatches?.[0]).toMatchObject({source:'group',unmatched:['missing']});runtime['pivot:filter:cat'].transportValue='A';workers[0].onerror?.();
 expect((await executor.rows(revision,{groupPath:[],offset:0,limit:10},signal)).rows.map(r=>r.id)).toEqual(['r2']);expect(workers).toHaveLength(2);executor.dispose();
});
it('observed group pages cancel and restart independently without changing cached viewer runtime or saved definition',async()=>{const {executor,workers,signal}=setup();const model:import('../tableModel/types').TableModelV1={schemaVersion:1,enabled:false,params:{promotePage:false,filters:[{id:'p',categoryId:'cat',label:'Region',multiSelect:true}]},categories:[{id:'cat',name:'Region',sourceFieldId:'region',transform:'native'}],measures:[],formulas:[],layout:{rows:[],columns:[],values:[]},checklists:[],resultFilters:[],subtotals:{grandTotal:false,groups:false}};const {categoryRecipe}=await import('../tableModel/categories');await executor.registerInput(input,1,signal);const saved={table:{},search:'',analytical:model};await executor.applyModel(saved,{kind:'none'},revision,signal,false,undefined,[],{'pivot:filter:cat':{source:'viewer',memberKeys:null}});const request:import('./types').InspectionRequest={collection:'groupDomain',paramKey:'pivot:filter:cat',categoryId:'cat',categoryRecipe:categoryRecipe(model.categories[0]),groupEvidence:{groupId:'g',transportValue:'B'},offset:0,limit:100};const page=await executor.inspect!(revision,request,signal);expect(page.domain).toMatchObject({matchedKeyCount:1});expect(page.rows.find(row=>row.kind==='groupMember'&&row.label==='B')).toMatchObject({matched:true});workers[0].onerror?.();expect(await executor.inspect!(revision,request,signal)).toMatchObject({rows:page.rows,domain:page.domain});expect((await executor.rows(revision,{groupPath:[],offset:0,limit:10},signal)).rows).toHaveLength(3);workers.at(-1)!.hold=true;const abort=new AbortController();const pending=executor.inspect!(revision,request,abort.signal);await flush();abort.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});let called=0;expect(()=>executor.inspect!(revision,{...request,get groupEvidence(){called++;return {groupId:'g',transportValue:'B'};}},signal)).toThrow();expect(called).toBe(0);executor.dispose();});
it('input-only authoring cancels obsolete delivery and rehydrates without replaying invalid output',async()=>{
 const {executor,workers,signal}=setup();await executor.registerInput(input,1,signal);
 const analytical={schemaVersion:1,enabled:true,params:{promotePage:false,filters:[]},categories:[],measures:[],formulas:[{id:'broken',name:'Broken',scope:'aggregate',expression:'Missing',ast:{kind:'reference',target:'measure',id:'gone'}}],layout:{rows:[],columns:[],values:['broken']},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:false}};
 const request={definition:{table:{},search:'',analytical},draft:{id:'draft',name:'Draft',scope:'aggregate' as const,expression:'SUM(Revenue)'},bindings:[]};
 await executor.applyModel(request.definition,{kind:'none'},revision,signal);workers[0].hold=true;
 const cancel=new AbortController(),pending=executor.bindFormula!(revision,request,cancel.signal);await flush();const rejected=expect(pending).rejects.toMatchObject({name:'AbortError'});cancel.abort();await rejected;
 expect(workers[0].terminated).toBe(false);workers[0].onerror?.();
 const result=await executor.bindFormula!(revision,request,signal);expect(result.ast).toBeDefined();expect(workers).toHaveLength(2);await expect(executor.bindFormula!({...revision,input:2},request,signal)).rejects.toMatchObject({descriptor:{code:'REVISION_MISMATCH'}});executor.dispose();
});
it('a binding read after worker restart does not prevent subsequent normal view rehydration',async()=>{
 const {executor,workers,signal}=setup();await executor.registerInput(input,1,signal);await executor.applyModel(definition,{kind:'none'},revision,signal);workers[0].onerror?.();
 const analytical={schemaVersion:1,enabled:true,params:{promotePage:false,filters:[]},categories:[],measures:[],formulas:[],layout:{rows:[],columns:[],values:[]},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:false}};
 expect((await executor.bindFormula!(revision,{definition:{table:{},search:'',analytical},draft:{id:'d',name:'D',scope:'aggregate',expression:'SUM(Revenue)'},bindings:[]},signal)).ast).toBeDefined();
 expect((await executor.totals(revision,signal)).values.revenue).toBe(40);executor.dispose();
});
it('snapshots authoring draft and revision before hydration awaits',async()=>{const {executor,signal}=setup();await executor.registerInput(input,1,signal);const analytical={schemaVersion:1,enabled:true,params:{promotePage:false,filters:[]},categories:[],measures:[],formulas:[],layout:{rows:[],columns:[],values:[]},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:false}};const request={definition:{table:{},search:'',analytical},draft:{id:'d',name:'D',scope:'aggregate' as const,expression:'SUM(Revenue)'},bindings:[]},rev={...revision};const pending=executor.bindFormula!(rev,request,signal);request.draft.expression='0';rev.input=2;const result=await pending;expect(result.revision).toEqual(revision);expect(result.ast).toMatchObject({kind:'call',function:'sum'});executor.dispose();});
// D-011: the drawer path. A local file with a blank Amount cell (CSV) or an
// omitted Amount key (JSON) sums the remaining values; it is not a group #ERROR.
it.each([
  ['practice.csv', 'Company,Desk,Amount\nAAPL,Trading,150\nAAPL,Trading,\nAAPL,Trading,350\nMSFT,Sales,200\n'],
  ['practice.json', '[{"Company":"AAPL","Desk":"Trading","Amount":150},{"Company":"AAPL","Desk":"Trading"},{"Company":"AAPL","Desk":"Trading","Amount":350},{"Company":"MSFT","Desk":"Sales","Amount":200}]'],
])('%s: a blank Amount is skipped in Company x Desk sums, not #ERROR', async (name, text) => {
  const { executor, signal } = setup();
  await executor.importFile(name, new TextEncoder().encode(text), 1, signal);
  const analytical: TableModelV1 = { schemaVersion: 1, params: { promotePage: true, filters: [] }, enabled: true,
    categories: [{ id: 'co', name: 'Company', sourceFieldId: 'Company', transform: 'native' }, { id: 'desk', name: 'Desk', sourceFieldId: 'Desk', transform: 'native' }],
    measures: [{ id: 'sum', sourceFieldId: 'Amount', aggregation: 'sum' }], formulas: [], layout: { rows: ['co'], columns: ['desk'], values: [] },
    checklists: [], resultFilters: [], subtotals: { grandTotal: true, groups: true } };
  const ready = await executor.applyModel({ table: {}, search: '', analytical }, { kind: 'none' }, revision, signal);
  expect(ready.diagnostics).toEqual([]);
  const rows = await executor.rows(revision, { groupPath: [], offset: 0, limit: 10 }, signal);
  expect(rows.rows.map(r => Object.values(r.values))).toEqual([['AAPL', 500], ['MSFT', 200]]);
  const totals = await executor.totals(revision, signal);
  expect(Object.values(totals.values).sort()).toEqual([200, 500]);
  expect(JSON.stringify([rows, totals])).not.toContain('#ERROR');
  executor.dispose();
});
// #16: the issue's own CSV. AAPL has one blank Amount, MSFT a 0. Blanks are
// skipped and zero is kept, for Total, Average and Count; a group whose only
// Amount is blank (E05-039) has a blank mean and Count 0, as the JSON path does.
it('#16: a blank CSV numeric cell is skipped by Total, Average and Count, not #ERROR', async () => {
  const csv = 'Company,Amount\nAAPL,200\nMSFT,300\nAAPL,250\nMSFT,0\nAAPL,\nMSFT,400\nAAPL,300\nMSFT,350\nAAPL,310\nMSFT,450\nAAPL,340\nMSFT,400\nNULL,\n';
  const { executor, signal } = setup();
  await executor.importFile('e05_055_practice.csv', new TextEncoder().encode(csv), 1, signal);
  const analytical: TableModelV1 = { schemaVersion: 1, params: { promotePage: true, filters: [] }, enabled: true,
    categories: [{ id: 'co', name: 'Company', sourceFieldId: 'Company', transform: 'native' }],
    measures: [{ id: 't', sourceFieldId: 'Amount', aggregation: 'sum' }, { id: 'a', sourceFieldId: 'Amount', aggregation: 'mean' }, { id: 'n', sourceFieldId: 'Amount', aggregation: 'count' }],
    formulas: [], layout: { rows: ['co'], columns: [], values: ['t', 'a', 'n'] }, checklists: [], resultFilters: [], subtotals: { grandTotal: true, groups: false } };
  const ready = await executor.applyModel({ table: {}, search: '', analytical }, { kind: 'none' }, revision, signal);
  expect(ready.diagnostics).toEqual([]);
  const rows = (await executor.rows(revision, { groupPath: [], offset: 0, limit: 10 }, signal)).rows.map(r => Object.values(r.values));
  const round = (v: unknown) => typeof v === 'number' ? Math.round(v * 100) / 100 : v;
  expect(rows.map(r => r.map(round))).toEqual([['AAPL', 1400, 280, 5], ['MSFT', 1900, 316.67, 6], ['NULL', undefined, undefined, 0]]);
  const totals = await executor.totals(revision, signal);
  expect(Object.values(totals.values).map(round)).toEqual([3300, 300, 11]);
  expect(JSON.stringify([rows, totals])).not.toContain('#ERROR');
  executor.dispose();
});
// D-014: a first-class M (month) category. The maintained legacy month recipe
// is the oracle; rows are deliberately out of date order so first/last must
// follow chronology rather than file order.
const prices = 'date,open,high,low,close,volume\n2025-01-03,10,12,9,11,100\n2025-01-02,8,9,7,9,50\n2025-01-31,11,15,10,14,70\n2025-02-03,14,16,13,15,60\n2025-02-28,15,17,12,16,40\n2025-03-05,16,20,16,19,90\n';
const monthly = (category: CategoryDef): TableModelV1 => ({ schemaVersion: 1, params: { promotePage: true, filters: [] }, enabled: true, categories: [category],
  measures: [{ id: 'o', sourceFieldId: 'open', aggregation: 'first' }, { id: 'h', sourceFieldId: 'high', aggregation: 'max' }, { id: 'l', sourceFieldId: 'low', aggregation: 'min' },
    { id: 'c', sourceFieldId: 'close', aggregation: 'last' }, { id: 'v', sourceFieldId: 'volume', aggregation: 'sum' }],
  formulas: [], layout: { rows: ['m'], columns: [], values: ['o', 'h', 'l', 'c', 'v'] }, checklists: [], resultFilters: [], subtotals: { grandTotal: false, groups: false } });
const monthlyRows = async (category: CategoryDef) => {
  const { executor, signal } = setup();
  await executor.importFile('prices.csv', new TextEncoder().encode(prices), 1, signal);
  const ready = await executor.applyModel({ table: {}, search: '', analytical: monthly(category) }, { kind: 'none' }, revision, signal);
  expect(ready.diagnostics).toEqual([]);
  const rows = (await executor.rows(revision, { groupPath: [], offset: 0, limit: 10 }, signal)).rows.map(r => r.values);
  executor.dispose();
  return rows;
};
it('D-014: an M category with first/max/min/last/sum validates and matches the legacy month recipe', async () => {
  const model = monthly({ id: 'm', name: 'Month', sourceFieldId: 'date', transform: 'M' });
  expect(validateTableModel(model).diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  const legacy = await monthlyRows({ id: 'm', name: 'Month', sourceFieldId: 'date', transform: 'native', legacyBucket: 'month' });
  const month = await monthlyRows(model.categories[0]);
  expect(month.map(v => [v.o, v.h, v.l, v.c, v.v])).toEqual([[8, 15, 7, 14, 220], [14, 17, 12, 16, 100], [16, 20, 16, 19, 90]]);
  expect(month).toEqual(legacy);
});
it('cancelled acquisition restores only committed input and model', async () => {
 const workers:FakeWorker[]=[];
 const executor=createWorkerExecutor('source',()=>{const worker=new FakeWorker();if(workers.length===1)worker.hold=true;workers.push(worker);return worker as unknown as Worker;});
 const signal=new AbortController().signal;
 await executor.registerInput(input,1,signal);await executor.applyModel(definition,{kind:'none'},revision,signal);
 const controller=new AbortController();const candidate=executor.registerInput({...input,rows:[{id:'candidate',values:{revenue:999}}]},2,controller.signal);
 const rejected=expect(candidate).rejects.toMatchObject({name:'AbortError'});await flush();controller.abort();await rejected;
 expect((await executor.totals(revision,signal)).values.revenue).toBe(40);executor.dispose();
});
it('failed registration and file acquisition preserve the committed input and model', async () => {
 for(const kind of ['register','import']){
  const {executor,workers,signal}=setup();await executor.registerInput(input,1,signal);await executor.applyModel(definition,{kind:'none'},revision,signal);
  if(kind==='register')await expect(executor.registerInput({...input,rows:[{id:'',values:{revenue:999}}]},2,signal)).rejects.toThrow();
  else await expect(executor.importFile('broken.json',new TextEncoder().encode('not json'),2,signal)).rejects.toThrow();
  expect((await executor.totals(revision,signal)).values.revenue).toBe(40);expect(workers.length).toBeGreaterThan(1);executor.dispose();
 }
});
it('apply supersedes acquisition before registration is posted in the TypeScript client',async()=>{
 const {executor,workers,signal}=setup();await executor.registerInput(input,1,signal);await executor.applyModel(definition,{kind:'none'},revision,signal);
 const candidate=executor.registerInput({...input,rows:[{id:'candidate',values:{revenue:999}}]},2,signal).then(()=>({status:'fulfilled' as const}),error=>({status:'rejected' as const,error}));
 const nextRevision={...revision,model:2,output:2};
 try{
  const ready=await executor.applyModel(definition,{kind:'none'},nextRevision,signal);
  expect(ready.topLevelCount).toBe(2);expect(await candidate).toMatchObject({status:'rejected',error:{name:'AbortError'}});
  expect(workers[1].terminated).toBe(true);expect((await executor.totals(nextRevision,signal)).values.revenue).toBe(40);
  workers.at(-1)!.onerror?.();expect((await executor.totals(nextRevision,signal)).values.revenue).toBe(40);
 }finally{executor.dispose();await candidate;}
});
it('one reader cancelled during shared rehydration does not fail a concurrent reader', async () => {
  const { executor, workers, signal } = setup();
  await executor.registerInput(input, 1, signal); await executor.applyModel(definition, { kind: 'none' }, revision, signal);
  workers[0].onerror?.();
  const a = new AbortController(), b = new AbortController();
  const first = executor.rows(revision, { groupPath: [], offset: 0, limit: 10 }, a.signal);
  const second = executor.totals(revision, b.signal);
  a.abort();
  await expect(first).rejects.toMatchObject({ name: 'AbortError' });
  expect((await second).kind).toBe('totals');
  executor.dispose();
});
it('a new apply rejects an in-flight read of the old view as superseded, not cancelled', async () => {
  const { executor, workers, signal } = setup();
  await executor.registerInput(input, 1, signal); await executor.applyModel(definition, { kind: 'none' }, revision, signal);
  workers[0].hold = true;
  const read = executor.rows(revision, { groupPath: [], offset: 0, limit: 10 }, new AbortController().signal);
  await flush();
  const next = executor.applyModel(definition, { kind: 'none' }, { ...revision, model: 2, output: 2 }, signal);
  await expect(read).rejects.toMatchObject({ descriptor: { code: 'REVISION_MISMATCH' } });
  expect((await next).kind).toBe('viewReady');
  executor.dispose();
});
