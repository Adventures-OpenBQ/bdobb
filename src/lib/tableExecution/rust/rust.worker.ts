// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {estimatedHostBytes,resourceCheck,validateResourceLimits,inputLimit,type ResourceLimits} from './resources';
import { datasetFromBytes } from '../../localTableData';
import { validateExecutionRequest, ExecutionProtocolError } from '../validation';
import type {ExecutionRequest,ExecutionResponse,Revision} from '../types';
import {loadRustRuntime,RustRuntimeFailure,type RustRuntime} from './runtime';
import {assertUnicodeScalarGraph,assertUnicodeScalar,PIVOT_PROTOCOL_VERSION} from './wireCodec';
export type RustWorkerMessage=ExecutionResponse|{kind:'rustReady';protocolVersion:number}|{kind:'rustFailed';message:string};
/** Read only own data fields; no cloning, getters or full descriptor arrays. */
function ownValue(raw:unknown,key:string):unknown {
 if(!raw||typeof raw!=='object')throw new ExecutionProtocolError('INVALID_REQUEST','Expected request object');
 const d=Object.getOwnPropertyDescriptor(raw,key);
 if(d&&!('value'in d))throw new ExecutionProtocolError('INVALID_REQUEST','Request accessors are unsupported');
 return d?.value;
}
function correlation(raw:unknown):{requestId:string;revision:Revision} {
 const requestId=ownValue(raw,'requestId'),r=ownValue(raw,'revision');
 const widgetId=ownValue(r,'widgetId'),input=ownValue(r,'input'),model=ownValue(r,'model'),output=ownValue(r,'output');
 if(typeof requestId!=='string'||!requestId||typeof widgetId!=='string'||!widgetId||![input,model,output].every(v=>Number.isSafeInteger(v)&&(v as number)>=0))throw new ExecutionProtocolError('INVALID_REQUEST','Invalid request correlation');
 assertUnicodeScalar(requestId);assertUnicodeScalar(widgetId);
 return {requestId,revision:{widgetId,input:input as number,model:model as number,output:output as number}};
}
/** One Wasm instance/session per worker. Synchronous dispatch cannot process cancellation until it yields. */
export function createRustWorkerHandler(send:(response:RustWorkerMessage)=>void,load:()=>Promise<RustRuntime>=loadRustRuntime,locale=new Intl.Collator().resolvedOptions().locale,limits?:ResourceLimits){
 validateResourceLimits(limits);
 let runtime:RustRuntime|undefined,handle:number|undefined,closed=false,queued=0,queuedBytes=0;
 const fail=(error:unknown)=>{if(closed)return;closed=true;if(runtime&&handle!==undefined){try{runtime.close_session(handle);}catch{/* A trapped module may also trap during cleanup; worker termination releases it. */}}handle=undefined;send({kind:'rustFailed',message:error instanceof Error?error.message:'Rust worker failed'});};
 const initialization=load().then(loaded=>{
  if(closed)return;runtime=loaded;handle=runtime.open_session({protocolVersion:PIVOT_PROTOCOL_VERSION,locale,limits});send({kind:'rustReady',protocolVersion:PIVOT_PROTOCOL_VERSION});
 }).catch(fail);
 let tail=initialization;
 return (raw:unknown):Promise<void>=>{
  if(closed)return Promise.resolve();
  let request:ExecutionRequest,bytes=0;
  try{
   const envelope=correlation(raw),kind=ownValue(raw,'kind');
   // Control messages retain only their canonical small envelope, permitting
   // disposal/cancellation under a zero budget without copying unrelated payloads.
   const control=kind==='dispose'||kind==='cancel';
   const source=control?{kind,...envelope,...(kind==='cancel'?{targetRequestId:ownValue(raw,'targetRequestId')}:{})}:raw;
   if(!control){
    if(kind==='registerInput'){
     const candidate=ownValue(raw,'input'),rows=ownValue(candidate,'rows');
     if(Array.isArray(rows))resourceCheck(limits?.maxRows,rows.length,'Input row budget exceeded');
     const cap=inputLimit(limits??{});
     if(cap!==undefined)resourceCheck(cap,estimatedHostBytes(candidate,cap),'Input conversion reservation unavailable or exceeded');
    }
    if(kind==='importFile'){
     const file=ownValue(raw,'bytes');
     if(file instanceof Uint8Array)resourceCheck(inputLimit(limits??{}),file.byteLength,'File admission budget exceeded');
     if(limits?.maxStateBytes!==undefined)throw new ExecutionProtocolError('RESOURCE_LIMIT','State budget cannot bound file-parser expansion; supply a validated Dataset');
    }
    if(limits?.maxStateBytes!==undefined){
     const queueBudget=Math.floor(limits.maxStateBytes/2);
     // Reserve worker-owned raw graph and the validator's full clone together,
     // before allocating that clone. Keep both reserved through settlement.
     bytes=estimatedHostBytes(raw,Math.max(0,Math.floor((queueBudget-queuedBytes)/2)))*2;
     resourceCheck(queueBudget,queuedBytes+bytes,'Queued request state reservation unavailable or exceeded');
    }
   }
   if(queued>=32){fail(new Error('Too many queued Rust requests'));return Promise.resolve();}
   // Unicode/accessor validation still covers the original graph, even for a
   // canonical control request. It runs only after resource admission.
   assertUnicodeScalarGraph(raw);
   queuedBytes+=bytes;
   try{request=validateExecutionRequest(source);}catch(error){queuedBytes-=bytes;throw error;}
  }catch(error){
   try{
    const envelope=correlation(raw);
    send({kind:'error',...envelope,completeness:{kind:'unknown',warnings:[]},diagnostics:[],error:error instanceof ExecutionProtocolError?error.descriptor:{code:'INVALID_REQUEST',message:error instanceof Error?error.message:'Invalid Rust request'}});
   }catch{/* Invalid correlations cannot be published. */}
   return Promise.resolve();
  }
  queued++;
  // Dispose also invalidates work still waiting for initialization/acquisition.
  if(request.kind==='dispose'){closed=true;const dispose=()=>{if(runtime&&handle!==undefined)runtime.close_session(handle);handle=undefined;};dispose();return initialization.then(dispose).finally(()=>{queued--;queuedBytes-=bytes;});}
  const work=tail.then(async()=>{
   if(closed||!runtime||handle===undefined)return;
   try{
    const command=request.kind==='importFile'?validateExecutionRequest({kind:'registerInput',requestId:request.requestId,revision:request.revision,inputRevision:request.inputRevision,input:await datasetFromBytes(request.name,request.bytes,request.revision.widgetId,request.inputRevision)}):request;
    if(closed)return;
    const response=runtime.dispatch(handle,command);if(response)send(response);
   }catch(error){
    if(error instanceof RustRuntimeFailure){fail(error);return;}
    send({kind:'error',requestId:request.requestId,revision:request.revision,completeness:{kind:'unknown',warnings:[]},diagnostics:[],error:error instanceof ExecutionProtocolError?error.descriptor:{code:'INVALID_REQUEST',message:error instanceof Error?error.message:'Rust request failed'}});
   }
  }).finally(()=>{queued--;queuedBytes-=bytes;});
  tail=work.catch(fail);return work;
 };
}
if(typeof self!=='undefined'&&typeof document==='undefined'){
 try{
  if(self.name.length>4096)throw new Error('Oversized Rust worker configuration');
  const config=self.name?JSON.parse(self.name):{};
  if(!config||typeof config!=='object'||Array.isArray(config)||Object.keys(config).some(key=>key!=='pivotLimits'))throw new Error('Invalid Rust worker configuration');
  const handle=createRustWorkerHandler(response=>self.postMessage(response),loadRustRuntime,undefined,config.pivotLimits);
  self.onmessage=event=>{void handle(event.data);};
 }catch(error){self.postMessage({kind:'rustFailed',message:error instanceof Error?error.message:'Invalid Rust worker configuration'});}
}
