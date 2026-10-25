// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { seedApp, defaultSeed, read } from './fixtures';
const dashboard=readFileSync('e2e/fixtures/pivot-drawer/dashboard.json','utf8');
const geometryDashboard=JSON.parse(dashboard);
// Unused cross-company FQ warnings have a separate evidence test below.
geometryDashboard.tabs[0].cards[0].tableDefinition.analytical.categories=geometryDashboard.tabs[0].cards[0].tableDefinition.analytical.categories.filter((c:{id:string})=>c.id!=='c_fq');
const csv=readFileSync('e2e/fixtures/pivot-drawer/fundamentals_q.csv','utf8');
for(const theme of ['dark','light'])test(`drawer responsive shell in ${theme}`,async({page},testInfo)=>{
 await page.setViewportSize({width:1440,height:1000});
 await seedApp(page,{...defaultSeed(),'dashboards/d1.json':JSON.stringify(geometryDashboard),'files/00000000-0000-0000-0000-000000000001.csv':csv,'settings.json':JSON.stringify({theme})});
 const card=page.locator('.widget-card');const body=card.locator('.card-body');const drawer=card.locator('.pivot-drawer');
 await expect(card.getByRole('columnheader',{name:/revenue/}).first()).toBeVisible();
 await expect(card.getByRole('button',{name:/^Expand /}).first()).toBeVisible();
 await body.screenshot({path:testInfo.outputPath('01-closed.png')});
 await card.getByRole('button',{name:'Pivot',exact:true}).click();
 await expect(drawer).toHaveAttribute('data-mode','split');await expect(drawer).toHaveAttribute('data-orientation','vertical');
 for(const list of ['available','rows','columns','values'])await expect(drawer.locator(`[data-list="${list}"]`)).toBeVisible();
 await expect(card.getByRole('button',{name:/^Expand /}).first()).toBeVisible();
 await body.screenshot({path:testInfo.outputPath('02-arrange-split.png')});
 await card.evaluate(el=>{(el as HTMLElement).style.height='900px';});
 await expect(drawer).not.toHaveAttribute('data-short','');await expect(drawer.locator('.pivot-drawer-panel:not([hidden]) .pivot-drawer-hint')).toBeVisible();
 await body.screenshot({path:testInfo.outputPath('02b-arrange-tall.png')});
 await card.getByRole('tab',{name:'Formulas',exact:true}).click();await expect(drawer).toHaveAttribute('data-mode','fill');await expect(card.locator('.table-execution-layout')).toBeHidden();
 await body.screenshot({path:testInfo.outputPath('03-formulas-fill.png')});
 await card.getByRole('tab',{name:'Categories',exact:true}).click();await card.getByLabel('Category name',{exact:true}).fill('Retained category draft');
 await card.getByRole('tab',{name:'Formulas',exact:true}).click();await card.getByRole('tab',{name:'Categories',exact:true}).click();await expect(card.getByLabel('Category name',{exact:true})).toHaveValue('Retained category draft');
 await card.getByRole('button',{name:'Save category',exact:true}).click();
 await expect.poll(async()=>JSON.parse((await read(page,'dashboards/d1.json'))!).tabs[0].cards[0].tableDefinition.analytical.categories[0].name).toBe('Retained category draft');
 await expect(card.getByRole('button',{name:'Save category',exact:true})).toBeEnabled();
 // Set actual card geometry after the grid's layout; resize observers must react.
 await card.evaluate(el=>{(el as HTMLElement).style.height='300px';});
 await card.getByRole('tab',{name:'Arrange',exact:true}).click();await expect(drawer).toHaveAttribute('data-mode','fill');await expect(drawer).toHaveAttribute('data-short','');
 await body.screenshot({path:testInfo.outputPath('05-cramped-short.png')});
 await card.locator('.pivot-footer-strip').click();await expect(drawer).toBeHidden();await expect(card.locator('.table-execution-layout')).toBeVisible();await expect(card.locator('.table-execution-layout')).toBeFocused();
 await card.evaluate(el=>{(el as HTMLElement).style.width='390px';(el as HTMLElement).style.height='600px';});
 await card.getByRole('button',{name:'Pivot',exact:true}).click();await expect(drawer).toHaveAttribute('data-orientation','horizontal');
 const strip=drawer.locator('.pivot-drawer-strip');await expect(strip).toHaveAttribute('data-overflow-end','');await expect(strip.locator('[data-dir="start"]')).toBeHidden();
 await body.screenshot({path:testInfo.outputPath('06-mobile-arrange.png')});
 for(const list of ['available','rows','columns','values']) {const target=drawer.locator(`.pivot-column:has([data-list="${list}"]) h3`);await target.scrollIntoViewIfNeeded();await expect(target).toBeInViewport();await expect(target.locator('.pivot-column-count')).toHaveText(/\d+/);}
 await expect(drawer.locator('[data-list="available"]')).toHaveCSS('max-height','none');
 await body.screenshot({path:testInfo.outputPath('06b-mobile-arrange-scrolled.png')});
 await card.evaluate(el=>{(el as HTMLElement).style.height='300px';});await expect(drawer).toHaveAttribute('data-mode','fill');
 await drawer.locator('.pivot-drawer-panel:not([hidden])').evaluate(el=>{el.scrollTop=0;});await body.screenshot({path:testInfo.outputPath('06c-mobile-arrange-fill.png')});
 await drawer.locator('.pivot-column:has([data-list="values"]) h3').scrollIntoViewIfNeeded();await expect(drawer.locator('.pivot-column:has([data-list="values"]) h3')).toBeInViewport();await expect(drawer.getByRole('button',{name:'Done',exact:true})).toBeVisible();
 await body.screenshot({path:testInfo.outputPath('06d-mobile-arrange-fill-scrolled.png')});
 await card.evaluate(el=>{(el as HTMLElement).style.height='600px';});

 await strip.locator('[data-dir="end"]').click();await expect(strip).toHaveAttribute('data-overflow-start','');
 await strip.locator('[role="tablist"]').evaluate(el=>{el.scrollLeft=el.scrollWidth;});await expect(strip).not.toHaveAttribute('data-overflow-end','');
 await card.getByRole('tab',{name:'Formulas',exact:true}).click();await expect(drawer).toHaveAttribute('data-mode','fill');await body.screenshot({path:testInfo.outputPath('12b-mobile-formulas.png')});
 await card.getByLabel('Formula name',{exact:true}).fill('Mobile saved Net margin');const mobileSave=card.getByRole('button',{name:'Save formula',exact:true});await mobileSave.scrollIntoViewIfNeeded();await expect(mobileSave).toBeInViewport();await expect(mobileSave).toBeEnabled();await body.screenshot({path:testInfo.outputPath('12c-mobile-formula-save-visible.png')});await mobileSave.click();
 await expect.poll(async()=>JSON.parse((await read(page,'dashboards/d1.json'))!).tabs[0].cards[0].tableDefinition.analytical.formulas.find((f:{id:string})=>f.id==='f_margin')?.name).toBe('Mobile saved Net margin');await expect(mobileSave).toBeEnabled();await body.screenshot({path:testInfo.outputPath('12d-mobile-formula-saved.png')});
 await card.getByRole('tab',{name:'Categories',exact:true}).click();await expect(card.getByLabel('Category name',{exact:true})).toHaveValue('Retained category draft');
 await card.getByRole('tab',{name:'Category filters',exact:true}).click();await body.screenshot({path:testInfo.outputPath('03-category-filters-mobile.png')});await drawer.getByRole('button',{name:'Done',exact:true}).click();await body.screenshot({path:testInfo.outputPath('11-mobile-closed.png')});
});

