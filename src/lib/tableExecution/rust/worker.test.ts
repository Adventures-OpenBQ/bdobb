// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import {readFileSync} from 'node:fs';
import {beforeAll,expect,it} from 'vitest';
import {createRustWorkerHandler,type RustWorkerMessage} from './rust.worker';
import {loadRustRuntime,type RustRuntime,type WasmModule,RustRuntimeFailure} from './runtime';
import {input,definition,revision} from '../fixtures';
let runtime:RustRuntime;
beforeAll(async()=>{runtime=await loadRustRuntime(async()=>{const module=await import('./generated/pivot_wasm');await module.default({module_or_path:readFileSync(new URL('./generated/pivot_wasm_bg.wasm',import.meta.url))});return module as unknown as WasmModule;});});
it('queues validated work until actual Wasm is ready and imports supported files before typed registration',async()=>{
 const messages:RustWorkerMessage[]=[];let resolve!:(value:RustRuntime)=>void;
 const handler=createRustWorkerHandler(message=>messages.push(message),()=>new Promise(done=>{resolve=done;}),'en-US');
 const calls:unknown[]=[];
 const acquired=handler({kind:'importFile',requestId:'acquire',revision,name:'data.json',bytes:new TextEncoder().encode('[{"revenue":10},{"revenue":20}]'),inputRevision:1});
 expect(messages).toEqual([]);resolve({...runtime,dispatch:(handle,request)=>{calls.push(request);return runtime.dispatch(handle,request);}});await acquired;
 expect(calls[0]).not.toHaveProperty('bytes');expect(calls[0]).not.toHaveProperty('name');
 expect(messages.map(message=>message.kind)).toEqual(['rustReady','registered']);
 await handler({kind:'applyModel',requestId:'apply',revision,definition:{table:{},search:''},selection:{kind:'none'}});
 expect(messages.at(-1)).toMatchObject({kind:'viewReady',topLevelCount:2});
 await handler({kind:'rows',requestId:'rows',revision,request:{groupPath:[],offset:0,limit:2}});expect(messages.at(-1)).toMatchObject({kind:'rows',rows:[{values:{revenue:10}},{values:{revenue:20}}]});
 await handler({kind:'dispose',requestId:'dispose',revision});
});
it('closes real sessions on disposal and invalidates queued initialization',async()=>{
 let resolve!:(value:RustRuntime)=>void;const messages:RustWorkerMessage[]=[];
 const handler=createRustWorkerHandler(message=>messages.push(message),()=>new Promise(done=>{resolve=done;}),'en-US');
 const pending=handler({kind:'registerInput',requestId:'r',revision,input,inputRevision:1});
 const disposed=handler({kind:'dispose',requestId:'d',revision});resolve(runtime);await Promise.all([pending,disposed]);expect(messages).toEqual([]);
});
it('emits fatal loading and trap failures once and refuses subsequent publication',async()=>{
 for(const load of [async()=>{throw new Error('load failure');},async()=>({open_session:()=>1,close_session:()=>{},dispatch:()=>{throw new RustRuntimeFailure('Wasm trap');}}) as RustRuntime]){
  const messages:RustWorkerMessage[]=[];const handler=createRustWorkerHandler(message=>messages.push(message),load,'en-US');
  await handler({kind:'registerInput',requestId:'r',revision,input,inputRevision:1});await handler({kind:'applyModel',requestId:'a',revision,definition,selection:{kind:'none'}});
  expect(messages.filter(message=>message.kind==='rustFailed')).toHaveLength(1);expect(messages.some(message=>message.kind==='viewReady')).toBe(false);
 }
});
it('retains exact inspection optional-field and every-string Unicode preflight guards',async()=>{
 const messages:RustWorkerMessage[]=[];const handler=createRustWorkerHandler(message=>messages.push(message),async()=>runtime,'en-US');
 await handler({kind:'registerInput',requestId:'r',revision,input,inputRevision:1});
 for(const command of [{kind:'inspect',collection:'warnings',definitionId:'x',offset:0,limit:1},{kind:'inspect',collection:'definitions',categoryId:undefined,offset:0,limit:1},{kind:'applyModel',definition,selection:{kind:'none'},runtimeParams:{'\ud800':{source:'viewer',memberKeys:null}}}]){
  await handler({...command,requestId:'bad',revision});expect(messages.at(-1)).toMatchObject({kind:'error',error:{code:'INVALID_REQUEST'}});
 }
 await handler({kind:'dispose',requestId:'d',revision});
});
it('publishes fatal loss even when a trapped Wasm session also traps during cleanup',async()=>{
 const messages:RustWorkerMessage[]=[];
 const handler=createRustWorkerHandler(message=>messages.push(message),async()=>({open_session:()=>1,dispatch:()=>{throw new RustRuntimeFailure('Wasm trap');},close_session:()=>{throw new WebAssembly.RuntimeError('trapped cleanup');}}),'en-US');
 await handler({kind:'registerInput',requestId:'trap',revision,input,inputRevision:1});
 expect(messages).toContainEqual({kind:'rustFailed',message:'Wasm trap'});
});
it('bounded state profile refuses unbounded file parsing and keeps committed source and model',async()=>{
 const messages:RustWorkerMessage[]=[];const handler=createRustWorkerHandler(message=>messages.push(message),async()=>runtime,'en-US',{maxStateBytes:0xffff_ffff});
 await handler({kind:'registerInput',requestId:'source',revision,input,inputRevision:1});
 await handler({kind:'applyModel',requestId:'old',revision,definition:{table:{},search:''},selection:{kind:'none'}});
 expect(messages.at(-1)).toMatchObject({kind:'viewReady',topLevelCount:3});
 await handler({kind:'importFile',requestId:'file',revision:{...revision,input:2,model:0,output:0},name:'new.json',bytes:new TextEncoder().encode('[{"revenue":999}]'),inputRevision:2});
 expect(messages.at(-1)).toMatchObject({kind:'error',error:{code:'RESOURCE_LIMIT'}});
 await handler({kind:'rows',requestId:'old-rows',revision,request:{groupPath:[],offset:0,limit:3}});
 expect(messages.at(-1)).toMatchObject({kind:'rows',rows:[{id:'r0',values:{revenue:10}},{id:'r1',values:{revenue:20}},{id:'r2',values:{revenue:90}}]});
 await handler({kind:'dispose',requestId:'d',revision});
});
it('preclone byte-profile refusals preserve actual Wasm source, model, rows, totals and export without decimal encoding',async()=>{
 const huge=10n**100000n;
 for(const limits of [{maxStateBytes:0xffff_ffff},{maxInputBytes:1000000},{inputBytes:1000000}]){
  const messages:RustWorkerMessage[]=[];const handler=createRustWorkerHandler(m=>messages.push(m),async()=>runtime,'en-US',limits);
  await handler({kind:'registerInput',requestId:'source',revision,input,inputRevision:1});
  await handler({kind:'applyModel',requestId:'old',revision,definition:{table:{},search:''},selection:{kind:'none'}});
  expect(messages.at(-1)).toMatchObject({kind:'viewReady',topLevelCount:3});
  for(const candidate of [{...input,rows:[{id:'huge',values:{revenue:huge}}]},{...input,provenance:{...input.provenance,metadata:{huge}}}]){
   await handler({kind:'registerInput',requestId:'huge',revision:{...revision,input:2},input:candidate,inputRevision:2});
   expect(messages.at(-1)).toMatchObject({kind:'error',error:{code:'RESOURCE_LIMIT'}});
  }
  if('maxStateBytes'in limits)await handler({kind:'applyModel',requestId:'metadata',revision:{...revision,model:2,output:2},definition:{table:{columnFilters:[{id:'revenue',value:huge}]},search:''},selection:{kind:'none'}});
  if('maxStateBytes'in limits)expect(messages.at(-1)).toMatchObject({kind:'error',error:{code:'RESOURCE_LIMIT'}});
  // The input-only profiles permit ordinary model operations; the oversized
  // BigInt model probe belongs only to the state profile.
  await handler({kind:'rows',requestId:'rows',revision,request:{groupPath:[],offset:0,limit:3}});
  expect(messages.at(-1)).toMatchObject({kind:'rows',rows:[{id:'r0',values:{revenue:10}},{id:'r1',values:{revenue:20}},{id:'r2',values:{revenue:90}}]});
  await handler({kind:'totals',requestId:'totals',revision});expect(messages.at(-1)).toMatchObject({kind:'totals',revision});
  await handler({kind:'presented',requestId:'export',revision,transferId:'old',ignoreSelection:true});expect(messages.at(-1)).toMatchObject({kind:'subset',rows:[{id:'r0'},{id:'r1'},{id:'r2'}],final:true});
  await handler({kind:'dispose',requestId:'d',revision});
 }
});
it('uncapped and count-only profiles preserve BigInt source and metadata wire parity',async()=>{
 for(const limits of [undefined,{maxRows:10},{maxConcurrentTransfers:1}]){
  const messages:RustWorkerMessage[]=[];const handler=createRustWorkerHandler(m=>messages.push(m),async()=>runtime,'en-US',limits);
  const candidate={...input,rows:[{id:'big',values:{revenue:10n**100n}}],provenance:{...input.provenance,metadata:{big:10n**100n}}};
  await handler({kind:'registerInput',requestId:'source',revision,input:candidate,inputRevision:1});expect(messages.at(-1)).toMatchObject({kind:'registered'});
  await handler({kind:'applyModel',requestId:'model',revision,definition:{table:{},search:''},selection:{kind:'none'}});expect(messages.at(-1)).toMatchObject({kind:'viewReady'});
  await handler({kind:'rows',requestId:'rows',revision,request:{groupPath:[],offset:0,limit:1}});expect(messages.at(-1)).toMatchObject({kind:'rows',rows:[{values:{revenue:10n**100n}}]});
  await handler({kind:'dispose',requestId:'d',revision});
 }
});
it('decodes wire positions while preserving structural tag column maps and arbitrary metadata',async()=>{
 const messages:RustWorkerMessage[]=[];const h=createRustWorkerHandler(m=>messages.push(m),async()=>runtime,'en-US');
 const source={...input,columns:[{id:'region',label:'Region'},{id:'tag',label:'Tag',dtype:'number',metadata:{tag:'string',nested:{tag:'anything',value:4}}}],rows:[{id:'one',values:{region:'A',tag:2}}]};
 await h({kind:'registerInput',requestId:'r',revision,input:source,inputRevision:1});
 const d={search:'',table:{pivot:{enabled:true,grouping:['region'],split:[],aggregationFns:{tag:'sum'}}}};
 await h({kind:'applyModel',requestId:'a',revision,definition:d,selection:{kind:'none'}});
 expect(messages.at(-1)).toMatchObject({kind:'viewReady',inspection:{aggregations:{tag:'sum'},inputColumns:[{}, {metadata:{tag:'string',nested:{tag:'anything',value:4}}}]}});
 await h({kind:'previewDefinition',requestId:'p',revision,definition:d});expect(messages.at(-1)).toMatchObject({kind:'previewDefinition',rows:[{values:{tag:2}}]});
 await h({kind:'dispose',requestId:'d',revision});
});
it('preserves equal legacy leaf identities, errors and formats through nested groups and reversed offsets',async()=>{
 const messages:RustWorkerMessage[]=[];const h=createRustWorkerHandler(m=>messages.push(m),async()=>runtime,'en-US');
 const rows=['a','b'].map((id,i)=>({id,values:{region:'A',team:'T',value:1},cellErrors:{value:{code:'upstream',message:id}},cellFormats:{value:{formatterFn:i?'percent':'int'}}}));
 await h({kind:'registerInput',requestId:'r',revision,input:{...input,columns:['region','team','value'].map(id=>({id,label:id})),rows},inputRevision:1});
 await h({kind:'applyModel',requestId:'a',revision,definition:{search:'',table:{sorting:[{id:'value',desc:true}],pivot:{enabled:true,grouping:['region','team'],split:[],aggregationFns:{value:'sum'}}}},selection:{kind:'none'}});
 const path:string[]=[];
 for(let depth=0;depth<2;depth++){await h({kind:'rows',requestId:'g',revision,request:{groupPath:path,offset:0,limit:1}});const response=messages.at(-1);expect(response?.kind).toBe('rows');if(response?.kind==='rows')path.push(response.rows[0].id);}
 for(const offset of [1,0]){await h({kind:'rows',requestId:'l',revision,request:{groupPath:path,offset,limit:1}});expect(messages.at(-1)).toMatchObject({kind:'rows',rows:[{id:rows[offset].id,cellErrors:rows[offset].cellErrors,cellFormats:rows[offset].cellFormats}]});}
 await h({kind:'dispose',requestId:'d',revision});
});
for(const value of [{toString:'bad'},[{toString:'bad'}]])it('refuses actual String coercion recoverably and retains publication',async()=>{
 const messages:RustWorkerMessage[]=[];const h=createRustWorkerHandler(m=>messages.push(m),async()=>runtime,'en-US');
 // Undeclared values are inert until a model operation actually reads them.
 const source={...input,columns:[{id:'region',label:'Region'},{id:'opaque',label:'Opaque'}],rows:[{id:'safe',values:{region:'A',opaque:value}}]};
 const safe={search:'',table:{},analytical:{schemaVersion:1,enabled:false,params:{promotePage:true,filters:[]},categories:[],measures:[],formulas:[],layout:{rows:[],columns:[],values:[]},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:true}}};
 await h({kind:'registerInput',requestId:'r',revision,input:source,inputRevision:1});
 await h({kind:'applyModel',requestId:'a',revision,definition:safe,selection:{kind:'none'}});expect(messages.at(-1)).toMatchObject({kind:'viewReady'});
 await h({kind:'applyModel',requestId:'bad',revision:{...revision,model:2,output:2},definition:{search:'',table:{pivot:{enabled:true,grouping:['region'],split:[],aggregationFns:{opaque:'uniqueCount'}}}},selection:{kind:'none'}});
 expect(messages.at(-1)).toMatchObject({kind:'error'});
 await h({kind:'rows',requestId:'old',revision,request:{groupPath:[],offset:0,limit:1}});expect(messages.at(-1)).toMatchObject({kind:'rows',rows:source.rows});
 await h({kind:'totals',requestId:'t',revision});expect(messages.at(-1)).toMatchObject({kind:'totals'});
 await h({kind:'presented',requestId:'e',revision,transferId:'old',ignoreSelection:true});expect(messages.at(-1)).toMatchObject({kind:'subset',rows:source.rows,final:true});
 await h({kind:'dispose',requestId:'d',revision});
});
it('relabels an imported statement file with the given year ends and reports its reporters',async()=>{
 const {STATEMENT_CSV,STATEMENT_YEAR_ENDS,STATEMENT_LABELS}=await import('../../../test/fixtures/statementRows');
 const messages:RustWorkerMessage[]=[];const handler=createRustWorkerHandler(message=>messages.push(message),async()=>runtime,'en-US');
 await handler({kind:'importFile',requestId:'f',revision:{...revision,model:0,output:0},name:'s.csv',bytes:new TextEncoder().encode(STATEMENT_CSV),inputRevision:1,yearEnds:STATEMENT_YEAR_ENDS});
 expect(messages.at(-1)).toMatchObject({kind:'registered',fiscalSymbols:['WMT','JPM']});
 await handler({kind:'applyModel',requestId:'a',revision,definition:{table:{},search:''},selection:{kind:'none'}});
 await handler({kind:'rows',requestId:'r',revision,request:{groupPath:[],offset:0,limit:5}});
 const rows=(messages.at(-1) as {rows:{values:Record<string,unknown>}[]}).rows;
 expect(rows.map(r=>[r.values.fiscal_period,r.values.fiscal_year])).toEqual(STATEMENT_LABELS);
 await handler({kind:'dispose',requestId:'d',revision});
});
