// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {createTemporalRun} from './runs';
import type {AcquisitionRunHandle} from './generated';
import type {TemporalClient} from './client';
import {parseQueryBinding,type QueryBinding} from './bindings';
import {parseResultPage,type ResultPage} from './contracts';
import {mayNeedResolution,resolveParams} from './params';
export type TemporalPage={page:ResultPage;executionId:string;offset:number;pageNumber:number;hasPrevious:boolean;hasNext:boolean};
export interface TemporalPager {
 open(signal:AbortSignal):Promise<TemporalPage>;
 next(signal:AbortSignal):Promise<TemporalPage>;
 previous(signal:AbortSignal):Promise<TemporalPage>;
 cancel():Promise<void>;
 dispose():void;
}
const MAX_PAGES=1000,MAX_ROWS=1000,MAX_CURSOR=4096,MAX_PAGE_BYTES=2*1024*1024;
const check=(signal:AbortSignal)=>{if(signal.aborted)throw new DOMException('Temporal acquisition cancelled','AbortError');};
const canonical=(value:unknown)=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
/** Preserve row order and signed zero; object-key order is not page content. */
function rowCanonical(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(rowCanonical).join(',')+']';
 if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+rowCanonical((value as Record<string,unknown>)[key])).join(',')+'}';
 if(Object.is(value,-0))return '-0';
 const encoded=JSON.stringify(value);if(encoded===undefined)throw new Error('Invalid temporal page value');return encoded;
}
async function pageDigest(rows:ResultPage['rows']):Promise<string>{
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(rowCanonical(rows)));
 return [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
}

