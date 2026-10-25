// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import {readFileSync} from 'node:fs';
import {beforeAll,expect,it} from 'vitest';
import {loadRustRuntime,type RustRuntime,type WasmModule,createRustExecutor} from './runtime';
import {createRustWorkerHandler} from './rust.worker';
import {decodeWire,type WireValue} from './wireCodec';
import type {OracleCase,OracleResult} from './oracle';
import type {ExecutionRequest,Revision,ProviderCapabilities,SessionOptions} from '../types';
import {tableExecutorAdapter,localCapabilities} from './providerContract';
import {createLocalExecutionProvider,createRemoteProviderFixture} from './remoteProviderFixture';
let runtime:RustRuntime;
const signal=new AbortController().signal;
beforeAll(async()=>{runtime=await loadRustRuntime(async()=>{const module=await import('./generated/pivot_wasm');await module.default({module_or_path:readFileSync(new URL('./generated/pivot_wasm_bg.wasm',import.meta.url))});return module as unknown as WasmModule;});});
function corpus(name:string){return decodeWire(JSON.parse(readFileSync(new URL(`../../../test/fixtures/rust-pivot/${name}.json`,import.meta.url),'utf8')) as WireValue) as {case:OracleCase;result:Required<OracleResult>};}
const options:SessionOptions={widgetId:'oracle',protocolVersion:1,locale:'en-US'};
const revision:Revision={widgetId:'oracle',input:1,model:1,output:1};
// The transport is in-process; calculations use the actual compiled Wasm worker handler.
function localProvider(capabilities?:ProviderCapabilities){
 const posted:ExecutionRequest[]=[];
 const provider=createLocalExecutionProvider(opts=>createRustExecutor(opts.widgetId,()=>{
  const worker={onmessage:null as ((event:MessageEvent)=>void)|null,onerror:null,onmessageerror:null,
   postMessage(request:ExecutionRequest){posted.push(request);void handler(request);},terminate(){}};
  const handler=createRustWorkerHandler(message=>queueMicrotask(()=>worker.onmessage?.({data:message} as MessageEvent)),async()=>runtime,opts.locale);
  return worker as unknown as Worker;
 }),capabilities);
 return {provider,posted};
}
const strip=(value:object)=>{const {requestId:_requestId,sessionId:_sessionId,sourceSnapshotId:_snapshotId,resultId:_resultId,consistency:_consistency,...payload}=value as Record<string,unknown>;return payload;};
for(const name of ['analytical-source-split','ratio-source-scope','legacy-all-operators']){
 it(`complete-scope local and remote conformance with reversed 1/2/50 windows: ${name}`,async()=>{
  const {case:c,result:want}=corpus(name),local=localProvider();
  const fixture=createRemoteProviderFixture({runtime,sourceId:'fixture-source',snapshotId:'opaque-snapshot',input:c.dataset});
  const sessions=[await local.provider.open({kind:'local',input:c.dataset,inputRevision:1},options),await fixture.provider.open({kind:'remote',sourceId:'fixture-source',snapshotId:'opaque-snapshot'},options)];
  try{for(const session of sessions){
   expect(session.protocolVersion).toBe(1);expect(session.result).not.toHaveProperty('registerInput');expect(session.result).not.toHaveProperty('importFile');expect(session.result).not.toHaveProperty('inputSchema');
   const ready=await session.result.applyModel(c.definition,c.selection,revision,signal,false,undefined,undefined,c.runtimeParams);
   expect(strip(ready)).toStrictEqual({...want.ready,topLevelCount:{kind:'exact',value:want.ready.topLevelCount}});
   expect(ready).toMatchObject({sessionId:session.sessionId,sourceSnapshotId:session.sourceSnapshotId});expect(ready.resultId).toBeTruthy();expect(ready.consistency).toEqual({kind:'snapshot'});expect(session.consistency).toEqual({kind:'snapshot'});
   const adapter=tableExecutorAdapter(session),totals=await session.result.totals(revision,signal);
   expect(strip(totals)).toStrictEqual(want.totals);expect(totals.resultId).toBe(ready.resultId);
   // Schema already includes team 2 even before B's row has been loaded.
   if(name==='analytical-source-split'){expect(ready.columns.flatMap(col=>col.splitPath?.map(member=>member.value)??[])).toEqual(['0','1','2']);}
   for(const delivery of want.deliveries){
    expect([1,2,50]).toContain(delivery.size);
    // Frozen deliveries already request offsets in reverse order.
    const blocks=[...delivery.blocks];
    const delivered=await Promise.all(blocks.map(block=>adapter.rows(revision,{groupPath:block.groupPath,offset:block.offset,limit:delivery.size},signal)));
    delivered.forEach((block,index)=>expect(strip(block)).toStrictEqual(blocks[index]));
    expect(strip(await adapter.totals(revision,signal))).toStrictEqual(want.totals);
   }
   expect(strip(await adapter.selection(revision,{kind:'summary'},want.selection.rows.map(row=>row.rowId),signal))).toStrictEqual(want.selection);
   for(const facet of want.facets)expect(strip(await adapter.facets(revision,facet.categoryId,signal))).toStrictEqual(facet);
   for(const page of want.inspection)expect(strip(await adapter.inspect!(revision,{collection:page.collection,offset:page.offset,limit:page.limit},signal))).toStrictEqual(page);
   expect(strip(await adapter.chartData(revision,ready.columns.map(col=>col.id),signal))).toStrictEqual(want.chart);
   const batches=[];for await(const batch of adapter.presented(revision,signal,true))batches.push(batch);
   expect(batches.flatMap(batch=>batch.rows)).toStrictEqual(want.export.rows);
   expect(batches[0]).toMatchObject({columns:want.export.columns,provenance:want.export.provenance,completeness:want.export.completeness,freshness:want.export.freshness,diagnostics:want.export.diagnostics});
   expect(batches.map(batch=>batch.sequence)).toEqual(batches.map((_,index)=>index));expect(batches.at(-1)?.final).toBe(true);
   const first=await session.result.rows(revision,{groupPath:[],offset:0,limit:1},signal);
   const overlap=await session.result.rows(revision,{groupPath:[],offset:0,limit:2},signal);
   expect(first.rows[0]?.id).toBe(overlap.rows[0]?.id);expect(first.resultId).toBe(ready.resultId);
  }}finally{sessions.forEach(s=>s.result.dispose());}
 });
}
it('refuses unsupported definitions, functions, fiscal and selection before native apply while preserving the prior result',async()=>{
 const {case:c}=corpus('ratio-source-scope');
 const restricted:ProviderCapabilities={...localCapabilities(),formulaFunctions:[],fiscal:false,selection:false};
 const local=localProvider(restricted),s=await local.provider.open({kind:'local',input:c.dataset,inputRevision:1},options);
 try{
  const ready=await s.result.applyModel({table:{},search:''},{kind:'none'},revision,signal);
  const attempts=local.posted.filter(r=>r.kind==='applyModel').length;
  const ast={kind:'call',function:'sum',args:[{kind:'reference',target:'field',id:'revenue'}]};
  const formula={...c.definition,analytical:{...(c.definition.analytical as object),formulas:[{id:'f',name:'f',scope:'aggregate',expression:'SUM(revenue)',ast}]}};
  const fiscal=corpus('mixed-fiscal-calendars').case.definition;
  const unsupportedVersion={...c.definition,analytical:{...(c.definition.analytical as object),schemaVersion:99}};
  for(const [definition,selection] of [[formula,{kind:'none'}],[fiscal,{kind:'none'}],[unsupportedVersion,{kind:'none'}],[c.definition,{kind:'allMatching',excludedIds:[]}]] as const){
   await expect(s.result.applyModel(definition,selection as never,{...revision,model:2,output:2},signal)).rejects.toMatchObject({descriptor:{code:'UNSUPPORTED_CAPABILITY'}});
  }
  expect(local.posted.filter(r=>r.kind==='applyModel')).toHaveLength(attempts);
  expect((await s.result.rows(revision,{groupPath:[],offset:0,limit:1},signal)).resultId).toBe(ready.resultId);
 }finally{s.result.dispose();}
});
it('refuses disabled split features and remote binding on a local provider',async()=>{
 const {case:c}=corpus('analytical-source-split');
 const local=localProvider({...localCapabilities(),features:localCapabilities().features.filter(f=>f!=='splits')});
 await expect(local.provider.open({kind:'remote',sourceId:'x',snapshotId:'y'},options)).rejects.toMatchObject({descriptor:{code:'UNSUPPORTED_CAPABILITY'}});
 const s=await local.provider.open({kind:'local',input:c.dataset,inputRevision:1},options);
 try{await expect(s.result.applyModel(c.definition,{kind:'none'},revision,signal)).rejects.toMatchObject({descriptor:{code:'UNSUPPORTED_CAPABILITY'}});expect(local.posted.some(r=>r.kind==='applyModel')).toBe(false);}finally{s.result.dispose();}
});
it('represents unavailable counts explicitly and refuses them at the current renderer adapter',async()=>{
 const {case:c}=corpus('analytical-source-split');
 const fixture=createRemoteProviderFixture({runtime,sourceId:'remote',snapshotId:'snapshot',input:c.dataset,count:{kind:'unknown'}});
 const s=await fixture.provider.open({kind:'remote',sourceId:'remote',snapshotId:'snapshot'},options);
 try{
  const ready=await s.result.applyModel(c.definition,{kind:'none'},revision,signal);expect(ready.topLevelCount).toEqual({kind:'unknown'});
  expect((await s.result.rows(revision,{groupPath:[],offset:0,limit:1},signal)).siblingCount).toEqual({kind:'unknown'});
  const adapter=tableExecutorAdapter(s);
  await expect(adapter.applyModel(c.definition,{kind:'none'},{...revision,model:2,output:2},signal)).rejects.toMatchObject({descriptor:{code:'COUNT_UNAVAILABLE'}});
  await expect(adapter.rows(revision,{groupPath:[],offset:0,limit:1},signal)).rejects.toMatchObject({descriptor:{code:'COUNT_UNAVAILABLE'}});
 }finally{s.result.dispose();}
});
it('snapshot expiration refuses open, apply and reads explicitly without an empty replacement',async()=>{
 const {case:c}=corpus('analytical-source-split');
 const fixture=createRemoteProviderFixture({runtime,sourceId:'remote',snapshotId:'snapshot',input:c.dataset});
 const source={kind:'remote' as const,sourceId:'remote',snapshotId:'snapshot'};
 const s=await fixture.provider.open(source,options);
 await s.result.applyModel(c.definition,{kind:'none'},revision,signal);fixture.expire();
 for(const operation of [()=>fixture.provider.open(source,options),()=>s.result.rows(revision,{groupPath:[],offset:0,limit:1},signal),()=>s.result.totals(revision,signal),()=>s.result.applyModel(c.definition,{kind:'none'},revision,signal),()=>s.result.presented(revision,signal)[Symbol.asyncIterator]().next()]){
  await expect(operation()).rejects.toMatchObject({descriptor:{code:'SNAPSHOT_EXPIRED',sourceSnapshotId:s.sourceSnapshotId}});
 }
 s.result.dispose();
});
it('validates protocol and bound input coordinates and publishes new opaque result identities only on successful apply',async()=>{
 const {case:c}=corpus('analytical-source-split'),local=localProvider();
 await expect(local.provider.open({kind:'local',input:c.dataset,inputRevision:1},{...options,protocolVersion:99})).rejects.toMatchObject({descriptor:{code:'UNSUPPORTED_PROTOCOL'}});
 const s=await local.provider.open({kind:'local',input:c.dataset,inputRevision:1},options);
 try{
  const one=await s.result.applyModel(c.definition,{kind:'none'},revision,signal);
  await expect(s.result.applyModel(c.definition,{kind:'none'},{...revision,input:2},signal)).rejects.toMatchObject({descriptor:{code:'REVISION_MISMATCH'}});
  const two=await s.result.applyModel(c.definition,{kind:'none'},{...revision,model:2,output:2},signal);
  expect(two.resultId).not.toBe(one.resultId);expect(two.sourceSnapshotId).toBe(one.sourceSnapshotId);
  await expect(s.result.rows(revision,{groupPath:[],offset:0,limit:1},signal)).rejects.toThrow();
 }finally{s.result.dispose();}
});

