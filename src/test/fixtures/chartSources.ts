// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { isDeepStrictEqual } from 'node:util';
import type { ChartSourceAdapter, ChartSourceReceipt } from '../../lib/widgetData/chartRecipes/chartSourceContracts';

export const sourcePath = '/fixture/chart-source';
export const sourceRows = [{ id: 'keep', value: 5 }, { id: 'drop', value: 777 }];
export const sourceReceipt = {
  version: 1, kind: 'metric', retrieved_at: '2026-11-19T09:00:00Z', raw_count: 3,
  normalized_count: 2, delivered_count: 2, unsafe: { missing: true }, diagnostics: ['missing'],
  coordinates: ['keep', 'drop'], instrument: 'A',
} satisfies ChartSourceReceipt & { coordinates: string[]; instrument: string };
export type FixtureSource = typeof sourceReceipt;
export const fixtureAdapter: ChartSourceAdapter<FixtureSource> = {
  kind: 'metric',
  // Intentionally accept only the exact test fixture. Production has no source at this route.
  decode(value) {
    if (isDeepStrictEqual(value, sourceReceipt, { skipPrototype: true })) return structuredClone(sourceReceipt);
  },
  rowsAgree(_receipt, rows, scope) {
    return scope !== 'sample' && rows.every((row, i) => row.id === sourceRows[i]?.id);
  },
  routes: [{
    endpoint: sourcePath, selector: 'results.rows', parameters: ['symbol'],
    matches: (receipt, parameters) => parameters.symbol === receipt.instrument
  }],
  coordinates: () => [{ fields: ['id'], points: sourceReceipt.coordinates.map(id => ({ id, values: [id] })) }],
};
export const fixtureSources = { metric: fixtureAdapter };
export const sourceEnvelope = { version: 1, receipts: [sourceReceipt] };
export const sourceResponse = { results: { rows: sourceRows }, extra: { results_metadata: { chart_sources: sourceEnvelope } } };

// Installed OpenAPI paths and result/receipt records captured at the provider's
// SDK boundary. AAPL sorts first in results but the request selected MCD first.
export const dailyPricePaths = [
  '/api/v1/equity/price/historical', '/api/v1/etf/historical',
  '/api/v1/eodhd/equity/price/historical', '/api/v1/eodhd/etf/historical',
];
export const dailyPriceParameters = {
  provider: 'eodhd', symbol: 'MCD.US,AAPL.US', interval: '1d',
  start_date: '2026-10-12', end_date: '2026-11-19', chart_source: 'true',
};
export const dailyPriceRows = [
  { date: '2026-10-13', open: 100, high: 110, low: 97, close: 105, adjusted_close: 104, volume: 1000, symbol: 'AAPL.US' },
  { date: '2026-10-13', open: 100, high: 110, low: 97, close: 105, adjusted_close: 104, volume: 1000, symbol: 'MCD.US' },
];
export const dailyPriceReceipt = {
  version: 1 as const, kind: 'daily-price' as const, retrieved_at: '2026-11-20T22:32:34.454309Z',
  raw_count: 4, normalized_count: 2, delivered_count: 2, diagnostics: [] as string[],
  unsafe: {
    conflicting_duplicates: false, identity_conflict: false, invalid_response: false,
    missing_adjusted_basis: false, partial_acquisition: false, undatable_loss: false,
  },
  interval: '1d' as const, start_date: '2026-10-12', end_date: '2026-11-19',
  date_field: 'date' as const, price_field: 'adjusted_close' as const, symbol_field: 'symbol' as const,
  symbols: ['MCD.US', 'AAPL.US'],
  listings: [
    { symbol: 'MCD.US', raw_count: 2, normalized_count: 1, delivered_count: 1, duplicate_count: 0, omissions: [['MCD.US', '2026-10-14']] },
    { symbol: 'AAPL.US', raw_count: 2, normalized_count: 1, delivered_count: 1, duplicate_count: 0, omissions: [['AAPL.US', '2026-10-14']] },
  ],
};
export function dailyPriceResponse(receipt: unknown = dailyPriceReceipt, results: Record<string, unknown>[] = dailyPriceRows) {
  return { provider: 'eodhd', chart: null, warnings: null, results, extra: {
    results_metadata: { chart_sources: { version: 1, receipts: [receipt] } },
  } };
}
