// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {useState} from 'react';
import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {installVirtualizerDom} from '../../test/virtualizer';
import {catalog} from '../../test/studyCatalog';
import {FakeSocket} from '../../test/fakeSocket';
import type {StudyColumn} from '../../lib/studyColumns';
import type {TableCardState,WidgetDef,BackendConfig} from '../../lib/types';
vi.mock('../../lib/dataClient',async original=>({...await original<typeof import('../../lib/dataClient')>(),fetchWidgetData:vi.fn(async()=>[{symbol:'AAPL',price:10},{symbol:'MSFT',price:20}]),fetchWidgetPath:vi.fn(),postWidgetPath:vi.fn()}));
import {fetchWidgetData,fetchWidgetPath,postWidgetPath} from '../../lib/dataClient';
import {LiveGridRenderer} from './LiveGridRenderer';
import {TableRenderer} from './TableRenderer';
installVirtualizerDom();
const backend:BackendConfig={id:'b',name:'Grid',baseUrl:'https://grid.example',authLocation:'header',validateWidgets:false};
const widget={id:'grid',type:'live_grid',endpoint:'live_grid',wsEndpoint:'live_grid_ws',studyColumnsV1:true,table:{columns:[{field:'symbol',renderFn:[]},{field:'price',renderFn:[]}]}} as unknown as WidgetDef;
let saved='';
function Harness(){const [state,setState]=useState<TableCardState>(()=>saved?JSON.parse(saved):{widths:{price:140},hidden:[]});return <LiveGridRenderer widget={widget} backend={backend} params={{symbol:'AAPL,MSFT'}} state={state} onStateChange={patch=>setState(previous=>{const next={...previous,...patch};saved=JSON.stringify(next);return next;})}/>;}
beforeEach(()=>{saved='';vi.stubGlobal('WebSocket',FakeSocket);FakeSocket.all=[];FakeSocket.last=null;vi.mocked(fetchWidgetPath).mockResolvedValue(catalog);vi.mocked(postWidgetPath).mockImplementation(async(_backend,_path,body)=>{const request=body as {symbols:string[];columns:StudyColumn[]};return {schema_version:1,results:request.columns.flatMap(column=>request.symbols.map(symbol=>({id:column.id,symbol,study:column.study,output:column.output,params:column.params,context:{interval:column.interval},definition_version:column.definition_version,revision:'1',as_of:'2026-11-22T14:00:00Z',input_cursor:null,status:'ok',latest:column.study==='rsi'?column.params.period===7?77:44:55,points:[{time:'2026-11-22T13:59:00Z',value:42},{time:'2026-11-22T14:00:00Z',value:55}]}))) };});});
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
it('adds, independently edits, reloads and removes RSI and slow K specs while keeping quotes and other table configuration',async()=>{
 const mounted=render(<Harness/>);await waitFor(()=>expect(screen.getByRole('button',{name:'Add RSI 14'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Add RSI 14'}));fireEvent.click(screen.getByRole('button',{name:'Save study column'}));
 await waitFor(()=>expect(screen.getAllByText('44')).toHaveLength(2));
 fireEvent.click(screen.getByRole('button',{name:'Add slow %K'}));fireEvent.change(screen.getByLabelText('k'),{target:{value:'21'}});fireEvent.change(screen.getByLabelText('smooth_k'),{target:{value:'5'}});fireEvent.change(screen.getByLabelText('Sparkline points'),{target:{value:'120'}});fireEvent.click(screen.getByRole('button',{name:'Save study column'}));
 await waitFor(()=>expect(screen.getAllByRole('img',{name:'stoch stoch_k trend'})).toHaveLength(2));
 fireEvent.click(screen.getByText('Study columns (2)'));fireEvent.click(screen.getByRole('button',{name:/Edit RSI/}));fireEvent.change(screen.getByLabelText('Period'),{target:{value:'7'}});fireEvent.click(screen.getByRole('button',{name:'Save study column'}));
 await waitFor(()=>expect(screen.getAllByText('77')).toHaveLength(2));
 let state=JSON.parse(saved) as TableCardState;expect(state.widths).toEqual({price:140});expect(state.studyColumns?.map(column=>column.params)).toEqual([{period:7},{k:21,smooth_k:5,d:3}]);expect(state.studyColumns?.[1].points).toBe(120);
 expect(FakeSocket.all).toHaveLength(1);act(()=>FakeSocket.last?.open());act(()=>FakeSocket.last?.emit({symbol:'AAPL',price:33}));expect(screen.getByText('33')).toBeInTheDocument();
 mounted.unmount();render(<Harness/>);await waitFor(()=>expect(screen.getAllByText('77')).toHaveLength(2));fireEvent.click(screen.getByText('Study columns (2)'));fireEvent.click(screen.getByRole('button',{name:/Remove RSI/}));
 state=JSON.parse(saved);expect(state.studyColumns).toHaveLength(1);expect(state.studyColumns?.[0].params).toEqual({k:21,smooth_k:5,d:3});expect(state.widths).toEqual({price:140});
});
it('sorts study latest values numerically with warmup and error last, and filters by the same numeric value',()=>{
 const value=(latest:number|null,status='ok')=>({latest,status,points:[],presentation:'latest',study:'rsi',output:'rsi'});
 const data=[{symbol:'AAPL',rsi:value(90)},{symbol:'MSFT',rsi:value(12)},{symbol:'WARM',rsi:value(null,'warming_up')},{symbol:'ERR',rsi:value(1000,'error')}];
 render(<TableRenderer data={data} filterRow spec={{columns:[{field:'symbol'},{field:'rsi',headerName:'RSI',cellDataType:'number',renderFn:['studyResult']}]}}/>);
 const order=()=>within(screen.getAllByRole('rowgroup')[1]).getAllByRole('row').filter(row=>row.querySelector('[data-field="symbol"]')).map(row=>row.querySelector('[data-field="symbol"]')?.textContent);
 fireEvent.click(screen.getByRole('columnheader',{name:/RSI/}));expect(order()).toEqual(['MSFT','AAPL','WARM','ERR']);fireEvent.click(screen.getByRole('columnheader',{name:/RSI/}));expect(order()).toEqual(['AAPL','MSFT','WARM','ERR']);
 fireEvent.change(screen.getByLabelText('Minimum RSI'),{target:{value:'50'}});expect(order()).toEqual(['AAPL']);
});

it('cancels study membership immediately on symbol edits while a replacement quote snapshot is pending',async()=>{
 const column:StudyColumn={id:'selected',study:'rsi',output:'rsi',params:{period:14},interval:'1m',session:'regular',basis:'adjusted',provider:'yfinance',points:60,presentation:'latest'};
 vi.mocked(fetchWidgetData).mockResolvedValueOnce([{symbol:'AAPL',price:10},{symbol:'MSFT',price:20}]).mockImplementationOnce(()=>new Promise(()=>{}));
 const state={studyColumns:[column]};const {rerender}=render(<LiveGridRenderer widget={widget} backend={backend} params={{symbol:'AAPL,MSFT'}} state={state}/>);
 await waitFor(()=>expect(postWidgetPath).toHaveBeenCalled());
 rerender(<LiveGridRenderer widget={widget} backend={backend} params={{symbol:'MSFT'}} state={state}/>);
 await waitFor(()=>expect((vi.mocked(postWidgetPath).mock.lastCall?.[2] as {symbols:string[]}).symbols).toEqual(['MSFT']));
});
it('clears an explicitly empty symbol edit and aborts pending study work before the quote snapshot returns',async()=>{
 const column:StudyColumn={id:'empty',study:'rsi',output:'rsi',params:{period:14},interval:'1m',session:'regular',basis:'adjusted',provider:'yfinance',points:60,presentation:'latest'};
 vi.mocked(fetchWidgetData).mockResolvedValueOnce([{symbol:'AAPL',price:10}]).mockImplementationOnce(()=>new Promise(()=>{}));
 let finish:(value:unknown)=>void=()=>{};
 vi.mocked(postWidgetPath).mockResolvedValueOnce({schema_version:1,results:[{id:'empty',symbol:'AAPL',latest:77,status:'ok',points:[]}]}).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const state={studyColumns:[column]};const {rerender}=render(<LiveGridRenderer widget={widget} backend={backend} params={{symbol:'AAPL'}} state={state}/>);
 await waitFor(()=>expect(screen.getByText('77')).toBeInTheDocument());await waitFor(()=>expect(postWidgetPath).toHaveBeenCalledTimes(2),{timeout:2000});
 const signal=vi.mocked(postWidgetPath).mock.lastCall?.[3]?.signal;
 rerender(<LiveGridRenderer widget={widget} backend={backend} params={{symbol:''}} state={state}/>);
 expect(signal?.aborted).toBe(true);expect(screen.queryByText('77')).not.toBeInTheDocument();
 await act(async()=>finish({schema_version:1,results:[{id:'empty',symbol:'AAPL',latest:99,status:'ok',points:[]}]}));
 expect(screen.queryByText('99')).not.toBeInTheDocument();expect(postWidgetPath).toHaveBeenCalledTimes(2);
});
