// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import {readFileSync,readdirSync} from 'node:fs';
import {expect,it,beforeAll} from 'vitest';
import {loadRustRuntime,type RustRuntime,type WasmModule} from './runtime';
import {decodeWire,type WireValue} from './wireCodec';
import type {ExecutionRequest,ExecutionResponse,Revision,TableDefinition,ViewReady,SelectionResult,SubsetBatch} from '../types';
import type {OracleCase,OracleResult} from './oracle';
import type {DatasetRow} from '../../widgetData/types';
import {input,definition,revision} from '../fixtures';
let runtime:RustRuntime;
beforeAll(async()=>{
 runtime=await loadRustRuntime(async()=>{
  const module=await import('./generated/pivot_wasm');
  await module.default({module_or_path:readFileSync(new URL('./generated/pivot_wasm_bg.wasm',import.meta.url))});
  return module as unknown as WasmModule;
 });
});
it('uses actual compiled session exports, lossless values, bounded pull and closed handle refusal',()=>{
 const handle=runtime.open_session({protocolVersion:1,locale:'en-US',batchRows:1});
 const call=(command:object)=>runtime.dispatch(handle,{requestId:'wire-test',revision,...command} as ExecutionRequest)!;
 expect(call({kind:'registerInput',input,inputRevision:1}).kind).toBe('registered');
 expect(call({kind:'applyModel',definition,selection:{kind:'none'}}).kind).toBe('viewReady');
 expect(call({kind:'rows',request:{groupPath:[],offset:0,limit:1}})).toMatchObject({kind:'rows',siblingCount:2});
 expect(call({kind:'presented',transferId:'stream',ignoreSelection:true})).toMatchObject({kind:'subset',sequence:0,final:false});
 expect(call({kind:'nextSubset',transferId:'stream',sequence:1})).toMatchObject({kind:'subset',sequence:1,final:false});
 expect(call({kind:'nextSubset',transferId:'stream',sequence:2})).toMatchObject({kind:'subset',sequence:2,final:true});
 runtime.close_session(handle);expect(()=>call({kind:'totals'})).toThrow('session');
});
it('rejects lone UTF16 anywhere before registration and retains valid pairs',()=>{
 const handle=runtime.open_session({protocolVersion:1,locale:'en-US'});
 expect(()=>runtime.dispatch(handle,{kind:'registerInput',requestId:'x',revision,inputRevision:1,input:{...input,provenance:{...input.provenance,metadata:{'bad\ud800':'x'}}}})).toThrow('Unicode');
 expect(()=>runtime.dispatch(handle,{kind:'registerInput',requestId:'x',revision,inputRevision:1,input:{...input,rows:[{id:'😀',values:{revenue:10}}]}})).not.toThrow();
 runtime.close_session(handle);
});
const clean=<T extends ExecutionResponse>(value:T)=>{const {requestId,...rest}=value;void requestId;return rest;};
function equivalent(actual:unknown,expected:unknown,path=''):void {
 if(typeof actual==='number'&&typeof expected==='number'&&/(margin|ratio|mean|avg)/i.test(path)&&Number.isFinite(actual)&&Number.isFinite(expected)){
  expect(Math.abs(actual-expected),path).toBeLessThanOrEqual(Math.max(1e-12,1e-12*Math.max(Math.abs(actual),Math.abs(expected))));return;
 }
 if(actual&&expected&&typeof actual==='object'&&typeof expected==='object'){
  expect(Array.isArray(actual),path).toBe(Array.isArray(expected));expect(Object.keys(actual).sort(),path).toEqual(Object.keys(expected).sort());
  for(const key of Object.keys(expected))equivalent((actual as Record<string,unknown>)[key],(expected as Record<string,unknown>)[key],`${path}.${key}`);return;
 }
 expect(actual,path).toEqual(expected);
}
for(const file of readdirSync(new URL('../../../test/fixtures/rust-pivot/',import.meta.url)).filter(name=>name.endsWith('.json'))){
 it(`real Wasm frozen consumer trace: ${file}`,()=>{
  const root=decodeWire(JSON.parse(readFileSync(new URL(`../../../test/fixtures/rust-pivot/${file}`,import.meta.url),'utf8')) as WireValue) as {formatVersion:number;baselineRevision:string;case:OracleCase;result:Required<OracleResult>};
  expect(root.formatVersion).toBe(1);expect(root.baselineRevision).toBe('74cc3f6c4c718cd76044722b954a7bc0761c8866');
  const c=root.case,want=root.result;
  const handle=runtime.open_session({protocolVersion:1,locale:c.locale,batchRows:2});
  let rev:Revision={widgetId:'oracle',input:c.dataset.resultRevision,model:1,output:1},def:TableDefinition=c.definition,selection=c.selection,params=c.runtimeParams;
  const call=(command:object)=>runtime.dispatch(handle,{requestId:'oracle',revision:rev,...command} as ExecutionRequest)!;
  const apply=()=>call({kind:'applyModel',definition:def,selection,reconcileMissing:false,runtimeParams:params});
  try{
   call({kind:'registerInput',input:c.dataset,inputRevision:rev.input});
   let ready=apply();
   if(c.expectFailure){expect(ready.kind).toBe('error');if(ready.kind==='error')expect(ready.error.message).toBe(want.error.message);return;}
   expect(ready.kind).toBe('viewReady');
   for(let i=0;i<c.operations.length;i++){
    const op=c.operations[i];let value:unknown;
    switch(op.kind){
     case 'selection': {
      value=clean(call({kind:'selection',action:op.action,visibleIds:op.visibleIds??want.selection.rows.map(r=>r.rowId)}));
      selection=(value as SelectionResult).selection;rev={...rev,model:rev.model+1,output:rev.output+1};ready=apply();break;
     }
     case 'apply':def=op.definition??def;params=op.runtimeParams??params;rev={...rev,model:rev.model+1,output:rev.output+1};ready=apply();value=clean(ready);break;
     case 'preview':value=clean(call({kind:'previewDefinition',definition:op.definition}));break;
     case 'bindFormula':case 'memberDomain':value=clean(call({...op}));break;
     case 'inspect':value=clean(call({kind:'inspect',...op.request}));break;
     case 'identityWitness':
      // Frozen direct-helper length-one witnesses are not legal transport requests.
      if(op.path.length<2)continue;
      value=clean(call({...op}));break;
     case 'linked': {
      const delivered=subset(false),{batches:_batches,revision:_revision,...child}=delivered,childHandle=runtime.open_session({protocolVersion:1,locale:c.locale}),childRev={...rev,widgetId:'linked'};
      const childCall=(command:object)=>runtime.dispatch(childHandle,{requestId:'oracle',revision:childRev,...command} as ExecutionRequest)!;
      childCall({kind:'registerInput',input:{...child,resultRevision:rev.model,outputRevision:rev.output},inputRevision:rev.input});
      const childReady=childCall({kind:'applyModel',definition:op.definition,selection:op.selection??{kind:'none'}}) as ViewReady;
      value={ready:clean(childReady),chart:clean(childCall({kind:'chartData',fields:childReady.columns.map(col=>col.id)})),totals:clean(childCall({kind:'totals'}))};runtime.close_session(childHandle);break;
     }
    }
    equivalent(value,want.operations[i].value,`${file}.operations.${i}`);
   }
   equivalent(clean(ready),want.ready,`${file}.ready`);
   for(const delivery of want.deliveries)for(const block of delivery.blocks){
    equivalent(clean(call({kind:'rows',request:{groupPath:block.groupPath,offset:block.offset,limit:delivery.size}})),block,`${file}.rows`);
   }
   equivalent(clean(call({kind:'totals'})),want.totals,`${file}.totals`);
   equivalent(clean(call({kind:'selection',action:{kind:'summary'},visibleIds:want.selection.rows.map(r=>r.rowId)})),want.selection,`${file}.selection`);
   for(const facet of want.facets)equivalent(clean(call({kind:'facets',categoryId:facet.categoryId})),facet,`${file}.facets`);
   for(const page of want.inspection)equivalent(clean(call({kind:'inspect',collection:page.collection,offset:page.offset,limit:page.limit})),page,`${file}.inspection`);
   equivalent(clean(call({kind:'chartData',fields:(ready as ViewReady).columns.map(col=>col.id)})),want.chart,`${file}.chart`);
   equivalent(subset(false),want.linked,`${file}.linked`);equivalent(subset(true),want.export,`${file}.export`);
   function subset(ignoreSelection:boolean){
    const transferId=`stream-${ignoreSelection}-${rev.model}`;let sequence=0;const rows:DatasetRow[]=[];const batches:Omit<SubsetBatch,'requestId'>[]=[];let first!:SubsetBatch;
    for(;;){const batch=call(sequence===0?{kind:'presented',transferId,ignoreSelection}:{kind:'nextSubset',transferId,sequence}) as SubsetBatch;if(sequence===0)first=batch;batches.push({...clean(batch),transferId:'oracle-transfer'});rows.push(...batch.rows);if(batch.final)break;sequence++;}
    return {batches,revision:rev,rows,columns:first.columns,provenance:first.provenance,completeness:first.completeness,freshness:first.freshness,diagnostics:first.diagnostics};
   }
  }finally{runtime.close_session(handle);}
 });
}
it('preserves a cell named tag and negative-zero saved literals through the real wire',()=>{
 const handle=runtime.open_session({protocolVersion:1,locale:'en-US'});
 const call=(command:object)=>runtime.dispatch(handle,{requestId:'tag-test',revision,...command} as ExecutionRequest)!;
 const value={tag:'record-like',value:Infinity,nested:[undefined,9007199254740993n,-0]};
 expect(call({kind:'registerInput',input:{...input,columns:[{id:'tag',label:'Tag'}],rows:[{id:'one',values:{tag:value}}]},inputRevision:1}).kind).toBe('registered');
 const analytical={schemaVersion:1,enabled:false,params:{promotePage:false,filters:[]},categories:[],measures:[],formulas:[{id:'zero',name:'Zero',scope:'source',expression:'-0',ast:{kind:'literal',value:-0}}],layout:{rows:[],columns:[],values:[]},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:true}};
 expect(call({kind:'applyModel',definition:{table:{},search:'',analytical},selection:{kind:'none'}}).kind).toBe('viewReady');
 const rows=call({kind:'rows',request:{groupPath:[],offset:0,limit:1}});expect(rows).toMatchObject({kind:'rows'});
 if(rows.kind!=='rows')throw new Error('Missing rows');
 expect(rows.rows[0].values.tag).toEqual(value);expect(Object.is(rows.rows[0].values.zero,-0)).toBe(true);
 runtime.close_session(handle);
});
it('returns the acquired schema after legacy or warning-producing publication',()=>{
 for(const source of [{dataset:input,definition},{...((decodeWire(JSON.parse(readFileSync(new URL('../../../test/fixtures/rust-pivot/statement-fiscal-warning.json',import.meta.url),'utf8')) as WireValue) as {case:OracleCase}).case)}]){
  const handle=runtime.open_session({protocolVersion:1,locale:'en-US'});
  const rev={...revision,input:source.dataset.resultRevision};
  const call=(command:object)=>runtime.dispatch(handle,{requestId:'schema',revision:rev,...command} as ExecutionRequest)!;
  call({kind:'registerInput',input:source.dataset,inputRevision:rev.input});call({kind:'applyModel',definition:source.definition,selection:{kind:'none'}});
  const schema=call({kind:'inputSchema'});expect(schema).toMatchObject({kind:'inputSchema',columns:source.dataset.columns});
  if(schema.kind!=='inputSchema')throw new Error('Missing schema');expect(schema.columns).toStrictEqual(source.dataset.columns);
  runtime.close_session(handle);
 }
});
