// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import type {TableExecutor,TableDefinition,Revision,SelectionSpec,ExecutionRequest,ExecutionResponse} from '../../src/lib/tableExecution/types';
import type {WidgetDataset,DatasetRow} from '../../src/lib/widgetData/types';
import {createWorkerExecutor} from '../../src/lib/tableExecution/workerClient';
import {createWorkerHandler} from '../../src/lib/tableExecution/table.worker';
import {createRustWorkerHandler,type RustWorkerMessage} from '../../src/lib/tableExecution/rust/rust.worker';
import {loadRustRuntime,createRustExecutor,type WasmModule,type ResourceLimits} from '../../src/lib/tableExecution/rust/runtime';
import {estimatedHostBytes} from '../../src/lib/tableExecution/rust/resources';
import {datasetFromBytes} from '../../src/lib/localTableData';
import {hashJSON,hashBytes,unavailable} from './report.mjs';
import {performanceTrace} from './performance-trace';
import {tickDataset,tickModel,checkTickBars} from './ticks.mjs';
const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
type BoundFile={sha256:string};
type TickConfig={granularity:'1s'|'1m';venue:'Q'|'24EQ';countOnly?:boolean};
type QualificationRequest={paths:Record<'input'|'reference'|'model'|'actions',string>;engine:'typescript'|'rust';limits:ResourceLimits;manifest:{format:string;kind:'statement'|'ticks'|'bulk';rows:number;tick:TickConfig;input:BoundFile;reference:BoundFile & {policy:unknown;independent?:boolean};model:BoundFile;actions:BoundFile};modulePath:string;wasmPath:string;performance?:Parameters<typeof performanceTrace>[0]['request']['performance']};
type Company={symbol:string;dataset:WidgetDataset;definition:TableDefinition;runtimeParams?:Parameters<TableExecutor['applyModel']>[7]};
type QualifiedWasm=WasmModule & {default(options:{module_or_path:Uint8Array}):Promise<{memory:WebAssembly.Memory}>};
type Stage={status:'measured';ms:number}|{status:'not-run';reason:string};
const request=JSON.parse(Buffer.concat(chunks).toString()) as QualificationRequest;
const {paths,engine,limits,manifest}=request;
let temperature:'cold'|'warm'='cold';
const emit=(event:unknown)=>process.stdout.write(JSON.stringify(event)+'\n');
const phase=(stage:string)=>emit({type:'phase',temperature,stage});
phase('acquisitionParse');
let wasm:QualifiedWasm|undefined;let wasmMemory:WebAssembly.Memory|undefined;
async function create(){
 let handler:(message:unknown)=>void|Promise<void>;
 // The Node transport deliberately implements only the Worker surface consumed by the client.
 const worker={onmessage:null,onerror:null,onmessageerror:null,postMessage:(message:ExecutionRequest)=>void handler(message),terminate:()=>{}} as Worker;
 const send=(data:ExecutionResponse|RustWorkerMessage)=>queueMicrotask(()=>worker.onmessage?.({data} as MessageEvent<ExecutionResponse|RustWorkerMessage>));
 if(engine==='rust'){
  if(!wasm){wasm=await import(pathToFileURL(request.modulePath).href) as QualifiedWasm;const exports=await wasm.default({module_or_path:await readFile(request.wasmPath)});wasmMemory=exports.memory;}
  const runtime=await loadRustRuntime(async()=>wasm!);
  return createRustExecutor('qualification',()=>{handler=createRustWorkerHandler(send,async()=>runtime,Intl.DateTimeFormat().resolvedOptions().locale,limits);return worker;});
 }
 handler=createWorkerHandler(send);return createWorkerExecutor('qualification',()=>worker);
}
try{
 const start=performance.now();
 const bytes=await readFile(paths.input);assert.equal(hashBytes(bytes),manifest.input.sha256);for(const key of ['reference','model','actions'] as const)assert.equal(hashBytes(await readFile(paths[key])),manifest[key].sha256);const model:unknown=JSON.parse(await readFile(paths.model,'utf8'));const expected:unknown=JSON.parse(await readFile(paths.reference,'utf8'));
 let companies:Company[];
 if(manifest.format==='certified-json'){
  const source=JSON.parse(bytes.toString()) as {companies:Record<string,{dataset:WidgetDataset}>};const definitions=model as Record<string,TableDefinition>;companies=Object.entries(source.companies).map(([symbol,c])=>({symbol,dataset:{...c.dataset,provenance:{sourceWidgetId:`sec-${symbol}`}},definition:definitions[symbol]}));
  assert.equal(companies.reduce((n,c)=>n+c.dataset.rows.length,0),98);
 }else if(manifest.kind==='ticks'){
  assert.deepEqual(model,tickModel(manifest.tick));
  companies=[{symbol:'ticks',dataset:tickDataset(bytes.toString(),manifest.rows) as WidgetDataset,...model as Pick<Company,'definition'|'runtimeParams'>}];
 }else{
  const dataset=await datasetFromBytes('input.csv',bytes,'qualification',1);companies=[{symbol:'bulk',dataset,definition:model as TableDefinition}];
 }
 const parseMs=performance.now()-start;
 assert.equal(companies.reduce((n,c)=>n+c.dataset.rows.length,0),manifest.rows);
 for(const c of companies)estimatedHostBytes(c.dataset,limits.maxInputBytes);
 const sessions:Array<{symbol:string;dataset:WidgetDataset;definition:TableDefinition;runtimeParams?:Parameters<TableExecutor['applyModel']>[7];executor:TableExecutor;revision:Revision}>=[];for(const c of companies)sessions.push({...c,executor:await create(),revision:{widgetId:'qualification',input:1,model:0,output:0}});
 if(request.performance){await performanceTrace({sessions,request:{...request,performance:request.performance},expected,parseMs,wasm,getMemory:()=>({peakRssBytes:process.resourceUsage().maxRSS*1024,wasmBufferBytes:wasmMemory?.buffer.byteLength??null}),emit,setPhase:(t:'cold'|'warm',stage:string)=>{temperature=t;phase(stage);}});}
 else for(const nextTemperature of ['cold','warm'] as const){
  temperature=nextTemperature;
  const stages:Record<string,Stage>=unavailable('Unavailable in headless Node transport') as Record<string,Stage>;const totals={registrationEncoding:0,compute:0,filterReselection:0,transfer:0,chartDelivery:0};let cells=0;const retained=[];const results=[];
  const signal=new AbortController().signal;
  for(const c of sessions){
   const {executor,dataset,definition,revision}=c;
   phase('registrationEncoding');let t=performance.now();if(temperature==='cold')await executor.registerInput(dataset,1,signal);totals.registrationEncoding+=performance.now()-t;
   const apply=async(selection:SelectionSpec)=>{revision.model++;revision.output++;return executor.applyModel(definition,selection,{...revision},signal,true,undefined,[],c.runtimeParams);};
   phase('compute');t=performance.now();const ready=await apply({kind:'none'});totals.compute+=performance.now()-t;
   phase('transfer');t=performance.now();const rows:DatasetRow[]=[];for await(const batch of executor.presented({...revision},signal))rows.push(...batch.rows);totals.transfer+=performance.now()-t;
   if(manifest.kind==='statement'){
    for(const [year,lines] of Object.entries((expected as Record<string,Record<string,Record<string,string>>>)[c.symbol]))for(const [line,value] of Object.entries(lines)){
     const row=rows.find(r=>r.groupPath?.some(p=>p.value===line));
     const column=ready.columns.find(col=>col.measureId?.endsWith('/value')&&col.splitPath?.some(p=>p.value===`FY${year}`));
     assert.ok(row&&column,`Missing ${c.symbol}/${year}/${line}`);assert.equal(row.values[column.id],Number(value));cells++;
    }
   }else if(manifest.kind==='ticks'){cells+=checkTickBars(rows,expected,manifest.tick,manifest.reference.policy);
   }else{const structural=expected as {rows:number;uniqueIds:number};assert.equal(rows.length,structural.rows);assert.equal(new Set(rows.map(r=>r.id)).size,structural.uniqueIds);}
   results.push(hashJSON(rows));
   phase('chartDelivery');t=performance.now();await executor.chartData({...revision},ready.columns.map(c=>c.id),signal);totals.chartDelivery+=performance.now()-t;
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
}catch(error:unknown){
 const caught=error!==null&&typeof error==='object'?error:undefined;
 const descriptor=caught&&'descriptor' in caught?caught.descriptor:undefined;
 const resource=descriptor!==null&&typeof descriptor==='object'&&'code' in descriptor&&descriptor.code==='RESOURCE_LIMIT';
 const assertion=caught&&'code' in caught&&caught.code==='ERR_ASSERTION';
 emit({
  type:'failure',
  outcome:resource?'profile-refused':assertion?'numerical-mismatch':'execution-failure',
  error:String(error),
  memory:{peakRssBytes:process.resourceUsage().maxRSS*1024,wasmBufferBytes:wasmMemory?.buffer.byteLength??null},
 });
}
