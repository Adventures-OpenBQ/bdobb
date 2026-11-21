// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { liveDailyPriceDataset } from '../../../test/fixtures/liveDailyPrices';
import { dailyPriceParameters } from '../../../test/fixtures/chartSources';
import { dailyPriceRows, priceDataset, priceFields } from './fixtures';
import { priceAcquisitionProvenance, priceOmissionEvidence } from './priceEvidence';
import { admitReturnSummary, dailyReturnSamples, prepareSelectedPrices } from './priceSamples';

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
