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
