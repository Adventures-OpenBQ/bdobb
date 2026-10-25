// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import {installAbortSignalAny} from '../../abortSignalAny';
import {describeHttpError} from '../../dataClient';
/** A completed request also releases fallback listeners attached to a session lifetime. */
export async function withRemoteSignal<T>(caller:AbortSignal,lifetime:AbortSignal,run:(signal:AbortSignal)=>Promise<T>):Promise<T>{
 installAbortSignalAny();const completion=new AbortController();
 try{return await run(AbortSignal.any([caller,lifetime,completion.signal]));}
 finally{completion.abort();}
}

export interface RemoteTransportConfig {
 baseUrl:string;
 /** Authenticated fetch, normally createManagedTableRequest(backend). */
 request:typeof fetch;
 maxRequestBytes?:number;
 maxResponseBytes?:number;
 timeoutMs?:number;
 /** Standard OpenBB API: show its bounded {"detail"} instead of the managed table service's status-only message. */
 relayDetail?:boolean;
}
export class RemoteHttpError extends Error {
 constructor(readonly status:number,message?:string){super(message??`Managed table HTTP ${status}${status===413?': configured resource limit reached; close unused tables or ask the operator to review limits':status===429?': service busy; try Reopen table when other work finishes':status===503?': service unavailable; check the connection and try Reopen table':''}`);this.name='RemoteHttpError';}
}
export function positiveLimit(value:number|undefined,fallback:number):number {
 const limit=value??fallback;
 if(!Number.isSafeInteger(limit)||limit<1)throw new Error('Invalid managed table limit');
 return limit;
}
export function createRemoteTransport(config:RemoteTransportConfig){
 const base=new URL(config.baseUrl);
 if(!['https:','http:'].includes(base.protocol)||base.username||base.password||base.search||base.hash)throw new Error('Invalid managed table base URL');
 const baseUrl=base.toString().replace(/\/+$/,''),request=config.request;
 const requestLimit=positiveLimit(config.maxRequestBytes,2*1024*1024),responseLimit=positiveLimit(config.maxResponseBytes,8*1024*1024),timeout=positiveLimit(config.timeoutMs,30_000);
 return {async json(method:'GET'|'POST'|'DELETE',path:string,body?:unknown,signal?:AbortSignal):Promise<unknown>{
  signal?.throwIfAborted();
  const encoded=body===undefined?undefined:JSON.stringify(body);
  if(encoded!==undefined&&new TextEncoder().encode(encoded).byteLength>requestLimit)throw new Error('Table request byte limit exceeded');
  const controller=new AbortController();
  const abort=()=>controller.abort(signal?.reason);
  signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>controller.abort(new Error('Table request timed out')),timeout);
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  const cancelled=new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>{
   void reader?.cancel().catch(()=>{});reject(controller.signal.reason);
  },{once:true}));
  try{
   const response=await Promise.race([request(`${baseUrl}/${path}`,{method,headers:{'Content-Type':'application/json'},body:encoded,signal:controller.signal}),cancelled]);
   controller.signal.throwIfAborted();
   if(Number(response.headers.get('content-length'))>responseLimit){void response.body?.cancel().catch(()=>{});throw new Error('Managed table response byte limit exceeded');}
   // A bodyless response contains no JSON. Never use unbounded text/json/arrayBuffer fallbacks.
   if(!response.body)throw new Error('Missing managed table response body');
   reader=response.body.getReader();
   const chunks:Uint8Array[]=[];let bytes=0;
   for(;;){
    const next=await Promise.race([reader.read(),cancelled]);controller.signal.throwIfAborted();
    if(next.done)break;
    bytes+=next.value.byteLength;
    if(bytes>responseLimit){void reader.cancel().catch(()=>{});throw new Error('Managed table response byte limit exceeded');}
    chunks.push(next.value);
   }
   const buffer=new Uint8Array(bytes);let offset=0;
   for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.byteLength;}
   if(!response.ok)throw new RemoteHttpError(response.status,config.relayDetail?describeHttpError(response.status,new TextDecoder().decode(buffer)):undefined);
   try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer));}
   catch{throw new Error('Malformed managed table JSON response');}
  }catch(error){
   if(controller.signal.aborted)throw controller.signal.reason;
   if(error instanceof RemoteHttpError||error instanceof Error&&/^(Managed table|Missing managed table|Malformed managed table)/.test(error.message))throw error;
   throw new Error('Table request failed');
  }finally{
   clearTimeout(timer);signal?.removeEventListener('abort',abort);reader?.releaseLock();
  }
 }};
}
