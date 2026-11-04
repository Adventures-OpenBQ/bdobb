// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';
import {open,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import {processTreeSnapshot} from './process-tree.mjs';
import {STAGES,unavailable} from './report.mjs';

/** Work and observer completion are separate. Every accepted event is queued to
 * an async durable local spool; return waits for flush and checked publication.
 * A failed observer preserves its spool and completed samples, never a fake pass. */
export async function runChild(bundle,request,{timeoutMs,journalPath,identity,sampleIntervalMs}){
 if(sampleIntervalMs!==undefined)assert.ok(Number.isInteger(sampleIntervalMs)&&sampleIntervalMs>=100&&sampleIntervalMs<=5000);
 // Reserve exclusive publication before executing work; never overwrite evidence.
 const archive=await open(journalPath,'wx');
 const spoolDirectory=await mkdtemp(join(tmpdir(),'pivot-qualification-spool-'));
 const spoolPath=join(spoolDirectory,basename(journalPath)+'.spool');
 const spool=await open(spoolPath,'wx');
 await writeFile(join(spoolDirectory,'recovery.json'),JSON.stringify({journalPath,spoolPath,identity})+'\n');
 const observer={status:'pending',spoolDirectory,spoolPath,archivePath:journalPath,storage:'OS temporary spool; asynchronous checked external publication',archiveStatus:'pending',expectedSha256:null,spoolSha256:null,archiveSha256:null,spoolWriteMs:0,archiveMs:0,flushMs:0,events:0,bytes:0,peakQueuedBytes:0,samplerPolls:0,samplerSkipped:0,samplerTimeoutMs:2000,errors:[]};
 let journalTail=Promise.resolve(),queuedBytes=0;const expectedHash=createHash('sha256');
 const journal=event=>{
  const bytes=Buffer.from(JSON.stringify(event)+'\n');expectedHash.update(bytes);observer.events++;observer.bytes+=bytes.length;queuedBytes+=bytes.length;observer.peakQueuedBytes=Math.max(observer.peakQueuedBytes,queuedBytes);
  journalTail=journalTail.then(async()=>{const start=performance.now();try{await spool.writeFile(bytes);await spool.sync();}catch(error){observer.errors.push(`spool: ${error}`);}finally{observer.spoolWriteMs+=performance.now()-start;queuedBytes-=bytes.length;}});
 };
 if(identity)journal({type:'identity',identity});
 const result=await new Promise(resolve=>{
  const observations=[];let phase={temperature:'cold',failureStage:'acquisitionParse'};
  let pending='',stderr='',bytes=0,failure,done=false,parentFailure=false,closed=false,forcedTerminalExit=false;
  const child=spawn(process.execPath,[bundle],{stdio:['pipe','pipe','pipe'],env:{...process.env,NODE_OPTIONS:''}});
  const processStart=performance.now();
  const processRecord={id:randomUUID(),pid:child.pid??null,intervalMs:sampleIntervalMs??null,method:'ps -axo pid=,ppid=,rss=; unique PID descendants; KiB to bytes',samples:[],errors:[],sampledTreePeakBytes:null,doneElapsedMs:null,exitElapsedMs:null};
  if(sampleIntervalMs)journal({type:'processIdentity',id:processRecord.id,pid:child.pid});
  let sampling=Promise.resolve(),samplingBusy=false,samplingStopped=false,sampler,samplerAbort,exitTimer;
  const stopSampling=()=>{samplingStopped=true;clearInterval(sampler);samplerAbort?.abort();};
  const sample=()=>{
   if(closed||done||samplingStopped)return;if(samplingBusy){observer.samplerSkipped++;return;}
   samplingBusy=true;observer.samplerPolls++;const started=performance.now();samplerAbort=new AbortController();
   sampling=(async()=>{
    let snapshot;
    try{
     const {stdout}=await promisify(execFile)('ps',['-axo','pid=,ppid=,rss='],{timeout:2000,killSignal:'SIGKILL',maxBuffer:4000000,signal:samplerAbort.signal});
     snapshot=done||closed?{status:'unavailable',reason:'Sampler completed after terminal work; stale poll excluded',processes:[],treeRssBytes:null}:processTreeSnapshot(stdout,child.pid);
    }catch(error){
     const cancelled=samplingStopped||done||closed;const reason=cancelled?'Sampler cancelled at terminal work; no RSS observation':`Sampler failed or exceeded 2000 ms: ${error}`;
     snapshot={status:'unavailable',reason,processes:[],treeRssBytes:null};
     if(!cancelled){processRecord.errors.push(reason);observer.errors.push(reason);}
    }finally{samplingBusy=false;}
    snapshot={elapsedMs:performance.now()-processStart,collectionMs:performance.now()-started,...snapshot};
    processRecord.samples.push(snapshot);if(snapshot.status==='measured')processRecord.sampledTreePeakBytes=Math.max(processRecord.sampledTreePeakBytes??0,snapshot.treeRssBytes);
    journal({type:'processSample',...snapshot});
   })();
  };
  const fail=(outcome,error,extra={})=>{if(failure)return;parentFailure=true;failure={...phase,outcome,error,...extra};journal({type:'parentFailure',...failure});};
  const timer=setTimeout(()=>{if(done||closed)return;fail('timeout','Fresh-process work deadline exceeded');stopSampling();child.kill('SIGKILL');},timeoutMs);
  const accept=event=>{
   assert.ok(!done&&(!failure||parentFailure),'Event after terminal child result');
   switch(event.type){
    case 'phase':
     assert.ok(['cold','warm'].includes(event.temperature));assert.ok([...STAGES,'disposal'].includes(event.stage));journal(event);phase={temperature:event.temperature,failureStage:event.stage};if(parentFailure)Object.assign(failure,phase);break;
    case 'observation':assert.ok(['cold','warm'].includes(event.observation?.temperature));journal(event);observations.push(event.observation);break;
    case 'failure':journal(event);if(!parentFailure)failure={...phase,outcome:event.outcome,error:event.error,...(event.memory?{memory:event.memory}:{})};break;
    case 'done':
     journal(event);done=true;processRecord.doneElapsedMs=performance.now()-processStart;clearTimeout(timer);stopSampling();
     // A reported terminal result cannot later become a work timeout. Bound any
     // lingering process separately within the original deadline (no extension).
     exitTimer=setTimeout(()=>{if(!closed){observer.errors.push('Child reported done but did not exit within original work deadline');forcedTerminalExit=true;child.kill('SIGKILL');}},Math.max(1,timeoutMs-processRecord.doneElapsedMs));break;
    default:throw Error('Unknown child protocol event');
   }
  };
  if(sampleIntervalMs){sampler=setInterval(sample,sampleIntervalMs);sample();}
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',data=>{
   bytes+=data.length;if(bytes>4000000){fail('execution-failure','Child protocol output exceeded bound');stopSampling();child.kill('SIGKILL');return;}
   pending+=data;
   for(let end;(end=pending.indexOf('\n'))>=0;){const line=pending.slice(0,end);pending=pending.slice(end+1);if(!line)continue;try{accept(JSON.parse(line));}catch(error){fail('execution-failure',`Child protocol error: ${error}`);stopSampling();child.kill('SIGKILL');}}
  });
  child.stderr.on('data',data=>{stderr=(stderr+data).slice(-10000);});
  child.on('error',error=>fail('environment-failure',String(error)));
  child.on('close',async(code,signal)=>{
   closed=true;processRecord.exitElapsedMs=performance.now()-processStart;clearTimeout(timer);clearTimeout(exitTimer);stopSampling();await sampling;
   if(!failure&&(!done||pending.trim()||(code!==0&&!forcedTerminalExit)))fail('execution-failure',stderr||`Incomplete child protocol (exit ${code}, signal ${signal})`);
   if(parentFailure)journal({type:'terminalFailure',...failure});
   if(sampleIntervalMs&&processRecord.sampledTreePeakBytes===null)observer.errors.push('No root-containing RSS snapshot; sampling incomplete, not an engine failure');
   resolve({observations,process:processRecord,...failure});
  });
  child.stdin.on('error',()=>{/* close/error produces the correlated result */});child.stdin.end(JSON.stringify(request));
 });
 // No synchronous IO on the coordinator event loop, including post-work flush.
 const flushStart=performance.now();await journalTail;
 try{await spool.sync();}catch(error){observer.errors.push(`spool final sync: ${error}`);}finally{await spool.close().catch(error=>observer.errors.push(`spool close: ${error}`));}
 observer.flushMs=performance.now()-flushStart;observer.expectedSha256=expectedHash.digest('hex');
 const archiveStart=performance.now();
 try{
  const bytes=await readFile(spoolPath);observer.spoolSha256=createHash('sha256').update(bytes).digest('hex');assert.equal(observer.spoolSha256,observer.expectedSha256,'Spool lost accepted journal events');
  await archive.writeFile(bytes);await archive.sync();await archive.close();
  observer.archiveSha256=createHash('sha256').update(await readFile(journalPath)).digest('hex');assert.equal(observer.archiveSha256,observer.spoolSha256,'Archive integrity mismatch');observer.archiveStatus='completed';
 }catch(error){observer.archiveStatus='failed';observer.errors.push(`archive: ${error}`);await archive.close().catch(()=>{});}
 observer.archiveMs=performance.now()-archiveStart;
 if(observer.flushMs+observer.archiveMs>timeoutMs)observer.errors.push('Observer flush/publication exceeded work-budget duration; work deadline was not extended');
 observer.status=observer.errors.length?'incomplete':'completed';
 return {...result,observer,workOutcome:result.outcome??'completed',...(observer.status==='incomplete'&&!result.outcome?{outcome:'observer-incomplete',error:observer.errors.join('; '),failureStage:'observer',temperature:result.observations.at(-1)?.temperature??'cold'}:{})};
}

