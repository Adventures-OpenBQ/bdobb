// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import { startMockServer } from '../src/test/mockServer';
import type { ReturnSummaryDetails } from '../src/lib/widgetData/chartRecipes/returnSummary';
import type { RecipeReply } from '../src/lib/widgetData/chartRecipes/workerClient';
import { dashboardSeed, seedApp } from './fixtures';
import { card, openParameters, plot } from './fixtures/chart-recipes';
import { dailyPriceCorsHeaders, liveRecipe, test } from './fixtures/return-summary';

type Sample = { date: string; value: number };
type InstalledCapture = {
  routes: Record<string, {
    method: string;
    query: Record<string, string>;
    status: number;
    selector: string;
    widgetId: string;
    widget: { data: { dataKey: string } };
    body: object;
    expected: Record<string, { returns: Sample[] }>;
  }>;
};

const origin = 'http://127.0.0.1:17926';
const table = 'Captured EODHD prices';
const chart = 'Captured return summaries';
const sourceId = 'aaaaaaaa-2222-4333-8444-555555555555';
const scope = 'Observed quote-to-quote returns; exchange-session completeness unknown.';
const readCapture = (name: string) => JSON.parse(readFileSync(
  new URL(`./fixtures/installed-observed-returns/75a9026/${name}.json`, import.meta.url), 'utf8',
)) as InstalledCapture;

const equity = '/equity/price/historical', etf = '/etf/historical';
const captures = [
  ['canonical-standards', ['/api/v1' + equity, '/api/v1' + etf]],
  ['deterministic-sdk', ['/api/v1/eodhd' + equity, '/api/v1/eodhd' + etf]],
  ['public-demo', ['/api/v1/eodhd' + equity]],
] as const;

function installedSourceSeed(capture: InstalledCapture['routes'][string], baseUrl: string) {
  const seed = dashboardSeed([
    { id: 'returns', widgetId: 'linked_chart', backendId: 'builtin', title: chart, params: {},
      linkedSource: { kind: 'widget', sourceWidgetId: sourceId },
      linkedChart: { type: 'return-summary', recipe: liveRecipe, measures: [], display: 'grouped' },
      layout: { x: 0, y: 0, w: 40, h: 29 } },
    { id: sourceId, widgetId: capture.widgetId, backendId: 'captured-eodhd', title: table, params: capture.query,
      layout: { x: 0, y: 29, w: 40, h: 14 } },
  ]);
  seed['backends.json'] = JSON.stringify([
    { id: 'captured-eodhd', name: 'Captured EODHD', baseUrl, authLocation: 'header', validateWidgets: false },
  ]);
  return seed;
}

for (const [name, endpoints] of captures) {
  for (const endpoint of endpoints) {
    test(`replays installed ${name} GET ${endpoint} through the table and recipe worker`, async ({ page, browser, engineEvidence }, info) => {
      const capture = readCapture(name).routes[endpoint];
      expect(capture.widget.data.dataKey).toBe(capture.selector);
      await page.addInitScript(() => {
        const observedReturns: ReturnSummaryDetails[] = [];
        Object.defineProperty(window, 'observedReturns', { value: observedReturns });
        window.Worker = class extends Worker {
          constructor(...args: ConstructorParameters<typeof Worker>) {
            super(...args);
            if (String(args[0]).includes('/recipe.worker')) {
              this.addEventListener('message', (event: MessageEvent<RecipeReply>) => {
                if ('result' in event.data && event.data.result.ok && event.data.result.returnSummary) {
                  observedReturns.push(event.data.result.returnSummary);
                }
              });
            }
          }
        };
      });
      const requests: { method: string; query: Record<string, string> }[] = [];
      await page.route(`${origin}/**`, async route => {
        const request = route.request(), url = new URL(request.url());
        const source = url.pathname === endpoint && request.method() === 'GET';
        if (source) requests.push({ method: request.method(), query: Object.fromEntries(url.searchParams) });
        const body = source ? capture.body : url.pathname === '/widgets.json'
          ? { [capture.widgetId]: capture.widget } : {};
        await route.fulfill({
          json: body, status: source ? capture.status : 200, headers: { 'Access-Control-Allow-Origin': '*', ...dailyPriceCorsHeaders },
        });
      });
      await seedApp(page, installedSourceSeed(capture, origin));

      const widget = card(page, chart), graph = plot(page, chart);
      const expected = liveRecipe.symbols.map(symbol => ({ symbol, samples: capture.expected[symbol].returns }));
      const assertSamples = async (view: 'box' | 'violin') => {
        const series = () => page.evaluate(view => {
          const replies = (window as Window & { observedReturns?: ReturnSummaryDetails[] }).observedReturns;
          return replies?.slice().reverse().find(reply => reply.view === view)
            ?.series.map(({ symbol, samples }) => ({ symbol, samples }));
        }, view);
        await expect.poll(series).toEqual(expected);
        await info.attach(`${view}-worker-samples`, {
          body: JSON.stringify(await series()), contentType: 'application/json',
        });
      };
      await expect(card(page, table).getByRole('columnheader', { name: /adjusted.close/i })).toBeVisible();
      await expect(graph.locator('.boxlayer path.box')).toHaveCount(2);
      await expect(widget.getByText(scope, { exact: true })).toBeVisible();
      await assertSamples('box');
      const requestCount = requests.length;
      expect(requestCount).toBeGreaterThan(0);
      expect(requests).toEqual(Array(requestCount).fill({ method: capture.method, query: capture.query }));

      if (name === 'public-demo') {
        const panel = await openParameters(widget);
        await panel.getByLabel('Return view').selectOption('violin');
        await panel.getByRole('button', { name: 'Apply chart settings' }).click();
        await expect(graph.locator('.scatterlayer path.js-fill')).toHaveCount(2);
        await assertSamples('violin');
        expect(requests).toHaveLength(requestCount);
      }
      await info.attach('installed-replay-runtime', {
        body: JSON.stringify({ ...engineEvidence, version: browser.version(), requests }), contentType: 'application/json',
      });
    });
  }
}

