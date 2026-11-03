// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it,vi} from 'vitest';
import * as engine from './engine';
import {createWorkerHandler} from './table.worker';
import {decodeWire,type WireValue} from './rust/wireCodec';
import raw from '../../test/fixtures/rust-pivot/ratio-source-scope.json';
import type {WidgetDataset} from '../widgetData/types';
import type {TableDefinition,Revision,ExecutionRequest,ExecutionResponse} from './types';
const fixture=(decodeWire(raw as WireValue) as {case:{dataset:WidgetDataset;definition:TableDefinition}}).case;
const revision:Revision={widgetId:'source',input:fixture.dataset.resultRevision,model:1,output:1};
const next={...revision,model:2,output:2};
function setup(budget?:number){
 const messages:ExecutionResponse[]=[];
 const handler=createWorkerHandler(message=>messages.push(message),budget===undefined?undefined:{experimentalSortReuseBytes:budget});
 const call=async(command:object,rev=revision)=>{await handler({...command,revision:rev,requestId:'q'} as ExecutionRequest);const result=messages.pop();expect(result).toBeDefined();return result!;};
 return {call};
}
const apply=(definition:TableDefinition)=>({kind:'applyModel',definition,selection:{kind:'none'},reconcileMissing:true});
const sorted=()=>{const d=structuredClone(fixture.definition);d.table.sorting=[{id:'x',desc:true}];return d;};
it('reuses an opted-in complete analytical calculation for a sort-only update',async()=>{
 const {call}=setup(536870912);await call({kind:'registerInput',input:fixture.dataset,inputRevision:revision.input});
 expect((await call(apply(fixture.definition))).kind).toBe('viewReady');
 const spy=vi.spyOn(engine,'calculateView');
 try{expect((await call(apply(sorted()),next)).kind).toBe('viewReady');expect(spy).not.toHaveBeenCalled();}finally{spy.mockRestore();}
});
it('keeps full calculation as the default and zero-budget path',async()=>{
 for(const budget of [undefined,0]){
  const {call}=setup(budget);await call({kind:'registerInput',input:fixture.dataset,inputRevision:revision.input});await call(apply(fixture.definition));
  const spy=vi.spyOn(engine,'calculateView');try{await call(apply(sorted()),next);expect(spy).toHaveBeenCalledTimes(1);}finally{spy.mockRestore();}
 }
});
async function publication(call:ReturnType<typeof setup>['call'],ready:ExecutionResponse,rev:Revision){
 expect(ready.kind).toBe('viewReady');if(ready.kind!=='viewReady')throw Error('ready');
 const blocks:ExecutionResponse[]=[];
 const visit=async(path:string[])=>{const b=await call({kind:'rows',request:{groupPath:path,offset:0,limit:100}},rev);expect(b.kind).toBe('rows');blocks.push(b);if(b.kind==='rows')for(const g of b.groups)await visit(g.path);};await visit([]);
 const totals=await call({kind:'totals'},rev),chart=await call({kind:'chartData',fields:ready.columns.map(c=>c.id)},rev),exports=[];
 for(const ignoreSelection of [false,true]){const batches=[];let sequence=0;for(;;){const b=await call(sequence?{kind:'nextSubset',transferId:'t',sequence}:{kind:'presented',transferId:'t',ignoreSelection},rev);expect(b.kind).toBe('subset');if(b.kind!=='subset')throw Error('subset');batches.push(b);if(b.final)break;sequence++;}exports.push(batches);}
 return {ready,blocks,totals,chart,exports};
}
it('matches full publications through repeated sorts and selection reconciliation',async()=>{
 const full=setup(),indexed=setup(536870912),d=structuredClone(fixture.definition);
 const selectionCases=[{kind:'none'},{kind:'allMatching',excludedIds:[]},{kind:'explicit',ids:['absent']}];
 for(const worker of [full,indexed])await worker.call({kind:'registerInput',input:fixture.dataset,inputRevision:revision.input});
 let n=1;
 for(const id of ['x','region','x','not-a-binding','x'])for(const selection of selectionCases){
  d.table.sorting=[{id,desc:!!(n%2)}];const rev={...revision,model:n,output:n};
  const command={...apply(d),selection};
  const a=await full.call(command,rev),b=await indexed.call(command,rev);
  expect(await publication(indexed.call,b,rev)).toEqual(await publication(full.call,a,rev));n++;
 }
});
it('invalidates model, search and runtime dependencies',async()=>{
 const {call}=setup(536870912),d=structuredClone(fixture.definition);
 const model=d.analytical as import('../tableModel/types').TableModelV1,category=model.categories[0].id;
 model.params.filters=[{id:'audit-filter',categoryId:category,label:'Audit',multiSelect:true}];
 await call({kind:'registerInput',input:fixture.dataset,inputRevision:revision.input});
 await call({...apply(d),runtimeParams:{}});
 for(const [i,command]of [
  {...apply(d),runtimeParams:{[`pivot:filter:${category}`]:{source:'viewer',memberKeys:[]}}},
  {...apply({...d,search:'no matching row'}),runtimeParams:{}},
 ].entries()){
  const spy=vi.spyOn(engine,'calculateView');try{expect((await call(command,{...next,model:i+2,output:i+2})).kind).toBe('viewReady');expect(spy).toHaveBeenCalledTimes(1);}finally{spy.mockRestore();}
 }
});
it('reacquisition with the same input revision cannot reuse the old input',async()=>{
 const {call}=setup(536870912);await call({kind:'registerInput',input:fixture.dataset,inputRevision:revision.input});await call(apply(fixture.definition));
 const changed=structuredClone(fixture.dataset);changed.rows[0].values.x=12345;
 await call({kind:'registerInput',input:changed,inputRevision:revision.input});
 const spy=vi.spyOn(engine,'calculateView');try{await call(apply(sorted()),next);expect(spy).toHaveBeenCalledTimes(1);}finally{spy.mockRestore();}
 const baseline=setup();await baseline.call({kind:'registerInput',input:changed,inputRevision:revision.input});const fresh=await baseline.call(apply(sorted()),next);
 expect(await publication(call,await call(apply(sorted()),{...next,model:3,output:3}),{...next,model:3,output:3})).toEqual(await publication(baseline.call,await baseline.call(apply(sorted()),{...next,model:3,output:3}),{...next,model:3,output:3}));expect(fresh.kind).toBe('viewReady');
});
it('falls back for duplicate IDs, tiny budgets, non-default reconciliation and unknown reservations',async()=>{
 for(const scenario of ['duplicate','tiny','reconcile','unknown'] as const){
  const input=structuredClone(fixture.dataset),{call}=setup(scenario==='tiny'?1024:536870912);
  if(scenario==='duplicate')input.rows[1].id=input.rows[0].id;
  if(scenario==='unknown')input.rows[0].values.extra=1n;
  await call({kind:'registerInput',input,inputRevision:revision.input});await call(apply(fixture.definition));
  const spy=vi.spyOn(engine,'calculateView');try{expect((await call({...apply(sorted()),...(scenario==='reconcile'?{reconcileMissing:false}:{})},next)).kind).toBe('viewReady');expect(spy).toHaveBeenCalledTimes(1);}finally{spy.mockRestore();}
 }
});
it('keeps snapshots isolated and the prior publication after refusal',async()=>{
 const {call}=setup(536870912);await call({kind:'registerInput',input:fixture.dataset,inputRevision:revision.input});const ready=await call(apply(fixture.definition));
 const before=await call({kind:'rows',request:{groupPath:[],offset:0,limit:100}});
 if(ready.kind==='viewReady')ready.inspection.definition.search='mutated response';
 const bad=structuredClone(fixture.definition);bad.table.sorting=[{id:'x',desc:'invalid' as unknown as boolean}];
 expect((await call(apply(bad),next)).kind).toBe('error');
 expect(await call({kind:'rows',request:{groupPath:[],offset:0,limit:100}})).toEqual(before);
 const spy=vi.spyOn(engine,'calculateView');try{await call(apply(sorted()),next);expect(spy).not.toHaveBeenCalled();}finally{spy.mockRestore();}
});
it('rejects invalid opt-in reservations',()=>{for(const value of [-1,NaN,Infinity,4294967296])expect(()=>setup(value)).toThrow('Invalid experimental sort reservation');});
it('preserves missing-cell semantics for sparse prototype-named source fields',async()=>{
 for(const id of ['constructor','toString','__proto__']){
  const input=structuredClone(fixture.dataset),d=structuredClone(fixture.definition),m=d.analytical as import('../tableModel/types').TableModelV1;
  m.layout.rows=[];m.layout.columns=[];input.columns.push({id,label:id,dtype:'number'});
  input.rows[0].values=Object.fromEntries([...Object.entries(input.rows[0].values),[id,5]]);
  const third=structuredClone(input.rows[1]);third.id='audit-third';third.values=Object.fromEntries([...Object.entries(third.values),[id,1]]);input.rows.push(third);
  const full=setup(),indexed=setup(536870912);
  for(const worker of [full,indexed]){await worker.call({kind:'registerInput',input,inputRevision:revision.input});await worker.call(apply(d));}
  d.table.sorting=[{id,desc:true}];
  const a=await full.call(apply(d),next),b=await indexed.call(apply(d),next);
  expect(await publication(indexed.call,b,next)).toEqual(await publication(full.call,a,next));
 }
});
it('does not read inherited group-cell properties',async()=>{
 const d=structuredClone(fixture.definition),m=d.analytical as import('../tableModel/types').TableModelV1;
 m.categories.push({id:'auditSplit',name:'Split',sourceFieldId:'y',transform:'native'});m.layout.columns=['auditSplit'];
 const full=setup(),indexed=setup(536870912);
 for(const worker of [full,indexed]){await worker.call({kind:'registerInput',input:fixture.dataset,inputRevision:revision.input});await worker.call(apply(d));}
 const id='auditSortMissingCell';d.table.sorting=[{id,desc:true}];
 Object.defineProperty(Object.prototype,id,{configurable:true,get(){throw Error('inherited cell read');}});
 try{const a=await full.call(apply(d),next),b=await indexed.call(apply(d),next);expect(b.kind).toBe('viewReady');expect(await publication(indexed.call,b,next)).toEqual(await publication(full.call,a,next));}
 finally{Reflect.deleteProperty(Object.prototype,id);}
});
it('reuses captured group sort keys without scanning source-member rows again',async()=>{
 const input=structuredClone(fixture.dataset),d=structuredClone(fixture.definition),m=d.analytical as import('../tableModel/types').TableModelV1;
 const category=m.layout.rows[0],field=m.categories.find(c=>c.id===category)!.sourceFieldId;
 input.rows=Array.from({length:50},(_,i)=>({...structuredClone(fixture.dataset.rows[i%fixture.dataset.rows.length]),id:`group-source-${i}`,values:{...fixture.dataset.rows[i%fixture.dataset.rows.length].values,[field]:`group-${i}`}}));
 const full=setup(),indexed=setup(536870912);
 for(const worker of [full,indexed]){await worker.call({kind:'registerInput',input,inputRevision:revision.input});await worker.call(apply(d));}
 d.table.sorting=[{id:category,desc:true}];
 const original=Map.prototype.get;let memberReads=0;
 const spy=vi.spyOn(Map.prototype,'get').mockImplementation(function(this:Map<unknown,unknown>,key:unknown){
  const value=original.call(this,key);
  if(value instanceof Map&&typeof original.call(value,category)?.ok==='boolean')memberReads++;
  return value;
 });
 let ready:ExecutionResponse;
 try{ready=await indexed.call(apply(d),next);}finally{spy.mockRestore();}
 expect(memberReads).toBe(0);
 expect(await publication(indexed.call,ready!,next)).toEqual(await publication(full.call,await full.call(apply(d),next),next));
});
