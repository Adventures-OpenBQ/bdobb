// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import {beforeEach,expect,it,vi} from 'vitest';
import {createTableExecutionStore} from '../../stores/tableExecutionStore';
import {useWidgetRegistryStore} from '../../stores/widgetRegistryStore';
import {createTemporalSourceAdapter} from './sourceAdapter';
import {createTableProvider} from '../tableExecution/rust/providerFactory';
import {providerHandler} from '../../test/tableProviderBoundary';
import {backend,card,widget} from '../../test/fixtures';
import {fixed,page,executionId,definition} from './fixtures';
import {createTemporalClient} from './client';
import type {TemporalClient} from './client';
import type {Dashboard} from '../types';
import {storedDashboard,readStoredDashboard,saveDashboard,loadDashboards} from '../dashboardsFile';
import {__reset,__read} from '../../test/memfs';
import type {ExecutionRequest} from '../tableExecution/types';
const dash=(cards:ReturnType<typeof card>[]):Dashboard=>({id:'d',name:'Temporal',tabs:[{id:'t',name:'Tab',cards}]});
function executor(id:string){class Boundary {onmessage:((event:MessageEvent)=>void)|null=null;onerror=null;onmessageerror=null;handler=providerHandler('typescript',data=>this.onmessage?.({data} as MessageEvent));postMessage(data:ExecutionRequest){void this.handler(data);}terminate(){}}return createTableProvider(id,'typescript',{workerFactory:()=>new Boundary() as unknown as Worker});}
const fakeClient=()=>({get:async()=>definition,start:async()=>({execution_id:executionId,state:'queued' as const}),status:async()=>({execution_id:executionId,state:'succeeded' as const,error:null}),page:async()=>page}) as unknown as TemporalClient;
beforeEach(()=>{__reset();useWidgetRegistryStore.setState({widgets:[widget({type:'query_data'})]});});
it('runs a query root through the current worker, derived subset, pivot, chart and export contracts',async()=>{
 const root=card({id:'root',queryBinding:fixed});const subset=card({id:'subset',linkedSource:{kind:'widget',sourceWidgetId:'root'},table:{columnFilters:[{id:'Revenue',value:{min:5}}]}});const pivot=card({id:'pivot',linkedSource:{kind:'widget',sourceWidgetId:'subset'},table:{pivot:{enabled:true,grouping:[],split:[],aggregationFns:{Revenue:'sum'}}}});
 const inputManifest={...page.receipt.input_manifest,pins:[{catalog_id:'facts',snapshot_id:'9223372036854775807'}]};
 const client=fakeClient();vi.spyOn(client,'page').mockResolvedValue({...page,receipt:{...page.receipt,input_manifest:inputManifest}});
 const store=createTableExecutionStore({executor,source:c=>c.queryBinding?createTemporalSourceAdapter(client,c.queryBinding):undefined});
 store.syncDashboard(dash([root,subset,pivot]));store.ensureTable('d','pivot');await store.settled('d');
 for(const id of ['root','subset','pivot']){
  const view=store.readView('d',id);expect(view.status).toBe('ready');expect(view.ready?.completeness.kind).toBe('paged');
  const exec=store.readExecutor('d',id)!;const chart=await exec.chartData(view.active!,['Revenue'],new AbortController().signal);
  expect(chart.provenance.receipt?.temporal).toMatchObject({executionId,queryRevision:2});expect(chart.provenance.receipt?.temporal?.inputManifest).toEqual(inputManifest);expect(chart.completeness.kind).toBe('paged');
  const batches=[];for await(const batch of exec.presented(view.active!,new AbortController().signal))batches.push(batch);
  expect(batches[0].provenance?.receipt?.temporal).toEqual(chart.provenance.receipt?.temporal);expect(batches[0].completeness.kind).toBe('paged');
 }
 store.clearTemporalResults();for(const id of ['root','subset','pivot']){expect(store.readView('d',id).ready).toBeUndefined();expect(store.readExecutor('d',id)).toBeUndefined();}
});
it('prevents late pages from replacing a newer binding and evicts unavailable sources',async()=>{
 let finish!:(value:typeof page)=>void;const client=fakeClient();vi.spyOn(client,'page').mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const store=createTableExecutionStore({executor,source:c=>c.queryBinding?createTemporalSourceAdapter(client,c.queryBinding):undefined});
 const root=card({id:'root',queryBinding:fixed});store.syncDashboard(dash([root]));store.ensureTable('d','root');await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
 store.refresh('d','root');await vi.waitFor(()=>expect(store.readView('d','root').status).toBe('ready'));const active=store.readView('d','root').active;
 finish({...page,rows:[{Revenue:999}]});await store.settled('d');expect(store.readView('d','root').active).toEqual(active);
 const output=await store.readExecutor('d','root')!.chartData(active!,['Revenue'],new AbortController().signal);expect(output.rows[0].values.Revenue).toBe(10);
 const unavailable=createTableExecutionStore({executor,source:()=>undefined});unavailable.syncDashboard(dash([root]));unavailable.ensureTable('d','root');await unavailable.settled('d');expect(unavailable.readView('d','root').status).toBe('unavailable');
});
it('persists only binding intent through save and native dashboard import/export, retaining malformed/future intent',async()=>{
 const value=dash([card({queryBinding:fixed})]);await saveDashboard(value);const loaded=(await loadDashboards()).find(d=>d.id==='d')!;expect(loaded.tabs[0].cards[0].queryBinding).toEqual(fixed);
 const serialized=JSON.stringify(storedDashboard(loaded));expect(serialized).not.toContain('result_hash');expect(readStoredDashboard(JSON.parse(serialized))!.tabs[0].cards[0].queryBinding).toEqual(fixed);
 const future=JSON.parse(serialized);future.tabs[0].cards[0].queryBinding.schemaVersion=77;expect(readStoredDashboard(future)!.tabs[0].cards[0].queryBinding).toEqual(future.tabs[0].cards[0].queryBinding);expect(__read('dashboards/d.json')).toContain('fixed');
});
it('auth failure stays an error and never publishes fake success',async()=>{
 const service=createTemporalClient(backend());vi.spyOn(service,'status').mockRejectedValue(new Error('HTTP 401'));
 const store=createTableExecutionStore({executor,source:()=>createTemporalSourceAdapter(service,{kind:'execution',executionId})});store.syncDashboard(dash([card({queryBinding:fixed})]));store.ensureTable('d','c');await store.settled('d');expect(store.readView('d','c')).toMatchObject({status:'failed',error:'HTTP 401'});expect(store.readView('d','c').active).toBeUndefined();
});
