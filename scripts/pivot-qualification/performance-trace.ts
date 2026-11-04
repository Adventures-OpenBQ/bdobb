// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
/** Private trace over the actual production worker executor, never a direct engine bypass. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {hashJSON,unavailable} from './report.mjs';
import {tickModel,checkTickBars} from './ticks.mjs';
import {validatePerformanceActions} from './performance-common.mjs';
import {validateProbe} from './profile.mjs';
import type {TableExecutor,TableDefinition,Revision,ViewReady,SelectionSpec,FacetResult} from '../../src/lib/tableExecution/types';
import type {WidgetDataset,DatasetRow} from '../../src/lib/widgetData/types';
type Session={symbol:string;dataset:WidgetDataset;definition:TableDefinition;runtimeParams?:Parameters<TableExecutor['applyModel']>[7];executor:TableExecutor;revision:Revision};
type Action={kind:string;granularity?:'1s'|'1m';venue?:'Q'|'24EQ';cycles?:number;direction?:string;cycle?:number;consumers?:string[]};
type TickConfig={granularity:'1s'|'1m';venue:'Q'|'24EQ';countOnly?:boolean};
type Stage={status:'measured';ms:number}|{status:'not-run';reason:string};
type Memory={peakRssBytes:number;wasmBufferBytes:number|null};
type Probe={__pivot_profile_reset():void;__pivot_profile_read():unknown};
type TraceRecord={sessionId:string;action:Action;revision:Revision;modelChecksum:string;resultChecksum:string;numericalCheck:'passed';ms?:number;consumers?:Record<string,string>;probe?:ReturnType<typeof validateProbe>};
type TraceInput={sessions:Session[];request:{engine:string;manifest:{kind:string;tick?:TickConfig;reference:{independent?:boolean;policy:unknown}};performance:{actions:{version:string;actions:Action[]};instrumented:boolean;probePath:string}};expected:unknown;parseMs:number;wasm?:unknown;getMemory:()=>Memory;emit:(event:unknown)=>void;setPhase:(temperature:'cold'|'warm',stage:string)=>void};
export async function performanceTrace({sessions,request,expected,parseMs,wasm,getMemory,emit,setPhase}:TraceInput){
 const {manifest}=request;const contract=request.performance.actions;
 validatePerformanceActions(contract,manifest.kind);
 assert.equal(manifest.reference.independent,true,'Independent correctness reference required');
 const sessionIds=new Map(sessions.map((c:Session)=>[c,randomUUID()]));
 const probe=(request.performance.instrumented?(request.engine==='rust'?wasm:await import(pathToFileURL(request.performance.probePath).href)):undefined) as Probe|undefined;
 if(request.performance.instrumented){assert.ok(probe,'Missing private probe');assert.equal(typeof probe.__pivot_profile_reset,'function');assert.equal(typeof probe.__pivot_profile_read,'function');}
 const signal=new AbortController().signal;
 const previousBySession=new Map<Session,TraceRecord>();
 for(const temperature of ['cold','warm'] as const){
  const stages=unavailable('Unavailable in headless Node transport') as Record<string,Stage>;
  const totals={registrationEncoding:0,compute:0,filterReselection:0,transfer:0,chartDelivery:0};
  const trace:TraceRecord[]=[],retained:Array<{wasmBufferBytes:number|null;symbol:string;sessionId:string;cycle:number;revision:Revision;rssBytes:number;heapUsedBytes:number}>=[],results:string[]=[],responsiveness:Array<{action:string;blockedMs:number}>=[];let checkedCells=0;
  const timed=async<T>(stage:keyof typeof totals,fn:()=>Promise<T>)=>{setPhase(temperature,stage);const t=performance.now();try{return await fn();}finally{totals[stage]+=performance.now()-t;}};
  for(const c of sessions as Session[]){
   const {executor,revision}=c;let ready!:ViewReady;let config={...manifest.tick} as TickConfig;
   if(temperature==='cold')await timed('registrationEncoding',()=>executor.registerInput(c.dataset,1,signal));
   const read=async(ignoreSelection=false)=>{const rows:DatasetRow[]=[];for await(const batch of executor.presented({...revision},signal,ignoreSelection)){assert.deepEqual(batch.revision,revision);rows.push(...batch.rows);}return rows;};
   const check=(rows:DatasetRow[])=>{
    if(manifest.kind==='ticks')return checkTickBars(rows,expected,config,manifest.reference.policy);
    if(manifest.kind==='statement'){
     let cells=0;for(const [year,lines] of Object.entries((expected as Record<string,Record<string,Record<string,string>>>)[c.symbol]))for(const [line,value] of Object.entries(lines)){
      const row=rows.find(r=>r.groupPath?.some(p=>p.value===line));const column=ready.columns.find(col=>col.measureId?.endsWith('/value')&&col.splitPath?.some(p=>p.value===`FY${year}`));
      assert.ok(row&&column,`Missing ${c.symbol}/${year}/${line}`);assert.equal(row.values[column.id],Number(value));cells++;
     }return cells;
    }
    const structural=expected as {rows:number;uniqueIds:number};assert.equal(rows.length,structural.rows);assert.equal(new Set(rows.map(r=>r.id)).size,structural.uniqueIds);return rows.length;
   };
   const apply=async(selection:SelectionSpec={kind:'none'},stage:keyof typeof totals='compute')=>{
    revision.model++;revision.output++;
    ready=await timed(stage,()=>executor.applyModel(c.definition,selection,{...revision},signal,true,undefined,[],c.runtimeParams));assert.deepEqual(ready.revision,revision);
   };
   const actions:Action[]=temperature==='cold'?[contract.actions[0]]:contract.actions.slice(1);
   for(const action of actions){
    probe?.__pivot_profile_reset();const start=performance.now();const pulse=new Promise<number>(resolve=>setImmediate(()=>resolve(performance.now()-start)));let rows:DatasetRow[]=[];let consumers:Record<string,string>|undefined;
    if(action.kind==='apply'){
     if(manifest.kind==='ticks'){config={...manifest.tick,granularity:action.granularity!,venue:action.venue!};Object.assign(c,tickModel(config));}
     await apply();rows=await timed('transfer',()=>read());checkedCells+=check(rows);
    }else if(action.kind==='sort'){
     c.definition={...c.definition,table:{...c.definition.table,sorting:[{id:'cat_time',desc:true}]}};
     await apply();rows=await timed('transfer',()=>read());checkedCells+=check(rows);
     const bars=rows.filter(r=>r.groupPath?.length===1);for(let i=1;i<bars.length;i++)assert.ok(Number(bars[i-1].groupPath![0].value)>=Number(bars[i].groupPath![0].value),'Descending sort');
    }else if(action.kind==='linkedRead'){
     rows=await timed('transfer',()=>read());checkedCells+=check(rows);
     const chart=await timed('chartDelivery',()=>executor.chartData({...revision},ready!.columns.map(col=>col.id),signal));checkedCells+=check(chart.rows);
     const exported=await timed('transfer',()=>read(true));checkedCells+=check(exported);
     const table=await timed('transfer',()=>executor.rows({...revision},{groupPath:[],offset:0,limit:100},signal));
     for(const row of table.rows){const full=rows.find(r=>r.id===row.id);if(full)assert.deepEqual(row.values,full.values);else assert.ok(table.groups.some(g=>g.rowId===row.id),'Unmatched table leaf');}
     const selection=await executor.selection({...revision},{kind:'summary'},table.rows.map(r=>r.id),signal);
     assert.ok(executor.inspect);const inspection=await executor.inspect({...revision},{collection:'definitions',offset:0,limit:100},signal);
     const facets:FacetResult[]=[];for(const item of inspection.rows)if(item.kind==='category')facets.push(await executor.facets({...revision},item.id,signal));
     const errors=rows.flatMap(r=>Object.entries(r.cellErrors??{}));
     consumers={table:hashJSON(table.rows),chart:hashJSON(chart.rows),export:hashJSON(exported),selection:hashJSON(selection.selection),facets:hashJSON(facets.map(({requestId:_,revision:__,...rest})=>rest)),inspection:hashJSON(inspection.rows),errors:hashJSON(errors),readyDiagnostics:hashJSON(ready!.diagnostics)};
    }else if(action.kind==='empty-clear'){
     for(let cycle=0;cycle<action.cycles!;cycle++){
      await apply({kind:'explicit',ids:[]},'filterReselection');const empty=await timed('transfer',()=>read());assert.equal(empty.length,0);
      const emptyRecord:TraceRecord={sessionId:sessionIds.get(c)!,action:{kind:'explicit-empty',cycle},revision:{...revision},modelChecksum:hashJSON({definition:c.definition,runtimeParams:c.runtimeParams}),numericalCheck:'passed',resultChecksum:hashJSON(empty)};trace.push(emptyRecord);emit({type:'phase',temperature,stage:'filterReselection',completedAction:emptyRecord});
      await apply({kind:'none'},'filterReselection');rows=await timed('transfer',()=>read());checkedCells+=check(rows);
      const resetRecord:TraceRecord={sessionId:sessionIds.get(c)!,action:{kind:'clear-reset',cycle},revision:{...revision},modelChecksum:hashJSON({definition:c.definition,runtimeParams:c.runtimeParams}),numericalCheck:'passed',resultChecksum:hashJSON(rows)};trace.push(resetRecord);emit({type:'phase',temperature,stage:'filterReselection',completedAction:resetRecord});
      retained.push({symbol:c.symbol,sessionId:sessionIds.get(c)!,cycle,revision:{...revision},rssBytes:process.memoryUsage().rss,heapUsedBytes:process.memoryUsage().heapUsed,wasmBufferBytes:getMemory().wasmBufferBytes});
     }
    }else throw Error(`Unknown performance action ${action.kind}`);
    const actionMs=performance.now()-start;responsiveness.push({action:action.kind,blockedMs:await pulse});
    const rawProbe=probe?.__pivot_profile_read();
    const record:TraceRecord={sessionId:sessionIds.get(c)!,action,revision:{...revision},modelChecksum:hashJSON({definition:c.definition,runtimeParams:c.runtimeParams}),resultChecksum:hashJSON(rows),numericalCheck:'passed',ms:actionMs,...(consumers?{consumers}:{}),...(probe?{probe:validateProbe(typeof rawProbe==='string'?JSON.parse(rawProbe):rawProbe)}:{})};
    trace.push(record);emit({type:'phase',temperature,stage:'compute',completedAction:record});results.push(record.resultChecksum);
    const previous=previousBySession.get(c);
    if(action.kind==='apply'&&previous?.modelChecksum===record.modelChecksum)assert.equal(previous.resultChecksum,record.resultChecksum,'Identical apply parity');
    previousBySession.set(c,record);
   }
  }
  for(const [key,ms] of Object.entries(totals))stages[key]={status:'measured',ms};
  stages.acquisitionParse=temperature==='cold'?{status:'measured',ms:parseMs}:{status:'not-run',reason:'Same-session input retained'};
  if(temperature==='warm')stages.registrationEncoding={status:'not-run',reason:'Same-session registration retained'};
  emit({type:'observation',observation:{temperature,status:'passed',outcome:'completed',numericalCheck:'passed',checkedCells,resultChecksum:hashJSON(results),stages,trace,retained,sessions:sessions.map((c:Session)=>({id:sessionIds.get(c),symbol:c.symbol,revision:{...c.revision}})),responsiveness:{status:'measured',method:'Node setImmediate scheduled before action; callback latency includes synchronous handler work; not browser input latency',samples:responsiveness},memory:getMemory()}});
 }
}
