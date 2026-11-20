// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dashboardSeed, openRail, seedApp } from '../fixtures';

const directory = 'docs/examples/v9-next-news-sentiment-calendar';
const origin = 'http://127.0.0.1:17912';
export const newsPath = '/api/v1/eodhd/news/company';
export const newsWorkspace = 'Delivered news examples';
export const newsChart = 'News sentiment calendar';
export const newsTable = 'Canopy CompanyNews page';
export const newsManifest = readFileSync(directory + '.apps.json', 'utf8');

export function newsPayload() {
  return JSON.parse(readFileSync(directory + newsPath, 'utf8')) as {
    results: { url: string; date: string; symbols: string; title: string; polarity: number | null }[];
    extra: { results_metadata: { chart_sources: { version: number; receipts: [{
      coordinates: { article_id: string; utc_day: string; scored: boolean }[];
      scope: { limit: number; offset: number; start: string; end: string };
      retrieved_at: string; raw_count: number; normalized_count: number; delivered_count: number;
      diagnostics: string[];
    }] } } };
  };
}

export async function importNews(page: Page, manifest = newsManifest, respond: (url: URL) => unknown = newsPayload) {
  const acquisitions: URL[] = [];
  await page.route(origin + '/**', async route => {
    const url = new URL(route.request().url());
    const source = url.pathname === newsPath;
    if (source) acquisitions.push(url);
    const widgets = url.pathname === '/widgets.json';
    const payload = source ? await respond(url) : {};
    await route.fulfill({
      contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
      status: payload instanceof Error ? 500 : source || widgets || url.pathname === '/' ? 200 : 404,
      body: widgets ? readFileSync(directory + '/widgets.json', 'utf8')
        : JSON.stringify(payload instanceof Error ? { detail: payload.message } : payload),
    });
  });
  const seed = dashboardSeed([]);
  seed['backends.json'] = JSON.stringify([
    { id: 'news-calendar', name: 'CompanyNews calendar fixtures', baseUrl: origin, authLocation: 'header', validateWidgets: false },
  ]);
  seed['settings.json'] = JSON.stringify({ theme: 'system' });
  seed['imports/apps.json'] = manifest;
  await seedApp(page, seed);
  if (await page.evaluate(() => matchMedia('(hover: none)').matches)) {
    const transfer = await page.evaluateHandle(text => {
      const data = new DataTransfer();
      data.items.add(new File([text], 'news-calendar.apps.json', { type: 'application/json' }));
      return data;
    }, manifest);
    await page.locator('main.dashboard-area').dispatchEvent('drop', { dataTransfer: transfer });
    await transfer.dispose();
  } else {
    await openRail(page);
    await page.locator('[data-testid="rail-section-label"]', { hasText: 'My Dashboards' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Import apps.json…' }).click();
  }
  await expect(page.getByRole('tab', { name: newsChart })).toBeVisible();
  await page.mouse.move(700, 350);
  await expect(page.locator('nav.left-rail')).toHaveAttribute('data-expanded', 'false');
  return acquisitions;
}
