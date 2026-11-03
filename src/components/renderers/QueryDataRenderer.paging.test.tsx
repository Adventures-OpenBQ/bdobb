// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach,expect,it,vi} from 'vitest';
import {card} from '../../test/fixtures';
import {fixed} from '../../lib/temporal/fixtures';
const fake=vi.hoisted(()=>({view:{status:'ready',requested:{widgetId:'q',input:1,model:1,output:1},active:{widgetId:'q',input:1,model:1,output:1},ready:{completeness:{kind:'paged',acquiredRowCount:2,totalRowCount:3}},definition:{table:{},search:''},selection:{kind:'none'},stale:false},paging:{pageNumber:1,offset:0,loadedRows:2,totalCount:3,countQuality:'exact',hasPrevious:false,hasNext:true,busy:false,error:undefined as string|undefined},next:vi.fn(),previous:vi.fn()}));
vi.mock('../../stores/tableExecutionStore',()=>({tableExecutionStore:{subscribe:()=>()=>{},readView:()=>fake.view,readTemporalPaging:()=>fake.paging,readExecutor:()=>undefined,ensureTable:vi.fn(),nextTemporalPage:fake.next,previousTemporalPage:fake.previous}}));
vi.mock('./LocalTableRenderer',()=>({LocalTableRenderer:()=> <div>Execution table</div>}));
import {QueryDataRenderer} from './QueryDataRenderer';
beforeEach(()=>{fake.next.mockReset();fake.previous.mockReset();fake.paging={pageNumber:1,offset:0,loadedRows:2,totalCount:3,countQuality:'exact',hasPrevious:false,hasNext:true,busy:false,error:undefined};});
const ui=()=> <QueryDataRenderer dashboardId="d" card={card({id:'q',queryBinding:fixed})} filterRow={false}/>;
it('shows range and permits only available page navigation',async()=>{
 const {rerender}=render(ui());expect(screen.getByRole('button',{name:'Previous result page'})).toBeDisabled();
 expect(screen.getByLabelText('Temporal result page')).toHaveTextContent('1–2 of 3');
 await userEvent.click(screen.getByRole('button',{name:'Next result page'}));expect(fake.next).toHaveBeenCalledWith('d','q');
 fake.paging={...fake.paging,pageNumber:2,offset:2,loadedRows:1,hasPrevious:true,hasNext:false};rerender(ui());
 expect(screen.getByRole('button',{name:'Next result page'})).toBeDisabled();await userEvent.click(screen.getByRole('button',{name:'Previous result page'}));expect(fake.previous).toHaveBeenCalledWith('d','q');
});
it('disables navigation during a request and reports a failure without hiding the table',()=>{
 const {rerender}=render(ui());fake.paging={...fake.paging,busy:true};rerender(ui());expect(screen.getByRole('button',{name:'Next result page'})).toBeDisabled();
 fake.paging={...fake.paging,busy:false,error:'page unavailable'};rerender(ui());expect(screen.getByRole('alert')).toHaveTextContent('page unavailable');expect(screen.getByText('Execution table')).toBeVisible();
});
