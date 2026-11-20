// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, type Page } from '@playwright/test';
import type { MarketMapOptions } from '../../src/lib/widgetData/chartRecipes/types';
import { dashboardSeed, seedApp } from '../fixtures';
import { card, chooseLinkedSource } from './chart-recipes';
import { dropFile } from './return-summary';

export const workspace = 'Market map fixtures';
export const tab = 'Market snapshots';
export const chartName = 'Market composition';
export const placeholder = 'Market snapshots source';
export const sampleName = 'prepared-market.json';

export const liveTitle = 'Legacy screening table';
export const liveOrigin = 'http://127.0.0.1:17924';
export const livePath = '/api/v1/equity/screener';

export async function seedMarket(page: Page, options?: MarketMapOptions, empty = false, height = 32, live = false) {
  if (live) await page.route(liveOrigin + '/**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      headers: { 'Access-Control-Allow-Origin': '*' },
      json: path === livePath ? { results: [
        { symbol: 'ALFA.US', market_cap: 4600, change: 0 },
      ] } : path === '/widgets.json' ? {
        legacy_screen: { name: liveTitle, description: 'Current screening snapshot', type: 'table',
          endpoint: livePath, data: { dataKey: 'results' }, params: [], refetchInterval: false },
      } : {},
    });
  });
  const cards = [
    { id: 'chart', widgetId: 'linked_chart', backendId: 'builtin', title: chartName, params: {},
      linkedSource: { kind: 'widget', sourceWidgetId: 'source' },
      linkedChart: { type: options?.kind ?? 'column', recipe: options, measures: [], display: 'grouped' },
      layout: { x: 0, y: 0, w: 36, h: height } },
    { id: 'source', params: {}, ...(live ? { widgetId: 'legacy_screen', backendId: 'screen-fixture', title: liveTitle }
      : { widgetId: 'local_table', backendId: 'builtin', title: placeholder }),
      layout: { x: 0, y: height, w: 36, h: 12 } },
  ];
  const seed = empty ? dashboardSeed([]) : dashboardSeed([], { name: workspace, tabs: [{ name: tab, id: 't1', cards }] });
  seed['settings.json'] = JSON.stringify({ theme: 'system' });
  seed['backends.json'] = JSON.stringify(live ? [
    { id: 'screen-fixture', name: 'Legacy screener fixture', baseUrl: liveOrigin, authLocation: 'header', validateWidgets: false },
  ] : []);
  await seedApp(page, seed);
}

export async function chooseMarketSource(page: Page, name: string) {
  await chooseLinkedSource(page, card(page, chartName), name + ' — ' + tab);
}

export async function attachMarket(page: Page, snapshot: unknown, name = sampleName) {
  await dropFile(page, name, JSON.stringify(snapshot));
  await expect(card(page, name)).toBeVisible();
  await chooseMarketSource(page, name);
}
