// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runChild,childObservations} from './child-process.mjs';
async function fixture(body,timeoutMs=2000,options={}){
 const directory=await mkdtemp(join(tmpdir(),'pivot-child-'));
 const path=join(directory,'worker.mjs'),journalPath=join(directory,'events.jsonl');
 await writeFile(path,`const emit=e=>console.log(JSON.stringify(e));\n${body}`);
 try{const result=await runChild(path,{}, {timeoutMs,journalPath,...options});const journal=await readFile(journalPath,'utf8');if(result.observer?.status==='completed')await rm(result.observer.spoolDirectory,{recursive:true,force:true});return {result,journal};}finally{await rm(directory,{recursive:true,force:true});}
}
const cold="emit({type:'observation',observation:{temperature:'cold',status:'passed',resultChecksum:'verified-cold'}});";
test('cold completed sample survives a warm exception with actual stage',async()=>{
 const {result,journal}=await fixture(`${cold}emit({type:'phase',temperature:'warm',stage:'compute'});throw Error('warm exploded');`);
 assert.equal(result.observations.length,1);assert.equal(result.observations[0].resultChecksum,'verified-cold');
 assert.equal(result.temperature,'warm');assert.equal(result.failureStage,'compute');assert.equal(result.outcome,'execution-failure');assert.match(result.error,/warm exploded/);
 const report=childObservations(result,'baseline',0);assert.equal(report.length,2);assert.equal(report[0].status,'passed');assert.equal(report[1].temperature,'warm');assert.equal(report[1].failureStage,'compute');assert.equal(report[1].status,'failed');
 assert.equal(JSON.parse(journal.trim().split('\n')[0]).observation.resultChecksum,'verified-cold');
});
test('cold completed sample survives a warm timeout and remains journaled',async()=>{
 const {result,journal}=await fixture(`${cold}emit({type:'phase',temperature:'warm',stage:'filterReselection'});setInterval(()=>{},1000);`,500);
 assert.equal(result.observations.length,1);assert.equal(result.temperature,'warm');assert.equal(result.failureStage,'filterReselection');assert.equal(result.outcome,'timeout');assert.match(journal,/verified-cold/);
 const report=childObservations(result,'candidate',1);assert.equal(report.length,2);assert.equal(report[1].temperature,'warm');assert.equal(report[1].outcome,'timeout');assert.equal(report[1].status,'not-run');
});
test('successful cold and warm are retained after explicit completion',async()=>{
 const {result}=await fixture(`${cold}emit({type:'observation',observation:{temperature:'warm',status:'passed'}});emit({type:'done'});`);
 assert.deepEqual(result.observations.map(o=>o.temperature),['cold','warm']);assert.equal(result.outcome,undefined);
});
test('reported warm resource refusal preserves completed cold sample',async()=>{
 const {result}=await fixture(`${cold}emit({type:'phase',temperature:'warm',stage:'compute'});emit({type:'failure',outcome:'profile-refused',error:'budget',memory:{peakRssBytes:200,wasmBufferBytes:100}});`);
 assert.equal(result.observations.length,1);assert.equal(result.temperature,'warm');assert.equal(result.failureStage,'compute');assert.equal(result.outcome,'profile-refused');assert.equal(result.memory.wasmBufferBytes,100);
});

test('sampled process tree and process identity survive child completion',async()=>{
 const {result,journal}=await fixture(`${cold}await new Promise(r=>setTimeout(r,300));emit({type:'done'});`,2000,{sampleIntervalMs:100});
 assert.ok(Number.isInteger(result.process.pid));
 assert.ok(result.process.samples.length>=1);
 assert.ok(result.process.samples.every(s=>new Set(s.processes.map(p=>p.pid)).size===s.processes.length));
 assert.ok(result.process.sampledTreePeakBytes>0);
 assert.equal(result.process.intervalMs,100);
 assert.match(journal,/processSample/);
});

test('unobserved child retains null sampled peak and an explicit unavailable reason',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'pivot-missing-ps-'));const oldPath=process.env.PATH;
 try{
  await writeFile(join(directory,'ps'),'#!/bin/sh\nexit 0\n',{mode:0o755});process.env.PATH=directory;
  const {result}=await fixture(`await new Promise(r=>setTimeout(r,250));emit({type:'done'});`,2000,{sampleIntervalMs:100});
  assert.ok(result.process.samples.length>0);assert.equal(result.process.sampledTreePeakBytes,null);assert.ok(result.process.samples.every(s=>s.status==='unavailable'&&s.treeRssBytes===null&&s.reason));
 }finally{process.env.PATH=oldPath;await rm(directory,{recursive:true,force:true});}
});