/** Keep successful prior phases and append a distinct correlated failure. */
export function childObservations(result,variant,index){
 const observations=(result.observations??[]).map(observation=>({...observation,variant,index,...(result.process?{process:result.process}:{}),...(result.observer?{observer:result.observer}:{})}));
 if(result.outcome){
  observations.push({
   variant,index,temperature:result.temperature??'cold',
   status:['execution-failure','numerical-mismatch'].includes(result.outcome)?'failed':'not-run',
   outcome:result.outcome,reason:result.reason??result.error,
   failureStage:result.failureStage??'runner-preflight',
   numericalCheck:result.outcome==='numerical-mismatch'?'failed':'not-run',
   stages:unavailable(result.reason??result.error),
   memory:result.memory??{peakRssBytes:null,wasmBufferBytes:null},retained:[],...(result.process?{process:result.process}:{}),...(result.observer?{observer:result.observer}:{}),
  });
 }
 if(result.observer?.status==='incomplete'&&result.outcome!=='observer-incomplete')observations.push({variant,index,temperature:result.observations?.at(-1)?.temperature??result.temperature??'cold',status:'not-run',outcome:'observer-incomplete',reason:result.observer.errors.join('; '),failureStage:'observer',numericalCheck:'not-run',stages:unavailable('Observer durability/sampling incomplete; not an engine timeout'),memory:{peakRssBytes:null,wasmBufferBytes:null},retained:[],observer:result.observer,...(result.process?{process:result.process}:{})});
 return observations;
}
