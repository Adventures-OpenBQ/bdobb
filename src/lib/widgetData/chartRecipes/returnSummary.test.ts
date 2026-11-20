// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it, vi } from 'vitest';
import { fetchWidgetData } from '../../dataClient';
import { datasetFromBytes, datasetFromRows } from '../../localTableData';
import { parseTableSnapshot } from '../../tableRowValues';
import { startMockServer } from '../../../test/mockServer';
import { backend, widget } from '../../../test/fixtures';
import type { BackendAcquisition } from './financialEvidence';
import { priceOmissionEvidence } from './priceEvidence';
import { dailyPriceRows, priceFields } from './fixtures';
import { admitReturnSummary, dailyReturnSamples, prepareSelectedPrices } from './priceSamples';
import { buildReturnSummary, estimateReturnDensity, summarizeReturns } from './returnSummary';
import { runRecipe } from './run';
import { decodeRecipeOptions } from './settings';
import type { ReturnSummaryOptions } from './types';

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
}));

const own = { mode: 'own' } as const;
const day = (d: number) => '2026-01-' + String(d).padStart(2, '0');
const receipt = { interval: '1d', start_date: day(1), end_date: day(31) };
const prices = [100, 200, 400, 800, 1600, 3200, 6400, 12800];
const daily = dailyPriceRows(prices, 'AAA.US');
const bytes = (snapshot: unknown) => new TextEncoder().encode(JSON.stringify(snapshot));
const source = (rows: object[] = daily, facts: object = receipt, completeness = 'bounded') =>
  datasetFromBytes('daily.json', bytes({ rows, receipt: facts, completeness }), 'prices', 1);

it('admits separate listing calendars in selected order with both price endpoints inside inclusive common bounds', async () => {
  const [a, b] = ['AAA.US', 'BBB.US'].map(symbol => dailyPriceRows(prices, symbol));
  const oddCalendar = b.map((row, index) => ({ ...row, date: day([1, 2, 3, 4, 6, 7, 8, 10][index]) }));
  const result = admitReturnSummary(await source([...a, ...oddCalendar]), priceFields, ['BBB.US', 'AAA.US'], {
    mode: 'common', start: day(2), end: day(8),
  });
  if (!result.ok) throw new Error(result.message);
  expect(result.value.scope).toEqual({ start: day(1), end: day(31), interval: '1d' });
  expect(result.value.adjustmentBasis).toBe('adjusted-price');
  expect(result.value.commonWindow).toEqual({ start: day(1), end: day(8) });
  expect(result.value.series.map(({ symbol, samples, start, end }) => [symbol, samples.map(s => s.date), start, end])).toEqual([
    ['BBB.US', [3, 4, 6, 7, 8].map(day), day(3), day(8)],
    ['AAA.US', [3, 4, 5, 6, 7, 8].map(day), day(3), day(8)],
  ]);
});

it('counts both known exclusions around a missing close and excludes neither neighboring close itself', async () => {
  const rows = daily.map((row, i) => i === 2 ? { ...row, adjusted_close: null } : row);
  const result = admitReturnSummary(await source(rows), priceFields, ['AAA.US'], own);
  if (!result.ok) throw new Error(result.message);
  expect(result.value.series[0]).toMatchObject({
    samples: [2, 5, 6, 7, 8].map(d => ({ date: day(d), value: 1 })),
    start: day(2), end: day(8), excludedOpportunities: 2, gapCount: 1,
  });
});

it('refuses if every listing cannot supply five in-window returns', async () => {
  const peer = dailyPriceRows(prices.slice(0, 6), 'BBB.US');
  const data = await source([...daily, ...peer]);
  expect(admitReturnSummary(data, priceFields, ['BBB.US', 'AAA.US'], own).ok).toBe(true);
  expect(admitReturnSummary(data, priceFields, ['AAA.US', 'BBB.US'], { mode: 'common', start: day(2), end: day(8) }))
    .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/five|5.*BBB\.US/i) });
});

it('refuses a common window for disjoint listing histories', async () => {
  const peer = dailyPriceRows(prices, 'BBB.US').map((row, index) => ({ ...row, date: day(index + 12) }));
  const data = await source([...daily, ...peer]);
  const selected = ['AAA.US', 'BBB.US'];
  expect(admitReturnSummary(data, priceFields, selected, own)).toMatchObject({ ok: true, value: { commonWindow: null } });
  expect(admitReturnSummary(data, priceFields, selected, { mode: 'common', start: day(1), end: day(31) }))
    .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/overlap/i) });
});

