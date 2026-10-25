// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import './rust-pivot-resources';
import './matched-executors';
import {finalReviewProbe} from './rust-pivot-final-review';
import { decodeWire, encodeWire, type WireValue } from '../../src/lib/tableExecution/rust/wireCodec';
import type { OracleCase, OracleResult } from '../../src/lib/tableExecution/rust/oracle';
import type { ExecutionRequest, ExecutionResponse, Revision, TableDefinition, SubsetBatch, ViewReady, SelectionResult } from '../../src/lib/tableExecution/types';
import type { DatasetRow } from '../../src/lib/widgetData/types';
import wasmUrl from '../../src/lib/tableExecution/rust/generated/pivot_wasm_bg.wasm?url';
import init from '../../src/lib/tableExecution/rust/generated/pivot_wasm';
import {createRustExecutor} from '../../src/lib/tableExecution/rust/runtime';
import {input} from '../../src/lib/tableExecution/fixtures';
const stats={active:0,terminated:0,pending:0};

async function trace(frozen: WireValue) {
 const {case:c,result:want}=decodeWire(frozen) as {case:OracleCase;result:Required<OracleResult>};
 const worker = new Worker(new URL('../../src/lib/tableExecution/rust/rust.worker.ts', import.meta.url), {type:'module'});
 stats.active++;let id=0,disposed=false;
 const pending=new Map<string,{resolve:(value:ExecutionResponse)=>void;reject:(error:Error)=>void}>();
 let resolveReady!:()=>void,rejectReady!:(error:Error)=>void;
 const readyPromise=new Promise<void>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
 worker.onerror=event=>{const error=new Error(event.message);rejectReady(error);for(const p of pending.values())p.reject(error);pending.clear();};
 worker.onmessage=event=>{
  const response=event.data;
  if(response.kind==='rustReady'){if(response.protocolVersion!==1)rejectReady(new Error('protocol mismatch'));else resolveReady();return;}
  if(response.kind==='rustFailed'){const error=new Error(response.message);rejectReady(error);for(const p of pending.values())p.reject(error);pending.clear();return;}
  const p=pending.get(response.requestId);if(p){pending.delete(response.requestId);p.resolve(response);}
 };
 let rev:Revision={widgetId:'oracle',input:c.dataset.resultRevision,model:1,output:1},def:TableDefinition=c.definition,selection=c.selection,params=c.runtimeParams;
 const call=async(command:object,fixedId?:string):Promise<ExecutionResponse>=>{
  if(disposed)throw new Error('disposed');await readyPromise;const requestId=fixedId??`browser-${++id}`;
  return new Promise((resolve,reject)=>{pending.set(requestId,{resolve,reject});worker.postMessage({requestId,revision:rev,...command});});
 };
 const clean=(value:ExecutionResponse)=>{const {requestId,...rest}=value;void requestId;return rest;};
 const apply=()=>call({kind:'applyModel',definition:def,selection,runtimeParams:params,reconcileMissing:false});
 const subset=async(ignoreSelection:boolean)=>{
  const transferId=`stream-${ignoreSelection}-${rev.model}`,requestId=`stream-request-${++id}`;let sequence=0;const rows:DatasetRow[]=[],batches:unknown[]=[];let first!:SubsetBatch;
  for(;;){const batch=await call(sequence===0?{kind:'presented',transferId,ignoreSelection}:{kind:'nextSubset',transferId,sequence},requestId) as SubsetBatch;
   if(batch.kind!=='subset')throw new Error(JSON.stringify(batch));if(sequence===0)first=batch;
   batches.push({...clean(batch),transferId:'oracle-transfer'});rows.push(...batch.rows);if(batch.final)break;sequence++;
  }
  return {batches,revision:rev,rows,columns:first.columns,provenance:first.provenance,completeness:first.completeness,freshness:first.freshness,diagnostics:first.diagnostics};
 };
 try {
  await call({kind:'registerInput',input:c.dataset,inputRevision:rev.input});let ready=await apply();
  if(c.expectFailure){if(ready.kind!=='error')throw new Error('Expected refusal');return encodeWire({error:ready.error.message});}
  const operations:unknown[]=[];
  for(const op of c.operations){
   switch(op.kind){
    case 'selection':{const response=await call({kind:'selection',action:op.action,visibleIds:op.visibleIds??want.selection.rows.map(r=>r.rowId)}) as SelectionResult;operations.push(clean(response));selection=response.selection;rev={...rev,model:rev.model+1,output:rev.output+1};ready=await apply();break;}
    case 'apply':def=op.definition??def;params=op.runtimeParams??params;rev={...rev,model:rev.model+1,output:rev.output+1};ready=await apply();operations.push(clean(ready));break;
    case 'preview':operations.push(clean(await call({kind:'previewDefinition',definition:op.definition})));break;
    case 'bindFormula':case 'memberDomain':case 'columnProfile':operations.push(clean(await call({...op})));break;
    case 'inspect':operations.push(clean(await call({kind:'inspect',...op.request})));break;
    case 'identityWitness':operations.push(op.path.length<2?undefined:clean(await call({...op})));break;
    case 'linked':{
     const delivered=await subset(false),{batches:_batches,revision:_revision,...child}=delivered,childRev={...rev,widgetId:'linked'};
     await call({kind:'registerInput',input:{...child,resultRevision:rev.model,outputRevision:rev.output},inputRevision:rev.input});
     const original=rev;rev=childRev;const childReady=await call({kind:'applyModel',definition:op.definition,selection:op.selection??{kind:'none'}}) as ViewReady;
     operations.push({ready:clean(childReady),chart:clean(await call({kind:'chartData',fields:childReady.columns.map(col=>col.id)})),totals:clean(await call({kind:'totals'}))});
     rev=original;await call({kind:'registerInput',input:c.dataset,inputRevision:rev.input});ready=await apply();break;
    }
   }
  }
  const deliveries=[];for(const delivery of want.deliveries){const blocks=[];for(const block of delivery.blocks)blocks.push(clean(await call({kind:'rows',request:{groupPath:block.groupPath,offset:block.offset,limit:delivery.size}})));deliveries.push({size:delivery.size,blocks});}
  const facets=[];for(const facet of want.facets)facets.push(clean(await call({kind:'facets',categoryId:facet.categoryId})));
  const inspection=[];for(const page of want.inspection)inspection.push(clean(await call({kind:'inspect',collection:page.collection,offset:page.offset,limit:page.limit})));
  return encodeWire({ready:clean(ready),operations,deliveries,facets,inspection,totals:clean(await call({kind:'totals'})),selection:clean(await call({kind:'selection',action:{kind:'summary'},visibleIds:want.selection.rows.map(r=>r.rowId)})),chart:clean(await call({kind:'chartData',fields:(ready as ViewReady).columns.map(col=>col.id)})),linked:await subset(false),export:await subset(true)});
 } finally {
  worker.postMessage({kind:'dispose',requestId:'dispose',revision:rev} satisfies ExecutionRequest);disposed=true;worker.terminate();
  stats.pending+=pending.size;for(const p of pending.values())p.reject(new Error('disposed'));pending.clear();stats.active--;stats.terminated++;
 }
}
Object.assign(window,{pivotHarness:{trace,wasmUrl,stats,finalReviewProbe,async batchProbe(){const executor=createRustExecutor('batch-probe');const signal=new AbortController().signal,revision={widgetId:'batch-probe',input:1,model:1,output:1};try{await executor.registerInput({...input,rows:Array.from({length:1001},(_,i)=>({id:`r${i}`,values:{revenue:i}}))},1,signal);await executor.applyModel({table:{},search:''},{kind:'none'},revision,signal);const batches=[];for await(const batch of executor.presented(revision,signal,true))batches.push({sequence:batch.sequence,final:batch.final,ids:batch.rows.map(row=>row.id),metadata:!!batch.columns});return batches;}finally{executor.dispose();}},async disposeRace(){let terminated=0;const executor=createRustExecutor('dispose-race',()=>{const worker=new Worker(new URL('../../src/lib/tableExecution/rust/rust.worker.ts',import.meta.url),{type:'module'});const terminate=worker.terminate.bind(worker);worker.terminate=()=>{terminated++;terminate();};return worker;});const registration=executor.registerInput(input,1,new AbortController().signal);executor.dispose();try{await registration;return {rejected:false,terminated};}catch{return {rejected:true,terminated};}},async memory(){const exports=await init({module_or_path:wasmUrl});return {shared:typeof SharedArrayBuffer!=='undefined'&&exports.memory.buffer instanceof SharedArrayBuffer,buffer:exports.memory.buffer instanceof ArrayBuffer,isolated:crossOriginIsolated};}}});
document.getElementById('status')!.textContent='Portable Pivot ready';
