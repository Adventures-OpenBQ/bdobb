// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import { loadRustRuntime, createRustExecutor, type WasmModule } from './runtime';
import { input, definition, revision } from '../fixtures';
import { createWorkerHandler } from '../table.worker';
import type { ExecutionRequest } from '../types';
class WorkerDouble {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  held: ExecutionRequest[] = [];
  hold = false;
  handler = createWorkerHandler(data => this.emit(data));
  emit(data: unknown) { this.onmessage?.({data} as MessageEvent); }
  postMessage(data: ExecutionRequest) { if (this.hold) this.held.push(data); else void this.handler(data); }
  terminate() { this.terminated = true; }
}
const flush = async () => {for(let i=0;i<12;i++) await Promise.resolve();};
const setup = () => {
  const workers: WorkerDouble[]=[];
  const executor=createRustExecutor('source',()=>{const worker=new WorkerDouble();workers.push(worker);return worker as unknown as Worker;});
  return {workers,executor,signal:new AbortController().signal};
};
it('propagates Wasm loading failure',async()=>{
  await expect(loadRustRuntime(async()=>{throw new Error('load failed');})).rejects.toThrow('load failed');
});
it('refuses a compiled module protocol mismatch',async()=>{
  await expect(loadRustRuntime(async()=>({protocol_version:()=>999}) as WasmModule)).rejects.toThrow('protocol');
});
it('settles initialization on load failure and protocol mismatch',async()=>{
  for(const message of [{kind:'rustFailed',message:'load failed'},{kind:'rustReady',protocolVersion:999}]){
    const {executor,workers,signal}=setup();
    const pending=executor.registerInput(input,1,signal);
    await flush();workers[0].emit(message);
    await expect(pending).rejects.toThrow();expect(workers[0].terminated).toBe(true);
    executor.dispose();
  }
});
it('settles disposal during initialization and refuses late readiness',async()=>{
  const {executor,workers,signal}=setup();
  const pending=executor.registerInput(input,1,signal);
  await flush();expect(workers[0].held).toEqual([]);
  executor.dispose();workers[0].emit({kind:'rustReady',protocolVersion:1});
  await expect(pending).rejects.toThrow('disposed');expect(workers[0].terminated).toBe(true);
});
it('settles every reader on trap and malformed response',async()=>{
  for(const failure of ['trap','malformed']){
    const {executor,workers,signal}=setup();
    const registration=executor.registerInput(input,1,signal);await flush();workers[0].emit({kind:'rustReady',protocolVersion:1});await registration;
    await executor.applyModel(definition,{kind:'none'},revision,signal);workers[0].hold=true;
    const readers=[executor.totals(revision,signal),executor.rows(revision,{groupPath:[],offset:0,limit:1},signal)];
    const settled=Promise.allSettled(readers);await flush();
    if(failure==='trap')workers[0].emit({kind:'rustFailed',message:'Wasm trap'});
    else workers[0].emit({requestId:workers[0].held[0].requestId,revision,kind:'totals',values:'invalid'});
    expect((await settled).every(item=>item.status==='rejected')).toBe(true);
    expect(workers[0].terminated).toBe(true);executor.dispose();
  }
});
it('cancelled apply restarts from committed model and rejects stale generation schema/selection',async()=>{
  const {executor,workers,signal}=setup();
  const registration=executor.registerInput(input,1,signal);await flush();workers[0].emit({kind:'rustReady',protocolVersion:1});await registration;
  await executor.applyModel(definition,{kind:'none'},revision,signal);workers[0].hold=true;
  const abort=new AbortController();const candidate=executor.applyModel({table:{},search:''},{kind:'allMatching',excludedIds:[]},{...revision,model:2,output:2},abort.signal);
  const rejected=expect(candidate).rejects.toMatchObject({name:'AbortError'});await flush();abort.abort();await rejected;
  const oldCallback=workers[0].onmessage;
  const result=executor.rows(revision,{groupPath:[],offset:0,limit:2},signal);await flush();
  oldCallback?.({data:{kind:'rustReady',protocolVersion:1}} as MessageEvent);
  await workers[0].handler(workers[0].held[0]);
  workers[1].emit({kind:'rustReady',protocolVersion:1});
  const rows=await result;expect(rows.siblingCount).toBe(2);expect(rows.selection?.selection).toEqual({kind:'none'});
  executor.dispose();
});
it('malformed uncorrelated worker messages settle all pending requests',async()=>{
 const {executor,workers,signal}=setup();const registration=executor.registerInput(input,1,signal);await flush();workers[0].emit({kind:'rustReady',protocolVersion:1});await registration;
 await executor.applyModel(definition,{kind:'none'},revision,signal);workers[0].hold=true;
 const settled=Promise.allSettled([executor.totals(revision,signal),executor.inputSchema!(signal)]);await flush();workers[0].emit({kind:'nonsense'});
 expect((await settled).every(value=>value.status==='rejected')).toBe(true);expect(workers[0].terminated).toBe(true);executor.dispose();
},1000);
it('malformed error descriptors reset the generation and settle every reader',async()=>{
 const {executor,workers,signal}=setup();const registration=executor.registerInput(input,1,signal);await flush();workers[0].emit({kind:'rustReady',protocolVersion:1});await registration;
 await executor.applyModel(definition,{kind:'none'},revision,signal);workers[0].hold=true;
 const settled=Promise.allSettled([executor.totals(revision,signal),executor.rows(revision,{groupPath:[],offset:0,limit:1},signal)]);await flush();
 workers[0].emit({requestId:workers[0].held[0].requestId,revision,kind:'error',completeness:input.completeness,diagnostics:[],error:{code:'BOGUS',message:'bad'}});
 expect((await settled).every(value=>value.status==='rejected')).toBe(true);executor.dispose();
},1000);
for(const targetInput of [1,2])for(const acquisition of ['register','import']){
 it(`superseding delayed-ready ${acquisition} with input ${targetInput} apply restores only committed state`,async()=>{
  const {executor,workers,signal}=setup();
  const first=executor.registerInput(input,1,signal);await flush();workers[0].emit({kind:'rustReady',protocolVersion:1});await first;
  await executor.applyModel(definition,{kind:'none'},revision,signal);
  const candidateInput={...input,columns:[{id:'candidate',label:'Candidate'}],rows:[{id:'uncommitted',values:{candidate:999}}]};
  const candidate=acquisition==='register'?executor.registerInput(candidateInput,2,signal):executor.importFile('candidate.json',new TextEncoder().encode('[{"candidate":999}]'),2,signal);
  const acquired=candidate.then(()=>({status:'fulfilled' as const}),error=>({status:'rejected' as const,error}));
  await flush();const discarded=workers[1];expect(discarded.held).toEqual([]);
  const candidateRevision={...revision,input:targetInput,model:2,output:2};
  const supersedingDefinition=targetInput===2?{table:{},search:''}:definition;
  const applied=executor.applyModel(supersedingDefinition,{kind:'allMatching',excludedIds:[]},candidateRevision,signal).then(value=>({status:'fulfilled' as const,value}),error=>({status:'rejected' as const,error}));
  try{
   await flush();discarded.emit({kind:'rustReady',protocolVersion:1});await flush();
   if(workers.at(-1)!==discarded)workers.at(-1)!.emit({kind:'rustReady',protocolVersion:1});
   const outcome=await applied;
   if(targetInput===1){expect(outcome.status).toBe('fulfilled');if(outcome.status==='fulfilled')expect(outcome.value.topLevelCount).toBe(2);}
   else{expect(outcome.status).toBe('rejected');if(outcome.status==='rejected')expect(outcome.error).toMatchObject({descriptor:{code:'REVISION_MISMATCH'}});}
   expect(await acquired).toMatchObject({status:'rejected',error:{name:'AbortError'}});expect(discarded.terminated).toBe(true);
   // Late registration and schema/selection publication from the discarded generation cannot commit.
   await discarded.handler({kind:'registerInput',requestId:'late-input',revision:{...revision,input:2},input:candidateInput,inputRevision:2});
   await discarded.handler({kind:'applyModel',requestId:'late-model',revision:{...revision,input:2,model:2,output:2},definition:{table:{},search:''},selection:{kind:'explicit',ids:['uncommitted']}});
   const committedRevision=targetInput===1?candidateRevision:revision;
   expect((await executor.inputSchema!(signal)).columns).toStrictEqual(input.columns);
   const rows=await executor.rows(committedRevision,{groupPath:[],offset:0,limit:2},signal);
   expect(rows.siblingCount).toBe(2);expect(rows.selection?.selection).toEqual(targetInput===1?{kind:'allMatching',excludedIds:[]}:{kind:'none'});
   expect((await executor.totals(committedRevision,signal)).values.revenue).toBe(40);
   const published=workers.at(-1)!;published.onmessageerror?.();
   const restored=executor.totals(committedRevision,signal);await flush();workers.at(-1)!.emit({kind:'rustReady',protocolVersion:1});
   expect((await restored).values.revenue).toBe(40);expect(published.terminated).toBe(true);
   expect((await executor.inputSchema!(signal)).columns).toStrictEqual(input.columns);
  }finally{executor.dispose();await Promise.all([applied,acquired]);}
 });
}
it('an older failed acquisition cannot reset a newer read-recovery generation',async()=>{
 const {executor,workers,signal}=setup();const initial=executor.registerInput(input,1,signal);await flush();workers[0].emit({kind:'rustReady',protocolVersion:1});await initial;
 await executor.applyModel(definition,{kind:'none'},revision,signal);
 const acquisition=executor.registerInput({...input,rows:[{id:'candidate',values:{revenue:999}}]},2,signal).then(()=>({status:'fulfilled' as const}),error=>({status:'rejected' as const,error}));
 await flush();const discarded=workers[1];discarded.emit({kind:'rustFailed',message:'Discarded worker lost'});
 // Recovery starts synchronously before the old acquisition catch can execute;
 // no new apply/acquire operation token has been issued.
 const recovered=executor.totals(revision,signal).then(value=>({status:'fulfilled' as const,value}),error=>({status:'rejected' as const,error}));
 try{
  await flush();const replacement=workers[2];expect(replacement.terminated).toBe(false);replacement.emit({kind:'rustReady',protocolVersion:1});
  expect(await acquisition).toMatchObject({status:'rejected',error:{message:'Discarded worker lost'}});
  const result=await recovered;expect(result.status).toBe('fulfilled');if(result.status==='fulfilled')expect(result.value.values.revenue).toBe(40);
  expect(replacement.terminated).toBe(false);expect((await executor.inputSchema!(signal)).columns).toStrictEqual(input.columns);
 }finally{executor.dispose();await Promise.all([acquisition,recovered]);}
});
