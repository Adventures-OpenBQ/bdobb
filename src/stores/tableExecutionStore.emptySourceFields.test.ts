// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import {afterEach, beforeEach, expect, it} from 'vitest';
import {backendTableSource, createTableExecutionStore} from './tableExecutionStore';
import {useDashboardStore} from './dashboardStore';
import {useWidgetRegistryStore} from './widgetRegistryStore';
import {createWorkerExecutor} from '../lib/tableExecution/workerClient';
import {createWorkerHandler} from '../lib/tableExecution/table.worker';
import {calculateView} from '../lib/tableExecution/engine';
import {createResultStore} from '../lib/tableExecution/resultStore';
import {datasetFromRows} from '../lib/localTableData';
import {validateExecutionRequest, validateExecutionResponse} from '../lib/tableExecution/validation';
import {identityWitness} from '../lib/tableExecution/identityWitness';
import type {ExecutionRequest, TableDefinition} from '../lib/tableExecution/types';
import type {Dashboard, DashboardCard} from '../lib/types';
import {widget} from '../test/fixtures';
import {__read, __reset} from '../test/memfs';

// The actual native regression fixture: literal JSON keeps __proto__ an own key.
const rows = () => JSON.parse('[{"category":1,"hasOwnProperty":100,"__proto__":102,"":101,"day":"2026-11-20","hover":{"value":100,"description":"synthetic own cell"},"m1":100,"m2":200},{"category":2,"hasOwnProperty":20,"__proto__":22,"":21,"day":"2026-11-19","hover":{"value":20,"description":"synthetic own cell"},"m1":20,"m2":40},{"category":3,"hasOwnProperty":300,"__proto__":302,"":301,"day":"2026-11-21","hover":{"value":300,"description":"synthetic own cell"},"m1":300,"m2":600}]');
const source: DashboardCard = {id:'own-source', widgetId:'native-own-table', backendId:'fixture', params:{}, layout:{x:0,y:0,w:40,h:18}};
const child: DashboardCard = {id:'linked-table', widgetId:'local_table', backendId:'builtin', params:{}, linkedSource:{kind:'widget',sourceWidgetId:source.id}, layout:{x:0,y:18,w:40,h:18}};
const dashboard: Dashboard = {id:'empty-fields',name:'Synthetic own-key regression',tabs:[{id:'main',name:'Table sort filter linked',cards:[source,child]}]};
const signal = () => new AbortController().signal;
class WorkerBoundary {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror = null;
  onmessageerror = null;
  handler = createWorkerHandler(data => this.onmessage?.({data} as MessageEvent));
  postMessage(request: ExecutionRequest) { void this.handler(request); }
  terminate() {}
}
const stores: ReturnType<typeof createTableExecutionStore>[] = [];
function open(saved: Dashboard = dashboard) {
  const store = createTableExecutionStore({
    executor: id => createWorkerExecutor(id, () => new WorkerBoundary() as unknown as Worker),
    source: card => card.id === source.id ? backendTableSource(card) : undefined,
  });
  stores.push(store);
  store.setBackendRows(saved.id,source.id,rows());
  store.syncDashboard(saved);
  store.ensureTable(saved.id,child.id);
  return store;
}
beforeEach(() => {
  __reset();
  useDashboardStore.setState({dashboards:[structuredClone(dashboard)],activeId:dashboard.id,activeTabId:'main',viewer:false});
  useWidgetRegistryStore.setState({widgets:[widget({id:source.widgetId,backendId:source.backendId,type:'table',table:{columns:[
    {field:'category',headerName:'Category',cellDataType:'number'},
    {field:'hasOwnProperty',headerName:'Own numeric',cellDataType:'number'},
    {field:'__proto__',headerName:'Proto numeric',cellDataType:'number'},
    {field:'',headerName:'Empty-key numeric',cellDataType:'number'},
    {field:'day',headerName:'Day',cellDataType:'dateString'},
    {field:'hover',headerName:'Hover number',cellDataType:'object'},
    {field:'m1',cellDataType:'number'},{field:'m2',cellDataType:'number'},
  ]}})]});
});
afterEach(() => { for (const store of stores.splice(0)) store.disposeDashboard(dashboard.id); });

