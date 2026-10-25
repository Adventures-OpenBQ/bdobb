// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// D-020: typing into a worker table's Input filters, one key at a time, keeps
// every keystroke in order, and the saved filter ends up as typed.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { seedApp, defaultSeed, read } from './fixtures';
const dashboard=readFileSync('e2e/fixtures/pivot-drawer/dashboard.json','utf8');
const csv=readFileSync('e2e/fixtures/pivot-drawer/fundamentals_q.csv','utf8');
test('Input filters keep key-by-key typing (D-020)',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});
 await seedApp(page,{...defaultSeed(),'dashboards/d1.json':dashboard,'files/00000000-0000-0000-0000-000000000001.csv':csv});
 const card=page.locator('.widget-card');
 await expect(card.getByRole('columnheader',{name:/revenue/}).first()).toBeVisible();
 await card.getByRole('button',{name:'Filter rows'}).click();
 const panel=card.getByRole('region',{name:'Input filters'});
 const company=panel.getByLabel('Filter company',{exact:true});
 await company.pressSequentially('AAPL',{delay:15});
 await expect(company).toHaveValue('AAPL');
 await expect.poll(async()=>JSON.parse((await read(page,'dashboards/d1.json'))!).tabs[0].cards[0].tableDefinition.table.columnFilters,{timeout:10_000}).toEqual([{id:'company',value:'AAPL'}]);
 await expect(company).toHaveValue('AAPL');
});