it.each([
  { mode: 'common', start: day(9), end: day(8) },
  { mode: 'common', start: '2026-02-30', end: '2026-03-30' },
  { mode: 'common', start: '2025-12-31', end: day(8) },
] as const)('refuses invalid or out-of-acquisition common bounds %j', async window => {
  expect(admitReturnSummary(await source(), priceFields, ['AAA.US'], window))
    .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/window|bound/i) });
});

it.each(['paged', 'partial', 'sample'] as const)('refuses %s acquisition despite enough delivered returns', async completeness => {
  expect(admitReturnSummary(await source(daily, receipt, completeness), priceFields, ['AAA.US'], own))
    .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/fully loaded/i) });
});

it('refuses contradictory daily evidence and altered acquisition counts', async () => {
  const contradictory = await source();
  contradictory.provenance.parameters = { interval: '1wk' };
  expect(admitReturnSummary(contradictory, priceFields, ['AAA.US'], own))
    .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/daily interval|acquisition date/i) });
  const deficient = await source();
  deficient.completeness.acquiredRowCount = daily.length + 1;
  expect(admitReturnSummary(deficient, priceFields, ['AAA.US'], own))
    .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/continuity/i) });
  deficient.completeness.acquiredRowCount = daily.length - 1;
  expect(admitReturnSummary(deficient, priceFields, ['AAA.US'], own).ok).toBe(false);
  delete deficient.completeness.acquiredRowCount;
  expect(admitReturnSummary(deficient, priceFields, ['AAA.US'], own).ok).toBe(false);
});

it.each([3, -1, '7', 7.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, undefined])(
  'refuses a bounded seven-row acquisition with exact total %s', async total => {
    const data = await source(daily.slice(0, 7));
    data.completeness = { ...data.completeness, totalRowCountKind: 'exact', totalRowCount: total as number };
    expect(admitReturnSummary(data, priceFields, ['AAA.US'], own))
      .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/row counts.*continuity/i) });
  },
);

it.each([['bounded', 7, true], ['bounded', 8, true], ['complete', 7, true], ['complete', 8, false]] as const)(
  'checks %s seven-row acquisition against exact total %i', async (completeness, totalRowCount, allowed) => {
    const data = await source(daily.slice(0, 7), receipt, completeness);
    data.completeness = { ...data.completeness, totalRowCountKind: 'exact', totalRowCount };
    expect(admitReturnSummary(data, priceFields, ['AAA.US'], own).ok).toBe(allowed);
  },
);

it('keeps the closed snapshot parser and rejects positive receipt-free metadata', async () => {
  await expect(source(daily, { ...receipt, adjusted: 'yes' })).rejects.toThrow('Could not parse local table');
  const { data, snapshot } = parseTableSnapshot({ rows: daily, completeness: 'bounded' });
  const missing = datasetFromRows(data as typeof daily, 'prices', 1, 'backend', undefined, [], snapshot);
  expect(admitReturnSummary(missing, priceFields, ['AAA.US'], own)).toMatchObject({ ok: false, refused: true });
});

it('does not grant adjustment or listing proof through a saved numeric binding', async () => {
  const rows = daily.map(({ adjusted_close, ...row }) => ({ ...row, custom: adjusted_close }));
  expect(admitReturnSummary(await source(rows), { ...priceFields, price: 'custom' }, ['AAA.US'], own))
    .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/adjusted.price/i) });
  const ambiguous = daily.map(row => ({ ...row, symbol: 'AAA' }));
  expect(admitReturnSummary(await source(ambiguous), priceFields, ['AAA'], own))
    .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/qualified listing/i) });
});

it('requires an acquired trading-date field even if another column contains plausible calendar dates', async () => {
  const rows = daily.map(({ date, ...row }) => ({ ...row, authored: date }));
  expect(admitReturnSummary(await source(rows), { ...priceFields, date: 'authored' }, ['AAA.US'], own))
    .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/trading.date/i) });
});

