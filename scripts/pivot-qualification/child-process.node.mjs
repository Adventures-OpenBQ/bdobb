// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runChild,childObservations} from './child-process.mjs';
async function fixture(body,timeoutMs=2000){
 const directory=await mkdtemp(join(tmpdir(),'pivot-child-'));
 const path=join(directory,'worker.mjs'),journalPath=join(directory,'events.jsonl');
 await writeFile(path,`const emit=e=>console.log(JSON.stringify(e));\n${body}`);
 try{return {result:await runChild(path,{}, {timeoutMs,journalPath}),journal:await readFile(journalPath,'utf8')};}finally{await rm(directory,{recursive:true,force:true});}
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