function delay(signal:AbortSignal){return new Promise<void>((resolve,reject)=>{
 const abort=()=>{clearTimeout(timer);reject(new DOMException('Temporal acquisition cancelled','AbortError'));};
 const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},250);
 signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
});}
/** Private cursor history for exactly one retained execution; never persisted in a card. */
export function createTemporalPager(client:TemporalClient,binding:QueryBinding,options:{progress?:(handle:AcquisitionRunHandle)=>void}={}):TemporalPager {
 const intent=parseQueryBinding(binding);
 let run:ReturnType<typeof createTemporalRun>|undefined;
 let disposed=false,busy=false,active:AbortController|undefined,executionId:string|undefined,revision:number|undefined,identity:string|undefined,current:TemporalPage|undefined;
 let commit:()=>void=()=>{};
 const history:Array<{cursor:string|undefined;offset:number;next:string|null;digest:string}>=[];
 async function transaction(work:(signal:AbortSignal)=>Promise<TemporalPage>,signal:AbortSignal){
  check(signal);if(disposed)throw new DOMException('Temporal pager disposed','AbortError');
  if(busy)throw new Error('Temporal page request already in progress');
  const controller=new AbortController();active=controller;busy=true;commit=()=>{};
  const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});
  try{check(signal);const result=await work(controller.signal);check(controller.signal);if(disposed)throw new DOMException('Temporal pager disposed','AbortError');commit();return structuredClone(result);}
  finally{signal.removeEventListener('abort',abort);busy=false;active=undefined;commit=()=>{};}
 }
 async function ensureExecution(signal:AbortSignal){
  if(!executionId){
   if(intent.kind==='execution')executionId=intent.executionId;
   else if(run){executionId=await run.open(signal);}
   else {
    const needsDefinition=intent.revisionPolicy==='latest'||mayNeedResolution(intent.params);
    const definition=needsDefinition?await client.get(intent.queryId,intent.revisionPolicy==='latest'?undefined:intent.revision,signal):undefined;
    check(signal);revision=intent.revisionPolicy==='latest'?definition!.revision:intent.revision!;
    const params=definition?resolveParams(definition.parameters,intent.params,new Date()).params:intent.params;
    if(intent.acquisition){
     run=createTemporalRun(client,{query_id:intent.queryId,revision,params,context:intent.context,policy_id:intent.acquisition.policyId,policy_revision:intent.acquisition.policyRevision,idempotency_key:`widget:${crypto.randomUUID()}`},options);
     executionId=await run.open(signal);
    }else{
     const handle=await client.start({query_id:intent.queryId,revision,params,context:intent.context},signal);
     executionId=handle.execution_id;
    }
    check(signal);
   }
  }
  for(let attempts=0;;attempts++){
   check(signal);const status=await client.status(executionId,signal);check(signal);
   if(status.execution_id!==executionId)throw new Error('Execution identity mismatch');
   if(status.state==='succeeded')return;
   if(status.state==='failed'||status.state==='cancelled')throw new Error(`TemporalDB execution ${status.state}`);
   if(attempts>=239)throw new Error('TemporalDB execution is still pending; refresh to retry');
   await delay(signal);
  }
 }
 async function read(index:number,signal:AbortSignal):Promise<TemporalPage>{
  if(index<0||index>=MAX_PAGES)throw new Error('Temporal cursor history limit reached');
  const previous=history[index-1],known=history[index];
  const cursor=known?.cursor??(index===0?undefined:previous?.next??undefined);
  if(index>0&&cursor===undefined)throw new Error('No next temporal page');
  const offset=known?.offset??(index===0?0:current!.offset+current!.page.rows.length);
  const raw=await client.page(executionId!,cursor,signal);check(signal);
  if(new TextEncoder().encode(JSON.stringify(raw)).byteLength>MAX_PAGE_BYTES)throw new Error('Temporal page byte limit exceeded');
  const page=structuredClone(parseResultPage(raw)),r=page.receipt;
  if(r.execution_id!==executionId)throw new Error('Execution receipt identity mismatch');
  if(intent.kind==='query'&&(r.query_id!==intent.queryId||r.query_revision!==revision))throw new Error('Query receipt revision mismatch');
  if(page.rows.length>MAX_ROWS)throw new Error('Temporal page row limit exceeded');
  if(page.next_cursor!==null&&(!page.next_cursor.length||page.next_cursor.length>MAX_CURSOR))throw new Error('Invalid temporal page cursor');
  if(page.next_cursor!==null&&(!page.rows.length||history.slice(0,index+1).some(item=>item.cursor===page.next_cursor)||page.next_cursor===cursor))throw new Error('Non-progressing temporal page cursor');
  const nextIdentity=canonical({receipt:r,schema:page.schema,count:page.total_count,countQuality:page.count_quality,complete:page.complete,truncated:page.truncated});
  if(identity!==undefined&&identity!==nextIdentity)throw new Error('Temporal page receipt, schema or count changed');
  if(known&&(known.next===null)!==(page.next_cursor===null))throw new Error('Temporal page terminal cursor changed');
  if(page.count_quality==='exact'&&(offset+page.rows.length>page.total_count||page.next_cursor!==null&&offset+page.rows.length>=page.total_count||page.next_cursor===null&&page.complete&&!page.truncated&&offset+page.rows.length!==page.total_count))throw new Error('Temporal page count mismatch');
  const digest=await pageDigest(page.rows);check(signal);
  if(known&&known.digest!==digest)throw new Error('Temporal page contents changed');
  // Publish only after all checks; failed reads never replace accepted data/history.
  check(signal);const accepted={page:structuredClone(page),executionId:executionId!,offset,pageNumber:index+1,hasPrevious:index>0,hasNext:page.next_cursor!==null};
  commit=()=>{identity=nextIdentity;history[index]={cursor,offset,next:page.next_cursor,digest};if(page.next_cursor!==null&&history[index+1])history[index+1].cursor=page.next_cursor;current=accepted;};
  return accepted;
 }
 return {
  open:signal=>transaction(async s=>{if(current)return current;await ensureExecution(s);return read(0,s);},signal),
  next:signal=>transaction(async s=>{if(!current)throw new Error('Open the temporal execution first');if(!current.hasNext)throw new Error('No next temporal page');return read(current.pageNumber,s);},signal),
  previous:signal=>transaction(async s=>{if(!current?.hasPrevious)throw new Error('No previous temporal page');return read(current.pageNumber-2,s);},signal),
  cancel:async()=>{await run?.cancel();},
  dispose(){disposed=true;active?.abort();void run?.cancel().catch(()=>{});current=undefined;history.length=0;identity=undefined;},
 };
}