it('preserves the legacy fetched rows and refuses a request flag without acquired proof', async () => {
  const endpoint = '/api/v1/eodhd/equity/price/historical';
  const rows = daily.map(({ date, adjusted_close }) => ({
    date, adjusted_close, open: adjusted_close, high: adjusted_close, low: adjusted_close, close: adjusted_close, volume: 8000,
  }));
  const server = await startMockServer({ [endpoint]: { results: rows } });
  try {
    const config = backend({ baseUrl: server.url });
    const card = widget({ type: 'table', endpoint, dataKey: 'results' });
    const params = { ...receipt, symbol: 'AAA.US', provider: 'eodhd' };
    const read = async (query: typeof params & { chart_source?: string }) => {
      let acquisition: BackendAcquisition | undefined;
      const result = await fetchWidgetData(config, card, query, undefined, undefined, undefined, context => { acquisition = context; });
      expect(result).toEqual(rows);
      return datasetFromRows(result as typeof rows, 'prices', 1, 'backend', undefined, [], undefined, acquisition);
    };
    for (const query of [params, { ...params, chart_source: 'true' }]) {
      const acquired = await read(query);
      expect(admitReturnSummary(acquired, { date: 'date', price: 'adjusted_close' }, ['AAA.US'], own))
        .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/acquisition receipt/i) });
    }
  } finally { await server.close(); }
});

it('refuses a remote snapshot-shaped legacy response while admitting the same documented local snapshot', async () => {
  const endpoint = '/api/v1/eodhd/equity/price/historical';
  const envelope = { rows: daily.slice(0, 7), receipt, completeness: 'bounded' };
  const server = await startMockServer({ [endpoint]: { results: envelope } });
  try {
    const result = await fetchWidgetData(backend({ baseUrl: server.url }), widget({ type: 'table', endpoint, dataKey: 'results.rows' }), {
      ...receipt, symbol: 'AAA.US', provider: 'eodhd',
    });
    expect(result).toEqual(envelope);
    const { data, snapshot } = parseTableSnapshot(result);
    const remote = datasetFromRows(data as typeof daily, 'prices', 1, 'backend', undefined, [], snapshot);
    const prepared = prepareSelectedPrices(remote, priceFields, ['AAA.US']);
    if (!prepared.ok) throw new Error(prepared.message);
    expect(dailyReturnSamples(prepared.series[0]).samples).toHaveLength(6);
    expect(admitReturnSummary(remote, priceFields, ['AAA.US'], own))
      .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/local.*snapshot/i) });

    const local = await source(envelope.rows);
    const admitted = admitReturnSummary(local, priceFields, ['AAA.US'], own);
    if (!admitted.ok) throw new Error(admitted.message);
    expect(admitted.value.series[0].samples).toHaveLength(6);
  } finally { await server.close(); }
});

it.each([[], ['AAA.US', 'AAA.US'], Array.from({ length: 13 }, (_, i) => `AAA${i}.US`)].map(symbols => ({ symbols })))(
  'refuses an empty, repeated or oversized listing selection %j', async ({ symbols }) => {
    expect(admitReturnSummary(await source(), priceFields, symbols, own)).toMatchObject({ ok: false, refused: true });
  },
);

const options: ReturnSummaryOptions = { version: 1, kind: 'return-summary', fields: priceFields, symbols: ['AAA.US'], view: 'box', window: own };
const context = { theme: 'light', today: day(31), maxDecimals: 2 } as const;
const returnsAsPrices = (values: number[]) => values.reduce((closes, value) => [...closes, closes.at(-1)! * (1 + value)], [1]);
const varied = Array.from({ length: 20 }, (_, i) => (i % 5) / 8);
const fromReturns = (values: number[], symbol = 'AAA.US') => dailyPriceRows(returnsAsPrices(values), symbol);
const extremePrices = Array.from({ length: 21 }, (_, i) => i % 2 === 0 ? 1 : (1 + (i % 7) / 8) * 2 ** 1023);

it('known_result computes R7 quartiles, observed Tukey whiskers and the complete outlier set', () => {
  const summary = summarizeReturns([0, .01, .02, .03, 1]);
  expect(summary).toMatchObject({ q1: .01, median: .02, q3: .03, lowerWhisker: 0, upperWhisker: .03, outliers: [1] });
  expect(summarizeReturns([-.375, 0, 0, .125, .25, .25, .625])).toMatchObject({
    q1: 0, q3: .25, lowerWhisker: -.375, upperWhisker: .625, outliers: [],
  });
  expect(summarizeReturns([1.25, 1, 1, 1, 1, 1, 1, 1, 1.25]).outliers).toEqual([1.25, 1.25]);
});

