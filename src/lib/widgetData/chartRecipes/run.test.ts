// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { liveDailyPriceDataset } from '../../../test/fixtures/liveDailyPrices';
import { datasetFromRows } from '../../localTableData';
import type { WidgetDataset } from '../types';
import { dailyPriceRows, drawdownOptions, priceDataset, priceFields } from './fixtures';
import { runRecipe } from './run';
import type { RecipeContext, RecipeOptions } from './types';

const context = { theme: 'light', maxDecimals: 2, today: '2026-03-01' } as const;
const prices = priceDataset([
  { symbol: 'A', date: '2026-01-27', adjusted_close: 100 },
  { symbol: 'A', date: '2026-01-28', adjusted_close: 110 },
  { symbol: 'A', date: '2026-01-29', adjusted_close: 99 },
  { symbol: 'A', date: '2026-01-30', adjusted_close: 110 },
  { symbol: 'A', date: '2026-02-27', adjusted_close: 121 },
], '2026-01-01', '2026-02-28');
const rates = datasetFromRows([{ date: '2026-01-30', maturity: 'year_10', rate: .04 }], 'rates', 1, 'localFile');
const estimates = datasetFromRows([
  { period_ending: '2025-12-27', band_status: 'ok', eps_low: -1, eps_avg: 0, eps_high: 1 },
], 'estimates', 1, 'localFile');
const estimateOptions = {
  version: 1, kind: 'estimate-range', metric: 'eps',
  fields: { periodEnd: 'period_ending', status: 'band_status', low: 'eps_low', average: 'eps_avg', high: 'eps_high' },
} satisfies RecipeOptions;

function etf(kind: 'holdings' | 'sector') {
  return datasetFromRows([{ symbol: 'ABC', sector: 'Utilities', weight: .25 }], 'fund', 1, 'localFile', undefined, [], {
    completeness: 'unknown', receipt: { fund_symbol: kind === 'sector' ? 'ABC' : 'FUND', etf_kind: kind,
      weight_basis: kind === 'holdings' ? 'fund-assets' : 'equity-exposure' },
  });
}

const cases: [RecipeOptions, WidgetDataset, unknown][] = [
  [drawdownOptions, prices, expect.objectContaining({ type: 'scatter', y: [0, 0, -.1, 0, 0].map(value => expect.closeTo(value, 12)) })],
  [{ version: 1, kind: 'yield-curve', fields: { date: 'date', maturity: 'maturity', rate: 'rate' } }, rates,
    expect.objectContaining({ type: 'scatter', x: [120], y: [.04] })],
  [estimateOptions, estimates, expect.objectContaining({ type: 'scatter', x: [-1, 1], y: ['2025-12-27', '2025-12-27'] })],
  [{ version: 1, kind: 'monthly-returns', fields: priceFields, symbol: 'A' }, prices, expect.objectContaining({
    type: 'heatmap', y: ['2026'], z: [expect.arrayContaining([expect.closeTo(.1, 12)])],
  })],
  [{ version: 1, kind: 'correlation', fields: priceFields, symbols: ['A'], lookback: 252, minOverlap: 3 }, prices,
    expect.objectContaining({ type: 'heatmap', z: [[1]] })],
  [{ version: 1, kind: 'return-distribution', fields: priceFields, symbol: 'A', bins: 30 }, prices,
    expect.objectContaining({ type: 'bar', uid: 'return-distribution' })],
  [{ version: 1, kind: 'small-multiples', fields: priceFields, symbols: ['A'] }, prices,
    expect.objectContaining({ type: 'scatter', name: 'A', xaxis: 'x' })],
  [{ version: 1, kind: 'etf-pareto', fields: { holding: 'symbol', weight: 'weight' } }, etf('holdings'),
    expect.objectContaining({ type: 'bar', y: [.25] })],
  [{ version: 1, kind: 'etf-exposure', mode: 'sector', fields: { category: 'sector', weight: 'weight' } }, etf('sector'),
    expect.objectContaining({ type: 'scatter', mode: 'markers', x: [.25], y: ['Utilities'] })],
];

const liveSymbol = 'AAPL.US';
const liveFields = { date: 'date', price: 'close' };
const liveCases: [RecipeOptions, unknown][] = [
  [{ version: 1, kind: 'return-distribution', fields: liveFields, symbol: liveSymbol, bins: 5 },
    expect.objectContaining({ type: 'bar', y: [1, 0, 1, 0, 1] })],
  [{ version: 1, kind: 'drawdown', fields: liveFields, symbols: [liveSymbol] },
    expect.objectContaining({ name: liveSymbol, y: [0, 0, 0, expect.closeTo(-.1)] })],
  [{ version: 1, kind: 'small-multiples', fields: liveFields, symbols: [liveSymbol] },
    expect.objectContaining({ name: liveSymbol, y: [100, 100, 110, 99] })],
];
const snapshotCases: RecipeOptions[] = [
  { version: 1, kind: 'correlation', fields: liveFields, symbols: [liveSymbol], lookback: 252, minOverlap: 3 },
  { version: 1, kind: 'monthly-returns', fields: liveFields, symbol: liveSymbol },
];

function aliasedLivePrices(quotes: number[], unsafe?: { invalid_response: boolean }): WidgetDataset {
  const dataset = liveDailyPriceDataset(dailyPriceRows(quotes, liveSymbol), [liveSymbol], { unsafe });
  return {
    ...dataset,
    columns: dataset.columns.map(column => column.id === 'adjusted_close'
      ? { ...column, id: 'close', sourceFieldId: 'adjusted_close' } : column),
    rows: dataset.rows.map(row => {
      const { adjusted_close, ...values } = row.values;
      return { ...row, values: { ...values, close: adjusted_close } };
    }),
  };
}

