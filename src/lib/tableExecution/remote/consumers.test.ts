// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {readFileSync} from 'node:fs';
import {decodeWire,type WireValue} from '../rust/wireCodec';
import type {OracleCase,OracleResult} from '../rust/oracle';
import type {TableModelV1} from '../../tableModel/types';
import {categoryAuthoringRecipe} from '../../tableModel/categoryAuthoringRecipe';
import {afterEach,expect,it,vi} from 'vitest';
import {createTableExecutionStore,type TableExecutionStore} from '../../../stores/tableExecutionStore';
import {useWidgetRegistryStore} from '../../../stores/widgetRegistryStore';
import {normalizeWidgets} from '../../widgetsJson';
import {createRemoteProviderFixture} from '../rust/remoteProviderFixture';
import {realRustRuntime} from '../../../test/tableProviderBoundary';
import {input} from '../fixtures';
import {collectPresentedExport} from '../../export';
import {beginSubset,appendSubset,commitSubset} from '../subsetTransfer';
import type {Dashboard,DashboardCard} from '../../types';
import type {ProviderSession,ExecutionProvider,TableDefinition} from '../types';
import type {WidgetDataset} from '../../widgetData/types';
const signal=()=>new AbortController().signal;
const flat:TableDefinition={table:{},search:''};
const source:WidgetDataset={...input,rows:Array.from({length:205},(_,i)=>({id:`r${i}`,values:{revenue:i+1,region:i===204?'Unseen':'A',team:String(i),date:'2026-01-01'}}))};
const root:DashboardCard={id:'root',backendId:'b',widgetId:'managed',params:{},layout:{x:0,y:0,w:10,h:10},managedSource:{sourceId:'private',kind:'upload',version:1}};
const child:DashboardCard={id:'child',backendId:'builtin',widgetId:'linked_table',params:{},layout:{x:0,y:0,w:10,h:10},linkedSource:{kind:'widget',sourceWidgetId:'root'}};
const dashboard=(cards=[root,child]):Dashboard=>({id:'d',name:'D',tabs:[{id:'t',name:'T',cards}]});
const stores:TableExecutionStore[]=[];
afterEach(()=>{for(const store of stores.splice(0))store.disposeDashboard('d');});
/** Models server ownership using the compiled Rust provider. This is orchestration qualification,
 * not an HTTP/native-service E2E: only this backend fixture materializes derived input. */
