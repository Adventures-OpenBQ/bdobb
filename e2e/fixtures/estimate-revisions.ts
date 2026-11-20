// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, type Page } from '@playwright/test';
import type { EstimateRevisionsOptions } from '../../src/lib/widgetData/chartRecipes/types';
import { dashboardSeed, seedApp } from '../fixtures';
import { card, chooseLinkedSource } from './chart-recipes';
import { dropFile } from './return-summary';

export const workspace = 'Estimate history fixtures';
export const tab = 'Estimate history';
export const chartName = 'Consensus change';
export const placeholder = 'Estimate history source';
export const sampleName = 'recorded-estimates.json';

export const liveTitle = 'Legacy analyst estimates';
export const liveOrigin = 'http://127.0.0.1:17923';
export const livePath = '/api/v1/equity/estimates/analyst';

export async function seedRevisions(page: Page, options?: EstimateRevisionsOptions, empty = false, height = 32, live = false) {
  if (live) await page.route(liveOrigin + '/**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      headers: { 'Access-Control-Allow-Origin': '*' },
      json: path === livePath ? { results: [
        { date: '2026-12-31', eps_avg: 1.25, eps_low: 1.1, eps_high: 1.4, eps_avg_7_days_ago: 1.05 },
        { date: '2027-03-31', eps_avg: 1.5, eps_low: 1.32, eps_high: 1.68, eps_avg_7_days_ago: 1.35 },
      ] } : path === '/widgets.json' ? {
        legacy_estimates: { name: liveTitle, description: 'Legacy analyst target-period response', type: 'table',
          endpoint: livePath, data: { dataKey: 'results' }, params: [], refetchInterval: false },
      } : {},
    });
  });
  const cards = [
    { id: 'chart', widgetId: 'linked_chart', backendId: 'builtin', title: chartName, params: {},
      linkedSource: { kind: 'widget', sourceWidgetId: 'source' },
      linkedChart: { type: options?.kind ?? 'column', recipe: options, measures: [], display: 'grouped' },
      layout: { x: 0, y: 0, w: 36, h: height } },
    { id: 'source', params: {}, ...(live ? { widgetId: 'legacy_estimates', backendId: 'vintage-fixture', title: liveTitle }
      : { widgetId: 'local_table', backendId: 'builtin', title: placeholder }),
      layout: { x: 0, y: height, w: 36, h: 12 } },
  ];
  const seed = empty ? dashboardSeed([]) : dashboardSeed([], { name: workspace, tabs: [{ name: tab, id: 't1', cards }] });
  seed['settings.json'] = JSON.stringify({ theme: 'system' });
  seed['backends.json'] = JSON.stringify(live ? [
    { id: 'vintage-fixture', name: 'Legacy estimate fixture', baseUrl: liveOrigin, authLocation: 'header', validateWidgets: false },
  ] : []);
  await seedApp(page, seed);
}

export async function chooseRevisionSource(page: Page, name: string) {
  await chooseLinkedSource(page, card(page, chartName), name + ' — ' + tab);
}

export async function attachRevisions(page: Page, snapshot: unknown, name = sampleName) {
  await dropFile(page, name, JSON.stringify(snapshot));
  await expect(card(page, name)).toBeVisible();
  await chooseRevisionSource(page, name);
}
