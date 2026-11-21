// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {build} from 'esbuild';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {workloads} from '../matched-executors-workloads.mjs';
import {insertOnce} from './instrument.mjs';
const root=resolve(new URL('../..',import.meta.url).pathname),dir=await mkdtemp(join(tmpdir(),'stage-audit-'));
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const probe={calls:{},hashes:{},hit(n){this.calls[n]=(this.calls[n]??0)+1;},capture(n,v){this.hashes[n]=digest(v);},reset(){this.calls={};this.hashes={};},take(){return structuredClone({calls:this.calls,hashes:this.hashes});}};
globalThis.__stageAudit=probe;
try{
 const exports={createWorkerHandler:'src/lib/tableExecution/table.worker.ts',encodeRequest:'src/lib/tableExecution/rust/protocol.ts',decodeResponse:'src/lib/tableExecution/rust/protocol.ts',decodeWire:'src/lib/tableExecution/rust/wireCodec.ts',LocaleOrderBridge:'src/lib/tableExecution/rust/orderingBridge.ts'};
 const contents=Object.entries(exports).map(([name,path])=>`export {${name}} from ${JSON.stringify(join(root,path))};`).join('\n');
 await build({stdin:{contents,resolveDir:root},bundle:true,platform:'node',format:'esm',outfile:join(dir,'tools.mjs'),logLevel:'silent',plugins:[{name:'stage-counters',setup(b){b.onLoad({filter:/\/(engine|calculate)\.ts$/},async({path})=>{
  let s=await readFile(path,'utf8');
  if(path===join(root,'src/lib/tableExecution/engine.ts')){
   s=insertOnce(s,'  input = structuredClone(input);',`  (globalThis as any).__stageAudit.hit('viewCalculate');\n  input = structuredClone(input);`);
   s=insertOnce(s,'  const result = pivotTable(base);',`  (globalThis as any).__stageAudit.hit('legacyPivot');\n  const result = pivotTable(base);`);
  }else if(path===join(root,'src/lib/tableModel/calculate.ts')){
   for(const [anchor,label] of [['    const compiled = compileAnalyticalModel','compile'],['    const evaluated = evaluateSourceFormulas','sourceEvaluate'],['    const pool = eligiblePool','eligiblePool'],['    const totals: CalculatedTotals =','totalsStage']])s=insertOnce(s,anchor,`    (globalThis as any).__stageAudit.hit('${label}');\n${anchor}`);
   s=insertOnce(s,'    const groupResolutions:Record<string,GroupResolution>={};',`    (globalThis as any).__stageAudit.capture('sourceRows',evaluated.rows);\n    const groupResolutions:Record<string,GroupResolution>={};`);
   s=insertOnce(s,'    const page = activePage(pool, model.layout.page);',`    (globalThis as any).__stageAudit.capture('poolRows',pool.rows);\n    const page = activePage(pool, model.layout.page);`);
  }
  return {contents:s,loader:'ts'};
 });}}]});
 const t=await import(pathToFileURL(join(dir,'tools.mjs')).href),cases=await workloads(t);
 const wasm=await import(pathToFileURL('/tmp/openbq-v4-decode-profile/generated/pivot_wasm.js').href);await wasm.default({module_or_path:await readFile('/tmp/openbq-v4-decode-profile/generated/pivot_wasm_bg.wasm')});
 const report={method:'Diagnostic stage counts only; instrumented TypeScript modules and emitted WASM. No reuse implemented, no speedup measured. Sort-only apply compared with initial apply. Child rows read uses same revision. Digests compare TypeScript source/pool rows across sort change.',cases:[]};
 for(const name of ['representative','formula']){
  const c=cases[name],bridge=new t.LocaleOrderBridge('en-US'),host={wire:JSON.stringify({protocolVersion:1,locale:'en-US'}),nativeFiniteNumbers:true,order(text){const q=JSON.parse(text);let value;if(q.kind==='raw'){const n=bridge.compareRaw(q.a,q.b);value=Number.isNaN(n)?'unordered':Math.sign(n)||0;}else if(q.kind==='sort')value=bridge.sortPermutation(q.values,q.descending);else if(q.kind==='scalar')value=bridge.compare(q.a,q.b);else if(q.kind==='recipe')value=bridge.compareRecipe(q.a,q.b);else throw Error(q.kind);return JSON.stringify({ok:value});}};
  const handle=wasm.open_session(host);let latest;
  const ts=t.createWorkerHandler(response=>{latest=response;});let id=0;
  const call=async(command,model=1)=>{
   const q={requestId:`audit-${++id}`,revision:{widgetId:'source',input:c.dataset.resultRevision,model,output:model},...command};
   probe.reset();await ts(q);assert(latest?.requestId===q.requestId);assert.notEqual(latest.kind,'error',JSON.stringify(latest));const tsResult=latest,tsStages=probe.take();
   wasm.profile_start();const result=t.decodeResponse(wasm.dispatch(handle,t.encodeRequest(q,'en-US',handle)),q,handle,'raw');const spans=JSON.parse(wasm.profile_take());assert.notEqual(result.kind,'error',JSON.stringify(result));
   const calls=Object.fromEntries(spans.map(s=>[s.name,s.calls]));return {tsResult,tsStages,rustCalls:calls,rustResult:result};
  };
  try{
   await call({kind:'registerInput',input:c.dataset,inputRevision:c.dataset.resultRevision});
   const apply=definition=>({kind:'applyModel',definition,selection:{kind:'none'},reconcileMissing:false,provenAbsentIds:[],runtimeParams:c.runtimeParams});
   const initial=await call(apply(c.definition));
   const beforeTotals=await call({kind:'totals'});
   const sorted=structuredClone(c.definition);sorted.table.sorting=[{id:name==='formula'?'ratio0':'profit',desc:true}];
   const sort=await call(apply(sorted),2);
   const afterTotals=await call({kind:'totals'},2);
   assert.deepEqual(afterTotals.tsResult.values,beforeTotals.tsResult.values);
   assert.deepEqual(afterTotals.rustResult.values,beforeTotals.rustResult.values);
   const rootRows=await call({kind:'rows',request:{groupPath:[],offset:0,limit:100}},2);
   assert(rootRows.tsResult.groups.length>0,'expected groups for expansion audit');
   const childRows=await call({kind:'rows',request:{groupPath:rootRows.tsResult.groups[0].path,offset:0,limit:100}},2);
   assert.deepEqual(sort.tsStages.hashes,initial.tsStages.hashes,'sort changed source/pool rows');
   report.cases.push({name,initial:initial.tsStages,sortOnly:sort.tsStages,initialRust:initial.rustCalls,sortOnlyRust:sort.rustCalls,rootRows:{typescript:rootRows.tsStages.calls,rust:rootRows.rustCalls},childRows:{typescript:childRows.tsStages.calls,rust:childRows.rustCalls},sourceAndPoolDigestsEqual:true,typescriptTotalsEqual:true});
  }finally{wasm.close_session(handle);}
 }
 const output=resolve(process.argv[2]??'/tmp/openbq-stage-audit.json');await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(output);
}finally{delete globalThis.__stageAudit;await rm(dir,{recursive:true,force:true});}
