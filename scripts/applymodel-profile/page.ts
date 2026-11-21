// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {decodeWire} from '../../src/lib/tableExecution/rust/wireCodec';
import {createWorkerExecutor} from '../../src/lib/tableExecution/workerClient';
const absolute=()=>performance.timeOrigin+performance.now();
const signal=new AbortController().signal;
let dataset:any={rows:Array.from({length:10000},(_,i)=>({id:`row-${i}`,values:{region:`item${i%20}`,bucket:`item${i%100}`,revenue:i%1000,cost:i%700,profit:i%300}})),columns:['region','bucket','revenue','cost','profit'].map(id=>({id,label:id,dtype:id==='region'||id==='bucket'?'text':'number'})),resultRevision:1,outputRevision:1,provenance:{sourceWidgetId:'source'},completeness:{kind:'complete',warnings:[]},freshness:{availability:'available',stale:false}};
let base:any={table:{pivot:{enabled:true,grouping:['region'],split:[],aggregationFns:{revenue:'sum',cost:'sum',profit:'sum'}}},search:''};
let runtimeParams:any={};
function setCase(wire:string){const c=decodeWire(JSON.parse(wire)) as any;dataset=c.dataset;base=c.definition;runtimeParams=c.runtimeParams;}
async function run(action:string,mode:string,validate=false){
 const records=new Map<string,any>();
 const worker=new Worker(mode==='typescript'?'/typescript.js':`/${mode==='before'?'worker-before':'worker'}.js?trace=${mode==='traced'?1:0}&before=${mode==='before'?1:0}`,{type:'module'});
 const sent=new Map<string,number>();
 const post=worker.postMessage.bind(worker);
 worker.postMessage=((message:any)=>{sent.set(message.requestId,absolute());post(message);}) as any;
 worker.addEventListener('message',event=>{
  const receiveAt=absolute(),message=event.data,p=message.__profile;
  delete message.__profile;
  const start=sent.get(message.requestId);
  if(start!==undefined){records.set(message.requestId,{roundTripMs:receiveAt-start,...(p?{...p,workerMs:p.workerSendAt-p.workerReceivedAt,boundaryOverheadMs:(receiveAt-start)-(p.workerSendAt-p.workerReceivedAt)}: {})});}
 });
 const executor=createWorkerExecutor('source',()=>worker,mode==='typescript'?undefined:{readyKind:'rustReady',failureKind:'rustFailed',protocolVersion:1});
 let revision={widgetId:'source',input:1,model:1,output:1};
 try{
  const acquireStart=performance.now();
  await executor.registerInput(dataset as any,1,signal);
  const acquisitionMs=performance.now()-acquireStart,acquisitionTrace=[...records.values()].at(-1);
  const initial=action==='rawExport'?{table:{},search:''}:base;
  await executor.applyModel(initial as any,{kind:'none'},revision,signal,false,undefined,undefined,runtimeParams);
  const definition=structuredClone(initial) as any;
  if(action==='search'||action==='combined')definition.search='1';
  if(action==='sort'||action==='combined')definition.table.sorting=[{id:'profit',desc:true}];
  revision={...revision,model:2,output:2};
  records.clear();
  const tick=performance.now();
  const ready=await executor.applyModel(definition,{kind:'none'},revision,signal,false,undefined,undefined,runtimeParams);
  const applyMs=performance.now()-tick;
  const trace=[...records.values()].at(-1);
  const rows=await executor.rows(revision,{groupPath:[],offset:0,limit:100},signal);
  const totals=await executor.totals(revision,signal);
  let snapshot,exportMs,exportRows,exportBatches;
  if(validate||action==='rawExport'){
   const exported=[],batches=[];let count=0,batchCount=0;const exportStart=performance.now();
   for await(const batch of executor.presented(revision,signal,true)){
    count+=batch.rows.length;batchCount++;
    if(validate){exported.push(...batch.rows);if(action==='rawExport'){const {rows:_rows,...metadata}=batch;batches.push(metadata);}}
   }
   exportMs=performance.now()-exportStart;exportRows=count;exportBatches=batchCount;
   if(validate)snapshot={ready,rows,totals,exported,...(action==='rawExport'?{batches}: {})};
  }
  return {acquisitionMs,acquisitionTrace,applyMs,trace,snapshot,exportMs,exportRows,exportBatches,outputColumns:ready.columns.length};
 }finally{executor.dispose();worker.terminate();}
}
Object.assign(globalThis,{applyModelProfile:{run,setCase}});
