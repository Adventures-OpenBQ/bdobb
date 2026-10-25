// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {test,expect} from '@playwright/test';
import {seedApp,dashboardSeed} from './fixtures';
// @ts-expect-error JavaScript qualification harness has no public TypeScript API.
import {startNativeHarness} from '../scripts/ssrm-native-harness.mjs';
test('native bounded page cache, grouped scope, limits and registered LIVE pages',async({page,context},info)=>{
 const h=await startNativeHarness();
 try{
  await context.addCookies([await h.cookie()]);
  const seed=dashboardSeed([{id:'resource',widgetId:'managed_table',backendId:'native',title:'Resources',params:{},layout:{x:0,y:0,w:40,h:24}}]);
  seed['backends.json']=JSON.stringify([{id:'native',name:'Native',baseUrl:h.origin+'/table',authLocation:'header',validateWidgets:false}]);
  await seedApp(page,seed,h.origin);
  await page.getByLabel('Upload table file').setInputFiles({name:'resource.csv',mimeType:'text/csv',buffer:Buffer.from('region,revenue,team,date,a,b,c,d\n'+Array.from({length:2005},(_,i)=>`R${i},${i+1},T${i%3},2026-01-01,a,b,c,d`).join('\n'))});
  await expect.poll(()=>page.evaluate(async()=>{const p='/src/stores/tableExecutionStore.ts';return (await import(p)).tableExecutionStore.readView('d1','resource').ready?.topLevelCount;}),{timeout:30_000}).toBe(2005);
  await page.waitForLoadState('networkidle');
  await page.evaluate(async()=>{const p='/e2e/ssrm-resource-probe.tsx';(await import(p)).mount();});
  await expect(page.locator('#native-cache-count')).toHaveText('1',{timeout:30_000});
  for(let offset=100;offset<=2000;offset+=100){
   await page.evaluate(async offset=>{const p='/e2e/ssrm-resource-probe.tsx';(await import(p)).result.requestRows({groupPath:[],offset,limit:9999});},offset);
   await expect.poll(()=>page.evaluate(async()=>{const p='/e2e/ssrm-resource-probe.tsx';return (await import(p)).result.blocks.at(-1)?.offset;})).toBe(offset);
  }
  const cache=await page.evaluate(async()=>{const p='/e2e/ssrm-resource-probe.tsx';const b=(await import(p)).result.blocks as {rows:unknown[]}[];return {blocks:b.length,rows:b.reduce((n,b)=>n+b.rows.length,0),maxBlock:Math.max(...b.map(b=>b.rows.length))};});
  expect(cache).toEqual({blocks:12,rows:1105,maxBlock:100});
  const pivot=await page.evaluate(async()=>{
   const p='/src/stores/tableExecutionStore.ts',d='/src/stores/dashboardStore.ts';const store=(await import(p)).tableExecutionStore as import('../src/stores/tableExecutionStore').TableExecutionStore;const ds=(await import(d)).useDashboardStore as typeof import('../src/stores/dashboardStore').useDashboardStore;
   await ds.getState().commitTableDefinition('d1','resource',{table:{pivot:{enabled:true,grouping:['team'],split:[],aggregationFns:{revenue:'mean'}}},search:''},{kind:'none'});store.syncDashboard(ds.getState().dashboards[0]);await store.settled('d1');
   return {count:store.readView('d1','resource').ready?.topLevelCount};
  });expect(pivot.count).toBe(3);
  await page.waitForLoadState('networkidle');
  const expand=page.getByRole('button',{name:'Expand T0',exact:true});await expand.focus();await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:'Collapse T0',exact:true})).toBeVisible();
  const grouped=await page.evaluate(async()=>{const p='/src/stores/tableExecutionStore.ts';const store=(await import(p)).tableExecutionStore as import('../src/stores/tableExecutionStore').TableExecutionStore;const q=store.readView('d1','resource').active!,e=store.readExecutor('d1','resource')!,s=new AbortController().signal;const root=await e.rows(q,{groupPath:[],offset:0,limit:3},s);const child=await e.rows(q,{groupPath:root.groups[0].path,offset:600,limit:100},s);return {root:root.rows,children:child.rows.length,total:await e.totals(q,s)};});
  expect(grouped.children).toBeGreaterThan(0);expect(grouped.total.values.revenue).toBe(1003);
  const tooLarge=await page.evaluate(async()=>{const r=await fetch('/table/sources/uploads',{method:'POST',headers:{'Content-Type':'text/csv','Idempotency-Key':crypto.randomUUID(),'X-Upload-Filename':'large.csv'},body:'x'.repeat(2097153)});return r.status;});expect(tooLarge).toBe(413);
  // The remote executor refuses a row block above the negotiated limit before sending it.
  const refusal=await page.evaluate(async()=>{const p='/src/stores/tableExecutionStore.ts';const store=(await import(p)).tableExecutionStore as import('../src/stores/tableExecutionStore').TableExecutionStore;try{await store.readExecutor('d1','resource')!.rows(store.readView('d1','resource').active!,{groupPath:[],offset:0,limit:101},new AbortController().signal);return 'accepted';}catch(e){return String(e);}});expect(refusal).toContain('Invalid bounded renderer row request');
  await page.evaluate(async origin=>{const r='/src/stores/widgetRegistryStore.ts',d='/src/stores/dashboardStore.ts',b='/src/stores/backendsStore.ts',n='/src/lib/widgetsJson.ts';const registry=(await import(r)).useWidgetRegistryStore;const dashboards=(await import(d)).useDashboardStore;const backends=(await import(b)).useBackendsStore;const normalize=(await import(n)).normalizeWidgets;backends.setState((s:{backends:unknown[]})=>({backends:[...s.backends,{id:'live',name:'LIVE',baseUrl:origin+'/api',authLocation:'header',validateWidgets:false}]}));registry.setState((s:{widgets:unknown[]})=>({widgets:[...s.widgets,...normalize({live:{name:'Registered LIVE',type:'table_ssrm',endpoint:'/api/v1/qualification/table',data:{table:{columnsDefs:[{field:'region'},{field:'revenue'}]}}}},'live').widgets]}));dashboards.setState((s:{dashboards:import('../src/lib/types').Dashboard[]})=>({dashboards:s.dashboards.map(d=>({...d,tabs:d.tabs.map(t=>({...t,cards:[{id:'live-card',backendId:'live',widgetId:'live',params:{},layout:{x:0,y:0,w:40,h:24}}]}))}))}));},h.origin);
  await expect(page.getByRole('table',{name:'Server table'})).toBeVisible();
  for(let i=0;i<11;i++){await page.getByRole('button',{name:'Next page',exact:true}).click();await expect(page.getByRole('navigation',{name:'Table pages'})).toContainText(`${(i+1)*100+1}`);}
  expect(await page.getByRole('table',{name:'Server table'}).locator('tbody tr').count()).toBe(100);
  await page.getByRole('button',{name:'Card menu'}).click();await expect(page.getByRole('menuitem',{name:/^Export/})).toHaveCount(0);await page.keyboard.press('Escape');
  await info.attach('resource-proof',{body:JSON.stringify({cache,pivot,grouped,...h.measurements}),contentType:'application/json'});
 }finally{await info.attach('resource-observations',{body:JSON.stringify(h.measurements),contentType:'application/json'});await h.close();}
});
