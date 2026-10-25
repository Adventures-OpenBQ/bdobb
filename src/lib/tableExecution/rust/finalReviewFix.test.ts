// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import {readFileSync} from 'node:fs';
import {beforeAll,expect,it} from 'vitest';
import {createRustExecutor,loadRustRuntime,type RustRuntime,type WasmModule} from './runtime';
import {createRustWorkerHandler,type RustWorkerMessage} from './rust.worker';
import {decodeResponse,encodeRequest} from './protocol';
import {input,revision} from '../fixtures';
import {oracleCases} from './oracle';
import {calculateView} from '../engine';
import type {ExecutionRequest,TableDefinition} from '../types';
import type {TableModelV1} from '../../tableModel/types';
import type {WidgetDataset} from '../../widgetData/types';
let runtime:RustRuntime;
beforeAll(async()=>{runtime=await loadRustRuntime(async()=>{const m=await import('./generated/pivot_wasm');await m.default({module_or_path:readFileSync(new URL('./generated/pivot_wasm_bg.wasm',import.meta.url))});return m as unknown as WasmModule;});});
const raw:TableDefinition={table:{},search:''};
const setup=()=>{const messages:RustWorkerMessage[]=[];const h=createRustWorkerHandler(m=>messages.push(m),async()=>runtime,'en-US');return {messages,h};};
async function evaluate(source:WidgetDataset,definition:TableDefinition) {
 const {messages,h}=setup();
 await h({kind:'registerInput',requestId:'r',revision,input:source,inputRevision:1});
 await h({kind:'applyModel',requestId:'a',revision,definition,selection:{kind:'none'}});
 const result=messages.at(-1);await h({kind:'dispose',requestId:'d',revision});return result;
}
it('keeps bucket and periodicity maps named tag structural while decoding real filter cells',async()=>{
 const source:WidgetDataset={...input,columns:[{id:'tag',label:'Date',dtype:'dateString'},{id:'amount',label:'Amount',dtype:'number'}],rows:[{id:'r',values:{tag:'2026-01-01',amount:2}}]};
 const definition:TableDefinition={search:'',table:{pivot:{enabled:true,grouping:['tag'],split:[],buckets:{tag:'year'},aggregationFns:{amount:'sum'}},columnFilters:[{id:'amount',value:{min:1,tag:'string'}}]}};
 const result=await evaluate(source,definition);
 expect(result).toMatchObject({kind:'viewReady',inspection:{inputPeriodicity:{tag:expect.any(String)},definition:{table:{pivot:{buckets:{tag:'year'}},columnFilters:[{value:{min:1,tag:'string'}}]}}}});
});
it('refuses malformed true wire values even with a valid correlated envelope',()=>{
 const request={kind:'totals',requestId:'t',revision} as ExecutionRequest;
 expect(()=>decodeResponse(JSON.stringify({protocolVersion:1,sessionId:1,response:{kind:'totals',requestId:'t',revision,values:{tag:{tag:'f64',value:'invalid'}}}}),request,1)).toThrow(/wire/);
});
for(const bad of [{toString:'bad'},[{toString:'bad'}]]) {
 for(const kind of ['text','date','facets'] as const)it(`refuses ${kind} coercion with supported inert records`,async()=>{
  const source:WidgetDataset={...input,columns:[{id:'v',label:'Value',dtype:kind==='date'?'dateString':'text'}],rows:[{id:'r',values:{v:kind==='facets'?bad:kind==='date'?'2026-01-01':'hello'}}]};
  const definition:TableDefinition=kind==='facets'?raw:{search:'',table:{columnFilters:[{id:'v',value:kind==='date'?{from:bad}:bad}]}};
  expect(()=>calculateView(source,definition,{kind:'none'},false)).toThrow(/primitive|toString/);
  expect(await evaluate(source,definition)).toMatchObject({kind:'error',error:{message:expect.stringContaining('primitive')}});
 });
 it('keeps unused fields inert and analytical search follows declared column short circuit',async()=>{
  const c=structuredClone(oracleCases.find(c=>c.name==='ratio-source-scope')!);
  c.dataset.rows=c.dataset.rows.slice(0,1);c.dataset.rows[0].values.opaque=bad;
  expect(await evaluate(c.dataset,c.definition)).toMatchObject({kind:'viewReady'});
  c.dataset.columns.push({id:'opaque',label:'Opaque',dtype:'text'});
  c.definition.search='A';
  expect(()=>calculateView(c.dataset,c.definition,{kind:'none'},false)).not.toThrow();
  expect(await evaluate(c.dataset,c.definition)).toMatchObject({kind:'viewReady'});
  c.dataset.columns=[c.dataset.columns.at(-1)!,...c.dataset.columns.slice(0,-1)];
  expect(()=>calculateView(c.dataset,c.definition,{kind:'none'},false)).toThrow(/primitive|toString/);
  expect(await evaluate(c.dataset,c.definition)).toMatchObject({kind:'error',error:{message:expect.stringContaining('primitive')}});
 });
}
it('compacts 600 emoji to 1000 UTF16 units and refuses a cut through a pair atomically',async()=>{
 const c=structuredClone(oracleCases.find(c=>c.name==='ratio-source-scope')!);
 const model=c.definition.analytical as TableModelV1;if(model.schemaVersion!==1)throw Error('table fixture');
 model.formulas=[{id:'source',name:'Source',scope:'source',expression:'',ast:{kind:'reference',target:'field',id:'x'}}];model.layout={rows:[],columns:[],values:[]};
 c.dataset.rows=c.dataset.rows.slice(0,1);c.dataset.rows[0].cellErrors={x:{code:'upstream',message:'😀'.repeat(600)},y:{code:'upstream',message:'a'+'😀'.repeat(600)}};
 const baseline=calculateView(c.dataset,c.definition,{kind:'none'},false);
 const {messages,h}=setup();
 await h({kind:'registerInput',requestId:'r',revision,input:c.dataset,inputRevision:1});
 await h({kind:'applyModel',requestId:'a',revision,definition:c.definition,selection:{kind:'none'}});expect(messages.at(-1)).toMatchObject({kind:'viewReady'});
 await h({kind:'rows',requestId:'rows',revision,request:{groupPath:[],offset:0,limit:1}});
 expect(messages.at(-1)).toMatchObject({kind:'rows',rows:[{cellErrors:{source:{message:'😀'.repeat(500)}}}]});
 expect(baseline.presentedRows[0].cellErrors?.source.message).toHaveLength(1000);
 model.formulas[0].ast={kind:'reference',target:'field',id:'y'};
 await h({kind:'applyModel',requestId:'a2',revision:{...revision,model:2,output:2},definition:c.definition,selection:{kind:'none'}});
 expect(messages.at(-1)).toMatchObject({kind:'error',error:{message:expect.stringContaining('Unicode')}});
 await h({kind:'rows',requestId:'old',revision,request:{groupPath:[],offset:0,limit:1}});expect(messages.at(-1)).toMatchObject({kind:'rows',rows:[{cellErrors:{source:{message:'😀'.repeat(500)}}}]});
 await h({kind:'dispose',requestId:'d',revision});
});

