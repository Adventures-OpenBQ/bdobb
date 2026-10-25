// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// Test-only registered WidgetDataset API seam; no external manifest producer claim.
import {createRoot} from 'react-dom/client';
import {PivotParamRow} from '../../src/components/PivotParamRow';
import {createTableExecutionStore,tableExecutionStore} from '../../src/stores/tableExecutionStore';
import {useDashboardStore} from '../../src/stores/dashboardStore';
import {createWorkerExecutor} from '../../src/lib/tableExecution/workerClient';
import {input} from '../../src/lib/tableExecution/fixtures';
import type {TableModelV1} from '../../src/lib/tableModel/types';
export async function mountDatasetViewer(model:TableModelV1){
 let acquired=0;const requests:{id:string;kind:string}[]=[];
 const store=createTableExecutionStore({viewerAuthority:{isViewer:()=>useDashboardStore.getState().viewer,subscribe:listener=>useDashboardStore.subscribe(listener)},executor:id=>createWorkerExecutor(id,()=>{const w=new Worker('/src/lib/tableExecution/table.worker.ts',{type:'module'});const post=w.postMessage.bind(w);w.postMessage=(r:unknown)=>{requests.push({id,kind:(r as {kind:string}).kind});post(r);};return w;}),source:()=>({acquire:async()=>{acquired++;return {kind:'dataset',dataset:input};}})});
 const original={...tableExecutionStore};Object.assign(tableExecutionStore,store);useDashboardStore.setState({viewer:true});
 const root={id:'dataset-root',widgetId:'local_table',backendId:'builtin',params:{file:'dataset'},layout:{x:0,y:0,w:1,h:1},tableDefinition:{table:{hidden:['team']},search:'',analytical:model}};
 const child={...root,id:'dataset-child',linkedSource:{kind:'widget' as const,sourceWidgetId:'dataset-root'},tableDefinition:{table:{columnFilters:[{id:'revenue',value:{min:15}}]},search:''}};
 const leaf={...child,id:'dataset-leaf',linkedSource:{kind:'widget' as const,sourceWidgetId:'dataset-child'},tableDefinition:{table:{},search:''}};
 store.syncDashboard({id:'dataset',name:'Dataset seam',tabs:[{id:'t',name:'T',cards:[root,child,leaf]}]});store.ensureTable('dataset','dataset-leaf');await store.settled('dataset');
 const host=document.createElement('div');host.id='dataset-viewer-header';document.body.append(host);const reactRoot=createRoot(host);reactRoot.render(<PivotParamRow dashboardId="dataset" widgetId="dataset-root" raw={model} viewer/>);
 return {async snapshot(){await store.settled('dataset');const rows:Record<string,unknown>={};for(const id of ['dataset-root','dataset-child','dataset-leaf']){const v=store.readView('dataset',id);rows[id]=(await store.readExecutor('dataset',id)!.rows(v.active!,{groupPath:[],offset:0,limit:10},new AbortController().signal)).rows;}return {rows,acquired,registers:requests.filter(r=>r.id==='dataset-root'&&r.kind==='registerInput').length,definition:store.readView('dataset','dataset-root').ready!.inspection.definition,childSource:store.readView('dataset','dataset-child').sourceRevision,rootRevision:store.readView('dataset','dataset-root').active,leafSource:store.readView('dataset','dataset-leaf').sourceRevision,childRevision:store.readView('dataset','dataset-child').active};},dispose(){reactRoot.unmount();host.remove();store.disposeDashboard('dataset');Object.assign(tableExecutionStore,original);}};
}
