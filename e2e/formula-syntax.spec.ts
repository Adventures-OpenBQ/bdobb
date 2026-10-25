// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from '@playwright/test';
import { seedCards, read } from './fixtures';
import { pivotValueKey } from '../src/lib/pivotKeys';
const file='00000000-0000-0000-0000-000000000098.csv';
const model={schemaVersion: 1, params: { promotePage: true, filters: [] }, enabled: true,categories:[{id:'scenario',name:'Scenario',sourceFieldId:'Scenario',transform:'native'}],measures:[{id:'revenue-total',sourceFieldId:'Revenue',aggregation:'sum'},{id:'net-total',sourceFieldId:'Net income',aggregation:'sum'}],formulas:[],layout:{rows:['scenario'],columns:[], values: []},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:false}};
for(const variant of [{theme:'dark',width:1280},{theme:'light',width:1280},{theme:'dark',width:390},{theme:'light',width:390},{theme:'dark',width:1280,cramped:true},{theme:'light',width:1280,cramped:true},{theme:'dark',width:390,coarse:true}])test.describe(`touch=${!!variant.coarse}, cramped=${!!variant.cramped}, ${variant.theme} ${variant.width}`,()=>{test.use({hasTouch:!!variant.coarse});test(`canonical formula editor and actual worker in ${variant.theme} at ${variant.width}px${variant.cramped?' cramped':''}`,async({page},testInfo)=>{
 await page.setViewportSize({width:variant.width,height:variant.width===390?844:800});
 await seedCards(page,[{id:'root',widgetId:'local_table',backendId:'builtin',params:{file},layout:{x:0,y:0,w:40,h:variant.cramped?10:24},tableDefinition:{search:'',table:{},analytical:model}}],{[`files/${file}`]:'Revenue,Net income,Scenario\n10,3,Actual\n20,4,Budget\n','settings.json':JSON.stringify({theme:variant.theme})});
 const card=page.locator('.widget-card');
 const placeAggregate=async(name:string)=>{await card.getByRole('tab',{name:'Arrange',exact:true}).click();await card.locator('[data-list="available"]').getByRole('button',{name,exact:true}).click();await page.getByRole('menuitem',{name:'Move to Data Columns',exact:true}).click();await expect.poll(async()=>{const saved=JSON.parse((await read(page,'dashboards/d1.json'))!).tabs[0].cards[0].tableDefinition.analytical;return saved.layout.values.includes(saved.formulas.find((f:{name:string})=>f.name===name)?.id);}).toBe(true);await card.getByRole('tab',{name:'Formulas',exact:true}).click();};await expect(card.getByRole('button',{name:'Expand Actual',exact:true})).toBeVisible();
 await card.getByRole('button',{name:'Pivot',exact:true}).click();await card.getByRole('tab',{name:'Formulas',exact:true}).click();
 if(variant.width===390)await expect(card.locator('.pivot-drawer')).toHaveAttribute('data-orientation','horizontal');
 await expect(card.getByRole('button',{name:'Insert Revenue',exact:true})).toBeVisible();
 await expect(card.getByRole('button',{name:'Insert [Net income]',exact:true})).toBeVisible();
 await expect(card.getByRole('button',{name:/· Source|· Measure|Revenue — Total/})).toHaveCount(0);
 await card.getByLabel('Formula name',{exact:true}).fill('Mixed scopes');
 await card.getByRole('button',{name:'Insert Revenue',exact:true}).click();
 const expression=card.getByRole('textbox',{name:'Expression',exact:true});await expression.fill('Revenue + SUM()');
 await expression.evaluate(el=>{const input=el as HTMLTextAreaElement;input.setSelectionRange(input.value.length-1,input.value.length-1);});
 await card.getByRole('button',{name:'Insert Revenue',exact:true}).click();await expect(expression).toHaveValue('Revenue + SUM(Revenue)');
 await card.locator('.pivot-drawer-panel:not([hidden])').screenshot({path:testInfo.outputPath('canonical-formulas-editor.png')});await card.screenshot({path:testInfo.outputPath('whole-card-formulas.png')});
 const save=card.getByRole('button',{name:'Save formula',exact:true});await expect(card.locator('.pivot-drawer-panel:not([hidden]) .pivot-drawer-foot').getByRole('button',{name:'Save formula',exact:true})).toBeVisible();await save.scrollIntoViewIfNeeded();await expect(save).toBeInViewport();
 if(variant.width===390)await card.locator('.pivot-drawer-panel:not([hidden])').screenshot({path:testInfo.outputPath('mobile-save-visible.png')});
 await save.click();
 await expect.poll(async()=>JSON.parse((await read(page,'dashboards/d1.json'))!).tabs[0].cards[0].tableDefinition.analytical.formulas[0]?.ast).toEqual({kind:'binary',operator:'+',left:{kind:'reference',target:'measure',id:'revenue-total'},right:{kind:'call',function:'sum',args:[{kind:'reference',target:'field',id:'Revenue'}]}});
 await placeAggregate('Mixed scopes');
 await card.locator('.pivot-drawer-panel:not([hidden])').getByRole('button',{name:'Done',exact:true}).click();
 await expect(card.getByRole('cell',{name:'40',exact:true})).toBeVisible();await expect(card.locator('tfoot')).toContainText('60');
 await card.getByRole('button',{name:'Pivot',exact:true}).click();await card.getByRole('tab',{name:'Formulas',exact:true}).click();
 await expect(card.getByRole('button',{name:'Mixed scopes',exact:true})).toHaveAttribute('aria-pressed','true');await card.locator('.pivot-drawer-panel:not([hidden]), .pivot-drawer-panel:not([hidden]) .pivot-drawer-body').evaluateAll(els=>els.forEach(el=>{el.scrollTop=0;}));const savedFormula=card.getByRole('button',{name:'Mixed scopes',exact:true});await expect(savedFormula).toBeInViewport();if(variant.coarse){await expect(savedFormula).toHaveCSS('min-height','44px');expect((await savedFormula.boundingBox())!.height).toBeGreaterThanOrEqual(44);}await savedFormula.focus();await savedFormula.press('Enter');await expect(expression).toHaveValue('Revenue + SUM(Revenue)');await card.screenshot({path:testInfo.outputPath('saved-formula-list.png')});await card.getByRole('button',{name:'New formula',exact:true}).click();await card.getByLabel('Formula name',{exact:true}).fill('Actual revenue');await expression.fill('Revenue');
 await card.getByRole('combobox',{name:'Comparison category',exact:true}).selectOption('scenario');await card.getByRole('button',{name:'Insert Actual',exact:true}).click();await expect(expression).toHaveValue('Revenue[Scenario=Actual]');
 await card.locator('.pivot-drawer-panel:not([hidden]), .pivot-drawer-panel:not([hidden]) .pivot-drawer-body').evaluateAll(els=>els.forEach(el=>{el.scrollTop=el.scrollHeight;}));await card.locator('.pivot-drawer-panel:not([hidden])').screenshot({path:testInfo.outputPath('member-pills-footer.png')});await expect(save).toBeInViewport();await expect(card.getByRole('button',{name:'Insert Actual',exact:true})).toBeInViewport();const footerBounds=await save.evaluate(el=>{const button=el.getBoundingClientRect();const foot=el.closest('.pivot-drawer-foot')!.getBoundingClientRect();return {buttonBottom:button.bottom,footBottom:foot.bottom,height:button.height};});expect(footerBounds.buttonBottom).toBeLessThanOrEqual(footerBounds.footBottom+1);if(variant.coarse)expect(footerBounds.height).toBeGreaterThanOrEqual(44);const bounds=await card.locator('.pivot-drawer-panel:not([hidden])').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));expect(bounds.scroll).toBeLessThanOrEqual(bounds.width+1);await save.click();
 await expect.poll(async()=>JSON.parse((await read(page,'dashboards/d1.json'))!).tabs[0].cards[0].tableDefinition.analytical.formulas.find((f:{name:string})=>f.name==='Actual revenue')?.ast).toEqual({kind:'member',value:{kind:'reference',target:'measure',id:'revenue-total'},selectors:[{categoryId:'scenario',memberKey:pivotValueKey('Actual')}]});
 await placeAggregate('Actual revenue');
 await card.locator('.pivot-drawer-panel:not([hidden])').getByRole('button',{name:'Done',exact:true}).click();await expect(card.locator('tfoot')).toContainText('10');
});
});
