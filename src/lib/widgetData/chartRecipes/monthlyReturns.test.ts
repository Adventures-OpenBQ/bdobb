// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { priceDataset, priceFields } from './fixtures';
import { buildMonthlyReturns } from './monthlyReturns';
import type { RecipeOptions, RecipeResult } from './types';

const options = { version: 1, kind: 'monthly-returns', fields: priceFields, symbol: 'A' } satisfies RecipeOptions;
const context = { theme: 'light', maxDecimals: 2, today: '2026-02-15' } as const;
const row = (date: string, price: number | null, symbol = 'A') => ({ date, adjusted_close: price, symbol });

function heatmap(result: RecipeResult) {
  if (!result.ok) throw new Error(result.message);
  expect(result.figure.data).toEqual([expect.objectContaining({ type: 'heatmap' })]);
  return result.figure.data[0] as {
    x: string[];
    y: string[];
    z: (number | null)[][];
    customdata: string[][][];
    hovertemplate: string;
    hoverongaps: boolean;
    connectgaps: boolean;
    uid: string;
    zmin: number;
    zmax: number;
  };
}

describe('buildMonthlyReturns', () => {
  it('uses consecutive final closes as endpoint ratios across the year boundary', () => {
    const dataset = priceDataset([
      row('2026-01-30', 99), row('2025-12-04', 90), row('2025-11-28', 100),
      row('2026-01-08', 130), row('2025-12-31', 110), row('2025-12-31', 300, 'B'),
    ], '2025-11-01', '2026-01-31');
    const trace = heatmap(buildMonthlyReturns(dataset, options, context));
    expect(trace.x).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
    expect(trace.y).toEqual(['2025', '2026']);
    expect(trace.z[0][10]).toBeNull();
    expect(trace.z[0][11]).toBeCloseTo(.1, 12);
    expect(trace.z[1][0]).toBeCloseTo(-.1, 12);
    expect(trace.customdata[0][11]).toEqual(expect.arrayContaining(['Dec 2025', '2025-12-31', '2025-11-28', '10 %']));
    expect(trace.zmax).toBeCloseTo(.1, 12);
    expect(trace.zmin).toBe(-trace.zmax);
  });

  it('does not bridge an absent calendar month', () => {
    const dataset = priceDataset([
      row('2025-11-28', 100), row('2026-01-30', 110), row('2026-02-27', 121),
    ], '2025-11-01', '2026-02-28');
    const trace = heatmap(buildMonthlyReturns(dataset, options, { ...context, today: '2026-03-01' }));
    expect(trace.z[0][11]).toBeNull();
    expect(trace.z[1][0]).toBeNull();
    expect(trace.customdata[1][0].join(' ')).toMatch(/missing.*prior month/i);
    expect(trace.z[1][1]).toBeCloseTo(.1, 12);
  });

  it('uses the acquisition end, with the actual Friday close shown for a month ending on Sunday', () => {
    const rows = [row('2025-07-31', 100), row('2025-08-29', 120)];
    const complete = heatmap(buildMonthlyReturns(priceDataset(rows, '2025-07-01', '2025-08-31'), options, context));
    const incomplete = heatmap(buildMonthlyReturns(priceDataset(rows, '2025-07-01', '2025-08-29'), options, context));

    expect(complete.z[0][7]).toBeCloseTo(.2, 12);
    expect(complete.customdata[0][7]).toEqual(expect.arrayContaining(['2025-08-29', '2025-07-31']));
    expect(incomplete.z[0][7]).toBeNull();
    expect(incomplete.customdata[0][7].join(' ')).toMatch(/incomplete.*acquisition/i);
  });

  it('preserves a known null final observation as a barrier for both adjacent returns', () => {
    const dataset = priceDataset([
      row('2025-11-28', 100), row('2025-12-30', 110), row('2025-12-31', null),
      row('2026-01-30', 120),
    ], '2025-11-01', '2026-01-31');

    const trace = heatmap(buildMonthlyReturns(dataset, options, context));
    expect(trace.z[0][11]).toBeNull();
    expect(trace.z[1][0]).toBeNull();
    expect(trace.customdata[0][11]).toContain('2025-12-31');
    expect(trace.customdata[1][0]).toContain('2025-12-31');
    expect(trace.customdata[0][11].join(' ')).toMatch(/missing.*price/i);
    expect(trace.customdata[1][0].join(' ')).toMatch(/missing.*prior month/i);
  });

  it('keeps the current month incomplete even with month-end acquisition coverage and a final trading close', () => {
    const dataset = priceDataset([
      row('2025-09-30', 100), row('2025-10-31', 100), row('2025-11-28', 120),
    ], '2025-09-01', '2025-11-30');
    const result = buildMonthlyReturns(dataset, options, { ...context, today: '2025-11-30' });
    const trace = heatmap(result);

    expect(trace.z[0].slice(8, 11)).toEqual([null, 0, null]);
    expect(trace.customdata[0][8].join(' ')).toMatch(/missing/i);
    expect(trace.customdata[0][9]).toContain('0 %');
    expect(trace.customdata[0][10].join(' ')).toMatch(/incomplete.*current month/i);
    expect(trace.hoverongaps).toBe(true);
    expect(trace.connectgaps).toBe(false);
    expect(trace.hovertemplate).toContain('customdata');
    expect(trace.zmin).toBe(-trace.zmax);
    expect(trace.zmax).toBeGreaterThan(0);
    if (!result.ok) throw new Error(result.message);
    expect(result.notes.join(' ')).toMatch(/missing/i);
    expect(result.notes.join(' ')).toMatch(/incomplete/i);
  });

  it.each(['2025', '2019'])('reports an incomplete current month for an acquisition ending in December %s', year => {
    const dataset = priceDataset([
      row(`${year}-11-29`, 100), row(`${year}-12-31`, 110),
    ], `${year}-11-01`, `${year}-12-31`);
    const result = buildMonthlyReturns(dataset, options, { ...context, today: '2026-01-01' });
    const trace = heatmap(result);
    expect(trace.y).toEqual([year]);
    expect(trace.z[0][11]).toBeCloseTo(.1, 12);
    if (!result.ok) throw new Error(result.message);
    expect(result.notes).toEqual(expect.arrayContaining([
      expect.stringMatching(/current month.*2026-01.*incomplete.*outside.*acqui/i),
    ]));
  });

  it('honors the extra day of February in a leap year', () => {
    const rows = [row('2024-01-31', 100), row('2024-02-28', 90)];
    const complete = heatmap(buildMonthlyReturns(priceDataset(rows, '2024-01-01', '2024-02-29'), options, context));
    const incomplete = heatmap(buildMonthlyReturns(priceDataset(rows, '2024-01-01', '2024-02-28'), options, context));
    expect(complete.z[0][1]).toBeCloseTo(-.1, 12);
    expect(incomplete.z[0][1]).toBeNull();
  });

  it('keeps the question and trace identity on data refresh and updates the computed return', () => {
    const rows = [row('2025-12-31', 100), row('2026-01-30', 90), row('2025-12-31', 120, 'B'), row('2026-01-30', 121, 'B')];
    const dataset = priceDataset(rows, '2025-12-01', '2026-01-31');
    const initial = buildMonthlyReturns(dataset, options, context);
    const refreshed = buildMonthlyReturns({
      ...priceDataset([row('2025-12-31', 100), row('2026-01-30', 105)], '2025-12-01', '2026-01-31'),
      outputRevision: 2, resultRevision: 2,
    }, options, { theme: 'dark', maxDecimals: 3, today: '2026-03-01' });
    const differentSymbol = buildMonthlyReturns(dataset, { ...options, symbol: 'B' }, context);
    const differentWindow = buildMonthlyReturns(priceDataset(rows, '2025-12-02', '2026-01-31'), options, context);
    const before = heatmap(initial);
    const after = heatmap(refreshed);
    if (!initial.ok || !refreshed.ok || !differentSymbol.ok || !differentWindow.ok) throw new Error('Expected four figures');
    expect(refreshed.revision).toBe(initial.revision);
    expect(refreshed.figure.layout.uirevision).toBe(initial.revision);
    expect(after.uid).toBe(before.uid);
    expect(after.z[1][0]).toBeCloseTo(.05, 12);
    expect(differentSymbol.revision).not.toBe(initial.revision);
    expect(heatmap(differentSymbol).uid).not.toBe(before.uid);
    expect(differentWindow.revision).not.toBe(initial.revision);
  });

  it('refuses acquisition with unknown completeness', () => {
    const dataset = priceDataset([row('2026-01-30', 99)]);
    dataset.completeness.kind = 'unknown';
    expect(buildMonthlyReturns(dataset, options, context)).toMatchObject({
      ok: false, refused: true, message: expect.stringMatching(/fully loaded/i),
    });
  });

  it('refuses an unusable selected symbol even with another valid series', () => {
    const dataset = priceDataset([row('2026-01-30', null), row('2026-01-30', 99, 'B')]);
    expect(buildMonthlyReturns(dataset, options, context)).toMatchObject({
      ok: false, refused: true, message: expect.stringMatching(/no valid daily prices for A/i),
    });
  });

  it('requires an explicit valid calendar date to identify the current month', () => {
    const dataset = priceDataset([row('2026-01-30', 99)]);
    expect(buildMonthlyReturns(dataset, options, { ...context, today: '2026-02-30' })).toMatchObject({
      ok: false, refused: true, message: expect.stringMatching(/today.*calendar date/i),
    });
  });
});
