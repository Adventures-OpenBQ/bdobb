// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rankProfiles, recordsFromRun, loadEvidence} from './rank-profile.mjs';
import {STAGES, hashBytes} from './report.mjs';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// Synthetic REPORT-ONLY accounting fixtures; no engine is executed or gain asserted.
const sample = () => ({engine:'typescript',workload:'report-only',action:{kind:'apply'},temperature:'cold',position:0,mode:'attribution',batch:0,variant:'baseline',work:{dataset:'fixture-A',model:'fixture-model'},evidence:{path:'fixture',sha256:'a'.repeat(64),observation:0},status:'passed',outcome:'completed',contributions:[{id:'0',name:'outer',startMs:0,endMs:10},{id:'1',parentId:'0',name:'inner',startMs:1,endMs:9}],accounting:'inclusive-do-not-sum',counters:[{name:'calls',value:2,unit:'calls',scope:'fixture'}],memory:{processId:'p1',peakRssBytes:null,sampledTreePeakBytes:null,wasmBufferBytes:null,retained:[]}});
test('refuses incompatible work within an otherwise matching action cohort',()=>{
 const a=sample(),b=sample();b.work.dataset='different';assert.throws(()=>rankProfiles([a,b]),/Incompatible work/);
});
test('does not compare different engine, action, temperature or instrumented work',()=>{
 const a=sample();const records=[a,...['engine','action','temperature','mode'].map(k=>({...sample(),[k]:k==='action'?{kind:'sort'}:`different-${k}`}))];
 const ranked=rankProfiles(records);assert.equal(ranked.length,5);assert.ok(ranked.every(r=>r.samples.length===1&&r.candidate.status==='unselected'));
});
test('inclusive envelopes retain parents and counters without manufacturing exclusive cost',()=>{
 const [r]=rankProfiles([sample()]);assert.deepEqual(r.contribution.ranking.map(s=>[s.name,s.medianMs]),[['outer',10],['inner',8]]);assert.equal(r.contribution.exclusiveTotalMs,null);assert.equal(r.samples[0].contributions[1].parentId,'0');assert.equal(r.samples[0].counters[0].scope,'fixture');
});
test('exclusive accounting requires disjoint intervals and remains distinct from inclusive',()=>{
 const s=sample();s.accounting='exclusive';assert.throws(()=>rankProfiles([s]),/overlap/);s.contributions=[{id:'0',name:'a',startMs:0,endMs:2},{id:'1',name:'b',startMs:2,endMs:5}];assert.equal(rankProfiles([s])[0].contribution.exclusiveTotalMs,5);
});
test('failed and refused outcomes and partial timings remain visible but cannot win rankings',()=>{
 const failed={...sample(),status:'failed',outcome:'timeout'};const refused={...sample(),status:'not-run',outcome:'profile-refused',contributions:[]};const [r]=rankProfiles([failed,refused]);assert.deepEqual(r.samples.map(s=>s.outcome),['timeout','profile-refused']);assert.equal(r.samples[0].contributions[0].endMs,10);assert.deepEqual(r.contribution.ranking,[]);assert.equal(r.candidate.status,'unavailable');
});
test('unknown memory is not zero and repeated process highwater is never summed',()=>{
 const a=sample(),b=sample();b.memory.peakRssBytes=100;const [r]=rankProfiles([a,b]);assert.equal(r.memory.processes.length,1);assert.deepEqual(r.memory.processes[0].observations.map(m=>m.peakRssBytes),[null,100]);assert.equal(r.memory.processes[0].sampledTreePeakBytes,null);assert.equal(r.memory.retainedStateBytes,null);
});
function report(){const sha='a'.repeat(64);return {schemaVersion:1,engine:'typescript',workload:{id:'report-only',kind:'statement',rows:98},identity:{commit:'a'.repeat(40),...Object.fromEntries(['artifact','source','dataset','reference','model','actions','environment'].map(k=>[k,sha]))},environment:{node:'fixture'},limits:{policy:'fixture'},status:'passed',limitations:[],observations:[{variant:'baseline',temperature:'cold',index:0,status:'passed',outcome:'completed',numericalCheck:'passed',stages:{},memory:{peakRssBytes:null,wasmBufferBytes:null},trace:[{action:{kind:'explicit-empty'},modelChecksum:sha,revision:{input:1},sessionId:'fixture'}]}]};}
function completeReport(){const r=report();r.observations[0].stages=Object.fromEntries(STAGES.map(k=>[k,k==='compute'?{status:'measured',ms:2}:{status:'not-run',reason:'fixture'}]));return r;}
test('actual report adapter preserves untimed actions, report statuses and raw retained rows',()=>{
 const r=completeReport();r.observations[0].retained=[{cycle:0,rssBytes:123}];const rows=recordsFromRun(r,{path:'fixture',sha256:'a'.repeat(64)},{role:'clean',batch:0});assert.equal(rows.length,2);assert.equal(rows[1].actionMs,null);assert.deepEqual(rows[1].contributions,[]);assert.deepEqual(rows[1].memory.retained,r.observations[0].retained);assert.equal(rankProfiles(rows).length,2);
});
test('checksum-bound loader rejects changed evidence and retains not-run index entries without replaying reports',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'rank-report-'));try{const path=join(dir,'report.json'),bytes=JSON.stringify(completeReport());await writeFile(path,bytes);const q={path,sha256:hashBytes(bytes)};const summary={records:[{engine:'typescript',id:'report-only',role:'clean',batch:0,status:'passed',identity:completeReport().identity,qualification:q},{engine:'typescript',id:'report-only',batch:1,status:'not-run',reason:'Prior refusal',qualification:q}]};const sp=join(dir,'summary.json'),sb=JSON.stringify(summary);await writeFile(sp,sb);const rows=await loadEvidence(sp,hashBytes(sb));assert.equal(rows.length,3);assert.equal(rows[2].status,'not-run');assert.equal(rows[2].contributions.length,0);await writeFile(path,bytes+' ');await assert.rejects(loadEvidence(sp,hashBytes(sb)),/checksum/);}finally{await rm(dir,{recursive:true,force:true});}
});
test('duplicate event identities cannot inflate a cohort sample count',()=>{
 const s=sample();s.contributions.push({...s.contributions[0]});assert.throws(()=>rankProfiles([s]),/Duplicate contribution/);
});
test('report adapter rejects clean records mislabeled attribution',()=>{
 const r=completeReport();assert.throws(()=>recordsFromRun(r,{path:'fixture',sha256:'a'.repeat(64)},{role:'attribution'}),/Instrumentation role mismatch/);
});
test('action envelope summarizes matched successful samples and leaves untimed actions unknown',()=>{
 const a={...sample(),actionMs:10},b={...sample(),actionMs:20},failed={...sample(),status:'failed',outcome:'timeout',actionMs:1000};
 assert.deepEqual(rankProfiles([a,b,failed])[0].actionTiming,{accounting:'action-envelope',count:2,medianMs:15,minMs:10,maxMs:20});assert.equal(rankProfiles([sample()])[0].actionTiming,null);
});

