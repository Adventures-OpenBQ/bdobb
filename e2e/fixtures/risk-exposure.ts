// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dashboardSeed, openRail, seedApp } from '../fixtures';

export const riskNames = ['Return distribution', 'Watchlist panels', 'Holdings concentration', 'Equity exposure'] as const;
export const directory = 'docs/examples/v9-risk-exposure';
export const fixture = (name: string) => readFileSync(directory + '/' + name + '.json', 'utf8');
const origin = 'http://127.0.0.1:17910';

export async function importRisk(page: Page, manifest = readFileSync(directory + '.apps.json', 'utf8'),
  overrides = new Map<string, string>()) {
  const acquisitions: string[] = [];
  await page.route(origin + '/**', route => {
    const name = new URL(route.request().url()).pathname.slice(1);
    const match = /^(prices|holdings|sectors|regions|widgets)\.json$/.exec(name);
    if (match && match[1] !== 'widgets') acquisitions.push(match[1]);
    return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
      status: match || !name ? 200 : 404, body: overrides.get(name) ?? (match ? fixture(match[1]) : '{}') });
  });
  const seed = dashboardSeed([]);
  seed['backends.json'] = JSON.stringify([{ id: 'risk', name: 'Risk fixtures', baseUrl: origin, authLocation: 'header', validateWidgets: false }]);
  seed['settings.json'] = JSON.stringify({ theme: 'system' });
  seed['imports/apps.json'] = manifest;
  await page.clock.setFixedTime(new Date('2026-03-19T12:00:00Z'));
  await seedApp(page, seed);
  if (await page.evaluate(() => matchMedia('(hover: none)').matches)) {
    const transfer = await page.evaluateHandle(text => {
      const data = new DataTransfer();
      data.items.add(new File([text], 'risk.apps.json', { type: 'application/json' }));
      return data;
    }, manifest);
    await page.locator('main.dashboard-area').dispatchEvent('drop', { dataTransfer: transfer });
    await transfer.dispose();
  } else {
    await openRail(page);
    await page.locator('[data-testid="rail-section-label"]', { hasText: 'My Dashboards' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Import apps.json…' }).click();
  }
  await expect(page.getByRole('tab', { name: 'Risk and exposure' })).toBeVisible();
  await page.mouse.move(700, 350);
  await expect(page.locator('nav.left-rail')).toHaveAttribute('data-expanded', 'false');
  return { overrides, acquisitions };
}
