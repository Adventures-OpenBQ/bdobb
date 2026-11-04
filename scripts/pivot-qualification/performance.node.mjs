// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';

test('performance action contract pins model transitions and rejects unknown actions',async()=>{
 const {performanceActions,validatePerformanceActions}=await import('./run-performance-matrix.mjs');
 const actions=performanceActions('ticks');
 assert.deepEqual(actions.filter(a=>a.kind==='apply').map(a=>[a.granularity,a.venue]),[['1s','Q'],['1m','Q'],['1s','Q'],['1s','24EQ'],['1s','Q'],['1s','Q']]);
 validatePerformanceActions({version:'performance-trace/1',actions},'ticks');
 assert.throws(()=>validatePerformanceActions([...actions,{kind:'surprise'}],'ticks'));
 assert.throws(()=>validatePerformanceActions(actions.slice(0,-1),'ticks'));
});
test('tree RSS sums unique child PIDs only, excluding parent and unrelated tasks',async()=>{
 const {processTreeSnapshot}=await import('./run-performance-matrix.mjs');
 const s=processTreeSnapshot('10 1 200\n20 10 100\n21 20 50\n21 20 50\n22 1 900\n',20);
 assert.equal(s.treeRssBytes,150*1024);
 assert.deepEqual(s.processes.map(p=>p.pid),[20,21]);
 assert.throws(()=>processTreeSnapshot('20 10 100\n20 10 101\n',20));
});

