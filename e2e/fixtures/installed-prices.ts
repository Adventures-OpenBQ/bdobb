// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { seedCards, type SeedCard } from '../fixtures';

type PriceRow = { symbol: string; date: string; adjusted_close: number };
export type CaptureRoute = {
  method: string;
  query: Record<string, string>;
  status: number;
  widgetId: string;
  selector: string;
  widget: { data: { dataKey: string } };
  expected: Record<string, { returns: { date: string; value: number }[] }>;
  body: {
    results: PriceRow[];
    extra: { results_metadata: { chart_sources: { receipts: {
      listings: { symbol: string; omissions: [symbol: string, date: string][] }[];
    }[] } } };
  };
};
type Capture = {
  qualification: object;
  routes: Record<string, CaptureRoute>;
  directPublicCaptures?: Record<string, { response: Omit<PriceRow, 'symbol'>[] }>;
};

const origin = 'http://127.0.0.1:17926';
export const table = 'Captured EODHD prices';
export const sourceId = 'aaaaaaaa-2222-4333-8444-555555555555';

export const readCapture = (name: string) => JSON.parse(readFileSync(
  new URL(`./installed-observed-returns/75a9026/${name}.json`, import.meta.url), 'utf8',
)) as Capture;

export async function replayInstalledPrices(page: Page, endpoint: string, route: CaptureRoute, charts: SeedCard[], tableY: number) {
  const requests: { method: string; query: Record<string, string> }[] = [];
  await page.route(`${origin}/**`, async intercepted => {
    const request = intercepted.request(), url = new URL(request.url());
    const source = url.pathname === endpoint && request.method() === 'GET';
    if (source) requests.push({ method: request.method(), query: Object.fromEntries(url.searchParams) });
    const body = source ? route.body : url.pathname === '/widgets.json' ? { [route.widgetId]: route.widget } : {};
    await intercepted.fulfill({ json: body, status: source ? route.status : 200, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  const backend = { id: 'captured-eodhd', name: 'Captured EODHD', baseUrl: origin, authLocation: 'header', validateWidgets: false };
  await seedCards(page, [...charts, { id: sourceId, widgetId: route.widgetId, backendId: backend.id, title: table,
    params: route.query, layout: { x: 0, y: tableY, w: 40, h: 14 } }], { 'backends.json': JSON.stringify([backend]) });
  return requests;
}
