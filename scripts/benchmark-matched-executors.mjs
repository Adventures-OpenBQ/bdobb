// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir,platform,release,arch,cpus,totalmem} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {chromium,webkit} from '@playwright/test';
import {workloads} from './matched-executors-workloads.mjs';
import {equivalent,summarize,engineOrder} from './matched-executors-utils.mjs';
import {normalizeSnapshots,driverPayload,deadline,isFatalMeasurementError,visitCasesUntilDeadline,waitForOwnedServer,assertOwnedServerAlive,finishCollection} from './matched-executors-driver-utils.mjs';
const root=resolve(new URL('..',import.meta.url).pathname),args=process.argv.slice(2);
const arg=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const samples=Number(arg('--samples','20')),warmups=3,timeoutMs=Number(arg('--timeout-ms','120000'));
if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>300000)throw Error('Timeout must be 1000–300000 ms');
if(!Number.isSafeInteger(samples)||samples<20||samples>100)throw Error('Samples must be 20–100');
const names=arg('--workloads','small,large,representative,largeRaw,wide,mixedOriginal,mixed,fiscal,formula').split(',');
const parityOnly=args.includes('--parity-only');
const browsers=arg('--browsers','chromium,webkit').split(',');
const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
const dir=await mkdtemp(join(tmpdir(),'matched-executors-'));let server;
try{
 const bundle=join(dir,'wire.mjs');await build({stdin:{contents:`export {decodeWire,encodeWire} from ${JSON.stringify(join(root,'src/lib/tableExecution/rust/wireCodec.ts'))};`,resolveDir:root},bundle:true,platform:'node',format:'esm',outfile:bundle,logLevel:'silent'});
 const tools=await import(pathToFileURL(bundle).href),cases=await workloads(tools),serverOwner=randomUUID();
 server=spawn(process.execPath,['scripts/pivot-browser-server.mjs'],{cwd:root,env:{...process.env,PIVOT_BENCHMARK_OWNER:serverOwner},stdio:['ignore','ignore','pipe']});server.errorOutput='';server.stderr.on('data',chunk=>{server.errorOutput=(server.errorOutput+chunk).slice(-4000);});
 server.on('error',error=>{server.failure=error;});
 await waitForOwnedServer(server,async()=>{const response=await fetch('http://127.0.0.1:4175/health',{signal:AbortSignal.timeout(2000)});return {ok:response.ok,owner:response.headers.get('X-Pivot-Benchmark-Owner')};},serverOwner);
 const report={schemaVersion:1,measuredAt:new Date().toISOString(),samples,warmups,parityOnly,observationDeadlineMs:timeoutMs,platform:{os:platform(),release:release(),arch:arch(),cpu:cpus()[0]?.model,logicalCpuCount:cpus().length,physicalMemoryBytes:totalmem(),node:process.version},toolchain:JSON.parse(await readFile(join(root,'scripts/pivot-toolchain.json'),'utf8')),source:{revision:spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim(),workingTreeChanges:spawnSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).stdout.trim().length>0,scriptSha256:await hash(new URL(import.meta.url)),harnessSha256:await hash(join(root,'e2e/fixtures/matched-executors.ts')),workloadsSha256:await hash(join(root,'scripts/matched-executors-workloads.mjs')),utilsSha256:await hash(join(root,'scripts/matched-executors-utils.mjs')),driverUtilsSha256:await hash(join(root,'scripts/matched-executors-driver-utils.mjs')),browserServerSha256:await hash(join(root,'scripts/pivot-browser-server.mjs'))},artifact:{wasmSha256:await hash(join(root,'src/lib/tableExecution/rust/generated/pivot_wasm_bg.wasm')),protocolVersion:1},method:{paths:'Production Vite builds; real createTableProvider TypeScript and Rust Web Workers. Common client validation, clone, worker transport, Rust wire conversions, Wasm startup and response publication included.',cache:'Fresh worker each observation; browser HTTP cache warmed by parity and 3 warmups. Not cold network.',order:'Sequential alternating engine order per paired iteration; no concurrent executor workloads. Driver transfers the exact tagged wire as one JSON string, parsed before the timed harness begins; pre-transfer JSON roundtrip is independently checked. This avoids driver serialization overhead, not executor work.',boundaries:'Factory, acquire including startup, initial apply, sequential first 100-row block then totals, total cold-load-ready; restore initial definition outside each warm pivot or sort/filter edit; edit apply and block/totals-ready; full pulled export from restored initial definition.',parity:'Preflight only, outside observations (not parity for every timed trial): each action and full export against independent calculateView baseline and cross-engine view/block/export metadata. Only requestId and transferId transport identifiers excluded. Exact structural keys, row IDs/order, values/errors/formats, columns, totals and export metadata; 1e-12 relative/absolute numeric tolerance for explicit output column IDs whose published aggregation is mean or whose aggregate formula AST is division, at row/totals values locations only; Anchored baseline and action-specific snapshot row/totals value roots only; source fields, nested user objects, metadata, errors, formats and signed zero remain exact.',statistics:'Median (average central pair), nearest-rank p95; individual observations in chronological engine order. Warmups discarded.',uiPaint:'Not measured: no shared renderer harness. Separate future UI/device acceptance gate.',memory:'Not measured: browser worker allocator/process peaks unavailable; 20k representative desktop workload is not an iPad limit.',activation:'TypeScript remains default; desktop evidence only; regular iPad/device acceptance outstanding.',serverOwnership:'Random token health header must match the spawned live child; child liveness checked before page and each observation. Fatal deadlines close the browser context and stop all remaining cases in that browser.',knownMixedInstability:'Both mixedOriginal12 and scaled mixed1000 are blocked from comparative timings, even if current preflight passes. Diagnostic evidence: mixed-parity-diagnostic.json.'},browsers:{}};
 for(const browserName of browsers){const engine={chromium,webkit}[browserName];if(!engine)throw Error('Unknown browser');try{assertOwnedServerAlive(server);}catch(error){report.aborted={code:error.code,error:error.message};break;}const browser=await engine.launch({headless:true});try{
  const context=await browser.newContext({locale:'en-US'}),page=await context.newPage();assertOwnedServerAlive(server);await page.goto('http://127.0.0.1:4175/built/');await page.waitForFunction(()=>!!globalThis.matchedExecutorHarness);
  const result={browserVersion:browser.version(),userAgent:await page.evaluate(()=>navigator.userAgent),locale:await page.evaluate(()=>new Intl.Collator().resolvedOptions().locale),cases:[]};report.browsers[browserName]=result;
  const boundary=await visitCasesUntilDeadline(names,async name=>{const c=cases[name];if(!c)throw Error(`Unknown case ${name}`);const wire=tools.encodeWire(c),wireJson=driverPayload(wire);
   equivalent(JSON.parse(wireJson),wire,`${name}.driverWireRoundTrip`);
   const run=(engine,validate)=>{assertOwnedServerAlive(server);return deadline(page.evaluate(({wireJson,engine,validate})=>{const wire=JSON.parse(wireJson);return globalThis.matchedExecutorHarness.run(wire,engine,validate);},{wireJson,engine,validate}),timeoutMs).catch(error=>{if(isFatalMeasurementError(error))throw error;throw Error(`${browserName} ${name} ${engine}: ${error.message}`,{cause:error});});};
   let stage='parity';
   try{
   process.stderr.write(`${browserName} ${name}: parity\n`);
   const ts=await run('typescript',true),rust=await run('rust',true);

   const expectedSnapshots=tools.decodeWire(ts.snapshots);
   equivalent(normalizeSnapshots(tools.decodeWire(rust.snapshots)),normalizeSnapshots(expectedSnapshots),`${name}.crossEngine`,new Map(expectedSnapshots.map((s,index)=>[index,new Set(s.toleratedColumns)])),'snapshots');
   if(name==='mixed'||name==='mixedOriginal'){result.cases.push({name,inputRows:c.dataset.rows.length,inputColumns:c.dataset.columns.length,workloadSha256:createHash('sha256').update(wireJson).digest('hex'),status:'blocked',parity:'current preflight passed; known Chromium instability prevents comparison',timingsExcluded:true,reason:'Original and scaled typed-blanks ordering differed in Chromium between independent baseline and real TypeScript/Rust execution paths across reproductions. No deterministic oracle; see mixed-parity-diagnostic.json.'});process.stderr.write(`${browserName} ${name}: known instability; timings BLOCKED\n`);return;}
   stage='timing';
   const observations={typescript:[],rust:[]};
   for(let i=0;i<(parityOnly?0:warmups+samples);i++)for(const engine of engineOrder(i)){const observation=await run(engine,false);if(i>=warmups)observations[engine].push({iteration:i-warmups,engineOrder:engineOrder(i),...observation});}
   result.cases.push({name,driverWireRoundTrip:'exact tagged wire after JSON string transfer and parse before harness timer',workloadSha256:createHash('sha256').update(JSON.stringify(wire)).digest('hex'),inputRows:c.dataset.rows.length,inputColumns:c.dataset.columns.length,parity:'passed before timing',engines:Object.fromEntries(Object.entries(observations).map(([engine,values])=>[engine,{observations:values,timingsMs:Object.fromEntries(Object.keys(values[0]?.timings??{}).map(key=>[key,summarize(values.map(v=>v.timings[key]))]))}]))});
   process.stderr.write(`${browserName} ${name}: ${parityOnly?'parity only':samples+' matched samples'} complete\n`);
   }catch(error){result.cases.push({name,inputRows:c.dataset.rows.length,inputColumns:c.dataset.columns.length,workloadSha256:createHash('sha256').update(wireJson).digest('hex'),stage,status:'failed',parity:stage==='parity'?'failed':'passed',timingsExcluded:true,error:error.message});process.stderr.write(`${browserName} ${name}: ${stage} FAILED; timings excluded: ${error.message}\n`);if(isFatalMeasurementError(error))throw error;}
  },()=>context.close());
  if(boundary.aborted){result.aborted={code:boundary.error.code,error:boundary.error.message};for(const name of boundary.remaining)result.cases.push({name,status:'blocked',parity:'not run',timingsExcluded:true,reason:'Browser context closed after fatal observation; remaining cases not measured'});}
  if(boundary.aborted&&boundary.error.code==='SERVER_EXITED'){report.aborted={code:boundary.error.code,error:boundary.error.message};break;}
 }finally{await browser.close();}}
 process.exitCode=finishCollection(report,browsers,names);
 report.completedAt=new Date().toISOString();report.durationMs=Date.parse(report.completedAt)-Date.parse(report.measuredAt);
 const output=resolve(arg('--output',join(root,'docs/releases/validation/rust-pivot/matched-executors.json')));await writeFile(output,JSON.stringify(report,null,2)+'\n');process.stdout.write(`Saved ${output}\n`);
}finally{server?.kill('SIGTERM');await rm(dir,{recursive:true,force:true});}
