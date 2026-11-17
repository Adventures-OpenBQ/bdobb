// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
/* global Worker */
import {createWorkerExecutor} from '../../src/lib/tableExecution/workerClient.ts';
import {decodeWire} from '../../src/lib/tableExecution/rust/wireCodec.ts';
let active;
async function open(mode,wire){
 if(active)throw Error('Previous trial still active');
 const c=decodeWire(JSON.parse(wire)),controller=new AbortController();
 const worker=new Worker('/worker.js',{type:'module',name:mode==='indexed'?'bdobb-experimental-sort-reuse:536870912':''});
 const executor=createWorkerExecutor('source',()=>worker),revision={widgetId:'source',input:c.dataset.resultRevision,model:1,output:1};
 active={executor,worker,revision,controller,definition:c.definition,runtime:c.runtimeParams??{}};
 await executor.registerInput(c.dataset,revision.input,controller.signal);
 const ready=await executor.applyModel(c.definition,{kind:'none'},revision,controller.signal,true,undefined,undefined,active.runtime);
 active.target=ready.columns.find(c=>c.id!=='\x1egroup')?.id;
}
async function sort(count){
 const a=active;
 for(let i=0;i<count;i++){
  a.revision={...a.revision,model:a.revision.model+1,output:a.revision.output+1};
  const d=structuredClone(a.definition);d.table.sorting=[{id:a.target,desc:!!(i%2)}];
  await a.executor.applyModel(d,{kind:'none'},a.revision,a.controller.signal,true,undefined,undefined,a.runtime);
 }
}
async function clear(){
 const a=active;
 await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{a.worker.removeEventListener('message',listener);reject(Error('Disposal barrier timed out'));},10000);
  const listener=event=>{if(event.data.requestId==='heap-barrier'){clearTimeout(timeout);a.worker.removeEventListener('message',listener);if(event.data.kind!=='error')reject(Error('Expected disposed input refusal'));else resolve();}};
  a.worker.addEventListener('message',listener);
  a.worker.postMessage({kind:'dispose',requestId:'heap-dispose',revision:a.revision});
  a.worker.postMessage({kind:'inputSchema',requestId:'heap-barrier',revision:a.revision});
 });
}
function close(){if(active){active.executor.dispose();active.worker.terminate();active=undefined;}}
globalThis.sortMemory={open,sort,clear,close};
