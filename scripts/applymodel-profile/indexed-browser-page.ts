// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {createWorkerExecutor} from '../../src/lib/tableExecution/workerClient';
import {decodeWire} from '../../src/lib/tableExecution/rust/wireCodec';
async function run(mode:string,wire:string,options:any={}){
 const c:any=decodeWire(JSON.parse(wire)),controller=new AbortController(),signal=controller.signal;
 const timeout=setTimeout(()=>controller.abort(),60000),workers:Worker[]=[];let lastAudit:any;
 const budget=options.budget??536870912;
 const executor=createWorkerExecutor('source',()=>{
  const worker=new Worker(mode==='stock'?'/stock-worker.js':`/worker.js?indexed=${mode==='indexed'?1:0}&budget=${budget}`,{type:'module'});workers.push(worker);
  worker.addEventListener('message',event=>{if(event.data.kind==='viewReady')lastAudit=event.data.__audit;delete event.data.__audit;});return worker;
 });
 let rev={widgetId:'source',input:c.dataset.resultRevision,model:1,output:1};
 const audits:any[]=[];
 let definition=structuredClone(c.definition),runtime=c.runtimeParams??{};
 if(options.scenario==='runtime'){
  const category=definition.analytical.categories[0].id;
  definition.analytical.params.filters=[{id:'audit-runtime',categoryId:category,label:'Audit runtime',multiSelect:true}];
  runtime={[`pivot:filter:${category}`]:{source:'viewer',memberKeys:null}};
 }
 if(options.scenario==='freshness')c.dataset.freshness.diagnostics=['audit freshness'];
 async function publication(ready:any){
  const blocks:any[]=[];const visit=async(path:string[])=>{for(let offset=0;;){const b=await executor.rows(rev,{groupPath:path,offset,limit:100},signal);blocks.push(b);for(const g of b.groups)await visit(g.path);offset+=b.rows.length;if(offset>=b.siblingCount||!b.rows.length)break;}};await visit([]);
  const totals=await executor.totals(rev,signal),chart=await executor.chartData(rev,ready.columns.map((c:any)=>c.id),signal),facets=[];
  for(const category of ready.inspection.definition.analytical.categories)facets.push(await executor.facets(rev,category.id,signal));
  const inspection=[];for(const collection of ['definitions','warnings','periodBounds'] as const)inspection.push(await executor.inspect!(rev,{collection,offset:0,limit:100},signal));
  const exports=[];for(const ignore of [false,true]){const batches=[];for await(const b of executor.presented(rev,signal,ignore))batches.push(b);exports.push(batches);}
  return {ready,blocks,totals,chart,facets,inspection,exports};
 }
 const apply=async(d:any,selection:any={kind:'none'})=>{
  const start=performance.now(),ready=await executor.applyModel(d,selection,rev,signal,options.scenario==='unsupported'?false:true,undefined,undefined,runtime);
  const ms=performance.now()-start,audit=structuredClone(lastAudit);audits.push(audit);return {ready,ms,audit};
 };
 try{
  await executor.registerInput(c.dataset,rev.input,signal);
  const sourceSort=c.dataset.columns.find((c:any)=>c.dtype==='number')?.id;
  if(sourceSort)definition.table.sorting=[{id:sourceSort,desc:true}];
  const initial=await apply(definition,options.scenario==='selection'?{kind:'explicit',ids:['absent-audit-id']}:{kind:'none'});
  const initialSnapshot=options.validate?await publication(initial.ready):undefined;
  const target=initial.ready.columns.find((c:any)=>c.id!=='\x1egroup')?.id;
  const sorted=structuredClone(definition);sorted.table.sorting=[{id:target,desc:options.desc??true}];
  rev={...rev,model:2,output:2};
  if(options.scenario==='runtime'){const key=Object.keys(runtime)[0];runtime={[key]:{source:'viewer',memberKeys:[]}};}
  if(options.scenario==='model')sorted.analytical.formulas[0].name+=' edited';
  if(options.scenario==='source'){
   const input=structuredClone(c.dataset),field=sourceSort;if(field)input.rows[0].values[field]=12345;
   await executor.registerInput(input,rev.input,signal);
  }
  const warm=await apply(sorted);
  const snapshot=options.validate?await publication(warm.ready):undefined;
  let follow;
  if(['runtime','model','source'].includes(options.scenario)){
   rev={...rev,model:3,output:3};const next=structuredClone(sorted);next.table.sorting[0].desc=!next.table.sorting[0].desc;
   const result=await apply(next);follow=options.validate?await publication(result.ready):undefined;
  }
  return {initialMs:initial.ms,applyMs:warm.ms,initialAudit:initial.audit,warmAudit:warm.audit,audits,initialSnapshot,snapshot,follow};
 }finally{clearTimeout(timeout);executor.dispose();workers.forEach(w=>w.terminate());}
}
(globalThis as any).indexedBrowser={run};
