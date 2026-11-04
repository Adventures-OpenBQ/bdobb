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