async function setup(cards=[root,child],linked=true,data=source){
 useWidgetRegistryStore.setState({widgets:normalizeWidgets({managed:{type:'table_ssrm',provider:'managed-native',protocolVersion:1,endpoint:'/sessions'}},'b').widgets});
 const runtime=await realRustRuntime();
 const sessions:ProviderSession[]=[],disposals:ReturnType<typeof vi.fn>[]=[],derivations:ReturnType<typeof vi.fn>[]=[],presented:ReturnType<typeof vi.fn>[]=[];
 let failDerive=false,failApply=false;
 const holds:{derive?:Promise<void>;chart?:Promise<void>}={};
 async function open(data:WidgetDataset,options:Parameters<ExecutionProvider['open']>[1]):Promise<ProviderSession>{
  const fixture=createRemoteProviderFixture({runtime,input:data,sourceId:'private',snapshotId:'',batchRows:37});
  const original=await fixture.provider.open({kind:'remote',sourceId:'private',snapshotId:''},options);
  const dispose=vi.fn(original.result.dispose),stream=vi.fn(original.result.presented);
  const derive=vi.fn<NonNullable<ProviderSession['deriveLinked']>>(async(revision,opts)=>{
   if(failDerive)throw new Error('Derivation refused');
   let transaction:ReturnType<typeof beginSubset>|undefined;
   for await(const batch of original.result.presented(revision,opts.signal??signal())){transaction??=beginSubset(batch.transferId,revision);appendSubset(transaction,batch);}
   const dataset=commitSubset(transaction!);
   const child=await open({...dataset,resultRevision:opts.inputRevision},opts);
   if(holds.derive)await holds.derive;
   return child;
  });
  const session:ProviderSession={...original,capabilities:{...original.capabilities,linkedDerivation:linked},...(linked?{deriveLinked:derive}:{}),result:{...original.result,presented:stream,dispose,chartData:async(...args)=>{const result=await original.result.chartData(...args);if(holds.chart)await holds.chart;return result;},applyModel:async(...args)=>{if(failApply&&options.widgetId!=='root')throw new Error('Child apply refused');return original.result.applyModel(...args);}}};
  sessions.push(session);disposals.push(dispose);derivations.push(derive);presented.push(stream);return session;
 }
 const acquire=vi.fn(),executor=vi.fn();
 const store=createTableExecutionStore({source:acquire,executor,managedProvider:()=>({open:async(binding,options)=>open({...data,resultRevision:binding.kind==='remote'?binding.managed!.inputRevision:1},options)})});
 stores.push(store);store.syncDashboard(dashboard(cards));store.ensureTable('d',cards.at(-1)!.id);await store.settled('d');
 return {store,holds,sessions,disposals,derivations,presented,acquire,executor,failDerive:()=>{failDerive=true;},failApply:()=>{failApply=true;}};
}
it('derives managed linked chains from full selected results without client input or subset transfer and reconstructs on reopen',async()=>{
 const grandchild={...child,id:'grandchild',linkedSource:{kind:'widget' as const,sourceWidgetId:'child'}};
 const s=await setup([{...root,tableSelection:{kind:'allMatching',excludedIds:['r204']}},child,grandchild]);
 expect(s.store.readView('d','grandchild').status).toBe('ready');
 expect(s.executor).not.toHaveBeenCalled();expect(s.acquire).not.toHaveBeenCalled();
 expect(s.derivations[0]).toHaveBeenCalledWith(s.store.readView('d','root').active,expect.objectContaining({widgetId:'child',inputRevision:1,protocolVersion:1,locale:expect.any(String)}));
 expect(s.presented[0]).not.toHaveBeenCalled();expect(s.presented[1]).not.toHaveBeenCalled();
 const view=s.store.readView('d','grandchild');
 expect(view.ready?.topLevelCount).toBe(204);
 const chart=await s.store.readExecutor('d','grandchild')!.chartData(view.active!,['team','revenue'],signal());
 expect(chart.rows).toHaveLength(204);expect(chart.rows.at(-1)?.values.revenue).toBe(204);
 s.store.reopen('d','root');await s.store.settled('d');
 expect(s.store.readView('d','grandchild').ready?.topLevelCount).toBe(204);
 expect(s.sessions).toHaveLength(6);
});
it('refuses managed linking without server derivation and never falls back to a local worker',async()=>{
 const s=await setup(undefined,false);
 expect(s.store.readView('d','child').error).toMatch(/server.*deriv|deriv.*support/i);
 expect(s.executor).not.toHaveBeenCalled();expect(s.presented[0]).not.toHaveBeenCalled();
});
it.each(['derive','apply'] as const)('preserves the old child on failed replacement %s',async failure=>{
 const s=await setup();const before=s.store.readView('d','child'),executor=s.store.readExecutor('d','child');
 expect(before.status).toBe('ready');
 if(failure==='derive')s.failDerive();else s.failApply();
 s.store.updateDefinition('d','root',{...flat,search:'Unseen'},{kind:'none'});await s.store.settled('d');
 const after=s.store.readView('d','child');
 expect(after.active).toEqual(before.active);expect(after.sourceRevision).toEqual(before.sourceRevision);expect(after.stale).toBe(true);
 expect(s.store.readExecutor('d','child')).toBe(executor);expect(s.disposals[1]).not.toHaveBeenCalled();
 if(failure==='apply')expect(s.disposals[2]).toHaveBeenCalledTimes(1);
});
it('retains a retired child until its paused export releases the session',async()=>{
 const s=await setup();const old=s.store.readView('d','child').active!;
 expect(old).toBeDefined();
 const iterator=s.store.readExecutor('d','child')!.presented(old,signal())[Symbol.asyncIterator]();
 const first=await iterator.next();expect(first.value.rows).toHaveLength(37);
 s.store.updateDefinition('d','root',{...flat,search:'Unseen'},{kind:'none'});await s.store.settled('d');
 expect(s.store.readView('d','child').ready?.topLevelCount).toBe(1);expect(s.disposals[1]).not.toHaveBeenCalled();
 const rows=[...first.value.rows];for(;;){const next=await iterator.next();if(next.done)break;rows.push(...next.value.rows);}
 expect(rows).toHaveLength(205);expect(s.disposals[1]).toHaveBeenCalledTimes(1);
});

it('exports all eligible rows and projects selected chart/subset scope beyond the loaded page',async()=>{
 const s=await setup([{...root,tableSelection:{kind:'allMatching',excludedIds:['r204']}}]);
 const view=s.store.readView('d','root'),executor=s.store.readExecutor('d','root')!;
 const page=await executor.rows(view.active!,{groupPath:[],offset:0,limit:100},signal());expect(page.rows).toHaveLength(100);
 const chart=await executor.chartData(view.active!,['team','revenue'],signal());expect(chart.rows).toHaveLength(204);
 const selected=await collectPresentedExport(executor,view.active!,signal(),false);expect(selected.rows).toHaveLength(204);
 const exported=await collectPresentedExport(executor,view.active!,signal());expect(exported.rows).toHaveLength(205);expect(exported.rows.at(-1)?.Revenue).toBe(205);
});

