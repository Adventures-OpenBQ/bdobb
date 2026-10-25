// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {SsrmTableRenderer} from './SsrmTableRenderer';
import {useDashboardStore} from '../../stores/dashboardStore';
import {normalizeWidgets} from '../../lib/widgetsJson';
import type {DashboardCard} from '../../lib/types';
import {useBackendsStore} from '../../stores/backendsStore';
import {useWidgetRegistryStore} from '../../stores/widgetRegistryStore';
import {__resetTradingCalendarCacheForTests} from '../../hooks/useTradingCalendar';
const http=vi.hoisted(()=>vi.fn());
vi.mock('@tauri-apps/plugin-http',()=>({fetch:(...args:unknown[])=>http(...args)}));
const backend={id:'b',name:'Server',baseUrl:'https://table.test',authLocation:'header' as const,validateWidgets:true,headerName:'Authorization',headerValue:'Bearer private'};
const card:DashboardCard={id:'c',backendId:'b',widgetId:'w',params:{},layout:{x:0,y:0,w:10,h:10}};
const widget=normalizeWidgets({w:{type:'ssrm_table',endpoint:'/data'}},'b').widgets[0];
beforeEach(()=>{http.mockReset();useDashboardStore.setState({viewer:false,dashboards:[{id:'d',name:'D',tabs:[{id:'t',name:'T',cards:[card]}]}],activeId:'d',activeTabId:'t'});});
it('loads bounded LIVE pages with honest unknown counts and refreshes by reopening',async()=>{
 http.mockImplementation(async(_url,init)=>{const q=JSON.parse(init.body);return Response.json({rowData:[{name:`row-${q.startRow}`}],rowCount:-1});});
 const props={card,widget,backend,dashboardId:'d',params:{},refreshKey:0};
 const ui=render(<SsrmTableRenderer {...props}/>);
 expect(await screen.findByText('row-0')).toBeInTheDocument();
 expect(screen.getByText(/LIVE/)).toBeInTheDocument();expect(screen.getByText(/Total unknown/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Next page'}));
 expect(await screen.findByText('row-100')).toBeInTheDocument();
 expect(http.mock.calls.every(([,init])=>init.method==='POST'&&JSON.parse(init.body).endRow-JSON.parse(init.body).startRow<=100)).toBe(true);
 ui.rerender(<SsrmTableRenderer {...props} refreshKey={1}/>);
 expect(await screen.findByText('row-0')).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Pivot'})).not.toBeInTheDocument();
});
it('stops exact pagination and exposes only declared group and aggregation controls',async()=>{
 http.mockResolvedValue(Response.json({rowData:[{region:'A',amount:10}],rowCount:1}));
 // Each read owns a response stream.
 http.mockImplementation(async()=>Response.json({rowData:[{region:'A',amount:10}],rowCount:1}));
 render(<SsrmTableRenderer card={card} widget={{...widget,ssrm:{grouping:true,aggregations:['sum']}}} backend={backend} dashboardId="d" params={{}} refreshKey={0}/>);
 await screen.findByText('A');expect(screen.getByRole('button',{name:'Next page'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Pivot'}));
 expect(screen.getByText('Row Groups')).toBeInTheDocument();expect(screen.queryByText('Column Groups')).not.toBeInTheDocument();
 fireEvent.click(screen.getAllByRole('button',{name:'amount'})[0]);
 expect(screen.queryByRole('menuitem',{name:'Duplicate'})).not.toBeInTheDocument();
});
it('renders actionable managed source creation without sending a table GET',async()=>{
 http.mockImplementation(async()=>Response.json({backends:[{backendId:'openbb',label:'OpenBB',widgets:[{widgetId:'prices',label:'Prices',parameters:['symbol']}]}]}));
 render(<SsrmTableRenderer card={card} widget={{...widget,provider:'managed-native',protocolVersion:1}} backend={backend} dashboardId="d" params={{}} refreshKey={0}/>);
 expect(screen.getByLabelText('Upload table file')).toBeInTheDocument();
 expect(await screen.findByRole('option',{name:'OpenBB · Prices'})).toBeInTheDocument();
 expect(http.mock.calls.every(([url])=>String(url).endsWith('/sources/backends'))).toBe(true);
});
it('keeps prior page on a failed read and offers an explicit reopen',async()=>{
 http.mockImplementation(async(_url,init)=>JSON.parse(init.body).startRow===0?Response.json({rowData:[{name:'old'}],rowCount:-1}):new Response('{}',{status:503}));
 render(<SsrmTableRenderer card={card} widget={widget} backend={backend} dashboardId="d" params={{}} refreshKey={0}/>);
 await screen.findByText('old');fireEvent.click(screen.getByRole('button',{name:'Next page'}));
 await waitFor(()=>expect(screen.getByRole('alert')).toBeInTheDocument());
 expect(screen.getByText('old')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Reopen table'})).toBeInTheDocument();
});

it('sends text filtering to the endpoint instead of filtering the loaded page',async()=>{
 http.mockImplementation(async()=>Response.json({rowData:[{name:'server-answer'}],rowCount:1}));
 render(<SsrmTableRenderer card={card} widget={widget} backend={backend} dashboardId="d" params={{}} refreshKey={0}/>);
 await screen.findByText('server-answer');
 fireEvent.change(screen.getByLabelText('Filter name'),{target:{value:'different'}});
 await waitFor(()=>expect(http.mock.calls.some(([,init])=>init?.body&&JSON.parse(init.body).filterModel.name?.filter==='different')).toBe(true));
 expect(screen.getByText('server-answer')).toBeInTheDocument();
});
it('loads a group lazily using its opaque path and preserves estimated counts',async()=>{
 http.mockImplementation(async(_url,init)=>{const q=JSON.parse(init.body);return Response.json(q.groupKeys.length?{rowData:[{region:'A/B',amount:4}],rowCount:{kind:'estimated',value:50}}:{rowData:[{region:'A/B',amount:900}],rowCount:1});});
 const grouped={...card,table:{pivot:{enabled:true,grouping:['region'],split:[],aggregationFns:{amount:'sum' as const}}}};
 render(<SsrmTableRenderer card={grouped} widget={{...widget,ssrm:{grouping:true,aggregations:['sum']}}} backend={backend} dashboardId="d" params={{}} refreshKey={0}/>);
 await screen.findByText('900');
 fireEvent.click(screen.getByRole('button',{name:'Open group A/B'}));
 expect(await screen.findByText('4')).toBeInTheDocument();
 expect(screen.getByText(/About 50 rows/)).toBeInTheDocument();
 expect(JSON.parse(http.mock.calls.at(-1)![1].body).groupKeys).toEqual(['A/B']);
});

it('uploads a private source and persists only its opaque reference on the card',async()=>{
 const {useDashboardStore}=await import('../../stores/dashboardStore');
 useDashboardStore.setState({viewer:false,dashboards:[{id:'d',name:'D',tabs:[{id:'t',name:'T',cards:[card]}]}],activeId:'d',activeTabId:'t'});
 http.mockImplementation(async(url)=>String(url).endsWith('/sources/uploads')?Response.json({sourceId:'opaque-upload'}):Response.json({backends:[]}));
 render(<SsrmTableRenderer card={card} widget={{...widget,provider:'managed-native',protocolVersion:1}} backend={backend} dashboardId="d" params={{}} refreshKey={0}/>);
 fireEvent.change(screen.getByLabelText('Upload table file'),{target:{files:[new File(['amount\n5'],'private.csv')]}});
 await waitFor(()=>expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].managedSource).toEqual({sourceId:'opaque-upload',kind:'upload',version:1}));
 const serialized=JSON.stringify(useDashboardStore.getState().dashboards[0]);
 expect(serialized).not.toContain('Bearer private');expect(serialized).not.toContain('amount\\n5');
 expect(new Headers(http.mock.calls.find(([url])=>String(url).endsWith('/sources/uploads'))![1].headers).get('Authorization')).toBe('Bearer private');
});
it('rebinds a missing managed source through a usable upload form',async()=>{
 const {tableExecutionStore}=await import('../../stores/tableExecutionStore');
 const {useWidgetRegistryStore}=await import('../../stores/widgetRegistryStore');
 const {useBackendsStore}=await import('../../stores/backendsStore');
 const managed={...widget,provider:'managed-native',protocolVersion:1};
 const missing={...card,managedSource:{sourceId:'deleted',kind:'upload' as const,version:1 as const}};
 useWidgetRegistryStore.setState({widgets:[managed]});useBackendsStore.setState({backends:[backend]});
 tableExecutionStore.syncDashboard({id:'d',name:'D',tabs:[{id:'t',name:'T',cards:[missing]}]});
 http.mockImplementation(async(url)=>String(url).endsWith('/sources/backends')?Response.json({backends:[]}):new Response('{}',{status:404}));
 const ui=render(<SsrmTableRenderer card={missing} widget={managed} backend={backend} dashboardId="d" params={{}} refreshKey={0}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Re-upload or rebind source'}));
 expect(screen.getByLabelText('Upload table file')).toBeInTheDocument();
 ui.unmount();tableExecutionStore.disposeDashboard('d');
});

it('keeps a replacement source when deletion of the old source completes after rebind',async()=>{
 const original={...card,managedSource:{sourceId:'A',kind:'upload' as const,version:1 as const}};
 useDashboardStore.setState({dashboards:[{id:'d',name:'D',tabs:[{id:'t',name:'T',cards:[original]}]}]});
 let finishDelete!:()=>void;
 const deletion=new Promise<void>(resolve=>{finishDelete=resolve;});
 http.mockImplementation(async(url,init)=>{
  if(init.method==='DELETE'){await deletion;return Response.json({deleted:true});}
  return String(url).endsWith('/sources/uploads')?Response.json({sourceId:'B'}):Response.json({backends:[]});
 });
 function CurrentCard(){const current=useDashboardStore(s=>s.dashboards[0].tabs[0].cards[0]);return <SsrmTableRenderer card={current} widget={{...widget,provider:'managed-native',protocolVersion:1}} backend={backend} dashboardId="d" params={{}} refreshKey={0}/>;}
 render(<CurrentCard/>);
 fireEvent.click(screen.getByRole('button',{name:'Delete server source'}));
 await waitFor(()=>expect(http.mock.calls.some(([,init])=>init.method==='DELETE')).toBe(true));
 fireEvent.click(screen.getByRole('button',{name:/Change source|Re-upload or rebind source/}));
 fireEvent.change(screen.getByLabelText('Upload table file'),{target:{files:[new File(['amount\n9'],'replacement.csv')]}});
 await waitFor(()=>expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].managedSource?.sourceId).toBe('B'));
 await act(async()=>{finishDelete();await deletion;await new Promise(resolve=>setTimeout(resolve,0));});
 expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].managedSource?.sourceId).toBe('B');
 fireEvent.click(screen.getByRole('button',{name:'Delete server source'}));
 await waitFor(()=>expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].managedSource).toBeUndefined());
});
it('allows declared split-only pivot authoring while row grouping remains disabled',async()=>{
 http.mockImplementation(async()=>Response.json({rowData:[{region:'US',amount:9}],rowCount:1}));
 const splitOnly=normalizeWidgets({w:{type:'ssrm_table',endpoint:'/data',ssrm:{pivot:{columns:[{id:'US',label:'US',dtype:'number'}]},aggregations:['sum']}}},'b').widgets[0];
 render(<SsrmTableRenderer card={card} widget={splitOnly} backend={backend} dashboardId="d" params={{}} refreshKey={0}/>);
 await screen.findByText('US');fireEvent.click(screen.getByRole('button',{name:'Pivot'}));
 expect(screen.getByText('Column Groups')).toBeInTheDocument();
 fireEvent.click(screen.getAllByRole('button',{name:'region'})[0]);
 expect(screen.getByRole('menuitem',{name:'Move to Row Groups'})).toBeDisabled();
 expect(screen.getByRole('menuitem',{name:'Move to Column Groups'})).not.toBeDisabled();
});
it('shows what the backend warned about the result, e.g. a record cap, as the card notice',async()=>{
 http.mockImplementation(async()=>Response.json({rowData:[{name:'row-0'}],rowCount:1,warnings:[{category:'OpenBBWarning',message:'Results capped at 250,000 records.'}]}));
 const {container}=render(<SsrmTableRenderer card={card} widget={widget} backend={backend} dashboardId="d" params={{}} refreshKey={0}/>);
 expect(await screen.findByText('Results capped at 250,000 records.')).toHaveClass('card-notice');
 expect(container.querySelectorAll('.card-notice[role=status]')).toHaveLength(1);
});
it('keys the session on the wire params: a calendar landing does not reopen it, and a pending hold waits',async()=>{
 http.mockImplementation(async()=>Response.json({rowData:[{name:'r'}],rowCount:1}));
 const dated=normalizeWidgets({w:{type:'ssrm_table',endpoint:'/data',params:[{paramName:'start_date',type:'date',value:'2024-01-02'}]}},'b').widgets[0];
 const p={card,widget:dated,backend,dashboardId:'d',params:{start_date:'2024-01-02'},refreshKey:0};
 const calendar=(source:string,years:number[])=>({XNYS:{mic:'XNYS',source,years}}) as never;
 const ui=render(<SsrmTableRenderer {...p} held context={{calendars:calendar('bundled',[2026])}}/>);
 await act(async()=>{await Promise.resolve();});
 expect(http).not.toHaveBeenCalled();
 ui.rerender(<SsrmTableRenderer {...p} context={{calendars:calendar('bundled',[2026])}}/>);
 await screen.findByText('r');
 const before=http.mock.calls.length;
 ui.rerender(<SsrmTableRenderer {...p} context={{calendars:calendar('backend',[2025,2026])}}/>);
 await act(async()=>{await new Promise(r=>setTimeout(r,20));});
 expect(http.mock.calls.length).toBe(before);
 expect(screen.getByText('r')).toBeInTheDocument();
});
it('marks the sorted LIVE column with a visible arrow as well as aria-sort',async()=>{
 http.mockImplementation(async()=>Response.json({rowData:[{name:'x'}],rowCount:1}));
 render(<SsrmTableRenderer card={card} widget={widget} backend={backend} dashboardId="d" params={{}} refreshKey={0}/>);
 await screen.findByText('x');
 fireEvent.click(screen.getByRole('button',{name:'name'}));
 await waitFor(()=>expect(screen.getByRole('columnheader',{name:'name ▼'})).toHaveAttribute('aria-sort','descending'));
 fireEvent.click(screen.getByRole('button',{name:'name ▼'}));
 await waitFor(()=>expect(screen.getByRole('columnheader',{name:'name ▲'})).toHaveAttribute('aria-sort','ascending'));
});

