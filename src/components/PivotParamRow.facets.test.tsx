// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {PivotParamRow} from './PivotParamRow';
import {tableExecutionStore,type ViewState} from '../stores/tableExecutionStore';
import {useDashboardStore} from '../stores/dashboardStore';
import type {FacetResult,Revision,LocalWorkerExecutor} from '../lib/tableExecution/types';
vi.mock('../hooks/useTableCommit',()=>({useTableCommit:()=>({canEnqueue:false,editModel:vi.fn()})}));
afterEach(()=>{vi.restoreAllMocks();act(()=>useDashboardStore.setState({viewer:false}));});
it('independent header facets settle out of order and refreshed metadata preserves a touched draft',async()=>{
 useDashboardStore.setState({viewer:true});const A='["string","A"]',B='["string","B"]',X='["string","X"]';const raw={schemaVersion:1,enabled:false,params:{promotePage:false,filters:[{id:'p',categoryId:'region',label:'Region',multiSelect:true},{id:'q',categoryId:'desk',label:'Desk',multiSelect:false}]},categories:[{id:'region',name:'Region',sourceFieldId:'r',transform:'native'},{id:'desk',name:'Desk',sourceFieldId:'d',transform:'native'}],measures:[],formulas:[],layout:{rows:[],columns:[],values:[]},checklists:[{categoryId:'region',memberKeys:[A]}],resultFilters:[],subtotals:{grandTotal:false,groups:false}};
 let revision:Revision={widgetId:'w',input:1,model:1,output:1};const view=()=>({status:'ready',requested:revision,active:revision,definition:{table:{},search:'',analytical:raw},selection:{kind:'none'},stale:false}) as ViewState;let current=view();vi.spyOn(tableExecutionStore,'readView').mockImplementation(()=>current);
 const held:{category:string;revision:Revision;resolve:(result:FacetResult)=>void;signal:AbortSignal}[]=[];const facets=vi.fn((r:Revision,category:string,signal:AbortSignal)=>new Promise<FacetResult>(resolve=>held.push({category,revision:r,resolve,signal})));vi.spyOn(tableExecutionStore,'readExecutor').mockReturnValue({facets} as unknown as LocalWorkerExecutor);
 const result=(read:typeof held[number],keys:string[]):FacetResult=>({kind:'facets',requestId:'r',revision:read.revision,categoryId:read.category,scope:'filtered',values:{},completeness:{kind:'complete',warnings:[]},diagnostics:[],members:keys.map(key=>({key,label:JSON.parse(key)[1],value:JSON.parse(key)[1],count:1}))});
 const ui=render(<PivotParamRow dashboardId="d" widgetId="w" raw={raw} viewer/>);await waitFor(()=>expect(held).toHaveLength(2));
 await act(async()=>held[1].resolve(result(held[1],[X])));expect(screen.getByRole('combobox',{name:'Desk'})).toBeEnabled();expect(screen.getByRole('button',{name:'Region: A'})).toBeDisabled();
 await act(async()=>held[0].resolve(result(held[0],[A,B])));fireEvent.click(screen.getByRole('button',{name:'Region: A'}));const popup=screen.getByRole('dialog');expect(within(popup).queryByText('X')).toBeNull();fireEvent.click(within(popup).getByLabelText('B'));expect(within(popup).getByLabelText('B')).toBeChecked();
 revision={...revision,model:2,output:2};current=view();ui.rerender(<PivotParamRow dashboardId="d" widgetId="w" raw={raw} viewer/>);await waitFor(()=>expect(held).toHaveLength(4));expect(screen.getByRole('dialog')).toBeVisible();expect(within(screen.getByRole('dialog')).getByRole('button',{name:'Apply'})).toBeDisabled();
 revision={...revision,model:3,output:3};current=view();ui.rerender(<PivotParamRow dashboardId="d" widgetId="w" raw={raw} viewer/>);await waitFor(()=>expect(held).toHaveLength(6));expect(held[2].signal.aborted).toBe(true);await act(async()=>held[2].resolve(result(held[2],[X])));expect(within(screen.getByRole('dialog')).queryByText('X')).toBeNull();
 await act(async()=>{held[5].resolve(result(held[5],[X]));held[4].resolve(result(held[4],[A,B]));});expect(within(screen.getByRole('dialog')).getByLabelText('B')).toBeChecked();expect(within(screen.getByRole('dialog')).getByLabelText('A')).toBeChecked();expect(within(screen.getByRole('dialog')).getByRole('button',{name:'Apply'})).toBeEnabled();
});
