// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { KpiRequest, KpiReply } from '../lib/widgetData/kpi/workerClient';
vi.mock('@tauri-apps/plugin-http',()=>({fetch:globalThis.fetch}));
vi.mock('@tauri-apps/plugin-opener',()=>({openUrl:vi.fn()}));
vi.mock('react-grid-layout',()=>({default:({children}:{children:ReactNode})=><div>{children}</div>,WidthProvider:(Component:unknown)=>Component}));
vi.mock('./renderers/ChartRenderer',()=>({ChartRenderer:()=>null,readDrawingSurface:()=>({width:900,height:540})}));
import { DashboardGrid } from './DashboardGrid';
import { Boundary } from '../test/tableWorkerBoundary';
import { backend, card, widget } from '../test/fixtures';
import { startMockServer, type MockServer } from '../test/mockServer';
import { __reset } from '../test/memfs';
import { __resetJsonStoreForTests } from '../lib/jsonStore';
import { liveMetricReceipt, liveMetricRows } from '../test/fixtures/metricEvidence';
import { BUILTIN_WIDGETS } from '../lib/builtins';
import { useBackendsStore } from '../stores/backendsStore';
import { useDashboardStore } from '../stores/dashboardStore';
import { useWidgetRegistryStore } from '../stores/widgetRegistryStore';
import { tableExecutionStore } from '../stores/tableExecutionStore';
let handleKpi!:(event:{data:KpiRequest})=>void;
let hold=false;
const replies:Array<()=>void>=[];
const extraServers:MockServer[]=[];
class KpiPort extends EventTarget {
 terminated=false;
 terminate(){this.terminated=true;}
 postMessage(request:KpiRequest){
  const deliver=()=>{
   const target={postMessage:(reply:KpiReply)=>this.dispatchEvent(new MessageEvent('message',{data:structuredClone(reply)}))};
   const original=globalThis.self;
   vi.stubGlobal('self',target);
   try{handleKpi({data:structuredClone(request)});}finally{vi.stubGlobal('self',original);}
  };
  if(hold)replies.push(deliver);else queueMicrotask(deliver);
 }
}
beforeAll(async()=>{
 const original=globalThis.self;
 const scope={onmessage:undefined as typeof handleKpi|undefined};
 vi.stubGlobal('self',scope);
 await import('../lib/widgetData/kpi/kpi.worker');
 handleKpi=scope.onmessage!;
 vi.stubGlobal('self',original);
});
let server:MockServer|undefined;
let identity=0;
let activeDashboard='';
beforeEach(()=>{
 __reset();__resetJsonStoreForTests();hold=false;replies.length=0;
 vi.stubGlobal('Worker',function(url:URL){return String(url).includes('kpi.worker')?new KpiPort():new Boundary();});
});
afterEach(async()=>{cleanup();tableExecutionStore.disposeDashboard(activeDashboard);await server?.close();await Promise.all(extraServers.splice(0).map(value=>value.close()));vi.unstubAllGlobals();});
async function mount(unsafe=false, replacementDelay=0, initialDelay=0){
 const endpoint='/api/v1/eodhd/equity/fundamental/metrics';
 const receipt={...liveMetricReceipt,unsafe:{...liveMetricReceipt.unsafe,identity_conflict:unsafe}};
 let sent=0;
 server=await startMockServer({[endpoint]:()=>{
  const replacement=++sent>1;
  return {__status:200,__delayMs:replacement?replacementDelay:initialDelay,__body:{results:liveMetricRows,extra:{results_metadata:{chart_sources:{version:1,receipts:[replacement?{...receipt,unsafe:{...receipt.unsafe,identity_conflict:true}}:receipt]}}}}};
 }});
 activeDashboard=`kpi-${++identity}`;
 const table=widget({id:'metrics',type:'table',endpoint,dataKey:'results',params:[{paramName:'symbol'},{paramName:'chart_source'}]});
 const source=card({id:`source-${identity}`,widgetId:'metrics',params:{symbol:'AAPL',chart_source:'true'}});
 const metric=card({id:`metric-${identity}`,widgetId:'linked_metric',backendId:'builtin',linkedSource:{kind:'widget',sourceWidgetId:source.id},linkedMetric:{version:1,metric:'dividend_yield',valueField:'dividend_yield',observation:{mode:'latest'},view:'card'}});
 const dashboard={id:activeDashboard,name:'Metrics',tabs:[{id:'tab',name:'Main',cards:[source,metric]}]};
 useBackendsStore.setState({backends:[backend({baseUrl:server.url})],statuses:{b1:'online'}});
 useWidgetRegistryStore.setState({widgets:[table,...BUILTIN_WIDGETS]});
 useDashboardStore.setState({dashboards:[dashboard],activeId:activeDashboard,activeTabId:'tab',viewer:false});
 render(<DashboardGrid onOpenLibrary={()=>{}}/>);
 return {source,metric};
}
it('carries the completed HTTP metric receipt through the default table worker into the real KPI renderer',async()=>{
 await mount();
 expect(await screen.findByText('0.3%')).toHaveClass('metric-value');
 expect(screen.getByText(/Issuer AAPL.US/)).toBeVisible();
 expect(server?.requests.filter(r=>r.path.endsWith('/metrics'))).toHaveLength(1);
});
it('refuses untrusted HTTP metric evidence instead of displaying a qualified KPI',async()=>{
 await mount(true);
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent(/verified KPI observation evidence/));
 expect(screen.queryByText('0.3%')).toBeNull();
});
it('drops a delayed KPI result after its source question changes',async()=>{
 hold=true;
 const {source}=await mount();
 await waitFor(()=>expect(replies.length).toBeGreaterThan(0));
 await act(async()=>{await useDashboardStore.getState().applyCardParams(source.id,{cardParams:{symbol:'MSFT',chart_source:'true'},groupEdits:[]});});
 await act(async()=>{hold=false;for(const release of replies.splice(0))release();});
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent(/verified KPI observation evidence/));
 expect(screen.queryByText('0.3%')).toBeNull();
});

