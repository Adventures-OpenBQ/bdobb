// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test as base, type Page, type Request } from '@playwright/test';
import type { ReturnSummaryOptions } from '../../src/lib/widgetData/chartRecipes/types';
import { dailyPriceParameters, dailyPriceReceipt, dailyPriceResponse } from '../../src/test/fixtures/chartSources';
import { dashboardSeed, seedApp } from '../fixtures';
import { card, chooseLinkedSource } from './chart-recipes';

export const test = base.extend<{ engineEvidence: { engine: string; wasm: string[] } }>({
  engineEvidence: [async ({ page, browser, browserName }, use, info) => {
    await page.setViewportSize({ width: 1250, height: 930 });
    const wasm: string[] = [];
    page.on('response', response => {
      if (response.ok() && /\/pivot_wasm_bg(?:-[\w-]+)?\.wasm$/.test(new URL(response.url()).pathname)
        && response.headers()['content-type']?.includes('application/wasm')) wasm.push(response.url());
    });
    const engine = process.env.VITE_TABLE_ENGINE || 'typescript';
    await use({ engine, wasm });
    await info.attach('return-runtime', {
      body: JSON.stringify({ engine, browserName, browserVersion: browser.version(), wasm }), contentType: 'application/json',
    });
    if (info.status === 'passed') expect(wasm.length > 0).toBe(engine === 'rust');
  }, { auto: true }],
});

export const returnChart = 'Return summaries example';
export const placeholder = 'Daily price snapshot';
export const sampleName = 'observed-prices.json';
export const workspace = 'Return summary fixtures';
const chartLayout = { x: 0, y: 0, w: 40, h: 29 };
export const returnRecipe: ReturnSummaryOptions = {
  version: 1, kind: 'return-summary', view: 'box', window: { mode: 'own' }, symbols: ['ZZZ.US', 'AAA.US'],
  fields: { date: 'date', price: 'adjusted_close', symbol: 'symbol' },
};

export const closes = (scale: number) => Array.from({ length: 20 }, (_, i) => (i % 5) * scale)
  .reduce((values, value) => [...values, values.at(-1)! * (1 + value)], [1]);

export function returnSnapshot(histories: Record<string, number[]>) {
  const rows = Object.entries(histories).flatMap(([symbol, prices]) => prices.map((adjusted_close, i) => ({
    date: '2026-01-' + String(i + 1).padStart(2, '0'), adjusted_close, symbol,
  })));
  return JSON.stringify({ rows, completeness: 'bounded',
    receipt: { interval: '1d', start_date: '2026-01-01', end_date: '2026-01-31' } });
}

export async function dropFile(page: Page, filename: string, text: string) {
  const transfer = await page.evaluateHandle(([name, body]) => {
    const data = new DataTransfer();
    data.items.add(new File([body], name, { type: 'application/json' }));
    return data;
  }, [filename, text]);
  await page.locator('main.dashboard-area').dispatchEvent('drop', { dataTransfer: transfer });
  await transfer.dispose();
}

export async function chooseReturnSource(page: Page, name: string) {
  await chooseLinkedSource(page, card(page, returnChart), name + ' — ' + 'Returns');
}

export async function prepareReturns(page: Page, snapshot?: string, options = returnRecipe, height = chartLayout.h) {
  const source = { id: 'placeholder', widgetId: 'local_table', backendId: 'builtin', params: {}, title: placeholder,
    layout: { x: 0, y: height, w: 40, h: 12 } };
  const chart = { id: 'returns', widgetId: 'linked_chart', backendId: 'builtin', title: returnChart, params: {},
    linkedSource: { kind: 'widget', sourceWidgetId: 'placeholder' },
    linkedChart: { type: 'return-summary', recipe: options, measures: [], display: 'grouped' },
    layout: { ...chartLayout, h: height } };
  const seed = dashboardSeed([], { name: workspace, tabs: [{ name: 'Returns', id: 't1', cards: [chart, source] }] });
  seed['settings.json'] = JSON.stringify({ theme: 'system' });
  seed['backends.json'] = '[]';
  await seedApp(page, seed);
  if (snapshot) {
    await dropFile(page, sampleName, snapshot);
    await expect(card(page, sampleName)).toBeVisible();
    await chooseReturnSource(page, sampleName);
  }
}

export const liveBackendId = 'daily-prices';
export const dailyPriceCorsHeaders = {
  'Access-Control-Expose-Headers': 'Link, Content-Range, Access-Control-Expose-Headers',
};
export const liveOrigin = 'http://127.0.0.1:17916';
export const alternateLiveOrigin = 'http://127.0.0.1:17918';
export const livePath = '/api/v1/eodhd/equity/price/historical';
export const liveWidget = 'eodhd_equity_price_historical_eodhd_obb';
export const liveTable = 'EODHD daily prices';
export const liveWorkspace = 'Observed return fixtures';
export const liveSourceId = 'dddddddd-2222-4333-8444-555555555555';
export const liveRecipe: ReturnSummaryOptions = { ...returnRecipe, symbols: ['MCD.US', 'AAPL.US'] };

