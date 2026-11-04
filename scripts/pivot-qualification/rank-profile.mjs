// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
/** Read-only, report-derived assessments. Never imported by the application. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {hashBytes, hashJSON, validateRun} from './report.mjs';
import {exclusiveTotal, validateProbe} from './profile.mjs';

const median = values => {const v=[...values].sort((a,b)=>a-b);return v.length?(v[Math.floor((v.length-1)/2)]+v[Math.floor(v.length/2)])/2:null;};
const stats = values => ({count:values.length,medianMs:median(values),minMs:Math.min(...values),maxMs:Math.max(...values)});
const uncertainty = [
 'Rank only within this engine/workload/action/temperature/batch/variant/mode; different work is not comparable.',
 'Envelope rank is not exclusive cost or an optimization benefit. No subtraction of overlapping stages.',
 'Same-source baseline/candidate labels are calibration, not an optimized comparison.',
 'Instrumented durations are attribution only; Node action time is not browser usable-view latency.',
 'Missing scopes/reducer/cache/rendering measurements remain unknown; no forced winner.',
];

/**
 * rankProfiles(records): BottleneckAssessment[]. Records are action samples from
 * recordsFromRun (or explicitly labeled report-only accounting fixtures). Cohort
 * keys separate engine, workload, full action, trace position, temperature, mode,
 * batch and variant. Identical keys MUST have identical work identities/limits.
 * Each sample, including a failed sample's partial work, is preserved verbatim.
 * Only successful, observer-valid samples contribute to timings and rankings;
 * incomplete observer data remains raw evidence, never a candidate or speedup.
 */
export function rankProfiles(records) {
 const groups=new Map();
 for(const r of records){
  assert.ok(r.engine&&r.workload&&r.action&&r.evidence&&r.work,'Missing assessment identity');
  assert.ok(['inclusive-do-not-sum','observed-envelope','exclusive'].includes(r.accounting),'Unknown accounting');
  assert.equal(new Set(r.contributions.map(e=>e.id)).size,r.contributions.length,'Duplicate contribution identity');
  for(const e of r.contributions) assert.ok(Number.isFinite(e.startMs)&&Number.isFinite(e.endMs)&&e.endMs>=e.startMs,'Invalid contribution');
  if(r.accounting==='exclusive')exclusiveTotal(r.contributions);
  const key=hashJSON([r.engine,r.workload,r.action,r.position,r.temperature,r.mode,r.batch,r.variant]);
  const group=groups.get(key);
  if(group){assert.equal(hashJSON(r.work),hashJSON(group[0].work),'Incompatible work in action cohort');assert.equal(r.accounting,group[0].accounting,'Incompatible accounting');group.push(r);}
  else groups.set(key,[r]);
 }
 return [...groups].map(([cohortId,samples])=>{
  const first=samples[0];
  // Phase validity is independent of a later engine failure in the same report.
  const successful=samples.filter(s=>
   s.status==='passed'&&s.outcome==='completed'&&s.observer?.status!=='incomplete'
  );
  const actionTimes=successful.filter(s=>Number.isFinite(s.actionMs)&&s.actionMs>=0).map(s=>s.actionMs);
  const byEvent=new Map();
  for(const s of successful)for(const e of s.contributions){
   const key=hashJSON([e.id,e.name,e.parentId??null]);
   if(!byEvent.has(key))byEvent.set(key,{id:e.id,name:e.name,parentId:e.parentId??null,values:[]});
   byEvent.get(key).values.push(e.endMs-e.startMs);
  }
  const ranking=[...byEvent.values()].map(({values,...e})=>({...e,...stats(values)})).sort((a,b)=>b.medianMs-a.medianMs||a.id.localeCompare(b.id));
  const processes=new Map();
  for(const s of samples){
   // Missing process identity is unknown, never a fabricated shared process.
   const id=s.memory.processId??`unknown:${processes.size}`;
   if(!processes.has(id))processes.set(id,{processId:s.memory.processId??null,observations:[]});
   processes.get(id).observations.push(s.memory);
  }
  const memory=[...processes.values()].map(p=>({...p,sampledTreePeakBytes:p.observations.some(o=>o.sampledTreePeakBytes!==null&&o.sampledTreePeakBytes!==undefined)?Math.max(...p.observations.map(o=>o.sampledTreePeakBytes??0)):null}));
  return {
   cohortId,engine:first.engine,workload:first.workload,action:first.action,position:first.position,temperature:first.temperature,mode:first.mode,batch:first.batch,variant:first.variant,work:first.work,
   evidenceIds:samples.map(s=>s.evidence),samples,
   actionTiming:actionTimes.length?{accounting:'action-envelope',...stats(actionTimes)}:null,
   contribution:{accounting:first.accounting,ranking,exclusiveTotalMs:first.accounting==='exclusive'?median(successful.map(s=>exclusiveTotal(s.contributions))):null},
   counters:samples.map(s=>({evidence:s.evidence,counters:s.counters})),
   memory:{processes:memory,retainedStateBytes:null,tradeoff:'Process high-water and sampled tree peaks describe the entire child, not action-owned bytes. Do not sum them or sum across these action assessments. Retained rows have no forced GC/plateau/cache attribution.'},
   uncertainty:[...uncertainty,...(successful.length<5?['Exploratory: fewer than five successful samples in this cohort.']:[])],
   candidate:{status:successful.length?'unselected':'unavailable',route:'retain-baseline; additional attribution only',reason:'No exclusive scope/reducer costs or qualified retained-state benefit established.'},
   guardAndFallback:'Keep current engine/limits/semantics. Reject mismatched work; preserve failures/refusals. No optimization promotion without exact-revision correctness and matched clean evidence.',
  };
 });
}

