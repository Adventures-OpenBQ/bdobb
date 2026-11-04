// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {openSync,writeSync,fsyncSync,closeSync} from 'node:fs';
import {STAGES,unavailable} from './report.mjs';

/** NDJSON is journaled before an observation enters the returned result. Later child
 * failure cannot erase completed work. A fresh journal path prevents overwriting evidence. */
export function runChild(bundle,request,{timeoutMs,journalPath,identity}){
 const fd=openSync(journalPath,'wx');
 const journal=event=>{writeSync(fd,JSON.stringify(event)+'\n');fsyncSync(fd);};
 if(identity)journal({type:'identity',identity});
 return new Promise(resolve=>{
  const observations=[];
  let phase={temperature:'cold',failureStage:'acquisitionParse'};
  let pending='',stderr='',bytes=0,failure,done=false,parentFailure=false;
  const child=spawn(process.execPath,[bundle],{stdio:['pipe','pipe','pipe'],env:{...process.env,NODE_OPTIONS:''}});
  const fail=(outcome,error,extra={})=>{
   if(failure)return;
   parentFailure=true;
   failure={...phase,outcome,error,...extra};
   journal({type:'parentFailure',...failure});
  };
  const accept=event=>{
   // Drain complete stdout events queued before a parent kill/deadline as well.
   assert.ok(!done&&(!failure||parentFailure),'Event after terminal child result');
   switch(event.type){
    case 'phase':
     assert.ok(['cold','warm'].includes(event.temperature));
     assert.ok([...STAGES,'disposal'].includes(event.stage));
     journal(event);
     phase={temperature:event.temperature,failureStage:event.stage};
     if(parentFailure)Object.assign(failure,phase);
     break;
    case 'observation':
     assert.ok(['cold','warm'].includes(event.observation?.temperature));
     journal(event);
     observations.push(event.observation);
     break;
    case 'failure':
     journal(event);
     if(parentFailure)break;
     failure={...phase,outcome:event.outcome,error:event.error,...(event.memory?{memory:event.memory}:{})};
     break;
    case 'done':journal(event);done=true;break;
    default:throw Error('Unknown child protocol event');
   }
  };
  const timer=setTimeout(()=>{
   fail('timeout','Fresh-process deadline exceeded');
   child.kill('SIGKILL');
  },timeoutMs);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',data=>{
   bytes+=data.length;
   if(bytes>4000000){fail('execution-failure','Child protocol output exceeded bound');child.kill('SIGKILL');return;}
   pending+=data.toString();
   for(let end;(end=pending.indexOf('\n'))>=0;){
    const line=pending.slice(0,end);pending=pending.slice(end+1);
    if(!line)continue;
    try{accept(JSON.parse(line));}
    catch(error){fail('execution-failure',`Child protocol error: ${error}`);child.kill('SIGKILL');}
   }
  });
  child.stderr.on('data',data=>{stderr=(stderr+data).slice(-10000);});
  child.on('error',error=>fail('environment-failure',String(error)));
  child.on('close',code=>{
   clearTimeout(timer);
   if(!failure&&(code!==0||!done||pending.trim()))fail('execution-failure',stderr||`Incomplete child protocol (exit ${code})`);
   if(parentFailure)journal({type:'terminalFailure',...failure});
   closeSync(fd);
   resolve({observations,...failure});
  });
  child.stdin.on('error',()=>{/* close/error produces the correlated result */});
  child.stdin.end(JSON.stringify(request));
 });
}

/** Keep successful prior phases and append a distinct correlated failure. */
export function childObservations(result,variant,index){
 const observations=(result.observations??[]).map(observation=>({...observation,variant,index}));
 if(result.outcome){
  observations.push({
   variant,index,temperature:result.temperature??'cold',
   status:['execution-failure','numerical-mismatch'].includes(result.outcome)?'failed':'not-run',
   outcome:result.outcome,reason:result.reason??result.error,
   failureStage:result.failureStage??'runner-preflight',
   numericalCheck:result.outcome==='numerical-mismatch'?'failed':'not-run',
   stages:unavailable(result.reason??result.error),
   memory:result.memory??{peakRssBytes:null,wasmBufferBytes:null},retained:[],
  });
 }
 return observations;
}