// RW9c: a managed card's form loads the calendars its own values name, from the source's backend. The managed-native
// card widget declares no params, so the card itself never loads one.
const openbb={id:'openbb',name:'OpenBB',baseUrl:'https://openbb.test',authLocation:'header' as const,validateWidgets:true,headerName:'Authorization',headerValue:'Bearer o'};
const mondayLondon=new Date('2026-10-26T12:00:00Z');
const london=(year:string|null)=>Response.json({data:{Name:'Mock LSE',Timezone:'Europe/London',TradingHours:{Open:'08:00:00',Close:'16:30:00',WorkingDays:'Mon, Tue, Wed, Thu, Fri'},ExchangeHolidays:year==='2026'?{'2026-10-23':{Holiday:'Fixture Day',Type:'Official'}}:{}}});
const xlonAsked=()=>http.mock.calls.some(([url])=>String(url).includes('calendar/trading')&&new URL(String(url)).searchParams.get('exchange')==='XLON');
const boundParams=()=>http.mock.calls.filter(([url,init])=>String(url).endsWith('/sources/backends')&&init?.method==='POST').map(([,init])=>JSON.parse(init.body).binding.params);
async function managedForm(xlon:(url:URL)=>Promise<Response>){
 __resetTradingCalendarCacheForTests();
 useBackendsStore.setState({backends:[openbb]});
 useWidgetRegistryStore.setState({widgets:normalizeWidgets({prices:{type:'table',endpoint:'/prices',params:[{paramName:'date',type:'date'}]}},'openbb').widgets});
 http.mockImplementation(async(raw,init)=>{
  const url=new URL(String(raw));
  if(url.pathname.endsWith('/calendar/trading'))return url.searchParams.get('exchange')==='XLON'?xlon(url):new Response('',{status:404});
  if(init?.method==='POST')return Response.json({sourceId:'s1'});
  return Response.json({backends:[{backendId:'openbb',label:'OpenBB',widgets:[{widgetId:'prices',label:'Prices',parameters:['date']}]}]});
 });
 render(<SsrmTableRenderer card={card} widget={{...widget,provider:'managed-native',protocolVersion:1}} backend={backend} dashboardId="d" params={{}} refreshKey={0} context={{now:mondayLondon}}/>);
 await screen.findByRole('option',{name:'OpenBB · Prices'});
 fireEvent.change(screen.getByLabelText('Backend source'),{target:{value:JSON.stringify(['openbb','prices'])}});
 fireEvent.change(await screen.findByLabelText('date'),{target:{value:'T-1bd(XLON)'}});
 await waitFor(()=>expect(xlonAsked()).toBe(true));
}
it('loads XLON from the source backend, refuses while it loads, then registers London\'s date (RW9c)',async()=>{
 let land!:()=>void;const landed=new Promise<void>(r=>{land=r;});
 await managedForm(async url=>{await landed;return london(url.searchParams.get('year'));});
 fireEvent.click(screen.getByRole('button',{name:'Bind server source'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('XLON calendar still loading');
 await act(async()=>{land();});
 fireEvent.click(screen.getByRole('button',{name:'Bind server source'}));
 // Fri 23 Oct is the fixture's London holiday, so one London business day before Mon 26 Oct is Thu 22 Oct.
 await waitFor(()=>expect(boundParams()).toEqual([{date:'2026-10-22'}]));
});
it('refuses visibly and registers nothing when the source backend has no XLON calendar (RW9c)',async()=>{
 await managedForm(async()=>new Response('',{status:404}));
 await act(async()=>{});
 fireEvent.click(screen.getByRole('button',{name:'Bind server source'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('XLON calendar not loaded');
 expect(boundParams()).toEqual([]);
});
