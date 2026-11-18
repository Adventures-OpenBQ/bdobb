// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Page } from '@playwright/test';
import { MOCK_URL, defaultSeed, seedApp } from './fixtures';

// The shape of the CFTC FX implied-vol table: a row per strike, a vol column per expiry, pair and date on every row.
const file = '00000000-0000-0000-0000-0000000000f1.csv';
const expiries = ['vol_1w', 'vol_1m', 'vol_3m', 'vol_1y'];
const smile = (pair: string, spot: number, base: number) => [-2, -1, 0, 1, 2].map(k =>
  [pair, '2026-11-17', (spot * (1 + k * 0.02)).toFixed(4), ...expiries.map((_, e) => k === 2 && e === 0 ? '' : (base + k * k * 0.6 + e * 0.4).toFixed(2))].join(','));
const csv = [['pair', 'date', 'strike', ...expiries].join(','), ...smile('EURUSD', 1.1, 7), ...smile('USDJPY', 150, 9)].join('\n') + '\n';
const table = { id: 'vol', widgetId: 'local_table', backendId: 'builtin', title: 'FX vol', params: { file }, layout: { x: 0, y: 0, w: 40, h: 8 }, tableDefinition: { table: {}, search: '' } };
const chart = { ...table, id: 'surface', title: 'Vol surface', widgetId: 'linked_chart', params: {}, linkedSource: { kind: 'widget', sourceWidgetId: 'vol' }, linkedChart: { type: 'surface', category: 'strike', measures: expiries, display: 'grouped' }, layout: { x: 0, y: 8, w: 40, h: 16 } };

// An unmeshed surface still mounts its canvases, on empty default axes: the z range each scene resolved proves the data was drawn.
const zRanges = (page: Page) => page.evaluate(() => Object.entries((document.querySelector('.linked-chart-plot .js-plotly-plot') as unknown as { _fullLayout: Record<string, { _scene: { fullSceneLayout: { zaxis: { range: number[] } } } }> })._fullLayout)
  .filter(([key]) => /^scene\d*$/.test(key)).map(([, scene]) => scene._scene.fullSceneLayout.zaxis.range.map(Math.round)));

test('a linked Surface chart draws one 3-D surface per pair/date', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const saved = JSON.stringify({ id: 'd1', name: 'Main', tabs: [{ id: 't1', name: 'Main', cards: [table, chart] }] });
  await seedApp(page, { ...defaultSeed(), 'dashboards/d1.json': saved, [`files/${file}`]: csv });
  const card = page.locator('.widget-card').filter({ has: page.locator('header').getByText('Vol surface', { exact: true }) });
  await expect(card.getByLabel('Chart type')).toHaveValue('surface');
  await expect(card.locator('.linked-chart-plot canvas')).toHaveCount(2);
  await expect(card.locator('.linked-chart-plot .annotation-text')).toHaveText(['EURUSD — 2026-11-17', 'USDJPY — 2026-11-17']);
  await expect(card.getByRole('alert')).toHaveCount(0);
  await expect.poll(() => zRanges(page)).toEqual([[7, 11], [9, 13]]);
  await info.attach('surface', { body: await card.screenshot(), contentType: 'image/png' });
});

test('picking Surface on an empty chart takes its fields from the source widget chartDataType hints', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  // A backend table declared the way the CFTC FX implied-vol widget is: strike the category, each vol a series, the rest excluded.
  const hinted = { name: 'FX implied vol', description: '', endpoint: 'fx_vol', type: 'table', category: 'FX', gridData: { w: 40, h: 8 }, params: [], data: { table: { columnsDefs: [
    { field: 'strike', chartDataType: 'category' }, { field: 'strike_offset', chartDataType: 'excluded' }, { field: 'num_options', chartDataType: 'excluded' },
    ...expiries.map(field => ({ field, chartDataType: 'series' })), { field: 'pair' }, { field: 'date' }] } } };
  const rows = [1.05, 1.1, 1.15].map((strike, k) => ({ date: '2026-11-17', pair: 'EURUSD', strike, strike_offset: k - 1, num_options: 4, ...Object.fromEntries(expiries.map((field, e) => [field, 7 + (k - 1) * (k - 1) + e])) }));
  const cors = { 'access-control-allow-origin': '*' };
  await page.route(`${MOCK_URL}/widgets.json`, async route => { const response = await route.fetch(); await route.fulfill({ response, json: { ...await response.json(), fx_implied_vol: hinted } }); });
  await page.route(`${MOCK_URL}/fx_vol*`, route => route.fulfill({ json: rows, headers: cors }));
  const source = { id: 'vol', widgetId: 'fx_implied_vol', backendId: 'b1', title: 'FX vol', params: {}, layout: { x: 0, y: 0, w: 40, h: 8 } };
  const empty = { ...chart, linkedChart: { type: 'column', measures: [], display: 'grouped' } };
  await seedApp(page, { ...defaultSeed(), 'dashboards/d1.json': JSON.stringify({ id: 'd1', name: 'Main', tabs: [{ id: 't1', name: 'Main', cards: [source, empty] }] }) });
  const card = page.locator('.widget-card').filter({ has: page.locator('header').getByText('Vol surface', { exact: true }) });
  await expect(card.getByLabel('Category').getByRole('option', { name: 'strike', exact: true })).toBeAttached();
  await card.getByLabel('Chart type').selectOption('surface');
  await expect(card.getByLabel('Category')).toHaveValue('strike');
  for (const field of expiries) await expect(card.getByRole('checkbox', { name: field, exact: true })).toBeChecked();
  for (const field of ['strike_offset', 'num_options']) await expect(card.getByRole('checkbox', { name: field, exact: true })).not.toBeChecked();
  await expect(card.locator('.linked-chart-plot .annotation-text')).toHaveText(['EURUSD — 2026-11-17']);
  await expect.poll(() => zRanges(page)).toEqual([[7, 11]]);
});

