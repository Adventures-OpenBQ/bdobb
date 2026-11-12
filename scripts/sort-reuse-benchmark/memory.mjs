// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {build} from 'esbuild';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {workloads} from '../matched-executors-workloads.mjs';
const root=resolve(new URL('../..',import.meta.url).pathname),dir=await mkdtemp(join(tmpdir(),'sort-memory-'));
let browser,server;
try{
 for(const [entry,out]of [['src/lib/tableExecution/table.worker.ts','worker.js'],['scripts/sort-reuse-benchmark/memory-page.mjs','page.js']])await build({absWorkingDir:root,entryPoints:[entry],outfile:join(dir,out),bundle:true,format:'esm',platform:'browser',logLevel:'silent'});
 await build({stdin:{contents:`export {encodeWire,decodeWire} from ${JSON.stringify(join(root,'src/lib/tableExecution/rust/wireCodec.ts'))};`,resolveDir:root},outfile:join(dir,'tools.mjs'),bundle:true,format:'esm',platform:'node',logLevel:'silent'});
 const tools=await import(pathToFileURL(join(dir,'tools.mjs')).href),cases=await workloads(tools);
 server=createServer(async(req,res)=>{const file=new URL(req.url,'http://localhost').pathname.slice(1);if(!['','worker.js','page.js'].includes(file)){res.writeHead(404).end();return;}res.setHeader('Content-Type',file?'text/javascript':'text/html');res.end(file?await readFile(join(dir,file)):'<script type="module" src="/page.js"></script>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 browser=await chromium.launch({headless:true});
 const cdp=await browser.newBrowserCDPSession();
 let counter=0;
 async function command(sessionId,method){
  const id=++counter;
  return new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>{cdp.off('Target.receivedMessageFromTarget',listener);reject(Error('CDP timeout: '+method));},10000);
   const listener=event=>{if(event.sessionId!==sessionId)return;const message=JSON.parse(event.message);if(message.id!==id)return;clearTimeout(timeout);cdp.off('Target.receivedMessageFromTarget',listener);if(message.error)reject(Error(JSON.stringify(message.error)));else resolve(message.result);};
   cdp.on('Target.receivedMessageFromTarget',listener);
   cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method})}).catch(error=>{clearTimeout(timeout);cdp.off('Target.receivedMessageFromTarget',listener);reject(error);});
  });
 }
 const report={method:'Actual untransformed Chromium worker. HeapProfiler.collectGarbage then Runtime.getHeapUsage at each checkpoint. Measures retained V8 heap, not peak allocation, process RSS or device memory. Five fresh-worker trials per mode/workload, alternating mode order. Explicit 512MiB structural opt-in threshold.',browser:browser.version(),workerBundleSha256:createHash('sha256').update(await readFile(join(dir,'worker.js'))).digest('hex'),trials:[]};
 for(const name of ['formula','fiscal'])for(let trial=0;trial<5;trial++)for(const mode of trial%2?['indexed','full']:['full','indexed']){
  const context=await browser.newContext(),page=await context.newPage();
  try{
   await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>!!globalThis.sortMemory);
   await page.evaluate(({mode,wire})=>globalThis.sortMemory.open(mode,wire),{mode,wire:JSON.stringify(tools.encodeWire(cases[name]))});
   const {targetInfos}=await cdp.send('Target.getTargets'),workers=targetInfos.filter(t=>t.type==='worker'&&t.url===`http://127.0.0.1:${server.address().port}/worker.js`);assert.equal(workers.length,1);
   const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:workers[0].targetId,flatten:false});
   const sample=async()=>{await command(sessionId,'HeapProfiler.collectGarbage');return command(sessionId,'Runtime.getHeapUsage');};
   const initial=await sample();await page.evaluate(()=>globalThis.sortMemory.sort(1));const afterOne=await sample();
   await page.evaluate(()=>globalThis.sortMemory.sort(24));const after25=await sample();
   await page.evaluate(()=>globalThis.sortMemory.sort(75));const after100=await sample();
   await page.evaluate(()=>globalThis.sortMemory.clear());const disposed=await sample();
   await cdp.send('Target.detachFromTarget',{sessionId});await page.evaluate(()=>globalThis.sortMemory.close());
   report.trials.push({name,trial,mode,initial,afterOne,after25,after100,disposed});console.error(name+' '+trial+' '+mode+' complete');
  }finally{await context.close();}
 }
 const output=resolve(process.argv[2]??'/tmp/openbq-sort-memory.json');await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(output);
}finally{await browser?.close();if(server)await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
