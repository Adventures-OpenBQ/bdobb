// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSnapshots,driverPayload,deadline} from './matched-executors-driver-utils.mjs';
test('normalizes only transport envelopes while retaining user keys and input',()=>{
 const user={requestId:'user',transferId:'user-transfer',batches:7};
 const snapshots=[{ready:{requestId:'request',columns:[{metadata:user}]},block:{rows:{requestId:'rows',rows:[{values:user}]},totals:{requestId:'totals',values:user}},exported:{rows:[{values:user}],batches:3,provenance:user},toleratedColumns:[]}];
 const result=normalizeSnapshots(snapshots);
 assert.equal(result[0].ready.requestId,undefined);assert.equal(result[0].block.rows.requestId,undefined);assert.equal(result[0].block.totals.requestId,undefined);assert.equal(result[0].exported.batches,undefined);
 assert.deepEqual(result[0].ready.columns[0].metadata,user);assert.deepEqual(result[0].block.rows.rows[0].values,user);assert.deepEqual(result[0].exported.provenance,user);assert.equal(snapshots[0].ready.requestId,'request');
});
test('driver transfers exact lossless JSON wire before harness start',()=>{
 const wire={tag:'record',value:[['n',{tag:'f64',value:'-0'}],['b',{tag:'bigint',value:'9007199254740993'}],['u',{tag:'undefined'}]]};
 const payload=driverPayload(wire);assert.equal(typeof payload,'string');assert.deepEqual(JSON.parse(payload),wire);
});
test('deadline rejects stalled operation and accepts completed operation',async()=>{
 assert.equal(await deadline(Promise.resolve(7),50),7);
 await assert.rejects(deadline(new Promise(()=>{}),10),/exceeded 10 ms/);
});
test('timeout closes abandoned execution and never visits another case on that page',async()=>{
 const {visitCasesUntilDeadline}=await import('./matched-executors-driver-utils.mjs');
 const events=[];let active=false,resolvePending;
 const page={run(){events.push('first');active=true;return new Promise(resolve=>{resolvePending=resolve;});},async close(){events.push('close');active=false;resolvePending?.();}};
 const result=await visitCasesUntilDeadline(['first','later'],async name=>{if(name==='first')await deadline(page.run(),10);else events.push('later');},()=>page.close());
 assert.deepEqual(events,['first','close']);assert.equal(active,false);assert.equal(result.aborted,true);assert.deepEqual(result.remaining,['later']);
});
test('owned readiness rejects unrelated healthy server and dead child before page work',async()=>{
 const {waitForOwnedServer,assertOwnedServerAlive}=await import('./matched-executors-driver-utils.mjs');
 const child={exitCode:null,signalCode:null};
 await assert.rejects(waitForOwnedServer(child,async()=>({ok:true,owner:'other'}),'ours',50,1),/ownership/);
 let probed=false;child.exitCode=1;
 await assert.rejects(waitForOwnedServer(child,async()=>{probed=true;return {ok:true,owner:'ours'};},'ours',50,1),/exited/);assert.equal(probed,false);
 child.exitCode=null;await waitForOwnedServer(child,async()=>({ok:true,owner:'ours'}),'ours',50,1);
 child.exitCode=1;assert.throws(()=>assertOwnedServerAlive(child),/exited/);
});
test('real loopback ownership refuses occupied port, accepts its child and detects exit',async()=>{
 const {createServer}=await import('node:http'),{spawn}=await import('node:child_process');
 const {waitForOwnedServer,assertOwnedServerAlive}=await import('./matched-executors-driver-utils.mjs');
 const existing=createServer((_req,res)=>{res.setHeader('X-Pivot-Benchmark-Owner','other');res.end('ready');});
 await new Promise(resolve=>existing.listen(0,'127.0.0.1',resolve));
 const port=existing.address().port;
 const probe=async port=>{const response=await fetch(`http://127.0.0.1:${port}/health`);return {ok:response.ok,owner:response.headers.get('X-Pivot-Benchmark-Owner')};};
 let owned;
 try{
  await assert.rejects(waitForOwnedServer({exitCode:null},()=>probe(port),'ours',50,1),/ownership/);
  const conflict=spawn(process.execPath,['-e',`const s=require('node:http').createServer();s.on('error',e=>{process.stderr.write(e.code);process.exit(17)});s.listen(${port},'127.0.0.1')`],{stdio:['ignore','ignore','pipe']});
  let error='';conflict.stderr.on('data',chunk=>{error+=chunk;});await new Promise(resolve=>conflict.once('exit',resolve));
  assert.equal(error,'EADDRINUSE');await assert.rejects(waitForOwnedServer(conflict,()=>probe(port),'ours',50,1),/exited/);
  owned=spawn(process.execPath,['-e',`const s=require('node:http').createServer((q,r)=>{r.setHeader('X-Pivot-Benchmark-Owner','ours');r.end('ready')});s.listen(0,'127.0.0.1',()=>console.log(s.address().port))`],{stdio:['ignore','pipe','ignore']});
  const ownedPort=Number(await new Promise(resolve=>owned.stdout.once('data',chunk=>resolve(chunk.toString().trim()))));
  await waitForOwnedServer(owned,()=>probe(ownedPort),'ours',1000,1);
  const exited=new Promise(resolve=>owned.once('exit',resolve));owned.kill('SIGTERM');await exited;
  assert.throws(()=>assertOwnedServerAlive(owned),/exited/);
 }finally{owned?.kill('SIGTERM');await new Promise(resolve=>existing.close(resolve));}
});
test('aborted collection is partial and nonzero even with zero failed cases',async()=>{
 const {finishCollection}=await import('./matched-executors-driver-utils.mjs');
 const report={aborted:{code:'SERVER_EXITED'},browsers:{chromium:{cases:[{name:'small',parity:'passed'}]}}};
 assert.equal(finishCollection(report,['chromium'],['small']),1);assert.equal(report.status,'partial');
});
test('missing requested browser or case is explicitly unmeasured and partial',async()=>{
 const {finishCollection}=await import('./matched-executors-driver-utils.mjs');
 const report={browsers:{chromium:{cases:[{name:'small',parity:'passed'}]}}};
 assert.equal(finishCollection(report,['chromium','webkit'],['small','large']),1);
 assert.equal(report.browsers.webkit.notStarted,true);
 assert.equal(report.browsers.webkit.cases.length,2);assert.equal(report.browsers.chromium.cases[1].status,'blocked');
 assert.equal(finishCollection({browsers:{chromium:{cases:[{name:'small',parity:'passed'}]}}},['chromium'],['small']),0);
});