it('refuses every non-exact renderer-required count, including children with an exact sibling count',async()=>{
 const {case:c}=corpus('legacy-all-operators');
 for(const count of [{kind:'unknown'},{kind:'estimated',value:0},{kind:'snapshotExpired'}] as const){
  for(const counts of [{topLevel:count},{sibling:count},{child:count}]){
   const fixture=createRemoteProviderFixture({runtime,sourceId:'remote',snapshotId:'snapshot',input:c.dataset,counts});
   const session=await fixture.provider.open({kind:'remote',sourceId:'remote',snapshotId:'snapshot'},options),adapter=tableExecutorAdapter(session);
   try{
    await expect(adapter.applyModel(c.definition,{kind:'none'},revision,signal)).rejects.toMatchObject({descriptor:{code:count.kind==='snapshotExpired'?'SNAPSHOT_EXPIRED':'COUNT_UNAVAILABLE'}});
    await session.result.applyModel(c.definition,{kind:'none'},revision,signal);
    const block=await session.result.rows(revision,{groupPath:[],offset:0,limit:1},signal);expect(block.groups.length).toBeGreaterThan(0);
    if(!('topLevel' in counts))await expect(adapter.rows(revision,{groupPath:[],offset:0,limit:1},signal)).rejects.toMatchObject({descriptor:{code:count.kind==='snapshotExpired'?'SNAPSHOT_EXPIRED':'COUNT_UNAVAILABLE'}});
   }finally{session.result.dispose();}
  }
 }
});
it('expires an active export between pulls and rejects further rows and cancelled/disposed reads',async()=>{
 const {case:c}=corpus('analytical-source-split');
 const fixture=createRemoteProviderFixture({runtime,sourceId:'remote',snapshotId:'snapshot',input:c.dataset,batchRows:1});
 const session=await fixture.provider.open({kind:'remote',sourceId:'remote',snapshotId:'snapshot'},options);
 await session.result.applyModel(c.definition,{kind:'none'},revision,signal);
 const iterator=session.result.presented(revision,signal,true)[Symbol.asyncIterator]();
 expect((await iterator.next()).value).toMatchObject({sequence:0,final:false,rows:[expect.any(Object)]});fixture.expire();
 await expect(iterator.next()).rejects.toMatchObject({descriptor:{code:'SNAPSHOT_EXPIRED',sourceSnapshotId:session.sourceSnapshotId}});
 session.result.dispose();await expect(session.result.rows(revision,{groupPath:[],offset:0,limit:1},signal)).rejects.toMatchObject({descriptor:{code:'SESSION_DISPOSED'}});
 const local=localProvider(),live=await local.provider.open({kind:'local',input:c.dataset,inputRevision:1},options);
 try{await live.result.applyModel(c.definition,{kind:'none'},revision,signal);const abort=new AbortController();abort.abort();await expect(live.result.rows(revision,{groupPath:[],offset:0,limit:1},abort.signal)).rejects.toThrow();}finally{live.result.dispose();}
});
it('accepts a Statement provider with sum aggregation without requiring an unused last operator',async()=>{
 const {case:c,result:want}=corpus('statement-income-wide');
 const local=localProvider({...localCapabilities(),aggregations:['sum']});
 const session=await local.provider.open({kind:'local',input:c.dataset,inputRevision:1},options);
 try{const ready=await tableExecutorAdapter(session).applyModel(c.definition,c.selection,revision,signal,false,undefined,undefined,c.runtimeParams);expect(strip(ready)).toStrictEqual(want.ready);}finally{session.result.dispose();}
});
it('previews a bound source before first publication without inventing a result identity',async()=>{
 const {case:c}=corpus('analytical-source-split');
 const local=localProvider(),session=await local.provider.open({kind:'local',input:c.dataset,inputRevision:1},options);
 try{const preview=await session.result.previewDefinition!(revision,c.definition,signal);expect(preview.total).toBe(2);expect(preview.columns).toHaveLength(4);expect(preview).toMatchObject({sessionId:session.sessionId,sourceSnapshotId:session.sourceSnapshotId});expect(preview).not.toHaveProperty('resultId');}finally{session.result.dispose();}
});
it('the remote fixture profiles its bound source as a source read',async()=>{
 const {case:c}=corpus('analytical-source-split');
 const fixture=createRemoteProviderFixture({runtime,sourceId:'remote',snapshotId:'snapshot',input:c.dataset});
 const session=await fixture.provider.open({kind:'remote',sourceId:'remote',snapshotId:'snapshot'},options);
 try{const page=await session.result.columnProfile!(revision,{definition:c.definition,scope:'input',offset:0,limit:50},signal);expect(page.kind).toBe('columnProfile');expect(page.rowsProfiled).toBeGreaterThan(0);expect(page.fields.length).toBeGreaterThan(0);expect(page).toMatchObject({sessionId:session.sessionId,sourceSnapshotId:session.sourceSnapshotId});expect(page).not.toHaveProperty('resultId');}finally{session.result.dispose();}
});
it('captures source and session coordinates before asynchronous local acquisition',async()=>{
 const {case:c}=corpus('analytical-source-split'),local=localProvider();
 const source={kind:'local' as const,input:c.dataset,inputRevision:1},opts={...options};
 const pending=local.provider.open(source,opts);source.inputRevision=99;opts.widgetId='mutated';
 const session=await pending;
 try{expect((await session.result.applyModel(c.definition,{kind:'none'},revision,signal)).revision).toEqual(revision);}finally{session.result.dispose();}
});
it('uses the successful response coordinates when caller-owned apply coordinates are mutated while awaiting',async()=>{
 const {case:c}=corpus('analytical-source-split'),local=localProvider();
 const session=await local.provider.open({kind:'local',input:c.dataset,inputRevision:1},options);
 try{const requested={...revision},pending=session.result.applyModel(c.definition,{kind:'none'},requested,signal);requested.model=99;const ready=await pending;expect(ready.revision).toEqual(revision);expect((await session.result.rows(revision,{groupPath:[],offset:0,limit:1},signal)).resultId).toBe(ready.resultId);}finally{session.result.dispose();}
});
it('admits renderer safe-exact counts before apply and preserves old rows, totals and export on refusal',async()=>{
 const {case:c,result:want}=corpus('analytical-source-split');
 for(const field of ['topLevel','sibling','child'] as const)for(const unavailable of [{kind:'unknown'},{kind:'estimated',value:0},{kind:'snapshotExpired'}] as const){
  const counts:{topLevel?:import('../types').ProviderCount;sibling?:import('../types').ProviderCount;child?:import('../types').ProviderCount}={};
  const fixture=createRemoteProviderFixture({runtime,sourceId:'remote',snapshotId:'snapshot',input:c.dataset,counts});
  const session=await fixture.provider.open({kind:'remote',sourceId:'remote',snapshotId:'snapshot'},options),adapter=tableExecutorAdapter(session);
  try{
   const first=await adapter.applyModel(c.definition,{kind:'none'},revision,signal);
   const identity=(await session.result.rows(revision,{groupPath:[],offset:0,limit:1},signal)).resultId;
   counts[field]=unavailable;
   await expect(adapter.applyModel(c.definition,{kind:'none'},{...revision,model:2,output:2},signal)).rejects.toMatchObject({descriptor:{code:unavailable.kind==='snapshotExpired'?'SNAPSHOT_EXPIRED':'COUNT_UNAVAILABLE'}});
   expect((await session.result.rows(revision,{groupPath:[],offset:0,limit:1},signal)).resultId).toBe(identity);
   expect((await adapter.rows(revision,{groupPath:[],offset:0,limit:1},signal)).rows).toStrictEqual(want.deliveries.find(d=>d.size===1)!.blocks.find(b=>b.offset===0&&b.groupPath.length===0)!.rows);
   expect(strip(await adapter.totals(revision,signal))).toStrictEqual(want.totals);
   const exported=[];for await(const batch of adapter.presented(revision,signal,true))exported.push(...batch.rows);expect(exported).toStrictEqual(want.export.rows);
   expect(first.topLevelCount).toBe(2);
   // A generic consumer may publish the same candidate with tagged unavailable counts.
   const generic=await session.result.applyModel(c.definition,{kind:'none'},{...revision,model:2,output:2},signal);
   const block=await session.result.rows({...revision,model:2,output:2},{groupPath:[],offset:0,limit:1},signal);
   if(field==='topLevel')expect(generic.topLevelCount).toEqual(unavailable);
   if(field==='sibling')expect(block.siblingCount).toEqual(unavailable);
   if(field==='child')expect(block.groups.every(group=>group.childCount.kind===unavailable.kind)).toBe(true);
  }finally{session.result.dispose();}
 }
});
it('refuses an absent renderer count guarantee before invoking a generic provider apply',async()=>{
 const {case:c}=corpus('analytical-source-split'),fixture=createRemoteProviderFixture({runtime,sourceId:'remote',snapshotId:'snapshot',input:c.dataset});
 const session=await fixture.provider.open({kind:'remote',sourceId:'remote',snapshotId:'snapshot'},options);
 try{
  await session.result.applyModel(c.definition,{kind:'none'},revision,signal);
  // Model a generic provider that only accepts the original eight-argument contract.
  const original=session.result.applyModel.bind(session.result);
  const generic={...session,capabilities:{...session.capabilities,safeExactCountAdmission:undefined},result:{...session.result,applyModel:async(...args:Parameters<import('../types').TableExecutor['applyModel']>)=>original(...args)}};
  await expect(tableExecutorAdapter(generic).applyModel(c.definition,{kind:'none'},{...revision,model:2,output:2},signal)).rejects.toMatchObject({descriptor:{code:'COUNT_UNAVAILABLE'}});
  expect((await session.result.rows(revision,{groupPath:[],offset:0,limit:1},signal)).rows).toHaveLength(1);
 }finally{session.result.dispose();}
});
it('returns structured errors for malformed saved model containers and entries without replacing the old publication',async()=>{
 const {case:c}=corpus('analytical-source-split'),local=localProvider(),session=await local.provider.open({kind:'local',input:c.dataset,inputRevision:1},options);
 try{
  const first=await session.result.applyModel(c.definition,{kind:'none'},revision,signal),attempts=local.posted.filter(r=>r.kind==='applyModel').length;
  const model=c.definition.analytical as Record<string,unknown>;
  const missingLayout={...model};delete missingLayout.layout;
  const statement=corpus('statement-income-wide').case.definition.analytical as Record<string,unknown>;
  const missingTemplate={...statement};delete missingTemplate.template;
  const missingOverrides={...statement};delete missingOverrides.overrides;
  for(const analytical of [missingLayout,{...model,enabled:false,formulas:[null]},{...model,formulas:{}},{...model,formulas:[{id:'bad'}]},missingTemplate,missingOverrides]){
   const malformed={table:{},search:'',analytical};
   await expect(session.result.applyModel(malformed,{kind:'none'},{...revision,model:2,output:2},signal)).rejects.toMatchObject({descriptor:{code:'INVALID_REQUEST'}});
   await expect(session.result.previewDefinition!(revision,malformed,signal)).rejects.toMatchObject({descriptor:{code:'INVALID_REQUEST'}});
   expect((await session.result.rows(revision,{groupPath:[],offset:0,limit:1},signal)).resultId).toBe(first.resultId);
  }
  expect(local.posted.filter(r=>r.kind==='applyModel')).toHaveLength(attempts);
 }finally{session.result.dispose();}
});
it('rejects malformed apply requirements structurally and captures valid requirements before awaiting',async()=>{
 const {case:c}=corpus('analytical-source-split'),local=localProvider(),session=await local.provider.open({kind:'local',input:c.dataset,inputRevision:1},options);
 try{
  const first=await session.result.applyModel(c.definition,{kind:'none'},revision,signal);
  for(const requirements of [null,{},[],{counts:'unknown'},{counts:'safeExact',extra:true}]){
   await expect(session.result.applyModel(c.definition,{kind:'none'},{...revision,model:2,output:2},signal,undefined,undefined,undefined,undefined,requirements as never)).rejects.toMatchObject({descriptor:{code:'INVALID_REQUEST'}});
   expect((await session.result.rows(revision,{groupPath:[],offset:0,limit:1},signal)).resultId).toBe(first.resultId);
  }
  const requirements={counts:'safeExact' as const},pending=session.result.applyModel(c.definition,{kind:'none'},{...revision,model:2,output:2},signal,false,'prior-namespace',[],{},requirements);
  Object.assign(requirements,{counts:'unknown'});await pending;
  expect(local.posted.filter(r=>r.kind==='applyModel').at(-1)).toMatchObject({reconcileMissing:false,previousSelectionNamespace:'prior-namespace',provenAbsentIds:[],runtimeParams:{}});
 }finally{session.result.dispose();}
});