test('original fiscal warnings remain visible and are measured as card chrome',async({page},testInfo)=>{
 await page.setViewportSize({width:1440,height:1000});
 await seedApp(page,{...defaultSeed(),'dashboards/d1.json':dashboard,'files/00000000-0000-0000-0000-000000000001.csv':csv});
 const card=page.locator('.widget-card');await expect(card.getByText(/Fiscal periods do not align/).first()).toBeVisible();await card.getByRole('button',{name:'Pivot',exact:true}).click();
 await card.locator('.card-body').screenshot({path:testInfo.outputPath('fiscal-warning-evidence.png')});
 await expect(card.getByText('Table authoring session closed.')).toHaveCount(0);
});
for(const theme of ['dark','light'])test(`pivot-off toolbar state and idle contrast in ${theme}`,async({page},testInfo)=>{
 const off=JSON.parse(dashboard);delete off.tabs[0].cards[0].tableDefinition.analytical;
 await seedApp(page,{...defaultSeed(),'dashboards/d1.json':JSON.stringify(off),'files/00000000-0000-0000-0000-000000000001.csv':csv,'settings.json':JSON.stringify({theme})});
 const toggle=page.getByRole('button',{name:'Pivot',exact:true});await expect(toggle).toHaveAttribute('data-pivot','off');
 const contrast=await toggle.evaluate(el=>{
  const style=getComputedStyle(el);const bg=getComputedStyle(el.closest('.widget-card')!).backgroundColor;
  const luminance=(color:string)=>{const rgb=color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
  const a=luminance(style.color),b=luminance(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
 });
 expect(contrast).toBeGreaterThanOrEqual(3);await toggle.click();await expect(toggle).toHaveAttribute('data-pivot','off');await expect(toggle).toHaveAttribute('aria-expanded','true');
 await page.locator('.widget-card').screenshot({path:testInfo.outputPath('07-pivot-off.png')});await testInfo.attach('idle-icon-contrast',{body:JSON.stringify({theme,contrast}),contentType:'application/json'});
});
for(const theme of ['dark','light'])test(`supplied CSS harness colour tokens match the actual drawer in ${theme}`,async({page,context},testInfo)=>{
 await page.setViewportSize({width:1440,height:1200});await seedApp(page,{...defaultSeed(),'dashboards/d1.json':JSON.stringify(geometryDashboard),'files/00000000-0000-0000-0000-000000000001.csv':csv,'settings.json':JSON.stringify({theme})});
 const card=page.locator('.widget-card');await expect(card.getByRole('button',{name:/^Expand /}).first()).toBeVisible();await card.evaluate(el=>{(el as HTMLElement).style.width='900px';(el as HTMLElement).style.height='900px';});await card.getByRole('button',{name:'Pivot',exact:true}).click();await expect(card.locator('.pivot-drawer')).not.toHaveAttribute('data-short','');
 const reference=await context.newPage();await reference.goto('/e2e/fixtures/pivot-css-reference/02-arrange-split.html');await reference.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
 const styles=()=>Object.fromEntries(['.pivot-drawer','.pivot-drawer-tab[aria-selected="false"]','.pivot-drawer-head','.pivot-drawer-title','.pivot-drawer-hint','.pivot-drawer-body','.pivot-drawer-foot','.pivot-drawer-done','.pivot-list','.pivot-pill:not([data-kind="formula"])','.pivot-pill[data-kind="formula"]','.pivot-footer-strip'].map(selector=>{const style=getComputedStyle(document.querySelector(selector)!);return [selector,/* Compact density (2026-10-06) deliberately departs from the harness's sizes and padding; palette and shape stay its contract; rail dividers moved onto the tabs' inline edges. */Object.fromEntries(['background-color','color','border-top-color','border-bottom-color','border-radius'].map(key=>[key,style.getPropertyValue(key)]))];}));
 const actual=await page.evaluate(styles);const expected=await reference.evaluate(styles);expect(actual).toEqual(expected);
 await testInfo.attach('supplied-css-comparison',{body:JSON.stringify({theme,actual,expected},null,2),contentType:'application/json'});
 await card.locator('.card-body').screenshot({path:testInfo.outputPath('actual-frame.png')});await reference.locator('.card-body').screenshot({path:testInfo.outputPath('supplied-frame.png')});await reference.close();
});

test('coarse pointer targets and touch splitter preserve the measured fit policy',async({browser},testInfo)=>{
 const context=await browser.newContext({hasTouch:true,viewport:{width:1440,height:1100}});const page=await context.newPage();
 try {
  await seedApp(page,{...defaultSeed(),'dashboards/d1.json':JSON.stringify(geometryDashboard),'files/00000000-0000-0000-0000-000000000001.csv':csv});
  const card=page.locator('.widget-card');await expect(card.getByRole('button',{name:/^Expand /}).first()).toBeVisible();await card.evaluate(el=>{(el as HTMLElement).style.height='900px';});await card.getByRole('button',{name:'Pivot',exact:true}).click();
  const drawer=card.locator('.pivot-drawer');const splitter=card.getByRole('separator',{name:'Resize pivot drawer'});await expect(drawer).toHaveAttribute('data-mode','split');
  expect(await page.evaluate(()=>matchMedia('(pointer: coarse)').matches)).toBe(true);
  await expect(splitter).toHaveCSS('height','12px');
  for(const button of [drawer.getByRole('button',{name:'Done',exact:true}),drawer.getByRole('button',{name:'Close pivot drawer'}),card.locator('.pivot-footer-strip')])expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const box=(await splitter.boundingBox())!;const client=await context.newCDPSession(page);const point={x:box.x+box.width/2,y:box.y+box.height/2};
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,y:point.y-40}]});await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(splitter).not.toHaveAttribute('aria-valuenow','40');await expect(drawer).toHaveAttribute('data-mode','split');await expect(card.getByRole('button',{name:/^Expand /}).first()).toBeVisible();
  await card.locator('.card-body').screenshot({path:testInfo.outputPath('coarse-touch-split.png')});
  await card.evaluate(el=>{(el as HTMLElement).style.height='350px';});await expect(drawer).toHaveAttribute('data-mode','fill');await expect(card.locator('.table-execution-layout')).toBeHidden();
  await card.locator('.pivot-footer-strip').click();await expect(card.locator('.table-execution-layout')).toBeFocused();
 } finally {await context.close();}
});

