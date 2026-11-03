// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it,vi} from 'vitest';
import {useDashboardStore} from '../../stores/dashboardStore';
import {pinExecution,receiptView} from './QueryDataRenderer';
import {executionId,fixed,receipt} from '../../lib/temporal/fixtures';
import type {DashboardCard} from '../../lib/types';
it('pins by adding a copy bound to the retained execution, leaving the live widget alone',async()=>{
 const duplicateCard=vi.fn(async()=>'copy-1');const patchCardField=vi.fn(async()=>{});
 vi.spyOn(useDashboardStore,'getState').mockReturnValue({...useDashboardStore.getState(),duplicateCard,patchCardField});
 const card={id:'live',title:'Revenue',queryBinding:fixed} as unknown as DashboardCard;
 await expect(pinExecution(card,executionId)).resolves.toBe('copy-1');
 expect(duplicateCard).toHaveBeenCalledWith('live');
 expect(patchCardField).toHaveBeenCalledWith('copy-1','queryBinding',{kind:'execution',executionId});
 expect(patchCardField).toHaveBeenCalledWith('copy-1','title','Revenue · pinned');
 expect(patchCardField).not.toHaveBeenCalledWith('live',expect.anything(),expect.anything());
});
it('reads the receipt fields the drawer shows from dataset provenance',()=>{
 const v=receiptView({executionId,queryId:receipt.query_id,queryRevision:2,resultHash:'abc',knowledgeBasis:null,context:receipt.context,inputManifest:{pins:[{catalog_id:'lake',snapshot_id:7}]},frozenAt:'2026-10-16T18:00:00Z'},{as_of:'2026-10-15'});
 expect(v).toMatchObject({executionId,queryRevision:2,pins:[{catalog_id:'lake',snapshot_id:7}],parameters:{as_of:'2026-10-15'},frozenAt:'2026-10-16T18:00:00Z'});
});
it('preserves the managed table target when pinning a whole-result widget',async()=>{
 const target={kind:'managed' as const,version:1 as const,backendId:'tables',sourceBackendId:'tdb'};
 const duplicateCard=vi.fn(async()=>'managed-copy');const patchCardField=vi.fn(async()=>{});
 vi.spyOn(useDashboardStore,'getState').mockReturnValue({...useDashboardStore.getState(),duplicateCard,patchCardField});
 await pinExecution({id:'live',queryBinding:{...fixed,tableExecution:target}} as unknown as DashboardCard,executionId);
 expect(patchCardField).toHaveBeenCalledWith('managed-copy','queryBinding',{kind:'execution',executionId,tableExecution:target});
});