it.each(['query','credential','backend URL'] as const)('immediately clears a qualified KPI while a changed %s request is pending',async change=>{
 const {source}=await mount(false,150);
 await screen.findByText('0.3%');
 await act(async()=>{
  if(change==='query')await useDashboardStore.getState().applyCardParams(source.id,{cardParams:{symbol:'MSFT',chart_source:'true'},groupEdits:[]});
  else if(change==='credential')useBackendsStore.setState(s=>({backends:s.backends.map(b=>({...b,authLocation:'header',headerName:'Authorization',headerValue:'replacement-test-token'}))}));
  else {
   const replacement=await startMockServer({'/api/v1/eodhd/equity/fundamental/metrics':{__status:200,__delayMs:150,__body:{results:liveMetricRows,extra:{results_metadata:{chart_sources:{version:1,receipts:[{...liveMetricReceipt,unsafe:{...liveMetricReceipt.unsafe,identity_conflict:true}}]}}}}}});
   extraServers.push(replacement);
   useBackendsStore.setState(s=>({backends:s.backends.map(b=>({...b,baseUrl:replacement.url}))}));
  }
 });
 expect(screen.queryByText('0.3%')).toBeNull();
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent(/verified KPI observation evidence/));
});
it('ignores a late successful HTTP answer for a replaced source question',async()=>{
 const {source}=await mount(false,0,150);
 await waitFor(()=>expect(server?.requests.filter(r=>r.path.endsWith('/metrics'))).toHaveLength(1));
 await act(async()=>{await useDashboardStore.getState().applyCardParams(source.id,{cardParams:{symbol:'MSFT',chart_source:'true'},groupEdits:[]});});
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent(/verified KPI observation evidence/));
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,200));});
 expect(screen.queryByText('0.3%')).toBeNull();
});
