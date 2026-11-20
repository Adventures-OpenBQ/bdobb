// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, type Page } from '@playwright/test';
import type { EtfSunburstOptions } from '../../src/lib/widgetData/chartRecipes/types';
import { live, local, rows, stamp } from '../../src/test/fixtures/etfHierarchyEvidence';
import { dashboardSeed, seedApp } from '../fixtures';
import { card, chooseLinkedSource } from './chart-recipes';
import { dropFile } from './return-summary';

export const chartName = 'ETF composition';
export const workspace = 'ETF sunburst fixtures';
export const tab = 'Fund holdings';
export const placeholder = 'ETF snapshot source';
export const file = 'holdings.json';
export const backendOrigin = 'http://127.0.0.1:17924';
export const backendPath = '/api/v1/eodhd/etf/holdings';
const backendId = 'etf-holdings-fixtures';
const backendWidget = 'etf_holdings_fixture';
const params = { chart_source: 'true', symbol: 'VTI.US' };

export const recipe: EtfSunburstOptions = { version: 1, kind: 'etf-sunburst', fund: 'VTI.US', depth: 2,
  snapshot: 'latest', fields: { holding: 'symbol', sector: 'sector', weight: 'weight' } };

export function snapshot({ weights = [.12, .15, .08, 0], date, sameSector = false }: {
  weights?: number[]; date?: string; sameSector?: boolean;
} = {}) {
  const holdings = weights.map((weight, i) => ({
    ...rows[i % 2], symbol: ['AAPL.US', 'AAYA.F', 'MSFT.US', 'ZERO.US'][i],
    name: i === 0 ? 'keep this' : 'filter out', weight,
    sector: sameSector ? 'Technology' : rows[i % 2].sector, snapshot: date ?? stamp,
  }));
  const receipt = { ...local, snapshot: date ?? stamp, as_of: date ?? null, raw_count: holdings.length,
    normalized_count: holdings.length, delivered_count: holdings.length, holding_keys: holdings.map(row => row.symbol) };
  return { rows: holdings, completeness: 'partial', chart_sources: { version: 1, receipts: [receipt] } };
}

export async function prepareEtf(page: Page, { backend = false, options, empty = false }: {
  backend?: boolean; options?: EtfSunburstOptions; empty?: boolean;
} = {}) {
  const acquisitions: string[] = [];
  if (backend) await page.route(backendOrigin + '/**', async route => {
    const url = new URL(route.request().url());
    const isHoldings = url.pathname === backendPath;
    if (isHoldings) acquisitions.push(url.href);
    const payload = isHoldings ? {
      results: [{ ...rows[0], weight: .2 }, { ...rows[1], weight: .15 }],
      extra: { results_metadata: { chart_sources: { version: 1, receipts: [live] } } },
    } : url.pathname === '/widgets.json' ? {
      [backendWidget]: { name: 'Fictional ETF holdings', description: 'Fictional holdings contract response',
        type: 'table', endpoint: backendPath, params: Object.entries(params).map(([paramName, value]) =>
          ({ paramName, label: paramName, value, type: 'text' })), data: { dataKey: 'results' }, refetchInterval: false },
    } : {};
    await route.fulfill({ json: payload, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  const source = backend ? { widgetId: backendWidget, backendId, params, title: 'Fictional ETF holdings' }
    : { widgetId: 'local_table', backendId: 'builtin', params: {}, title: placeholder };
  const cards = [
    { id: 'chart', widgetId: 'linked_chart', backendId: 'builtin', title: chartName, params: {},
      linkedSource: { kind: 'widget', sourceWidgetId: 'source' },
      linkedChart: options ? { type: 'etf-sunburst', recipe: options, measures: [], display: 'grouped' }
        : { type: 'column', measures: [], display: 'grouped' },
      layout: { x: 0, y: 0, w: 36, h: 27 } },
    { ...source, id: 'source', layout: { x: 0, y: 27, w: 36, h: 12 } },
  ];
  const seed = empty ? dashboardSeed([]) : dashboardSeed([], { name: workspace, tabs: [{ name: tab, id: 't1', cards }] });
  seed['settings.json'] = JSON.stringify({ theme: 'system' });
  seed['backends.json'] = JSON.stringify(backend ? [
    { id: backendId, name: 'Fictional holdings fixture', baseUrl: backendOrigin, authLocation: 'header', validateWidgets: false },
  ] : []);
  await seedApp(page, seed);
  return acquisitions;
}

export async function chooseEtfSource(page: Page, name: string) {
  await chooseLinkedSource(page, card(page, chartName), name + ' — ' + tab);
}

export async function attachHoldings(page: Page, content: unknown = snapshot(), name = file) {
  await dropFile(page, name, JSON.stringify(content));
  await expect(card(page, name)).toBeVisible();
  await chooseEtfSource(page, name);
}
