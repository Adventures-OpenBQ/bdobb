// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createTableExecutionStore } from './tableExecutionStore';
import { createTableProvider } from '../lib/tableExecution/rust/providerFactory';
import { providerHandler } from '../test/tableProviderBoundary';
import { input } from '../lib/tableExecution/fixtures';
import type { TableModelV1 } from '../lib/tableModel/types';
import type { Dashboard, DashboardCard } from '../lib/types';
import type { ExecutionRequest } from '../lib/tableExecution/types';
describe.each(['typescript','rust'] as const)('%s provider', engine => {
 const createWorkerExecutor=(id:string,factory:()=>Worker)=>createTableProvider(id,engine,{workerFactory:factory});
 const createWorkerHandler=(send:Parameters<typeof providerHandler>[1])=>providerHandler(engine,send);
 beforeEach(()=>{vi.stubEnv('DEV',true);vi.stubEnv('VITE_TABLE_ENGINE',engine);});
 afterEach(()=>vi.unstubAllEnvs());
const A='["string","A"]',B='["string","B"]',key='pivot:filter:cat';
const model:TableModelV1={schemaVersion:1,enabled:false,params:{promotePage:true,filters:[{id:'p',categoryId:'cat',label:'Region',multiSelect:true}]},categories:[{id:'cat',name:'Region',sourceFieldId:'region',transform:'native'}],measures:[],formulas:[],layout:{rows:[],columns:[],values:[]},checklists:[{categoryId:'cat',memberKeys:[A]}],resultFilters:[],subtotals:{grandTotal:false,groups:false}};
const root:DashboardCard={id:'root',widgetId:'local_table',backendId:'builtin',params:{file:'root'},layout:{x:0,y:0,w:1,h:1},tableDefinition:{table:{},search:'',analytical:model},tableSelection:{kind:'explicit',ids:['r2']}};
const dashboard=(card=root)=>({id:'d',name:'D',tabs:[{id:'t',name:'T',cards:[card]}]} as Dashboard);
function setup(card=root,initialViewer=false,dataset=input){
 let viewer=initialViewer;const listeners=new Set<()=>void>();const requests:ExecutionRequest[]=[];const acquire=vi.fn(async()=>({kind:'dataset' as const,dataset}));const persist=vi.fn(async()=>true);
 class Worker {hold=false;held:ExecutionRequest[]=[];onmessage:((event:MessageEvent)=>void)|null=null;handler=createWorkerHandler(data=>this.onmessage?.({data} as MessageEvent));postMessage(request:ExecutionRequest){requests.push(request);if(this.hold)this.held.push(request);else void this.handler(request);}terminate(){}}
 const workers:Worker[]=[];
 const store=createTableExecutionStore({executor:id=>createWorkerExecutor(id,()=>{const worker=new Worker();workers.push(worker);return worker as unknown as globalThis.Worker;}),source:()=>({acquire}),reconcileSelection:persist,viewerAuthority:{isViewer:()=>viewer,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>listeners.delete(fn);}}});
 store.syncDashboard(dashboard(card));store.ensureTable('d','root');
 return {store,workers,requests,acquire,persist,setViewer(value:boolean){viewer=value;listeners.forEach(fn=>fn());}};
}
it('true viewer overlay changes only model/output, resets on owner transition and never persists transient selection',async()=>{
 const s=setup();await s.store.settled('d');const before=s.store.readView('d','root');
 expect(()=>s.store.setViewerParam('d','root',key,[B])).toThrow(/viewer/i);
 s.setViewer(true);const sources=s.requests.filter(r=>['registerInput','importFile'].includes(r.kind)).length;
 s.store.setViewerParam('d','root',key,[B]);await s.store.settled('d');
 expect(s.store.readView('d','root').requested.input).toBe(before.requested.input);expect(s.acquire).toHaveBeenCalledTimes(1);expect(s.requests.filter(r=>['registerInput','importFile'].includes(r.kind))).toHaveLength(sources);
 expect(s.store.readView('d','root').ready?.inspection.definition).toEqual(root.tableDefinition);expect(s.store.readView('d','root').selection).toEqual(root.tableSelection);expect(s.persist).not.toHaveBeenCalled();
 const snapshot=s.store.readRuntimeParams('d','root');expect(snapshot).toEqual({[key]:{source:'viewer',memberKeys:[B]}});expect(Object.isFrozen(snapshot)).toBe(true);expect(Object.isFrozen(snapshot[key].source==='viewer'?snapshot[key].memberKeys:undefined)).toBe(true);
 const rev=s.store.readView('d','root').requested;s.store.setViewerParam('d','root',key,[B]);expect(s.store.readView('d','root').requested).toBe(rev);
 s.store.setViewerParam('d','root',key,null);await s.store.settled('d');expect(s.store.readRuntimeParams('d','root')[key]).toEqual({source:'viewer',memberKeys:null});
 s.setViewer(false);await s.store.settled('d');expect(s.store.readRuntimeParams('d','root')).toEqual({});expect(s.acquire).toHaveBeenCalledTimes(1);expect(()=>s.store.setViewerParam('d','root',key,[])).toThrow(/viewer/i);
 s.setViewer(true);expect(s.store.readRuntimeParams('d','root')).toEqual({});s.store.disposeDashboard('d');expect(s.store.readRuntimeParams('d','root')).toEqual({});
});
it('empty and reset retain baseline, and demotion/source changes prune session entries',async()=>{
 const s=setup();await s.store.settled('d');s.setViewer(true);s.store.setViewerParam('d','root',key,[]);await s.store.settled('d');expect(s.store.readView('d','root').status).toBe('empty');
 s.store.resetViewerParams('d','root');await s.store.settled('d');expect(s.store.readRuntimeParams('d','root')).toEqual({});
 s.store.setViewerParam('d','root',key,[B]);await s.store.settled('d');const demoted=structuredClone(root.tableDefinition!);(demoted.analytical as TableModelV1).params.filters=[];s.store.updateDefinition('d','root',demoted,root.tableSelection!,true);await s.store.settled('d');expect(s.store.readRuntimeParams('d','root')).toEqual({});
 s.store.syncDashboard(dashboard());await s.store.settled('d');s.store.setViewerParam('d','root',key,null);await s.store.settled('d');s.store.syncDashboard(dashboard({...root,params:{file:'other'}}));await s.store.settled('d');expect(s.store.readRuntimeParams('d','root')).toEqual({});expect(s.acquire).toHaveBeenCalledTimes(2);
});
it('superseded overlay and old row/total/facet/selection callbacks cannot activate after newer session revision',async()=>{
 const s=setup({...root,tableSelection:{kind:'none'}});await s.store.settled('d');s.setViewer(true);
 const executor=s.store.readExecutor('d','root')!,revision=s.store.readView('d','root').active!,signal=new AbortController().signal;
 const old=s.workers[0];old.hold=true;
 const readers=[executor.rows(revision,{groupPath:[],offset:0,limit:10},signal),executor.totals(revision,signal),executor.facets(revision,'cat',signal),executor.selection(revision,{kind:'summary'},[],signal)].map(p=>p.catch(e=>e.name));
 for(let i=0;i<12;i++)await Promise.resolve();
 s.store.setViewerParam('d','root',key,[B]);for(let i=0;i<12;i++)await Promise.resolve();s.store.setViewerParam('d','root',key,null);await s.store.settled('d');
 const current=s.store.readView('d','root');expect(current.ready?.topLevelCount).toBe(3);expect(await Promise.all(readers)).toEqual(['ExecutionProtocolError','ExecutionProtocolError','ExecutionProtocolError','ExecutionProtocolError']);
 for(const request of old.held)await old.handler(request);
 expect(s.store.readView('d','root')).toBe(current);expect(s.acquire).toHaveBeenCalledTimes(1);expect(s.persist).not.toHaveBeenCalled();s.store.disposeDashboard('d');
});
it('Page category replacement, Pivot off, and lease release prune dormant session intention',async()=>{
 const analytical={...model,enabled:true,checklists:[],categories:[...model.categories,{id:'teamCat',name:'Team',sourceFieldId:'team',transform:'native' as const}],layout:{...model.layout,page:{categoryId:'cat',memberKeys: [A]}}};
 const card={...root,tableSelection:{kind:'none' as const},tableDefinition:{table:{},search:'',analytical}};const s=setup(card);await s.store.settled('d');s.setViewer(true);s.store.setViewerParam('d','root','pivot:page',[B]);await s.store.settled('d');
 const next=structuredClone(card.tableDefinition);next.analytical.layout.page={categoryId:'teamCat',memberKeys: ['["string","0"]']};s.store.updateDefinition('d','root',next,{kind:'none'},true);await s.store.settled('d');expect(s.store.readRuntimeParams('d','root')).toEqual({});
 s.store.setViewerParam('d','root','pivot:page',null);await s.store.settled('d');const off=structuredClone(next);off.analytical.enabled=false;s.store.updateDefinition('d','root',off,{kind:'none'},true);await s.store.settled('d');expect(s.store.readRuntimeParams('d','root')).toEqual({});
 s.store.setViewerParam('d','root',key,null);await s.store.settled('d');const release=s.store.acquireDashboard(dashboard({...card,tableDefinition:off}));release();await Promise.resolve();expect(s.store.readRuntimeParams('d','root')).toEqual({});expect(s.store.readView('d','root').status).toBe('unavailable');
});
it('viewer reconciliation keeps the persisted-card comparison baseline intact on unchanged dashboard sync',async()=>{
 const card={...root,tableSelection:{kind:'explicit' as const,ids:['absent']}};const s=setup(card,true);await s.store.settled('d');expect(s.store.readView('d','root').selection).toEqual({kind:'none'});expect(s.persist).not.toHaveBeenCalled();
 const revision=s.store.readView('d','root').requested;s.store.syncDashboard(dashboard(card));expect(s.store.readView('d','root').requested).toBe(revision);await s.store.settled('d');expect(s.persist).not.toHaveBeenCalled();s.store.disposeDashboard('d');
});
it('group baseline changes without acquiring and viewer All/empty/reset compose against latest group',async()=>{
 const card={...root,tableSelection:{kind:'none' as const},bindings:[{groupId:'g',paramName:key}]};const s=setup(card,true);await s.store.settled('d');
 const grouped=(value:string,disabled=false)=>({...dashboard(card),groupsDisabled:disabled,groups:[{id:'g',name:'G',paramName:'region',groupType:'region',value}]});
 s.store.syncDashboard(grouped('B'));await s.store.settled('d');expect(s.store.readView('d','root').ready?.topLevelCount).toBe(1);const inputRevision=s.store.readView('d','root').requested.input;
 s.store.setViewerParam('d','root',key,null);await s.store.settled('d');expect(s.store.readView('d','root').ready?.topLevelCount).toBe(3);
 s.store.syncDashboard(grouped('A'));await s.store.settled('d');expect(s.store.readView('d','root').ready?.topLevelCount).toBe(3);s.store.setViewerParam('d','root',key,[]);await s.store.settled('d');expect(s.store.readView('d','root').ready?.topLevelCount).toBe(0);
 s.store.resetViewerParams('d','root');await s.store.settled('d');expect(s.store.readView('d','root').ready?.topLevelCount).toBe(2);expect(s.acquire).toHaveBeenCalledTimes(1);expect(s.store.readView('d','root').requested.input).toBe(inputRevision);
 s.store.setViewerParam('d','root',key,[B]);await s.store.settled('d');s.store.syncDashboard(grouped('A',true));await s.store.settled('d');expect(s.store.readView('d','root').ready?.topLevelCount).toBe(1);expect(s.store.readRuntimeParams('d','root')[key]).toEqual({source:'viewer',memberKeys:[B]});
});
it('Page groups activate with full match metadata and unchanged authored Page selector',async()=>{
 const card={...root,tableSelection:{kind:'none' as const},bindings:[{groupId:'g',paramName:'pivot:page'}],tableDefinition:{table:{},search:'',analytical:{...model,enabled:true,checklists:[],layout:{...model.layout,page:{categoryId:'cat',memberKeys: [A]}}}}};const s=setup(card);await s.store.settled('d');s.store.syncDashboard({...dashboard(card),groups:[{id:'g',name:'G',paramName:'region',groupType:'region',value:'B'}]});await s.store.settled('d');
 const ready=s.store.readView('d','root').ready!;expect(ready.topLevelCount).toBe(1);expect(ready.inspection.definition).toEqual(card.tableDefinition);expect(ready.inspection.paramMatches?.find(m=>m.key==='pivot:page')).toMatchObject({source:'group',matchedCount:1,status:'resolved'});expect(ready.diagnostics.some(d=>d.code==='PIVOT_GROUP_REFUSED')).toBe(false);expect(s.acquire).toHaveBeenCalledTimes(1);
});
it('unchanged saved-card sync resolves groups against live coordinated definition until durable publish',async()=>{
 const card={...root,tableSelection:{kind:'none' as const},bindings:[{groupId:'g',paramName:key}],tableDefinition:{...root.tableDefinition!,analytical:{...model,params:{...model.params,filters:[]}}}};const s=setup(card);await s.store.settled('d');const d={...dashboard(card),groups:[{id:'g',name:'G',paramName:'region',groupType:'region',value:'B'}]};s.store.syncDashboard(d);await s.store.settled('d');
 s.store.updateDefinition('d','root',root.tableDefinition!,{kind:'none'},false);await s.store.settled('d');expect(s.store.readView('d','root').ready?.topLevelCount).toBe(1);s.store.syncDashboard(d);await s.store.settled('d');expect(s.store.readView('d','root').ready?.topLevelCount).toBe(1);expect(s.acquire).toHaveBeenCalledTimes(1);
});
it.each([Array(1025).fill('A').join(','),'é'.repeat(8193)])('persisted oversized group refuses only its effect, preserves valid groups and recovers without acquire',async value=>{
 const analytical={...model,categories:[...model.categories,{id:'other',name:'Other',sourceFieldId:'region',transform:'native' as const}],params:{...model.params,filters:[...model.params.filters,{id:'otherp',categoryId:'other',label:'Other',multiSelect:true}]}};const card={...root,tableSelection:{kind:'none' as const},bindings:[{groupId:'bad',paramName:key},{groupId:'good',paramName:'pivot:filter:other'}],tableDefinition:{table:{},search:'',analytical}};const s=setup(card,true);await s.store.settled('d');const d=(bad:string,good='A')=>({...dashboard(card),groups:[{id:'bad',name:'Bad',paramName:'region',groupType:'region',value:bad},{id:'good',name:'Good',paramName:'region',groupType:'region',value:good}]});const before=s.store.readView('d','root').requested.input;
 s.store.syncDashboard(d(value));await s.store.settled('d');let ready=s.store.readView('d','root').ready!;expect(s.store.readView('d','root').status).toBe('ready');expect(ready.topLevelCount).toBe(2);expect(ready.inspection.paramMatches?.some(m=>m.groupId==='good')).toBe(true);expect(ready.diagnostics.some(d=>d.code==='PIVOT_GROUP_REFUSED')).toBe(true);expect(ready.inspection.definition).toEqual(card.tableDefinition);
 s.store.setViewerParam('d','root',key,null);await s.store.settled('d');const local=s.store.readRuntimeParams('d','root');s.store.syncDashboard(d(value+'A'));await s.store.settled('d');expect(s.store.readRuntimeParams('d','root')).toBe(local);expect(s.store.readView('d','root').status).toBe('ready');s.store.resetViewerParams('d','root');s.store.syncDashboard(d('B','B'));await s.store.settled('d');ready=s.store.readView('d','root').ready!;expect(ready.topLevelCount).toBe(1);expect(ready.diagnostics.some(d=>d.code==='PIVOT_GROUP_REFUSED')).toBe(false);expect(s.acquire).toHaveBeenCalledTimes(1);expect(s.store.readView('d','root').requested.input).toBe(before);
});
it.each(['keys','bytes'] as const)('persisted group %s growth cannot overflow the combined validated viewer envelope',async budget=>{
 const categories=Array.from({length:64},(_,i)=>({id:'cat'+i,name:'Cat'+i,sourceFieldId:'region',transform:'native' as const}));const analytical={...model,enabled:budget==='keys',categories,checklists:[],layout:{...model.layout,...(budget==='keys'?{page:{categoryId:'cat63',memberKeys: [A]}}:{})},params:{promotePage:budget==='keys',filters:categories.map((c,i)=>({id:'p'+i,categoryId:c.id,label:c.name,multiSelect:true}))}};const card={...root,tableSelection:{kind:'none' as const},bindings:categories.slice(0,64).map((c,i)=>({groupId:'g'+i,paramName:'pivot:filter:'+c.id})),tableDefinition:{table:{},search:'',analytical}};const s=setup(card,true);await s.store.settled('d');const viewerKey=budget==='keys'?'pivot:page':'pivot:filter:cat63';const memberKeys=budget==='keys'?[B]:Array(62).fill('x'.repeat(16384));s.store.setViewerParam('d','root',viewerKey,memberKeys);await s.store.settled('d');const local=s.store.readRuntimeParams('d','root'),before=s.store.readView('d','root').requested.input;
 s.store.syncDashboard({...dashboard(card),groups:categories.slice(0,64).map((_,i)=>({id:'g'+i,name:'G'+i,paramName:'region',groupType:'region',value:budget==='keys'?'A':'x'.repeat(16384)}))});await s.store.settled('d');const view=s.store.readView('d','root');expect(view.status).toBe('empty');expect(s.store.readRuntimeParams('d','root')).toBe(local);expect(view.ready?.diagnostics.some(d=>d.code==='PIVOT_GROUP_REFUSED')).toBe(true);expect(view.ready?.inspection.paramMatches?.some(m=>m.groupId==='g0')).toBe(true);expect(view.ready!.inspection.paramMatches!.length).toBeLessThanOrEqual(64);expect(s.acquire).toHaveBeenCalledTimes(1);expect(view.requested.input).toBe(before);
});
it.each([null,[]] as (string[]|null)[])('viewer masking frees near-capacity group candidates before the single aggregate admission',async memberKeys=>{
 const value='x'.repeat(16384),categories=Array.from({length:64},(_,i)=>({id:'cat'+i,name:'Cat'+i,sourceFieldId:'region',transform:'native' as const}));const analytical={...model,categories,checklists:[{categoryId:'cat63',memberKeys:[A]}],params:{promotePage:false,filters:categories.map((c,i)=>({id:'p'+i,categoryId:c.id,label:c.name,multiSelect:true}))}};const card={...root,tableSelection:{kind:'none' as const},bindings:categories.map((c,i)=>({groupId:'g'+i,paramName:'pivot:filter:'+c.id})),tableDefinition:{table:{},search:'',analytical}};const data=structuredClone(input);data.rows[0].values.region=value;const s=setup(card,true,data);await s.store.settled('d');const d={...dashboard(card),groups:categories.map((_,i)=>({id:'g'+i,name:'G'+i,paramName:'region',groupType:'region',value}))};const before=s.store.readView('d','root').requested.input;s.store.syncDashboard(d);await s.store.settled('d');expect(s.store.readView('d','root').ready?.diagnostics.some(d=>d.code==='PIVOT_GROUP_REFUSED')).toBe(true);
 const first='pivot:filter:cat0',last='pivot:filter:cat63';s.store.setViewerParam('d','root',first,memberKeys);await s.store.settled('d');const local=s.store.readRuntimeParams('d','root'),ready=s.store.readView('d','root').ready!;expect(ready.inspection.paramMatches?.find(m=>m.key===last)).toMatchObject({source:'group',groupId:'g63',matchedCount:1,status:'resolved'});expect(ready.diagnostics.some(d=>d.code==='PIVOT_GROUP_REFUSED')).toBe(false);expect(ready.topLevelCount).toBe(memberKeys===null?1:0);s.store.syncDashboard(d);await s.store.settled('d');expect(s.store.readRuntimeParams('d','root')).toBe(local);
 s.store.resetViewerParams('d','root');await s.store.settled('d');const reset=s.store.readView('d','root').ready!;expect(reset.diagnostics.some(d=>d.code==='PIVOT_GROUP_REFUSED')).toBe(true);expect(reset.inspection.paramMatches?.some(m=>m.key===last)).toBe(false);expect(reset.topLevelCount).toBe(0);expect(s.acquire).toHaveBeenCalledTimes(1);expect(s.store.readView('d','root').requested.input).toBe(before);
});

it('full Page group baseline and viewer set All None reset compose without acquisition or durable writes',async()=>{const analytical={...model,enabled:true,checklists:[],layout:{...model.layout,page:{categoryId:'cat',memberKeys:[A]}}};const card={...root,tableSelection:{kind:'none' as const},bindings:[{paramName:'pivot:page',groupId:'g'}],tableDefinition:{table:{},search:'',analytical}};const s=setup(card,true);const grouped=(value:string,groupsDisabled=false)=>({...dashboard(card),groupsDisabled,groups:[{id:'g',name:'G',paramName:'region',groupType:'region',value}]});await s.store.settled('d');s.store.syncDashboard(grouped('A,B'));await s.store.settled('d');expect(s.store.readView('d','root').ready?.topLevelCount).toBe(3);const inputRevision=s.store.readView('d','root').requested.input;s.store.setViewerParam('d','root','pivot:page',[B]);await s.store.settled('d');s.store.syncDashboard(grouped('A'));await s.store.settled('d');expect(s.store.readView('d','root').ready?.topLevelCount).toBe(1);s.store.setViewerParam('d','root','pivot:page',null);await s.store.settled('d');expect(s.store.readView('d','root').ready?.topLevelCount).toBe(3);s.store.setViewerParam('d','root','pivot:page',[]);await s.store.settled('d');expect(s.store.readView('d','root').ready?.topLevelCount).toBe(0);s.store.resetViewerParams('d','root','pivot:page');await s.store.settled('d');expect(s.store.readView('d','root').ready?.topLevelCount).toBe(2);s.store.syncDashboard(grouped('B',true));await s.store.settled('d');expect(s.store.readView('d','root').ready?.topLevelCount).toBe(2);expect(s.store.readView('d','root').ready?.inspection.definition).toEqual(card.tableDefinition);expect(s.acquire).toHaveBeenCalledTimes(1);expect(s.persist).not.toHaveBeenCalled();expect(s.store.readView('d','root').requested.input).toBe(inputRevision);});
it('same-ID source recipe replacement prunes Page and filter while display rename preserves intent and off retains filter',async()=>{const analytical={...model,enabled:true,checklists:[],layout:{...model.layout,page:{categoryId:'cat',memberKeys:[A]}}};const card={...root,tableSelection:{kind:'none' as const},tableDefinition:{table:{},search:'',analytical}};const s=setup(card,true);await s.store.settled('d');s.store.setViewerParam('d','root','pivot:page',[A,B]);s.store.setViewerParam('d','root',key,null);await s.store.settled('d');const renamed={...card.tableDefinition,analytical:{...analytical,categories:[{...analytical.categories[0],name:'Renamed'}]}};s.store.updateDefinition('d','root',renamed,{kind:'none'});await s.store.settled('d');expect(s.store.readRuntimeParams('d','root')['pivot:page']).toEqual({source:'viewer',memberKeys:[A,B]});const replaced={...renamed,analytical:{...renamed.analytical,categories:[{...renamed.analytical.categories[0],sourceFieldId:'team'}]}};s.store.updateDefinition('d','root',replaced,{kind:'none'});await s.store.settled('d');expect(s.store.readRuntimeParams('d','root')).toEqual({});s.store.setViewerParam('d','root','pivot:page',null);s.store.setViewerParam('d','root',key,null);await s.store.settled('d');s.store.updateDefinition('d','root',{...replaced,analytical:{...replaced.analytical,enabled:false}},{kind:'none'});await s.store.settled('d');expect(s.store.readRuntimeParams('d','root')).toEqual({[key]:{source:'viewer',memberKeys:null}});expect(s.acquire).toHaveBeenCalledTimes(1);});

it.each(['typescript','rust'] as const)('%s store resolves the selected provider without an executor injection',async engine=>{
 const {ProviderBoundary}=await import('../test/tableProviderBoundary');vi.stubGlobal('Worker',ProviderBoundary);
 const store=createTableExecutionStore({engine,source:()=>({acquire:async()=>({kind:'dataset',dataset:input})})});
 try{store.syncDashboard(dashboard());store.ensureTable('d','root');await store.settled('d');expect(store.readView('d','root').status).toBe('ready');expect(store.readView('d','root').ready?.inspection.definition).toEqual(root.tableDefinition);}finally{store.disposeDashboard('d');vi.unstubAllGlobals();}
});

it('selected store executor retains complete chart/export reads and preview does not replace the published result',async()=>{
 const {ProviderBoundary}=await import('../test/tableProviderBoundary');vi.stubGlobal('Worker',ProviderBoundary);
 const store=createTableExecutionStore({engine,source:()=>({acquire:async()=>({kind:'dataset',dataset:input})})});
 try{
  const card={...root,tableSelection:{kind:'explicit' as const,ids:['r2']},tableDefinition:{table:{},search:''}};
  store.syncDashboard(dashboard(card));store.ensureTable('d','root');await store.settled('d');
  const view=store.readView('d','root'),executor=store.readExecutor('d','root')!,signal=new AbortController().signal;
  expect(view.status).toBe('ready');const chart=await executor.chartData(view.active!,['revenue'],signal);expect(chart.rows.map(row=>row.values.revenue)).toEqual([90]);
  const exported=[];for await(const batch of executor.presented(view.active!,signal))exported.push(...batch.rows);expect(exported.map(row=>row.id)).toEqual(['r2']);
  const full=[];for await(const batch of executor.presented(view.active!,signal,true))full.push(...batch.rows);expect(full.map(row=>row.values.revenue)).toEqual([10,20,90]);
  expect((await executor.previewDefinition!(view.active!,{table:{},search:'B'},signal)).total).toBe(1);expect(store.readView('d','root')).toBe(view);
  expect((await executor.rows(view.active!,{groupPath:[],offset:0,limit:10},signal)).rows.map(row=>row.values.revenue)).toEqual([10,20,90]);
 }finally{store.disposeDashboard('d');vi.unstubAllGlobals();}
});

});
