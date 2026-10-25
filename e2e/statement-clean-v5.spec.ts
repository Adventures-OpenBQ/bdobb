// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';
import { defaultSeed, seedApp, seedCards, read, memfs } from './fixtures';
const csv = 'fiscal_year,fiscal_period,net_cash_from_operating_activities,capital_expenditure\n2026,Q3,12,-5\n2026,TTM,33,-18\n';
for (const theme of ['dark', 'light']) test(`Statement local-file worker, folds and table return in ${theme}`, async ({ page }) => {
  const seed = defaultSeed(); seed['settings.json'] = JSON.stringify({ theme });
  seed['files/11111111-1111-4111-8111-111111111111.csv'] = csv;
  seed['dashboards/d1.json'] = JSON.stringify({ id: 'd1', name: 'Cash flow', tabs: [{ id: 't1', name: 'Statement', cards: [{ id: 'cash', widgetId: 'local_table', backendId: 'builtin', params: { file: '11111111-1111-4111-8111-111111111111.csv', label: 'Cash flow' }, view: 'statement', layout: { x: 0, y: 0, w: 40, h: 22 }, tableDefinition: { table: {}, search: '' } }] }] });
  await seedApp(page, seed);
  const card = page.getByRole('article');
  await expect(card.getByRole('columnheader', { name: 'Line item', exact: true })).toBeVisible();
  await expect(card.getByRole('columnheader', { name: 'FY2026-TTM', exact: true })).toBeVisible();
  await expect(card.getByRole('cell', { name: '-18', exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Investing', exact: true }).click();
  await expect(card.getByRole('cell', { name: 'Capital Expenditure', exact: true })).toHaveCount(0);
  await expect.poll(async () => JSON.parse(await read(page, 'dashboards/d1.json') ?? '{}').tabs?.[0].cards[0].statement).toEqual({ collapsed: ['Investing'] });
  await card.hover();
  await card.getByRole('button', { name: 'Card menu' }).click();
  await page.getByRole('menuitem', { name: 'Export ▸', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'JSON', exact: true })).toBeEnabled();
  await page.getByRole('menuitem', { name: 'JSON', exact: true }).click();
  const exportedPath = (await memfs(page).list()).find(path => path.startsWith('exports/'))!;
  expect(JSON.parse((await read(page, exportedPath))!)).toEqual(expect.arrayContaining([expect.objectContaining({ 'Line item': 'Capital Expenditure', 'FY2026-TTM': -18 })]));
  await card.getByRole('combobox', { name: 'View', exact: true }).selectOption({ label: 'Table' });
  await expect(card.getByRole('columnheader', { name: /capital_expenditure/i })).toBeVisible();
  const saved = JSON.parse(await read(page, 'dashboards/d1.json') ?? '{}');
  expect(saved.tabs[0].cards[0].tableDefinition).toEqual({ table: {}, search: '' });
});

test('backend Statement uses the complete response and exports folded line items', async ({ page }) => {
  await page.route('**/bigtable*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify([
    { fiscal_year: 2026, fiscal_period: 'Q3', net_cash_from_operating_activities: 12, capital_expenditure: -5 },
    { fiscal_year: 2026, fiscal_period: 'TTM', net_cash_from_operating_activities: 33, capital_expenditure: -18 },
  ]) }));
  await seedCards(page, [{ id: 'backend-cash', widgetId: 'bigtable', backendId: 'b1', params: {}, layout: { x: 0, y: 0, w: 40, h: 22 } }]);
  const card = page.getByRole('article');
  await card.getByRole('combobox', { name: 'View', exact: true }).selectOption('statement');
  await expect(card.getByRole('cell', { name: '-18', exact: true })).toBeVisible();
  // A plain backend response is the provider's whole answer (ruling 2026-10-16): no completeness banner.
  await expect(card.getByText('Backend response completeness is not declared.')).toHaveCount(0);
  await card.getByRole('button', { name: 'Investing', exact: true }).click();
  await card.hover();
  await card.getByRole('button', { name: 'Card menu' }).click();
  await page.getByRole('menuitem', { name: 'Export ▸', exact: true }).click();
  await page.getByRole('menuitem', { name: 'JSON', exact: true }).click();
  await expect.poll(async () => (await memfs(page).list()).filter(path => path.startsWith('exports/')).length).toBe(1);
  const file = (await memfs(page).list()).find(path => path.startsWith('exports/'))!;
  const exported = JSON.parse((await read(page, file))!);
  expect(exported).toEqual(expect.arrayContaining([expect.objectContaining({ Section: 'Investing', 'Line item': 'Capital Expenditure', 'FY2026-TTM': -18 })]));
});

// User ruling 2026-10-10: OPENBQ's yfinance statements are long-form rows
// (symbol, date, period, line_item, value); a backend card's Statement view
// reads them directly. The body is a captured OPENBQ API response.
test('backend Statement reads long-form OPENBQ yfinance rows, one column per served date', async ({ page }) => {
  const { readFileSync } = await import('node:fs');
  const income = readFileSync('src/test/fixtures/openbq-yfinance/aapl-income-annual.json', 'utf8');
  await page.route('**/bigtable*', route => route.fulfill({ contentType: 'application/json', body: income }));
  await seedCards(page, [{ id: 'backend-income', widgetId: 'bigtable', backendId: 'b1', params: {}, layout: { x: 0, y: 0, w: 40, h: 22 } }]);
  const card = page.getByRole('article');
  await card.getByRole('combobox', { name: 'View', exact: true }).selectOption('statement');
  await expect(card.getByRole('columnheader', { name: '2025-09-30', exact: true })).toBeVisible();
  await expect(card.getByRole('columnheader', { name: '2024-09-30', exact: true })).toBeVisible();
  await expect(card.getByRole('cell', { name: 'Net Income', exact: true })).toBeVisible();
  await expect(card.getByText('Nothing to show: the rows carry no statement line items.')).toHaveCount(0);
});