describe('runRecipe', () => {
  it.each(cases)('dispatches %o to its financial builder', (options, dataset, trace) => {
    const result = runRecipe(dataset, options, context);
    if (!result.ok) throw new Error(result.message);
    expect(result.figure.data).toEqual(expect.arrayContaining([trace]));
    expect(result.figure.layout.uirevision).toBe(result.revision);
  });

  it.each(liveCases)('accepts an acquired live price alias for %j', (options, trace) => {
    const dataset = aliasedLivePrices([100, 100, 110, 99]);
    const result = runRecipe(dataset, options, context);
    expect(result).toMatchObject({ ok: true, figure: { data: expect.arrayContaining([trace]) } });

    const wrongOrigin = { ...options, fields: { ...liveFields, price: 'symbol' } } as RecipeOptions;
    expect(runRecipe(dataset, wrongOrigin, context)).toMatchObject({
      ok: false, refused: true, message: 'Choose the source-documented adjusted-price field.',
    });
    const unqualified = aliasedLivePrices([100, 100, 110, 99], { invalid_response: true });
    expect(runRecipe(unqualified, options, context)).toMatchObject({
      ok: false, refused: true, message: expect.stringContaining('Field close cannot supply adjusted price'),
    });
  });

  it.each(snapshotCases)('continues to require snapshot inputs for $kind', options => {
    expect(runRecipe(aliasedLivePrices([100, 110, 99, 121]), options, context)).toMatchObject({
      ok: false, refused: true, message: expect.stringContaining('Field close cannot supply adjusted price'),
    });

    const qualified = liveDailyPriceDataset(dailyPriceRows([100, 110, 99, 121], liveSymbol), [liveSymbol]);
    const canonicalOptions = { ...options, fields: { date: 'date', price: 'adjusted_close' } } as RecipeOptions;
    expect(runRecipe(qualified, canonicalOptions, context)).toMatchObject({
      ok: false, refused: true, message: expect.stringMatching(/fully loaded.*unknown/i),
    });
  });

  it.each(['box', 'violin'] as const)('continues to accept live %s plots through the worker', view => {
    const dataset = aliasedLivePrices(Array.from({ length: 21 }, (_, index) => 100 + index ** 2));
    const result = runRecipe(dataset, {
      version: 1, kind: 'return-summary', fields: liveFields, symbols: [liveSymbol], view, window: { mode: 'own' },
    }, context);
    expect(result).toMatchObject({ ok: true, returnSummary: { view } });
  });

  it.each([
    null,
    { ...drawdownOptions, kind: 'pie' },
    { ...drawdownOptions, version: 2 },
    { ...drawdownOptions, fields: { date: 'date' } },
    { ...estimateOptions, metric: 'eps+revenue' },
    { ...drawdownOptions, get kind() { throw new Error('Unexpected kind getter'); } },
  ])('refuses malformed recipe options at runtime', options => {
    expect(runRecipe(prices, options as RecipeOptions, context)).toMatchObject({ ok: false, refused: true });
  });

  it.each([
    { ...context, theme: 'sepia' }, { ...context, maxDecimals: Infinity }, { ...context, today: '2026-02-30' },
  ])('refuses malformed context at runtime', badContext => {
    expect(runRecipe(prices, drawdownOptions, badContext as RecipeContext)).toMatchObject({
      ok: false, refused: true, message: expect.stringMatching(/context|theme|precision|calendar/i),
    });
  });

  it.each([0, -1, 10_001, Infinity, NaN, '900', null])('refuses invalid viewport width %s', viewportWidth => {
    expect(runRecipe(prices, drawdownOptions, { ...context, viewportWidth } as RecipeContext)).toMatchObject({
      ok: false, refused: true, message: expect.stringMatching(/viewport width/i),
    });
  });

  it.each([0, -1, 10_001, Infinity, NaN, '400', null])('refuses invalid viewport height %s', viewportHeight => {
    expect(runRecipe(prices, drawdownOptions, { ...context, viewportHeight } as RecipeContext)).toMatchObject({
      ok: false, refused: true, message: expect.stringMatching(/viewport height/i),
    });
  });

  it.each([undefined, 0.5, 900, 10_000])('accepts optional viewport width %s without changing the existing result', viewportWidth => {
    const sized = { ...context, viewportWidth };
    expect(runRecipe(prices, drawdownOptions, sized)).toEqual(runRecipe(prices, drawdownOptions, context));
  });

  it('returns an actionable refusal for a malformed chart dataset', () => {
    expect(runRecipe({ ...prices, rows: [null] } as unknown as WidgetDataset, drawdownOptions, context))
      .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/dataset|table/i) });
  });

  it('refuses malformed column precision before rendering a curve', () => {
    const bad = { ...rates, columns: rates.columns.map(column =>
      column.id === 'rate' ? { ...column, format: { decimalPlaces: -1 } } : column) };
    expect(runRecipe(bad, cases[1][0], context))
      .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/dataset|table/i) });
  });

  it('keeps completeness rules specific to each source type', () => {
    const partial = (dataset: WidgetDataset): WidgetDataset =>
      ({ ...dataset, completeness: { ...dataset.completeness, kind: 'partial' } });
    expect(runRecipe(partial(prices), drawdownOptions, context)).toMatchObject({
      ok: false, refused: true, message: expect.stringMatching(/fully loaded/i),
    });
    expect(runRecipe(partial(rates), cases[1][0], context)).toMatchObject({
      ok: false, refused: true, message: expect.stringMatching(/fully loaded/i),
    });
    expect(runRecipe(partial(estimates), estimateOptions, context).ok).toBe(true);
  });
});
