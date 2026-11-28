// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { screenerEvidence } from '../../../test/fixtures/financialEvidence';
import { datasetFromRows } from '../../localTableData';
import { purgePlot, renderPlot } from '../../plotly';
import type { Row } from '../../tableColumns';
import { buildBubbleRegression, fitUnweightedOls } from './bubbleRegression';
import { parseFinancialEvidence, type ScreenerFinancialEvidence } from './financialEvidence';
import type { RecipeOptions, RecipeResult } from './types';

const context = { theme: 'light', maxDecimals: 2, today: '2026-11-19' } as const;
const latest = '2026-08-31', prior = '2026-08-28';
const options = {
  kind: 'bubble-regression', version: 1, priceDate: 'latest', regression: true,
  fields: { symbol: 'symbol', date: 'last_day_data_date', dividendYield: 'dividend_yield',
    priceChange: 'price_change_5d', marketCap: 'market_cap', exchange: 'exchange', currency: 'currency_symbol',
    name: 'name', sector: 'sector' },
} satisfies RecipeOptions;

function row(symbol: string, x: number | null, y: number | null, cap: number | null, fields: Row = {}): Row {
  return { symbol: symbol + '.US', last_day_data_date: latest, dividend_yield: x, price_change_5d: y,
    market_cap: cap, exchange: 'US', currency_symbol: '$', name: null, sector: null, ...fields };
}

function cohort(price_date: string, raw_count: number, fields: Partial<ScreenerFinancialEvidence['cohorts'][number]> = {}) {
  return { price_date, raw_count, denominations: ['USD'], unknown_denomination: false, conflicting_duplicates: false,
    exact_duplicate_count: 0, ...fields };
}

function screen(rows: Row[], evidence: Partial<ScreenerFinancialEvidence> = {}) {
  const receipt = { ...screenerEvidence, raw_count: rows.length, normalized_count: rows.length,
    delivered_count: rows.length, cohorts: [cohort(latest, rows.length)], ...evidence };
  const dataset = datasetFromRows(rows, 'screen', 1, 'localFile', undefined, [], {
    completeness: 'paged', financialEvidence: parseFinancialEvidence(receipt),
  });
  expect(dataset.provenance.metadata?.financialEvidence).toEqual(receipt);
  return dataset;
}

function chart(result: RecipeResult) {
  if (!result.ok) throw new Error(result.message);
  return result;
}

function fitted(points: readonly { x: number; y: number }[]) {
  const result = fitUnweightedOls(points);
  if ('reason' in result) throw new Error(result.reason);
  return result;
}

type SvgMarker = { size: number[]; sizemode: 'area'; sizeref: number; sizemin?: number };

const plotlyRequire = createRequire(import.meta.url);
const plotlyRadius = plotlyRequire('plotly.js/src/traces/scatter/make_bubble_size_func.js') as
  (trace: { marker: SvgMarker }) => (size: number) => number;
const plotlySymbols = plotlyRequire('plotly.js/src/components/drawing/symbol_defs.js') as
  { circle: { f: (radius: number, angle: number, standoff: number) => string } };
const circlePath = (radius: number) => plotlySymbols.circle.f(radius, 0, 0);