it('assembles logical row windows from bounded managed subrequests while preserving groups',async()=>{
 const {case:c}=corpus('analytical-source-split');
 const dataset={...c.dataset,rows:Array.from({length:7},(_,i)=>({id:`r${i}`,values:{...c.dataset.rows[0].values,region:`G${i}`,revenue:i}}))};
 const fixture=createRemoteProviderFixture({runtime,sourceId:'s',snapshotId:'snap',input:dataset});
 const session=await fixture.provider.open({kind:'remote',sourceId:'s',snapshotId:'snap'},options);
 const calls:number[]=[];
 const adapter=tableExecutorAdapter({...session,rowBlockLimit:2,result:{...session.result,rows:async(r,q,s)=>{calls.push(q.limit);if(q.limit>2)throw new Error('Server row limit');return session.result.rows(r,q,s);}}});
 try{
  await adapter.applyModel({table:{pivot:{enabled:true,grouping:['region'],split:[],aggregationFns:{revenue:'sum'}}},search:''},{kind:'none'},revision,signal);
  const block=await adapter.rows(revision,{groupPath:[],offset:0,limit:5},signal);
  expect(calls).toEqual([2,2,1]);expect(block.rows.map(r=>Object.values(r.values))).toEqual([['G0',0],['G1',1],['G2',2],['G3',3],['G4',4]]);
  expect(block.siblingCount).toBe(7);expect(block.groups.map(g=>g.rowId)).toEqual(block.rows.map(r=>r.id));
 }finally{session.result.dispose();}
});