test('filtering the source to one pair redraws a single surface, and one ticked expiry draws a line', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  // The source table promotes Pair to a header parameter, the way a Pivot category filter does.
  const model = { schemaVersion: 1, enabled: false, params: { promotePage: true, filters: [{ id: 'p', categoryId: 'cat', label: 'Pair', multiSelect: true }] }, categories: [{ id: 'cat', name: 'Pair', sourceFieldId: 'pair', transform: 'native' }], measures: [], formulas: [], layout: { rows: [], columns: [], values: [] }, checklists: [], resultFilters: [], subtotals: { grandTotal: false, groups: false } };
  const source = { ...table, tableDefinition: { table: {}, search: '', analytical: model } };
  await seedApp(page, { ...defaultSeed(), 'dashboards/d1.json': JSON.stringify({ id: 'd1', name: 'Main', tabs: [{ id: 't1', name: 'Main', cards: [source, chart] }] }), [`files/${file}`]: csv });
  const card = page.locator('.widget-card').filter({ has: page.locator('header').getByText('Vol surface', { exact: true }) });
  const titles = card.locator('.linked-chart-plot .annotation-text');
  await expect(titles).toHaveText(['EURUSD — 2026-11-17', 'USDJPY — 2026-11-17']);
  const root = page.locator('.widget-card').filter({ has: page.locator('header').getByText('FX vol', { exact: true }) });
  await root.getByRole('button', { name: 'Pair: All' }).click();
  const popup = page.getByRole('dialog', { name: 'Pair values' });
  await popup.getByLabel('USDJPY').uncheck();
  await popup.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(titles).toHaveText(['EURUSD — 2026-11-17']);
  await expect(card.locator('.linked-chart-plot canvas')).toHaveCount(1);
  await expect.poll(() => zRanges(page)).toEqual([[7, 11]]);
  // Unticking and re-ticking an expiry keeps the list and the surface's expiry axis in the table's column order.
  const listed = card.locator('fieldset label');
  await card.getByRole('checkbox', { name: 'vol_1m', exact: true }).uncheck();
  await expect(card.getByRole('checkbox', { name: 'vol_1m', exact: true })).not.toBeChecked();
  await expect(listed).toHaveText(['pair', 'date', 'strike', ...expiries]);
  await card.getByRole('checkbox', { name: 'vol_1m', exact: true }).check();
  await expect.poll(() => page.evaluate(() => (document.querySelector('.linked-chart-plot .js-plotly-plot') as unknown as { layout: { scene: { yaxis: { ticktext: string[] } } } }).layout.scene.yaxis.ticktext)).toEqual(expiries);
  await expect(listed).toHaveText(['pair', 'date', 'strike', ...expiries]);
  // One expiry left ticked: the smile as a line, no 3-D scene.
  for (const field of expiries.slice(1)) await card.getByRole('checkbox', { name: field, exact: true }).uncheck();
  await expect(card.locator('.linked-chart-plot .scatterlayer .trace')).toHaveCount(1);
  await expect(card.locator('.linked-chart-plot canvas')).toHaveCount(0);
  await expect(titles).toHaveText(['EURUSD — 2026-11-17']);
  await expect(card.getByRole('alert')).toHaveCount(0);
});
