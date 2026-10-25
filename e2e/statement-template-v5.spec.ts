// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';
import { fixture } from '../src/lib/statementModel/compileFixtures';
import { defaultSeed, seedApp, read, memfs } from './fixtures';

for (const theme of ['dark', 'light']) test(`v4 template becomes a v5 Statement with durable folds and authoritative exports in ${theme}`, async ({ page }) => {
  const f = fixture();
  const profit = f.ids.line('calculated_gross_profit');
  const section = f.statement.template.sections.find(section => section.lineIds.includes(profit))!;
  f.statement.overrides.labels[profit] = 'Profit';
  f.statement.overrides.labels[section.id] = 'Results';
  const seed = defaultSeed();
  seed['settings.json'] = JSON.stringify({ theme });
  const file = '11111111-1111-4111-8111-111111111111.csv';
  seed[`files/${file}`] = 'symbol,period,date,year,start,end,revenue,cost_of_revenue\nACME,FY,2025-12-31,2025,2025-01-01,2025-12-31,100,60\n';
  seed['dashboards/d1.json'] = JSON.stringify({ id: 'd1', name: 'Template', tabs: [{ id: 't1', name: 'Main', cards: [{
    id: 'template', widgetId: 'local_table', backendId: 'builtin', params: { file, label: 'Income' }, view: 'statement',
    layout: { x: 0, y: 0, w: 40, h: 24 }, tableDefinition: { table: {}, search: '', analytical: f.statement },
  }] }] });
  await seedApp(page, seed);
  const card = page.getByRole('article');
  await expect(card.getByRole('columnheader', { name: 'FY2025', exact: true })).toBeVisible();
  const profitRow = card.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Profit', exact: true }) });
  await expect(profitRow.getByRole('cell', { name: '40', exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Results', exact: true }).click();
  await expect(card.getByRole('cell', { name: 'Profit', exact: true })).toHaveCount(0);
  await expect.poll(async () => JSON.parse(await read(page, 'dashboards/d1.json') ?? '{}').tabs?.[0].cards[0].statement)
    .toEqual({ collapsed: [section.id] });
  await card.hover();
  await card.getByRole('button', { name: 'Card menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Export ▸', exact: true }).click();
  await page.getByRole('menuitem', { name: 'JSON', exact: true }).click();
  await expect.poll(async () => (await memfs(page).list()).filter(path => path.startsWith('exports/')).length).toBe(1);
  const exported = (await memfs(page).list()).find(path => path.startsWith('exports/'))!;
  expect(JSON.parse((await read(page, exported))!)).toEqual(expect.arrayContaining([expect.objectContaining({ Section: 'Results', 'Line item': 'Profit', FY2025: 40 })]));
  const saved = JSON.parse((await read(page, 'dashboards/d1.json'))!);
  seed['dashboards/d1.json'] = JSON.stringify(saved);
  await seedApp(page, seed);
  await expect(card.getByRole('button', { name: /Results \(1\)/ })).toHaveAttribute('aria-expanded', 'false');
  await card.getByRole('button', { name: /Results \(1\)/ }).click();
  await expect(card.getByRole('cell', { name: 'Profit', exact: true })).toBeVisible();
});

test('Statement presentation displays a monetary-context error instead of Profit40', async ({ page }) => {
  const f = fixture(), profit = f.ids.line('calculated_gross_profit');
  f.statement.bindings.shape = 'long'; f.statement.bindings.mappings = [];
  f.statement.bindings.longFields = { itemFieldId: 'item', valueFieldId: 'amount' };
  f.statement.bindings.currencyFieldId = 'currency';
  f.statement.overrides.labels[profit] = 'Profit';
  const seed = defaultSeed(), file = '11111111-1111-4111-8111-111111111111.csv';
  seed[`files/${file}`] = `symbol,period,date,year,start,end,item,amount,currency\nACME,FY,2025-12-31,2025,2025-01-01,2025-12-31,${f.ids.line('revenue')},100,USD\nACME,FY,2025-12-31,2025,2025-01-01,2025-12-31,${f.ids.line('cost_of_revenue')},60,EUR\n`;
  seed['dashboards/d1.json'] = JSON.stringify({ id: 'd1', name: 'Contexts', tabs: [{ id: 't1', name: 'Main', cards: [{
    id: 'template', widgetId: 'local_table', backendId: 'builtin', params: { file, label: 'Contexts' }, view: 'statement',
    layout: { x: 0, y: 0, w: 40, h: 24 }, tableDefinition: { table: {}, search: '', analytical: f.statement },
  }] }] });
  await seedApp(page, seed);
  const row = page.getByRole('article').getByRole('row').filter({ has: page.getByRole('cell', { name: 'Profit', exact: true }) });
  await expect(row.getByRole('cell', { name: '#ERROR', exact: true })).toBeVisible();
  await expect(row.getByRole('cell', { name: '#ERROR', exact: true })).toHaveAttribute('title', /context|currency|unit/i);
  await expect(row.getByRole('cell', { name: '40', exact: true })).toHaveCount(0);
});
