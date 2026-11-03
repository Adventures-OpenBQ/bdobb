// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it,vi} from 'vitest';
import {createTableExecutionStore} from './tableExecutionStore';
import {createRemoteProviderFixture} from '../lib/tableExecution/rust/remoteProviderFixture';
import {realRustRuntime} from '../test/tableProviderBoundary';
import {input} from '../lib/tableExecution/fixtures';
import {normalizeWidgets} from '../lib/widgetsJson';
import {useWidgetRegistryStore} from './widgetRegistryStore';
import type {Dashboard,DashboardCard} from '../lib/types';
it('opens managed sources explicitly, produces rows, and retains the active result after failed refresh',async()=>{
 const widgets=normalizeWidgets({managed:{type:'table_ssrm',provider:'managed-native',protocolVersion:1,endpoint:'/sessions'}},'b').widgets;
 useWidgetRegistryStore.setState({widgets});
 const card:DashboardCard={id:'m',view:'raw',backendId:'b',widgetId:'managed',params:{},layout:{x:0,y:0,w:10,h:10},managedSource:{sourceId:'private',kind:'upload',version:1}};
 const dashboard={id:'d',name:'D',tabs:[{id:'t',name:'T',cards:[card]}]} as Dashboard;
 const fixture=createRemoteProviderFixture({runtime:await realRustRuntime(),sourceId:'private',snapshotId:'',input});
 const source=vi.fn(),executor=vi.fn();
 const open=vi.fn(fixture.provider.open);
 const store=createTableExecutionStore({source,executor,managedProvider:()=>({open})});
 store.syncDashboard(dashboard);store.ensureTable('d','m');await store.settled('d');
 expect(store.readView('d','m').status).toBe('ready');
 expect(source).not.toHaveBeenCalled();expect(executor).not.toHaveBeenCalled();
 expect(open.mock.calls[0][0]).toEqual({kind:'remote',sourceId:'private',snapshotId:'',managed:{version:1,inputRevision:1}});
 const active=store.readView('d','m').active!;
 expect((await store.readExecutor('d','m')!.rows(active,{offset:0,limit:2,groupPath:[]},new AbortController().signal)).rows).toHaveLength(2);
 store.refresh('d','m');await store.settled('d');
 expect(store.readView('d','m').active).toEqual(active);
 expect(store.readView('d','m').stale).toBe(true);
 expect(open).toHaveBeenCalledTimes(1);
 store.disposeDashboard('d');
});
it('routes a temporal binding through complete managed input and refresh starts a new execution',async()=>{
 const {definition,executionId,fixed,page,receipt}=await import('../lib/temporal/fixtures');
 const other='33333333-3333-4333-8333-333333333333';let starts=0;
 const temporalClient={get:vi.fn(async()=>definition),start:vi.fn(async()=>({execution_id:starts++?other:executionId,state:'queued' as const})),status:vi.fn(async(id:string)=>({execution_id:id,state:'succeeded' as const,error:null})),page:vi.fn(async(id:string)=>({...page,receipt:{...receipt,execution_id:id}}))} as unknown as import('../lib/temporal/client').TemporalClient;
 useWidgetRegistryStore.setState({widgets:normalizeWidgets({query:{type:'query_data',endpoint:'/temporal/v1/queries'}},'b').widgets});
 const card:DashboardCard={id:'q',backendId:'b',widgetId:'query',params:{},layout:{x:0,y:0,w:10,h:10},queryBinding:{...fixed,tableExecution:{kind:'managed',version:1,backendId:'tables',sourceBackendId:'tdb'}}};
 const runtime=await realRustRuntime();
 const managed=vi.fn((_card:DashboardCard,identity:{executionId:string;resultHash:string})=>createRemoteProviderFixture({runtime,sourceId:identity.executionId,snapshotId:identity.resultHash,input}).provider);
 const local=vi.fn();const store=createTableExecutionStore({source:local,temporalClient:()=>temporalClient,temporalManagedProvider:managed});
 store.syncDashboard({id:'d',name:'D',tabs:[{id:'t',name:'T',cards:[card]}]} as Dashboard);store.ensureTable('d','q');await store.settled('d');
 expect(store.readView('d','q').status).toBe('ready');expect(managed).toHaveBeenCalledWith(expect.anything(),{executionId,resultHash:receipt.result_hash});expect(local).not.toHaveBeenCalled();expect(store.readTemporalPaging('d','q')).toBeUndefined();
 store.refresh('d','q');await store.settled('d');expect(temporalClient.start).toHaveBeenCalledTimes(2);expect(managed).toHaveBeenLastCalledWith(expect.anything(),{executionId:other,resultHash:receipt.result_hash});store.disposeDashboard('d');
});