/** Adapt the existing v1 qualification report without replacing its schema. */
export function recordsFromRun(report,evidence,metadata={}) {
 validateRun(report);
 if(metadata.role){
  assert.equal(Boolean(report.performance?.instrumented),metadata.role==='attribution','Instrumentation role mismatch');
 }
 return report.observations.flatMap((o,observation)=>{
  const common={
   engine:report.engine,
   workload:report.workload.id,
   temperature:o.temperature,
   mode:report.performance?.instrumented?'attribution':'clean',
   batch:metadata.batch??null,
   variant:o.variant,
   work:{identity:report.identity,limits:report.limits,workload:report.workload},
   evidence:{...evidence,observation},
   status:o.status,
   outcome:o.outcome,
   reason:o.reason??null,
   reportStatus:report.status,
   observer:o.observer??null,
   memory:{
    processId:o.process?.id??null,
    peakRssBytes:o.memory.peakRssBytes,
    sampledTreePeakBytes:o.process?.sampledTreePeakBytes??null,
    wasmBufferBytes:o.memory.wasmBufferBytes,
    retained:o.retained??[],
   },
  };
  const trace={
   ...common,
   action:{kind:'whole-trace'},
   position:null,
   accounting:'observed-envelope',
   contributions:Object.entries(o.stages)
    .filter(([,s])=>s.status==='measured')
    .map(([name,s])=>({id:name,name,startMs:0,endMs:s.ms})),
   counters:[],
   unavailableStages:Object.entries(o.stages).filter(([,s])=>s.status!=='measured'),
  };
  return [trace,...(o.trace??[]).map((t,position)=>{
   if(t.probe)validateProbe(t.probe);
   return {
    ...common,
    action:t.action,
    position,
    work:{...common.work,actionModel:t.modelChecksum??null,revision:t.revision??null},
    evidence:{...common.evidence,trace:position,sessionId:t.sessionId},
    actionMs:t.ms??null,
    accounting:'inclusive-do-not-sum',
    contributions:t.probe?.events??[],
    counters:t.probe?.counters??[],
   };
  })];
 });
}

/** Load an explicitly checksummed derived display and its primary reports. */
export async function loadEvidence(summaryPath,expectedSha256) {
 const bytes=await readFile(summaryPath);assert.equal(hashBytes(bytes),expectedSha256,'Summary checksum mismatch');
 const summary=JSON.parse(bytes),records=[];
 for(const [index,r] of summary.records.entries()){
  const evidence={...r.qualification,summaryPath,summarySha256:expectedSha256,record:index};
  if(!r.identity){
   // Deferred index entries point at prior evidence, not additional attempts.
   records.push({engine:r.engine,workload:r.id,action:{kind:'not-run-index-entry'},position:null,temperature:null,mode:r.role??'deferred',batch:r.batch??null,variant:null,work:{reason:r.reason},evidence,status:r.status,outcome:'not-run',reason:r.reason,accounting:'observed-envelope',contributions:[],counters:[],memory:{processId:null,peakRssBytes:null,sampledTreePeakBytes:null,wasmBufferBytes:null,retained:[]}});
   continue;
  }
  const primary=await readFile(r.qualification.path);assert.equal(hashBytes(primary),r.qualification.sha256,'Primary report checksum mismatch');
  const report=JSON.parse(primary);assert.equal(hashJSON(report.identity),hashJSON(r.identity),'Summary/primary identity mismatch');assert.equal(report.engine,r.engine);assert.equal(report.workload.id,r.id);assert.equal(report.status,r.status);
  records.push(...recordsFromRun(report,evidence,r));
 }
 return records;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [path,sha]=process.argv.slice(2);assert.ok(path&&/^[a-f0-9]{64}$/.test(sha??''),'Usage: node rank-profile.mjs SUMMARY_PATH SUMMARY_SHA256');
 console.log(JSON.stringify({kind:'derived-bottleneck-assessments',source:{path,sha256:sha},assessments:rankProfiles(await loadEvidence(path,sha))},null,2));
}
