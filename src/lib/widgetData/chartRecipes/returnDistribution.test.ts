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
    type: string; x: number[]; y: number[]; width: number[]; customdata: [string, string, string, number][];
  };
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
  expect(trace.x).toEqual([-.375, -.125, .125, .375, .625]);
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

it('refuses when the numeric range cannot represent distinct centered bins', () => {
  expect(build([1, 2, 4 + 4 * Number.EPSILON], 100)).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/too narrow.*fewer bins/i),
  });
});

it('draws a single centered finite-width bin for constant returns', () => {
  const result = build([100, 100, 100, 100]);
  expect(plotted(result)).toMatchObject({ x: [0], y: [3], width: [2e-6] });
  expect(result).toMatchObject({ notes: expect.arrayContaining([expect.stringMatching(/constant.*0%/i)]) });
});

it('refuses a constant return when finite display bounds are impossible', () => {
  expect(build([1, Number.MAX_VALUE, null, 1, Number.MAX_VALUE])).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/constant.*finite.*bin/i),
  });
});

it('keeps a finite outlier even when its ratio is near the maximum number', () => {
  const trace = plotted(build([1, Number.MAX_VALUE, Number.MAX_VALUE]));
  expect(trace.y).toEqual([1, 0, 0, 0, 1]);
  expect(trace.x.every(Number.isFinite)).toBe(true);
  expect(trace.width.every(Number.isFinite)).toBe(true);
  expect(trace.customdata[4][1]).toMatch(/E310%$/);
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