describe('fitUnweightedOls', () => {
  it('fits an exact intercept relationship', () => {
    expect(fitted([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }])).toEqual({
      slope: 2, intercept: 1, rSquared: expect.closeTo(1, 14), n: 3,
    });
  });

  it('fits a noisy sample with known intercept and R-squared', () => {
    expect(fitted([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }])).toEqual({
      slope: .5, intercept: expect.closeTo(1 / 6, 14), rSquared: expect.closeTo(.75, 14), n: 3,
    });
  });

  it('returns zero R-squared for a genuinely uncorrelated nonconstant sample', () => {
    expect(fitted([{ x: -1, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 1 }])).toEqual({
      slope: 0, intercept: expect.closeTo(2 / 3, 14), rSquared: 0, n: 3,
    });
  });

  it('retains a small nonzero covariance after larger terms cancel', () => {
    const epsilon = 1e-50;
    const { slope, rSquared } = fitted([
      { x: 1, y: 1 }, { x: -1, y: -1 }, { x: epsilon, y: 1 },
      { x: -epsilon, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 },
    ]);
    expect(slope / 5e-51).toBeCloseTo(1, 14);
    expect(rSquared / (1e-100 / 6)).toBeCloseTo(1, 14);
  });

  it('preserves distinct X values that differ by less than one unit at the midpoint', () => {
    const { slope, rSquared, n } = fitted([
      { x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 1 },
      { x: 1, y: -1 }, { x: 0, y: -1 }, { x: 1e-20, y: 1 },
    ]);
    expect(slope / 7.5e-21).toBeCloseTo(1, 14);
    expect(rSquared / 1.25e-41).toBeCloseTo(1, 14);
    expect(n).toBe(6);
  });

  it('withholds a fit when a genuine nonzero R-squared would round to zero', () => {
    const result = fitUnweightedOls([
      { x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 1 },
      { x: 1, y: -1 }, { x: 0, y: -1 }, { x: 1e-200, y: 1 },
    ]);
    expect(result).toEqual({ reason: expect.stringMatching(/precision/i) });
  });

  it.each([
    { points: [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }], reason: /dividend yield.*constant/i },
    { points: [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }], reason: /price change.*constant/i },
    { points: [{ x: 0, y: 1 }, { x: 1, y: 2 }], reason: /at least 3/i },
    { points: [{ x: 0, y: 1 }, { x: 1, y: 2 }, { x: 2, y: Infinity }], reason: /finite/i },
  ])('withholds a fit with $reason', ({ points, reason }) => {
    expect(fitUnweightedOls(points)).toEqual({ reason: expect.stringMatching(reason) });
  });

  it('fits extreme finite values without overflowing variance and covariance', () => {
    const high = Number.MAX_VALUE;
    expect(fitted([{ x: -high, y: high }, { x: 0, y: 0 }, { x: high, y: -high }])).toEqual({
      slope: -1, intercept: 0, rSquared: expect.closeTo(1, 14), n: 3,
    });
  });

  it('preserves small distinct offsets at a large finite level', () => {
    const level = 2 ** 52;
    expect(fitted([{ x: level, y: 0 }, { x: level + 1, y: 2 }, { x: level + 2, y: 4 }])).toEqual({
      slope: 2, intercept: -(2 ** 53), rSquared: expect.closeTo(1, 14), n: 3,
    });
  });

  it('withholds a fit when a finite sample has an unrepresentable endpoint', () => {
    const high = Number.MAX_VALUE;
    expect(fitUnweightedOls([{ x: 0, y: -high }, { x: 1, y: high }, { x: 2, y: high }]))
      .toEqual({ reason: expect.stringMatching(/numeric|finite|represent/i) });
  });
});

