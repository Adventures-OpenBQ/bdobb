// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {expect,test} from '@playwright/test';
import {dashboardSeed,seedApp,read} from './fixtures';

/** Browser orchestration/UI qualification with the real compiled Rust fixture provider.
 * This deliberately injects the provider seam; Task 11 must qualify the combined
 * browser -> authenticated gateway -> native service path, including wire cancellation. */
test('managed full-scope consumers, header actions and persisted linked reopen',async({page},info)=>{
 await seedApp(page,dashboardSeed([]));
 await page.evaluate(async()=>{const p='/src/stores/widgetRegistryStore.ts';const registry=(await import(p)).useWidgetRegistryStore as typeof import('../src/stores/widgetRegistryStore').useWidgetRegistryStore;registry.setState(s=>({widgets:s.widgets.filter(w=>w.type!=='keys'&&!w.id.includes('provider_api_keys'))}));});
 await page.evaluate(async()=>{
  const storePath='/src/stores/tableExecutionStore.ts',registryPath='/src/stores/widgetRegistryStore.ts',dashboardsPath='/src/stores/dashboardStore.ts',normalizePath='/src/lib/widgetsJson.ts',fixturePath='/src/lib/tableExecution/rust/remoteProviderFixture.ts',runtimePath='/src/lib/tableExecution/rust/runtime.ts',inputPath='/src/lib/tableExecution/fixtures.ts',subsetPath='/src/lib/tableExecution/subsetTransfer.ts';
  const {createTableExecutionStore,tableExecutionStore}=await import(storePath) as typeof import('../src/stores/tableExecutionStore');
  const {useWidgetRegistryStore}=await import(registryPath) as typeof import('../src/stores/widgetRegistryStore');
  const {useDashboardStore}=await import(dashboardsPath) as typeof import('../src/stores/dashboardStore');
  const {normalizeWidgets}=await import(normalizePath) as typeof import('../src/lib/widgetsJson');
  const {createRemoteProviderFixture}=await import(fixturePath) as typeof import('../src/lib/tableExecution/rust/remoteProviderFixture');
  const {loadRustRuntime}=await import(runtimePath) as typeof import('../src/lib/tableExecution/rust/runtime');
  const {input}=await import(inputPath) as typeof import('../src/lib/tableExecution/fixtures');
  const {beginSubset,appendSubset,commitSubset}=await import(subsetPath) as typeof import('../src/lib/tableExecution/subsetTransfer');
  const runtime=await loadRustRuntime();let localAcquisitions=0,derivations=0;
  const dataset={...input,rows:Array.from({length:205},(_,i)=>({id:`r${i}`,values:{region:`R${i}`,revenue:i+1,team:`T${i}`,date:'2026-01-01'}}))};
  async function open(data:typeof input,options:import('../src/lib/tableExecution/types').SessionOptions):Promise<import('../src/lib/tableExecution/types').ProviderSession>{
   const fixture=createRemoteProviderFixture({runtime,input:data,sourceId:'source',snapshotId:'',batchRows:37});
   const session=await fixture.provider.open({kind:'remote',sourceId:'source',snapshotId:''},options);
   return {...session,capabilities:{...session.capabilities,linkedDerivation:true},deriveLinked:async(revision,opts)=>{
    derivations++;let transfer:ReturnType<typeof beginSubset>|undefined;
    for await(const batch of session.result.presented(revision,opts.signal??new AbortController().signal)){transfer??=beginSubset(batch.transferId,revision);appendSubset(transfer,batch);}
    const selected=commitSubset(transfer!);return open({...selected,resultRevision:opts.inputRevision},opts);
   }};
  }
  const store=createTableExecutionStore({source:()=>{localAcquisitions++;throw new Error('Client acquisition forbidden');},executor:()=>{localAcquisitions++;throw new Error('Client worker forbidden');},managedProvider:()=>({open:async(source,options)=>open({...dataset,resultRevision:source.kind==='remote'?source.managed!.inputRevision:1},options)})});
  Object.assign(tableExecutionStore,store);
  useWidgetRegistryStore.setState(s=>({widgets:[...s.widgets,...normalizeWidgets({managed:{name:'Managed parity',type:'table_ssrm',provider:'managed-native',protocolVersion:1,endpoint:'/sessions'}},'b1').widgets]}));
  const card:import('../src/lib/types').DashboardCard={id:'managed-root',widgetId:'managed',backendId:'b1',title:'Managed parity',params:{},layout:{x:0,y:0,w:40,h:20},managedSource:{sourceId:'source',kind:'upload',version:1},tableSelection:{kind:'allMatching',excludedIds:['r204']}};
  const d:import('../src/lib/types').Dashboard={id:'d1',name:'Main',tabs:[{id:'t1',name:'Main',cards:[card]}]};
  store.acquireDashboard(d);useDashboardStore.setState({dashboards:[d],activeId:'d1',activeTabId:'t1'});await store.settled('d1');
  Object.assign(window,{ssrmProof:()=>({localAcquisitions,derivations})});
 });
 const root=page.locator('.widget-card').filter({has:page.getByText('Managed parity',{exact:true})});
 await expect(root.getByText('Server snapshot',{exact:true})).toBeVisible();
 await expect(root.getByRole('button',{name:'Filter rows'})).toBeVisible();
 await root.getByRole('button',{name:'Card menu'}).click();await page.getByRole('menuitem',{name:'Columns ▸'}).click();
 await expect(page.getByRole('menuitemcheckbox',{name:/Revenue/})).toBeVisible();
 await page.keyboard.press('Escape');
 await root.getByRole('button',{name:'Card menu'}).click();await page.getByRole('menuitem',{name:'Quick actions ▸'}).click();await page.getByRole('menuitem',{name:'Autosize columns'}).click();
 await expect.poll(async()=>{const saved=await read(page,'dashboards/d1.json');return saved?JSON.parse(saved).tabs[0].cards[0].table?.widths:undefined;}).toBeTruthy();
 await root.getByRole('button',{name:'Card menu'}).click();await page.getByRole('menuitem',{name:'Create linked table'}).click();
 await root.getByRole('button',{name:'Card menu'}).click();await page.getByRole('menuitem',{name:'Create linked chart'}).click();
 await page.getByRole('combobox',{name:'Category',exact:true}).selectOption('region');
 await page.getByRole('checkbox',{name:'Revenue',exact:true}).check();
 await expect(page.getByTestId('chart-plot')).toBeVisible();
 await expect.poll(()=>page.getByTestId('chart-plot').evaluate(el=>(el as unknown as {data?:{x?:unknown[]}[]}).data?.[0]?.x?.length)).toBe(204);
 const proof=await page.evaluate(async()=>{
  const p='/src/stores/tableExecutionStore.ts',d='/src/stores/dashboardStore.ts',e='/src/lib/export.ts';
  const store=(await import(p)).tableExecutionStore as import('../src/stores/tableExecutionStore').TableExecutionStore;
  const dashboards=(await import(d)).useDashboardStore as typeof import('../src/stores/dashboardStore').useDashboardStore;
  const {collectPresentedExport}=await import(e) as typeof import('../src/lib/export');
  await store.settled('d1');const cards=dashboards.getState().dashboards.find(d=>d.id==='d1')!.tabs[0].cards;const child=cards.find(c=>c.linkedSource)!;
  const revision=store.readView('d1','managed-root').active!,executor=store.readExecutor('d1','managed-root')!,signal=new AbortController().signal;
  const chart=await executor.chartData(revision,['region','revenue'],signal),exported=await collectPresentedExport(executor,revision,signal);
  const before=store.readView('d1',child.id).ready?.topLevelCount;store.reopen('d1','managed-root');await store.settled('d1');
  return {chart:chart.rows.length,exported:exported.rows.length,child:before,reopened:store.readView('d1',child.id).ready?.topLevelCount,...(window as unknown as {ssrmProof:()=>object}).ssrmProof()};
 });
 expect(proof).toMatchObject({chart:204,exported:205,child:204,reopened:204,localAcquisitions:0,derivations:2});
 await info.attach('browser-fixture-consumer-proof',{body:JSON.stringify(proof),contentType:'application/json'});
 const saved=JSON.parse((await read(page,'dashboards/d1.json'))!);expect(saved.tabs[0].cards[0].managedSource).toEqual({sourceId:'source',kind:'upload',version:1});
 expect(JSON.stringify(saved)).not.toContain('sessionId');await root.screenshot({path:info.outputPath('managed-consumers.png')});
});

