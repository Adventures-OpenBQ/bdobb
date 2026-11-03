// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {expect,test,type Page} from '@playwright/test';
import {MOCK_URL,read,seedCards} from './fixtures';
import {definition,executionId,page as result,fixed,queryId} from '../src/lib/temporal/fixtures';
const snapshotIds=[Number.MAX_SAFE_INTEGER,'9007199254740992','9223372036854775807'];
const resultWithPins={...result,receipt:{...result.receipt,input_manifest:{...result.receipt.input_manifest,pins:snapshotIds.map((snapshot_id,i)=>({catalog_id:`catalog-${i}`,snapshot_id}))}}};
async function service(page:Page){
 let starts=0;
 await page.route(`${MOCK_URL}/**`,async route=>{
  const url=new URL(route.request().url());const path=url.pathname;let data:unknown;
  if(path==='/')data={service:'TemporalDB'};
  else if(path==='/widgets.json')data={query_data:{name:'Shared queries',type:'query_data',endpoint:'/temporal/v1/queries',params:[],category:'Data',gridData:{w:40,h:22}}};
  else if(path==='/apps.json')data=[];
  else if(path==='/temporal/v1/queries')data={queries:[definition]};
  else if(path===`/temporal/v1/queries/${queryId}`)data=definition;
  else if(path==='/temporal/v1/executions'){starts++;expect(route.request().postDataJSON()).toMatchObject({revision:2,page_size:1000});data={execution_id:executionId,state:'queued'};}
  else if(path===`/temporal/v1/executions/${executionId}`)data={execution_id:executionId,state:'succeeded',error:null};
  else if(path===`/temporal/v1/executions/${executionId}/pages`)data=resultWithPins;
  else {await route.continue();return;}
  await route.fulfill({json:data,headers:{'access-control-allow-origin':'*'}});
 });return()=>starts;
}
const card={id:'q',widgetId:'query_data',backendId:'b1',params:{},layout:{x:0,y:0,w:40,h:14}};
test('shared library fixes revision by default, persists binding and reuses the current pivot/linked table graph',async({page})=>{
 const starts=await service(page);await seedCards(page,[card]);const source=page.locator('.widget-card');
 await source.getByRole('button',{name:'Open query library'}).click();const dialog=page.getByRole('dialog',{name:'Query library'});
 await expect(dialog.getByRole('button',{name:'Select Revenue',exact:true})).toBeVisible();await page.screenshot({path:'e2e-results/shared-query-library.png',fullPage:true});
 await dialog.getByRole('button',{name:'Select Revenue',exact:true}).click();await expect(dialog.getByLabel('Follow latest revision (explicit opt in)')).not.toBeChecked();
 await dialog.getByRole('button',{name:'Open as table widget'}).click();await expect(source.getByRole('cell',{name:'10',exact:true})).toBeVisible();await expect(source).toContainText('paged');
 await expect(source.getByRole('button',{name:'Filter rows',exact:true})).toBeVisible();
 const saved=JSON.parse((await read(page,'dashboards/d1.json'))!);expect(saved.tabs[0].cards[0].queryBinding).toEqual(fixed);expect(starts()).toBe(1);
 await source.getByRole('button',{name:'Refresh query',exact:true}).click();await expect.poll(starts).toBe(2);await expect(source.getByRole('cell',{name:'10',exact:true})).toBeVisible();
 await source.getByRole('button',{name:'Card menu'}).click();await page.getByRole('menuitem',{name:'Create linked table',exact:true}).click();
 const linked=page.locator('.widget-card').filter({hasText:'Linked table'});await expect(linked.getByRole('cell',{name:'10',exact:true})).toBeVisible();await expect(linked).toContainText('loaded rows only');
 await linked.screenshot({path:'e2e-results/shared-query-linked.png'});
 await linked.getByRole('button',{name:'Card menu'}).click();await page.getByRole('menuitem',{name:'Export ▸',exact:true}).click();await page.getByRole('menuitem',{name:'JSON',exact:true}).click();
 const findExport=()=>page.evaluate(()=>window.__bdobb!.list!().find(p=>p.startsWith('exports/')&&p.endsWith('.json')));await expect.poll(findExport).toBeTruthy();const exportFile=await findExport();const exported=JSON.parse((await read(page,exportFile!))!);expect(exported.provenance.receipt.temporal.executionId).toBe(executionId);expect(exported.provenance.receipt.temporal.inputManifest.pins.map((pin:{snapshot_id:number|string})=>pin.snapshot_id)).toEqual(snapshotIds);expect(exported.completeness.kind).toBe('paged');expect(exported.rows).toEqual([{Revenue:10}]);
 await page.evaluate(async()=>{const path='/src/stores/backendsStore.ts';const {useBackendsStore}=await import(path);const state=useBackendsStore.getState();useBackendsStore.setState({backends:state.backends.map((b:{id:string})=>({...b,headerValue:'changed-scope'}))});});
 await expect(source.getByRole('cell',{name:'10',exact:true})).toHaveCount(0);await expect(linked.getByRole('cell',{name:'10',exact:true})).toHaveCount(0);
});
test('pinned execution starts no query',async({page})=>{
 const starts=await service(page);await seedCards(page,[{...card,queryBinding:{kind:'execution',executionId}}]);await expect(page.getByRole('cell',{name:'10',exact:true})).toBeVisible();expect(starts()).toBe(0);
 await page.screenshot({path:'e2e-results/shared-query-pinned.png',fullPage:true});
});