it('refuses aliased top-level row values before tagged-tree identity is lost, but accepts distinct equal values and nested aliases',()=>{
 const values={region:'A',amount:1};
 const source:WidgetDataset={...input,columns:[{id:'region',label:'Region'},{id:'amount',label:'Amount',dtype:'number'}],rows:[{id:'a',values},{id:'b',values}]};
 const definition:TableDefinition={search:'',table:{pivot:{enabled:true,grouping:['region'],split:[],aggregationFns:{amount:'sum'}}}};
 expect(calculateView(source,definition,{kind:'none'},false).logicalRows.filter(r=>['a','b'].includes(r.id)).map(r=>r.id)).toEqual(['b','b']);
 expect(()=>encodeRequest({kind:'registerInput',requestId:'alias',revision,input:source,inputRevision:1},'en-US',1)).toThrow(/shared top-level row.values/);
 const nested={opaque:'allowed'};
 source.rows=source.rows.map(r=>({...r,values:{...r.values,nested}}));
 expect(calculateView(source,definition,{kind:'none'},false).logicalRows.filter(r=>['a','b'].includes(r.id)).map(r=>r.id)).toEqual(['a','b']);
 expect(()=>encodeRequest({kind:'registerInput',requestId:'tree',revision,input:source,inputRevision:1},'en-US',1)).not.toThrow();
});
it('actual worker refuses aliased reacquisition and preserves old source, model, rows, totals and export',async()=>{
 const {messages,h}=setup();
 await h({kind:'registerInput',requestId:'r',revision,input,inputRevision:1});
 await h({kind:'applyModel',requestId:'a',revision,definition:raw,selection:{kind:'none'}});
 const values={revenue:999},candidate={...input,rows:[{id:'a',values},{id:'b',values}]};
 await h({kind:'registerInput',requestId:'alias',revision:{...revision,input:2,model:0,output:0},input:candidate,inputRevision:2});
 expect(messages.at(-1)).toMatchObject({kind:'error',error:{code:'INVALID_REQUEST',message:expect.stringContaining('shared top-level row.values')}});
 await h({kind:'rows',requestId:'rows',revision,request:{groupPath:[],offset:0,limit:3}});expect(messages.at(-1)).toMatchObject({kind:'rows',rows:input.rows});
 await h({kind:'totals',requestId:'totals',revision});expect(messages.at(-1)).toMatchObject({kind:'totals',revision});
 await h({kind:'presented',requestId:'export',revision,transferId:'alias-old',ignoreSelection:true});expect(messages.at(-1)).toMatchObject({kind:'subset',rows:input.rows,final:true});
 await h({kind:'applyModel',requestId:'repair',revision:{...revision,model:2,output:2},definition:raw,selection:{kind:'none'}});expect(messages.at(-1)).toMatchObject({kind:'viewReady',topLevelCount:3});
 await h({kind:'dispose',requestId:'d',revision});
});

