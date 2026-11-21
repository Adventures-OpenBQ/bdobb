// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import { fixtureSources, sourcePath, sourceReceipt, sourceResponse, sourceRows } from '../../../test/fixtures/chartSources';
import {
  captureChartSources, captureMatchedChartSources, readChartSource, type ChartSourceRegistry, type ChartSourceReceipt,
} from './chartSourceContracts';
import { decodeRecipeOptions } from './settings';

const context = { endpoint: sourcePath, parameters: { chart_source: 'true', symbol: 'A' }, selector: 'results.rows', retrievedAt: 1 };
it('matches the completed request, exact selected array and closed family decoder', () => {
  const capture = (c = context, r = sourceResponse, rows = sourceRows) => captureMatchedChartSources(c, r, rows, fixtureSources);
  expect(capture()).toEqual({ metric: sourceReceipt });
  expect(capture({ ...context, endpoint: '/other' })).toBeUndefined();
  expect(capture({ ...context, selector: 'other.rows' })).toBeUndefined();
  expect(capture({ ...context, parameters: { ...context.parameters, chart_source: 'false' } })).toBeUndefined();
  expect(capture({ ...context, parameters: { ...context.parameters, symbol: 'B' } })).toBeUndefined();
  expect(capture(context, sourceResponse, [...sourceRows])).toBeUndefined();
  expect(captureChartSources(context, sourceResponse, sourceRows)).toBeUndefined();
});
it('unknown_or_duplicate_kind_rejected', () => {
  for (const envelope of [
    { version: 1, receipts: [{ ...sourceReceipt, kind: 'alien' }] },
    { version: 1, receipts: [sourceReceipt, sourceReceipt] },
    { version: 1, receipts: [sourceReceipt], proof: true },
    { version: 2, receipts: [sourceReceipt] },
    { version: 1, receipts: [{ ...sourceReceipt, arbitrary: 'fact' }] },
  ]) {
    expect(captureMatchedChartSources(context, { ...sourceResponse, extra: { results_metadata: { chart_sources: envelope } } }, sourceRows, fixtureSources)).toBeUndefined();
  }
});
it('settings_cannot_supply_receipt', () => {
  expect(decodeRecipeOptions({ version: 1, kind: 'income-sankey', periodColumn: 'x', chartSources: { metric: sourceReceipt } }, 'income-sankey').ok).toBe(false);
  expect(readChartSource({ sourceWidgetId: 'x', parameters: { chartSources: { metric: sourceReceipt } } }, 'metric', () => sourceReceipt)).toBeUndefined();
  expect(readChartSource({ sourceWidgetId: 'x', metadata: { chartSources: { metric: sourceReceipt } } }, 'metric', () => sourceReceipt)).toBeUndefined();
});

it('allows multiple independently matched families and withholds only the unmatched route', () => {
  const news = { ...sourceReceipt, kind: 'news' as const };
  const second = { ...fixtureSources.metric, kind: 'news' as const, decode: (v: unknown) => v === news ? news : undefined };
  const registry = { ...fixtureSources, news: second };
  const payload = { ...sourceResponse, extra: { results_metadata: { chart_sources: { version: 1, receipts: [sourceReceipt, news] } } } };
  expect(captureMatchedChartSources(context, payload, sourceRows, registry)).toEqual({ metric: sourceReceipt, news });
  expect(captureMatchedChartSources(context, payload, sourceRows, { ...registry, news: { ...second, routes: [] } })).toEqual({ metric: sourceReceipt });
});

it('keeps the envelope limit at seven independently registered families', () => {
  const kinds: ChartSourceReceipt['kind'][] = [
    'metric', 'news', 'ownership', 'overlay', 'estimate-vintages', 'market-map', 'etf-hierarchy', 'daily-price',
  ];
  const receipts = kinds.map(kind => ({ ...sourceReceipt, kind }));
  const registry: ChartSourceRegistry = Object.fromEntries(receipts.map(receipt => [receipt.kind, {
    ...fixtureSources.metric, kind: receipt.kind, decode: (value: unknown) => value === receipt ? receipt : undefined,
  }]));
  const capture = (amount: number) => captureMatchedChartSources(context, { ...sourceResponse, extra: {
    results_metadata: { chart_sources: { version: 1, receipts: receipts.slice(-amount) } },
  } }, sourceRows, registry);
  expect(Object.keys(capture(7) ?? {})).toEqual(kinds.slice(1));
  expect(capture(8)).toBeUndefined();
});
