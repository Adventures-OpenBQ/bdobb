// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {test,expect} from '@playwright/test';
import {seedApp,dashboardSeed,read} from './fixtures';
// @ts-expect-error JavaScript qualification harness has no public TypeScript API.
import {startNativeHarness} from '../scripts/ssrm-native-harness.mjs';
test('authenticated native upload, full consumers, refresh, saved reopen and errors',async({page,context},info)=>{
 const h=await startNativeHarness();
 try{
  await context.addCookies([await h.cookie()]);
  const seed=dashboardSeed([{id:'native-root',widgetId:'managed_table',backendId:'native',title:'Native qualification',params:{},layout:{x:0,y:0,w:40,h:24}}]);
  seed['backends.json']=JSON.stringify([{id:'native',name:'Native',baseUrl:h.origin+'/table',authLocation:'header',validateWidgets:false}]);
  await seedApp(page,seed,h.origin);
  await page.getByLabel('Upload table file').setInputFiles({name:'qualification.csv',mimeType:'text/csv',buffer:Buffer.from('region,revenue,team,date\n'+Array.from({length:1205},(_,i)=>`R${i},${i+1},T${i%3},2026-01-01`).join('\n'))});
  await expect(page.getByText('Server snapshot',{exact:true})).toBeVisible({timeout:30_000});
  await expect.poll(async()=>page.evaluate(async()=>{const p='/src/stores/tableExecutionStore.ts';return (await import(p)).tableExecutionStore.readView('d1','native-root').ready?.topLevelCount;}),{timeout:30_000}).toBe(1205);
  await expect(page.getByText('R0',{exact:true}).first()).toBeVisible();
  const saved=await read(page,'dashboards/d1.json');expect(saved).toContain('managedSource');expect(saved).not.toContain('sessionId');
  const proof=await page.evaluate(async()=>{
   const p='/src/stores/tableExecutionStore.ts',d='/src/stores/dashboardStore.ts',e='/src/lib/export.ts';
   const store=(await import(p)).tableExecutionStore as import('../src/stores/tableExecutionStore').TableExecutionStore;
   const dashboards=(await import(d)).useDashboardStore as typeof import('../src/stores/dashboardStore').useDashboardStore;
   const {collectPresentedExport}=await import(e) as typeof import('../src/lib/export');
   const start=performance.now(),signal=new AbortController().signal;
   const revision=store.readView('d1','native-root').active!,executor=store.readExecutor('d1','native-root')!;
   const tail=await executor.rows(revision,{groupPath:[],offset:1200,limit:5},signal);
   const full=await collectPresentedExport(executor,revision,signal);
   const firstId=tail.rows[0].id;
   await dashboards.getState().commitTableDefinition('d1','native-root',{table:{},search:''},{kind:'allMatching',excludedIds:[firstId]});
   store.syncDashboard(dashboards.getState().dashboards[0]);await store.settled('d1');
   return {tail:tail.rows.length,total:full.rows.length,ms:performance.now()-start};
  });
  await page.waitForLoadState('networkidle');
  const consumers=await page.evaluate(async()=>{
   const p='/src/stores/tableExecutionStore.ts';const store=(await import(p)).tableExecutionStore as import('../src/stores/tableExecutionStore').TableExecutionStore;const signal=new AbortController().signal;
   const selectedRevision=store.readView('d1','native-root').active!,selectedExecutor=store.readExecutor('d1','native-root')!;
   const chart=await selectedExecutor.chartData(selectedRevision,['region','revenue'],signal);
   const stream=selectedExecutor.presented(selectedRevision,signal,true)[Symbol.asyncIterator]();let count=(await stream.next()).value!.rows.length;
   store.reopen('d1','native-root');await store.settled('d1');
   for(;;){const next=await stream.next();if(next.done)break;count+=next.value.rows.length;}
   return {chart:chart.rows.length,refreshExport:count};
  });
  expect({...proof,...consumers}).toMatchObject({tail:5,total:1205,chart:1204,refreshExport:1205});
  const root=page.locator('.widget-card').filter({has:page.getByText('Native qualification',{exact:true})});
  await root.getByRole('button',{name:'Card menu'}).click();await page.getByRole('menuitem',{name:'Create linked table'}).click();
  await expect.poll(()=>page.evaluate(async()=>{const p='/src/stores/tableExecutionStore.ts',d='/src/stores/dashboardStore.ts';const ds=(await import(d)).useDashboardStore.getState();const child=ds.dashboards[0].tabs[0].cards.find((c:{linkedSource?:unknown})=>c.linkedSource);return child&&(await import(p)).tableExecutionStore.readView('d1',child.id).ready?.topLevelCount;})).toBe(1204);
  await root.getByRole('button',{name:'Card menu'}).click();await page.getByRole('menuitem',{name:'Create linked chart'}).click();
  await page.getByRole('combobox',{name:'Category',exact:true}).selectOption('region');await page.getByRole('checkbox',{name:'revenue',exact:true}).check();
  await expect.poll(()=>page.getByTestId('chart-plot').evaluate(el=>(el as unknown as {data?:{x?:unknown[]}[]}).data?.[0]?.x?.length)).toBe(1204);
  await root.getByRole('button',{name:'Card menu'}).click();await page.getByRole('menuitem',{name:'Export ▸'}).click();await page.getByRole('menuitem',{name:'CSV',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__bdobb!.list!().find(p=>p.startsWith('exports/')&&p.endsWith('.csv')))).toBeTruthy();
  const exported=await page.evaluate(()=>{const path=window.__bdobb!.list!().find(p=>p.startsWith('exports/')&&p.endsWith('.csv'))!;return window.__bdobb!.read!(path);});expect(exported!.trim().split('\n')).toHaveLength(1206);
  const chain=await page.evaluate(async()=>{const p='/src/stores/dashboardStore.ts';const ds=(await import(p)).useDashboardStore as typeof import('../src/stores/dashboardStore').useDashboardStore;const child=ds.getState().dashboards[0].tabs[0].cards.find(c=>c.linkedSource&&!c.linkedChart)!;return ds.getState().addLinkedCard({dashboardId:'d1',tabId:'t1',sourceWidgetId:child.id,presentation:'table'});});
  await expect.poll(()=>page.evaluate(async id=>{const p='/src/stores/tableExecutionStore.ts';return (await import(p)).tableExecutionStore.readView('d1',id).ready?.topLevelCount;},chain)).toBe(1204);
  // Reopen the persisted dashboard in a new document; no session IDs are reused.
  const persisted=(await read(page,'dashboards/d1.json'))!;seed['dashboards/d1.json']=persisted;
  await page.addInitScript(files=>{window.__bdobbSeed=files;},seed);await page.reload();
  await expect(page.getByText('Server snapshot',{exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(async()=>{const p='/src/stores/tableExecutionStore.ts',d='/src/stores/dashboardStore.ts';const ds=(await import(d)).useDashboardStore.getState();const child=ds.dashboards[0].tabs[0].cards.find((c:{linkedSource?:unknown})=>c.linkedSource);return child&&(await import(p)).tableExecutionStore.readView('d1',child.id).ready?.topLevelCount;})).toBe(1204);
  await expect.poll(()=>page.evaluate(async id=>{const p='/src/stores/tableExecutionStore.ts';return (await import(p)).tableExecutionStore.readView('d1',id).ready?.topLevelCount;},chain)).toBe(1204);
  await page.setViewportSize({width:390,height:844});await page.keyboard.press('Tab');
  await page.evaluate(async()=>{const p='/src/stores/settingsStore.ts';await (await import(p)).useSettingsStore.getState().save({theme:'light'});});
  await page.screenshot({path:info.outputPath('native-narrow.png'),fullPage:true});
  const sourceId=JSON.parse(persisted).tabs[0].cards[0].managedSource.sourceId;
  await context.addCookies([await h.cookie('43')]);
  const foreign=await page.evaluate(async id=>(await fetch('/table/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceId:id,protocolVersion:1,widgetId:'foreign',locale:'en-US',inputRevision:1})})).status,sourceId);
  expect(foreign).toBe(404);
  await context.addCookies([await h.cookie()]);
  expect(h.health()).toBeDefined();const containment=h.inspect();expect(containment).toMatch(/Max address space\s+536870912\s+536870912/);expect(containment).not.toContain('uid=0(');
  await info.attach('native-proof',{body:JSON.stringify({proof,consumers,containment,...h.measurements}),contentType:'application/json'});
 }finally{await info.attach('native-observations',{body:JSON.stringify(h.measurements),contentType:'application/json'});await h.close();}
});
