// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import v8 from 'node:v8';
import {build} from 'esbuild';
import {hashJSON,validateRun,summarizeRun} from './report.mjs';
import {runChild,childObservations} from './child-process.mjs';
import {validateTickReferencePolicy} from './ticks.mjs';
export const ADMISSION_PROFILE=Object.freeze({maxRows:300000,maxInputBytes:268435456,maxStateBytes:2147483648,maxPivotColumns:10000,maxBatchBytes:33554432,maxCachedBlockBytes:67108864,maxConcurrentTransfers:2});
export const ACTIONS=Object.freeze([{kind:'apply'},{kind:'presented'},{kind:'chartData'},{kind:'empty-clear',cycles:5}]);
export function validateActions(actions){assert.deepEqual(actions,ACTIONS,'Unsupported action contract');}
export function admit(w,bytes){
 if(w.rows>ADMISSION_PROFILE.maxRows)return {outcome:'profile-refused',reason:'Rows exceed fixed experimental runner ceiling'};
 // Refuse unbounded parser expansion before parsing. This is deliberately conservative,
 // distinct from the exact host-graph reservation enforced after parsing.
 if(bytes*128>ADMISSION_PROFILE.maxInputBytes)return {outcome:'profile-refused',reason:'Conservative pre-parse reservation (128 x file bytes) exceeds fixed input ceiling'};
 if(!['certified-json','csv','ticks-csv'].includes(w.format))return {outcome:'adapter-unavailable',reason:'No bounded adapter for this format'};
 return null;
}
export async function checksumFile(path){const hash=createHash('sha256');for await(const b of createReadStream(path))hash.update(b);return hash.digest('hex');}
async function checked(base,entry){assert.match(entry?.sha256??'',/^[a-f0-9]{64}$/);const path=resolve(base,entry.path);assert.equal(await checksumFile(path),entry.sha256,'File checksum mismatch');return path;}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
/** Reusable by profiling orchestration; clean artifacts and public checks remain separate from probe timings. */
export async function runBenchmark(manifest,{engine,workload,output,manifestDirectory=process.cwd(),samples=5,timeoutMs=60000}={}){
 assert.ok(['typescript','rust'].includes(engine));assert.ok(['bulk','statement','ticks'].includes(workload));
 assert.ok(Number.isInteger(samples)&&samples>=1&&samples<=5);assert.ok(timeoutMs>0&&timeoutMs<=60000);
 assert.equal(process.env.NODE_OPTIONS??'','','Run with default Node heap, without NODE_OPTIONS');
 assert.ok(!process.execArgv.some(arg=>/max[-_]old[-_]space|max[-_]semi[-_]space/.test(arg)),'Do not override the default Node heap');
 assert.equal(manifest.version,1);assert.equal(manifest.kind,workload);
 const paths={};for(const k of ['input','reference','model','actions'])paths[k]=await checked(manifestDirectory,manifest[k]);
 validateActions(JSON.parse(await readFile(paths.actions,'utf8')));
 if(workload==='ticks')validateTickReferencePolicy(manifest.reference.policy);
 const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 // Hash every tracked source byte plus new runner files, not timestamps or commit alone.
 const names=execFileSync('git',['ls-files','src','crates','scripts/pivot-qualification'],{cwd:root,encoding:'utf8'}).trim().split('\n');
 for(const n of ['benchmark.mjs','benchmark-worker.ts','report.mjs','ticks.mjs','child-process.mjs'])names.push(`scripts/pivot-qualification/${n}`);
 const source=hashJSON(await Promise.all([...new Set(names)].sort().map(async n=>[n,await checksumFile(join(root,n))])));
 await mkdir(output,{recursive:true});
 const bundle=join(resolve(output),`runner-${source}.mjs`);
 await build({entryPoints:[join(root,'scripts/pivot-qualification/benchmark-worker.ts')],outfile:bundle,bundle:true,platform:'node',format:'esm',logLevel:'silent',loader:{'.wasm':'file'},define:{'import.meta.env.DEV':'false'},external:['../../src/lib/tableExecution/rust/generated/pivot_wasm']});
 const wasmPath=join(resolve(output),'pivot_wasm_bg.wasm');
 const modulePath=join(resolve(output),'pivot_wasm.mjs');
 await writeFile(wasmPath,await readFile(join(root,'src/lib/tableExecution/rust/generated/pivot_wasm_bg.wasm')));
 await writeFile(modulePath,await readFile(join(root,'src/lib/tableExecution/rust/generated/pivot_wasm.js')));
 const artifact=hashJSON({bundle:await checksumFile(bundle),wasm:await checksumFile(wasmPath),module:await checksumFile(modulePath)});
 const environment={node:process.version,platform:process.platform,release:os.release(),arch:os.arch(),cpu:os.cpus()[0]?.model,cpuCount:os.cpus().length,memoryBytes:os.totalmem(),locale:Intl.DateTimeFormat().resolvedOptions(),defaultNodeHeapBytes:v8.getHeapStatistics().heap_size_limit,execArgv:process.execArgv};
 const identity={commit,source,artifact,dataset:manifest.input.sha256,reference:manifest.reference.sha256,model:manifest.model.sha256,actions:manifest.actions.sha256,environment:hashJSON(environment),...(workload==='ticks'?{referencePolicy:hashJSON({sourceChecksum:manifest.reference.sha256,policy:manifest.reference.policy})}:{})};
 const refusal=admit(manifest,(await stat(paths.input)).size),observations=[];
 observationLoop: for(let i=0;i<(refusal?1:samples);i++){
  for(const variant of ['baseline','candidate']){
   const result=refusal??await runChild(bundle,
    {paths,engine,limits:ADMISSION_PROFILE,manifest,wasmPath,modulePath},
    {timeoutMs,journalPath:join(output,`${manifest.id}-${engine}-${variant}-${i}.jsonl`),identity:{...identity,variant,index:i}});
   observations.push(...childObservations(result,variant,i));
   if(result.outcome&&!refusal)break observationLoop;
  }
 }
 const report={schemaVersion:1,engine,identity,environment,workload:{id:manifest.id,kind:workload,rows:manifest.rows,sampling:manifest.sampling,classification:manifest.classification,...(workload==='ticks'?{referencePolicy:manifest.reference.policy}:{})},limits:{policy:'fixed-experimental-runner-not-supported-device-default',...ADMISSION_PROFILE,preparseReservation:'128 times file bytes; conservative runner heuristic, not engine RESOURCE_LIMIT',enforcement:engine==='rust'?'runner preflight and production Rust worker/runtime':'runner preflight; TS worker has no matching engine resource profile',timeoutMs},status:observations.every(o=>o.status==='passed')?'passed':observations.some(o=>o.status==='failed')?'failed':'not-run',observations,limitations:['Same-source baseline/candidate calibration; no optimization or speedup claim.','In-process production worker handler transport in fresh Node subprocess, not browser/native acceptance.','RSS is process resourceUsage high-water mark, not sampled process-tree RSS.','Rendering, usable view and browser input responsiveness not run.','WASM exported buffer may be unavailable; null is not zero.','No representative-hash sample or synthetic financial corpus is implied by prefix/control runs.']};
 validateRun(report);report.summary=summarizeRun(report);await writeFile(join(output,`${manifest.id}-${engine}.json`),JSON.stringify(report,null,2)+'\n');return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=Object.fromEntries(Array.from({length:(process.argv.length-2)/2},(_,i)=>[process.argv[2+i*2].replace(/^--/,''),process.argv[3+i*2]]));
 const manifest=JSON.parse(await readFile(args.manifest,'utf8'));
 const r=await runBenchmark(manifest,{...args,manifestDirectory:dirname(resolve(args.manifest))});console.log(JSON.stringify({status:r.status,observations:r.observations.length,identity:r.identity}));if(r.status==='failed')process.exitCode=1;
}
