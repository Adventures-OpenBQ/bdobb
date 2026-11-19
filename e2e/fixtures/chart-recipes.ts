// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { defaultSeed, openRail, seedApp } from '../fixtures';

export const example = readFileSync('docs/examples/v9-chart-expansion.apps.json', 'utf8');
const origin = 'http://127.0.0.1:17909';
export const names = ['Drawdown', 'Yield curve', 'Monthly returns', 'Daily return correlation', 'Estimate ranges', 'Earnings versus estimates', 'Income statement bridge'];

export function fixture(name: string) {
  return readFileSync('docs/examples/v9-chart-expansion/' + name + '.json', 'utf8');
}
export const card = (page: Page, name: string) => page.locator('.widget-card').filter({ has: page.locator('.card-title', { hasText: name }) });
export const plot = (page: Page, name: string) => card(page, name).locator('.js-plotly-plot');

export async function importExample(page: Page, manifest = example) {
  const overrides = new Map<string, { body: string; status?: number; }>();
  await page.route(origin + '/**', route => {
    const path = new URL(route.request().url()).pathname.slice(1);
    const override = overrides.get(path);
    const name = /^(widgets|prices|curves|estimates|income)\.json$/.exec(path)?.[1];
    return route.fulfill({
      contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
      body: override?.body ?? (name ? fixture(name) : '{}'), status: override?.status ?? (name || !path ? 200 : 404),
    });
  });
  const seed = defaultSeed();
  seed['settings.json'] = JSON.stringify({ theme: 'system' });
  seed['backends.json'] = JSON.stringify([{ id: 'demo', name: 'Chart examples', baseUrl: origin, authLocation: 'header', validateWidgets: false }]);
  seed['imports/apps.json'] = manifest;
  await seedApp(page, seed);
  if (await page.evaluate(() => matchMedia('(hover: none)').matches)) {
    const file = await page.evaluateHandle(text => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], 'charts.apps.json', { type: 'application/json' }));
      return transfer;
    }, manifest);
    await page.locator('main.dashboard-area').dispatchEvent('drop', { dataTransfer: file });
    await file.dispose();
  } else {
    await openRail(page);
    await page.locator('[data-testid="rail-section-label"]', { hasText: 'My Dashboards' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Import apps.json…' }).click();
  }
  await expect(page.getByRole('tab', { name: 'Charts and sources' })).toBeVisible();
  await page.mouse.move(740, 360);
  await expect(page.locator('nav.left-rail')).toHaveAttribute('data-expanded', 'false');
  return overrides;
}
