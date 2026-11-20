// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dashboardSeed, openRail, seedApp } from '../fixtures';

const directory = 'docs/examples/v9-screening-income';
export const screeningExample = readFileSync(directory + '.apps.json', 'utf8');
const origin = 'http://127.0.0.1:17911';
const prefix = '/api/v1/eodhd/equity/';
export const screeningTab = 'Screening and income';
export const screeningWorkspace = 'Screening and income examples';
export const screeningNames = ['Screening bubble', 'Dividend steps', 'Income Sankey'] as const;
export const screeningSources = ['US screener page', 'Canopy dividends', 'Canopy income statements'] as const;
export const screeningPaths = [prefix + 'screener', prefix + 'fundamental/dividends', prefix + 'fundamental/income'] as const;
export const screeningPayload = (path: string) => JSON.parse(readFileSync(directory + path, 'utf8'));

export async function importScreening(page: Page, manifest = screeningExample,
  overrides = new Map<string, unknown>()) {
  const acquisitions: URL[] = [];
  await page.route(origin + '/**', route => {
    const url = new URL(route.request().url());
    const path = screeningPaths.find(path => path === url.pathname);
    if (path) acquisitions.push(url);
    const widgets = url.pathname === '/widgets.json';
    return route.fulfill({
      contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
      status: path || widgets || url.pathname === '/' ? 200 : 404,
      body: path ? JSON.stringify(overrides.get(path) ?? screeningPayload(path))
        : widgets ? readFileSync(directory + '/widgets.json', 'utf8') : '{}',
    });
  });
  const seed = dashboardSeed([]);
  seed['backends.json'] = JSON.stringify([
    { id: 'screening', name: 'Screening and income fixtures', baseUrl: origin, authLocation: 'header', validateWidgets: false },
  ]);
  seed['settings.json'] = JSON.stringify({ theme: 'system' });
  seed['imports/apps.json'] = manifest;
  // Plotly's Sankey fades redrawn ribbons using Date.now().
  await page.clock.setSystemTime(new Date('2026-11-19T17:00:00Z'));
  await seedApp(page, seed);
  if (await page.evaluate(() => matchMedia('(hover: none)').matches)) {
    const transfer = await page.evaluateHandle(text => {
      const data = new DataTransfer();
      data.items.add(new File([text], 'screening.apps.json', { type: 'application/json' }));
      return data;
    }, manifest);
    await page.locator('main.dashboard-area').dispatchEvent('drop', { dataTransfer: transfer });
    await transfer.dispose();
  } else {
    await openRail(page);
    await page.locator('[data-testid="rail-section-label"]', { hasText: 'My Dashboards' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Import apps.json…' }).click();
  }
  await expect(page.getByRole('tab', { name: screeningTab })).toBeVisible();
  await page.mouse.move(700, 350);
  await expect(page.locator('nav.left-rail')).toHaveAttribute('data-expanded', 'false');
  return { overrides, acquisitions };
}
