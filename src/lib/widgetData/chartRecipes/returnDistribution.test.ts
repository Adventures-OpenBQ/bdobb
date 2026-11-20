// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { dailyPriceRows, priceDataset, priceFields } from './fixtures';
import { buildReturnDistribution } from './returnDistribution';
import type { RecipeOptions, RecipeResult } from './types';

const context = { theme: 'light', maxDecimals: 2, today: '2026-02-01' } as const;
const options = { version: 1, kind: 'return-distribution', fields: priceFields, symbol: 'A', bins: 5 } satisfies RecipeOptions;
const build = (prices: (number | null)[], bins = options.bins) =>
  buildReturnDistribution(priceDataset(dailyPriceRows(prices)), { ...options, bins }, context);

function plotted(result: RecipeResult) {
  if (!result.ok) throw new Error(result.message);
  return result.figure.data[0] as {
    type: string; x: number[]; y: number[]; width: number[]; offset?: number; customdata: [string, string, string, number][];
  };
}

function plottedBounds(trace: ReturnType<typeof plotted>, index: number) {
  const width = trace.width[index];
  const left = trace.x[index] + (trace.offset ?? -width / 2);
  return [left, left + width];
}

it('conserves samples at both range endpoints', () => {
  const result = build([100, 100, 110, 99]);
  const trace = plotted(result);
  expect(trace.type).toBe('bar');
  expect(trace.y).toEqual([1, 0, 1, 0, 1]);
  expect(trace.y.reduce((total, count) => total + count, 0)).toBe(3);
  expect(result).toMatchObject({
    notes: expect.arrayContaining([expect.stringMatching(/N = 3.*2026-01-02.*2026-01-04/)]),
    figure: { layout: { xaxis: { tickformat: '.2%' }, yaxis: { title: { text: 'Observation count' } } } },
  });
});

it('assigns exact interior edges to the right and shows endpoint inclusion and share', () => {
  const trace = plotted(build([8, 4, 3, 3, 3.75, 5.625, 9.84375]));
  expect(trace.y).toEqual([1, 1, 1, 1, 2]);
  expect(trace.x.map((_, i) => plottedBounds(trace, i))).toEqual([
    [-.5, -.25], [-.25, 0], [0, .25], [.25, .5], [.5, .75],
  ]);
  expect(trace.width).toEqual([.25, .25, .25, .25, .25]);
  expect(trace.customdata[0]).toEqual(['-50%', '-25%', ')', 1 / 6]);
  expect(trace.customdata[4]).toEqual(['50%', '75%', ']', 2 / 6]);
});

it('conserves returns over a tiny nonconstant range', () => {
  const trace = plotted(build([1, 1, 1 + Number.EPSILON, 1], 100));
  expect(trace.y[0]).toBe(1);
  expect(trace.y[99]).toBe(1);
  expect(trace.y.reduce((total, count) => total + count, 0)).toBe(3);
  expect(trace.width.every(width => Number.isFinite(width) && width > 0)).toBe(true);
  expect(new Set(trace.x).size).toBe(100);
});

const precisionPrices = [1, 2, null, 1, 2 + 2 * Number.EPSILON, null, 1, 2 + 12 * Number.EPSILON];

it('preserves all bins when their boundaries are one floating-point step apart', () => {
  const trace = plotted(build(precisionPrices, 12));
  expect(trace.y).toEqual([1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
  expect(trace.x.map((_, i) => plottedBounds(trace, i))).toEqual(Array.from({ length: 12 }, (_, i) => [
    1 + i * Number.EPSILON, 1 + (i + 1) * Number.EPSILON,
  ]));
});

it('draws the same rounded boundaries it uses for bin assignment and hover', () => {
  const trace = plotted(build(precisionPrices, 5));
  expect(trace.y).toEqual([1, 1, 0, 0, 1]);
  expect(plottedBounds(trace, 1)).toEqual([1 + 2 * Number.EPSILON, 1 + 5 * Number.EPSILON]);
  expect(trace.customdata[1]).toEqual(['100.00000000000004%', '100.0000000000001%', ')', 1 / 3]);
});

it('refuses when the numeric range cannot represent distinct bin boundaries', () => {
  expect(build([1, 2, 4 + 4 * Number.EPSILON], 100)).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/too narrow.*fewer bins/i),
  });
});

it('draws a single centered finite-width bin for constant returns', () => {
  const result = build([100, 100, 100, 100]);
  const trace = plotted(result);
  expect(trace).toMatchObject({ y: [3], width: [2e-6] });
  expect(plottedBounds(trace, 0)).toEqual([-1e-6, 1e-6]);
  expect(result).toMatchObject({ notes: expect.arrayContaining([expect.stringMatching(/constant.*0%/i)]) });
});

it('refuses a constant return when finite display bounds are impossible', () => {
  expect(build([1, Number.MAX_VALUE, null, 1, Number.MAX_VALUE])).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/constant.*finite.*bin/i),
  });
});

it('places the full finite outlier bin inside the Plotly linear domain', () => {
  const result = build([1, Number.MAX_VALUE, Number.MAX_VALUE]);
  const trace = plotted(result);
  expect(trace.y).toEqual([1, 0, 0, 0, 1]);
  const [left, right] = plottedBounds(trace, 4);
  expect(right).toBeLessThan(Number.MAX_VALUE * 1e-4); // Plotly FP_SAFE
  expect(left / right).toBeCloseTo(.8);
  expect(trace.customdata[4][1]).toBe('1.7976931348623157E310%');
  expect(result).toMatchObject({ figure: { layout: { xaxis: {
    tickmode: 'array', tickvals: expect.arrayContaining([right]),
    ticktext: expect.arrayContaining([expect.stringMatching(/E310%$/)]),
  } } } });
});

it('notes price gaps separately from overflowing return arithmetic', () => {
  const result = build([Number.MIN_VALUE, Number.MAX_VALUE, Number.MAX_VALUE, 0, 100, 100, -1, 100]);
  expect(plotted(result).y).toEqual([2]);
  expect(result).toMatchObject({ notes: expect.arrayContaining([
    expect.stringMatching(/N = 2.*2026-01-03.*2026-01-06/),
    expect.stringMatching(/2.*price gap/i),
    expect.stringMatching(/1.*nonfinite.*return/i),
  ]) });
});

it('requires two finite returns and includes gap and arithmetic counts in the refusal', () => {
  expect(build([Number.MIN_VALUE, Number.MAX_VALUE, Number.MAX_VALUE, 0])).toMatchObject({
    ok: false, refused: true,
    message: expect.stringMatching(/at least 2.*return.*1.*price gap.*1.*nonfinite/i),
  });
});

it('refuses paged history, even with enough delivered prices to calculate returns', () => {
  const dataset = priceDataset(dailyPriceRows([100, 100, 110, 99]));
  dataset.completeness.kind = 'paged';
  expect(buildReturnDistribution(dataset, options, context)).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/fully loaded.*paged/i),
  });
});

it.each([4, 5.5, 101])('refuses a bin count of %s at the builder boundary', bins => {
  expect(build([100, 100, 110, 99], bins)).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/integer between 5 and 100/i),
  });
});

it('keeps the question revision on refresh and changes it for new bins', () => {
  const original = build([100, 100, 110]);
  const refreshed = build([100, 90, 110, 99]);
  const changed = build([100, 90, 110, 99], 6);
  if (!original.ok || !refreshed.ok || !changed.ok) throw new Error('Expected all figures to be valid');
  expect(refreshed.revision).toBe(original.revision);
  expect(refreshed.figure.layout.uirevision).toBe(original.revision);
  expect(changed.revision).not.toBe(original.revision);
});
