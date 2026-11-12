// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
export {performanceActions,validatePerformanceActions,processTreeSnapshot} from './performance-common.mjs';

/** A matrix is an index of existing v1 qualification reports, not a second result schema. */
export async function runPerformanceMatrix(manifest,{engine,output,manifestDirectory=process.cwd()}){
 const {readFile,writeFile,mkdir}=await import('node:fs/promises');
 const {resolve,join,dirname}=await import('node:path');
 const {runBenchmark,checksumFile}=await import('./benchmark.mjs');
 const {hashJSON,validateRun}=await import('./report.mjs');
 assert.equal(manifest.version,1);assert.ok(['typescript','rust'].includes(engine));
 assert.ok(Array.isArray(manifest.cases)&&manifest.cases.length>0);
 assert.equal(manifest.batches,2,'Two independent batches required');
 assert.equal(manifest.samples,5,'Five observations per feasible case required');
 assert.ok(Number.isInteger(manifest.sampleIntervalMs)&&manifest.sampleIntervalMs>=100&&manifest.sampleIntervalMs<=5000);
 assert.ok(typeof manifest.backgroundWork==='string'&&manifest.backgroundWork.length,'Record background work limitation');
 const checked=async entry=>{assert.match(entry?.sha256??'',/^[a-f0-9]{64}$/);const path=resolve(manifestDirectory,entry.path);assert.equal(await checksumFile(path),entry.sha256,'Matrix file checksum mismatch');return path;};
 const cases=[];
 for(const entry of manifest.cases){const path=await checked(entry);const workload=JSON.parse(await readFile(path,'utf8'));assert.match(workload.id??'',/^[a-z0-9][a-z0-9._-]*$/i);assert.equal(workload.reference?.independent,true,'Independent correctness validation required');cases.push({entry,path,workload});}
 assert.equal(new Set(cases.map(c=>c.workload.id)).size,cases.length,'Duplicate case');
 const artifactDirectory=manifest.cleanArtifact?dirname(await checked(manifest.cleanArtifact)):undefined;
 const profileDirectory=manifest.profileArtifact?dirname(await checked(manifest.profileArtifact)):undefined;
 if(artifactDirectory||profileDirectory){const {verifyPerformanceArtifacts}=await import('./profiling-build.mjs');if(artifactDirectory)assert.equal((await verifyPerformanceArtifacts({directory:artifactDirectory})).identity.instrumented,false,'Timing artifact must be clean');if(profileDirectory)assert.equal((await verifyPerformanceArtifacts({directory:profileDirectory})).identity.instrumented,true,'Attribution artifact must have probes');}
 output=resolve(output);await mkdir(output,{recursive:false});
 const index={version:1,kind:'qualification-run-index',engine,manifestChecksum:hashJSON(manifest),backgroundWork:manifest.backgroundWork,records:[],limitations:['No optimization or speed claim; same-source calibration.','Node handler transport is not browser/native qualification.','Independent batches use fresh processes but share machine and background load.','Profile stages are inclusive; unknown exclusive/cache costs remain unknown.']};
 const refused=new Map();const cleanReports=new Map();
 const save=()=>writeFile(join(output,'index.json'),JSON.stringify(index,null,2)+'\n');
 await save();
 for(let batch=0;batch<2;batch++)for(const c of cases){
  const id=c.workload.id;
  if(refused.has(id)){index.records.push({id,batch,status:'not-run',reason:'Prior refusal/failure/timeout: no repeated attempts',qualification:refused.get(id)});await save();continue;}
  await checked(c.entry);
  const directory=join(output,`batch-${batch}`,id);
  const report=await runBenchmark(c.workload,{engine,workload:c.workload.kind,output:directory,manifestDirectory:dirname(c.path),samples:5,performance:{artifactDirectory,sampleIntervalMs:manifest.sampleIntervalMs}});
  validateRun(report);
  const path=join(directory,`${id}-${engine}.json`),qualification={path,sha256:await checksumFile(path)};
  index.records.push({id,batch,status:report.status,qualification,...(report.status!=='passed'?{omitted:{remainingObservations:'not-run',remainingWarmActions:'not-run',reason:'Stopped at first refusal/failure/timeout'}}:{})});
  if(report.status!=='passed'){refused.set(id,qualification);cleanReports.delete(id);}else cleanReports.set(id,{report,qualification});
  await save();
 }
 if(profileDirectory)for(const c of cases){
  const id=c.workload.id,clean=cleanReports.get(id);
  if(refused.has(id)||!clean){index.records.push({id,role:'attribution',status:'not-run',reason:'Clean trace did not complete'});await save();continue;}
  const directory=join(output,'attribution',id);
  const report=await runBenchmark(c.workload,{engine,workload:c.workload.kind,output:directory,manifestDirectory:dirname(c.path),samples:1,performance:{artifactDirectory:profileDirectory,sampleIntervalMs:manifest.sampleIntervalMs}});
  const path=join(directory,`${id}-${engine}.json`),qualification={path,sha256:await checksumFile(path)};
  let parityError;
  if(report.status==='passed'){try{
   for(const observation of report.observations){const control=clean.report.observations.find(o=>o.temperature===observation.temperature&&o.variant===observation.variant);assert.ok(control);assert.deepEqual(observation.trace.map(t=>[t.action,t.modelChecksum,t.resultChecksum,t.consumers]),control.trace.map(t=>[t.action,t.modelChecksum,t.resultChecksum,t.consumers]),'Clean/profile action and consumer parity');}
  }catch(error){parityError=error;}}
  index.records.push({id,role:'attribution',status:parityError?'failed':report.status,qualification,cleanQualification:clean.qualification,parity:parityError?'failed':report.status==='passed'?'passed':'not-run',accepted:report.status==='passed'&&!parityError,...(parityError?{reason:`Clean/profile parity rejected: ${parityError}`}:{ }),exploratory:true});await save();
  if(parityError)throw parityError;
 }
 return index;
}

// CLI orchestration is separate from the pure helpers imported by workers.
if(process.argv[1]?.endsWith('/run-performance-matrix.mjs')){
 const {readFile}=await import('node:fs/promises');const {resolve,dirname}=await import('node:path');const {fileURLToPath}=await import('node:url');
 if(resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=Object.fromEntries(Array.from({length:(process.argv.length-2)/2},(_,i)=>[process.argv[2+i*2].replace(/^--/,''),process.argv[3+i*2]]));
  assert.deepEqual(Object.keys(args).sort(),['engine','manifest','output']);
  const manifest=JSON.parse(await readFile(args.manifest,'utf8'));
  const index=await runPerformanceMatrix(manifest,{...args,manifestDirectory:dirname(resolve(args.manifest))});
  console.log(JSON.stringify({records:index.records.length,status:index.records.some(r=>r.status==='failed')?'failed':'recorded'}));
  if(index.records.some(r=>r.status==='failed'))process.exitCode=1;
 }
}
