// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {test,expect,type Page} from '@playwright/test';
import {seedApp,defaultSeed,read} from './fixtures';
import {buildSecDashboard} from './fixtures/sec-statements/fixtureBuilder';
const pageErrors=new WeakMap<Page,string[]>();
test.beforeEach(async({page})=>{const errors:string[]=[];pageErrors.set(page,errors);page.on('pageerror',error=>errors.push(error.message));});
test.afterEach(async({page,browser},info)=>{
 const errors=pageErrors.get(page)??[];expect(errors).toEqual([]);
 const engine=page.url().startsWith('http')?await page.evaluate(async()=>{
  const path='/src/lib/tableExecution/rust/providerFactory.ts';
  return ((await import(path)) as typeof import('../src/lib/tableExecution/rust/providerFactory')).resolveTableEngine();
 }):undefined;
 if(engine)expect(engine).toBe(process.env.VITE_TABLE_ENGINE??'typescript');
 await info.attach('environment',{body:JSON.stringify({browser:browser.version(),project:info.project.name,engine,viewport:page.viewportSize(),pageErrors:errors}),contentType:'application/json'});
});
const facts=(page:Page)=>page.locator('.widget-card').filter({has:page.locator('header').getByText('SEC company facts',{exact:true})});
async function choose(page:Page) {
 const button=facts(page).getByRole('button',{name:/^Company:/});
 await expect(button).toBeEnabled();await button.focus();await page.keyboard.press('Enter');
 const popup=page.getByRole('dialog',{name:'Company values'});
 await popup.getByLabel('CIK:0001045810',{exact:true}).uncheck();
 await popup.getByLabel('CIK:0001652044',{exact:true}).check();
 await popup.getByRole('button',{name:'Apply'}).click();
 await expect(button).toHaveText(/CIK:0001652044/);
}
async function reopen(page:Page) {
 // Capture actual filesystem-adapter output, never dashboardStore state.
 const files=await page.evaluate(()=>Object.fromEntries(window.__bdobb!.list!().map(p=>[p,window.__bdobb!.read!(p)!])));
 await page.addInitScript(seed=>{window.__bdobbSeed=seed;},files);
 await page.reload();
}
for(const width of [1280,390]) {
 test(`viewer_session_filter_resets_on_reopen ${width}px`,async({page},info)=>{
  await page.setViewportSize({width,height:900});
  const built=buildSecDashboard();const saved=JSON.stringify(built.dashboard);
  await seedApp(page,{...defaultSeed(),...built.files,'dashboards/d1.json':saved},'/?viewer=d1');
  await choose(page);expect(await read(page,'dashboards/d1.json')).toBe(saved);
  await reopen(page);await expect(facts(page).getByRole('button',{name:/^Company:/})).toHaveText(/CIK:0001045810/);
  expect(await read(page,'dashboards/d1.json')).toBe(saved);
  await info.attach('persisted-dashboard',{body:(await read(page,'dashboards/d1.json'))!,contentType:'application/json'});
 });
}
test('authoring_selection_survives_reload and an offscreen selected row reaches its linked child',async({page},info)=>{
 const built=buildSecDashboard();await seedApp(page,{...defaultSeed(),...built.files,'dashboards/d1.json':JSON.stringify(built.dashboard)});
 await choose(page);
 await expect.poll(async()=>JSON.parse((await read(page,'dashboards/d1.json'))!).tabs[0].cards[0].tableDefinition.analytical.checklists[0].memberKeys).toEqual(['["string","CIK:0001652044"]']);
 const persisted=(await read(page,'dashboards/d1.json'))!;
 await reopen(page);
 await expect(facts(page).getByRole('button',{name:/^Company:/})).toHaveText(/CIK:0001652044/);
 const statement=page.locator('.widget-card').filter({has:page.locator('header').getByText('Verified SEC statement',{exact:true})});
 // Revenue is selected by durable identity while its collapsed section has no mounted row.
 await expect(statement.getByText('Revenue (USD)',{exact:true})).toHaveCount(0);
 const chart=page.locator('.widget-card').filter({has:page.locator('header').getByText('Selected line — FY2024',{exact:true})});
 await expect.poll(()=>chart.locator('.js-plotly-plot').evaluateAll(elements=>elements.flatMap(el=>(el as unknown as {data?:{y:number[]}[]}).data?.flatMap(t=>t.y)??[]))).toEqual([350018000000]);
 expect(JSON.parse((await read(page,'dashboards/d1.json'))!).tabs[0].cards[1].tableSelection).toEqual(built.dashboard.tabs[0].cards[1].tableSelection);
 await info.attach('persisted-authoring-dashboard',{body:persisted,contentType:'application/json'});
});
test('persisted unavailable chart field shows explicit repair state',async({page})=>{
 const built=buildSecDashboard();built.dashboard.tabs[0].cards.find(c=>c.id==='chart')!.linkedChart!.measures=['removed-field'];
 await seedApp(page,{...defaultSeed(),...built.files,'dashboards/d1.json':JSON.stringify(built.dashboard)});
 await expect(page.getByRole('alert').filter({hasText:'Field removed-field is unavailable. Repair chart fields.'})).toBeVisible();
});
test('coarse pointer viewer parameter targets fit the small viewport',async({browser},info)=>{
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
 const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const built=buildSecDashboard();
 await seedApp(page,{...defaultSeed(),...built.files,'dashboards/d1.json':JSON.stringify(built.dashboard)},'/?viewer=d1');
 expect(await page.evaluate(()=>matchMedia('(pointer:coarse)').matches)).toBe(true);
 await facts(page).getByRole('button',{name:/^Company:/}).click();
 const popup=page.getByRole('dialog',{name:'Company values'});const bounds=(await popup.boundingBox())!;
 expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(390);
 for(const name of ['All','Clear','Apply'])expect((await popup.getByRole('button',{name,exact:true}).boundingBox())!.height).toBeGreaterThanOrEqual(44);
 await page.screenshot({path:info.outputPath('coarse-pointer.png')});expect(errors).toEqual([]);await context.close();
});