const transportCases = [
  { name: 'standard 200', status: 200, headers: dailyPriceCorsHeaders, rejected: false },
  { name: '206 Partial Content', status: 206, headers: { 'Content-Range': 'items 0-57/100' }, rejected: true },
  { name: 'exposed Content-Range', status: 200, headers: {
    ...dailyPriceCorsHeaders, 'Content-Range': 'items 0-57/100',
  }, rejected: true },
  { name: 'exposed next link', status: 200, headers: {
    ...dailyPriceCorsHeaders, Link: '</prices?page=2>; rel="next"',
  }, rejected: true },
  { name: 'exposed help link', status: 200, headers: {
    ...dailyPriceCorsHeaders, Link: '</guide/next>; rel="help"',
  }, rejected: false },
  { name: 'unexposed 200 headers', status: 200, headers: {
    Link: '</prices?page=2>; rel="next"', 'Content-Range': 'items 0-57/100',
  }, rejected: true, checkHiddenHeaders: true },
  { name: 'incomplete CORS exposure', status: 200, headers: {
    'Access-Control-Expose-Headers': 'Link, Access-Control-Expose-Headers',
  }, rejected: true },
  { name: 'CORS policy with hidden exposure list', status: 200, headers: {
    'Access-Control-Expose-Headers': 'Link, Content-Range',
  }, rejected: true },
];

for (const { name, status, headers, rejected, checkHiddenHeaders } of transportCases) {
  test(`checks a cross-origin installed response with ${name}`, async ({ page }) => {
    const endpoint = '/api/v1/eodhd' + equity;
    const capture = readCapture('public-demo').routes[endpoint];
    const server = await startMockServer({
      '/widgets.json': { [capture.widgetId]: capture.widget },
      '/apps.json': [],
      [endpoint]: { __status: status, __body: capture.body, __headers: headers },
    });
    try {
      await seedApp(page, installedSourceSeed(capture, server.url));
      expect(new URL(page.url()).origin).not.toBe(server.url);
      if (checkHiddenHeaders) {
        const head = await page.evaluate(async (url) => {
          const response = await fetch(url);
          return { type: response.type, status: response.status, link: response.headers.get('link'),
            range: response.headers.get('content-range') };
        }, server.url + endpoint);
        expect(head).toEqual({ type: 'cors', status: 200, link: null, range: null });
      }
      await expect(card(page, table).getByRole('columnheader', { name: /adjusted.close/i })).toBeVisible();
      expect(server.requests.filter(request => request.path === endpoint).map(request => request.method)).toContain('GET');

      const widget = card(page, chart), graph = plot(page, chart);
      if (rejected) {
        await expect(widget).toContainText(/cannot verify its daily-price acquisition/i);
        await expect(graph.locator('.boxlayer path.box')).toHaveCount(0);
        const panel = await openParameters(widget);
        await expect(panel.getByRole('button', { name: 'Apply chart settings' })).toBeDisabled();
      } else {
        await expect(graph.locator('.boxlayer path.box')).toHaveCount(2);
        await expect(widget.getByText(scope, { exact: true })).toBeVisible();
      }
    } finally { await server.close(); }
  });
}
