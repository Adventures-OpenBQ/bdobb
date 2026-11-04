// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
async function exercise(rows,sorting,optIn){
 const root=resolve(new URL('..',import.meta.url).pathname),dir=await mkdtemp(join(tmpdir(),'native-order-test-'));
 try{
  const p=join(dir,'tools.mjs');
  await build({stdin:{contents:`export {encodeRequest,decodeResponse} from ${JSON.stringify(join(root,'src/lib/tableExecution/rust/protocol.ts'))};export {LocaleOrderBridge} from ${JSON.stringify(join(root,'src/lib/tableExecution/rust/orderingBridge.ts'))};`,resolveDir:root},bundle:true,platform:'node',format:'esm',outfile:p,logLevel:'silent'});
  const tools=await import(pathToFileURL(p).href),module=await import(new URL('../src/lib/tableExecution/rust/generated/pivot_wasm.js',import.meta.url).href);
  await module.default({module_or_path:await readFile(new URL('../src/lib/tableExecution/rust/generated/pivot_wasm_bg.wasm',import.meta.url))});
  const bridge=new tools.LocaleOrderBridge('en-US'),calls={numeric:0,other:0,permutation:0};
  const host={wire:JSON.stringify({protocolVersion:1,locale:'en-US'}),order(json){
   const q=JSON.parse(json);let value;
   if(q.kind==='raw'){
    const both=q.a.tag==='f64'&&q.b.tag==='f64';calls[both?'numeric':'other']++;
    const raw=bridge.compareRaw(q.a,q.b);value=Number.isNaN(raw)?'unordered':Math.sign(raw)||0;
   }else if(q.kind==='sort'){calls.permutation++;value=bridge.sortPermutation(q.values,q.descending);}
   else if(q.kind==='scalar')value=bridge.compare(q.a,q.b);
   else if(q.kind==='recipe')value=bridge.compareRecipe(q.a,q.b);
   else throw Error('Unexpected host command');
   return JSON.stringify({ok:value});
  },...(optIn===undefined?{}:{nativeFiniteNumbers:optIn})};
  const handle=module.open_session(host),revision={widgetId:'source',input:1,model:1,output:1};let id=0;
  const call=command=>{const q={...command,revision,requestId:`q${++id}`};const response=tools.decodeResponse(module.dispatch(handle,tools.encodeRequest(q,'en-US',handle)),q,handle,'raw');assert.notEqual(response.kind,'error',JSON.stringify(response));return response;};
  try{
   call({kind:'registerInput',inputRevision:1,input:{rows,columns:[{id:'v',label:'Value',dtype:'number'},{id:'tie',label:'Tie',dtype:'number'}],resultRevision:1,outputRevision:1,provenance:{sourceWidgetId:'source'},completeness:{kind:'complete',warnings:[]},freshness:{availability:'available',stale:false}}});
   call({kind:'applyModel',definition:{table:{sorting},search:''},selection:{kind:'none'},reconcileMissing:false});
   const result=call({kind:'rows',request:{groupPath:[],offset:0,limit:100}});
   return {rows:result.rows,calls};
  }finally{module.close_session(handle);}
 }finally{await rm(dir,{recursive:true,force:true});}
}
const numericRows=[
 {id:'max',values:{v:Number.MAX_VALUE,tie:0}}, {id:'minusZero',values:{v:-0,tie:2}},
 {id:'zero',values:{v:0,tie:1}}, {id:'min',values:{v:-Number.MAX_VALUE,tie:0}},
 {id:'tiny',values:{v:Number.MIN_VALUE,tie:0}}, {id:'minusTiny',values:{v:-Number.MIN_VALUE,tie:0}},
 {id:'seven',values:{v:7,tie:0}}, {id:'null',values:{v:null,tie:0}}, {id:'missing',values:{tie:1}}
];
test('finite ordering opt-in skips numeric callbacks and preserves signed zero, missing-last and secondary keys',async()=>{
 for(const desc of [false,true]){
  const sorting=[{id:'v',desc},{id:'tie',desc:false}];
  const before=await exercise(numericRows,sorting,undefined),after=await exercise(numericRows,sorting,true);
  assert.deepEqual(after.rows,before.rows);
  assert.deepEqual(after.rows.map(r=>r.id),desc?['max','seven','tiny','zero','minusZero','minusTiny','min','null','missing']:['min','minusTiny','zero','minusZero','tiny','seven','max','null','missing']);
  assert.ok(Object.is(after.rows.find(r=>r.id==='minusZero').values.v,-0));
  assert.ok(before.calls.numeric>0);assert.equal(after.calls.numeric,0);assert.ok(after.calls.other>0);
 }
});
test('nonfinite and mixed domains retain complete host permutations, including multi-key NaN behavior',async()=>{
 for(const values of [[NaN,Infinity,-Infinity,1,0],[2,'10','2','item10','item2']]){
  const rows=values.map((v,i)=>({id:`r${i}`,values:{v,tie:values.length-i}}));
  const sorting=[{id:'v',desc:false},{id:'tie',desc:false}];
  const before=await exercise(rows,sorting,undefined),after=await exercise(rows,sorting,true);
  assert.deepEqual(after.rows,before.rows);assert.ok(before.calls.permutation>0);assert.ok(after.calls.permutation>0);
 }
});
