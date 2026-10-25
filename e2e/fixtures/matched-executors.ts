// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {createTableProvider, type TableEngine} from '../../src/lib/tableExecution/rust/providerFactory';
import {calculateView} from '../../src/lib/tableExecution/engine';
import {decodeWire,encodeWire} from '../../src/lib/tableExecution/rust/wireCodec';
import type {OracleCase} from '../../src/lib/tableExecution/rust/oracle';
import type {TableDefinition} from '../../src/lib/tableExecution/types';
import {equivalent,toleratedComputedColumns} from '../../scripts/matched-executors-utils.mjs';
const signal=new AbortController().signal;
const firstBlockSize=100;
async function run(wire:unknown,engine:TableEngine,validate:boolean){
 const c=decodeWire(wire as Parameters<typeof decodeWire>[0]) as OracleCase;
 const start=performance.now(),executor=createTableProvider('source',engine);
 const timings:Record<string,number>={factory:performance.now()-start};
 let r={widgetId:'source',input:c.dataset.resultRevision,model:1,output:1};
 const time=async<T>(key:string,work:()=>Promise<T>)=>{const tick=performance.now();const result=await work();timings[key]=performance.now()-tick;return result;};
 const apply=(definition:TableDefinition)=>executor.applyModel(definition,{kind:'none'},r,signal,false,undefined,[],c.runtimeParams);
 const read=async(prefix:string)=>{
  const rows=await time(`${prefix}FirstBlock`,()=>executor.rows(r,{groupPath:[],offset:0,limit:firstBlockSize},signal));
  const totals=await time(`${prefix}Totals`,()=>executor.totals(r,signal));
  return {rows,totals};
 };
 const pull=async()=>{const rows=[];let columns,provenance,freshness,batches=0;for await(const batch of executor.presented(r,signal,true)){rows.push(...batch.rows);if(batch.columns)columns=batch.columns;if(batch.provenance)provenance=batch.provenance;if(batch.freshness)freshness=batch.freshness;batches++;}return {rows,columns,provenance,freshness,batches};};
 const snapshots:unknown[]=[];
 const check=async(action:string,definition:TableDefinition,ready:Awaited<ReturnType<typeof apply>>,block:Awaited<ReturnType<typeof read>>)=>{
  if(!validate)return;
  const exported=await pull();
  const baseline=calculateView(c.dataset,definition,{kind:'none'},false,undefined,[],c.runtimeParams);
  const fields=new Set(ready.columns.map(col=>col.id));
  const rows=baseline.presentedRows.map(row=>({...row,values:Object.fromEntries(Object.entries(row.values).filter(([id])=>fields.has(id))),...(row.cellErrors?{cellErrors:Object.fromEntries(Object.entries(row.cellErrors).filter(([id])=>fields.has(id)))}:{}),...(row.cellFormats?{cellFormats:Object.fromEntries(Object.entries(row.cellFormats).filter(([id])=>fields.has(id)))}:{})}));
  const tolerance=toleratedComputedColumns(definition,ready.columns);
  try{equivalent({rows:exported.rows},{rows},'baseline',tolerance,'baseline');}catch(error){throw Error(`${action}: ${(error as Error).message}; exported IDs ${JSON.stringify(exported.rows.slice(0,12).map(row=>row.id))}; baseline IDs ${JSON.stringify(rows.slice(0,12).map(row=>row.id))}`,{cause:error});}equivalent(ready.columns,baseline.columns,`baseline.${action}.columns`);equivalent({totals:{values:block.totals.values}},{totals:{values:baseline.totals.values}},'baseline',tolerance,'baseline');
  snapshots.push({ready,block,exported,toleratedColumns:[...tolerance]});
 };
 try{
  await time('acquireIncludingWorkerStartup',()=>executor.registerInput(c.dataset,c.dataset.resultRevision,signal));
  let ready=await time('initialApply',()=>apply(c.definition));
  let block=await read('initial');
  timings.coldLoadReady=performance.now()-start;
  await check('coldLoad',c.definition,ready,block);
  const pivot=structuredClone(c.definition);
  if(pivot.analytical){const model=pivot.analytical as {layout:{rows:string[]}};model.layout.rows=[];}
  else {pivot.table.pivot={...pivot.table.pivot,enabled:true,grouping:[c.dataset.columns.find(col=>col.dtype==='text')?.id??c.dataset.columns[0].id],split:[]};if(JSON.stringify(pivot)===JSON.stringify(c.definition))pivot.table.pivot.grouping=[];}
  for(const [action,definition] of [['pivotChange',pivot],['sortFilter',{...c.definition,search:'1',table:{...c.definition.table,sorting:[{id:ready.columns.at(-1)!.id,desc:true}]}}]] as [string,TableDefinition][]){
   // Restore the identical starting definition outside each edit measurement.
   r={...r,model:r.model+1,output:r.output+1};await apply(c.definition);
   r={...r,model:r.model+1,output:r.output+1};const tick=performance.now();ready=await time(`${action}Apply`,()=>apply(definition));block=await read(action);timings[`${action}Ready`]=performance.now()-tick;
   await check(action,definition,ready,block);
  }
  r={...r,model:r.model+1,output:r.output+1};ready=await apply(c.definition);
  const exported=await time('fullPulledExport',pull);
  return {timings,outputRows:exported.rows.length,outputColumns:ready.columns.length,exportBatches:exported.batches,firstBlockSize,snapshots:validate?encodeWire(snapshots):undefined};
 }finally{executor.dispose();}
}
Object.assign(window,{matchedExecutorHarness:{run}});