it('zero_missing_and_scope retains exact zero and explains gaps and KDE fallback', async () => {
  const rows = dailyPriceRows(Array.from({ length: 24 }, (_, i) => i === 1 ? null : 1), 'AAA.US');
  const result = buildReturnSummary(await source(rows), { ...options, view: 'violin' }, context);
  if (!result.ok) throw new Error(result.message);
  expect(result.returnSummary).toMatchObject({
    view: 'box', scope: { start: day(1), end: day(31), interval: '1d' }, adjustmentBasis: 'adjusted-price',
    series: [{ symbol: 'AAA.US', start: day(4), end: day(24), excludedOpportunities: 2, gapCount: 1,
      summary: { q1: 0, median: 0, q3: 0, iqr: 0, outliers: [] } }],
  });
  expect(result.returnSummary?.series[0].samples).toEqual(Array.from({ length: 21 }, (_, i) => ({ date: day(i + 4), value: 0 })));
  expect(result.notes?.join(' ')).toMatch(/KDE.*zero.*bandwidth/i);
  expect(result.notes?.join(' ')).toMatch(/zero IQR/i);
});

it('hidden_unsafe_fact refuses after an acquired conflicting point is removed from the displayed dataset', async () => {
  const data = await source([...daily, { ...daily[3], adjusted_close: 700 }]);
  const presented = data.rows.slice(0, -1);
  data.provenance = priceOmissionEvidence(data, data.rows, presented, Object.values(priceFields));
  data.rows = presented;
  expect(runRecipe(data, options, context)).toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/conflict/i) });
});

it('numerical_limits computes a stable KDE for tiny and huge samples, and refuses collapsed geometry', async () => {
  for (const scale of [1e-200, 1e200]) {
    const density = estimateReturnDensity(varied.map(value => value * scale));
    if (!density.ok) throw new Error(density.reason);
    expect(density.points).toHaveLength(128);
    expect(density.points[0].value).toBe(0);
    expect(density.points.at(-1)?.value).toBe(.5 * scale);
    expect(density.points.every(point => Number.isFinite(point.density) && point.density > 0)).toBe(true);
    expect(density.bandwidth / scale).toBeCloseTo(.08966020314111067, 14);
    expect(density.points[63].value / scale).toBeCloseTo(.24803149606299213, 14);
    expect(density.points[0].density * scale).toBeCloseTo(1.2450112823994681, 13);
    expect(density.points[63].density * scale).toBeCloseTo(1.5998392598161482, 13);
  }
  expect(() => summarizeReturns([NaN, 0, 0, 0, 1])).toThrow(RangeError);
  expect(() => summarizeReturns([-1e308, -1e308, 0, 1e308, 1e308])).toThrow(RangeError);
  const close = estimateReturnDensity(Array.from({ length: 20 }, (_, i) => 1 + (i % 5) * Number.EPSILON));
  expect(close).toMatchObject({ ok: false, reason: 'geometry' });
  const extreme = await source(dailyPriceRows(extremePrices, 'AAA.US'));
  const result = runRecipe(extreme, { ...options, view: 'violin' }, context);
  if (!result.ok) throw new Error(result.message);
  expect(result.returnSummary?.series[0].samples[1].value).toBe(-1);
  expect(result.returnSummary?.series[0].samples[0].value).toBe(extremePrices[1]);
  const mixed = await source([...dailyPriceRows(extremePrices, 'AAA.US'), ...fromReturns(varied, 'BBB.US')]);
  expect(runRecipe(mixed, { ...options, symbols: ['AAA.US', 'BBB.US'] }, context))
    .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/geometry/i) });
});

it('R7 quartiles stay precomputed when a whisker falls inside the box', async () => {
  const result = runRecipe(await source(fromReturns([-.75, -.75, 0, 0, 0, 0, 0, 0])), options, context);
  if (!result.ok) throw new Error(result.message);
  expect(result.returnSummary?.series[0].summary).toMatchObject({
    q1: -.1875, median: 0, q3: 0, lowerWhisker: 0, upperWhisker: 0, outliers: [-.75, -.75],
  });
  expect(result.figure.data).toContainEqual(expect.objectContaining({
    type: 'box', q1: [-.1875], median: [0], q3: [0], showwhiskers: false,
  }));
});

it('constant and nearly constant observations do not create infinite bandwidth or fake KDE', () => {
  expect(estimateReturnDensity(Array(20).fill(0))).toMatchObject({ ok: false, reason: 'bandwidth' });
  const result = estimateReturnDensity(Array.from({ length: 20 }, (_, i) => 1 + ((i % 5) * 1e-11)));
  if (!result.ok) throw new Error(result.reason);
  expect(result.points).toHaveLength(128);
  expect(result.bandwidth).toBeGreaterThan(0);
  expect(result.points.map(p => p.value)).toEqual([...new Set(result.points.map(p => p.value))]);
});