test('opening before the real worker is ready remeasures its first table rows',async({page},testInfo)=>{
 let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let requested=false;
 await page.route('**/*table.worker*',async route=>{requested=true;await held;await route.continue();});
 await seedApp(page,{...defaultSeed(),'dashboards/d1.json':JSON.stringify(geometryDashboard),'files/00000000-0000-0000-0000-000000000001.csv':csv});
 const card=page.locator('.widget-card');await expect.poll(()=>requested).toBe(true);await card.getByRole('button',{name:'Pivot',exact:true}).click();const drawer=card.locator('.pivot-drawer');await expect(drawer).toHaveAttribute('data-mode','fill');release();
 await expect(drawer).toHaveAttribute('data-mode','split');await expect(card.getByRole('button',{name:/^Expand /}).first()).toBeVisible();await card.locator('.card-body').screenshot({path:testInfo.outputPath('early-open-ready.png')});
});


test('settled dismiss checkbox and keyboard Inspect Show formula keep live behavior and visible focus',async({page},testInfo)=>{
 await seedApp(page,{...defaultSeed(),'dashboards/d1.json':JSON.stringify(geometryDashboard),'files/00000000-0000-0000-0000-000000000001.csv':csv});
 const card=page.locator('.widget-card');const drawer=card.locator('.pivot-drawer');await expect(card.getByRole('button',{name:/^Expand /}).first()).toBeVisible();await card.getByRole('button',{name:'Pivot',exact:true}).click();await expect(drawer).toHaveAttribute('data-mode','split');
 const checkbox=card.getByRole('checkbox',{name:'Dismiss on table click'});await expect(checkbox).toBeChecked();await checkbox.uncheck();await expect(checkbox).not.toBeChecked();
 const cell=card.locator('tbody tr:not(.table-spacer) td:last-child').first();await cell.click();await expect(drawer).toBeVisible();await checkbox.check();await expect(checkbox).toBeChecked();await cell.click();await expect(drawer).toBeHidden();
 await card.getByRole('button',{name:'Pivot',exact:true}).click();await card.getByRole('tab',{name:'Saved',exact:true}).click();const show=card.getByRole('button',{name:'Show formula Net margin',exact:true});await show.focus();await show.press('Enter');
 const formulas=card.getByRole('tab',{name:'Formulas',exact:true});await expect(formulas).toBeFocused();await expect(card.getByLabel('Formula name',{exact:true})).toHaveValue('Net margin');await expect(formulas).toBeVisible();await formulas.press('Escape');await expect(card.getByRole('tab',{name:'Arrange',exact:true})).toBeFocused();await expect(drawer).toHaveAttribute('data-mode','split');
 await card.locator('.card-body').screenshot({path:testInfo.outputPath('keyboard-show-formula-escape-arrange.png')});
});

