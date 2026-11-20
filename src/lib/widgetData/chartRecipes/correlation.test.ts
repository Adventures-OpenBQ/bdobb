// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { buildCorrelation } from './correlation';
import { priceDataset, priceFields } from './fixtures';
import type { RecipeOptions, RecipeResult } from './types';

const defaults = {
  version: 1, kind: 'correlation', fields: priceFields, symbols: ['A', 'B'], lookback: 252, minOverlap: 60,
} satisfies RecipeOptions;
const options = { ...defaults, minOverlap: 3 };
const context = { theme: 'light', maxDecimals: 2, today: '2026-02-15' } as const;
const row = (symbol: string, day: number, price: number | null) =>
  ({ date: `2026-01-${String(day).padStart(2, '0')}`, adjusted_close: price, symbol });
const closes = (symbol: string, prices: (number | null)[], days = [2, 5, 6, 7, 8, 9, 12]) =>
  prices.map((price, index) => row(symbol, days[index], price));
const fixture = [
  ...closes('A', [100, 110, 99, 118.8]),
  ...closes('B', [200, 220, 198, 237.6]),
  ...closes('C', [100, 90, 99, 79.2]),
  ...closes('D', [100, 125, 156.25, 195.3125]),
];

function heatmap(result: RecipeResult) {
  if (!result.ok) throw new Error(result.message);
  expect(result.figure.data).toEqual([expect.objectContaining({ type: 'heatmap' })]);
  return result.figure.data[0] as {
    uid: string;
    x: string[];
    y: string[];
    z: (number | null)[][];
    customdata: [string, string, number, string, string, string][][];
    zmin: number;
    zmax: number;
    hoverongaps: boolean;
    hovertemplate: string;
  };
}

