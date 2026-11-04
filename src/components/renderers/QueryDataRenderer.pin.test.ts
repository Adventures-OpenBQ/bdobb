// SPDX-License-Identifier: AGPL-3.0-only
import {beforeEach,expect,it} from 'vitest';
import {useDashboardStore} from '../../stores/dashboardStore';
import {__reset,__read} from '../../test/memfs';
import {__resetJsonStoreForTests} from '../../lib/jsonStore';
import {widget} from '../../test/fixtures';
import {pinExecution,receiptView} from './QueryDataRenderer';
import {executionId,fixed,receipt} from '../../lib/temporal/fixtures';
import type {QueryBinding} from '../../lib/temporal/bindings';

beforeEach(()=>{__reset();__resetJsonStoreForTests();useDashboardStore.setState({dashboards:[],activeId:null,activeTabId:null,viewer:false,pendingCardRemoval:null});});
async function setup(managed=false){
 await useDashboardStore.getState().load();
 const id=(await useDashboardStore.getState().addCard(widget({id:'query_data',backendId:'tdb'})))!;
 const target={kind:'managed' as const,version:1 as const,backendId:'tables',sourceBackendId:'tdb'};
 await useDashboardStore.getState().bindQueryCard(id,{...fixed,...(managed?{tableExecution:target}:{})});
 await useDashboardStore.getState().patchCardField(id,'title','Revenue');
 const dashboard=useDashboardStore.getState().activeDashboard()!;
 return {card:dashboard.tabs[0].cards.find(c=>c.id===id)!,dashboardId:dashboard.id,target};
}
it.each([false,true])('publishes a pinned copy atomically without a transient live binding (managed=%s)',async managed=>{
 const {card,dashboardId,target}=await setup(managed);
 const published:QueryBinding[]=[];
 const unsubscribe=useDashboardStore.subscribe(state=>{
  const copy=state.dashboards.find(d=>d.id===dashboardId)?.tabs.flatMap(t=>t.cards).find(c=>c.id!==card.id);
  if(copy?.queryBinding)published.push(structuredClone(copy.queryBinding));
 });
 const id=await pinExecution(card,executionId);unsubscribe();
 expect(id).not.toBeNull();expect(published.length).toBeGreaterThan(0);
 expect(published.every(binding=>binding.kind==='execution')).toBe(true);
 const saved=JSON.parse(__read(`dashboards/${dashboardId}.json`)!);
 const cards=saved.tabs[0].cards;
 expect(cards.find((c:{id:string})=>c.id===id)).toMatchObject({title:'Revenue · pinned',queryBinding:{kind:'execution',executionId,...(managed?{tableExecution:target}:{})}});
 expect(cards.find((c:{id:string})=>c.id===card.id).queryBinding).toEqual(card.queryBinding);
});
it('does not create a pin in viewer mode',async()=>{
 const {card,dashboardId}=await setup();const before=__read(`dashboards/${dashboardId}.json`);
 useDashboardStore.setState({viewer:true});
 expect(await pinExecution(card,executionId)).toBeNull();
 expect(__read(`dashboards/${dashboardId}.json`)).toBe(before);
});
it('reads the receipt fields the drawer shows from dataset provenance',()=>{
 const v=receiptView({executionId,queryId:receipt.query_id,queryRevision:2,resultHash:'abc',knowledgeBasis:null,context:receipt.context,inputManifest:{pins:[{catalog_id:'lake',snapshot_id:7}]},frozenAt:'2026-10-16T18:00:00Z'},{as_of:'2026-10-15'});
 expect(v).toMatchObject({executionId,queryRevision:2,pins:[{catalog_id:'lake',snapshot_id:7}],parameters:{as_of:'2026-10-15'},frozenAt:'2026-10-16T18:00:00Z'});
});