it('keeps a chart on the admitted child revision while a replacement publishes',async()=>{
 const s=await setup();let release!:()=>void;s.holds.chart=new Promise<void>(r=>release=r);
 const before=s.store.readView('d','child').active!;
 const chart=s.store.readExecutor('d','child')!.chartData(before,['team','revenue'],signal());
 s.store.updateDefinition('d','root',{...flat,search:'Unseen'},{kind:'none'});await s.store.settled('d');
 expect(s.disposals[1]).not.toHaveBeenCalled();expect(s.store.readView('d','child').ready?.topLevelCount).toBe(1);
 release();const result=await chart;expect(result.rows).toHaveLength(205);expect(result.revision).toEqual(before);expect(s.disposals[1]).toHaveBeenCalledTimes(1);
});
it('iterator return releases a paused retired export and explicit disposal closes active and retired sessions',async()=>{
 const s=await setup();const old=s.store.readView('d','child').active!;
 const iterator=s.store.readExecutor('d','child')!.presented(old,signal())[Symbol.asyncIterator]();await iterator.next();
 s.store.updateDefinition('d','root',{...flat,search:'Unseen'},{kind:'none'});await s.store.settled('d');
 await iterator.return!();expect(s.disposals[1]).toHaveBeenCalledTimes(1);
 s.store.disposeDashboard('d');expect(s.disposals.every(dispose=>dispose.mock.calls.length===1)).toBe(true);
});
it('disposes a late derived candidate when a newer generation supersedes it',async()=>{
 const s=await setup();let release!:()=>void;s.holds.derive=new Promise<void>(r=>release=r);
 s.store.updateDefinition('d','root',{...flat,search:'Unseen'},{kind:'none'});
 await vi.waitFor(()=>expect(s.sessions).toHaveLength(3));
 s.holds.derive=undefined;
 s.store.updateDefinition('d','root',flat,{kind:'none'});
 await vi.waitFor(()=>expect(s.store.readView('d','child').ready?.topLevelCount).toBe(205));
 release();await s.store.settled('d');
 expect(s.disposals[2]).toHaveBeenCalledTimes(1);expect(s.store.readView('d','child').ready?.topLevelCount).toBe(205);
 expect(s.store.readView('d','child').sourceRevision).toEqual(s.store.readView('d','root').active);
});
it('failed parent refresh retains completed child identity and an admitted child export',async()=>{
 const s=await setup();const before=s.store.readView('d','child');
 const iterator=s.store.readExecutor('d','child')!.presented(before.active!,signal())[Symbol.asyncIterator]();await iterator.next();
 s.store.refresh('d','root');await s.store.settled('d');
 expect(s.store.readView('d','root').status).toBe('failed');
 expect(s.store.readView('d','child').active).toEqual(before.active);expect(s.store.readView('d','child').sourceRevision).toEqual(before.sourceRevision);
 expect(s.disposals[1]).not.toHaveBeenCalled();expect((await iterator.next()).value.rows).toHaveLength(37);await iterator.return!();
});

