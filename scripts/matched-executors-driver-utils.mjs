// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Schema-directed: user values and metadata may legitimately have these names.
export function normalizeSnapshots(snapshots){
 const envelope=value=>{const copy={...value};delete copy.requestId;return copy;};
 return snapshots.map(snapshot=>{
  const exported={...snapshot.exported};delete exported.batches;
  return {...snapshot,ready:envelope(snapshot.ready),block:{...snapshot.block,rows:envelope(snapshot.block.rows),totals:envelope(snapshot.block.totals)},exported};
 });
}
export const driverPayload=wire=>JSON.stringify(wire);
export async function deadline(work,milliseconds){
 let timer;
 try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new ObservationDeadlineError(milliseconds)),milliseconds);})]);}
 finally{clearTimeout(timer);}
}
export class ObservationDeadlineError extends Error {
 constructor(milliseconds){super(`Executor observation exceeded ${milliseconds} ms`);this.code='OBSERVATION_DEADLINE';}
}
export const isObservationDeadline=error=>error?.code==='OBSERVATION_DEADLINE';
export const isFatalMeasurementError=error=>isObservationDeadline(error)||error?.code==='SERVER_EXITED';
export async function visitCasesUntilDeadline(cases,visit,close){
 for(let i=0;i<cases.length;i++){
  try{await visit(cases[i]);}catch(error){
   if(!isFatalMeasurementError(error))throw error;
   await close();return {aborted:true,error,remaining:cases.slice(i+1)};
  }
 }
 return {aborted:false};
}
export function assertOwnedServerAlive(child){
 if(child.exitCode!=null||child.signalCode!=null||child.failure){const error=Error(`Owned benchmark server exited: ${child.exitCode??child.signalCode??child.failure?.message}; ${child.errorOutput??''}`);error.code='SERVER_EXITED';throw error;}
}
export async function waitForOwnedServer(child,probe,owner,timeoutMs=60000,pollMs=500){
 const start=Date.now();
 for(;;){
  assertOwnedServerAlive(child);
  let health;try{health=await probe();}catch{/* Loopback listener may still be building. */}
  assertOwnedServerAlive(child);
  if(health?.ok){if(health.owner!==owner)throw Error('Benchmark server ownership mismatch: refusing unrelated assets');return;}
  if(Date.now()-start>=timeoutMs)throw Error('Owned benchmark server readiness deadline exceeded');
  await new Promise(resolve=>setTimeout(resolve,pollMs));
 }
}
export function finishCollection(report,browsers,names){
 for(const browser of browsers){
  if(!report.browsers[browser])report.browsers[browser]={notStarted:true,cases:[]};
  const result=report.browsers[browser];
  for(const name of names)if(!result.cases.some(c=>c.name===name))result.cases.push({name,status:'blocked',parity:'not run',timingsExcluded:true,reason:'Requested browser/case did not run after collection abort'});
 }
 report.failedCases=Object.entries(report.browsers).flatMap(([browser,result])=>result.cases.filter(c=>['failed','blocked'].includes(c.status)).map(c=>({browser,name:c.name,stage:c.stage,error:c.error??c.reason})));
 report.status=report.aborted||Object.values(report.browsers).some(result=>result.aborted)||report.failedCases.length?'partial':'passed';
 return report.status==='partial'?1:0;
}