for(const theme of ['dark','light'])test(`Task4B mixed values drag and Pivot on persist in ${theme}`,async({page},testInfo)=>{
 await page.setViewportSize({width:1440,height:1000});
 await seedApp(page,{...defaultSeed(),'dashboards/d1.json':JSON.stringify(geometryDashboard),'files/00000000-0000-0000-0000-000000000001.csv':csv,'settings.json':JSON.stringify({theme})});
 const card=page.locator('.widget-card');await expect(card.getByRole('columnheader',{name:/revenue/}).first()).toBeVisible();
 await card.getByRole('button',{name:'Pivot',exact:true}).click();
 const data=card.locator('[data-list="values"]'),margin=data.getByRole('button',{name:'Net margin',exact:true}),revenue=data.getByRole('button',{name:/^revenue — Total$/});
 await expect(margin).toHaveAttribute('title','Net margin');await margin.dragTo(revenue);
 await expect.poll(async()=>JSON.parse((await read(page,'dashboards/d1.json'))!).tabs[0].cards[0].tableDefinition.analytical.layout.values[0]).toBe('f_margin');
 await expect(data.locator('.pivot-pill').first()).toHaveAttribute('aria-label','Net margin');
 await data.screenshot({path:testInfo.outputPath('task4b-arrange-values.png')});
 await card.getByRole('switch',{name:'Pivot on'}).click();await expect(card.getByRole('switch',{name:'Pivot on'})).not.toBeChecked();await expect(card.getByRole('switch',{name:'Pivot on'})).toBeEnabled();
 await expect(card.getByRole('button',{name:'Pivot',exact:true})).toHaveAttribute('data-pivot','off');
 await expect(card.getByRole('button',{name:/^Expand /})).toHaveCount(0);
 await card.locator('.card-body').screenshot({path:testInfo.outputPath('task4b-pivot-off.png')});
 const saved=JSON.parse((await read(page,'dashboards/d1.json'))!);expect(saved.tabs[0].cards[0].tableDefinition.analytical.enabled).toBe(false);
 const persistedFiles=await page.evaluate(()=>Object.fromEntries(window.__bdobb!.list!().map(path=>[path,window.__bdobb!.read!(path)!])));persistedFiles['files/00000000-0000-0000-0000-000000000001.csv']=csv;
 await seedApp(page,persistedFiles);await card.getByRole('button',{name:'Pivot',exact:true}).click();await expect(card.getByRole('switch',{name:'Pivot on'})).not.toBeChecked();
 await card.getByRole('switch',{name:'Pivot on'}).click();await expect(card.getByRole('switch',{name:'Pivot on'})).toBeChecked();await expect(card.getByRole('switch',{name:'Pivot on'})).toBeEnabled();
 await expect(card.getByRole('button',{name:/^Expand /}).first()).toBeVisible();await expect(card.locator('[data-list="values"] .pivot-pill').first()).toHaveAttribute('aria-label','Net margin');
});
test('Task4B required controls retain invalid intent until explicit Inspect repair',async({page})=>{
 const invalid=JSON.parse(JSON.stringify(geometryDashboard)),raw=invalid.tabs[0].cards[0].tableDefinition.analytical;
 delete raw.enabled;delete raw.layout.values;
 await seedApp(page,{...defaultSeed(),'dashboards/d1.json':JSON.stringify(invalid),'files/00000000-0000-0000-0000-000000000001.csv':csv});
 const card=page.locator('.widget-card');await card.getByRole('button',{name:'Pivot',exact:true}).click();await card.getByRole('tab',{name:'Saved',exact:true}).click();
 await card.getByText('Advanced repair',{exact:true}).click();const draft=card.getByRole('textbox',{name:'Model repair draft',exact:true});
 await expect(draft).toBeEditable();expect(JSON.parse(await draft.inputValue()).enabled).toBeUndefined();
 const saved=geometryDashboard.tabs[0].cards[0].tableDefinition.analytical;
 await draft.fill(JSON.stringify(saved,null,2));await card.getByRole('button',{name:'Save repaired model',exact:true}).click();
 await expect.poll(async()=>JSON.parse((await read(page,'dashboards/d1.json'))!).tabs[0].cards[0].tableDefinition.analytical.enabled).toBe(true);
 await card.getByRole('tab',{name:'Arrange',exact:true}).click();await expect(card.getByRole('switch',{name:'Pivot on'})).toBeChecked();
});

