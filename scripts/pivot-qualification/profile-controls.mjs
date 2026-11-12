// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
/** Small temporary P2 control harness; replace/adapt to qualification Task7 at P3. */
import assert from 'node:assert/strict';
import {platform,release,arch,cpus,totalmem} from 'node:os';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {checksum} from './profiling-build.mjs';
import {validateArtifact,collectProfile} from './profile.mjs';
const fixtures=new URL('../../src/test/fixtures/sec-statements/',import.meta.url);

export async function controls(){
 const referenceBytes=await readFile(new URL('reference.json',fixtures)),expectedBytes=await readFile(new URL('expected.json',fixtures));
 const reference=JSON.parse(referenceBytes),expected=JSON.parse(expectedBytes);
 const oracleSource={referenceFixtureChecksum:checksum(referenceBytes),expectedFixtureChecksum:checksum(expectedBytes)};
 const cases=Object.entries(reference.companies).map(([id,c])=>({id:`sec-${id}`,dataset:{...c.dataset,provenance:{sourceWidgetId:`sec-${id}`}},definition:c.definition,expected:expected[id],oracleSource}));
 const dataset={...structuredClone(cases[0].dataset),provenance:{sourceWidgetId:'synthetic-ticks'},columns:[{id:'date',label:'Date',dtype:'date'},{id:'price',label:'Price',dtype:'number'},{id:'volume',label:'Volume',dtype:'number'},{id:'venue',label:'Venue',dtype:'text'}],rows:[['Q',10,2],['24EQ',999,99],['Q',20,3],['Q',5,4]].map(([venue,price,volume],i)=>({id:`synthetic-tick-${i}`,values:{date:'2026-10-30T14:30:00Z',venue,price,volume}}))};
 const model={schemaVersion:1,enabled:true,params:{promotePage:false,filters:[{id:'venue-param',categoryId:'venueCategory',label:'Venue',multiSelect:true}]},categories:[{id:'dateCategory',name:'Date',sourceFieldId:'date',transform:'Y'},{id:'venueCategory',name:'Venue',sourceFieldId:'venue',transform:'native'}],measures:[['open','first'],['high','max'],['low','min'],['close','last'],['volume','sum'],['count','count']].map(([id,aggregation])=>({id,sourceFieldId:id==='volume'?'volume':'price',aggregation})),formulas:[],layout:{rows:[],columns:[],values:['open','high','low','close','volume','count']},checklists:[],resultFilters:[],subtotals:{groups:true,grandTotal:true}};
 cases.push({id:'synthetic-tiny-ticks',dataset,definition:{table:{},search:'',analytical:model},runtimeParams:{'pivot:filter:venueCategory':{source:'viewer',memberKeys:['["string","Q"]']}},expectedTotals:{open:10,high:20,low:5,close:5,volume:9,count:3}});
 return cases;
}
const revision={widgetId:'p2-control',input:1,model:1,output:1};
/** Verify every paired artifact and role before either artifact can execute. */
async function verifyBuilds(cleanDir,profileDir) {
 const builds=[];
 for(const [dir,instrumented] of [[cleanDir,false],[profileDir,true]]){
  const identity=JSON.parse(await readFile(join(dir,'identity.json')));
  assert.equal(identity.format,1,'Unsupported control artifact identity');
  assert.equal(identity.instrumented,instrumented,'Incorrect control artifact role');
  assert.match(identity.sourceCommit??'',/^[a-f0-9]{40}$/,'Invalid source commit');
  for(const key of ['sourceChecksum','patchChecksum'])assert.match(identity[key]??'',/^[a-f0-9]{64}$/,'Invalid source/patch checksum');
  assert.ok(identity.pins&&typeof identity.pins==='object','Missing control toolchain');
  let wasmBytes;
  for(const [file,key] of [['typescript.mjs','typescriptChecksum'],['wasm/pivot_wasm.js','artifactChecksum'],['wasm/pivot_wasm_bg.wasm','wasmChecksum']]){
   const bytes=await readFile(join(dir,file));assert.equal(checksum(bytes),identity[key],`Control artifact checksum mismatch: ${key}`);
   if(key==='wasmChecksum')wasmBytes=bytes;
  }
  builds.push({dir,instrumented,identity,wasmBytes});
 }
 for(const key of ['sourceCommit','sourceChecksum','patchChecksum'])assert.equal(builds[0].identity[key],builds[1].identity[key],`Control source identity mismatch: ${key}`);
 assert.deepEqual(builds[0].identity.pins,builds[1].identity.pins,'Control toolchain mismatch');
 return builds;
}
/** Hash lossless definitions; financial rows/model bodies never enter the report. */
export function controlIdentity(c,runnerChecksum,encodeWire) {
 assert.match(runnerChecksum,/^[a-f0-9]{64}$/);
 const digest=value=>checksum(JSON.stringify(encodeWire(value)));
 const publicOperations={locale:'en-US',revision,apply:{reconcileMissing:true,selectionCases:[{kind:'none'},{kind:'explicit',ids:[]}]},observedSelection:{kind:'none'},sequenceByEngine:{typescript:['calculateView','createResultStore','ready','totals','selection','presented','exported','rows-recursive','facets'],rustWasm:['open-session','registerInput','applyModel','totals','selection','rows-recursive','facets','presented','exported','close-session']},session:{protocolVersion:1,locale:'en-US',nativeFiniteNumbers:true,batchRows:'omitted-session-default'},typescriptSubsetBatchSize:500,rows:{offset:0,limit:500},facets:c.facetCategories??[],selection:{kind:'summary',visibleIds:[]},presented:{transferId:'control',ignoreSelection:false},exported:{transferId:'export',ignoreSelection:true},delivery:'all-subset-batches'};
 const fields={workloadID:c.id,serialization:'pivot-wire-v1-json',inputChecksum:digest(c.dataset),modelHash:digest({definition:c.definition,runtimeParams:c.runtimeParams}),expectedChecksum:digest(c.expected??c.expectedTotals),...c.oracleSource,runnerChecksum,publicOperations};
 return {id:digest(fields),...fields};
}