it('registers the actual backend keys, persists empty-field sort/filter/order, and publishes intact linked rows and chart data', async () => {
  const definition: TableDefinition = {table:{sorting:[{id:'',desc:false}],columnFilters:[{id:'',value:{min:30}}],columnOrder:['','__proto__','hasOwnProperty','category','m1','m2']},search:''};
  expect(await useDashboardStore.getState().commitTableDefinition(dashboard.id,source.id,definition,{kind:'none'})).toBe(true);
  const persisted = JSON.parse(__read('dashboards/empty-fields.json')!);
  expect(persisted.tabs[0].cards[0].tableDefinition).toEqual(definition);
  const store = open(persisted);
  await store.settled(dashboard.id);
  expect(store.readView(dashboard.id,source.id).status).toBe('ready');
  expect(store.readView(dashboard.id,child.id).status).toBe('ready');
  const upstream = store.readView(dashboard.id,source.id);
  const downstream = store.readView(dashboard.id,child.id);
  const page = await store.readExecutor(dashboard.id,child.id)!.rows(downstream.active!,{groupPath:[],offset:0,limit:10},signal());
  expect(page.rows.map(row => row.values[''])).toEqual([101,301]);
  expect(page.rows.map(row => row.values.__proto__)).toEqual([102,302]);
  expect(page.rows.map(row => row.values.hasOwnProperty)).toEqual([100,300]);
  expect(downstream.ready!.columns.some(column => column.id === '')).toBe(true);
  const chart = await store.readExecutor(dashboard.id,source.id)!.chartData(upstream.active!,['category','m1','m2'],signal());
  expect(chart.rows.map(row => row.values)).toEqual([{category:1,m1:100,m2:200},{category:3,m1:300,m2:600}]);
  const blankChart = await store.readExecutor(dashboard.id,source.id)!.chartData(upstream.active!,[''],signal());
  expect(blankChart.rows.map(row => row.values[''])).toEqual([101,301]);
  // Reopen the bytes written by the real durable store, not the original fixture.
  const reopened = open(JSON.parse(__read('dashboards/empty-fields.json')!));
  await reopened.settled(dashboard.id);
  expect(reopened.readView(dashboard.id,source.id).definition).toEqual(definition);
  expect(reopened.readView(dashboard.id,child.id).status).toBe('ready');
});

it('sorts and filters prototype-looking raw names, and hiding only the empty field projects it out of linked output', async () => {
  const store = open();
  store.updateDefinition(dashboard.id,source.id,{table:{sorting:[{id:'__proto__',desc:true}],columnFilters:[{id:'hasOwnProperty',value:{min:30}}],hidden:['']},search:''},{kind:'none'});
  await store.settled(dashboard.id);
  const ready = store.readView(dashboard.id,child.id);
  expect(ready.status).toBe('ready');
  expect(ready.ready!.columns.some(column => column.id === '')).toBe(false);
  const page = await store.readExecutor(dashboard.id,child.id)!.rows(ready.active!,{groupPath:[],offset:0,limit:10},signal());
  expect(page.rows.map(row => row.values.__proto__)).toEqual([302,102]);
  expect(page.rows.every(row => !Object.hasOwn(row.values,''))).toBe(true);
});

it('does not publish an empty opaque measure alias for an implicit legacy measure over the empty raw source name', () => {
  const input = datasetFromRows(JSON.parse('[{"group":"A","":2,"m":3},{"group":"A","":5,"m":7}]'),'pivot-source',1,'backend');
  const view = calculateView(input,{table:{pivot:{enabled:true,grouping:['group'],split:[],aggregationFns:{'':'sum',m:'sum'}}},search:''},{kind:'none'});
  const blank = view.columns.find(column => column.id === '')!;
  expect(blank).toMatchObject({sourceFieldId:'',sourceBindingId:'',aggregation:'sum'});
  expect(blank.measureId).toBeUndefined();
  expect(view.columns.find(column => column.id === 'm')!.measureId).toBe('m');
  expect(view.logicalRows[0].values['']).toBe(7);
  const revision = {widgetId:'pivot-source',input:1,model:1,output:1};
  const result = createResultStore(view,revision);
  expect(() => validateExecutionResponse(result.ready('ready',revision),revision,'ready')).not.toThrow();
  const subset = [...result.presented('subset',revision,'transfer')][0];
  expect(() => validateExecutionResponse(subset,revision,'subset')).not.toThrow();
  expect(subset.rows[0].values['']).toBe(7);
});

