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
const root=resolve(new URL('../..',import.meta.url).pathname),dir=await mkdtemp(join(tmpdir(),'indexed-browser-')),output=resolve(process.argv[2]??'/tmp/openbq-indexed-browser.json');
let server,browser;
try{
 await build({absWorkingDir:root,entryPoints:['src/lib/tableExecution/table.worker.ts'],outfile:join(dir,'worker.js'),bundle:true,format:'esm',platform:'browser',logLevel:'silent'});
 await build({absWorkingDir:root,entryPoints:['scripts/sort-reuse-benchmark/page.mjs'],outfile:join(dir,'page.js'),bundle:true,format:'esm',platform:'browser',logLevel:'silent'});
 await build({stdin:{contents:`export {encodeWire,decodeWire} from ${JSON.stringify(join(root,'src/lib/tableExecution/rust/wireCodec.ts'))};`,resolveDir:root},outfile:join(dir,'tools.mjs'),bundle:true,format:'esm',platform:'node',logLevel:'silent'});
 const tools=await import(pathToFileURL(join(dir,'tools.mjs')).href),cases=await workloads(tools);
 if(process.env.SORT_REUSE_CARDINALITY)for(const count of [500,2000]){
  const c=structuredClone(cases.formula),m=c.definition.analytical;
  m.formulas=m.formulas.filter(f=>f.id==='ratio0');m.layout.values=['ratio0'];
  const category=m.categories.find(c=>c.id===m.layout.rows[0]);
  assert(category?.sourceFieldId,'Cardinality fixture needs a source category');
  c.dataset.rows=Array.from({length:count},(_,i)=>{const row=structuredClone(cases.formula.dataset.rows[i%cases.formula.dataset.rows.length]);row.id=`cardinality-${i}`;row.values[category.sourceFieldId]=`group-${i}`;return row;});
  cases[`groups${count}`]=c;
 }
 server=createServer(async(req,res)=>{const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';if(!['index.html','worker.js','page.js'].includes(name)){res.writeHead(404).end();return;}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':'text/html');res.end(name==='index.html'?'<script type="module" src="/page.js"></script>':await readFile(join(dir,name)));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const normalize=value=>Array.isArray(value)?value.map(normalize):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!['requestId','transferId'].includes(key)).map(([key,v])=>[key,normalize(v)])):value;
 const report={cardinality:!!process.env.SORT_REUSE_CARDINALITY,method:'Actual native TypeScript worker, untransformed implementation bundle; opt-in uses Worker.name. No private audit hooks. Baseline uses full calculation; indexed capture occurs during ordinary initial calculation. Fresh worker per trial, cold initial apply outside warm-sort timer. 3 warmups/20 alternating observations per mode, real client/worker messages and validation included. No UI paint or native HTTP. Explicit512MiB structural admission ceiling, not measured RAM or a default. Public parity omits transport request/transfer IDs only.',platform:{node:process.version,os:platform(),cpu:cpus()[0]?.model},samples:process.env.INDEXED_PARITY_ONLY?0:20,warmups:process.env.INDEXED_PARITY_ONLY?0:3,browsers:[]};
 for(const [name,engine]of Object.entries({chromium,webkit}).filter(([name])=>!process.env.INDEXED_BROWSER||process.env.INDEXED_BROWSER===name)){
  browser=await engine.launch({headless:true});const context=await browser.newContext({locale:'en-US'}),page=await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>!!globalThis.indexedBrowser);
  const result={name,version:browser.version(),cases:[],lifecycle:[]};
  const run=(mode,wire,options)=>page.evaluate(({mode,wire,options})=>globalThis.indexedBrowser.run(mode,wire,options),{mode,wire,options});
  for(const caseName of process.env.SORT_REUSE_CARDINALITY?['groups500','groups2000']:['formula','fiscal']){
   const wire=JSON.stringify(tools.encodeWire(cases[caseName]));console.error(name+' '+caseName+': parity');
   const full=await run('full',wire,{validate:true}),indexed=await run('indexed',wire,{validate:true});
   if(process.env.SORT_REUSE_CARDINALITY){assert.equal(full.initialSnapshot.ready.topLevelCount,Number(caseName.slice(6)));assert.equal(full.initialSnapshot.ready.completeness.kind,'complete');}
   assert.deepEqual(normalize(indexed.initialSnapshot),normalize(full.initialSnapshot));assert.deepEqual(normalize(indexed.snapshot),normalize(full.snapshot));
   const observations={full:[],indexed:[]};
   if(!process.env.INDEXED_PARITY_ONLY)for(let i=-3;i<20;i++)for(const mode of i%2?['full','indexed']:['indexed','full']){
    const value=await run(mode,wire,{desc:!!(i%2)});if(i>=0)observations[mode].push(value);
   }
   result.cases.push({name:caseName,topLevelCount:full.initialSnapshot.ready.topLevelCount,parity:'initial and warm ready/inspection, recursive rows, totals, charts, facets, inspection pages and complete exports',observations});console.error(name+' '+caseName+': done');
  }
  const wire=JSON.stringify(tools.encodeWire(cases.formula));
  for(const options of [{budget:0},{budget:1},{budget:16777216},...['runtime','model','source','selection','freshness','unsupported'].map(scenario=>({scenario}))]){
   const full=await run('full',wire,{...options,validate:true}),indexed=await run('indexed',wire,{...options,validate:true});
   for(const key of ['initialSnapshot','snapshot','follow'])assert.deepEqual(normalize(indexed[key]),normalize(full[key]),name+' '+JSON.stringify(options)+' '+key);
   result.lifecycle.push({options,parity:true});
  }
  report.browsers.push(result);await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');await browser.close();browser=undefined;console.error(name+': complete');
 }
 report.publicParity=true;report.workerBundleSha256=createHash('sha256').update(await readFile(join(dir,'worker.js'))).digest('hex');await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(output);
}finally{await browser?.close();if(server)await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
