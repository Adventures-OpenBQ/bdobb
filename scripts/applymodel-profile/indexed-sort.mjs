// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {build} from 'esbuild';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {workloads} from '../matched-executors-workloads.mjs';
const root=resolve(new URL('../..',import.meta.url).pathname),dir=await mkdtemp(join(tmpdir(),'indexed-sort-'));
try{
 const exports={calculateView:'src/lib/tableExecution/engine.ts',createResultStore:'src/lib/tableExecution/resultStore.ts',decodeWire:'src/lib/tableExecution/rust/wireCodec.ts',seedIndexedStore:'scripts/applymodel-profile/indexed-sort-prototype.ts'};
 const contents=Object.entries(exports).map(([name,path])=>`export {${name}} from ${JSON.stringify(join(root,path))};`).join('\n');
 await build({stdin:{contents,resolveDir:root},bundle:true,platform:'node',format:'esm',outfile:join(dir,'tools.mjs'),logLevel:'silent',plugins:[{name:'audit-private-store',setup(b){
  b.onResolve({filter:/^audit-reconcile$/},()=>({path:join(root,'src/lib/tableExecution/engine.ts')}));
  b.onResolve({filter:/^audit-store-owned$/},()=>({path:join(root,'src/lib/tableExecution/resultStore.ts')}));
  b.onLoad({filter:/\/tableExecution\/engine\.ts$/},async({path})=>({contents:await readFile(path,'utf8')+'\nexport {reconcileView};\n',loader:'ts'}));
  b.onLoad({filter:/\/tableExecution\/resultStore\.ts$/},async({path})=>{
   let s=await readFile(path,'utf8');
   const anchor='  view = structuredClone(view);\n  revision = structuredClone(revision);';assert.equal(s.split(anchor).length,2);
   s=s.replace(anchor,'  return buildAuditOwnedStore(structuredClone(view),structuredClone(revision));\n}\nexport function buildAuditOwnedStore(view:CalculatedView,revision:Revision):ResultStore {');
   const at='  return {\n    ready(';assert.equal(s.split(at).length,2);
   s=s.replace(at,`  return {\n    __auditStats(){return indexedStats(view);},\n    __auditResort(definition,selection,nextRevision){\n      if(nextRevision.widgetId!==revision.widgetId||nextRevision.input!==revision.input||nextRevision.model<=revision.model||nextRevision.output<=revision.output)throw Error('invalid audit revision');\n      const candidate=indexedReorder(view,definition,selection);\n      return buildAuditOwnedStore(candidate,structuredClone(nextRevision));\n    },\n    ready(`);
   s=`import {indexedReorder,indexedStats} from ${JSON.stringify(join(root,'scripts/applymodel-profile/indexed-sort-prototype.ts'))};\n`+s;
   return {contents:s,loader:'ts'};
  });
 }}]});
 const t=await import(pathToFileURL(join(dir,'tools.mjs')).href),cases=await workloads(t);
 function snapshot(store,rev){
  const blocks=[];const visit=path=>{for(let offset=0;;){const b=store.rows('rows-'+JSON.stringify(path)+'-'+offset,rev,{groupPath:path,offset,limit:100});blocks.push(b);for(const g of b.groups)visit(g.path);offset+=b.rows.length;if(offset>=b.siblingCount||!b.rows.length)break;}};visit([]);
  const ready=store.ready('ready',rev),fields=ready.columns.map(c=>c.id);
  const result={ready,blocks,totals:store.totals('totals',rev),chart:store.chartData('chart',rev,fields),exports:[false,true].map(ignore=>[...store.presented('export-'+ignore,rev,'transfer-'+ignore,100,ignore)])};
  const first=blocks[0]?.rows[0]?.id;result.selectionActions=[{kind:'all'},{kind:'clear'},...(first?[{kind:'toggle',rowId:first}]:[])].map((action,i)=>store.selection('selection-'+i,rev,action,blocks[0]?.rows.map(r=>r.id)??[]));
  result.afterToggleExport=[...store.presented('after-toggle',rev,'after-toggle',100,false)];return result;
 }
 for(const name of ['nested','split','ungrouped','nonfinite','duplicates'])cases[name]=structuredClone(cases.formula);
 for(const [name,field]of [['nested','x'],['split','y']]){const m=cases[name].definition.analytical;m.categories.push({id:'auditSecond',name:'Audit second',sourceFieldId:field,transform:'native'});if(name==='nested')m.layout.rows.push('auditSecond');else m.layout.columns=['auditSecond'];}
 for(const name of ['ungrouped','nonfinite','duplicates']){cases[name].definition.analytical.layout.rows=[];cases[name].definition.analytical.layout.columns=[];}
 cases.nonfinite.dataset.rows=cases.nonfinite.dataset.rows.slice(0,12);cases.nonfinite.dataset.columns.push({id:'auditSecondary',label:'Secondary',dtype:'number'});cases.nonfinite.dataset.rows.forEach((row,i)=>{row.values.x=NaN;row.values.auditSecondary=12-i;});
 cases.duplicates.dataset.rows=cases.duplicates.dataset.rows.slice(0,12);cases.duplicates.dataset.rows[1].id=cases.duplicates.dataset.rows[0].id;
 const report={method:'Audit-only result-store hooks. One private retained calculated view plus object-identity order indexes; no retained canonical calculation copy. Candidate clones the private view once, restores order, sorts and constructs an owned new store. No production API or Rust changes. Harness retains separate oracle data. Node observations only.',cases:[]};
 for(const name of ['formula','fiscal','nested','split','ungrouped','nonfinite','duplicates']){
  const c=cases[name],def=structuredClone(c.definition);def.table.sorting=[];
  const base=t.calculateView(c.dataset,def,{kind:'none'},true,undefined,[],c.runtimeParams),initialRev={widgetId:'source',input:c.dataset.resultRevision,model:1,output:1};
  let store=t.seedIndexedStore(base,initialRev),rev=initialRev;
  const stats=store.__auditStats(),ids=base.selectionIdentityRows.map(r=>r.id),fields=[base.columns.find(c=>c.id!=='\x1egroup')?.id,def.analytical.layout.rows[0],c.dataset.columns.find(c=>c.dtype==='number')?.id].filter(Boolean);
  const sorts=[[],...fields.flatMap(id=>[[{id,desc:false}],[{id,desc:true}]])];if(name==='nonfinite')sorts.push([{id:'x',desc:false},{id:'auditSecondary',desc:false}]);
  const selections=[{kind:'none'},{kind:'explicit',ids:ids.slice(0,1)},{kind:'allMatching',excludedIds:ids.slice(0,1)},{kind:'explicit',ids:['absent-audit-id']}];let checks=0;
  for(const sorting of [...sorts,...sorts.slice().reverse()])for(const selection of selections){
   const d={...def,table:{...def.table,sorting}},next={...rev,model:rev.model+1,output:rev.output+1};
   const candidate=store.__auditResort(d,selection,next),full=t.createResultStore(t.calculateView(c.dataset,d,selection,true,undefined,[],c.runtimeParams),next);
   assert.deepEqual(snapshot(candidate,next),snapshot(full,next),name+' repeated '+checks);store=candidate;rev=next;checks++;
  }
  const previous=store.ready('ready',rev),invalid=structuredClone(def);invalid.table.sorting=[{id:'x',desc:'invalid'}];assert.throws(()=>store.__auditResort(invalid,{kind:'none'},{...rev,model:rev.model+1,output:rev.output+1}));assert.deepEqual(store.ready('ready',rev),previous);
  const samples={full:[],indexed:[]};
  if(!process.env.INDEXED_NODE_PARITY_ONLY)for(let i=-3;i<20;i++)for(const mode of i%2?['full','indexed']:['indexed','full']){
   const d={...def,table:{...def.table,sorting:sorts[(i+3)%sorts.length]}},next={...rev,model:rev.model+1,output:rev.output+1},tick=performance.now();
   if(mode==='full'){const result=t.createResultStore(t.calculateView(c.dataset,d,{kind:'none'},true,undefined,[],c.runtimeParams),next);result.ready('ready',next);}else{store=store.__auditResort(d,{kind:'none'},next);rev=next;store.ready('ready',rev);}
   const ms=performance.now()-tick;if(i>=0)samples[mode].push(ms);
  }
  report.cases.push({name,checks,inputRows:c.dataset.rows.length,stats,samples});
 }
 const output=resolve(process.argv[2]??'/tmp/openbq-indexed-sort.json');await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(output);
}finally{await rm(dir,{recursive:true,force:true});}