function tsControl(a,c,selection){const view=a.calculateView(c.dataset,c.definition,selection,true,undefined,[],c.runtimeParams),store=a.createResultStore(view,revision);const commands={ready:store.ready('control',revision),totals:store.totals('control',revision),blocks:[],facets:[],selection:store.selection('control',revision,{kind:'summary'},[]),presented:[...store.presented('control',revision,'control',500,false)],exported:[...store.presented('control',revision,'export',500,true)]};const visit=path=>{const block=store.rows('control',revision,{groupPath:path,offset:0,limit:500});commands.blocks.push(block);for(const g of block.groups)visit(g.path);};visit([]);for(const category of Object.keys(view.facets))commands.facets.push(store.facets('control',revision,category));return commands;}
function wasmControl(a,w,c,selection){const bridge=new a.LocaleOrderBridge('en-US'),handle=w.open_session({nativeFiniteNumbers:true,wire:JSON.stringify({protocolVersion:1,locale:'en-US'}),order(json){const q=JSON.parse(json);let value;if(q.kind==='raw'){const n=bridge.compareRaw(q.a,q.b);value=Number.isNaN(n)?'unordered':Math.sign(n)||0;}else if(q.kind==='sort')value=bridge.sortPermutation(q.values,q.descending);else if(q.kind==='scalar')value=bridge.compare(q.a,q.b);else if(q.kind==='recipe')value=bridge.compareRecipe(q.a,q.b);else throw Error('Unknown host order');return JSON.stringify({ok:value});}});
 const call=cmd=>{const req={requestId:'control',revision,...cmd};return a.decodeResponse(w.dispatch(handle,a.encodeRequest(req,'en-US',handle)),req,handle,cmd.kind==='registerInput'?'raw':a.presentationShape(c.definition));};
 try{call({kind:'registerInput',input:c.dataset,inputRevision:1});const ready=call({kind:'applyModel',definition:c.definition,selection,runtimeParams:c.runtimeParams,reconcileMissing:true});if(ready.kind==='error')return {ready};const commands={ready,totals:call({kind:'totals'}),blocks:[],facets:[],selection:call({kind:'selection',action:{kind:'summary'},visibleIds:[]}),presented:[],exported:[]};const visit=path=>{const block=call({kind:'rows',request:{groupPath:path,offset:0,limit:500}});commands.blocks.push(block);for(const g of block.groups)visit(g.path);};visit([]);
 // Statement categories are compiled internally; obtain the baseline public category names, outside timed evaluation in a future runner.
 for(const category of c.facetCategories)commands.facets.push(call({kind:'facets',categoryId:category}));
 for(const [key,transferId,ignoreSelection] of [['presented','control',false],['exported','export',true]]){let part=call({kind:'presented',transferId,ignoreSelection});commands[key].push(part);while(!part.final){part=call({kind:'nextSubset',transferId,sequence:part.sequence+1});commands[key].push(part);}}return commands;
 }finally{w.close_session(handle);}}
