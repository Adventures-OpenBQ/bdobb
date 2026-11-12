// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRecorder, exclusiveTotal, validateArtifact, collectProfile} from './profile.mjs';
import {applyPinnedPatch} from './profiling-build.mjs';
test('inclusive overlapping stages cannot be summed as an exclusive total',()=>{
 assert.throws(()=>exclusiveTotal([{id:'a',name:'prepare',startMs:0,endMs:5},{id:'b',name:'category',startMs:1,endMs:4,parentId:'a'}]),/overlap/);
 assert.equal(exclusiveTotal([{startMs:0,endMs:1},{startMs:1,endMs:3}]),3);
});
test('unknown counters remain absent; finite boundary counters have unit/scope',()=>{
 const recorder=createRecorder();recorder.count('rows',4,'rows','source-evaluation');
 assert.deepEqual(recorder.snapshot().counters,[{name:'rows',value:4,unit:'rows',scope:'source-evaluation'}]);
 assert.equal(recorder.snapshot().counters.find(c=>c.name==='cache-hits'),undefined);
});
test('instrumented artifacts cannot be labeled clean',()=>{
 assert.throws(()=>validateArtifact({instrumented:false},{__pivot_profile_reset(){}}),/clean/);
 assert.throws(()=>validateArtifact({instrumented:true},{}),/probe/);
});
test('patch refuses unmatched source even when a textual anchor exists',()=>{
 assert.throws(()=>applyPinnedPatch('original',{sha256:'0'.repeat(64),edits:[{from:'original',to:'changed'}]}),/checksum/);
});
test('recorder closes nested throwing stages and reports inclusive accounting',()=>{
 const r=createRecorder();assert.throws(()=>r.measure('outer',()=>r.measure('inner',()=>{throw Error('control');})),/control/);
 const s=r.snapshot();assert.equal(s.events.length,2);assert.equal(s.events[1].parentId,s.events[0].id);assert.equal(s.accounting,'inclusive-do-not-sum');
});
test('collection rejects unbound descriptors before loading arbitrary runners',async()=>{
 await assert.rejects(()=>collectProfile({id:'x'},{engine:'typescript',buildIdentity:{},outputDir:'/tmp'}),/identity/);
});
test('probe rejects extra fields and invalid accounting instead of emitting source values',async()=>{
 const {validateProbe}=await import('./profile.mjs');
 assert.throws(()=>validateProbe({accounting:'exclusive',events:[],counters:[]}),/Malformed/);
 assert.throws(()=>validateProbe({accounting:'inclusive-do-not-sum',events:[{id:'0',name:'compile',startMs:0,endMs:1,rawRow:{value:5}}],counters:[]}),/Invalid stage/);
 assert.throws(()=>validateProbe({accounting:'inclusive-do-not-sum',events:[{id:'0',name:'compile',startMs:0,endMs:1,parentId:'missing'}],counters:[]}),/parent/);
});

test('optional isolated clean/profile SEC and tiny tick public controls', {skip:!process.env.PIVOT_PROFILE_DIR}, async()=>{
 const {runControls}=await import('./profile-controls.mjs');
 const report=await runControls(process.env.PIVOT_PROFILE_CLEAN_DIR,process.env.PIVOT_PROFILE_DIR,process.env.PIVOT_PROFILE_OUTPUT_DIR);
 for(const engine of ['typescript','rust-wasm'])assert.equal(report.controls.filter(c=>c.engine===engine).reduce((n,c)=>n+c.independentCells,0),110);
 assert.equal(report.samples.length,140);
 assert.equal(report.controlDefinitions.length,7);
 for(const observation of [...report.samples,...report.controls]){const definition=report.controlDefinitions.find(d=>d.id===observation.controlIdentity);assert.ok(definition);assert.equal(definition.workloadID,observation.workloadID??observation.id);assert.equal(definition.runnerChecksum,report.runnerChecksum);for(const field of ['inputChecksum','modelHash','expectedChecksum'])assert.match(definition[field],/^[a-f0-9]{64}$/);if(definition.workloadID.startsWith('sec-'))for(const field of ['referenceFixtureChecksum','expectedFixtureChecksum'])assert.match(definition[field],/^[a-f0-9]{64}$/);}
 assert.ok(report.controlDefinitions.every(d=>!Object.hasOwn(d,'dataset')&&!Object.hasOwn(d,'definition')));
});