it('keeps explicit measure identities nonempty while permitting a nonempty instance to read the empty source field', () => {
  const revision = {widgetId:'source',input:1,model:1,output:1};
  const request = (id: string) => ({kind:'applyModel',requestId:'request',revision,definition:{table:{pivot:{enabled:true,grouping:['group'],split:[],measures:[{id,sourceFieldId:'',aggregation:'sum'}]}},search:''},selection:{kind:'none'}});
  expect(() => validateExecutionRequest(request('measure-instance'))).not.toThrow();
  expect(() => validateExecutionRequest(request(''))).toThrow('Expected nonempty ID');
  const response = {kind:'inputSchema',requestId:'request',revision,completeness:{kind:'complete',warnings:[]},diagnostics:[],columns:[{id:'',label:'Empty source',sourceFieldId:'',sourceBindingId:''}]};
  expect(() => validateExecutionResponse(response,revision,'request')).not.toThrow();
  for (const change of [{requestId:''},{revision:{...revision,widgetId:''}},{columns:[{id:'',label:'Empty',measureId:''}]}])
    expect(() => validateExecutionResponse({...response,...change},revision,'request')).toThrow();
});

it('does not mistake present empty source provenance for absent provenance in an identity witness', () => {
  const input = datasetFromRows([{group:'A',value:1}],'source',1,'backend');
  const plain: TableDefinition = {table:{},search:''};
  const pivot: TableDefinition = {table:{pivot:{enabled:true,grouping:['group'],split:[],aggregationFns:{value:'sum'}}},search:''};
  const columns = input.columns.map(column => column.id === 'group' ? {...column,sourceBindingId:''} : column);
  expect(identityWitness(input,[plain,pivot],['not-observed'],plain,columns)).toEqual([{id:'not-observed',state:'unknown'}]);
});

it('groups by the empty raw field across the worker boundary without permitting empty member identities', async () => {
  const executor = createWorkerExecutor('raw-group',() => new WorkerBoundary() as unknown as Worker);
  const revision = {widgetId:'raw-group',input:1,model:1,output:1};
  try {
    await executor.registerInput(datasetFromRows(JSON.parse('[{"":2,"m":3},{"":2,"m":7}]'),'raw-group',1,'backend'),1,signal());
    await executor.applyModel({table:{pivot:{enabled:true,grouping:[''],split:[],aggregationFns:{m:'sum'}}},search:''},{kind:'none'},revision,signal());
    const page = await executor.rows(revision,{groupPath:[],offset:0,limit:10},signal());
    expect(page.rows[0].values.m).toBe(10);
    expect(page.rows[0].groupPath?.[0]).toMatchObject({field:'',value:2});
    expect(page.rows[0].id).not.toBe('');
    expect(page.rows[0].groupPath?.[0].memberKey).not.toBe('');
  } finally {executor.dispose();}
});

it('continues to reject empty opaque envelope, provenance and row identities and wrong-type raw names', () => {
  const input = datasetFromRows(JSON.parse('[{"":1}]'),'source',1,'backend');
  const request = {kind:'registerInput',requestId:'request',revision:{widgetId:'source',input:1,model:0,output:0},inputRevision:1,input};
  expect(() => validateExecutionRequest(request)).not.toThrow();
  for (const change of [
    {requestId:''}, {revision:{...request.revision,widgetId:''}},
    {input:{...input,provenance:{sourceWidgetId:''}}},
    {input:{...input,rows:[{id:'',values:{'':1}}]}},
    {input:{...input,columns:[{id:4,label:'Wrong'}]}},
    {input:{...input,columns:[{id:'',label:'Wrong alias',sourceBindingId:4}]}},
  ]) expect(() => validateExecutionRequest({...request,...change})).toThrow();
});
