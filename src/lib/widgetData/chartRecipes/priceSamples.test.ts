// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { liveDailyPriceDataset } from '../../../test/fixtures/liveDailyPrices';
import { dailyPriceParameters } from '../../../test/fixtures/chartSources';
import { dailyPriceRows, priceDataset, priceFields } from './fixtures';
import { acceptsLiveDailyPriceRecipe, preparePriceChartInput } from './input';
import { priceAcquisitionProvenance, priceOmissionEvidence } from './priceEvidence';
import { admitReturnSummary, dailyReturnSamples, prepareSelectedPrices } from './priceSamples';
import type { RecipeOptions } from './types';

const liveRecipeSupport = {
  drawdown: true, 'return-distribution': true, 'return-summary': true, 'small-multiples': true,
  'yield-curve': false, 'estimate-range': false, 'monthly-returns': false, correlation: false,
  'etf-pareto': false, 'etf-exposure': false, 'bubble-regression': false, 'dividend-steps': false,
  'income-sankey': false, 'news-sentiment-calendar': false, 'ownership-snapshot': false,
  'etf-sunburst': false, 'dual-axis-overlay': false, 'estimate-revisions': false, 'market-map': false,
} satisfies Record<RecipeOptions['kind'], boolean>;

it('supports live daily prices only for the four eligible recipes', () => {
  const kinds = Object.keys(liveRecipeSupport) as (keyof typeof liveRecipeSupport)[];
  for (const kind of kinds) expect(acceptsLiveDailyPriceRecipe(kind), kind).toBe(liveRecipeSupport[kind]);
});

it('preserves adjusted values and provider gap coordinates without certifying completeness', () => {
  const symbol = 'AAPL.US';
  const fields = { date: 'date', price: 'adjusted_close' };
  const dataset = liveDailyPriceDataset([
    { date: '2026-01-07', adjusted_close: 121, close: 130 },
    { date: '2026-01-05', adjusted_close: 100, close: 105 },
  ], [symbol], { omissions: [[symbol, '2026-01-06']] });

  expect(preparePriceChartInput(dataset, fields, 'drawdown')).toEqual({
    ok: true, sourceMode: 'live', scope: { start: '2026-01-01', end: '2026-01-31', interval: '1d' },
    notes: ['Preserved 1 price gap(s) from provider omissions.', '1 price gap(s) in the delivered series.'],
    series: [{ symbol, points: [
      { date: '2026-01-05', price: 100 }, { date: '2026-01-06', price: null }, { date: '2026-01-07', price: 121 },
    ] }],
  });
  expect(dataset.completeness.kind).toBe('unknown');
  expect(preparePriceChartInput(dataset, { ...fields, price: 'close' }, 'drawdown')).toMatchObject({
    ok: false, refused: true, message: 'Choose the source-documented adjusted-price field.',
  });
  expect(preparePriceChartInput(dataset, fields, 'correlation')).toMatchObject({ ok: false, refused: true });
  expect(preparePriceChartInput(dataset, fields, 'monthly-returns')).toMatchObject({ ok: false, refused: true });
});

it('uses live selection only when requested and preserves selected listing order', () => {
  const dataset = liveDailyPriceDataset([
    ...dailyPriceRows([100], 'AAPL.US'), ...dailyPriceRows([200], 'MCD.US'),
  ], ['AAPL.US', 'MCD.US']);
  expect(prepareSelectedPrices(dataset, priceFields, ['AAPL.US'])).toMatchObject({ ok: false, refused: true });
  expect(prepareSelectedPrices(dataset, priceFields, ['AAPL.US'], 'return-distribution')).toMatchObject({
    ok: true, sourceMode: 'live', series: [{ symbol: 'AAPL.US' }],
  });
  expect(prepareSelectedPrices(dataset, priceFields, ['MCD.US', 'AAPL.US'], 'small-multiples')).toMatchObject({
    ok: true, sourceMode: 'live', series: [{ symbol: 'MCD.US' }, { symbol: 'AAPL.US' }],
  });
  expect(prepareSelectedPrices(dataset, priceFields, ['AAPL.US', 'MSFT.US'], 'small-multiples')).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/selected symbol.*MSFT\.US/i),
  });
});

it('reports snapshot mode through both recipe preparation and local selection', () => {
  const dataset = priceDataset(dailyPriceRows([100]));
  expect(preparePriceChartInput(dataset, priceFields, 'drawdown')).toMatchObject({ ok: true, sourceMode: 'snapshot' });
  expect(prepareSelectedPrices(dataset, priceFields, ['A'])).toMatchObject({ ok: true, sourceMode: 'snapshot' });
});

