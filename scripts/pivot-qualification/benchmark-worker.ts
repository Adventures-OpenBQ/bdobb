// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import type {TableExecutor,TableDefinition,Revision} from '../../src/lib/tableExecution/types';
import type {WidgetDataset} from '../../src/lib/widgetData/types';
import {createWorkerExecutor} from '../../src/lib/tableExecution/workerClient';
import {createWorkerHandler} from '../../src/lib/tableExecution/table.worker';
import {createRustWorkerHandler} from '../../src/lib/tableExecution/rust/rust.worker';
import {loadRustRuntime,createRustExecutor} from '../../src/lib/tableExecution/rust/runtime';
import {estimatedHostBytes} from '../../src/lib/tableExecution/rust/resources';
import {datasetFromBytes} from '../../src/lib/localTableData';
import {hashJSON,hashBytes,unavailable} from './report.mjs';
import {tickDataset,tickModel,checkTickBars} from './ticks.mjs';
const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
const request=JSON.parse(Buffer.concat(chunks).toString());
const {paths,engine,limits,manifest}=request;
let temperature:'cold'|'warm'='cold';
const emit=(event:unknown)=>process.stdout.write(JSON.stringify(event)+'\n');
const phase=(stage:string)=>emit({type:'phase',temperature,stage});
phase('acquisitionParse');
let wasm:any;let wasmMemory:WebAssembly.Memory|undefined;
async function create(){
 let handler:any;
 const worker:any={onmessage:null,onerror:null,onmessageerror:null,postMessage:(message:any)=>void handler(message),terminate:()=>{}};
 const send=(data:any)=>queueMicrotask(()=>worker.onmessage?.({data}));
 if(engine==='rust'){
  if(!wasm){wasm=await import(pathToFileURL(request.modulePath).href);const exports=await wasm.default({module_or_path:await readFile(request.wasmPath)});wasmMemory=exports.memory;}
  const runtime=await loadRustRuntime(async()=>wasm);
  return createRustExecutor('qualification',()=>{handler=createRustWorkerHandler(send,async()=>runtime,Intl.DateTimeFormat().resolvedOptions().locale,limits);return worker;});
 }
 handler=createWorkerHandler(send);return createWorkerExecutor('qualification',()=>worker);
}
try{
 const start=performance.now();
 const bytes=await readFile(paths.input);assert.equal(hashBytes(bytes),manifest.input.sha256);for(const key of ['reference','model','actions'])assert.equal(hashBytes(await readFile(paths[key])),manifest[key].sha256);const model=JSON.parse(await readFile(paths.model,'utf8'));const expected=JSON.parse(await readFile(paths.reference,'utf8'));
 let companies:any;
 if(manifest.format==='certified-json'){
  const source=JSON.parse(bytes.toString());companies=Object.entries(source.companies).map(([symbol,c]:any)=>({symbol,dataset:{...c.dataset,provenance:{sourceWidgetId:`sec-${symbol}`}},definition:model[symbol]}));
  assert.equal(companies.reduce((n:number,c:any)=>n+c.dataset.rows.length,0),98);
 }else if(manifest.kind==='ticks'){
  assert.deepEqual(model,tickModel(manifest.tick));
  companies=[{symbol:'ticks',dataset:tickDataset(bytes.toString(),manifest.rows),...model}];
 }else{
  const dataset=await datasetFromBytes('input.csv',bytes,'qualification',1);companies=[{symbol:'bulk',dataset,definition:model}];
 }
 const parseMs=performance.now()-start;
 assert.equal(companies.reduce((n:number,c:any)=>n+c.dataset.rows.length,0),manifest.rows);
 for(const c of companies)estimatedHostBytes(c.dataset,limits.maxInputBytes);
 const sessions:Array<{symbol:string;dataset:WidgetDataset;definition:TableDefinition;runtimeParams?:Parameters<TableExecutor['applyModel']>[7];executor:TableExecutor;revision:Revision}>=[];for(const c of companies)sessions.push({...c,executor:await create(),revision:{widgetId:'qualification',input:1,model:0,output:0}});
 for(const nextTemperature of ['cold','warm'] as const){
  temperature=nextTemperature;
  const stages:any=unavailable('Unavailable in headless Node transport');const totals:any={registrationEncoding:0,compute:0,filterReselection:0,transfer:0,chartDelivery:0};let cells=0;const retained=[];const results=[];
  const signal=new AbortController().signal;
  for(const c of sessions){
   const {executor,dataset,definition,revision}=c;
   phase('registrationEncoding');let t=performance.now();if(temperature==='cold')await executor.registerInput(dataset,1,signal);totals.registrationEncoding+=performance.now()-t;
   const apply=async(selection:any)=>{revision.model++;revision.output++;return executor.applyModel(definition,selection,{...revision},signal,true,undefined,[],c.runtimeParams);};
   phase('compute');t=performance.now();const ready=await apply({kind:'none'});totals.compute+=performance.now()-t;
   phase('transfer');t=performance.now();const rows=[];for await(const batch of executor.presented({...revision},signal))rows.push(...batch.rows);totals.transfer+=performance.now()-t;
   if(manifest.kind==='statement'){
    for(const [year,lines] of Object.entries(expected[c.symbol]))for(const [line,value] of Object.entries(lines as any)){
     const row:any=rows.find((r:any)=>r.groupPath?.some((p:any)=>p.value===line));
     const column=ready.columns.find((col:any)=>col.measureId?.endsWith('/value')&&col.splitPath?.some((p:any)=>p.value===`FY${year}`));
     assert.ok(row&&column,`Missing ${c.symbol}/${year}/${line}`);assert.equal(row.values[column.id],Number(value));cells++;
    }
   }else if(manifest.kind==='ticks'){cells+=checkTickBars(rows,expected,manifest.tick,manifest.reference.policy);
   }else{assert.equal(rows.length,expected.rows);assert.equal(new Set(rows.map((r:any)=>r.id)).size,expected.uniqueIds);}
   results.push(hashJSON(rows));
   phase('chartDelivery');t=performance.now();await executor.chartData({...revision},ready.columns.map((c:any)=>c.id),signal);totals.chartDelivery+=performance.now()-t;
   phase('filterReselection');t=performance.now();for(let cycle=0;cycle<5;cycle++){
    await apply({kind:'explicit',ids:[]});let empty=0;for await(const batch of executor.presented({...revision},signal))empty+=batch.rows.length;assert.equal(empty,0);
    await apply({kind:'none'});let reset=0;for await(const batch of executor.presented({...revision},signal))reset+=batch.rows.length;assert.equal(reset,rows.length);
    retained.push({symbol:c.symbol,cycle,rssBytes:process.memoryUsage().rss,heapUsedBytes:process.memoryUsage().heapUsed});
   }totals.filterReselection+=performance.now()-t;
  }
  if(manifest.kind==='statement')assert.equal(cells,110);
  for(const [key,ms] of Object.entries(totals))stages[key]={status:'measured',ms};
  stages.acquisitionParse=temperature==='cold'?{status:'measured',ms:parseMs}:{status:'not-run',reason:'Warm same-session input retained'};
  if(temperature==='warm')stages.registrationEncoding={status:'not-run',reason:'Warm same-session registration retained'};
  emit({
   type:'observation',
   observation:{
    temperature,status:'passed',outcome:'completed',numericalCheck:'passed',
    checkedCells:cells,resultChecksum:hashJSON(results),stages,retained,
    responsiveness:{status:'not-run',reason:'No browser input event loop'},
    memory:{
     peakRssBytes:process.resourceUsage().maxRSS*1024,
     wasmBufferBytes:wasmMemory?.buffer.byteLength??null,
     sampler:{method:'resourceUsage high-water mark',scope:'child-process',intervalMs:null},
    },
   },
  });
 }
 phase('disposal');
 for(const c of sessions)c.executor.dispose();
 emit({type:'done'});
}catch(error:any){
 emit({
  type:'failure',
  outcome:error?.descriptor?.code==='RESOURCE_LIMIT'?'profile-refused':error?.code==='ERR_ASSERTION'?'numerical-mismatch':'execution-failure',
  error:String(error),
  memory:{peakRssBytes:process.resourceUsage().maxRSS*1024,wasmBufferBytes:wasmMemory?.buffer.byteLength??null},
 });
}
