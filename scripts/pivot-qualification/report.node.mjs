// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {STAGES,hashJSON,validateRun,summarizeRun} from './report.mjs';
const sha='a'.repeat(64);
function sample(){return {schemaVersion:1,engine:'typescript',workload:{id:'control',kind:'statement',rows:98,sampling:'complete-control'},identity:{commit:'a'.repeat(40),artifact:sha,source:sha,dataset:sha,reference:sha,model:sha,actions:sha,environment:sha},environment:{node:'test'},limits:{policy:'experimental-runner'},status:'passed',observations:[{variant:'baseline',temperature:'cold',status:'passed',outcome:'completed',numericalCheck:'passed',stages:Object.fromEntries(STAGES.map(k=>[k,k==='rendering'?{status:'not-run',reason:'headless'}:{status:'measured',ms:1}])),memory:{peakRssBytes:100,wasmBufferBytes:null},retained:[]}],limitations:[]};}
test('accepts complete measured report and summarizes only measured stages',()=>{const r=sample();assert.equal(validateRun(r),r);assert.deepEqual(summarizeRun(r)[0].stages.compute,{count:1,median:1,min:1,max:1});assert.equal(summarizeRun(r)[0].stages.rendering,null);});
for(const key of ['commit','artifact','source','dataset','reference','model','actions','environment'])test(`rejects missing ${key}`,()=>{const r=sample();delete r.identity[key];assert.throws(()=>validateRun(r));});
test('rejects missing or extra stage and unrun timing zero',()=>{for(const mutate of [r=>delete r.observations[0].stages.compute,r=>r.observations[0].stages.fake={status:'measured',ms:1},r=>r.observations[0].stages.rendering.ms=0]){const r=sample();mutate(r);assert.throws(()=>validateRun(r));}});
test('refused and timeout observations cannot be success or contribute timings',()=>{for(const outcome of ['profile-refused','timeout']){const r=sample();r.observations[0].outcome=outcome;assert.throws(()=>validateRun(r));}});
test('requires independent numerical check and observations for success',()=>{const r=sample();r.observations[0].numericalCheck='not-run';assert.throws(()=>validateRun(r));r.observations=[];assert.throws(()=>validateRun(r));});
test('hashJSON is deterministic with key-order independence',()=>assert.equal(hashJSON({b:2,a:1}),hashJSON({a:1,b:2})));
test('groups cold/warm and variant without claiming p95',()=>{const r=sample();r.observations.push({...structuredClone(r.observations[0]),temperature:'warm'});assert.equal(summarizeRun(r).length,2);});
test('hashJSON changes on semantic change and is sha256',()=>{assert.match(hashJSON({a:1}),/^[a-f0-9]{64}$/);assert.notEqual(hashJSON({a:1}),hashJSON({a:2}));});
test('fixed admission refuses row ceiling before loading payload',async()=>{const {admit,ADMISSION_PROFILE}=await import('./benchmark.mjs');assert.equal(ADMISSION_PROFILE.maxRows,300000);assert.equal(admit({rows:1000000,format:'csv'},1).outcome,'profile-refused');assert.equal(admit({rows:98,format:'certified-json'},1000),null);});
test('action contract rejects arbitrary actions instead of hashing ignored instructions',async()=>{const {validateActions}=await import('./benchmark.mjs');assert.throws(()=>validateActions([{kind:'ignored'}]));});
test('runner verifies actual file bytes before admission or artifact execution',async()=>{const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {runBenchmark}=await import('./benchmark.mjs');const directory=await mkdtemp(join(tmpdir(),'pivot-admission-'));try{await writeFile(join(directory,'input'),'changed');await assert.rejects(runBenchmark({version:1,kind:'bulk',rows:1000000,input:{path:'input',sha256:sha}},{engine:'typescript',workload:'bulk',manifestDirectory:directory,output:directory}),/checksum mismatch/);}finally{await rm(directory,{recursive:true,force:true});}});
test('tick reference interpretation is versioned and bound to original reference checksum',()=>{
 const r=sample();r.workload.kind='ticks';r.workload.referencePolicy={version:'tick-bucket-index/1',bucketEncoding:'interval-index',outputBucketUnit:'epoch-seconds'};
 assert.throws(()=>validateRun(r));
 r.identity.referencePolicy=hashJSON({sourceChecksum:r.identity.reference,policy:r.workload.referencePolicy});assert.equal(validateRun(r),r);
 r.identity.reference='b'.repeat(64);assert.throws(()=>validateRun(r));
});
