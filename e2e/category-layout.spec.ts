// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Locator } from '@playwright/test';
import { seedCards, read } from './fixtures';
const longName='A very long authored category name for regional calendar quarter interpretation and consolidated report grouping';
const longColumnName='A very long authored column category name for company-specific report grouping and consolidated company interpretations';
async function revealControl(field: Locator) {
 await field.scrollIntoViewIfNeeded();
 await field.evaluate(el=>{
  const panel=el.closest('.pivot-drawer-panel')!;const body=el.closest('.pivot-drawer-body')!;
  const owner=panel.closest('.pivot-drawer')!.hasAttribute('data-short')?panel:body;
  const head=panel.querySelector('.pivot-drawer-head')!.getBoundingClientRect();const foot=panel.querySelector('.pivot-drawer-foot')!.getBoundingClientRect();const rect=el.getBoundingClientRect();
  owner.scrollTop+=rect.top-(head.bottom+(foot.top-head.bottom-rect.height)/2);
 });
 await expect(field).toBeInViewport();
 const bounds=await field.evaluate(el=>{const panel=el.closest('.pivot-drawer-panel')!;const rect=el.getBoundingClientRect();return {top:rect.top,bottom:rect.bottom,head:panel.querySelector('.pivot-drawer-head')!.getBoundingClientRect().bottom,foot:panel.querySelector('.pivot-drawer-foot')!.getBoundingClientRect().top};});
 expect(bounds.top).toBeGreaterThanOrEqual(bounds.head-1);expect(bounds.bottom).toBeLessThanOrEqual(bounds.foot+1);
}
const file='00000000-0000-0000-0000-000000000097.csv';
const model={schemaVersion: 1, params: { promotePage: true, filters: [] }, enabled: true,categories:[{id:'scenario',name:'Scenario',sourceFieldId:'Scenario',transform:'native'},{id:'year',name:longName,sourceFieldId:'Date',transform:'Y'},{id:'company',name:longColumnName,sourceFieldId:'Company',transform:'native'}],measures:[{id:'revenue',sourceFieldId:'Revenue',aggregation:'sum'}],formulas:[],layout:{rows:['scenario','year'],columns:['company'], values: []},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:false}};
for(const variant of [{theme:'dark',width:1280},{theme:'light',width:1280},{theme:'dark',width:390},{theme:'light',width:390},{theme:'dark',width:1280,cramped:true},{theme:'light',width:1280,cramped:true},{theme:'dark',width:390,coarse:true}])test.describe(`category touch=${!!variant.coarse}, cramped=${!!variant.cramped}, ${variant.theme} ${variant.width}`,()=>{
 test.use({hasTouch:!!variant.coarse});test('prototype category layout and real worker persistence',async({page},testInfo)=>{
 await page.setViewportSize({width:variant.width,height:variant.width===390?844:800});
 await seedCards(page,[{id:'root',widgetId:'local_table',backendId:'builtin',params:{file},layout:{x:0,y:0,w:40,h:variant.cramped?10:24},tableDefinition:{search:'',table:{},analytical:model}}],{[`files/${file}`]:'Revenue,Scenario,Date,Company\n10,Actual,2024-01-10,A\n20,Budget,2025-04-10,B\n','settings.json':JSON.stringify({theme:variant.theme})});
 const card=page.locator('.widget-card');await expect(card.getByRole('button',{name:'Expand Actual',exact:true})).toBeVisible();
 if(variant.cramped)await card.evaluate(el=>{(el as HTMLElement).style.height='300px';});
 await card.getByRole('button',{name:'Pivot',exact:true}).click();await card.getByRole('tab',{name:'Categories',exact:true}).click();
 const panel=card.locator('.pivot-drawer-panel:not([hidden])');const body=panel.locator('.pivot-drawer-body');const save=panel.getByRole('button',{name:'Save category',exact:true});
 await expect(panel.locator('.pivot-drawer-foot').getByRole('button',{name:'Save category',exact:true})).toBeVisible();await expect(panel.getByRole('button',{name:'Scenario',exact:true})).toHaveAttribute('aria-pressed','true');
 if(variant.coarse){expect(await page.evaluate(()=>matchMedia('(pointer: coarse)').matches)).toBe(true);for(const button of [panel.getByRole('button',{name:'Scenario',exact:true}),panel.getByRole('button',{name:'New category',exact:true}),panel.getByRole('button',{name:'Move rows category 2 earlier'})])expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);}
 for(const name of [longName,longColumnName]){const longLabel=panel.locator('.pivot-category-grow').filter({hasText:name});await expect.soft(longLabel).toHaveAttribute('title',name,{timeout:100});const longGeometry=await longLabel.evaluate(el=>({overflow:getComputedStyle(el).overflow,client:el.clientWidth,scroll:el.scrollWidth}));expect.soft(longGeometry.overflow).toBe('hidden');await expect(panel.getByRole('button',{name,exact:true})).toBeAttached();}
 for(const owner of [panel,body,panel.locator('.pivot-category-list')]){const widths=await owner.evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));expect.soft(widths.scroll).toBeLessThanOrEqual(widths.width+1);}
 if(variant.coarse)for(const field of [panel.getByLabel('Category name',{exact:true}),...['Source field','Transformation','Position'].map(name=>panel.getByRole('combobox',{name,exact:true}))]){await revealControl(field);await expect.soft(field).toHaveCSS('min-height','44px',{timeout:100});expect.soft((await field.boundingBox())!.height).toBeGreaterThanOrEqual(44);}
 await panel.evaluate(el=>{el.scrollTop=0;});await body.evaluate(el=>{el.scrollTop=0;});
 await card.screenshot({path:testInfo.outputPath('category-top.png')});
 await panel.getByRole('button',{name:longName,exact:true}).click();await panel.getByLabel('Category name',{exact:true}).fill('Report quarter');await panel.getByRole('combobox',{name:'Transformation',exact:true}).selectOption('Q');await save.click();
 await expect.poll(async()=>JSON.parse((await read(page,'dashboards/d1.json'))!).tabs[0].cards[0].tableDefinition.analytical.categories.find((c:{id:string})=>c.id==='year')).toMatchObject({id:'year',name:'Report quarter',transform:'Q'});
 await panel.getByRole('button',{name:'Move rows category 2 earlier'}).click();await expect.poll(async()=>JSON.parse((await read(page,'dashboards/d1.json'))!).tabs[0].cards[0].tableDefinition.analytical.layout.rows).toEqual(['year','scenario']);
 await panel.getByRole('button',{name:'Done',exact:true}).click();await expect(card.getByRole('button',{name:'Expand 2024 Q1',exact:true})).toBeVisible();await expect(card.getByRole('button',{name:'Expand 2025 Q2',exact:true})).toBeVisible();expect((await card.locator('tfoot td').allTextContents()).filter(text=>/^\d+$/.test(text)).reduce((sum,text)=>sum+Number(text),0)).toBe(30);
 await card.getByRole('button',{name:'Pivot',exact:true}).click();await card.getByRole('tab',{name:'Categories',exact:true}).click();await panel.getByRole('button',{name:'Report quarter',exact:true}).click();
 await panel.getByRole('combobox',{name:'Transformation',exact:true}).selectOption('FY');await expect(panel.getByRole('combobox',{name:'Company field',exact:true})).toHaveValue('');await save.click();await expect(panel.getByRole('alert')).toContainText('explicit fiscal metadata');
 await panel.evaluate(el=>{el.scrollTop=0;});await body.evaluate(el=>{el.scrollTop=0;});const fiscalTop=await card.screenshot({path:testInfo.outputPath('category-fiscal-top.png')});
 const company=panel.getByRole('combobox',{name:'Company field',exact:true});await revealControl(company);await expect(save).toBeInViewport();await company.selectOption('Company');await save.click();await expect(panel.getByRole('alert')).toContainText('explicit fiscal metadata');await expect(company).toHaveValue('Company');
 await card.screenshot({path:testInfo.outputPath('category-company-interactive.png')});
 if(variant.coarse)for(const field of [...['Company field','Fiscal year field','Fiscal quarter field','Period start field','Period end field','Bound period kind'].map(name=>panel.getByRole('combobox',{name,exact:true})),panel.getByLabel('Fiscal metadata binding',{exact:true})]){await revealControl(field);await expect.soft(field).toHaveCSS('min-height','44px',{timeout:100});expect.soft((await field.boundingBox())!.height).toBeGreaterThanOrEqual(44);await expect(save).toBeInViewport();}
 await panel.evaluate(el=>{el.scrollTop=el.scrollHeight;});await body.evaluate(el=>{el.scrollTop=el.scrollHeight;});
 const metadata=panel.getByLabel('Fiscal metadata binding',{exact:true});await revealControl(metadata);await metadata.fill('');await expect(save).toBeInViewport();
 const scrollState=await panel.evaluate(el=>({top:el.scrollTop,height:el.scrollHeight,client:el.clientHeight}));if(variant.cramped)expect(scrollState.top).toBeGreaterThan(0);
 const fiscalLower=await card.screenshot({path:testInfo.outputPath('category-fiscal-lower.png')});if(variant.cramped)expect(fiscalLower.equals(fiscalTop)).toBe(false);
 await expect(save).toBeInViewport();const bounds=await save.evaluate(el=>{const b=el.getBoundingClientRect();const f=el.closest('.pivot-drawer-foot')!.getBoundingClientRect();return {bottom:b.bottom,foot:f.bottom,height:b.height};});expect(bounds.bottom).toBeLessThanOrEqual(bounds.foot+1);if(variant.coarse)expect(bounds.height).toBeGreaterThanOrEqual(44);
 const widths=await body.evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));expect.soft(widths.scroll).toBeLessThanOrEqual(widths.width+1);
 await testInfo.attach('category-geometry',{body:JSON.stringify({variant,bounds,widths}),contentType:'application/json'});
 });
});
