// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {ManagedSourceForm} from './ManagedSourceForm';
import {normalizeWidgets} from '../../lib/widgetsJson';
import {useWidgetRegistryStore} from '../../stores/widgetRegistryStore';
import {weekdayCalendar} from '../../lib/calendar';
import type {WireContext} from '../../lib/params';
const http=vi.hoisted(()=>vi.fn());
vi.mock('@tauri-apps/plugin-http',()=>({fetch:(...args:unknown[])=>http(...args)}));
const backend={id:'b',name:'Server',baseUrl:'https://table.test',authLocation:'header' as const,validateWidgets:true,headerName:'Authorization',headerValue:'Bearer private'};
// Monday 26 Oct 2026, midday in London: one London business day back is Friday 23 Oct.
const now=new Date('2026-10-26T12:00:00Z');
// A loaded London calendar: the backend's 2026, here with no holidays near the dates the tests step over.
const loaded:WireContext={now,calendars:{XLON:{...weekdayCalendar('XLON'),years:[2026],source:'backend'}}};
const registered=()=>http.mock.calls.filter(([url,init])=>String(url).endsWith('/sources/backends')&&init?.method==='POST').map(([,init])=>JSON.parse(init.body).binding.params);
beforeEach(()=>{
 http.mockReset();
 http.mockImplementation(async(_url,init)=>init?.method==='POST'?Response.json({sourceId:'s1'}):Response.json({backends:[{backendId:'openbb',label:'OpenBB',widgets:[{widgetId:'prices',label:'Prices',parameters:['date','symbol']}]}]}));
 useWidgetRegistryStore.setState({widgets:normalizeWidgets({prices:{type:'table',endpoint:'/prices',params:[{paramName:'date',type:'date'},{paramName:'symbol',type:'text'}]}},'openbb').widgets});
});
async function bind(values:Record<string,string>,context:WireContext=loaded,onSave=vi.fn(async()=>{})){
 render(<ManagedSourceForm backend={backend} context={context} onSave={onSave}/>);
 await screen.findByRole('option',{name:'OpenBB · Prices'});
 fireEvent.change(screen.getByLabelText('Backend source'),{target:{value:JSON.stringify(['openbb','prices'])}});
 for(const [name,value] of Object.entries(values))fireEvent.change(await screen.findByLabelText(name),{target:{value}});
 fireEvent.click(screen.getByRole('button',{name:'Bind server source'}));
 return onSave;
}
it('registers the resolved London date for T-1bd(XLON)',async()=>{
 const onSave=await bind({date:'T-1bd(XLON)',symbol:'VOD.L'});
 await waitFor(()=>expect(onSave).toHaveBeenCalled());
 expect(registered()).toEqual([{date:'2026-10-23',symbol:'VOD.L'}]);
});
it('refuses T(XNYZ) visibly and registers nothing',async()=>{
 const onSave=await bind({date:'T(XNYZ)',symbol:'AAPL'});
 expect(await screen.findByRole('alert')).toHaveTextContent('Unknown calendar XNYZ');
 expect(registered()).toEqual([]);expect(onSave).not.toHaveBeenCalled();
});
it('sends a plain value unchanged',async()=>{
 const onSave=await bind({date:'2026-10-01',symbol:'T'});
 await waitFor(()=>expect(onSave).toHaveBeenCalled());
 expect(registered()).toEqual([{date:'2026-10-01',symbol:'T'}]);
});
it('refuses a qualified value when the source widget is unknown, so its type is too (RW9b)',async()=>{
 useWidgetRegistryStore.setState({widgets:[]});
 const onSave=await bind({date:'T-1bd(XLON)',symbol:'VOD.L'});
 expect(await screen.findByRole('alert')).toHaveTextContent('Cannot resolve T-1bd(XLON): unknown parameter type');
 expect(registered()).toEqual([]);expect(onSave).not.toHaveBeenCalled();
});
it('sends unqualified and plain values for an unknown source widget unchanged (RW9b)',async()=>{
 useWidgetRegistryStore.setState({widgets:[]});
 const onSave=await bind({date:'T-1bd',symbol:'T'});
 await waitFor(()=>expect(onSave).toHaveBeenCalled());
 expect(registered()).toEqual([{date:'T-1bd',symbol:'T'}]);
});