describe('buildBubbleRegression', () => {
  it('autoscales both actual Plotly axes around ordinary screener fractions', async () => {
    const source = screen([row('A', 0, -.02, 10), row('B', .01, .01, 50), row('C', .02, .02, 100)]);
    const { figure } = chart(buildBubbleRegression(source, options, context));
    const node = document.body.appendChild(document.createElement('div'));
    try {
      await renderPlot(node, figure);
      const { _fullLayout } = node as HTMLDivElement & { _fullLayout: Record<'xaxis' | 'yaxis', { range: [number, number] }> };
      const [xMin, xMax] = _fullLayout.xaxis.range;
      const [yMin, yMax] = _fullLayout.yaxis.range;
      expect(xMin).toBeLessThan(0);
      expect(xMax).toBeGreaterThan(.02);
      expect(xMax - xMin).toBeLessThan(.05);
      expect(yMin).toBeLessThan(-.02);
      expect(yMax).toBeGreaterThan(.02);
      expect(yMax - yMin).toBeLessThan(.1);
    } finally {
      purgePlot(node);
      node.remove();
    }
  });

  it('fits the one plotted sample without weights and draws only the observed X interval', () => {
    const source = screen([
      row('A', 0, 0, 1), row('B', .01, .01, 1000000), row('C', .02, .01, 1),
      row('D', .07, -.9, 0), row('E', .08, .95, -12), row('F', .5, null, 5),
      row('G', null, .05, null),
    ]);
    const { figure, notes } = chart(buildBubbleRegression(source, options, context));
    const [sample, overlay] = figure.data;
    expect(figure.data).toHaveLength(2);
    expect(sample).toMatchObject({ type: 'scatter', mode: 'markers', x: [0, .01, .02], y: [0, .01, .01] });
    expect(overlay).toMatchObject({ type: 'scatter', mode: 'lines', x: [0, .02],
      y: [expect.closeTo(.01 / 6, 13), expect.closeTo(.01 + .01 / 6, 13)] });
    expect(figure.layout).toMatchObject({ xaxis: { tickformat: expect.stringContaining('%') },
      yaxis: { tickformat: expect.stringContaining('%') }, legend: { itemclick: false, itemdoubleclick: false } });
    expect(overlay).toMatchObject({ text: expect.stringMatching(/exchange = us.*Presentation filter/) });
    expect(notes.join(' ')).toMatch(/7 delivered.*7 selected-date.*3 usable.*4 excluded/i);
    expect(notes.join(' ')).toMatch(/N\s*=\s*3.*R²\s*=\s*0\.75/);
    expect(notes.join(' ')).toMatch(/dividend yield.*five-day price change.*market cap/i);
  });

  it('sets a 48px maximum diameter and propagates ratios without a minimum marker', () => {
    const max = Number.MAX_VALUE;
    const source = screen([row('A', 0, 0, max), row('B', .01, .01, max), row('C', .02, .01, max / 4),
      row('D', .03, -.02, max / 10000)]);
    const { figure, notes } = chart(buildBubbleRegression(source, options, context));
    const { marker, text } = figure.data[0] as { marker: SvgMarker; text: string[] };
    expect(marker).toMatchObject({ sizemode: 'area' });
    const radius = plotlyRadius({ marker });
    expect(2 * radius(marker.size[0])).toBe(48);
    expect(2 * radius(marker.size[1])).toBe(48);
    expect(2 * radius(marker.size[2])).toBe(24);
    expect(circlePath(radius(marker.size[0]))).toMatch(/A24,24/);
    expect(circlePath(radius(marker.size[2]))).toMatch(/A12,12/);
    expect(circlePath(radius(marker.size[3]))).toMatch(/A0\.24,0\.24/);
    expect(marker.sizemin ?? 0).toBe(0);
    expect(text[0]).toContain(String(max));
    expect(notes.join(' ')).toMatch(/N\s*=\s*4/);
  });

  it('retains tiny subpixel SVG circles when Plotly draws a positive radius', () => {
    const source = screen([row('A', 0, 0, 5000), row('B', .01, .01, 1e11)]);
    const { figure } = chart(buildBubbleRegression(source, options, context));
    const { marker, text } = figure.data[0] as { marker: SvgMarker; text: string[] };
    const radius = plotlyRadius({ marker })(marker.size[0]);
    expect(radius).toBeLessThan(.01);
    expect(circlePath(radius)).toMatch(/A0\.01,0\.01/);
    expect(text[0]).toContain('5000');
  });

  it('scales proportional tiny caps without overflowing the size scale', () => {
    const source = screen([row('A', 0, 0, Number.MIN_VALUE), row('B', .01, .01, 2 * Number.MIN_VALUE)]);
    const { figure } = chart(buildBubbleRegression(source, options, context));
    const { marker, text } = figure.data[0] as { marker: SvgMarker; text: string[] };
    const radius = plotlyRadius({ marker });
    expect(radius(marker.size[0])).toBeCloseTo(24 / Math.sqrt(2));
    expect(circlePath(radius(marker.size[1]))).toMatch(/A24,24/);
    expect(text[0]).toContain(String(Number.MIN_VALUE));
  });

  it('refuses a sample when Plotly rounds a positive nominal radius to a zero-area SVG circle', () => {
    expect(circlePath(.0024)).toMatch(/A0,0 /);
    const source = screen([row('A', 0, 0, 1000), row('B', .01, .01, 1e11), row('C', .02, .03, 1e11)]);
    expect(buildBubbleRegression(source, options, context)).toMatchObject({
      ok: false, refused: true, message: expect.stringMatching(/below.*marker.*precision/i),
    });
  });

  it('refuses a sample when an admitted positive cap would draw a zero-area marker', () => {
    const source = screen([row('A', 0, 0, Number.MIN_VALUE), row('B', .01, .01, Number.MAX_VALUE)]);
    expect(buildBubbleRegression(source, options, context)).toMatchObject({
      ok: false, refused: true, message: expect.stringMatching(/below.*marker.*precision/i),
    });
  });

  it('discloses source scope, filters, date vintage and escapes optional hover text', () => {
    const source = screen([row('AAA', 0, 0, 125, { name: '<b>&Co', sector: '<em>Growth' })]);
    source.provenance.metadata!.financialSourceFiltered = true;
    const { figure, notes } = chart(buildBubbleRegression(source, options, context));
    expect(figure.data[0]).toMatchObject({ name: expect.stringContaining('USD'),
      text: [expect.stringContaining('&lt;b&gt;&amp;Co')] });
    expect((figure.data[0] as { text: string[] }).text[0]).toContain('&lt;em&gt;Growth');
    expect((figure.data[0] as { text: string[] }).text[0]).toContain('AAA.US');
    expect(notes.join(' ')).toMatch(/price-data date.*2026-08-31.*retrieved.*2026-11-19T16:00:00Z/i);
    expect(notes.join(' ')).toMatch(/page.*offset 0.*limit 50.*market_capitalization.desc/i);
    expect(notes.join(' ')).toMatch(/exchange = us.*presentation filter/i);
    expect(notes.join(' ')).toMatch(/regression withheld.*at least 3/i);
    expect(figure.data).toHaveLength(1);
  });

  it('collapses exact listing/date duplicates and discloses both duplicate counts', () => {
    const a = row('A', 0, 0, 1);
    const source = screen([a, { ...a }, row('B', .01, .02, 4), row('C', .02, .01, 9)], {
      cohorts: [cohort(latest, 4, { exact_duplicate_count: 1 })], diagnostics: ['screener_exact_duplicate'],
    });
    const { figure, notes } = chart(buildBubbleRegression(source, options, context));
    expect(figure.data[0]).toMatchObject({ x: [0, .01, .02] });
    expect(notes.join(' ')).toMatch(/1 exact duplicate.*collapsed.*1.*acquired/i);
    expect(notes.join(' ')).toMatch(/N\s*=\s*3/);
  });

  it('refuses a duplicate containing a value and a missing value before numeric exclusions', () => {
    const source = screen([row('A', 0, 0, 5), row('A', 0, null, 5)], {
      cohorts: [cohort(latest, 2, { conflicting_duplicates: true })], diagnostics: ['screener_duplicate_conflict'],
    });
    source.rows.pop();
    expect(buildBubbleRegression(source, options, context)).toMatchObject({
      ok: false, refused: true, message: expect.stringMatching(/conflicting duplicate/i),
    });
  });

  it('allows disjoint price-data dates and independently preserves their denominations', () => {
    const source = screen([row('A', .02, .01, 10), row('A', 0, 0, 12, { last_day_data_date: prior }),
      row('B', .01, .04, 14, { symbol: 'B.LSE', exchange: 'LSE', currency_symbol: 'GBP' })], {
      cohorts: [cohort(latest, 2, { denominations: ['GBP', 'USD'] }), cohort(prior, 1)],
      diagnostics: ['mixed_denomination'],
    });
    source.rows.pop();
    expect(buildBubbleRegression(source, options, context)).toMatchObject({
      ok: false, refused: true, message: expect.stringMatching(/mixed.*denomination/i),
    });
    const older = chart(buildBubbleRegression(source, { ...options, priceDate: prior }, context));
    expect(older.figure.data[0]).toMatchObject({ x: [0], name: expect.stringContaining('USD') });

    const disjoint = screen([row('A', .02, .01, 10), row('B', .01, .04, 14, {
      last_day_data_date: prior, symbol: 'B.LSE', exchange: 'LSE', currency_symbol: 'GBP',
    })], { cohorts: [cohort(latest, 1), cohort(prior, 1, { denominations: ['GBP'] })] });
    expect(chart(buildBubbleRegression(disjoint, { ...options, priceDate: prior }, context)).figure.data[0])
      .toMatchObject({ x: [.01], name: expect.stringContaining('GBP') });
  });

  it('refuses an ambiguous denomination even if its observation has no usable numbers', () => {
    const source = screen([row('A', 0, 0, 5), row('B', null, null, null, {
      symbol: 'B.LSE', exchange: 'LSE', currency_symbol: '$',
    })], { cohorts: [cohort(latest, 2, { unknown_denomination: true })], diagnostics: ['unknown_denomination'] });
    expect(buildBubbleRegression(source, options, context)).toMatchObject({
      ok: false, refused: true, message: expect.stringMatching(/unknown.*denomination/i),
    });
  });

  it.each([
    { flag: 'unassignable_identity', reason: /identity/i },
    { flag: 'unassignable_date', reason: /date/i },
    { flag: 'unit_conflict', reason: /unit/i },
  ] as const)('refuses acquisition-wide $flag despite a usable presented listing', ({ flag, reason }) => {
    const rows = [row('A', 0, 0, 5)];
    if (flag === 'unassignable_date') rows.push(row('B', 0, 0, 5, { last_day_data_date: null }));
    const source = screen(rows, {
      raw_count: flag === 'unit_conflict' ? 1 : 2,
      cohorts: [cohort(latest, flag === 'unassignable_identity' ? 2 : 1)], diagnostics: [flag],
      unsafe: { ...screenerEvidence.unsafe, [flag]: true },
    });
    if (flag === 'unassignable_date') source.rows.pop();
    expect(buildBubbleRegression(source, options, context)).toMatchObject({
      ok: false, refused: true, message: expect.stringMatching(reason),
    });
  });

  it('refuses a presentation that contradicts acquired identity, date or denomination', () => {
    for (const update of [
      { symbol: 'A.LSE' }, { last_day_data_date: '2024-02-30' }, { currency_symbol: 'GBP' },
    ]) {
      const source = screen([row('A', null, null, null)]);
      Object.assign(source.rows[0].values, update);
      expect(buildBubbleRegression(source, options, context)).toMatchObject({ ok: false, refused: true });
    }
  });

  it('refuses absent evidence, an unavailable explicit date and an entirely excluded sample', () => {
    const source = screen([row('A', 0, 0, 0)]);
    expect(buildBubbleRegression(source, options, context)).toMatchObject({
      ok: false, refused: true, message: expect.stringMatching(/1 excluded/i),
    });
    expect(buildBubbleRegression(source, { ...options, priceDate: prior }, context)).toMatchObject({
      ok: false, refused: true, message: expect.stringMatching(/presented.*price-data date/i),
    });
    source.provenance.metadata = {};
    expect(buildBubbleRegression(source, options, context)).toMatchObject({
      ok: false, refused: true, message: expect.stringMatching(/acquisition.*evidence/i),
    });
  });

  it('refuses a presented numeric conflict before excluding the affected duplicate', () => {
    const first = row('A', 0, 0, 5);
    const source = screen([first, { ...first }], {
      cohorts: [cohort(latest, 2, { exact_duplicate_count: 1 })], diagnostics: ['screener_exact_duplicate'],
    });
    source.rows[1].cellErrors = { price_change_5d: { code: 'invalid', message: 'Missing' } };
    expect(buildBubbleRegression(source, options, context)).toMatchObject({
      ok: false, refused: true, message: expect.stringMatching(/conflicting duplicate/i),
    });
  });

  it('pads a large constant axis when Plotly’s default one-unit margin is not representable', () => {
    const level = 2 ** 53;
    const source = screen([row('A', level, .01, 5), row('B', level, .02, 5), row('C', level, .03, 5)]);
    const { figure, notes } = chart(buildBubbleRegression(source, options, context));
    const { range } = figure.layout.xaxis as { range?: [number, number] };
    expect(range?.[0]).toBeLessThan(level);
    expect(range?.[1]).toBeGreaterThan(level);
    expect(notes.join(' ')).toMatch(/regression withheld.*dividend yield.*constant/i);
    expect(notes.join(' ')).not.toContain('R²');
  });

  it('refuses a finite axis span too small to map safely to pixels', () => {
    const source = screen([row('A', 0, 0, 5), row('B', Number.MIN_VALUE, 0, 5)]);
    expect(buildBubbleRegression(source, options, context)).toMatchObject({
      ok: false, refused: true, message: expect.stringMatching(/plot.*range/i),
    });
  });

  it('refuses an unrenderable finite observation instead of silently dropping it from the sample', () => {
    const source = screen([row('A', 0, 0, 5), row('B', Number.MAX_VALUE, 0, 5)]);
    expect(buildBubbleRegression(source, options, context)).toMatchObject({
      ok: false, refused: true, message: expect.stringMatching(/plot.*range/i),
    });
  });

  it('keeps all bubbles when only the fitted line exceeds the plotting range', () => {
    const high = Number.MAX_VALUE * 9e-5;
    const source = screen([row('A', 0, -high, 5), row('B', 1, high, 5), row('C', 2, high, 5)]);
    const { figure, notes } = chart(buildBubbleRegression(source, options, context));
    expect(figure.data).toHaveLength(1);
    expect(notes.join(' ')).toMatch(/regression withheld.*plot.*range/i);
    expect(notes.join(' ')).not.toContain('R²');
  });

  it('preserves zoom across a same-question refresh and resets for fit and price-date changes', () => {
    const source = screen([row('A', 0, 0, 5), row('B', .01, .02, 5), row('C', .02, .04, 5),
      row('A', .03, .02, 7, { last_day_data_date: prior })], { cohorts: [cohort(latest, 3), cohort(prior, 1)] });
    const first = chart(buildBubbleRegression(source, options, context));
    const refreshed = structuredClone(source);
    refreshed.resultRevision++;
    refreshed.outputRevision++;
    refreshed.rows[0].values.dividend_yield = .002;
    const second = chart(buildBubbleRegression(refreshed, options, { ...context, viewportWidth: 500 }));
    const disabled = chart(buildBubbleRegression(source, { ...options, regression: false }, context));
    const older = chart(buildBubbleRegression(source, { ...options, priceDate: prior }, context));
    const olderLatest = chart(buildBubbleRegression({ ...source, rows: source.rows.slice(-1) }, options, context));
    expect(first.figure.data).toHaveLength(2);
    expect(second.figure.data).toHaveLength(2);
    expect(disabled.figure.data).toHaveLength(1);
    expect(second.figure.layout.uirevision).toBe(first.revision);
    expect(disabled.revision).not.toBe(first.revision);
    expect(older.revision).not.toBe(first.revision);
    expect(olderLatest.revision).toBe(older.revision);
  });
});
