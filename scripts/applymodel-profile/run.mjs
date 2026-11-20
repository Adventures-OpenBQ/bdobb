// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {build} from 'esbuild';
import {readFile,writeFile,mkdir,cp,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {tmpdir,cpus,platform} from 'node:os';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {workloads} from '../matched-executors-workloads.mjs';
import {chromium,webkit} from '@playwright/test';
import assert from 'node:assert/strict';
import {insertOnce,summarizeSpans} from './instrument.mjs';
const root=resolve(new URL('../..',import.meta.url).pathname),artifact=resolve(process.argv[2]??'/tmp/openbq-applymodel-instrumented'),output=resolve(process.argv[3]??'/tmp/openbq-applymodel-spans.json');
const beforeDir=process.argv[4]?resolve(process.argv[4]):null;
const dir=await mkdtemp(join(tmpdir(),'applymodel-profile-web-'));
const runtimePath=join(root,'src/lib/tableExecution/rust/runtime.ts');
const plugins=[{name:'benchmark-only-runtime',setup(b){
 b.onResolve({filter:/^(profile-artifact|stock-artifact|before-artifact)$/},args=>({path:args.path==='profile-artifact'?join(artifact,'generated/pivot_wasm.js'):args.path==='before-artifact'&&beforeDir?join(beforeDir,'pivot_wasm.js'):join(root,'src/lib/tableExecution/rust/generated/pivot_wasm.js')}));
 b.onResolve({filter:/pivot_wasm_bg\.wasm\?url$/},()=>({path:'wasm-url',namespace:'profile'}));
 b.onLoad({filter:/.*/,namespace:'profile'},()=>({contents:'export default "/stock.wasm";',loader:'js'}));
 b.onResolve({filter:/\.\/generated\/pivot_wasm$/},()=>({path:join(root,'src/lib/tableExecution/rust/generated/pivot_wasm.js')}));
 b.onLoad({filter:/rust\.worker\.ts$/},async args=>{
  const source=await readFile(args.path,'utf8'),at=source.indexOf("if(typeof self!=='undefined'&&typeof document==='undefined'){");
  if(at<0)throw Error('Worker automatic entry anchor drift');
  return {contents:source.slice(0,at),loader:'ts'};
 });
 b.onLoad({filter:/\/rust\/runtime\.ts$/},async args=>{
  assert.equal(args.path,runtimePath);let source=await readFile(args.path,'utf8');
  source=insertOnce(source,'const encoded=encodeRequest(request,session.locale,handle);',`const profile=(globalThis as any).__profileTiming; const encodeStart=performance.now();const encoded=encodeRequest(request,session.locale,handle);if(profile)profile.encodeMs=performance.now()-encodeStart;`);
  source=insertOnce(source,'try {const response=decodeResponse(module.dispatch(handle,encoded),request,handle,session.shape);',`try {const dispatchStart=performance.now();const text=module.dispatch(handle,encoded);if(profile)profile.moduleCallMs=performance.now()-dispatchStart;const decodeStart=performance.now();const response=decodeResponse(text,request,handle,session.shape);if(profile)profile.decodeMs=performance.now()-decodeStart;`);
  return {contents:source,loader:'ts'};
 });
}}];
let server,browser;
try{
 for(const [entry,name] of [['scripts/applymodel-profile/worker.ts','worker.js'],['scripts/applymodel-profile/page.ts','page.js'],['src/lib/tableExecution/table.worker.ts','typescript.js']])await build({absWorkingDir:root,entryPoints:[entry],outfile:join(dir,name),bundle:true,format:'esm',platform:'browser',plugins,logLevel:'silent',target:'es2022'});
 await build({absWorkingDir:root,entryPoints:['scripts/applymodel-profile/worker.ts'],outfile:join(dir,'worker-before.js'),bundle:true,format:'esm',platform:'browser',plugins:[...((process.env.PROFILE_BEFORE_PROTOCOL||process.env.PROFILE_BEFORE_WIRE)?[{name:'before-codec',setup(b){b.onLoad({filter:/\/rust\/(protocol|wireCodec)\.ts$/},async({path})=>{const original=path.endsWith('/wireCodec.ts')?process.env.PROFILE_BEFORE_WIRE:process.env.PROFILE_BEFORE_PROTOCOL;return original?{contents:await readFile(original,'utf8'),loader:'ts',resolveDir:dirname(path)}:undefined;});}}]:[]),...plugins],logLevel:'silent',target:'es2022'});
 await cp(join(artifact,'generated/pivot_wasm_bg.wasm'),join(dir,'traced.wasm'));
 await cp(join(root,'src/lib/tableExecution/rust/generated/pivot_wasm_bg.wasm'),join(dir,'stock.wasm'));
 await cp(beforeDir?join(beforeDir,'pivot_wasm_bg.wasm'):join(root,'src/lib/tableExecution/rust/generated/pivot_wasm_bg.wasm'),join(dir,'before.wasm'));
 server=createServer(async(req,res)=>{const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';if(!['index.html','worker.js','worker-before.js','page.js','typescript.js','traced.wasm','stock.wasm','before.wasm'].includes(name)){res.writeHead(404).end();return;}try{res.setHeader('Content-Type',name.endsWith('.wasm')?'application/wasm':name.endsWith('.js')?'text/javascript':'text/html');res.end(name==='index.html'?'<script type="module" src="/page.js"></script>':await readFile(join(dir,name)));}catch{res.writeHead(500).end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browserEngine=process.env.PROFILE_BROWSER??'chromium';
 if(!['chromium','webkit'].includes(browserEngine))throw Error('Unsupported profiling browser');
 browser=await ({chromium,webkit}[browserEngine]).launch({headless:true});const page=await browser.newPage({locale:'en-US'});
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>!!globalThis.applyModelProfile);
 if(process.env.PROFILE_WORKLOAD){
  const toolPath=join(dir,'workload-tools.mjs');
  await build({stdin:{contents:`export {encodeWire,decodeWire} from ${JSON.stringify(join(root,'src/lib/tableExecution/rust/wireCodec.ts'))};`,resolveDir:root},bundle:true,platform:'node',format:'esm',outfile:toolPath,logLevel:'silent'});
  const tools=await import(pathToFileURL(toolPath).href),cases=await workloads(tools),selected=cases[process.env.PROFILE_WORKLOAD];
  assert(selected,'Unknown profiling workload');
  await page.evaluate(wire=>globalThis.applyModelProfile.setCase(wire),JSON.stringify(tools.encodeWire(selected)));
 }

 const modes=['typescript','stock','traced',...(beforeDir?['before']:[])];
 const report={workload:process.env.PROFILE_WORKLOAD??'fixed10k',browserEngine,trackedDiffSha256:createHash('sha256').update(execFileSync('git',['diff','--binary'],{cwd:root})).digest('hex'),protocolSha256:createHash('sha256').update(await readFile(join(root,'src/lib/tableExecution/rust/protocol.ts'))).digest('hex'),beforeProtocolSha256:process.env.PROFILE_BEFORE_PROTOCOL?createHash('sha256').update(await readFile(process.env.PROFILE_BEFORE_PROTOCOL)).digest('hex'):null,wireSha256:createHash('sha256').update(await readFile(join(root,'src/lib/tableExecution/rust/wireCodec.ts'))).digest('hex'),beforeWireSha256:process.env.PROFILE_BEFORE_WIRE?createHash('sha256').update(await readFile(process.env.PROFILE_BEFORE_WIRE)).digest('hex'):null,beforeArtifactDirectory:beforeDir,beforeWasmSha256:beforeDir?createHash('sha256').update(await readFile(join(beforeDir,'pivot_wasm_bg.wasm'))).digest('hex'):null,measuredAt:new Date().toISOString(),platform:{os:platform(),cpu:cpus()[0]?.model,node:process.version},browser:browser.version(),artifact:JSON.parse(await readFile(join(artifact,'build.json'),'utf8')),samples:20,warmups:3,method:'Fresh worker and registered dataset per trial. Initial grouped model applied before timing an edit. No UI paint or native HTTP. trace includes benchmark-only clock probes and payload. Round trip and worker duration use same-realm clock differences; their residual includes clone and scheduling. One-way transport is not reported because browser realm clock origins can differ below 1 ms. profile=off stock artifact is control. Execution paths, validation and result protocol are production modules bundled with benchmark-only hooks.',cases:[]};
 const normalize=x=>Array.isArray(x)?x.map(normalize):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).filter(([k])=>!['requestId','transferId'].includes(k)).map(([k,v])=>[k,normalize(v)])):x;
 const run=(action,mode,validate=false)=>page.evaluate(({action,mode,validate})=>globalThis.applyModelProfile.run(action,mode,validate),{action,mode,validate});
 for(const action of (process.env.PROFILE_ACTIONS??'baseline,search,sort,combined').split(',')){
  console.error(action+': parity');
  const expected=normalize((await run(action,'typescript',true)).snapshot);
  for(const mode of modes.filter(m=>m!=='typescript'))assert.deepEqual(normalize((await run(action,mode,true)).snapshot),expected,`${action} ${mode} parity`);
  const observations=Object.fromEntries(modes.map(m=>[m,[]]));
  for(let i=0;i<23;i++){
   const order=i%2?[...modes].reverse():modes;
   for(const mode of order){const value=await run(action,mode);if(i>=3){if(value.trace?.spans)value.trace.summary=summarizeSpans(value.trace.spans);observations[mode].push({iteration:i-3,...value});}}
  }
  report.cases.push({action,parity:'exact rows, totals, columns, metadata and full export against TypeScript; transport IDs excluded',observations});
  await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');console.error(action+': 20 samples complete');
 }
 console.log(output);
}finally{await browser?.close();await new Promise(r=>server?server.close(r):r());await rm(dir,{recursive:true,force:true});}
