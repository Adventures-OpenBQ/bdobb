// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateTickReferencePolicy} from './ticks.mjs';
export const STAGES=['acquisitionParse','registrationEncoding','compute','filterReselection','transfer','chartDelivery','rendering','totalUsableView'];
export const hashBytes=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const hashJSON=v=>hashBytes(JSON.stringify(canonical(v)));
export const unavailable=reason=>Object.fromEntries(STAGES.map(k=>[k,{status:'not-run',reason}]));
const statuses=['passed','failed','not-run','unsupported'];
export function validateRun(r){
 assert.equal(r.schemaVersion,1);assert.ok(['typescript','rust'].includes(r.engine));
 assert.match(r.identity?.commit??'',/^[a-f0-9]{40}$/,'Missing commit');
 for(const k of ['artifact','source','dataset','reference','model','actions','environment'])assert.match(r.identity[k]??'',/^[a-f0-9]{64}$/,`Missing ${k} checksum`);
 assert.ok(r.workload?.id&&['bulk','statement','ticks'].includes(r.workload.kind));
 if(r.workload.kind==='ticks'){validateTickReferencePolicy(r.workload.referencePolicy);assert.equal(r.identity.referencePolicy,hashJSON({sourceChecksum:r.identity.reference,policy:r.workload.referencePolicy}),'Reference policy binding mismatch');}
 assert.ok(Number.isSafeInteger(r.workload.rows)&&r.workload.rows>0);
 assert.ok(r.environment&&r.limits&&Array.isArray(r.limitations));assert.ok(statuses.includes(r.status));
 assert.ok(Array.isArray(r.observations)&&r.observations.length,'Missing observations');
 for(const o of r.observations){
  assert.ok(['baseline','candidate'].includes(o.variant));assert.ok(['cold','warm'].includes(o.temperature));assert.ok(statuses.includes(o.status));
  assert.deepEqual(Object.keys(o.stages).sort(),[...STAGES].sort(),'Stage mismatch');
  for(const s of Object.values(o.stages)){
   if(s.status==='measured')assert.ok(Number.isFinite(s.ms)&&s.ms>=0,'Invalid timing');
   else {assert.equal(s.status,'not-run');assert.ok(s.reason);assert.equal(s.ms,undefined,'Unrun timing must be absent');}
  }
  if(o.status==='passed'){assert.equal(o.outcome,'completed','Refusal cannot pass');assert.equal(o.numericalCheck,'passed');assert.equal(o.stages.compute.status,'measured');}
  if(['profile-refused','timeout'].includes(o.outcome)){assert.notEqual(o.status,'passed');assert.notEqual(o.stages.totalUsableView.status,'measured');}
  for(const k of ['peakRssBytes','wasmBufferBytes'])assert.ok(o.memory[k]===null||Number.isSafeInteger(o.memory[k])&&o.memory[k]>=0);
  if(o.process){
   const p=o.process;assert.ok(p.id&&Array.isArray(p.samples)&&Array.isArray(p.errors));
   assert.ok(p.pid===null||Number.isSafeInteger(p.pid)&&p.pid>=0);
   assert.ok(p.intervalMs===null||Number.isInteger(p.intervalMs)&&p.intervalMs>=100&&p.intervalMs<=5000);
   for(const k of ['doneElapsedMs','exitElapsedMs'])assert.ok(p[k]===null||Number.isFinite(p[k])&&p[k]>=0);
   for(const s of p.samples){
    for(const k of ['elapsedMs','collectionMs'])assert.ok(Number.isFinite(s[k])&&s[k]>=0);
    if(s.status==='unavailable'){assert.equal(s.treeRssBytes,null);assert.ok(s.reason);assert.deepEqual(s.processes,[]);continue;}
    assert.equal(s.status,'measured');assert.ok(s.processes.some(row=>row.pid===p.pid));
    assert.equal(new Set(s.processes.map(row=>row.pid)).size,s.processes.length);
    for(const row of s.processes)for(const k of ['pid','ppid','rssBytes'])assert.ok(Number.isSafeInteger(row[k])&&row[k]>=0);
    assert.equal(s.treeRssBytes,s.processes.reduce((sum,row)=>sum+row.rssBytes,0));
   }
   const peaks=p.samples.filter(s=>s.status==='measured').map(s=>s.treeRssBytes);assert.equal(p.sampledTreePeakBytes,peaks.length?Math.max(...peaks):null);
  }
  if(o.observer){
   assert.ok(['completed','incomplete'].includes(o.observer.status));assert.ok(['completed','failed'].includes(o.observer.archiveStatus));assert.ok(o.observer.spoolPath&&o.observer.archivePath&&Array.isArray(o.observer.errors));
   if(o.observer.status==='completed'){assert.equal(o.observer.archiveStatus,'completed');assert.equal(o.observer.errors.length,0);for(const k of ['expectedSha256','spoolSha256','archiveSha256'])assert.match(o.observer[k]??'',/^[a-f0-9]{64}$/);assert.equal(o.observer.expectedSha256,o.observer.spoolSha256);assert.equal(o.observer.spoolSha256,o.observer.archiveSha256);}
   if(r.status==='passed')assert.equal(o.observer.status,'completed','Incomplete observer cannot be accepted');
  }
  if(o.outcome==='observer-incomplete')assert.notEqual(o.status,'passed');
 }
 if(r.performance){
  assert.equal(r.performance.contract,'performance-trace/1');assert.equal(typeof r.performance.instrumented,'boolean');
  const processes=new Map(),sessions=new Map();
  for(const o of r.observations){
   if(o.status!=='passed')continue;
   assert.ok(o.process?.id&&Number.isSafeInteger(o.process.pid),'Missing process identity');
   assert.ok(Array.isArray(o.sessions)&&o.sessions.length,'Missing sessions');
   assert.ok(Array.isArray(o.trace)&&o.trace.length,'Missing action trace');
   assert.ok(o.checkedCells>0,'Omitted independent correctness validation');
   const key=`${o.variant}/${o.index}`;
   if(processes.has(key))assert.equal(o.process.id,processes.get(key),'Warm process changed');
   else {assert.ok(![...processes.values()].includes(o.process.id),'Cold process reused');processes.set(key,o.process.id);}
   const ids=o.sessions.map(s=>s.id);
   if(sessions.has(key))assert.deepEqual(ids,sessions.get(key),'Warm session changed');else sessions.set(key,ids);
   for(const t of o.trace){assert.ok(ids.includes(t.sessionId),'Trace session mismatch');assert.equal(t.numericalCheck,'passed');assert.match(t.resultChecksum??'',/^[a-f0-9]{64}$/);for(const k of ['input','model','output'])assert.ok(Number.isSafeInteger(t.revision?.[k])&&t.revision[k]>0,'Missing action revision');}
   for(const sample of o.process.samples){if(sample.status==='unavailable'){assert.equal(sample.treeRssBytes,null);assert.ok(sample.reason);assert.deepEqual(sample.processes,[]);continue;}assert.equal(sample.status,'measured');assert.ok(sample.processes.some(p=>p.pid===o.process.pid),'Measured sample missing root');assert.equal(new Set(sample.processes.map(p=>p.pid)).size,sample.processes.length,'Duplicate PID RSS');assert.equal(sample.treeRssBytes,sample.processes.reduce((n,p)=>n+p.rssBytes,0),'Tree RSS is not unique PID sum');}
   const peaks=o.process.samples.filter(s=>s.status==='measured').map(s=>s.treeRssBytes);assert.equal(o.process.sampledTreePeakBytes,peaks.length?Math.max(...peaks):null,'Unavailable samples must not become measured zero');
  }
 }
 if(r.status==='passed')assert.ok(r.observations.every(o=>o.status==='passed'),'Nonpassing observation');
 return r;
}
export function summarizeRun(r){
 validateRun(r);
 return [...new Set(r.observations.map(o=>`${o.variant}/${o.temperature}`))].map(key=>{
  const samples=r.observations.filter(o=>`${o.variant}/${o.temperature}`===key);
  const stages=Object.fromEntries(STAGES.map(k=>{const v=samples.filter(o=>o.status==='passed'&&o.stages[k].status==='measured').map(o=>o.stages[k].ms).sort((a,b)=>a-b);return [k,v.length?{count:v.length,median:(v[Math.floor((v.length-1)/2)]+v[Math.floor(v.length/2)])/2,min:v[0],max:v.at(-1)}:null];}));
  return {group:key,exploratory:samples.filter(o=>o.status==='passed').length<5,stages,outcomes:samples.map(o=>o.outcome)};
 });
}
