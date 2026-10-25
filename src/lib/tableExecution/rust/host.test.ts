// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import {readFileSync} from 'node:fs';
import {beforeAll,expect,it,vi} from 'vitest';
import {loadRustRuntime,type RustRuntime,type WasmModule,RustRuntimeFailure} from './runtime';
import {LocaleOrderBridge} from './orderingBridge';
import {decodeWire,type WireValue} from './wireCodec';
import {input,revision} from '../fixtures';
import type {ExecutionRequest,TableDefinition} from '../types';
import type {OracleCase} from './oracle';
import type {TableModelV1} from '../../tableModel/types';
import {categoryAuthoringRecipe} from '../../tableModel/categoryAuthoringRecipe';
let runtime:RustRuntime;
beforeAll(async()=>{runtime=await loadRustRuntime(async()=>{const module=await import('./generated/pivot_wasm');await module.default({module_or_path:readFileSync(new URL('./generated/pivot_wasm_bg.wasm',import.meta.url))});return module as unknown as WasmModule;});});
for(const method of ['compare','compareRaw','sortPermutation','compareRecipe'] as const){
 it(`propagates complete ${method} host Diagnostic and preserves the committed native revision`,()=>{
  const handle=runtime.open_session({protocolVersion:1,locale:'en-US'});
  const call=(command:object,rev=revision)=>runtime.dispatch(handle,{requestId:'host',revision:rev,...command} as ExecutionRequest)!;
  const data=method==='sortPermutation'?{...input,rows:[{id:'a',values:{revenue:10}},{id:'b',values:{revenue:'20'}}]}:input;
  call({kind:'registerInput',input:data,inputRevision:1});
  const initial={table:{},search:''};expect(call({kind:'applyModel',definition:initial,selection:{kind:'none'}}).kind).toBe('viewReady');
  const diagnostic={code:'MISSING_FIELD',message:`${method} original evidence`,severity:'error',path:'host-path',definitionId:'defined',dependencyId:'dep',key:'key',memberKeys:['member'],unmatchedCount:1,truncated:true};
  const spy=vi.spyOn(LocaleOrderBridge.prototype,method).mockImplementation(()=>{throw {descriptor:diagnostic};});
  try{
   let response;
   if(method==='compareRecipe'){
    const root=decodeWire(JSON.parse(readFileSync(new URL('../../../test/fixtures/rust-pivot/analytical-source-split.json',import.meta.url),'utf8')) as WireValue) as {case:OracleCase};
    const model=root.case.definition.analytical as TableModelV1;model.categories[0].sourceFieldId='plus';
    response=call({kind:'memberDomain',definition:root.case.definition,categoryId:model.categories[0].id,categoryRecipe:categoryAuthoringRecipe(model,model.categories[0].id),offset:0,limit:2});
   }else{
    const def:TableDefinition=method==='compare'?{table:{pivot:{enabled:true,grouping:['region'],split:[],measures:[{id:'minimum',sourceFieldId:'revenue',aggregation:'min'}]}},search:''}:{table:{sorting:[{id:'revenue',desc:false}]},search:''};
    response=call({kind:'applyModel',definition:def,selection:{kind:'none'}},{...revision,model:2,output:2});
   }
   expect(spy).toHaveBeenCalled();expect(response).toMatchObject({kind:'error',error:{code:'MISSING_FIELD'},diagnostics:expect.arrayContaining([diagnostic])});
  }finally{spy.mockRestore();}
  expect(call({kind:'rows',request:{groupPath:[],offset:0,limit:1}})).toMatchObject({kind:'rows',siblingCount:data.rows.length});runtime.close_session(handle);
 });
}
it('treats raw Unordered as a successful comparison and supports legal witness/cancellation controls',()=>{
 const handle=runtime.open_session({protocolVersion:1,locale:'en-US'});
 const call=(command:object)=>runtime.dispatch(handle,{requestId:'host',revision,...command} as ExecutionRequest);
 call({kind:'registerInput',input:{...input,rows:[{id:'a',values:{revenue:NaN}},{id:'b',values:{revenue:Infinity}}]},inputRevision:1});
 const definition={table:{sorting:[{id:'revenue',desc:false}]},search:''};
 expect(call({kind:'applyModel',definition,selection:{kind:'none'}})).toMatchObject({kind:'viewReady',diagnostics:[]});
 expect(call({kind:'identityWitness',path:[{table:{},search:''},{table:{},search:''}],ids:['a','absent']})).toMatchObject({kind:'identityWitness',identities:[{id:'a',state:'present'},{id:'absent',state:'absent'}]});
 expect(call({kind:'cancel',targetRequestId:'host'})).toBeUndefined();expect(call({kind:'dispose'})).toBeUndefined();runtime.close_session(handle);
});
it('classifies traps and malformed compiled responses as fatal adapter failures',async()=>{
 for(const dispatch of [()=>{throw new WebAssembly.RuntimeError('unreachable');},()=>'{"protocolVersion":1,"sessionId":1,"response":{"kind":"rows"}}']){
  const loaded=await loadRustRuntime(async()=>({protocol_version:()=>1,open_session:()=>1,close_session:()=>{},dispatch}));const handle=loaded.open_session({protocolVersion:1,locale:'en-US'});
  expect(()=>loaded.dispatch(handle,{kind:'totals',requestId:'x',revision})).toThrow(RustRuntimeFailure);loaded.close_session(handle);
 }
});
it('maps direct typed import to an explicit native acquisition refusal',()=>{
 const handle=runtime.open_session({protocolVersion:1,locale:'en-US'});
 const response=runtime.dispatch(handle,{kind:'importFile',requestId:'direct-import',revision,inputRevision:1,name:'data.json',bytes:new TextEncoder().encode('[]')});
 expect(response).toMatchObject({kind:'error',diagnostics:expect.arrayContaining([expect.objectContaining({code:'UNSUPPORTED_OPERATION'})])});runtime.close_session(handle);
});