function observedReport() {
 const r=completeReport();
 r.observations[0].observer={status:'completed',archiveStatus:'completed',spoolPath:'fixture-spool',archivePath:'fixture-archive',errors:[],expectedSha256:'b'.repeat(64),spoolSha256:'b'.repeat(64),archiveSha256:'b'.repeat(64)};
 r.observations[0].trace[0].ms=7;
 r.observations[0].trace[0].probe={accounting:'inclusive-do-not-sum',events:[{id:'1',name:'compile',startMs:0,endMs:3}],counters:[]};
 return r;
}
test('adapter excludes incomplete observer phases from timing, contributions and candidates while preserving partial evidence',()=>{
 const r=observedReport();
 r.status='not-run';
 Object.assign(r.observations[0].observer,{status:'incomplete',archiveStatus:'failed',errors:['archive publication failed']});
 const assessments=rankProfiles(recordsFromRun(r,{path:'report-only',sha256:'a'.repeat(64)}));
 for(const assessment of assessments){
  assert.equal(assessment.actionTiming,null);
  assert.deepEqual(assessment.contribution.ranking,[]);
  assert.equal(assessment.candidate.status,'unavailable');
  assert.deepEqual(assessment.samples[0].observer,r.observations[0].observer);
 }
 assert.equal(assessments[0].samples[0].contributions[0].endMs,2);
 assert.equal(assessments[1].samples[0].actionMs,7);
 assert.equal(assessments[1].samples[0].contributions[0].endMs,3);
});
test('adapter keeps valid cold measurements when a later engine phase fails',()=>{
 const r=observedReport();
 r.status='failed';
 const warm=structuredClone(r.observations[0]);
 Object.assign(warm,{temperature:'warm',status:'failed',outcome:'engine-error',reason:'later warm failure',numericalCheck:'not-run'});
 r.observations.push(warm);
 const assessments=rankProfiles(recordsFromRun(r,{path:'report-only',sha256:'a'.repeat(64)}));
 const cold=assessments.filter(a=>a.temperature==='cold');
 assert.equal(cold.length,2);
 assert.deepEqual(cold[0].contribution.ranking.map(e=>e.medianMs),[2]);
 assert.equal(cold[1].actionTiming.medianMs,7);
 assert.ok(cold.every(a=>a.candidate.status==='unselected'));
 assert.ok(assessments.filter(a=>a.temperature==='warm').every(a=>a.actionTiming===null&&a.contribution.ranking.length===0&&a.candidate.status==='unavailable'));
});
