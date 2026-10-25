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
