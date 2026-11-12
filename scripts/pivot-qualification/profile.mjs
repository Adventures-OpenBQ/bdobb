// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
/** Private opt-in adapter. This file is never imported by the application. */
export function createRecorder(clock=()=>performance.now()) {
 const events=[], counters=new Map(),stack=[];let sequence=0;
 return {
  begin(name) { const event={id:String(++sequence),name,startMs:clock(),endMs:null,...(stack.length?{parentId:stack.at(-1).id}:{})};events.push(event);stack.push(event);return ()=>{if(stack.pop()!==event)throw Error('Unbalanced profile stages');event.endMs=clock();}; },
  measure(name,run) {const end=this.begin(name);try{return run();}finally{end();}},
  count(name,value,unit,scope) {if(!Number.isSafeInteger(value)||value<0)throw Error('Invalid counter');const key=JSON.stringify([name,unit,scope]);const prior=counters.get(key);counters.set(key,{name,value:(prior?.value??0)+value,unit,scope});},
  snapshot() {if(stack.length)throw Error('Open profile stages');return {accounting:'inclusive-do-not-sum',events:events.map(e=>({...e})),counters:[...counters.values()]};},
 };
}
export function exclusiveTotal(events) {
 const sorted=[...events].sort((a,b)=>a.startMs-b.startMs);let end=-Infinity,total=0;
 for(const e of sorted){if(!Number.isFinite(e.startMs)||!Number.isFinite(e.endMs)||e.endMs<e.startMs)throw Error('Invalid interval');if(e.startMs<end)throw Error('Inclusive stages overlap; an exclusive total is invalid');total+=e.endMs-e.startMs;end=e.endMs;}
 return total;
}
export function validateArtifact(identity,module) {
 const probe=typeof module.__pivot_profile_reset==='function'&&typeof module.__pivot_profile_read==='function';
 if(!identity.instrumented && Object.keys(module).some(k=>k.startsWith('__pivot_profile')))throw Error('Instrumented artifact labeled clean');
 if(identity.instrumented&&!probe)throw Error('Profiling artifact missing private probe');
}
const stages=new Set(['calculate-view','calculate-table','compile','source-evaluation','category-preparation','runtime-and-qualification','qualification','facets','output-projection','control-public-operations','acquisition-parse','host-encoding','registration-decode','linked-transfer','chart-delivery','rendering']);
const counterNames=new Set(['source-input-rows','facet-row-visits','scope-row-materializations','scope-orderings','aggregate-evaluations','host-order-crossings']);
export function validateProbe(data) {
 if(!data||data.accounting!=='inclusive-do-not-sum'||!Array.isArray(data.events)||!Array.isArray(data.counters))throw Error('Malformed probe report');
 const events=new Map();let start=-Infinity;
 for(const e of data.events){if(Object.keys(e).some(k=>!['id','name','startMs','endMs','parentId'].includes(k))||!stages.has(e.name)||typeof e.id!=='string'||!/^\d+$/.test(e.id)||events.has(e.id)||!Number.isFinite(e.startMs)||!Number.isFinite(e.endMs)||e.startMs<start||e.endMs<e.startMs)throw Error('Invalid stage event');if(e.parentId!==undefined){const p=events.get(e.parentId);if(!p||e.startMs<p.startMs||e.endMs>p.endMs)throw Error('Invalid stage parent');}events.set(e.id,e);start=e.startMs;}
 for(const c of data.counters)if(Object.keys(c).sort().join(',')!=='name,scope,unit,value'||!counterNames.has(c.name)||!['rows','vectors','sorts','calls'].includes(c.unit)||!['source-evaluation','facets','rows-in','scoped-source-rows','aggregate','host-order'].includes(c.scope)||!Number.isSafeInteger(c.value)||c.value<0)throw Error('Invalid counter');
 return data;
}
/** buildIdentity is a private runtime binding; paths never enter the returned record. */
export async function collectProfile(workload,{engine,buildIdentity:b,outputDir}) {
 const {readFile,mkdir,writeFile}=await import('node:fs/promises');const {createHash}=await import('node:crypto');const {pathToFileURL}=await import('node:url');const {join}=await import('node:path');
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');const sha=/^[a-f0-9]{64}$/;const id=/^[a-zA-Z0-9_-]{1,128}$/;
 if(!b||!id.test(b.runID??'')||!id.test(workload.id??'')||!['typescript','rust-wasm'].includes(engine)||!(/^[a-f0-9]{40}$/).test(b.sourceCommit??''))throw Error('Invalid profile identity');
 for(const k of ['sourceChecksum','artifactChecksum','runnerChecksum','patchChecksum'])if(!sha.test(b[k]??''))throw Error('Invalid build identity checksum');
 for(const k of ['inputChecksum','modelHash'])if(!sha.test(workload[k]??''))throw Error('Invalid workload identity');
 if(engine==='typescript'&&(Object.hasOwn(b,'supportChecksum')||Object.hasOwn(b,'supportPath'))){
  throw Error('TypeScript support fields are unsupported');
 }
 if(!b.instrumented)throw Error('collectProfile requires an instrumented artifact; clean timings belong to the qualification runner');
 if(hash(await readFile(b.runnerPath))!==b.runnerChecksum||hash(await readFile(b.artifactPath))!==b.artifactChecksum)throw Error('Runtime artifact/runner checksum mismatch');
 if(engine==='rust-wasm'&&(!sha.test(b.wasmChecksum??'')||hash(await readFile(b.wasmPath))!==b.wasmChecksum))throw Error('Wasm checksum mismatch');
 if(!Array.isArray(b.controlRunIDs)||!b.controlRunIDs.length||b.controlRunIDs.some(v=>!id.test(v)))throw Error('Invalid control run identity');
 if(engine==='rust-wasm'&&(!sha.test(b.supportChecksum??'')||hash(await readFile(b.supportPath))!==b.supportChecksum))throw Error('Support artifact checksum mismatch');
 const artifact=await import(pathToFileURL(b.artifactPath).href);validateArtifact(b,artifact);
 const runner=await import(pathToFileURL(b.runnerPath).href);const observer=createRecorder();
 const result=await runner.runProfileControl(workload,{artifact,observer,wasmPath:b.wasmPath,supportPath:b.supportPath});
 if(result.inputChecksum!==workload.inputChecksum||result.modelHash!==workload.modelHash||!sha.test(result.resultChecksum??''))throw Error('Runner workload identity mismatch');
 const native=artifact.__pivot_profile_read();const data=validateProbe(typeof native==='string'?JSON.parse(native):native);
 const record={format:1,runID:b.runID,workloadID:workload.id,engine,sourceCommit:b.sourceCommit,sourceChecksum:b.sourceChecksum,artifactChecksum:b.artifactChecksum,...(engine==='rust-wasm'?{wasmChecksum:b.wasmChecksum}:{}),runnerChecksum:b.runnerChecksum,...(b.supportChecksum?{supportChecksum:b.supportChecksum}:{}),patchChecksum:b.patchChecksum,inputChecksum:workload.inputChecksum,modelHash:workload.modelHash,resultChecksum:result.resultChecksum,instrumentation:{optIn:true,artifact:'private-profile',clock:'performance.now',perRowTimers:false},controlRunIDs:b.controlRunIDs??[],overhead:{status:'paired-control-report',definition:'Compare alternating same-work clean/profile samples by controlRunIDs; profile durations are attribution only.'},accounting:'inclusive-do-not-sum',events:data.events,counters:data.counters,host:validateProbe(observer.snapshot()),unavailable:['byte-accurate-rss','cache-hits','cache-misses','cache-evictions','aggregate-exclusive-time','all-row-visits']};
 if(!Array.isArray(record.events)||!Array.isArray(record.counters))throw Error('Malformed probe report');
 await mkdir(outputDir,{recursive:true});await writeFile(join(outputDir,`${b.runID}.profile.json`),JSON.stringify(record,null,2)+'\n',{flag:'wx'});return record;
}
