// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type {TemporalClient} from './client';
import type {AcquisitionRunHandle,AcquisitionRunRequest} from './generated';
import {parseContract} from './contracts';
type RunClient=Pick<TemporalClient,'submitRun'|'runStatus'|'cancelRun'>;
const contextKey=(value:AcquisitionRunRequest['context'])=>canonical(Object.fromEntries(Object.entries(value).filter(([key,v])=>key!=='schema_version'&&v!==null&&v!==undefined)));
const canonical=(value:unknown)=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const check=(signal:AbortSignal)=>{if(signal.aborted)throw new DOMException('Temporal run cancelled','AbortError');};
const wait=(signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{
 const abort=()=>{clearTimeout(timer);reject(new DOMException('Temporal run cancelled','AbortError'));};
 const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},250);
 signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
});
/** One caller-owned run; retries retain frozen intent and the same idempotency key. */
export function createTemporalRun(client:RunClient,input:AcquisitionRunRequest,options:{progress?:(handle:AcquisitionRunHandle)=>void;wait?:(signal:AbortSignal)=>Promise<void>}={}){
 const request=structuredClone(parseContract('AcquisitionRunRequest',input));
 let current:AcquisitionRunHandle|undefined,busy=false,cancelled=false;
 async function cancel(){cancelled=true;if(current&& !['ready','failed','cancelled'].includes(current.state))accept(await client.cancelRun(current.run_id));}
 function accept(raw:AcquisitionRunHandle){
  const h=parseContract('AcquisitionRunHandle',raw);
  if(h.policy_id!==request.policy_id||h.policy_revision!==request.policy_revision||contextKey(h.context)!==contextKey(request.context)||current&&h.run_id!==current.run_id)throw new Error('Temporal run identity mismatch');
  if(h.state==='ready'&&!h.execution_id||h.state!=='ready'&&h.execution_id)throw new Error('Invalid temporal run execution');
  current=structuredClone(h);options.progress?.(structuredClone(h));
 }
 return {
  async open(signal:AbortSignal):Promise<string>{
   check(signal);if(cancelled)throw new DOMException('Temporal run cancelled','AbortError');
   if(busy)throw new Error('Temporal run request already in progress');busy=true;
   const abort=()=>{void cancel().catch(()=>{/* Server deadline remains authoritative after lost cancellation acknowledgement. */});};
   signal.addEventListener('abort',abort,{once:true});
   try{
    // Keep submission alive long enough to learn the caller run ID after an abort.
    if(!current){const h=await client.submitRun(request);accept(h);if(signal.aborted||cancelled){await cancel().catch(()=>{});check(signal);throw new DOMException('Temporal run cancelled','AbortError');}}
    for(let attempts=0;;attempts++){
     check(signal);if(cancelled)throw new DOMException('Temporal run cancelled','AbortError');
     if(current!.state==='ready')return current!.execution_id!;
     if(current!.state==='failed'||current!.state==='cancelled')throw new Error(`TemporalDB run ${current!.state}${current!.error_code?`: ${current!.error_code}`:''}`);
     if(Date.now()>=Date.parse(current!.deadline)||attempts>=14400)throw new Error('TemporalDB run deadline reached; inspect run status');
     await (options.wait??wait)(signal);check(signal);
     const h=await client.runStatus(current!.run_id,signal);check(signal);accept(h);
    }
   }finally{signal.removeEventListener('abort',abort);busy=false;}
  },
  cancel,
  status:()=>current?structuredClone(current):undefined,
 };
}
