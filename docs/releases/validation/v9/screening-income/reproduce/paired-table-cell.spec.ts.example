// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { dashboardSeed, MOCK_URL, seedApp } from './fixtures';

test('renders the generated paired screener column and the packaged HTTP row', async ({ page }, info) => {
  const input = new URL('./paired-table-cell.json', import.meta.url);
  const { widget, row } = JSON.parse(readFileSync(input, 'utf8'));
  const id = 'eodhd_equity_screener_eodhd_obb';
  await page.route(MOCK_URL + '/widgets.json', route => route.fulfill({ json: { [id]: widget } }));
  await page.route(MOCK_URL + widget.endpoint + '**', route => route.fulfill({ json: { results: [row] } }));
  const seed = dashboardSeed([{ id: 'paired', backendId: 'b1', widgetId: id, params: { exchange: 'us', chart_source: 'true' },
    layout: { x: 0, y: 0, w: 36, h: 16 } }]);
  await seedApp(page, seed);
  expect(row.price_change_5d).toBe(0.05);
  const cell = page.locator('td[data-field="price_change_5d"]');
  await expect(cell).toHaveText('5 %');
  await cell.scrollIntoViewIfNeeded();
  await page.locator('.widget-card').screenshot({ path: info.outputPath('paired-formatted-table.png') });
});