describe('buildCorrelation', () => {
  it('plots mirrored Pearson coefficients and leaves constant-return pairs blank', () => {
    const result = buildCorrelation(priceDataset(fixture), { ...options, symbols: ['D', 'B', 'A', 'C'] }, context);
    const trace = heatmap(result);

    expect(trace.y).toEqual(trace.x);
    expect(trace.z[0][0]).toBe(1);
    expect(trace.z[0][1]).toBeCloseTo(1, 12);
    expect(trace.z[0][2]).toBeCloseTo(-1, 12);
    expect(trace.z[0][3]).toBeNull();
    expect(trace.z[3][3]).toBeNull();
    for (let i = 0; i < trace.z.length; i++) {
      for (let j = 0; j < trace.z.length; j++) {
        expect(trace.z[i][j]).toBe(trace.z[j][i]);
        expect(trace.customdata[i][j].slice(2, 5)).toEqual([3, '2026-01-05', '2026-01-07']);
      }
    }
    expect(trace.customdata[0][1].slice(0, 2)).toEqual(['A', 'B']);
    expect(trace.customdata[0][3][5]).toMatch(/unavailable.*constant/i);
    expect(trace.zmin).toBe(-1);
    expect(trace.zmax).toBe(1);
    expect(trace.hoverongaps).toBe(true);
    expect(trace.hovertemplate).toContain('%{customdata[2]}');
    if (!result.ok) throw new Error(result.message);
    expect(result.figure.layout.xaxis).toMatchObject({ ticktext: ['A', 'B', 'C', 'D'], tickvals: trace.x });
    expect(result.notes.join(' ')).toMatch(/pairwise.*positive.semidefinite/i);
  });

  it('reports the actual overlap when fewer than 60 matching returns arrive at the default settings', () => {
    const result = buildCorrelation(priceDataset(fixture), defaults, context);
    const trace = heatmap(result);

    expect(trace.z).toEqual([[null, null], [null, null]]);
    expect(trace.customdata[0][1].slice(2, 5)).toEqual([3, '2026-01-05', '2026-01-07']);
    expect(trace.customdata[0][1][5]).toContain('60');
    if (!result.ok) throw new Error(result.message);
    expect(result.notes.join(' ')).toMatch(/3 of 252 return-date positions/);
  });

  it('uses one trailing union window ending at the earliest delivered close date', () => {
    const dataset = priceDataset([
      ...closes('A', [100, 110, 99, 118.8, 95.04, 99.792, 199.584]),
      ...closes('B', [200, 220, 264, 211.2, 221.76, 332.64], [2, 5, 7, 8, 9, 12]),
      ...closes('C', [50, 55, 49.5], [2, 6, 9]),
    ]);
    dataset.completeness.acquiredRowCount = dataset.rows.length + 1;
    dataset.provenance.metadata = { priceOmissions: {
      acquired: dataset.rows.length + 1, delivered: dataset.rows.length, dateField: 'date',
      symbolFields: ['symbol'], points: [['C', '2026-01-12']],
    } };

    const trace = heatmap(buildCorrelation(dataset, { ...options, symbols: ['A', 'B', 'C'], lookback: 4 }, context));

    expect(trace.z[0][1]).toBeCloseTo(1, 12);
    expect(trace.customdata[0][0].slice(2, 5)).toEqual([4, '2026-01-06', '2026-01-09']);
    expect(trace.customdata[0][1].slice(2, 5)).toEqual([3, '2026-01-07', '2026-01-09']);
    expect(trace.customdata[0][2].slice(2, 5)).toEqual([2, '2026-01-06', '2026-01-09']);
    expect(trace.customdata[1][2].slice(2, 5)).toEqual([1, '2026-01-09', '2026-01-09']);
    expect(trace.z[1][2]).toBeNull();
  });

  it.each(['delivered null', 'documented omission'])('breaks adjacent returns at a %s while using the Friday close for Monday', gap => {
    const dataset = priceDataset([
      ...closes('A', [100, 110, 135, 108, 118.8], [2, 5, 7, 8, 9]),
      ...closes('B', [200, 220, 198, 237.6, 190.08, 209.088]),
      ...(gap === 'delivered null' ? [row('A', 6, null)] : []),
    ]);
    if (gap === 'documented omission') {
      dataset.completeness.acquiredRowCount = dataset.rows.length + 1;
      dataset.provenance.metadata = { priceOmissions: {
        acquired: dataset.rows.length + 1, delivered: dataset.rows.length, dateField: 'date',
        symbolFields: ['symbol'], points: [['A', '2026-01-06']],
      } };
    }

    const result = buildCorrelation(dataset, options, context);
    const trace = heatmap(result);
    expect(trace.z[0][1]).toBeCloseTo(1, 12);
    expect(trace.customdata[0][1].slice(2, 5)).toEqual([3, '2026-01-05', '2026-01-09']);
    expect(trace.customdata[1][1][2]).toBe(5);
    if (!result.ok) throw new Error(result.message);
    expect(result.notes.join(' ')).toMatch(/provider gaps.*market holidays/i);
  });

  it('keeps a truly delivered final null date as a shared cutoff', () => {
    const dataset = priceDataset([
      ...closes('A', [100, 110, 99, null]),
      ...closes('B', [200, 220, 198, 237.6, 190.08]),
    ]);
    const trace = heatmap(buildCorrelation(dataset, options, context));

    expect(trace.customdata[0][1].slice(2, 5)).toEqual([2, '2026-01-05', '2026-01-06']);
    expect(trace.customdata[1][1].slice(2, 5)).toEqual([3, '2026-01-05', '2026-01-07']);
  });

  it('uses the evidenced identity and authored calendar dates for a single-symbol source', () => {
    const dataset = priceDataset(closes('A', [100, 110, 99, 118.8]).map(({ date, adjusted_close }) =>
      ({ date: `${date}T23:00:00-05:00`, adjusted_close })));
    dataset.provenance.receipt = { ...dataset.provenance.receipt, symbol: 'A' };
    const trace = heatmap(buildCorrelation(dataset, {
      ...options, symbols: ['A'], fields: { date: 'date', price: 'adjusted_close' },
    }, context));
    expect(trace.z).toEqual([[1]]);
    expect(trace.customdata[0][0].slice(0, 5)).toEqual(['A', 'A', 3, '2026-01-05', '2026-01-07']);
  });

  it('keeps a represented all-null symbol unavailable and refuses a symbol without delivered rows', () => {
    const dataset = priceDataset([...fixture, row('E', 7, null)]);
    const trace = heatmap(buildCorrelation(dataset, { ...options, symbols: ['A', 'E'] }, context));
    expect(trace.z).toEqual([[1, null], [null, null]]);
    expect(trace.customdata[0][1][2]).toBe(0);
    expect(buildCorrelation(dataset, { ...options, symbols: ['A', 'F'] }, context)).toMatchObject({
      ok: false, refused: true, message: expect.stringMatching(/F.*delivered/i),
    });
  });

  it('centers and scales finite returns even when an unscaled variance would overflow', () => {
    const dataset = priceDataset([
      ...closes('A', [1, 1e200, 1, 1e201]),
      ...closes('B', [2, 2e200, 2, 2e201]),
    ]);
    const trace = heatmap(buildCorrelation(dataset, options, context));
    expect(trace.z[0][1]).toBeCloseTo(1, 12);
    expect(trace.customdata[0][1][2]).toBe(3);
  });

  it('keeps small but representable return variation', () => {
    const step = Number.EPSILON;
    const prices = [1, 1 + step, 1 - step, 1 + 2 * step];
    const dataset = priceDataset([...closes('A', prices), ...closes('B', prices.map(price => 2 * price))]);
    const trace = heatmap(buildCorrelation(dataset, options, context));
    expect(trace.z[0][1]).toBeCloseTo(1, 12);
    expect(trace.z[0][0]).toBe(1);
  });

  it('excludes nonfinite returns from paired counts', () => {
    const dataset = priceDataset([
      ...closes('A', [Number.MIN_VALUE, 1e300, 100, 110]),
      ...closes('B', [200, 220, 198, 237.6]),
    ]);
    const trace = heatmap(buildCorrelation(dataset, options, context));
    expect(trace.z[0][1]).toBeNull();
    expect(trace.customdata[0][1].slice(2, 5)).toEqual([2, '2026-01-06', '2026-01-07']);
  });

  it.each([
    { symbols: Array.from({ length: 26 }, (_, index) => `S${index}`) },
    { symbols: ['A', 'A'] },
    { lookback: 2 },
    { minOverlap: 2 },
    { lookback: 3, minOverlap: 4 },
  ])('refuses invalid correlation options %o', patch => {
    expect(buildCorrelation(priceDataset(fixture), { ...options, ...patch }, context))
      .toMatchObject({ ok: false, refused: true });
  });

  it('refuses aggregated data even with daily receipt metadata', () => {
    const dataset = priceDataset(fixture);
    dataset.provenance.inputMayContainAggregates = true;
    expect(buildCorrelation(dataset, options, context)).toMatchObject({
      ok: false, refused: true, message: expect.stringMatching(/raw observations/i),
    });
  });

  it('escapes symbols in Plotly labels and preserves trace and question identity on refresh', () => {
    const symbol = '<b>A&B</b>';
    const dataset = priceDataset([...closes(symbol, [100, 110, 99, 118.8]), ...closes('constructor', [200, 220, 198, 237.6])]);
    const selected = { ...options, symbols: ['constructor', symbol] };
    const initial = buildCorrelation(dataset, selected, context);
    const refreshed = buildCorrelation({
      ...priceDataset([...closes(symbol, [100, 110, 99, 106.92]), ...closes('constructor', [200, 220, 198, 237.6])]),
      resultRevision: 2, outputRevision: 2,
    }, { ...selected, symbols: [symbol, 'constructor'] }, { ...context, theme: 'dark', maxDecimals: 3 });
    const changed = buildCorrelation(dataset, { ...selected, lookback: 3 }, context);

    const before = heatmap(initial);
    const after = heatmap(refreshed);
    expect(before.x).not.toContain('constructor');
    expect(before.customdata[0][1][0]).toBe('&lt;b&gt;A&amp;B&lt;/b&gt;');
    expect(before.uid).toMatch(/^[a-z0-9-]+$/);
    expect(after.uid).toBe(before.uid);
    expect(after.z[0][1]).not.toBeCloseTo(1, 5);
    if (!initial.ok || !refreshed.ok || !changed.ok) throw new Error('Expected three figures.');
    expect(initial.figure.layout.xaxis).toMatchObject({ ticktext: ['&lt;b&gt;A&amp;B&lt;/b&gt;', 'constructor'], tickvals: before.x });
    expect(refreshed.revision).toBe(initial.revision);
    expect(refreshed.figure.layout.uirevision).toBe(initial.revision);
    expect(changed.revision).not.toBe(initial.revision);
  });
});
