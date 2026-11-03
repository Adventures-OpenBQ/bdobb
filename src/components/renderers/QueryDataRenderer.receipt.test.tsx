// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {card} from '../../test/fixtures';
import {fixed,executionId} from '../../lib/temporal/fixtures';
const fake=vi.hoisted(()=>({view:{status:'ready',requested:{widgetId:'q',input:1,model:1,output:1},active:{widgetId:'q',input:1,model:1,output:1},ready:{completeness:{kind:'complete',acquiredRowCount:1001}},definition:{table:{},search:''},selection:{kind:'none'},stale:false},chart:vi.fn(async()=>({provenance:{}}))}));
vi.mock('../../stores/tableExecutionStore',()=>({tableExecutionStore:{subscribe:()=>()=>{},ensureTable:vi.fn(),readView:()=>fake.view,readExecutor:()=>({chartData:fake.chart}),readTemporalSourceReceipt:()=>({executionId:'22222222-2222-4222-8222-222222222222',queryId:'11111111-1111-4111-8111-111111111111',queryRevision:2,resultHash:'a'.repeat(64),knowledgeBasis:null,parameters:{symbol:'TEST.US'}})}}));
vi.mock('./LocalTableRenderer',()=>({LocalTableRenderer:()=> <div>Managed table</div>}));
import {QueryDataRenderer} from './QueryDataRenderer';
it('uses the attested managed receipt without downloading chart rows for metadata',async()=>{
 render(<QueryDataRenderer dashboardId="d" card={card({id:'q',queryBinding:{...fixed,tableExecution:{kind:'managed',version:1,backendId:'tables',sourceBackendId:'tdb'}}})} filterRow={false}/>);
 expect(await screen.findByText('Resolved revision 2')).toBeVisible();expect(screen.getByRole('button',{name:new RegExp(`Receipt ${executionId.slice(0,8)}`)})).toBeVisible();expect(fake.chart).not.toHaveBeenCalled();expect(screen.getByText(/1001 source rows/)).toBeVisible();
});
