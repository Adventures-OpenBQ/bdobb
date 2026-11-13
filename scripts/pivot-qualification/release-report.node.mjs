// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hashBytes} from './report.mjs';
import {releaseReport} from './release-report.mjs';
const sha='a'.repeat(64),commit='a'.repeat(40);
const inventory={version:1,targetPlatform:'macos-arm64',requirements:[{id:'portable',required:true,scope:'portable'},{id:'native',required:true,scope:'native'},{id:'refusal',required:true,scope:'portable',negativeCapability:true}]};
async function fixture(fn){const dir=await mkdtemp(join(tmpdir(),'release-report-'));try{await writeFile(join(dir,'proof'),'assertions');const identity={commit,source:sha,artifact:sha,dataset:sha,environment:sha};const bundle={version:1,candidate:{commit,source:sha,artifacts:[sha],datasets:[sha],environments:[sha]},evidence:inventory.requirements.map(r=>({requirementId:r.id,status:r.id==='refusal'?'unsupported':'passed',platform:r.scope==='native'?'macos-arm64':'linux-x64',identity:{...identity},assertion:'exact public assertion',refusalAssertion:r.id==='refusal',proof:{path:'proof',sha256:hashBytes('assertions')}})),performance:[]};await fn(bundle,dir);}finally{await rm(dir,{recursive:true,force:true});}}
test('complete target platform qualifies and explicit refusal passes only its own assertion',()=>fixture(async(b,d)=>assert.equal((await releaseReport(b,inventory,d)).decision,'QUALIFIED')));
test('missing native and environment failure remain incomplete',()=>fixture(async(b,d)=>{b.evidence=b.evidence.filter(e=>e.requirementId!=='native');assert.equal((await releaseReport(b,inventory,d)).decision,'INCOMPLETE');b.evidence.push({requirementId:'native',status:'not-run',reason:'environment failure'});assert.equal((await releaseReport(b,inventory,d)).decision,'INCOMPLETE');}));
test('failed correctness blocks despite later pass',()=>fixture(async(b,d)=>{b.evidence.push({...b.evidence[0],status:'failed'});assert.equal((await releaseReport(b,inventory,d)).decision,'FAILED');}));
test('slowdown advisory cannot mask missing correctness',()=>fixture(async(b,d)=>{b.advisories=['100x slowdown'];assert.equal((await releaseReport(b,inventory,d)).decision,'QUALIFIED');b.evidence.pop();assert.equal((await releaseReport(b,inventory,d)).decision,'INCOMPLETE');}));
test('unsupported computation is not a pass',()=>fixture(async(b,d)=>{b.evidence[0].status='unsupported';assert.equal((await releaseReport(b,inventory,d)).decision,'INCOMPLETE');b.evidence[2].refusalAssertion=false;assert.equal((await releaseReport(b,inventory,d)).requirements[2].status,'unsupported');}));
for(const mutate of [b=>b.evidence[0].identity.source='b'.repeat(64),b=>b.evidence[0].identity.artifact='b'.repeat(64),b=>b.evidence[0].proof.sha256=sha,b=>b.evidence[1].platform='linux-x64',b=>b.evidence[0].requirementId='unknown'])test('rejects mismatched identity, bytes, native platform or unknown ID '+mutate.toString(),()=>fixture(async(b,d)=>{mutate(b);await assert.rejects(releaseReport(b,inventory,d));}));
test('Task7 performance reports are semantically validated and stay advisory',()=>fixture(async(b,d)=>{
 const {STAGES}=await import('./report.mjs');
 const run={schemaVersion:1,engine:'rust',identity:{...b.evidence[0].identity,reference:sha,model:sha,actions:sha},environment:{platform:'test'},workload:{id:'statement',kind:'statement',rows:98},limits:{policy:'unchanged'},status:'unsupported',observations:[{variant:'candidate',temperature:'cold',status:'unsupported',outcome:'profile-refused',numericalCheck:'not-run',stages:Object.fromEntries(STAGES.map(s=>[s,{status:'not-run',reason:'profile refusal'}])),memory:{peakRssBytes:null,wasmBufferBytes:null},retained:[]}],limitations:['No numeric performance measurement']};
 async function store(){const bytes=JSON.stringify(run);await writeFile(join(d,'run.json'),bytes);b.performance=[{path:'run.json',sha256:hashBytes(bytes)}];}
 await store();const report=await releaseReport(b,inventory,d);assert.equal(report.decision,'QUALIFIED');assert.equal(report.performance[0].summary[0].stages.compute,null);
 run.status='passed';await store();await assert.rejects(releaseReport(b,inventory,d));
}));
test('negative capability cannot pass without an explicit refusal assertion even when labeled passed',()=>fixture(async(b,d)=>{b.evidence[2].status='passed';b.evidence[2].refusalAssertion=false;assert.equal((await releaseReport(b,inventory,d)).decision,'INCOMPLETE');}));