test('standard LIVE refuses whole-result consumer surfaces',async({page})=>{
 await seedApp(page,dashboardSeed([]));
 await page.evaluate(async()=>{const p='/src/stores/widgetRegistryStore.ts';const registry=(await import(p)).useWidgetRegistryStore as typeof import('../src/stores/widgetRegistryStore').useWidgetRegistryStore;registry.setState(s=>({widgets:s.widgets.filter(w=>w.type!=='keys'&&!w.id.includes('provider_api_keys'))}));});
 await page.evaluate(async()=>{
  const r='/src/stores/widgetRegistryStore.ts',d='/src/stores/dashboardStore.ts',n='/src/lib/widgetsJson.ts';
  const registry=(await import(r)).useWidgetRegistryStore as typeof import('../src/stores/widgetRegistryStore').useWidgetRegistryStore;
  const dashboards=(await import(d)).useDashboardStore as typeof import('../src/stores/dashboardStore').useDashboardStore;
  const normalize=(await import(n)).normalizeWidgets as typeof import('../src/lib/widgetsJson').normalizeWidgets;
  registry.setState(s=>({widgets:[...s.widgets,...normalize({live:{name:'LIVE parity',type:'table_ssrm',endpoint:'/prices'}},'b1').widgets]}));
  dashboards.setState({dashboards:[{id:'d1',name:'Main',tabs:[{id:'t1',name:'Main',cards:[{id:'live',widgetId:'live',backendId:'b1',params:{},layout:{x:0,y:0,w:40,h:20}}]}]}]});
 });
 await expect(page.getByText(/LIVE · paged/)).toBeVisible();await page.getByRole('button',{name:'Card menu'}).click();
 await expect(page.getByRole('menuitem',{name:/^Export/})).toHaveCount(0);await expect(page.getByRole('menuitem',{name:/Create linked/})).toHaveCount(0);
});
