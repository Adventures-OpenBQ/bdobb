// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {build} from 'esbuild';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {workloads} from '../matched-executors-workloads.mjs';
const root=resolve(new URL('../..',import.meta.url).pathname),dir=await mkdtemp(join(tmpdir(),'sort-reuse-'));
try{
 const exports={calculateView:'src/lib/tableExecution/engine.ts',createResultStore:'src/lib/tableExecution/resultStore.ts',decodeWire:'src/lib/tableExecution/rust/wireCodec.ts',reorderCanonical:'scripts/applymodel-profile/sort-reuse-prototype.ts',SortCacheExperiment:'scripts/applymodel-profile/sort-cache-prototype.ts',reserveGraph:'scripts/applymodel-profile/sort-cache-prototype.ts',captureInput:'scripts/applymodel-profile/sort-cache-prototype.ts',releaseInput:'scripts/applymodel-profile/sort-cache-prototype.ts'};
 const contents=Object.entries(exports).map(([name,path])=>`export {${name}} from ${JSON.stringify(join(root,path))};`).join('\n');
 await build({stdin:{contents,resolveDir:root},bundle:true,platform:'node',format:'esm',outfile:join(dir,'tools.mjs'),logLevel:'silent',plugins:[{name:'private-reconcile-for-audit',setup(b){b.onResolve({filter:/^audit-reconcile$/},()=>({path:join(root,'src/lib/tableExecution/engine.ts')}));if(process.env.SORT_ADMISSION_FAULT)b.onLoad({filter:/\/sort-cache-prototype\.ts$/},async({path})=>({contents:(await readFile(path,'utf8')).replace('(entry?.bytes??0)*2','0'),loader:'ts'}));b.onLoad({filter:/\/tableExecution\/engine\.ts$/},async({path})=>({contents:await readFile(path,'utf8')+'\nexport {reconcileView};\n',loader:'ts'}));}}]});
 const t=await import(pathToFileURL(join(dir,'tools.mjs')).href),cases=await workloads(t);
 function snapshot(view){
  const revision={widgetId:'source',input:1,model:2,output:2},store=t.createResultStore(view,revision),blocks=[];
  const visit=path=>{let offset=0;for(;;){const block=store.rows(`rows-${JSON.stringify(path)}-${offset}`,revision,{groupPath:path,offset,limit:100});blocks.push(block);for(const g of block.groups)visit(g.path);offset+=block.rows.length;if(offset>=block.siblingCount||!block.rows.length)break;}};visit([]);
  const published={ready:store.ready('ready',revision),blocks,totals:store.totals('totals',revision),chart:store.chartData('chart',revision,view.columns.map(c=>c.id)),facets:Object.keys(view.facets).map(id=>store.facets('facet-'+id,revision,id)),exports:[false,true].map(ignore=>[...store.presented('export-'+ignore,revision,'transfer-'+ignore,100,ignore)])};
  const first=blocks[0]?.rows[0]?.id;const actions=[{kind:'all'},{kind:'clear'},...(first?[{kind:'toggle',rowId:first}]:[])];
  const selectionActions=actions.map((action,i)=>store.selection('selection-'+i,revision,action,blocks[0]?.rows.map(r=>r.id)??[]));
  return {...published,selectionActions,afterToggleExport:[...store.presented('after-toggle',revision,'after-toggle',100,false)]};
 }
 const report={method:'Experimental TypeScript canonical-view reordering, not production cache. Full structuredClone included in candidate timing. Node only, no browser speedup claim. Complete store snapshots compare ready/inspection, all nested row blocks with selection summaries, totals, facets and both full pulled exports. Rust production unchanged.',cases:[]};
 for(const name of ['nested','split','ungrouped','errors','nonfinite'])cases[name]=structuredClone(cases.formula);
 for(const [name,field] of [['nested','x'],['split','y']]){
  const m=cases[name].definition.analytical;
  m.categories.push({id:'auditSecond',name:'Audit second',sourceFieldId:field,transform:'native'});
  if(name==='nested')m.layout.rows.push('auditSecond');else m.layout.columns=['auditSecond'];
 }
 cases.ungrouped.definition.analytical.layout.rows=[];cases.ungrouped.definition.analytical.layout.columns=[];
 cases.nonfinite.dataset.rows=cases.nonfinite.dataset.rows.slice(0,12);cases.errors.dataset.rows=cases.errors.dataset.rows.slice(0,12);
 cases.nonfinite.definition.analytical.layout.rows=[];cases.nonfinite.definition.analytical.layout.columns=[];
 cases.nonfinite.dataset.columns.push({id:'auditSecondary',label:'Secondary',dtype:'number'});
 cases.nonfinite.dataset.rows.forEach((row,i)=>{row.values.x=NaN;row.values.auditSecondary=cases.nonfinite.dataset.rows.length-i;});
 cases.errors.dataset.rows[0].values.x='bad';cases.errors.dataset.rows[1].values.x=null;
 const tieSource=structuredClone(cases.ungrouped);tieSource.dataset.columns.push({id:'auditTie',label:'Tie',dtype:'number'});
 tieSource.dataset.rows.forEach(row=>row.values.auditTie=1);
 const first={...tieSource.definition,table:{...tieSource.definition.table,sorting:[{id:'x',desc:true}]}};
 const tied={...tieSource.definition,table:{...tieSource.definition.table,sorting:[{id:'auditTie',desc:false}]}};
 const previouslySorted=t.calculateView(tieSource.dataset,first,{kind:'none'},true,undefined,[],tieSource.runtimeParams);
 const freshTie=t.calculateView(tieSource.dataset,tied,{kind:'none'},true,undefined,[],tieSource.runtimeParams);
 assert.notDeepEqual(previouslySorted.logicalRows.map(r=>r.id),freshTie.logicalRows.map(r=>r.id),'fixture must expose stale tie order');
 const tieBase=t.calculateView(tieSource.dataset,{...tied,table:{...tied.table,sorting:[]}},{kind:'none'},true,undefined,[],tieSource.runtimeParams);
 assert.deepEqual(snapshot(t.reorderCanonical(tieBase,tied,{kind:'none'})),snapshot(freshTie));
 report.stableTieCounterexample={naivePreviousOrderDiffers:true,canonicalCandidateMatches:true};
 if(!process.env.SORT_CACHE_ONLY)for(const name of ['formula','fiscal','nested','split','ungrouped','errors','nonfinite']){
  const c=cases[name],canonicalDefinition=structuredClone(c.definition);canonicalDefinition.table.sorting=[];
  const base=t.calculateView(c.dataset,canonicalDefinition,{kind:'none'},true,undefined,[],c.runtimeParams);
  const fields=[base.columns.find(c=>c.id!=='\x1egroup')?.id,canonicalDefinition.analytical.layout.rows[0],c.dataset.columns.find(c=>c.dtype==='number')?.id].filter(Boolean);
  const sorts=[[],...fields.flatMap(id=>[[{id,desc:false}],[{id,desc:true}]])];
  sorts.push(fields.slice(0,2).map((id,i)=>({id,desc:!!i})));
  if(name==='nonfinite')sorts.push([{id:'x',desc:false},{id:'auditSecondary',desc:false}]);
  const ids=base.selectionIdentityRows.map(row=>row.id);
  const selections=[{kind:'none'},{kind:'explicit',ids:ids.slice(0,1)},{kind:'allMatching',excludedIds:ids.slice(0,1)}];let checks=0;
  for(const sorting of sorts)for(const selection of selections){
   const definition={...canonicalDefinition,table:{...canonicalDefinition.table,sorting}};
   const full=t.calculateView(c.dataset,definition,selection,true,undefined,[],c.runtimeParams);
   const reused=t.reorderCanonical(base,definition,selection);
   assert.deepEqual(snapshot(reused),snapshot(full),`${name} ${JSON.stringify({sorting,selection})}`);checks++;
  }
  const definition={...canonicalDefinition,table:{...canonicalDefinition.table,sorting:sorts[2]}};
  const samples={full:[],candidate:[]};
  if(!process.env.SORT_AUDIT_PARITY_ONLY)for(let i=-3;i<20;i++)for(const mode of i%2?['full','candidate']:['candidate','full']){
   const tick=performance.now();const result=mode==='full'?t.calculateView(c.dataset,definition,{kind:'none'},true,undefined,[],c.runtimeParams):t.reorderCanonical(base,definition,{kind:'none'});const ms=performance.now()-tick;
   assert(result);if(i>=0)samples[mode].push(ms);
  }
  report.cases.push({name,parityChecks:checks,inputRows:c.dataset.rows.length,canonicalCacheBudgeted:false,samples});
 }
 const c=cases.formula,context={session:{},inputGeneration:t.captureInput(c.dataset),ordering:{},runtimeParams:c.runtimeParams};
 const cache=new t.SortCacheExperiment(1024*1024*1024),definition=structuredClone(c.definition);definition.table.sorting=[{id:'ratio0',desc:true}];
 const expected=(d=definition,ctx=context)=>snapshot(t.calculateView(c.dataset,d,{kind:'none'},true,undefined,[],ctx.runtimeParams));
 let cacheChecks=0;
 const apply=(ctx=context,d=definition)=>{const r=cache.apply(d,{kind:'none'},ctx,snapshot);assert.deepEqual(r.publication,expected(d,ctx));cacheChecks++;return r;};
 const seed=apply();assert(seed.admitted&&!seed.hit);
 assert(apply().hit,'identical dependencies hit');
 for(const changed of [{...context,session:{}},{...context,inputGeneration:t.captureInput(c.dataset)},{...context,ordering:{}},{...context,runtimeParams:{'audit:inactive':{source:'viewer',memberKeys:[]}}}]){
  // Runtime keys must remain valid; use equality testing separately below.
  if(changed.runtimeParams!==context.runtimeParams)continue;
  assert(!apply(changed).hit);assert(apply(changed).hit);assert(!apply(context).hit);
 }
 const edited=structuredClone(definition);edited.analytical.formulas[0].name+=' changed';assert(!apply(context,edited).hit);assert(!apply().hit);
 for(const changed of [Object.assign(structuredClone(definition),{search:'no-matching-audit-record'}),{...definition,table:{...definition.table,hidden:['ratio0']}}]){assert(!apply(context,changed).hit);assert(!apply().hit);}
 const invalidSort=structuredClone(definition);invalidSort.table.sorting=[{id:'ratio0',desc:'invalid'}];
 assert.throws(()=>cache.apply(invalidSort,{kind:'none'},context,snapshot));assert(apply().hit);
 const reservation=cache.retainedReservation;
 assert.throws(()=>cache.apply(definition,{kind:'none'},context,()=>{throw Error('publication fault');}),/publication fault/);assert.equal(cache.retainedReservation,reservation);assert(apply().hit);
 const invalid=structuredClone(definition);invalid.analytical.schemaVersion=999;
 assert.throws(()=>cache.apply(invalid,{kind:'none'},context,snapshot));assert.equal(cache.retainedReservation,reservation);assert(apply().hit);
 cache.clear();assert.equal(cache.retainedReservation,0);assert(!apply().hit);
 for(const maximum of [0,1,Math.floor(seed.reservation/2)]){const bounded=new t.SortCacheExperiment(maximum);const r=bounded.apply(definition,{kind:'none'},context,snapshot);assert(!r.admitted&&!r.hit);assert.equal(bounded.retainedReservation,0);assert.deepEqual(r.publication,expected());cacheChecks++;}
 const exact=new t.SortCacheExperiment(seed.reservation);assert(exact.apply(definition,{kind:'none'},context,snapshot).admitted);assert(exact.apply(definition,{kind:'none'},context,snapshot).hit);cacheChecks+=2;
 const replacement=exact.apply(definition,{kind:'none'},{...context,session:{}},snapshot);assert(!replacement.admitted,'replacement must reserve the old entry too');assert.equal(exact.retainedReservation,0);cacheChecks++;
 const capturedSource=structuredClone(c.dataset),sourceToken=t.captureInput(capturedSource),ownedContext={...context,inputGeneration:sourceToken};
 const ownershipCache=new t.SortCacheExperiment(1024*1024*1024);
 const ownedFirst=ownershipCache.apply(definition,{kind:'none'},ownedContext,snapshot);capturedSource.rows[0].values.x=123456;
 const ownedHit=ownershipCache.apply(definition,{kind:'none'},ownedContext,snapshot);assert(ownedHit.hit);assert.deepEqual(ownedHit.publication,ownedFirst.publication);cacheChecks++;
 ownershipCache.clear();t.releaseInput(sourceToken);assert.throws(()=>ownershipCache.apply(definition,{kind:'none'},ownedContext,snapshot),/Unknown input snapshot/);cacheChecks++;
 const runtimeDefinition=structuredClone(definition),category=runtimeDefinition.analytical.categories[0].id;
 runtimeDefinition.analytical.params.filters=[{id:'audit-runtime',categoryId:category,label:'Audit runtime',multiSelect:true}];
 const runtimeCache=new t.SortCacheExperiment(1024*1024*1024);
 const runtimeContext={...context,runtimeParams:{[`pivot:filter:${category}`]:{source:'viewer',memberKeys:null}}};
 const emptyRuntime={...runtimeContext,runtimeParams:{[`pivot:filter:${category}`]:{source:'viewer',memberKeys:[]}}};
 for(const [ctx,hit]of [[runtimeContext,false],[runtimeContext,true],[emptyRuntime,false],[emptyRuntime,true],[runtimeContext,false]]){
  const result=runtimeCache.apply(runtimeDefinition,{kind:'none'},ctx,snapshot);assert.equal(result.hit,hit);assert.deepEqual(result.publication,expected(runtimeDefinition,ctx));cacheChecks++;
 }
 assert(t.reserveGraph(new Map([['nested','x'.repeat(1000)]]))>t.reserveGraph(new Map()));
 assert.equal(t.reserveGraph({payload:1n}),Infinity);assert.equal(t.reserveGraph({get payload(){throw Error('must not run');}}),Infinity);
 const nativeClone=globalThis.structuredClone;let publicationComplete=false;
 try{
  globalThis.structuredClone=(value,...args)=>{if(publicationComplete)throw Error('late cache snapshot');return nativeClone(value,...args);};
  assert.doesNotThrow(()=>cache.apply(definition,{kind:'none'},{...context,inputGeneration:t.captureInput(c.dataset)},view=>{const result=snapshot(view);publicationComplete=true;return result;}));
 }finally{globalThis.structuredClone=nativeClone;}
 assert(!apply().hit);
 const timing={full:[],hit:[]},publish=view=>t.createResultStore(view,{widgetId:'source',input:1,model:2,output:2}).ready('ready',{widgetId:'source',input:1,model:2,output:2});
 for(let i=-3;i<20;i++)for(const mode of i%2?['full','hit']:['hit','full']){
  const tick=performance.now();const result=mode==='full'?publish(t.calculateView(c.dataset,definition,{kind:'none'},true,undefined,[],context.runtimeParams)):cache.apply(definition,{kind:'none'},context,publish);const ms=performance.now()-tick;assert(result);if(i>=0)timing[mode].push(ms);
 }
 report.lifecycle={checks:cacheChecks,structuralCanonicalReservation:reservation,transientReservation:seed.reservation,budgetIsProcessMeasurement:false,coldAdmissionFallbackMayRecalculateTwice:true,publicationTiming:timing};
 const output=resolve(process.argv[2]??'/tmp/openbq-sort-reuse.json');await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(output);
}finally{await rm(dir,{recursive:true,force:true});}
