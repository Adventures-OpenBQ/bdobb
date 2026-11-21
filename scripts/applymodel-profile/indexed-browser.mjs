// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {build} from 'esbuild';
import {readFile,writeFile,mkdtemp,rm,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir,cpus,platform} from 'node:os';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {chromium,webkit} from '@playwright/test';
import {workloads} from '../matched-executors-workloads.mjs';
import {indexedBrowserPlugin} from './indexed-browser-plugin.mjs';
const root=resolve(new URL('../..',import.meta.url).pathname),dir=await mkdtemp(join(tmpdir(),'indexed-browser-')),output=resolve(process.argv[2]??'/tmp/openbq-indexed-browser.json');
let server,browser;
try{
 await build({absWorkingDir:root,entryPoints:['scripts/applymodel-profile/indexed-browser-worker.ts'],outfile:join(dir,'worker.js'),bundle:true,format:'esm',platform:'browser',plugins:[indexedBrowserPlugin(root)],logLevel:'silent'});
 await build({absWorkingDir:root,entryPoints:['src/lib/tableExecution/table.worker.ts'],outfile:join(dir,'stock-worker.js'),bundle:true,format:'esm',platform:'browser',logLevel:'silent'});
 await build({absWorkingDir:root,entryPoints:['scripts/applymodel-profile/indexed-browser-page.ts'],outfile:join(dir,'page.js'),bundle:true,format:'esm',platform:'browser',logLevel:'silent'});
 await build({stdin:{contents:`export {encodeWire,decodeWire} from ${JSON.stringify(join(root,'src/lib/tableExecution/rust/wireCodec.ts'))};`,resolveDir:root},outfile:join(dir,'tools.mjs'),bundle:true,format:'esm',platform:'node',logLevel:'silent'});
 const tools=await import(pathToFileURL(join(dir,'tools.mjs')).href),cases=await workloads(tools);
 server=createServer(async(req,res)=>{const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';if(!['index.html','worker.js','stock-worker.js','page.js'].includes(name)){res.writeHead(404).end();return;}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':'text/html');res.end(name==='index.html'?'<script type="module" src="/page.js"></script>':await readFile(join(dir,name)));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const normalize=value=>Array.isArray(value)?value.map(normalize):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!['requestId','transferId'].includes(key)).map(([key,v])=>[key,normalize(v)])):value;
 const report={method:'Experimental native TypeScript worker with browser-compatible audit hooks. Baseline uses full calculation; indexed capture occurs during ordinary initial calculation. Fresh worker per trial, cold initial apply outside warm-sort timer. 3 warmups/20 alternating observations per mode, real client/worker messages and validation included. No UI paint or native HTTP. Explicit512MiB structural admission ceiling, not measured RAM or a default. Public parity omits transport request/transfer IDs only.',platform:{node:process.version,os:platform(),cpu:cpus()[0]?.model},samples:20,warmups:3,browsers:[]};
 for(const [name,engine]of Object.entries({chromium,webkit}).filter(([name])=>!process.env.INDEXED_BROWSER||process.env.INDEXED_BROWSER===name)){
  browser=await engine.launch({headless:true});const context=await browser.newContext({locale:'en-US'}),page=await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>!!globalThis.indexedBrowser);
  const result={name,version:browser.version(),cases:[],lifecycle:[]};
  const run=(mode,wire,options)=>page.evaluate(({mode,wire,options})=>globalThis.indexedBrowser.run(mode,wire,options),{mode,wire,options});
  for(const caseName of ['formula','fiscal']){
   const wire=JSON.stringify(tools.encodeWire(cases[caseName]));console.error(name+' '+caseName+': parity');
   const full=await run('full',wire,{validate:true}),indexed=await run('indexed',wire,{validate:true}),stock=await run('stock',wire,{validate:true});
   for(const key of ['initialSnapshot','snapshot'])assert.deepEqual(normalize(full[key]),normalize(stock[key]),'stock parity '+name+' '+caseName+' '+key);
   assert.deepEqual(normalize(indexed.initialSnapshot),normalize(full.initialSnapshot));assert.deepEqual(normalize(indexed.snapshot),normalize(full.snapshot));
   assert.equal(indexed.warmAudit.hit,true,JSON.stringify(indexed.warmAudit));assert.equal(indexed.warmAudit.calculations,0);assert(full.warmAudit.calculations>=1);
   const observations={full:[],indexed:[]};
   if(!process.env.INDEXED_PARITY_ONLY)for(let i=-3;i<20;i++)for(const mode of i%2?['full','indexed']:['indexed','full']){
    const value=await run(mode,wire,{desc:!!(i%2)});if(mode==='indexed'){assert(value.warmAudit.hit);assert.equal(value.warmAudit.calculations,0);}if(i>=0)observations[mode].push(value);
   }
   result.cases.push({name:caseName,parity:'initial and warm ready/inspection, recursive rows, totals, charts, facets, inspection pages and complete exports',observations});console.error(name+' '+caseName+': done');
  }
  const wire=JSON.stringify(tools.encodeWire(cases.formula));
  for(const options of [{budget:0},{budget:1},{budget:16777216},...['runtime','model','source','selection','freshness','unsupported'].map(scenario=>({scenario}))]){
   const full=await run('full',wire,{...options,validate:true}),indexed=await run('indexed',wire,{...options,validate:true}),stock=await run('stock',wire,{...options,validate:true});
   for(const key of ['initialSnapshot','snapshot','follow'])assert.deepEqual(normalize(full[key]),normalize(stock[key]),'stock lifecycle '+name+' '+JSON.stringify(options));
   for(const key of ['initialSnapshot','snapshot','follow'])assert.deepEqual(normalize(indexed[key]),normalize(full[key]),name+' '+JSON.stringify(options)+' '+key);
   const expectHit=['selection','freshness'].includes(options.scenario);assert.equal(indexed.warmAudit.hit,expectHit,JSON.stringify({options,audit:indexed.warmAudit}));
   if(['runtime','model','source'].includes(options.scenario))assert.equal(indexed.audits.at(-1).hit,true);
   result.lifecycle.push({options,audits:indexed.audits,parity:true});
  }
  report.browsers.push(result);await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');await browser.close();browser=undefined;console.error(name+': complete');
 }
 report.stockParity=true;report.stockWorkerBundleSha256=createHash('sha256').update(await readFile(join(dir,'stock-worker.js'))).digest('hex');report.workerBundleSha256=createHash('sha256').update(await readFile(join(dir,'worker.js'))).digest('hex');await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(output);
}finally{await browser?.close();if(server)await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
