// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import {expect,test} from '@playwright/test';
import {fixture} from '../src/lib/statementModel/compileFixtures';
import {seedApp,defaultSeed} from './fixtures';
for(const theme of ['dark','light'])for(const width of [1280,390])test(`Statement authoring ${theme} ${width}`,async({page},info)=>{
 const {statement,source}=fixture(),values=source.rows[0].values;
 const file='00000000-0000-0000-0000-000000000001.csv';
 const seed=defaultSeed();seed['settings.json']=JSON.stringify({theme});seed['files/'+file]=`${Object.keys(values).join(',')}\n${Object.values(values).join(',')}\n`;
 seed['dashboards/d1.json']=JSON.stringify({id:'d1',name:'Statement authoring',tabs:[{id:'t1',name:'Main',cards:[{id:'statement',widgetId:'local_table',backendId:'builtin',title:'Income statement',params:{file},layout:{x:0,y:0,w:48,h:22},tableDefinition:{table:{},search:'',analytical:statement}}]}]});
 await page.setViewportSize({width,height:900});
 const initial=structuredClone(seed),initialDashboard=JSON.parse(initial['dashboards/d1.json'] as string);delete initialDashboard.tabs[0].cards[0].tableDefinition;initial['dashboards/d1.json']=JSON.stringify(initialDashboard);
 await seedApp(page,initial);const initialCard=page.locator('.widget-card');await initialCard.getByRole('button',{name:'Pivot',exact:true}).click();await initialCard.getByRole('tab',{name:'Saved',exact:true}).click();await initialCard.getByRole('button',{name:'Statement template',exact:true}).click();await expect(initialCard.getByLabel('Template',{exact:true})).toBeVisible();await initialCard.screenshot({path:info.outputPath('00-initial-choice.png')});
 await seedApp(page,seed);
 const card=page.locator('.widget-card');await card.getByRole('button',{name:'Pivot',exact:true}).click();await card.getByRole('tab',{name:'Saved',exact:true}).click();await card.getByRole('button',{name:'Statement template',exact:true}).click();
 await expect(card.getByLabel('Company',{exact:true})).toHaveValue('symbol');
 await expect(card.getByRole('button',{name:'Calculate preview',exact:true})).toBeEnabled();
 await card.screenshot({path:info.outputPath('01-mappings.png')});
 await card.getByLabel('Label revenue',{exact:true}).fill('Sales');
 await card.getByLabel('Label revenue',{exact:true}).scrollIntoViewIfNeeded();
 await card.screenshot({path:info.outputPath('02-local-overrides.png')});
 await card.getByRole('button',{name:'Calculate preview',exact:true}).click();
 await expect(card.getByRole('button',{name:'Apply Statement model',exact:true})).toBeEnabled();
 const preview=card.getByRole('region',{name:'Calculated Statement preview'});await preview.scrollIntoViewIfNeeded();
 await expect(preview).toContainText('40');await expect(preview.locator('.table-total-footer')).toHaveCount(0);await card.screenshot({path:info.outputPath('03-calculated-preview.png')});
 expect(await card.evaluate(e=>e.scrollWidth<=e.clientWidth+2)).toBe(true);
 await card.getByRole('button',{name:'Apply Statement model',exact:true}).click();
 await expect(card.getByRole('button',{name:'Calculate preview',exact:true})).toBeEnabled();
 await expect(card.getByLabel('Label revenue',{exact:true})).toHaveValue('Sales');
 await card.screenshot({path:info.outputPath('04-post-apply.png')});
 await card.getByRole('button',{name:'Close pivot drawer',exact:true}).click();
 await card.getByRole('button',{name:'Expand Income',exact:true}).click();
 await expect(card.locator('tbody')).toContainText('Sales');await expect(card.locator('.table-total-footer')).toHaveCount(0);await card.screenshot({path:info.outputPath('04b-post-apply-active-output.png')});
 await card.getByRole('button',{name:'Pivot',exact:true}).click();await card.getByRole('tab',{name:'Saved',exact:true}).click();await card.getByRole('button',{name:'Statement template',exact:true}).click();
 const section=statement.template.sections[0];await card.getByLabel(`Visible section ${section.label}`,{exact:true}).uncheck();await card.getByLabel('Visible revenue',{exact:true}).scrollIntoViewIfNeeded();await expect(card.getByLabel('Visible revenue',{exact:true})).not.toBeChecked();await card.screenshot({path:info.outputPath('05-section-visibility.png')});
 const next=JSON.parse(JSON.stringify(statement.template).replaceAll('/1.0.0/','/2.0.0/').replace('"version":"1.0.0"','"version":"2.0.0"'));next.lines[0].policy='stock';next.lines[0].format='integer';const formula=next.lines.find((l:{formula?:unknown})=>l.formula).formula;formula.expression='42';formula.ast={kind:'literal',value:42};
 await card.getByText('Explicit template update',{exact:true}).click();await card.getByLabel('Supplied template snapshot',{exact:true}).fill(JSON.stringify(next));await card.getByRole('button',{name:'Preview template update',exact:true}).click();
 const comparison=card.getByRole('region',{name:'Template changes'});await expect(comparison).toContainText('Before');await expect(comparison).toContainText('stock');await comparison.getByText('revenue · policy',{exact:true}).scrollIntoViewIfNeeded();await card.screenshot({path:info.outputPath('06-update-comparison.png')});await comparison.getByText('Calculated gross profit · formula',{exact:true}).evaluate(element=>element.parentElement!.scrollIntoView({block:'start'}));await card.screenshot({path:info.outputPath('07-update-formula.png')});expect(await card.evaluate(e=>e.scrollWidth<=e.clientWidth+2)).toBe(true);

});