/** Compare numeric cells exactly against the converted source Decimal reference. */
export function check(c,s) {
 assert.equal(s.ready.kind,'viewReady');
 let cells=0;
 if(c.expected){
  const rows=s.blocks.flatMap(b=>b.rows);
  for(const [fy,lines] of Object.entries(c.expected)){
   const col=s.ready.columns.find(c=>c.splitPath?.some(p=>p.value==='FY'+fy));
   assert.ok(col);
   for(const [line,value] of Object.entries(lines)){
    const row=rows.find(r=>r.groupPath?.at(-1)?.value===line);
    assert.ok(row);
    assert.equal(row.values[col.id],Number(value),`${c.id} ${fy} ${line}`);
    cells++;
   }
  }
 }else{
  for(const [key,value] of Object.entries(c.expectedTotals)){
   assert.equal(s.totals.values[key],value,key);
  }
 }
 return cells;
}
export async function runProfileControl(workload,{artifact,observer,wasmPath,supportPath}) {
 const c=(await controls()).find(c=>c.id===workload.id);assert.ok(c,'Unknown small control');
 let a=artifact;if(wasmPath){a=await import(pathToFileURL(supportPath).href);await artifact.default({module_or_path:await readFile(wasmPath)});}
 if(wasmPath)c.facetCategories=Object.keys(a.calculateView(c.dataset,c.definition,{kind:'none'},true,undefined,[],c.runtimeParams).facets);
 const {inputChecksum,modelHash}=controlIdentity(c,checksum(await readFile(fileURLToPath(import.meta.url))),a.encodeWire);
 artifact.__pivot_profile_reset();const result=observer.measure('control-public-operations',()=>wasmPath?wasmControl(a,artifact,c,{kind:'none'}):tsControl(a,c,{kind:'none'}));
 check(c,result);return {inputChecksum,modelHash,resultChecksum:checksum(JSON.stringify(a.encodeWire(result)))};
}
export async function runControls(cleanDir,profileDir,outputDir){
 const verified=await verifyBuilds(cleanDir,profileDir),cases=await controls(),builds=[];
 const runnerChecksum=checksum(await readFile(fileURLToPath(import.meta.url)));
 for(const {dir,instrumented,identity,wasmBytes} of verified){
  const a=await import(pathToFileURL(join(dir,'typescript.mjs')).href+`?sha256=${identity.typescriptChecksum}`),w=await import(pathToFileURL(join(dir,'wasm/pivot_wasm.js')).href+`?sha256=${identity.artifactChecksum}`);
  validateArtifact(identity,a);validateArtifact(identity,w);await w.default({module_or_path:wasmBytes});builds.push({a,w,instrumented,identity});
 }
 for(const c of cases)c.facetCategories=Object.keys(builds[0].a.calculateView(c.dataset,c.definition,{kind:'none'},true,undefined,[],c.runtimeParams).facets);
 const definitions=cases.map(c=>controlIdentity(c,runnerChecksum,builds[0].a.encodeWire));
 const identityFor=c=>definitions.find(d=>d.workloadID===c.id);
 const assertUnchanged=c=>assert.deepEqual(controlIdentity(c,runnerChecksum,builds[0].a.encodeWire),identityFor(c),'Control definition changed during observation');
 const report={format:1,kind:'p2-small-controls-not-benchmark',environment:{node:process.version,platform:platform(),release:release(),arch:arch(),cpu:cpus()[0]?.model,logicalCpus:cpus().length,totalMemoryBytes:totalmem(),locale:new Intl.Collator('en-US').resolvedOptions().locale,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone},identities:builds.map(b=>b.identity),runnerChecksum,controlDefinitions:definitions,samples:[],controls:[],limitations:['same-process warmed observations; not fresh-process cold measurements','Wasm control includes public host codec/order callbacks and reads; facet discovery is outside timing','No browser workers, transport, renderer, RSS, or large workloads measured']};
 for(const engine of ['typescript','rust-wasm'])for(const c of cases){let baseline;let cells=0;for(const selection of [{kind:'none'},{kind:'explicit',ids:[]}])for(const b of builds){assertUnchanged(c);b.a.__pivot_profile_reset?.();b.w.__pivot_profile_reset?.();const result=engine==='typescript'?tsControl(b.a,c,selection):wasmControl(b.a,b.w,c,selection);assertUnchanged(c);if(!b.instrumented)baseline=result;else assert.deepEqual(result,baseline,`${engine} ${c.id} clean/profile`);if(selection.kind==='none')cells=check(c,result);else assert.equal(result.presented.flatMap(b=>b.rows).length,0,'Explicit empty delivers zero rows');}
 report.controls.push({engine,id:c.id,controlIdentity:identityFor(c).id,independentCells:cells,publicParity:'exact',selection:'none-and-explicit-empty'});
 for(let i=0;i<5;i++)for(const b of (i%2?[...builds].reverse():builds)){assertUnchanged(c);b.a.__pivot_profile_reset?.();b.w.__pivot_profile_reset?.();const begin=performance.now();if(engine==='typescript')tsControl(b.a,c,{kind:'none'});else wasmControl(b.a,b.w,c,{kind:'none'});const durationMs=performance.now()-begin;assertUnchanged(c);report.samples.push({controlIdentity:identityFor(c).id,runID:`p2-${engine}-${c.id}-${b.instrumented?'profile':'clean'}-${i}`,engine,workloadID:c.id,iteration:i,instrumented:b.instrumented,durationMs});}
 }
 const summary=values=>{const s=[...values].sort((a,b)=>a-b);return {medianMs:s[Math.floor(s.length/2)],minMs:s[0],maxMs:s.at(-1)};};
 report.overhead=[];for(const engine of ['typescript','rust-wasm'])for(const c of cases){const samples=report.samples.filter(s=>s.engine===engine&&s.workloadID===c.id),clean=summary(samples.filter(s=>!s.instrumented).map(s=>s.durationMs)),profile=summary(samples.filter(s=>s.instrumented).map(s=>s.durationMs));report.overhead.push({engine,workloadID:c.id,clean,profile,observedMedianChangePct:100*(profile.medianMs/clean.medianMs-1),interpretation:'observer-control-only; warmed, noisy, no speedup inference'});}
 assert.equal(checksum(await readFile(fileURLToPath(import.meta.url))),runnerChecksum,'Control runner changed during observations');
 await mkdir(outputDir,{recursive:true});
 for(const engine of ['typescript','rust-wasm']){const c=cases.at(-1),identity=builds[1].identity;await collectProfile({id:c.id,inputChecksum:identityFor(c).inputChecksum,modelHash:identityFor(c).modelHash},{engine,outputDir,buildIdentity:{...identity,runID:`p2-${engine}-tiny-profile`,controlRunIDs:Array.from({length:5},(_,i)=>`p2-${engine}-synthetic-tiny-ticks-clean-${i}`),runnerPath:fileURLToPath(import.meta.url),runnerChecksum,artifactPath:join(profileDir,engine==='typescript'?'typescript.mjs':'wasm/pivot_wasm.js'),artifactChecksum:engine==='typescript'?identity.typescriptChecksum:identity.artifactChecksum,...(engine==='rust-wasm'?{wasmPath:join(profileDir,'wasm/pivot_wasm_bg.wasm'),supportPath:join(profileDir,'typescript.mjs'),supportChecksum:identity.typescriptChecksum}:{})}});}
 await writeFile(join(outputDir,'controls.json'),JSON.stringify(report,null,2)+'\n');return report;
}
