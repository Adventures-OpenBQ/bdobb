// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {afterEach,expect,it,vi} from 'vitest';
import {createTableProvider,resolveTableEngine} from './providerFactory';
import {ProviderBoundary} from '../../../test/tableProviderBoundary';
import {input,revision} from '../fixtures';
import {createLocalExecutionProvider} from './remoteProviderFixture';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it.each(['typescript','rust'] as const)('%s calculates through its explicit production factory branch',async engine=>{
 vi.stubGlobal('Worker',ProviderBoundary);
 const executor=createTableProvider('source',engine),signal=new AbortController().signal;
 try{await executor.registerInput(input,1,signal);const stored={table:{},search:''};const ready=await executor.applyModel(stored,{kind:'none'},revision,signal);expect(ready.topLevelCount).toBe(3);expect(JSON.stringify(ready.inspection.definition)).toBe(JSON.stringify(stored));expect(JSON.stringify(ready.revision)).toBe(JSON.stringify(revision));expect((await executor.rows(revision,{groupPath:[],offset:0,limit:3},signal)).rows.map(r=>r.values.revenue)).toEqual([10,20,90]);}finally{executor.dispose();}
});
it('Rust initialization failure remains recoverable without silently creating a TypeScript worker',async()=>{
 let fail=true;
 class LoadingBoundary extends ProviderBoundary{constructor(url:URL|string){super(url);if(String(url).includes('rust.worker')&&fail){this.handler=async()=>{};queueMicrotask(()=>this.onmessage?.({data:{kind:'rustFailed',message:'Wasm unavailable'}} as MessageEvent));}}}
 vi.stubGlobal('Worker',LoadingBoundary);
 const executor=createTableProvider('source','rust'),signal=new AbortController().signal;
 try{await expect(executor.registerInput(input,1,signal)).rejects.toThrow('Wasm unavailable');fail=false;await executor.registerInput(input,1,signal);expect((await executor.applyModel({table:{},search:''},{kind:'none'},revision,signal)).topLevelCount).toBe(3);}finally{executor.dispose();}
});
it('explicit developer override selects Rust while production ignores it and invalid choices refuse',()=>{
 vi.stubEnv('DEV',true);vi.stubEnv('VITE_TABLE_ENGINE','rust');expect(resolveTableEngine()).toBe('rust');vi.stubEnv('VITE_TABLE_ENGINE','other');expect(()=>resolveTableEngine()).toThrow(/engine/i);vi.stubEnv('DEV',false);expect(resolveTableEngine()).toBe('typescript');
});
it('inert echo order restoration retains changed returned values and coordinate refusal',async()=>{
 const {decodeResponse}=await import('./protocol');vi.stubGlobal('Worker',ProviderBoundary);
 const executor=createTableProvider('source','rust'),signal=new AbortController().signal,stored={table:{},search:''};
 try{await executor.registerInput(input,1,signal);const ready=await executor.applyModel(stored,{kind:'none'},revision,signal);
  const request={kind:'applyModel' as const,requestId:'native',revision,definition:stored,selection:{kind:'none' as const}};
  const response={...ready,requestId:'native',topLevelCount:{kind:'exact',value:ready.topLevelCount},inspection:{...ready.inspection,definition:{search:'returned value',table:{hidden:['revenue']}}}};
  const decoded=decodeResponse(JSON.stringify({protocolVersion:1,sessionId:7,response}),request,7);
  expect(decoded?.kind).toBe('viewReady');if(decoded?.kind==='viewReady'){expect(decoded.inspection.definition.search).toBe('returned value');expect(decoded.inspection.definition.table.hidden).toEqual(['revenue']);expect(decoded.inspection.definition.table).not.toHaveProperty('columnOrder');}
  expect(()=>decodeResponse(JSON.stringify({protocolVersion:1,sessionId:7,response:{...response,revision:{...revision,output:999}}}),request,7)).toThrow(/revision/i);
 }finally{executor.dispose();}
});
it.each(['typescript','rust'] as const)('%s factory supplies the common local provider with safe-exact renderer admission',async engine=>{
 const {tableExecutorAdapter}=await import('./providerContract');vi.stubGlobal('Worker',ProviderBoundary);
 const provider=createLocalExecutionProvider(options=>createTableProvider(options.widgetId,engine));
 const session=await provider.open({kind:'local',input,inputRevision:1},{protocolVersion:1,widgetId:'source',locale:new Intl.Collator().resolvedOptions().locale});
 const adapter=tableExecutorAdapter(session),signal=new AbortController().signal;
 try{expect((await adapter.applyModel({table:{},search:''},{kind:'none'},revision,signal)).topLevelCount).toBe(3);expect((await adapter.rows(revision,{groupPath:[],offset:0,limit:3},signal)).siblingCount).toBe(3);}finally{adapter.dispose();}
});

it('creates the managed provider through an authenticated backend connection',async()=>{
 const {createManagedTableProvider}=await import('./providerFactory');
 const provider=createManagedTableProvider({id:'managed',name:'Managed',baseUrl:'https://service/api',authLocation:'header',headerName:'Authorization',headerValue:'Bearer private',validateWidgets:false});
 await expect(provider.open({kind:'local',input,inputRevision:1},{protocolVersion:1,widgetId:'source',locale:'en-US'})).rejects.toMatchObject({descriptor:{code:'UNSUPPORTED_CAPABILITY'}});
});

it('binds the standard OpenBB provider to the widget endpoint and resolved backend parameters',async()=>{
 const {createOpenbbTableProvider}=await import('./providerFactory');
 const provider=createOpenbbTableProvider({id:'standard',name:'Standard',baseUrl:'https://service/api',authLocation:'header',validateWidgets:false},{id:'ssrm',source:[],backendId:'standard',name:'SSRM',description:'',category:'',subCategory:'',gridData:{w:12,h:8},type:'table',endpoint:'data-ssrm',params:[]},{symbol:'ABC'},{inputRevision:4});
 const session=await provider.open({kind:'remote',sourceId:'widget',snapshotId:'hint'},{protocolVersion:1,widgetId:'card',locale:'en-US'});
 expect(session.consistency).toMatchObject({kind:'live'});expect(session.capabilities.safeExactCountAdmission).toBe(false);session.result.dispose();
});