it('preserves zero returns and breaks known gaps', () => {
  const dataset = priceDataset(dailyPriceRows([100, 100, 110, 99]));
  const prepared = prepareSelectedPrices(dataset, priceFields, ['A']);
  if (!prepared.ok) throw new Error(prepared.message);
  const { samples } = dailyReturnSamples(prepared.series[0]);
  expect(samples).toHaveLength(3);
  expect(samples[0].value).toBe(0);
  expect(samples[1].value).toBeCloseTo(.1);
  expect(samples[2].value).toBeCloseTo(-.1);

  const withGap = prepareSelectedPrices(priceDataset(dailyPriceRows([100, 100, null, 200, 300])), priceFields, ['A']);
  if (!withGap.ok) throw new Error(withGap.message);
  expect(dailyReturnSamples(withGap.series[0])).toEqual({
    samples: [{ date: '2026-01-02', value: 0 }, { date: '2026-01-05', value: .5 }],
    excludedNonfinite: 0, gapCount: 1,
  });
});

it('preserves an evidenced omitted point in a projected delivery', () => {
  const dataset = priceDataset(dailyPriceRows([100, 100, 125, 200, 300]));
  const rows = dataset.rows.filter(row => row.values.date !== '2026-01-03');
  dataset.provenance = priceAcquisitionProvenance(dataset);
  const provenance = priceOmissionEvidence(dataset, dataset.rows, rows, Object.values(priceFields));
  const projected = { ...dataset, rows, provenance, kind: 'chartData' };
  const prepared = prepareSelectedPrices(projected, priceFields, ['A']);
  if (!prepared.ok) throw new Error(prepared.message);
  expect(dailyReturnSamples(prepared.series[0])).toEqual({
    samples: [{ date: '2026-01-02', value: 0 }, { date: '2026-01-05', value: .5 }],
    excludedNonfinite: 0, gapCount: 1,
  });
});

it('rejects any unavailable selection while retaining the order of usable selections', () => {
  const [a, b, c] = ['A', 'B', 'C'].map(symbol => dailyPriceRows([100], symbol)[0]);
  const dataset = priceDataset([a, b, c, { ...c, adjusted_close: 101 }]);
  const prepared = prepareSelectedPrices(dataset, priceFields, ['B', 'A']);
  if (!prepared.ok) throw new Error(prepared.message);
  expect(prepared.series.map(series => series.symbol)).toEqual(['B', 'A']);
  expect(prepared.notes.join(' ')).toMatch(/conflicting duplicate prices.*C/i);
  expect(prepareSelectedPrices(dataset, priceFields, ['A', 'C'])).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/selected symbol.*C.*conflicting duplicate prices/i),
  });
  expect(prepareSelectedPrices(dataset, priceFields, ['A', 'ABSENT'])).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/selected symbol.*ABSENT/i),
  });
});

it.each([
  { first: '2026-10-13', second: '2026-10-15', price: 121, missing: undefined, expected: .21 },
  { first: '2026-10-13', second: '2026-10-15', price: 121, missing: '2026-10-14', expected: undefined },
  { first: '2026-10-16', second: '2026-10-19', price: 110, missing: undefined, expected: .10 },
])('pairs observed live quotes from $first through $second with known omission $missing', ({ first, second, price, missing, expected }) => {
  const bounds = { start_date: dailyPriceParameters.start_date, end_date: dailyPriceParameters.end_date };
  const symbol = 'AAA.US';
  const pair = [{ date: first, adjusted_close: 100 }, { date: second, adjusted_close: price }];
  const omissions = missing ? [[symbol, missing] as [string, string]] : [];
  const fields = { date: 'date', price: 'adjusted_close' };
  const short = liveDailyPriceDataset(pair, [symbol], { bounds, omissions });
  expect(admitReturnSummary(short, fields, [symbol], { mode: 'own' })).toMatchObject({
    ok: false, refused: true, message: expect.stringContaining(`Found ${expected === undefined ? 0 : 1}`),
  });

  const tailDates = ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-26'];
  const tail = tailDates.map(date => ({ date, adjusted_close: price }));
  const source = liveDailyPriceDataset([...pair, ...tail], [symbol], { bounds, omissions });
  const result = admitReturnSummary(source, fields, [symbol], { mode: 'own' });
  if (!result.ok) throw new Error(result.message);
  const { samples, gapCount, excludedOpportunities } = result.value.series[0];
  expect(samples.map(sample => sample.date)).toEqual(expected === undefined ? tailDates : [second, ...tailDates]);
  if (expected !== undefined) expect(samples[0].value).toBeCloseTo(expected, 14);
  expect(gapCount).toBe(missing ? 1 : 0);
  expect(excludedOpportunities).toBe(missing ? 2 : 0);
});