async function observerControl(mode){
 const {promisify}=await import('node:util');const {execFile}=await import('node:child_process');
 const dir=await mkdtemp(join(tmpdir(),'pivot-observer-control-'));
 try{
  const script=`
import * as syncFs from 'node:fs';import * as fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';import {join} from 'node:path';
const dir=${JSON.stringify(dir)},mode=${JSON.stringify(mode)},delay=ms=>new Promise(r=>setTimeout(r,ms));
const originalSync=syncFs.fsyncSync,originalOpen=fs.open;syncFs.default.fsyncSync=fd=>{if(mode==='slow-writer'||mode==='work-timeout')Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,200);return originalSync(fd);};
fs.default.open=async(path,...args)=>{
 const handle=await originalOpen(path,...args);return new Proxy(handle,{get(target,key){if(key==='sync')return async()=>{if(mode==='slow-writer'||mode==='work-timeout')await delay(200);if(mode==='archive-failure'&&String(path).endsWith('/events.jsonl'))throw Object.assign(Error('controlled archive EIO'),{code:'EIO'});return target.sync();};const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;}});
};syncBuiltinESMExports();
const {runChild,childObservations}=await import(${JSON.stringify(new URL('./child-process.mjs',import.meta.url).href)});
const worker=join(dir,'worker.mjs');await fs.writeFile(worker,"const emit=e=>console.log(JSON.stringify(e));for(let i=0;i<6;i++)emit({type:'phase',temperature:'cold',stage:'compute'});emit({type:'observation',observation:{temperature:'cold',status:'passed'}});"+(mode==='work-timeout'?"setInterval(()=>{},1000);":"emit({type:'done'});"));
let beats=0;const timer=setInterval(()=>beats++,10);const r=await runChild(worker,{}, {timeoutMs:1000,journalPath:join(dir,'events.jsonl')});clearInterval(timer);
const spool=r.observer?.spoolPath?await fs.readFile(r.observer.spoolPath,'utf8'):null;
console.log(JSON.stringify({result:r,observations:childObservations(r,'baseline',0),beats,spool}));
if(r.observer?.spoolDirectory)await fs.rm(r.observer.spoolDirectory,{recursive:true,force:true});
`;
  await writeFile(join(dir,'control.mjs'),script);const {stdout}=await promisify(execFile)(process.execPath,['--experimental-test-module-mocks',join(dir,'control.mjs')],{maxBuffer:1000000});return JSON.parse(stdout.trim());
 }finally{await rm(dir,{recursive:true,force:true});}
}
test('slow durable journal keeps timers responsive and cannot turn done into work timeout',async()=>{
 const r=await observerControl('slow-writer');assert.notEqual(r.result.outcome,'timeout');assert.ok(r.beats>=10,'Journal blocked coordinator timers');assert.equal(r.result.observations.length,1);assert.ok(r.result.observer);assert.equal(r.result.observer.status,'incomplete');assert.equal(r.result.observer.archiveStatus,'completed');assert.equal(r.result.observer.archiveSha256,r.result.observer.spoolSha256);assert.equal(r.result.observer.spoolSha256,r.result.observer.expectedSha256);assert.ok(r.result.process.doneElapsedMs<1000);assert.match(r.spool,/"type":"done"/);assert.ok(r.result.observer.spoolWriteMs>=80);
});
test('archive failure preserves recoverable spool and completed samples without acceptance',async()=>{
 const r=await observerControl('archive-failure');assert.equal(r.result.observations.length,1);assert.equal(r.result.observer?.status,'incomplete');assert.equal(r.result.observer?.archiveStatus,'failed');assert.match(r.spool,/"type":"observation"/);assert.ok(r.observations.some(o=>o.outcome==='observer-incomplete'&&o.status==='not-run'));assert.ok(r.result.observer.errors.some(e=>/EIO/.test(e)));
});
test('one slow sampler is cancelled at terminal work without stale polls or false work timeout',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'pivot-slow-ps-')),oldPath=process.env.PATH;
 try{await writeFile(join(directory,'ps'),'#!/bin/sh\nexec /bin/sleep 3\n',{mode:0o755});process.env.PATH=directory;
  const {result}=await fixture(`await new Promise(r=>setTimeout(r,350));${cold}emit({type:'done'});`,1000,{sampleIntervalMs:100});
  assert.notEqual(result.outcome,'timeout');assert.equal(result.observations.length,1);assert.ok(result.observer);assert.equal(result.observer.samplerPolls,1);assert.ok(result.observer.samplerSkipped>0);assert.equal(result.process.sampledTreePeakBytes,null);assert.ok(result.process.samples.every(s=>s.status==='unavailable'));
 }finally{process.env.PATH=oldPath;await rm(directory,{recursive:true,force:true});}
});

test('genuine work deadline still terminates a hung child while journal IO is slow',async()=>{
 const r=await observerControl('work-timeout');assert.equal(r.result.outcome,'timeout');assert.equal(r.result.observations.length,1);assert.ok(r.result.process.exitElapsedMs<1500,'Work deadline was extended by observer IO');assert.ok(r.beats>=10);assert.match(r.spool,/"type":"observation"/);
});

test('process tree uses unique descendants and rejects conflicts, absent root stays unknown',async()=>{
 const {processTreeSnapshot}=await import('./process-tree.mjs');
 const s=processTreeSnapshot('1 0 1\n4 1 10\n5 4 20\n5 4 20\n6 5 30\n7 1 40',4);
 assert.deepEqual(s.processes.map(p=>p.pid),[4,5,6]);assert.equal(s.treeRssBytes,60*1024);
 assert.throws(()=>processTreeSnapshot('4 1 10\n4 1 11',4));
 const missing=processTreeSnapshot('1 0 1',4);assert.equal(missing.status,'unavailable');assert.equal(missing.treeRssBytes,null);assert.deepEqual(missing.processes,[]);assert.ok(missing.reason);
});