test('actual bounded worker keeps transitions in one session and validates every result',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {runBenchmark,checksumFile}=await import('./benchmark.mjs');
 const {performanceActions}=await import('./run-performance-matrix.mjs');
 const {tickModel,TICK_REFERENCE_POLICY}=await import('./ticks.mjs');
 const dir=await mkdtemp(join(tmpdir(),'p3-real-worker-'));
 try{
 const files={input:'ts,seq,mkt,price,shares\n1000,1,Q,10,2\n2000,2,24EQ,50,3\n3000,3,Q,20,4\n',reference:JSON.stringify([
  {bucketMilliseconds:1000,bucket:1,venue:'Q',open:10,high:10,low:10,close:10,volume:2,ticks:1},
  {bucketMilliseconds:1000,bucket:3,venue:'Q',open:20,high:20,low:20,close:20,volume:4,ticks:1},
  {bucketMilliseconds:60000,bucket:0,venue:'Q',open:10,high:20,low:10,close:20,volume:6,ticks:2},
  {bucketMilliseconds:1000,bucket:2,venue:'24EQ',open:50,high:50,low:50,close:50,volume:3,ticks:1},
 ]),model:JSON.stringify(tickModel({granularity:'1s',venue:'Q'})),actions:JSON.stringify({version:'performance-trace/1',actions:performanceActions('ticks')})};
 const manifest={version:1,id:'synthetic-control',kind:'ticks',format:'ticks-csv',rows:3,classification:'synthetic',sampling:'complete-control',tick:{granularity:'1s',venue:'Q'},reference:{}};
 for(const [key,value] of Object.entries(files)){await writeFile(join(dir,key),value);manifest[key]={path:key,sha256:await checksumFile(join(dir,key))};}
 manifest.reference.policy=TICK_REFERENCE_POLICY;manifest.reference.independent=true;
 const report=await runBenchmark(manifest,{engine:'typescript',workload:'ticks',output:join(dir,'run'),manifestDirectory:dir,samples:1,performance:{sampleIntervalMs:100,artifactDirectory:process.env.PIVOT_PROFILE_CLEAN_DIR}});
 assert.equal(report.status,'passed');
 const {validateRun}=await import('./report.mjs');
 const missing=structuredClone(report);delete missing.observations[0].sessions;assert.throws(()=>validateRun(missing));
 const wrong=structuredClone(report);wrong.observations[1].sessions[0].id='wrong';assert.throws(()=>validateRun(wrong));
 const [cold,warm]=report.observations;
 assert.equal(cold.sessions[0].id,warm.sessions[0].id);
 assert.equal(cold.process.id,warm.process.id);
 assert.deepEqual(warm.trace.filter(t=>t.action.kind==='apply').map(t=>[t.action.granularity,t.action.venue]),[['1m','Q'],['1s','Q'],['1s','24EQ'],['1s','Q'],['1s','Q']]);
 assert.ok(warm.trace.every(t=>t.numericalCheck==='passed'));
 assert.equal(warm.responsiveness.status,'measured');
 assert.ok(warm.responsiveness.samples.every(s=>Number.isFinite(s.blockedMs)&&s.blockedMs>=0));
 assert.ok(warm.trace.at(-1).revision.model>cold.trace.at(-1).revision.model);
 assert.notEqual(report.observations[2].process.id,cold.process.id);
 if(process.env.PIVOT_PROFILE_DIR){
  const profiled=await runBenchmark(manifest,{engine:'typescript',workload:'ticks',output:join(dir,'profile'),manifestDirectory:dir,samples:1,performance:{sampleIntervalMs:100,artifactDirectory:process.env.PIVOT_PROFILE_DIR}});
  assert.equal(profiled.status,'passed',JSON.stringify(profiled.observations.filter(o=>o.status!=='passed')));assert.equal(profiled.performance.instrumented,true);
  for(let i=0;i<report.observations.length;i++){
   assert.deepEqual(profiled.observations[i].trace.map(t=>[t.action,t.modelChecksum,t.resultChecksum,t.consumers]),report.observations[i].trace.map(t=>[t.action,t.modelChecksum,t.resultChecksum,t.consumers]));
   assert.ok(profiled.observations[i].trace.some(t=>t.probe?.events.length>0));
  }
 }
 const {runPerformanceMatrix}=await import('./run-performance-matrix.mjs');
 const refused={...manifest,id:'over-ceiling',rows:300001};await writeFile(join(dir,'refused.json'),JSON.stringify(refused));
 const matrix={version:1,batches:2,samples:5,sampleIntervalMs:100,backgroundWork:'test control',cases:[{path:'refused.json',sha256:await checksumFile(join(dir,'refused.json'))}]};
 const index=await runPerformanceMatrix(matrix,{engine:'typescript',output:join(dir,'matrix'),manifestDirectory:dir});
 assert.equal(index.records.length,2);assert.equal(index.records[0].status,'not-run');assert.equal(index.records[1].qualification.sha256,index.records[0].qualification.sha256);assert.match(index.records[1].reason,/no repeated/);
 const matrixPath=join(dir,'matrix.json');await writeFile(matrixPath,JSON.stringify(matrix));
 const {promisify}=await import('node:util');const {execFile}=await import('node:child_process');const {fileURLToPath}=await import('node:url');
 const cliOutput=join(dir,'cli-matrix');
 const cli=await promisify(execFile)(process.execPath,[fileURLToPath(new URL('./run-performance-matrix.mjs',import.meta.url)),'--manifest',matrixPath,'--engine','typescript','--output',cliOutput],{timeout:30000});
 assert.match(cli.stdout,/recorded/);const {readFile}=await import('node:fs/promises');const cliIndex=JSON.parse(await readFile(join(cliOutput,'index.json'),'utf8'));assert.equal(cliIndex.records.length,2);assert.equal(cliIndex.records[1].status,'not-run');

 // Rehashed corrupt independent oracle is still rejected by numerical validation.
 const corrupt=JSON.parse(files.reference);corrupt[0].open=11;await writeFile(join(dir,'reference'),JSON.stringify(corrupt));manifest.reference.sha256=await checksumFile(join(dir,'reference'));
 const bad=await runBenchmark(manifest,{engine:'typescript',workload:'ticks',output:join(dir,'bad'),manifestDirectory:dir,samples:1,performance:{sampleIntervalMs:100}});
 assert.equal(bad.status,'failed');assert.equal(bad.observations[0].outcome,'numerical-mismatch');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('private artifact seam rejects unverified bytes before execution',async()=>{
 const {verifyPerformanceArtifacts}=await import('./profiling-build.mjs');
 const {mkdtemp,writeFile,rm,mkdir}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=await mkdtemp(join(tmpdir(),'p3-artifact-'));
 try{await mkdir(join(dir,'wasm'));await writeFile(join(dir,'identity.json'),JSON.stringify({format:1,instrumented:true,sourceChecksum:'0'.repeat(64)}));await assert.rejects(()=>verifyPerformanceArtifacts({directory:dir}),/source|identity/i);}finally{await rm(dir,{recursive:true,force:true});}
});


test('identical Statement definitions on different company sessions do not compare different inputs',async()=>{
 const {readFile,writeFile,mkdtemp,rm}=await import('node:fs/promises');const {join,resolve}=await import('node:path');const {tmpdir}=await import('node:os');const {fileURLToPath}=await import('node:url');
 const {runBenchmark,checksumFile}=await import('./benchmark.mjs');const {performanceActions}=await import('./run-performance-matrix.mjs');
 const root=resolve(fileURLToPath(new URL('../..',import.meta.url))),dir=await mkdtemp(join(tmpdir(),'p3-statement-'));
 try{
  const input=join(root,'src/test/fixtures/sec-statements/reference.json'),reference=join(root,'src/test/fixtures/sec-statements/expected.json');
  const source=JSON.parse(await readFile(input));const model=join(dir,'model.json'),actions=join(dir,'actions.json');
  await writeFile(model,JSON.stringify(Object.fromEntries(Object.entries(source.companies).map(([symbol,c])=>[symbol,c.definition]))));await writeFile(actions,JSON.stringify({version:'performance-trace/1',actions:performanceActions('statement')}));
  const manifest={version:1,id:'certified-control',kind:'statement',format:'certified-json',rows:98,sampling:'complete-control',classification:'real-certified'};
  for(const [key,path] of Object.entries({input,reference,model,actions}))manifest[key]={path,sha256:await checksumFile(path)};manifest.reference.independent=true;
  const r=await runBenchmark(manifest,{engine:'typescript',workload:'statement',output:join(dir,'run'),samples:1,performance:{sampleIntervalMs:100}});
  assert.equal(r.status,'passed',r.observations.find(o=>o.status!=='passed')?.reason);assert.equal(r.observations[0].checkedCells,110);assert.equal(r.observations[0].sessions.length,6);assert.equal(r.observations[1].sessions.length,6);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('private artifact seam rejects extra source files that could shadow imports',{skip:!process.env.PIVOT_PROFILE_CLEAN_DIR},async()=>{
 const {verifyPerformanceArtifacts}=await import('./profiling-build.mjs');
 const {mkdtemp,writeFile,rm,cp}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=await mkdtemp(join(tmpdir(),'p3-shadow-source-'));
 try{
  for(const name of ['src','wasm','typescript.mjs','identity.json'])await cp(join(process.env.PIVOT_PROFILE_CLEAN_DIR,name),join(dir,name),{recursive:true});
  await writeFile(join(dir,'src/lib/tableExecution/engine.tsx'),'throw Error("unexpected shadow source");\n');
  await assert.rejects(()=>verifyPerformanceArtifacts({directory:dir}),/source file set/i);
 }finally{await rm(dir,{recursive:true,force:true});}
});

async function coordinatorScenario(mode){
 const {mkdtemp,writeFile,readFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {promisify}=await import('node:util');const {execFile}=await import('node:child_process');
 const dir=await mkdtemp(join(tmpdir(),'p3-coordinator-'));
 try{
  const script=`
import {mock} from 'node:test';import {readFile,writeFile,mkdir} from 'node:fs/promises';import {join} from 'node:path';import {createHash} from 'node:crypto';
const mode=${JSON.stringify(mode)},dir=${JSON.stringify(dir)},calls=[];
const checksumFile=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
const {STAGES,unavailable}=await import(${JSON.stringify(new URL('./report.mjs',import.meta.url).href)});
mock.module(${JSON.stringify(new URL('./benchmark.mjs',import.meta.url).href)},{namedExports:{checksumFile,runBenchmark:async(w,options)=>{
 calls.push(options);const sha='a'.repeat(64);const failed=mode==='later-failure'&&calls.length===2;
 const report={schemaVersion:1,engine:'typescript',workload:{id:'control',kind:'statement',rows:98},identity:{commit:'a'.repeat(40),artifact:sha,source:sha,dataset:sha,reference:sha,model:sha,actions:sha,environment:sha},environment:{node:'control'},limits:{policy:'control'},status:failed?'not-run':'passed',observations:[{variant:'baseline',temperature:'cold',status:failed?'not-run':'passed',outcome:failed?'timeout':'completed',numericalCheck:failed?'not-run':'passed',stages:failed?unavailable('controlled timeout'):Object.fromEntries(STAGES.map(k=>[k,{status:'measured',ms:1}])),memory:{peakRssBytes:100,wasmBufferBytes:null},retained:[],trace:[{action:{kind:'apply'},modelChecksum:sha,resultChecksum:sha,consumers:{table:mode==='parity-mismatch'&&calls.length===3?'b'.repeat(64):sha}}]}],limitations:[]};
 await mkdir(options.output,{recursive:true});await writeFile(join(options.output,'control-typescript.json'),JSON.stringify(report));return report;
}}});
mock.module(${JSON.stringify(new URL('./profiling-build.mjs',import.meta.url).href)},{namedExports:{verifyPerformanceArtifacts:async()=>({identity:{instrumented:true}})}});
const {runPerformanceMatrix}=await import(${JSON.stringify(new URL('./run-performance-matrix.mjs',import.meta.url).href)});
const workloadPath=join(dir,'case.json'),profilePath=join(dir,'identity.json');await writeFile(workloadPath,JSON.stringify({id:'control',kind:'statement',reference:{independent:true}}));await writeFile(profilePath,'{}');
const manifest={version:1,batches:2,samples:5,sampleIntervalMs:100,backgroundWork:'deterministic coordinator regression',cases:[{path:workloadPath,sha256:await checksumFile(workloadPath)}],profileArtifact:{path:profilePath,sha256:await checksumFile(profilePath)}};
let error;try{await runPerformanceMatrix(manifest,{engine:'typescript',output:join(dir,'out')});}catch(e){error=String(e);}
console.log(JSON.stringify({calls:calls.length,error,index:JSON.parse(await readFile(join(dir,'out/index.json'),'utf8'))}));
`;
  const path=join(dir,'control.mjs');await writeFile(path,script);
  const {stdout}=await promisify(execFile)(process.execPath,['--experimental-test-module-mocks',path],{maxBuffer:1000000});
  const result=JSON.parse(stdout.trim());
  for(const r of result.index.records)for(const key of ['qualification','cleanQualification'])if(r[key]){const bytes=await readFile(r[key].path);const {createHash}=await import('node:crypto');assert.equal(createHash('sha256').update(bytes).digest('hex'),r[key].sha256);}
  return result;
 }finally{await rm(dir,{recursive:true,force:true});}
}
test('later failed batch blocks attribution despite earlier successful batch',async()=>{
 const r=await coordinatorScenario('later-failure');assert.equal(r.calls,2);const attribution=r.index.records.find(r=>r.role==='attribution');assert.equal(attribution.status,'not-run');assert.equal(attribution.qualification,undefined);
});
test('parity rejection durably references both reports as failed attribution',async()=>{
 const r=await coordinatorScenario('parity-mismatch');assert.equal(r.calls,3);const rejected=r.index.records.find(r=>r.role==='attribution');assert.ok(rejected,'Missing persisted parity rejection');assert.equal(rejected.status,'failed');assert.equal(rejected.parity,'failed');assert.ok(rejected.qualification&&rejected.cleanQualification);assert.match(rejected.reason,/parity/i);assert.equal(rejected.accepted,false);
});
test('missing root process is unavailable rather than measured zero',async()=>{
 const {processTreeSnapshot}=await import('./run-performance-matrix.mjs');const s=processTreeSnapshot('10 1 200\n',20);assert.equal(s.status,'unavailable');assert.equal(s.treeRssBytes,null);assert.match(s.reason,/root/i);
});

test('copied source bare imports cannot resolve from an unexpected private dependency tree',{skip:!process.env.PIVOT_PROFILE_CLEAN_DIR},async()=>{
 const {mkdtemp,writeFile,readFile,rm,cp,mkdir,readdir}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {runBenchmark,checksumFile}=await import('./benchmark.mjs');const {performanceActions}=await import('./run-performance-matrix.mjs');const {tickModel,TICK_REFERENCE_POLICY}=await import('./ticks.mjs');
 const dir=await mkdtemp(join(tmpdir(),'p3-shadow-dependency-'));
 try{
  const artifactDirectory=join(dir,'artifact');await mkdir(artifactDirectory);
  for(const name of ['src','wasm','typescript.mjs','identity.json'])await cp(join(process.env.PIVOT_PROFILE_CLEAN_DIR,name),join(artifactDirectory,name),{recursive:true});
  const shadow=join(artifactDirectory,'node_modules/@tanstack/react-table');await mkdir(shadow,{recursive:true});await writeFile(join(shadow,'package.json'),JSON.stringify({name:'@tanstack/react-table',main:'index.js',type:'module'}));await writeFile(join(shadow,'index.js'),'throw Error("UNVERIFIED_PRIVATE_DEPENDENCY");\n');
  const manifest={version:1,id:'dependency-control',kind:'ticks',format:'ticks-csv',rows:300001,tick:{granularity:'1s',venue:'Q',countOnly:true}};
  const files={input:'ts,seq,mkt,price,shares\n',reference:'[]',model:JSON.stringify(tickModel(manifest.tick)),actions:JSON.stringify({version:'performance-trace/1',actions:performanceActions('ticks')})};
  for(const [key,value] of Object.entries(files)){const path=join(dir,key);await writeFile(path,value);manifest[key]={path,sha256:await checksumFile(path)};}Object.assign(manifest.reference,{independent:true,policy:TICK_REFERENCE_POLICY});
  const output=join(dir,'out');const r=await runBenchmark(manifest,{engine:'typescript',workload:'ticks',output,performance:{artifactDirectory,sampleIntervalMs:100}});assert.equal(r.status,'not-run');
  const bundle=(await readdir(output)).find(f=>f.startsWith('runner-'));assert.ok(bundle);assert.equal((await readFile(join(output,bundle),'utf8')).includes('UNVERIFIED_PRIVATE_DEPENDENCY'),false,'Unexpected private dependency entered verified bundle');
 }finally{await rm(dir,{recursive:true,force:true});}
});