for(const theme of ['dark','light'])test(`Task4B fix1 aggregation footer and true-bottom Data actions in ${theme}`,async({page},testInfo)=>{
 await page.setViewportSize({width:1440,height:1000});
 await seedApp(page,{...defaultSeed(),'dashboards/d1.json':JSON.stringify(geometryDashboard),'files/00000000-0000-0000-0000-000000000001.csv':csv,'settings.json':JSON.stringify({theme})});
 const card=page.locator('.widget-card');const drawer=card.locator('.pivot-drawer');const panel=drawer.locator('.pivot-drawer-panel:not([hidden])');const foot=panel.locator('.pivot-drawer-foot');const warning=foot.locator('.pivot-drawer-foot-warn');
 await expect(card.getByRole('columnheader',{name:/revenue/}).first()).toBeVisible();await card.getByRole('button',{name:'Pivot',exact:true}).click();
 const checkFooter=async()=>{await expect(warning).toHaveText('1 data column needs an aggregation');await expect(warning).toBeVisible();const boxes=await foot.evaluate(el=>{const rect=(node:Element)=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};return {foot:rect(el),items:Array.from(el.querySelectorAll('label,.pivot-drawer-foot-warn,.pivot-drawer-done')).map(rect),amber:getComputedStyle(el.querySelector('.pivot-drawer-foot-warn')!).color,token:getComputedStyle(el).getPropertyValue('--bd-warning').trim()};});for(const item of boxes.items){expect(item.x).toBeGreaterThanOrEqual(boxes.foot.x-1);expect(item.right).toBeLessThanOrEqual(boxes.foot.right+1);expect(item.right).toBeLessThanOrEqual(page.viewportSize()!.width+1);expect(item.y).toBeGreaterThanOrEqual(boxes.foot.y-1);expect(item.bottom).toBeLessThanOrEqual(boxes.foot.bottom+1);}expect(boxes.amber).not.toBe('rgb(255, 255, 255)');await expect(foot.getByRole('button',{name:'Done',exact:true})).toBeInViewport();await expect(foot.getByRole('switch',{name:'Pivot on'})).toBeInViewport();await expect(foot.getByRole('checkbox',{name:'Dismiss on table click'})).toBeInViewport();};
 await checkFooter();await card.screenshot({path:testInfo.outputPath('01-desktop-warning.png')});
 await card.evaluate(el=>{(el as HTMLElement).style.height='300px';});await expect(drawer).toHaveAttribute('data-short','');await checkFooter();await card.screenshot({path:testInfo.outputPath('02-cramped-warning.png')});
 await page.setViewportSize({width:390,height:844});await card.evaluate(el=>{(el as HTMLElement).style.width='326px';(el as HTMLElement).style.height='600px';});await expect(drawer).toHaveAttribute('data-orientation','horizontal');await checkFooter();
 for(const mode of ['split','fill']){
  if(mode==='fill')await card.evaluate(el=>{(el as HTMLElement).style.height='300px';});
  await expect(drawer).toHaveAttribute('data-mode',mode);
  const eps=panel.locator('[data-list="values"]').getByRole('button',{name:'eps',exact:true});await eps.scrollIntoViewIfNeeded();await expect(eps).toBeInViewport();await eps.click();await page.getByRole('menuitem',{name:'Aggregation',exact:true}).click();await expect(page.getByRole('menuitemcheckbox',{name:'Total',exact:true})).toBeInViewport();await page.screenshot({path:testInfo.outputPath(`03-mobile-${mode}-eps-action.png`)});await page.keyboard.press('Escape');
  const last=panel.locator('[data-list="values"] .pivot-pill').last();await expect(page.getByRole('menu')).toHaveCount(0);await panel.evaluate(el=>{el.scrollTop=el.scrollHeight;const body=el.querySelector('.pivot-drawer-body');if(body)body.scrollTop=body.scrollHeight;});await expect(last).toBeInViewport();
  const pillBox=(await last.boundingBox())!,footBox=(await foot.boundingBox())!;expect(pillBox.y+pillBox.height).toBeLessThanOrEqual(footBox.y+1);
  await card.screenshot({path:testInfo.outputPath(`03-mobile-${mode}-true-bottom.png`)});await last.click();const earlier=page.getByRole('menuitem',{name:'Move earlier',exact:true});await expect(earlier).toBeInViewport();await page.screenshot({path:testInfo.outputPath(`04-mobile-${mode}-bottom-action.png`)});const savedBefore=JSON.parse((await read(page,'dashboards/d1.json'))!).tabs[0].cards[0].tableDefinition.analytical.layout.values as string[];const expected=[...savedBefore];[expected[expected.length-2],expected[expected.length-1]]=[expected[expected.length-1],expected[expected.length-2]];await earlier.click();await expect.poll(async()=>JSON.parse((await read(page,'dashboards/d1.json'))!).tabs[0].cards[0].tableDefinition.analytical.layout.values).toEqual(expected);await checkFooter();
 }
 await foot.getByRole('switch',{name:'Pivot on'}).click();await expect(warning).toHaveCount(0);await expect.poll(async()=>JSON.parse((await read(page,'dashboards/d1.json'))!).tabs[0].cards[0].tableDefinition.analytical.enabled).toBe(false);
 await card.getByRole('button',{name:/Show table/}).click();await expect(card.locator('tbody')).not.toContainText('#ERROR');await card.screenshot({path:testInfo.outputPath('05-mobile-off-source-no-errors.png')});
});
