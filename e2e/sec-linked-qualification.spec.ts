// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {test, expect, type Page} from '@playwright/test';
import type {DatasetRow} from '../src/lib/widgetData/types';
import type {Revision, SubsetBatch} from '../src/lib/tableExecution/types';
import {seedApp, defaultSeed} from './fixtures';
import {buildSecDashboard} from './fixtures/sec-statements/fixtureBuilder';

type Delivery = {status:string; rows:DatasetRow[]; batches:SubsetBatch[]; active:Revision; sourceRevision?:Revision};
const card = (page:Page,title:string) => page.locator('.widget-card').filter({has:page.locator('header').getByText(title,{exact:true})});
const facts = (page:Page) => card(page,'SEC company facts');
const chart = (page:Page) => card(page,'Selected line — FY2024');
const plot = (page:Page) => chart(page).locator('.js-plotly-plot');
async function ys(page:Page):Promise<unknown[][]> {
 return plot(page).evaluateAll(elements=>elements.flatMap(el=>(el as unknown as {data?:{y:unknown[]}[]}).data?.map(trace=>trace.y)??[]));
}
async function snapshot(page:Page):Promise<Record<string,Delivery>> {
 return page.evaluate(async()=>{
  const path='/src/stores/tableExecutionStore.ts';
  const store=((await import(path)) as typeof import('../src/stores/tableExecutionStore')).tableExecutionStore;
  await store.settled('d1');
  const result:Record<string,Delivery>={};
  for(const id of ['facts','statement','usd-lines','raw']) {
   const view=store.readView('d1',id);if(!view.active)throw Error(JSON.stringify(view));
   const executor=store.readExecutor('d1',id)!;const signal=new AbortController().signal;
   const root=await executor.rows(view.active,{groupPath:[],offset:0,limit:100},signal);
   const rows=[...root.rows];for(const group of root.groups)rows.push(...(await executor.rows(view.active,{groupPath:group.path,offset:0,limit:100},signal)).rows);
   const batches=[];for await(const batch of executor.presented(view.active,signal))batches.push(batch);
   result[id]={status:view.status,rows,batches,active:view.active,sourceRevision:view.sourceRevision};
  }
  return result;
 });
}
async function chooseCompanies(page:Page, companies:string[]) {
 await facts(page).getByRole('button',{name:/^Company:/}).click();
 const popup=page.getByRole('dialog',{name:'Company values'});
 for(const company of ['CIK:0001045810','CIK:0001652044'])await popup.getByLabel(company,{exact:true}).setChecked(companies.includes(company));
 await popup.getByRole('button',{name:'Apply'}).click();
}
const pageErrors=new WeakMap<Page,string[]>();
test.beforeEach(async({page})=>{
 page.setDefaultTimeout(10000);await page.setViewportSize({width:1600,height:1100});
 const errors:string[]=[];pageErrors.set(page,errors);page.on('pageerror',error=>errors.push(error.stack??error.message));
 const built=buildSecDashboard();await seedApp(page,{...defaultSeed(),...built.files,'dashboards/d1.json':JSON.stringify(built.dashboard)});
 const engine=await page.evaluate(async()=>{const path='/src/lib/tableExecution/rust/providerFactory.ts';return ((await import(path)) as typeof import('../src/lib/tableExecution/rust/providerFactory')).resolveTableEngine();});
 expect(engine).toBe(process.env.VITE_TABLE_ENGINE??'typescript');
 await expect.poll(()=>ys(page)).toEqual([[60922000000]]);
});
test.afterEach(async({page},info)=>{
 await info.attach('public-worker-deliveries',{body:JSON.stringify(await snapshot(page),null,2),contentType:'application/json'});
 await info.attach('page-errors',{body:JSON.stringify(pageErrors.get(page)),contentType:'application/json'});
 expect(pageErrors.get(page)).toEqual([]);
});
test('company switch, row checkboxes, explicit empty, USD eligibility and clear selection',async({page})=>{
 expect((await snapshot(page)).facts.rows).toHaveLength(30);
 await chooseCompanies(page,['CIK:0001652044']);
 await expect.poll(async()=>(await snapshot(page)).facts.rows.length).toBe(14);
 expect((await snapshot(page)).facts.rows.every(row=>row.values.company==='CIK:0001652044')).toBe(true);
 await expect.poll(()=>ys(page)).toEqual([[350018000000]]);
 const statement=card(page,'Verified SEC statement');
 await statement.getByRole('button',{name:'Expand Income statement',exact:true}).click();
 const row=(label:string)=>statement.getByRole('row').filter({has:page.getByText(label,{exact:true})});
 await row('Revenue (USD)').getByRole('checkbox').click();
 await expect(row('Revenue (USD)').getByRole('checkbox')).not.toBeChecked();
 await expect.poll(async()=>(await ys(page)).flat().length).toBe(0);
 expect((await snapshot(page)).statement.batches.flatMap(batch=>batch.rows)).toEqual([]);
 await row('Cost of revenue').getByRole('checkbox').click();await expect.poll(()=>ys(page)).toEqual([[146306000000]]);
 await chooseCompanies(page,['CIK:0001045810']);await expect.poll(()=>ys(page)).toEqual([[16621000000]]);
 expect((await snapshot(page)).facts.rows).toHaveLength(30);
 await statement.getByRole('button',{name:'Clear selection',exact:true}).click();await expect.poll(async()=>(await ys(page)).flat().length).toBe(13);
 await statement.getByRole('button',{name:'Expand Per-share and ratios',exact:true}).click();
 await row('Diluted EPS').getByRole('checkbox').click();await expect.poll(async()=>(await ys(page)).flat().length).toBe(0);
 expect((await snapshot(page))['usd-lines'].batches.flatMap(batch=>batch.rows)).toEqual([]);
 await statement.getByRole('button',{name:'Clear selection',exact:true}).click();
 await statement.getByRole('button',{name:'Expand Income statement',exact:true}).click();
 await row('Revenue (USD)').getByRole('checkbox').click();await expect.poll(()=>ys(page)).toEqual([[60922000000]]);
});
test('mixed companies deliver a scope error and never an aggregate numeric revenue',async({page},info)=>{
 const before=await snapshot(page);const priorFigure=await ys(page);
 await chooseCompanies(page,['CIK:0001045810','CIK:0001652044']);
 await expect.poll(async()=>(await snapshot(page)).facts.rows.length).toBe(44);
 const mixed=await snapshot(page);
 const revenue=mixed.statement.rows.find(row=>row.groupPath?.some(member=>String(member.value).endsWith('/line/revenue')))!;
 expect(revenue).toBeDefined();expect(revenue.cellErrors).toBeTruthy();
 const valueColumn=Object.keys(revenue.values).find(key=>key.includes('FY2024')&&key.endsWith('/value'))!;
 expect(revenue.values[valueColumn]).toBe('#ERROR');expect(revenue.cellErrors![valueColumn]).toMatchObject({code:'scope'});
 const preview=revenue.cellErrors![valueColumn].recordPreview??[];expect(preview.length).toBeGreaterThan(0);expect(preview.every(id=>mixed.facts.rows.some(row=>row.id===id))).toBe(true);
 expect(Object.values(revenue.values)).not.toContain(410940000000);
 await expect.poll(async()=>(await ys(page)).flat().includes(410940000000)).toBe(false);
 if((await ys(page)).flat().some(value=>typeof value==='number')) {
  await expect(chart(page).getByText(/showing completed data \(stale\)/)).toBeVisible();
  expect(await ys(page)).toEqual(priorFigure);
  expect(mixed['usd-lines'].active).not.toEqual(before['usd-lines'].active);
 }
 await info.attach('prior-and-mixed-deliveries',{body:JSON.stringify({before,mixed},null,2),contentType:'application/json'});
});
test('company Clear removes completed numeric chart and restoring NVDA restores original facts',async({page},info)=>{
 await facts(page).getByRole('button',{name:/^Company:/}).click();
 await page.getByRole('dialog',{name:'Company values'}).getByRole('button',{name:'Clear',exact:true}).click();
 await expect.poll(async()=>(await snapshot(page)).facts.rows.length).toBe(0);
 expect((await snapshot(page)).facts.batches.flatMap(batch=>batch.rows)).toEqual([]);
 await expect.poll(async()=>(await ys(page)).flat().filter(value=>typeof value==='number').length).toBe(0);
 await info.attach('successful-empty-delivery',{body:JSON.stringify({views:await snapshot(page),visibleChartValues:await ys(page)},null,2),contentType:'application/json'});
 await chooseCompanies(page,['CIK:0001045810']);
 await expect.poll(async()=>(await snapshot(page)).facts.rows.length).toBe(30);
 await expect.poll(()=>ys(page)).toEqual([[60922000000]]);
});
test('sibling drilldown preserves original source trace with exact company, line and period scope',async({page})=>{
 const original=(await snapshot(page)).raw;
 expect(original.rows).toHaveLength(1);
 expect(original.rows[0].values).toMatchObject({company:'CIK:0001045810',report_start:'2023-01-30',report_end:'2024-01-28',item:'statement/sec-nvda-reference/1.0.0/line/revenue',value:60922000000});
 expect(original.rows[0].values.sec_source_row_id).toMatch(/^sec:nvda:/);
 expect(original.rows[0].id).not.toBe(original.rows[0].values.sec_source_row_id);
 await chooseCompanies(page,['CIK:0001652044']);await expect.poll(async()=>(await snapshot(page)).raw.rows.length).toBe(0);
 await chooseCompanies(page,['CIK:0001045810']);await expect.poll(async()=>(await snapshot(page)).raw.rows.length).toBe(1);
});