test('future binding stays on disk and opens repair UI without acquiring',async({page})=>{
 const starts=await service(page);const invalid={...fixed,schemaVersion:99};await seedCards(page,[{...card,queryBinding:invalid}]);await expect(page.getByRole('alert')).toContainText('future TemporalDB query binding');expect(starts()).toBe(0);expect(JSON.parse((await read(page,'dashboards/d1.json'))!).tabs[0].cards[0].queryBinding).toEqual(invalid);await page.getByRole('button',{name:'Open query library'}).click();await expect(page.getByRole('dialog',{name:'Query library'})).toBeVisible();
});

test('typed parameters resolve relative dates per run; receipt drawer pins a copy; context bar re-runs',async({page})=>{
 const typed={...definition,description:'Daily revenue as of the prior business day',parameters:[{name:'as_of',type:'date' as const,required:true,default:'T-1bd'},{name:'limit',type:'integer' as const,required:true,default:100},{name:'include_adjusted',type:'boolean' as const,required:false,default:false}],presentation:{format:'table',bdobb_table_v1:{analytical:{schemaVersion:1},columnOrder:['Revenue']}}};
 const sent:Record<string,unknown>[]=[];
 await page.route(`${MOCK_URL}/**`,async route=>{
  const url=new URL(route.request().url());const path=url.pathname;let data:unknown;
  if(path==='/')data={service:'TemporalDB'};
  else if(path==='/widgets.json')data={query_data:{name:'Shared queries',type:'query_data',endpoint:'/temporal/v1/queries',params:[],category:'Data',gridData:{w:40,h:22}}};
  else if(path==='/apps.json')data=[];
  else if(path==='/temporal/v1/queries')data={queries:[typed]};
  else if(path===`/temporal/v1/queries/${queryId}`)data=typed;
  else if(path==='/temporal/v1/executions'){const body=route.request().postDataJSON();sent.push(body);data={execution_id:executionId,state:'queued'};}
  else if(path===`/temporal/v1/executions/${executionId}`)data={execution_id:executionId,state:'succeeded',error:null};
  else if(path===`/temporal/v1/executions/${executionId}/pages`){const last=sent.at(-1) as {params?:Record<string,unknown>;context?:unknown}|undefined;data={...resultWithPins,receipt:{...resultWithPins.receipt,parameters:last?.params??{},context:last?.context??resultWithPins.receipt.context}};}
  else {await route.continue();return;}
  await route.fulfill({json:data,headers:{'access-control-allow-origin':'*'}});
 });
 await seedCards(page,[card]);const source=page.locator('.widget-card').first();
 await source.getByRole('button',{name:'Open query library'}).click();const dialog=page.getByRole('dialog',{name:'Query library'});
 await expect(dialog.getByText('Daily revenue as of the prior business day')).toBeVisible();await expect(dialog.getByText('Pivot saved',{exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Select Revenue',exact:true}).click();
 await expect(dialog.getByLabel('Parameter as_of')).toHaveValue('T-1bd');await expect(dialog.getByText(/Resolves to \d{4}-\d{2}-\d{2} now/)).toBeVisible();
 await dialog.getByLabel('Parameter limit').fill('2.5');await expect(dialog.getByText('limit must be a whole number')).toBeVisible();
 await dialog.getByLabel('Parameter limit').fill('25');
 await page.screenshot({path:'e2e-results/shared-query-typed-params.png',fullPage:true});
 await dialog.getByLabel('Apply the pivot layout saved with this query').uncheck();
 await dialog.getByRole('button',{name:'Open as table widget'}).click();await expect(source.getByRole('cell',{name:'10',exact:true})).toBeVisible();
 const saved=JSON.parse((await read(page,'dashboards/d1.json'))!).tabs[0].cards[0];
 expect(saved.queryBinding.params).toEqual({as_of:'T-1bd',limit:25,include_adjusted:false});
 expect(sent[0].params).toMatchObject({limit:25,include_adjusted:false});expect(String((sent[0].params as {as_of:string}).as_of)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
 await source.getByRole('button',{name:/^Receipt /}).click();const drawer=source.getByRole('region',{name:'Execution receipt details'});
 await expect(drawer).toContainText(executionId);await expect(drawer).toContainText('from T-1bd');await expect(drawer).toContainText('catalog-0');
 await source.screenshot({path:'e2e-results/shared-query-receipt-drawer.png'});
 await drawer.getByRole('button',{name:'Pin this execution'}).click();await expect(drawer.getByRole('status')).toContainText('Pinned copy added');
 await expect.poll(async()=>JSON.parse((await read(page,'dashboards/d1.json'))!).tabs[0].cards.map((c:{queryBinding?:{kind:string}})=>c.queryBinding?.kind)).toEqual(['query','execution']);
 await drawer.getByRole('button',{name:'Close receipt'}).click();
 const bar=source.getByRole('form',{name:'Temporal context'});
 await bar.getByLabel('Temporal mode').selectOption('known_at');await bar.getByLabel('Known at').fill('2026-10-15');await bar.getByLabel('Knowledge basis').selectOption('local_received');
 await source.screenshot({path:'e2e-results/shared-query-context-bar.png'});
 const before=sent.length;await bar.getByRole('button',{name:'Apply and run'}).click();await expect.poll(()=>sent.length).toBeGreaterThan(before);
 expect(sent.at(-1)!.context).toEqual({mode:'known_at',known_at:'2026-10-15',knowledge_basis:'local_received'});
 await expect(source.getByRole('status',{name:'Execution receipt'})).toContainText('Local receipt');
});