test('paired controls reject stale clean bytes and incorrect roles before any artifact import', async()=>{
 const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {checksum}=await import('./profiling-build.mjs');
 const {runControls}=await import('./profile-controls.mjs');
 const root=await mkdtemp(join(tmpdir(),'p2-identity-'));
 const text='throw new Error("ARTIFACT_IMPORTED_BEFORE_VERIFICATION");';
 async function fixture(name,instrumented){const dir=join(root,name);await mkdir(join(dir,'wasm'),{recursive:true});for(const file of ['typescript.mjs','wasm/pivot_wasm.js','wasm/pivot_wasm_bg.wasm'])await writeFile(join(dir,file),text);const identity={format:1,instrumented,sourceCommit:'a'.repeat(40),sourceChecksum:'b'.repeat(64),patchChecksum:'c'.repeat(64),pins:{rust:'1.98.1',wasmBindgen:'0.2.128',target:'wasm32-unknown-unknown',wasmBindgenTarget:'web',protocolVersion:1,sharedMemory:false},typescriptChecksum:checksum(text),artifactChecksum:checksum(text),wasmChecksum:checksum(text)};await writeFile(join(dir,'identity.json'),JSON.stringify(identity));return {dir,identity};}
 try{
  const clean=await fixture('clean',false),profile=await fixture('profile',true);
  for(const file of ['typescript.mjs','wasm/pivot_wasm.js','wasm/pivot_wasm_bg.wasm']){await writeFile(join(clean.dir,file),text+' ');await assert.rejects(()=>runControls(clean.dir,profile.dir,join(root,'out')),/artifact checksum mismatch/);await writeFile(join(clean.dir,file),text);}
  await writeFile(join(profile.dir,'wasm/pivot_wasm_bg.wasm'),text+' ');await assert.rejects(()=>runControls(clean.dir,profile.dir,join(root,'out')),/artifact checksum mismatch/);await writeFile(join(profile.dir,'wasm/pivot_wasm_bg.wasm'),text);
  for(const entry of [clean,profile]){await writeFile(join(entry.dir,'identity.json'),JSON.stringify({...entry.identity,instrumented:!entry.identity.instrumented}));await assert.rejects(()=>runControls(clean.dir,profile.dir,join(root,'out')),/artifact role/);await writeFile(join(entry.dir,'identity.json'),JSON.stringify(entry.identity));}
  await writeFile(join(profile.dir,'identity.json'),JSON.stringify({...profile.identity,sourceChecksum:'d'.repeat(64)}));await assert.rejects(()=>runControls(clean.dir,profile.dir,join(root,'out')),/source identity mismatch/);
  await writeFile(join(profile.dir,'identity.json'),JSON.stringify({...profile.identity,pins:{...profile.identity.pins,rust:'different'}}));await assert.rejects(()=>runControls(clean.dir,profile.dir,join(root,'out')),/toolchain/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('control identities change for altered data, model, runner, oracle and lossless values',async()=>{
 const {controlIdentity,controls}=await import('./profile-controls.mjs');
 const {encodeWire}=await import('../../src/lib/tableExecution/rust/wireCodec.ts');
 assert.equal(typeof controlIdentity,'function');
 const original=(await controls())[0],runner='a'.repeat(64);
 const identity=controlIdentity(original,runner,encodeWire);
 const changed=structuredClone(original);changed.dataset.rows[0].values.additionalValue=1;
 assert.notEqual(controlIdentity(changed,runner,encodeWire).id,identity.id);
 changed.dataset=original.dataset;changed.definition.search='changed';
 assert.notEqual(controlIdentity(changed,runner,encodeWire).id,identity.id);
 assert.notEqual(controlIdentity(original,'b'.repeat(64),encodeWire).id,identity.id);
 const runtime=structuredClone(original);runtime.runtimeParams={};assert.notEqual(controlIdentity(runtime,runner,encodeWire).modelHash,identity.modelHash);
 const oracle=structuredClone(original);oracle.expected.additionalYear={line:'0'};
 assert.notEqual(controlIdentity(oracle,runner,encodeWire).id,identity.id);
 const fixture=structuredClone(original);fixture.oracleSource.referenceFixtureChecksum='c'.repeat(64);assert.notEqual(controlIdentity(fixture,runner,encodeWire).id,identity.id);
 const special=structuredClone(original);special.dataset.rows[0].values.additionalValue=-0;
 const minusZero=controlIdentity(special,runner,encodeWire);special.dataset.rows[0].values.additionalValue=0;
 assert.notEqual(controlIdentity(special,runner,encodeWire).inputChecksum,minusZero.inputChecksum);
 assert.ok(!JSON.stringify(identity).includes('60922000000'));
});

test('TS collection rejects optional support fields before artifact access',async()=>{
 const sha='a'.repeat(64);
 const base={runID:'report-only',sourceCommit:'a'.repeat(40),sourceChecksum:sha,artifactChecksum:sha,runnerChecksum:sha,patchChecksum:sha,instrumented:true,controlRunIDs:['control'],artifactPath:'/does-not-exist',runnerPath:'/does-not-exist'};
 for(const support of [{supportChecksum:'invalid'},{supportChecksum:sha},{supportChecksum:''},{supportPath:'/does-not-exist'}]){
  await assert.rejects(collectProfile({id:'report-only',inputChecksum:sha,modelHash:sha},{engine:'typescript',buildIdentity:{...base,...support},outputDir:'/does-not-exist'}),/TypeScript support fields are unsupported/);
 }
});
test('P2 financial control compares converted reference numbers exactly',async()=>{
 const {check}=await import('./profile-controls.mjs');
 const control={id:'report-only',expected:{2026:{Revenue:'0.1'}}};
 const result=value=>({ready:{kind:'viewReady',columns:[{id:'fy',splitPath:[{value:'FY2026'}]}]},blocks:[{rows:[{groupPath:[{value:'Revenue'}],values:{fy:value}}]}]});
 assert.equal(check(control,result(0.1)),1);
 for(const value of [0.1+5e-13,'0.1'])assert.throws(()=>check(control,result(value)),/report-only/);
 control.expected[2026].Revenue='-0';
 assert.equal(check(control,result(-0)),1);
 assert.throws(()=>check(control,result(0)),/report-only/);
});