it('all selected listings stay represented and N=4, 5, 19 and 20 gate the correct whole figure', async () => {
  expect(runRecipe(await source([...daily, ...fromReturns(varied.slice(0, 4), 'BBB.US')]),
    { ...options, symbols: ['AAA.US', 'BBB.US'] }, context))
    .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/5.*BBB\.US.*4/) });
  const five = runRecipe(await source(fromReturns(varied.slice(0, 5))), options, context);
  expect(five).toMatchObject({ ok: true, returnSummary: { view: 'box', series: [{ samples: expect.any(Array) }] } });
  const peers = (count: number) => source([...fromReturns(varied), ...fromReturns(varied.slice(0, count).map(x => x / 2), 'BBB.US')]);
  const violin = { ...options, view: 'violin', symbols: ['BBB.US', 'AAA.US'] } as const;
  const selection: ReturnSummaryOptions = { ...violin, symbols: [...violin.symbols] };
  const nineteen = runRecipe(await peers(19), selection, context);
  expect(nineteen).toMatchObject({ ok: true, returnSummary: { view: 'box', series: [{ symbol: 'BBB.US' }, { symbol: 'AAA.US' }] },
    notes: expect.arrayContaining([expect.stringMatching(/BBB\.US.*20.*19/)]) });
  const twenty = runRecipe(await peers(20), selection, context);
  if (!twenty.ok) throw new Error(twenty.message);
  expect(twenty.returnSummary?.view).toBe('violin');
  const polygons = twenty.figure.data.filter((trace): trace is { fill: 'toself'; x: number[] } =>
    typeof trace === 'object' && trace !== null && 'fill' in trace && trace.fill === 'toself');
  expect(polygons).toHaveLength(2);
  expect(Math.max(...polygons[0].x)).toBeCloseTo(.34);
  expect(Math.max(...polygons[1].x) - 1).toBeCloseTo(.17);
});

it('decodes only closed, distinct, qualified return summary selections and explicit date bounds', () => {
  expect(decodeRecipeOptions(options, 'return-summary')).toEqual({ ok: true, options });
  for (const value of [
    { ...options, version: 2 }, { ...options, symbols: ['AAA'] }, { ...options, symbols: ['AAA.US', 'AAA.US'] },
    { ...options, fields: { ...priceFields, symbol: priceFields.date } }, { ...options, evidence: 'verified' },
    { ...options, window: { mode: 'own', start: day(1) } }, { ...options, view: 'histogram' },
    { ...options, window: { mode: 'common', start: day(3), end: day(2) } },
    { ...options, window: { mode: 'common', start: day(1), end: day(2), other: day(2) } },
  ]) expect(decodeRecipeOptions(value, 'return-summary').ok).toBe(false);
  const common = { ...options, window: { mode: 'common', start: day(2), end: day(8) } };
  expect(decodeRecipeOptions(common, 'return-summary')).toEqual({ ok: true, options: common });
});

it('runs with aliases from acquired case-insensitive price origins and rejects a custom binding', async () => {
  const data = await source(daily.map(({ date, adjusted_close, symbol }) => ({
    DATE: date, ADJUSTED_CLOSE: adjusted_close, SYMBOL: symbol, custom: adjusted_close,
  })));
  const fields = { date: 'DATE', price: 'ADJUSTED_CLOSE', symbol: 'SYMBOL' };
  expect(runRecipe(data, { ...options, fields }, context).ok).toBe(true);
  expect(runRecipe(data, { ...options, fields: { ...fields, price: 'custom' } }, context).ok).toBe(false);
});

it('rejects violin extents below renderer pixel precision and preserves scale when the plot is large enough', async () => {
  const data = await source([...fromReturns(varied), ...fromReturns(varied.map(value => value * 1e-4), 'BBB.US')]);
  const selection: ReturnSummaryOptions = { ...options, view: 'violin', symbols: ['AAA.US', 'BBB.US'] };
  const measured = { ...context, viewportWidth: 740, viewportHeight: 400 };
  const ordinary = runRecipe(data, selection, measured);
  const larger = runRecipe(data, selection, { ...measured, viewportWidth: 900, viewportHeight: 500 });
  if (!ordinary.ok) throw new Error(ordinary.message);
  if (!larger.ok) throw new Error(larger.message);
  expect(ordinary.returnSummary?.view).toBe('violin');
  expect(larger.revision).toBe(ordinary.revision);
  expect(larger.figure.data).toEqual(ordinary.figure.data);
  expect(runRecipe(data, selection, { ...measured, viewportWidth: 420 }))
    .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/geometry.*AAA\.US/i) });
  expect(runRecipe(data, selection, { ...measured, viewportHeight: 260 }))
    .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/geometry.*BBB\.US/i) });
});
