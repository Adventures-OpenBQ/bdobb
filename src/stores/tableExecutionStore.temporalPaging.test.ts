// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {afterEach,expect,it,vi} from 'vitest';
import {createTableExecutionStore,type TableExecutionStore} from './tableExecutionStore';
import {createTableProvider} from '../lib/tableExecution/rust/providerFactory';
import {providerHandler} from '../test/tableProviderBoundary';
import type {ExecutionRequest} from '../lib/tableExecution/types';
import type {TemporalClient} from '../lib/temporal/client';
import type {ResultPage} from '../lib/temporal/contracts';
import type {Dashboard} from '../lib/types';
import {card,widget} from '../test/fixtures';
import {definition,executionId,fixed,page,receipt} from '../lib/temporal/fixtures';
import {useWidgetRegistryStore} from './widgetRegistryStore';
class Boundary {
 onmessage:((e:MessageEvent)=>void)|null=null;onerror=null;onmessageerror=null;
 handler=providerHandler('typescript',data=>this.onmessage?.({data} as MessageEvent));
 postMessage(data:ExecutionRequest){void this.handler(data);}terminate(){}
}
const stores:TableExecutionStore[]=[];
afterEach(()=>{for(const s of stores.splice(0))s.disposeDashboard('d');});
function setup(){
 let starts=0;const second='33333333-3333-4333-8333-333333333333';
 const c={get:vi.fn(async()=>definition),start:vi.fn(async()=>({execution_id:starts++?second:executionId,state:'queued' as const})),status:vi.fn(async(id:string)=>({execution_id:id,state:'succeeded' as const,error:null})),page:vi.fn(async(id:string,cursor?:string)=>({...page,total_count:3,receipt:{...receipt,execution_id:id},rows:cursor?[{Revenue:30}]:[{Revenue:id===executionId?10:110},{Revenue:20}],next_cursor:cursor?null:'page2'}))} as unknown as TemporalClient;
 const registered=new Map<string,import('../lib/widgetData/types').WidgetDataset>();
 const store=createTableExecutionStore({source:()=>undefined,temporalClient:()=>c,executor:id=>{const e=createTableProvider(id,'typescript',{workerFactory:()=>new Boundary() as unknown as Worker});const register=e.registerInput.bind(e);e.registerInput=async(data,rev,signal)=>{registered.set(id,structuredClone(data));await register(data,rev,signal);};return e;}});
 stores.push(store);const q=card({id:'q',widgetId:'temporaldb_query',queryBinding:fixed});
 useWidgetRegistryStore.setState({widgets:[widget({id:'temporaldb_query',type:'query_data'})]});
 store.syncDashboard({id:'d',name:'D',tabs:[{id:'t',name:'T',cards:[q]}]} as Dashboard);
 return {store,c,registered,q};
}
it('pages one execution, exposes bounded state and refreshes into a new execution',async()=>{
 const {store,c,registered}=setup();store.ensureTable('d','q');await store.settled('d');
 expect(store.readTemporalPaging('d','q')).toMatchObject({pageNumber:1,offset:0,hasPrevious:false,hasNext:true,busy:false});
 await store.nextTemporalPage('d','q');await store.settled('d');
 expect(registered.get('q')?.rows[0]).toMatchObject({id:`${executionId}:2`,values:{Revenue:30}});
 expect(store.readTemporalPaging('d','q')).toMatchObject({pageNumber:2,offset:2,hasPrevious:true,hasNext:false});
 await store.previousTemporalPage('d','q');await store.settled('d');expect(c.start).toHaveBeenCalledTimes(1);
 store.refresh('d','q');await store.settled('d');expect(c.start).toHaveBeenCalledTimes(2);expect(registered.get('q')?.rows[0].values.Revenue).toBe(110);
});
it('does not publish a late page after refresh',async()=>{
 const {store,c,registered}=setup();store.ensureTable('d','q');await store.settled('d');let finish!:(p:ResultPage)=>void;
 vi.mocked(c.page).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const pending=store.nextTemporalPage('d','q');await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
 store.refresh('d','q');await store.settled('d');finish({...page,total_count:3,rows:[{Revenue:999}],next_cursor:null});await pending;
 expect(registered.get('q')?.rows[0].values.Revenue).toBe(110);expect(store.readTemporalPaging('d','q')?.pageNumber).toBe(1);
});
it('evicts page state and prevents late delivery after a scope change',async()=>{
 const {store,c}=setup();store.ensureTable('d','q');await store.settled('d');let finish!:(p:ResultPage)=>void;
 vi.mocked(c.page).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const pending=store.nextTemporalPage('d','q');await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
 store.clearTemporalResults();finish({...page,total_count:3,rows:[{Revenue:999}],next_cursor:null});await pending;
 expect(store.readTemporalPaging('d','q')).toBeUndefined();expect(store.readView('d','q').ready).toBeUndefined();
});
it('keeps accepted page and an explicit error on failed navigation',async()=>{
 const {store,c,registered}=setup();store.ensureTable('d','q');await store.settled('d');
 vi.mocked(c.page).mockRejectedValueOnce(new Error('page unavailable'));await store.nextTemporalPage('d','q');
 expect(registered.get('q')?.rows[0].values.Revenue).toBe(10);expect(store.readTemporalPaging('d','q')).toMatchObject({pageNumber:1,busy:false,error:'page unavailable'});
});
it('disposes the old pager when a binding changes during navigation',async()=>{
 const {store,c,q,registered}=setup();store.ensureTable('d','q');await store.settled('d');let finish!:(p:ResultPage)=>void;
 vi.mocked(c.page).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const pending=store.nextTemporalPage('d','q');await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
 store.syncDashboard({id:'d',name:'D',tabs:[{id:'t',name:'T',cards:[{...q,queryBinding:{...fixed,params:{ticker:'NEW'}}}]}]} as Dashboard);
 store.ensureTable('d','q');await store.settled('d');finish({...page,total_count:3,rows:[{Revenue:999}],next_cursor:null});await pending;
 expect(c.start).toHaveBeenCalledTimes(2);expect(registered.get('q')?.rows[0].values.Revenue).toBe(110);expect(store.readTemporalPaging('d','q')?.offset).toBe(0);
});
it('invalidates linked input when the parent page changes without starting another query',async()=>{
 const {store,c,q,registered}=setup();const child=card({id:'child',widgetId:'local_table',linkedSource:{kind:'widget',sourceWidgetId:'q'}});
 store.syncDashboard({id:'d',name:'D',tabs:[{id:'t',name:'T',cards:[q,child]}]} as Dashboard);store.ensureTable('d','child');await store.settled('d');
 expect(registered.get('child')?.rows.map(r=>r.values.Revenue)).toEqual([10,20]);
 await store.nextTemporalPage('d','q');store.ensureTable('d','child');await store.settled('d');
 expect(registered.get('child')?.rows.map(r=>r.values.Revenue)).toEqual([30]);expect(c.start).toHaveBeenCalledTimes(1);
});
