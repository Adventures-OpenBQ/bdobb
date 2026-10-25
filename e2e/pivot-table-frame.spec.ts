// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { seedApp, defaultSeed } from './fixtures';
const dashboard=JSON.parse(readFileSync('e2e/fixtures/pivot-drawer/dashboard.json','utf8'));
const csv=readFileSync('e2e/fixtures/pivot-drawer/fundamentals_q.csv','utf8');
// Keep Chromium's real scrollbar visible in visual evidence (headless hides it by default).
test.use({launchOptions:{ignoreDefaultArgs:['--hide-scrollbars']}});
const labelField='\x1egroup';
for(const theme of ['dark','light'])test(`real worker table frame in ${theme}`,async({page},testInfo)=>{
 const fixture=structuredClone(dashboard);const model=fixture.tabs[0].cards[0].tableDefinition.analytical;
 model.categories=model.categories.filter((c:{id:string})=>c.id!=='c_fq');
 model.formulas.find((f:{id:string})=>f.id==='f_var').ast.right.selectors[0].memberKey='["string","Absent budget"]';
 await page.setViewportSize({width:1440,height:1000});await seedApp(page,{...defaultSeed(),'dashboards/d1.json':JSON.stringify(fixture),'files/00000000-0000-0000-0000-000000000001.csv':csv,'settings.json':JSON.stringify({theme})});
 const card=page.locator('.widget-card');const table=card.locator('.table-execution-layout');const scroll=table.locator('.table-scroll');
 await expect(card.getByRole('button',{name:/^Expand /}).first()).toBeVisible();
 await card.evaluate(el=>{(el as HTMLElement).style.width='600px';});
 await expect(scroll).toHaveAttribute('data-overflow-right','');
 const geometry=()=>table.evaluate((el,labelField)=>{const find=(section:string)=>[...el.querySelectorAll<HTMLElement>(`${section} [data-field]`)].find(c=>c.dataset.field===labelField)!;const header=find('thead');const body=find('tbody');const total=find('tfoot');const gutter=el.querySelector<HTMLElement>('th[data-selection-gutter]')!;return {headerLeft:header.getBoundingClientRect().left,bodyLeft:body.getBoundingClientRect().left,totalLeft:total.getBoundingClientRect().left,gutterWidth:gutter.getBoundingClientRect().width,offset:parseFloat(header.style.left),bodyOffset:parseFloat(body.style.left),totalOffset:parseFloat(total.style.left),labelPinned:header.classList.contains('pin-left'),measurePinned:[...el.querySelectorAll('thead th[data-field]')].filter(c=>(c as HTMLElement).dataset.field!==labelField&&c.classList.contains('pin-left')).length};},labelField);
 const before=await geometry();expect(before.labelPinned).toBe(true);expect(before.measurePinned).toBe(0);expect(before.offset).toBeCloseTo(before.gutterWidth,1);expect(before.bodyOffset).toBe(before.offset);expect(before.totalOffset).toBe(before.offset);
 const count=await scroll.evaluate(el=>{const edge=el.getBoundingClientRect().left+el.clientLeft+el.clientWidth;return [...el.querySelectorAll('th[data-field]')].filter(c=>!c.classList.contains('pin-left')&&!c.classList.contains('pin-right')&&c.getBoundingClientRect().right>edge+1).length;});await expect(table.getByRole('button',{name:`+${count} columns →`})).toBeVisible();
 const scrollbar=await scroll.evaluate(el=>({height:getComputedStyle(el,'::-webkit-scrollbar').height,thumb:getComputedStyle(el,'::-webkit-scrollbar-thumb').backgroundColor}));await testInfo.attach('scrollbar-style',{body:JSON.stringify(scrollbar),contentType:'application/json'});
 await table.screenshot({path:testInfo.outputPath('08-member-comparison.png')});
 await scroll.evaluate(el=>el.scrollLeft=el.scrollWidth-el.clientWidth);await expect(scroll).not.toHaveAttribute('data-overflow-right');await expect(table.locator('.table-overflow-chip')).toHaveCount(0);
 const after=await geometry();expect(after.headerLeft).toBeCloseTo(before.headerLeft,1);expect(after.bodyLeft).toBeCloseTo(before.bodyLeft,1);expect(after.totalLeft).toBeCloseTo(before.totalLeft,1);expect(await table.locator('.table-total-scroll').evaluate(el=>el.scrollLeft)).toBeCloseTo(await scroll.evaluate(el=>el.scrollLeft),1);
 await table.screenshot({path:testInfo.outputPath('08b-scrolled-right.png')});
 const errors=table.locator('tbody td.cell-error');await expect(errors.first()).toBeVisible();await expect(errors.first()).toContainText('⚠ #ERROR');for (const section of ['tbody', 'tfoot']) {
  const cell = table.locator(`${section} td.cell-error`).first();
  const title = await cell.getAttribute('title');
  expect(title).toMatch(/.+: .+/);
  const name = `Error: ${title!.slice(title!.indexOf(': ') + 2)}`;
  await expect(cell.getByRole('img', { name, exact: true })).toHaveCount(1);
  const snapshot = await cell.ariaSnapshot();
  expect(snapshot).toContain(`img "${name}"`);
  writeFileSync(testInfo.outputPath(`${section}-error-accessibility.txt`), snapshot);
  await testInfo.attach(`${section}-error-accessibility`, { body: snapshot, contentType: 'text/plain' });
 }await expect(errors.first()).toHaveAttribute('title',/.+: .+/);await expect(table.locator('tfoot td.cell-error').first()).toContainText('⚠ #ERROR');
 await testInfo.attach('frame-geometry',{body:JSON.stringify({theme,before,after,count,errors:await errors.evaluateAll(cells=>cells.map(cell=>({title:cell.getAttribute('title'),accessible:cell.querySelector('[aria-label]')?.getAttribute('aria-label')})))},null,2),contentType:'application/json'});
 await table.screenshot({path:testInfo.outputPath('09-comparison-error.png')});
 // The table is as wide as its columns (bdobb#10, user-approved 2026-10-09): a wider card
 // leaves overflow = column sizes minus the visible width, and the chip shows while it overflows.
 await card.evaluate(el=>{(el as HTMLElement).style.width='1400px';});await scroll.evaluate(el=>el.scrollLeft=0);
 const overflow=()=>scroll.evaluate(el=>{const t=el.querySelector<HTMLElement>('table.widget-table.sized')!;return {actual:el.scrollWidth-el.clientWidth,expected:Math.max(0,parseFloat(t.style.width)-el.clientWidth)};});
 await expect.poll(async()=>{const o=await overflow();return Math.abs(o.actual-o.expected);}).toBeLessThan(2);
 const {expected}=await overflow();
 if(expected>1){await expect(scroll).toHaveAttribute('data-overflow-right','');await expect(table.locator('.table-overflow-chip')).toBeVisible();}
 else{await expect(scroll).not.toHaveAttribute('data-overflow-right');await expect(table.locator('.table-overflow-chip')).toHaveCount(0);}
});