it('actual Wasm facade restores committed source after alias refusal and accepts separate equal-valued rows',async()=>{
 class ActualWorker {
  onmessage:((event:MessageEvent)=>void)|null=null;
  onerror:(()=>void)|null=null;
  onmessageerror:(()=>void)|null=null;
  handler=createRustWorkerHandler(data=>this.onmessage?.({data} as MessageEvent),async()=>runtime,'en-US');
  postMessage(data:ExecutionRequest){void this.handler(structuredClone(data));}
  terminate(){void this.handler({kind:'dispose',requestId:'dispose',revision});}
 }
 const executor=createRustExecutor('source',()=>new ActualWorker() as unknown as Worker),signal=new AbortController().signal;
 try {
  await executor.registerInput(input,1,signal);await executor.applyModel(raw,{kind:'none'},revision,signal);
  const values={revenue:999};
  await expect(executor.registerInput({...input,rows:[{id:'a',values},{id:'b',values}]},2,signal)).rejects.toMatchObject({descriptor:{code:'INVALID_REQUEST',message:expect.stringContaining('shared top-level row.values')}});
  expect((await executor.rows(revision,{groupPath:[],offset:0,limit:3},signal)).rows).toEqual(input.rows);
  expect((await executor.totals(revision,signal)).revision).toEqual(revision);
  const exported=[];for await(const batch of executor.presented(revision,signal,true))exported.push(...batch.rows);expect(exported).toEqual(input.rows);
  const nested={x:'same'},next={...input,columns:[{id:'region',label:'Region'},{id:'revenue',label:'Revenue',dtype:'number' as const}],rows:['a','b'].map(id=>({id,values:{region:'A',revenue:1,nested}}))};
  await executor.registerInput(next,2,signal);
  const r={...revision,input:2,model:2,output:2};await executor.applyModel({search:'',table:{pivot:{enabled:true,grouping:['region'],split:[],aggregationFns:{revenue:'sum'}}}},{kind:'none'},r,signal);
  const roots=await executor.rows(r,{groupPath:[],offset:0,limit:1},signal);expect((await executor.rows(r,{groupPath:[roots.rows[0].id],offset:0,limit:2},signal)).rows.map(row=>row.id)).toEqual(['a','b']);
 } finally {executor.dispose();}
});
