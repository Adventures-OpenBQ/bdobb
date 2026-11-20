// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Diagnostic only: real validation/worker/runtime modules, mocked WASM reply.
import {build} from 'esbuild';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(new URL('../..',import.meta.url).pathname),dir=await mkdtemp(join(tmpdir(),'openbq-copy-audit-'));
try{
 const contents=`export {createRustWorkerHandler} from ${JSON.stringify(join(root,'src/lib/tableExecution/rust/rust.worker.ts'))};export {loadRustRuntime} from ${JSON.stringify(join(root,'src/lib/tableExecution/rust/runtime.ts'))};export {createWorkerHandler} from ${JSON.stringify(join(root,'src/lib/tableExecution/table.worker.ts'))};export {validateExecutionRequest} from ${JSON.stringify(join(root,'src/lib/tableExecution/validation.ts'))};export {input,revision} from ${JSON.stringify(join(root,'src/lib/tableExecution/fixtures.ts'))};`;
 await build({stdin:{contents,resolveDir:root},bundle:true,platform:'node',format:'esm',outfile:join(dir,'audit.mjs'),logLevel:'silent',plugins:[{name:'no-browser-url',setup(b){b.onResolve({filter:/\.wasm\?url$/},()=>({path:'wasm-url',namespace:'audit'}));b.onLoad({filter:/.*/,namespace:'audit'},()=>({contents:'export default "";',loader:'js'}));}}]});
 const t=await import(pathToFileURL(join(dir,'audit.mjs')).href),original=globalThis.structuredClone;
 const raw={kind:'registerInput',requestId:'audit',revision:t.revision,input:t.input,inputRevision:1};
 const result={method:'Real validation and worker/runtime modules in Node; transport clone simulated using original structuredClone and excluded. Mock WASM reply; counts are topology evidence, not timing or browser copy totals.',paths:[]};
 for(const engine of ['typescript','rust']){
  let copies=0;globalThis.structuredClone=(value,...args)=>{if(value?.kind==='registerInput')copies++;return original(value,...args);};
  try{
   const messages=[];
   const runtime=engine==='rust'?await t.loadRustRuntime(async()=>({protocol_version:()=>1,open_session:()=>1,close_session(){},dispatch(handle,text){const q=JSON.parse(text).request;return JSON.stringify({protocolVersion:1,sessionId:handle,response:{kind:'registered',requestId:q.requestId,revision:q.revision,completeness:{kind:'complete',warnings:[]},diagnostics:[]}});}})):null;
   const handler=engine==='rust'?t.createRustWorkerHandler(message=>messages.push(message),async()=>runtime,'en-US'):t.createWorkerHandler(message=>messages.push(message));
   const validated=t.validateExecutionRequest(raw); // same client send boundary
   await handler(original(validated)); // transport owns a separate graph
   assert(messages.some(m=>m.kind==='registered'),JSON.stringify(messages));
   result.paths.push({engine,requestValidationClones:copies});
  }finally{globalThis.structuredClone=original;}
 }
 assert.deepEqual(result.paths.map(p=>p.requestValidationClones),[2,3]);
 const output=resolve(process.argv[2]??'/tmp/openbq-copy-audit.json');await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{await rm(dir,{recursive:true,force:true});}
