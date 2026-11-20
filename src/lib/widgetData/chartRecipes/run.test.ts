// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { datasetFromRows } from '../../localTableData';
import type { WidgetDataset } from '../types';
import { drawdownOptions, priceDataset, priceFields } from './fixtures';
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

describe('runRecipe', () => {
  it.each(cases)('dispatches %o to its financial builder', (options, dataset, trace) => {
    const result = runRecipe(dataset, options, context);
    if (!result.ok) throw new Error(result.message);
    expect(result.figure.data).toEqual(expect.arrayContaining([trace]));
    expect(result.figure.layout.uirevision).toBe(result.revision);
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
