// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from '@playwright/test';
import { defaultSeed, seedApp } from './fixtures';

// The shape of the CFTC FX implied-vol table: a row per strike, a vol column per expiry, pair and date on every row.
const file = '00000000-0000-0000-0000-0000000000f1.csv';
const expiries = ['vol_1w', 'vol_1m', 'vol_3m', 'vol_1y'];
const smile = (pair: string, spot: number, base: number) => [-2, -1, 0, 1, 2].map(k =>
  [pair, '2026-11-17', (spot * (1 + k * 0.02)).toFixed(4), ...expiries.map((_, e) => k === 2 && e === 0 ? '' : (base + k * k * 0.6 + e * 0.4).toFixed(2))].join(','));
const csv = [['pair', 'date', 'strike', ...expiries].join(','), ...smile('EURUSD', 1.1, 7), ...smile('USDJPY', 150, 9)].join('\n') + '\n';
const table = { id: 'vol', widgetId: 'local_table', backendId: 'builtin', title: 'FX vol', params: { file }, layout: { x: 0, y: 0, w: 40, h: 8 }, tableDefinition: { table: {}, search: '' } };
const chart = { ...table, id: 'surface', title: 'Vol surface', widgetId: 'linked_chart', params: {}, linkedSource: { kind: 'widget', sourceWidgetId: 'vol' }, linkedChart: { type: 'surface', category: 'strike', measures: expiries, display: 'grouped' }, layout: { x: 0, y: 8, w: 40, h: 16 } };

test('a linked Surface chart draws one 3-D surface per pair/date', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const saved = JSON.stringify({ id: 'd1', name: 'Main', tabs: [{ id: 't1', name: 'Main', cards: [table, chart] }] });
  await seedApp(page, { ...defaultSeed(), 'dashboards/d1.json': saved, [`files/${file}`]: csv });
  const card = page.locator('.widget-card').filter({ has: page.locator('header').getByText('Vol surface', { exact: true }) });
  await expect(card.getByLabel('Chart type')).toHaveValue('surface');
  await expect(card.locator('.linked-chart-plot canvas')).toHaveCount(2);
  await expect(card.locator('.linked-chart-plot .annotation-text')).toHaveText(['EURUSD — 2026-11-17', 'USDJPY — 2026-11-17']);
  await expect(card.getByRole('alert')).toHaveCount(0);
  // An unmeshed surface still mounts its canvases, on empty default axes: the z ranges prove the data was drawn.
  const zRanges = () => page.evaluate(() => { const layout = (document.querySelector('.linked-chart-plot .js-plotly-plot') as unknown as { _fullLayout: Record<string, { zaxis: { range: number[] } }> })._fullLayout; return [layout.scene.zaxis.range, layout.scene2.zaxis.range].map(r => r.map(Math.round)); });
  await expect.poll(zRanges).toEqual([[7, 11], [9, 13]]);
  await info.attach('surface', { body: await card.screenshot(), contentType: 'image/png' });
});