// Synthetic prices on the fixed dates. A separate installed-provider check
// measures the public EODHD histories for these two listings.
export function livePayload(url: URL) {
  const { start_date, end_date, symbol, chart_source, interval } = Object.fromEntries(url.searchParams);
  const symbols = symbol.split(',');
  const dates: string[] = [];
  const end = new Date('2026-11-19T00:00:00Z');
  for (let day = new Date('2026-10-12T00:00:00Z'); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) dates.push(day.toISOString().slice(0, 10));
  }
  const rows = [...symbols].sort().flatMap(listing => dates.flatMap((date, index) => {
    if (date < start_date || date > end_date) return [];
    const adjusted_close = 100 + index + (index % 5) * (listing === 'MCD.US' ? 4 : 7);
    return [{ date, adjusted_close, close: 400 + index, volume: index === 8 ? 2 : 1,
      ...(symbols.length > 1 && { symbol: listing }) }];
  }));
  const listings = symbols.map(listing => {
    const count = symbols.length === 1 ? rows.length : rows.filter(row => row.symbol === listing).length;
    return { symbol: listing, raw_count: count, normalized_count: count, delivered_count: count, duplicate_count: 0, omissions: [] };
  });
  return chart_source === 'true' && interval === '1d'
    ? dailyPriceResponse({ ...dailyPriceReceipt, start_date, end_date, symbols, listings,
      symbol_field: symbols.length > 1 ? 'symbol' : null,
      raw_count: rows.length, normalized_count: rows.length, delivered_count: rows.length }, rows)
    : { results: rows };
}

type LiveOptions = {
  options?: ReturnSummaryOptions; empty?: boolean; optIn?: boolean; runButton?: boolean; sourceOffTab?: boolean;
  pinned?: boolean; ritaUrl?: string; sourceParams?: Record<string, string>; response?: (url: URL, request: Request) => unknown;
};
export async function prepareLiveReturns(page: Page, {
  options, empty, optIn = true, runButton = false, sourceOffTab, pinned, ritaUrl, sourceParams, response = livePayload,
}: LiveOptions = {}) {
  const acquisitions: URL[] = [];
  const requests: Request[] = [];
  const completed: Request[] = [];
  const params = { ...dailyPriceParameters, chart_source: String(optIn), ...sourceParams };
  await page.route(/^http:\/\/127\.0\.0\.1:(17916|17918)\//, async route => {
    const request = route.request(), url = new URL(request.url());
    const isSource = url.pathname === livePath && request.method() === 'GET';
    if (isSource) { acquisitions.push(url); requests.push(request); }
    const payload = isSource ? await response(url, request) : url.pathname === '/widgets.json' ? {
      [liveWidget]: { name: liveTable, description: 'Synthetic bounded daily adjusted prices', type: 'table', endpoint: livePath,
        params: Object.entries(params).map(([paramName, value]) => ({
          paramName, label: ({ symbol: 'Symbol', start_date: 'Source start', end_date: 'Source end', interval: 'Interval' } as Record<string, string>)[paramName] ?? paramName,
          value, type: 'text', show: ['symbol', 'start_date', 'end_date', 'interval'].includes(paramName),
        })),
        data: { dataKey: 'results' }, refetchInterval: false, runButton,
      },
    } : {};
    try {
      await route.fulfill({ contentType: 'application/json', headers: {
        'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS',
        ...dailyPriceCorsHeaders,
      }, status: payload instanceof Error ? 500 : 200, json: payload instanceof Error ? { detail: payload.message } : payload });
    } finally {
      if (isSource) completed.push(request);
    }
  });
  const source = { id: liveSourceId, widgetId: liveWidget, backendId: liveBackendId, params, title: liveTable,
    ...(pinned && { pinned: 'bottom' }), layout: { x: 0, y: sourceOffTab ? 0 : chartLayout.h, w: 40, h: 14 } };
  const chart = { id: 'returns', widgetId: 'linked_chart', backendId: 'builtin', title: returnChart, params: {},
    linkedSource: { kind: 'widget', sourceWidgetId: liveSourceId },
    linkedChart: options ? { type: options.kind, recipe: options, measures: [], display: 'grouped' }
      : { type: 'column', category: 'date', measures: ['adjusted_close'], display: 'grouped' },
    layout: chartLayout };
  const seed = empty ? dashboardSeed([]) : dashboardSeed([], { name: liveWorkspace, tabs: [
    { id: 't1', name: 'Returns', cards: sourceOffTab ? [chart] : [chart, source] },
    { id: 't2', name: 'Prices', cards: sourceOffTab ? [source] : [] },
  ] });
  seed['settings.json'] = JSON.stringify({ theme: 'system', ...(ritaUrl && { ritaUrl, contextSharing: true }) });
  seed['backends.json'] = JSON.stringify([
    { id: liveBackendId, name: 'EODHD prices fixture', baseUrl: liveOrigin, authLocation: 'header', validateWidgets: false },
  ]);
  await seedApp(page, seed);
  return { acquisitions, requests, completed };
}