it('includes unseen split columns and recomputes nonadditive totals over more than one group page',async()=>{
 const grouped={...source,rows:source.rows.map((row,i)=>({...row,values:{...row.values,region:`R${Math.floor(i/2)}`,team:i===204?'Unseen':'Seen'}}))};
 const model:TableModelV1={schemaVersion:1,enabled:true,params:{promotePage:false,filters:[]},categories:[{id:'regionCategory',name:'Region',sourceFieldId:'region',transform:'native'},{id:'teamCategory',name:'Team',sourceFieldId:'team',transform:'native'}],measures:[{id:'mean',sourceFieldId:'revenue',aggregation:'mean'}],formulas:[],layout:{rows:['regionCategory'],columns:[],values:['mean']},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:true}};
 const definition={table:{},search:'',analytical:model};const s=await setup([{...root,tableDefinition:definition}],true,grouped);
 let view=s.store.readView('d','root');const executor=s.store.readExecutor('d','root')!;
 expect(view.ready?.topLevelCount,JSON.stringify(view.ready)).toBe(103);expect((await executor.rows(view.active!,{groupPath:[],offset:0,limit:100},signal())).rows).toHaveLength(100);
 expect((await executor.totals(view.active!,signal())).values.mean).toBe(103);
 const all=[];for await(const batch of executor.presented(view.active!,signal()))all.push(...batch.rows);
 const excluded=all.at(-1)!.id;
 s.store.updateDefinition('d','root',definition,{kind:'allMatching',excludedIds:[excluded]});await s.store.settled('d');view=s.store.readView('d','root');
 const chart=await executor.chartData(view.active!,view.ready!.columns.map(c=>c.id),signal());expect(chart.rows).toHaveLength(102);expect(chart.rows.some(row=>row.id===excluded)).toBe(false);
 s.store.updateDefinition('d','root',{...definition,analytical:{...model,layout:{...model.layout,columns:['teamCategory']}}},{kind:'none'});await s.store.settled('d');view=s.store.readView('d','root');
 const unseen=view.ready!.columns.find(c=>c.splitPath?.some(p=>p.value==='Unseen'))!;expect(unseen).toBeDefined();
 expect((await executor.totals(view.active!,signal())).values[unseen.id]).toBe(205);
});
function corpus(name:string){return decodeWire(JSON.parse(readFileSync(`${process.cwd()}/src/test/fixtures/rust-pivot/${name}.json`,'utf8')) as WireValue) as {case:OracleCase;result:Required<OracleResult>};}
for(const name of ['analytical-source-split','ratio-source-scope','mixed-fiscal-calendars','company-fiscal-quarter','statement-income-wide','statement-balance','statement-cashflow','statement-hidden-dependency'])it(`store consumers preserve compiled full-scope semantics and saved reopen: ${name}`,async()=>{
 const {case:c,result:want}=corpus(name);const s=await setup([{...root,tableDefinition:c.definition,tableSelection:c.selection}],true,c.dataset);
 for(let run=0;run<2;run++){
  const view=s.store.readView('d','root'),executor=s.store.readExecutor('d','root')!;
  expect(view.status,view.error).toMatch(/ready|empty/);expect(view.ready!.columns).toEqual(want.ready.columns);
  expect((await executor.totals(view.active!,signal())).values).toEqual(want.totals.values);
  expect((await executor.chartData(view.active!,view.ready!.columns.map(c=>c.id),signal())).rows).toEqual(want.chart.rows);
  const exported=[];for await(const batch of executor.presented(view.active!,signal(),true))exported.push(...batch.rows);expect(exported).toEqual(want.export.rows);
  if(run===0){s.store.reopen('d','root');await s.store.settled('d');}
 }
});
it('binds formulas and inspects full member domains, applying shared runtime parameters beyond loaded rows',async()=>{
 const c=corpus('runtime-authoring-linked').case,model=c.definition.analytical as TableModelV1;
 const data={...source,rows:source.rows.map((row,i)=>({...row,values:{...row.values,region:`R${i}`}}))};
 const card={...root,tableDefinition:c.definition};const s=await setup([card],true,data);const executor=s.store.readExecutor('d','root')!,revision=s.store.readView('d','root').active!;
 const members=await executor.memberDomain!(revision,{definition:c.definition,categoryId:'regionCategory',categoryRecipe:categoryAuthoringRecipe(model,'regionCategory'),offset:200,limit:50},signal());
 expect(members.total).toBe(205);expect(members.rows).toHaveLength(5);
 const binding=c.operations.find(op=>op.kind==='bindFormula')!;if(binding.kind!=='bindFormula')throw new Error('fixture');
 const bound=await executor.bindFormula!(revision,binding,signal());expect(bound.ast).toBeDefined();expect(bound.bindingDiagnostics).toEqual([]);
 s.store.syncDashboard({...dashboard([{...card,bindings:[{paramName:'pivot:filter:regionCategory',groupId:'g'}]}]),groups:[{id:'g',name:'Region',paramName:'region',groupType:'region',value:'R204'}]});await s.store.settled('d');
 const view=s.store.readView('d','root');expect(view.ready?.topLevelCount).toBe(1);
 const chart=await executor.chartData(view.active!,['region','revenue','sourceDouble'],signal());expect(chart.rows[0].values).toMatchObject({region:'R204',revenue:205,sourceDouble:410});
 expect(view.definition).toEqual(c.definition);
});
it('acquires an export lease before its first next and releases it on return or caller abort',async()=>{
 const s=await setup();const view=s.store.readView('d','child');const c=new AbortController();
 const first=s.store.readExecutor('d','child')!.presented(view.active!,signal())[Symbol.asyncIterator]();
 const second=s.store.readExecutor('d','child')!.presented(view.active!,c.signal)[Symbol.asyncIterator]();
 s.store.updateDefinition('d','root',{...flat,search:'Unseen'},{kind:'none'});await s.store.settled('d');
 expect(s.disposals[1]).not.toHaveBeenCalled();
 await first.return!();expect(s.disposals[1]).not.toHaveBeenCalled();
 c.abort();await vi.waitFor(()=>expect(s.disposals[1]).toHaveBeenCalledTimes(1));
 await second.return!();expect(s.disposals[1]).toHaveBeenCalledTimes(1);
});
