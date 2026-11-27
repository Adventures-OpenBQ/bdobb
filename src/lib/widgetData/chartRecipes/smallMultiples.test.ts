// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { liveDailyPriceDataset } from '../../../test/fixtures/liveDailyPrices';
import { projectChartSources } from './chartSourceContracts';
import { dailyPriceRows, priceDataset, priceFields } from './fixtures';
import { buildSmallMultiples, smallMultiplesGrid } from './smallMultiples';
import type { RecipeOptions, RecipeResult } from './types';

const context = { theme: 'light', maxDecimals: 2, today: '2026-02-01' } as const;
const options = { version: 1, kind: 'small-multiples', fields: priceFields, symbols: ['A', 'B'] } satisfies RecipeOptions;
const date = (day: number) => `2026-01-${String(day).padStart(2, '0')}`;
const closes = (symbol: string, prices: (number | null)[], first = 1) =>
  dailyPriceRows(prices, symbol).map((row, index) => ({ ...row, date: date(first + index) }));
const source = (a: (number | null)[], b: (number | null)[]) => priceDataset([...closes('A', a), ...closes('B', b)]);
const build = (dataset = source([100, 110, 90], [200, 180, 220])) => buildSmallMultiples(dataset, options, context);
const liveSymbols = ['AAPL.US', 'MCD.US'];
const liveOptions = { ...options, symbols: liveSymbols };
const liveRows = [...closes('MCD.US', [50, 55], 6), ...closes('AAPL.US', [100, 110, 121], 5)];

function plotted(result: RecipeResult) {
  if (!result.ok) throw new Error(result.message);
  return result.figure.data as {
    uid: string; name: string; x: string[]; y: (number | null)[]; xaxis: string; yaxis: string; connectgaps: boolean;
  }[];
}

it('indexes live listings in selection order with the same shared baseline as a snapshot', () => {
  const result = buildSmallMultiples(liveDailyPriceDataset(liveRows, liveSymbols), liveOptions, context);
  const traces = plotted(result);
  expect(traces).toMatchObject([
    { name: 'AAPL.US', x: [date(6), date(7)], y: [100, expect.closeTo(110)] },
    { name: 'MCD.US', x: [date(6), date(7)], y: [100, expect.closeTo(110)] },
  ]);
  expect(traces).toEqual(plotted(buildSmallMultiples(priceDataset(liveRows), liveOptions, context)));
  expect(result).toMatchObject({
    notes: expect.arrayContaining([
      'Shared baseline 100 on 2026-01-06. All panels end on 2026-01-07.',
      'Indexed observed adjusted prices; exchange-session completeness unknown.',
    ]),
    figure: { layout: { xaxis: { range: [date(6), date(7)] }, xaxis2: { range: [date(6), date(7)] } } },
  });
});

it('uses the last visible live row for the shared end after table filtering', () => {
  const dataset = liveDailyPriceDataset(liveRows, liveSymbols);
  const rows = dataset.rows.filter(({ values }) => !(values.symbol === 'MCD.US' && values.date === date(7)));
  const projected = { ...dataset, rows, provenance: projectChartSources(dataset.provenance, dataset.columns, rows) };
  const result = buildSmallMultiples(projected, liveOptions, context);
  expect(result).toMatchObject({
    ok: false, refused: true,
    message: expect.stringMatching(/later positive price.*table filtering.*All panels end on 2026-01-06/),
  });
});

it('does not extend the live shared end to a provider omission', () => {
  const rows = [...liveRows, ...closes('AAPL.US', [125], 8)];
  const dataset = liveDailyPriceDataset(rows, liveSymbols, { omissions: [['MCD.US', date(8)]] });
  const result = buildSmallMultiples(dataset, liveOptions, context);
  expect(plotted(result).map(trace => trace.x)).toEqual([[date(6), date(7)], [date(6), date(7)]]);
  expect(result).toMatchObject({ figure: { layout: { xaxis: { range: [date(6), date(7)] } } } });
});

it('uses the verified listing identity for a single live panel without a symbol field', () => {
  const rows = [{ date: date(5), adjusted_close: 100 }, { date: date(6), adjusted_close: 110 }];
  const dataset = liveDailyPriceDataset(rows, ['AAPL.US']);
  const result = buildSmallMultiples(dataset, {
    ...liveOptions, symbols: ['AAPL.US'], fields: { date: 'date', price: 'adjusted_close' },
  }, context);
  expect(plotted(result)).toMatchObject([{ name: 'AAPL.US', x: [date(5), date(6)], y: [100, 110] }]);
});

it('refuses a missing selected live listing instead of rendering fewer panels', () => {
  const dataset = liveDailyPriceDataset(liveRows.filter(row => row.symbol === 'AAPL.US'), liveSymbols);
  expect(buildSmallMultiples(dataset, liveOptions, context)).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/No usable delivered daily price series.*MCD\.US/),
  });
});

it('indexes selected symbols on one shared baseline', () => {
  const result = build();
  expect(plotted(result).map(trace => trace.y)).toEqual([[100, 110, 90], [100, 90, 110]]);
  expect(result).toMatchObject({
    notes: expect.arrayContaining([expect.stringMatching(/baseline.*2026-01-01.*2026-01-03/i)]),
    figure: { layout: {
      xaxis: { range: [date(1), date(3)] }, xaxis2: { range: [date(1), date(3)] },
      yaxis: { range: [90, 110] }, yaxis2: { range: [90, 110] },
    } },
  });
});

it('moves the baseline to the first date all selected symbols have a positive price', () => {
  const result = build(priceDataset([...closes('A', [100, 125, 150, 100]), ...closes('B', [null, 200, 220], 2)]));
  expect(plotted(result).map(trace => [trace.x, trace.y])).toEqual([
    [[date(3), date(4)], [100, 66.66666666666667]], [[date(3), date(4)], [100, 110]],
  ]);
  expect(result).toMatchObject({ notes: expect.arrayContaining([
    expect.stringMatching(/acquisition window.*2026-01-01.*2026-01-31.*outside.*excluded/i),
  ]) });
});

it('caps every panel at the earliest last delivered date even with a later documented omission', () => {
  const dataset = source([100, 110, null], [200, 180, 220, 230, 240]);
  dataset.completeness.acquiredRowCount = dataset.rows.length + 1;
  dataset.provenance.metadata = { priceOmissions: {
    acquired: dataset.rows.length + 1, delivered: dataset.rows.length, dateField: 'date',
    symbolFields: ['symbol'], points: [['A', date(4)]],
  } };
  const result = build(dataset);
  expect(plotted(result).map(trace => trace.x)).toEqual([[date(1), date(2), date(3)], [date(1), date(2), date(3)]]);
  expect(plotted(result).map(trace => trace.y)).toEqual([[100, 110, null], [100, 90, 110]]);
  expect(result).toMatchObject({ figure: { layout: {
    xaxis: { range: [date(1), date(3)] }, xaxis2: { range: [date(1), date(3)] },
    yaxis: { range: [90, 110] }, yaxis2: { range: [90, 110] },
  } } });
});

it('refuses disjoint positive dates', () => {
  expect(build(source([100, null, 90, null], [null, 220, null, 180]))).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/no shared baseline date/i),
  });
});

it('requires a later positive observation for each selected symbol inside the cutoff', () => {
  expect(build(source([null, 100, null], [200, 180, 220, 240]))).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/later positive price.*A/i),
  });
});

it.each(['delivered null', 'documented omission'])('breaks the line at a %s without rebasing', gap => {
  const dataset = source([100, 110, null, 90], [200, 180, 220, 240]);
  if (gap === 'documented omission') {
    dataset.rows.splice(2, 1);
    dataset.completeness.acquiredRowCount = dataset.rows.length + 1;
    dataset.provenance.metadata = { priceOmissions: {
      acquired: dataset.rows.length + 1, delivered: dataset.rows.length, dateField: 'date',
      symbolFields: ['symbol'], points: [['A', date(3)]],
    } };
  }
  expect(plotted(build(dataset))[0]).toMatchObject({
    x: [date(1), date(2), date(3), date(4)], y: [100, 110, null, 90], connectgaps: false,
  });
});

it('refuses a conflicting selected series', () => {
  const dataset = priceDataset([...closes('A', [100, 110]), ...closes('A', [120], 2), ...closes('B', [200, 210])]);
  expect(build(dataset)).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/selected symbol.*A.*conflicting duplicate/i),
  });
});

it('uses receipt identity and honors authored calendar dates without a symbol field', () => {
  const dataset = priceDataset(closes('A', [100, 110, 120]).map(({ date, adjusted_close }) =>
    ({ date: `${date}T23:00:00-05:00`, adjusted_close })));
  dataset.provenance.receipt = { ...dataset.provenance.receipt, symbol: 'A' };
  const result = buildSmallMultiples(dataset, {
    ...options, symbols: ['A'], fields: { date: 'date', price: 'adjusted_close' },
  }, context);
  expect(plotted(result)[0]).toMatchObject({ name: 'A', x: [date(1), date(2), date(3)], y: [100, 110, 120] });
});

it('refuses a nonfinite index', () => {
  expect(build(source([Number.MIN_VALUE, Number.MAX_VALUE], [200, 210]))).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/nonfinite.*index/i),
  });
});

it('refuses a finite index that Plotly would clip from the shared range', () => {
  expect(build(source([100, Number.MAX_VALUE], [200, 210]))).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/outside.*displayable.*range/i),
  });
});

it('refuses a positive index that would underflow to zero', () => {
  expect(build(source([Number.MAX_VALUE, Number.MIN_VALUE], [200, 210]))).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/outside.*displayable.*range/i),
  });
});

it('gives constant indexes the same finite range centered on 100', () => {
  const result = build(source([100, 100], [Number.MAX_VALUE, Number.MAX_VALUE]));
  if (!result.ok) throw new Error(result.message);
  expect(plotted(result).map(trace => trace.y)).toEqual([[100, 100], [100, 100]]);
  const [low, high] = (result.figure.layout.yaxis as { range: number[] }).range;
  expect(Number.isFinite(low) && Number.isFinite(high) && low < 100 && high > 100).toBe(true);
  expect(100 - low).toBe(high - 100);
  expect(result.figure.layout.yaxis2).toMatchObject({ range: [low, high] });
});

it('reflows without changing the chart question', () => {
  expect(smallMultiplesGrid(400, 12)).toEqual({ columns: 1, rows: 12, height: 2700 });
  expect(smallMultiplesGrid(800, 12)).toEqual({ columns: 2, rows: 6, height: 1380 });
  expect(smallMultiplesGrid(1200, 12)).toEqual({ columns: 3, rows: 4, height: 940 });
  expect([639, 640, 959, 960].map(width => smallMultiplesGrid(width, 12).columns)).toEqual([1, 2, 2, 3]);
  expect(smallMultiplesGrid(1200, 1)).toEqual({ columns: 1, rows: 1, height: 280 });

  const listed = ['M', 'J', 'A', 'V', 'I', 'X', 'B', 'Y', 'Z', 'Q', 'D', 'E'];
  const dataset = priceDataset([...listed].reverse().flatMap(symbol => closes(symbol, [100, 110, 90])));
  const outputs = [400, 800, 1200].map(viewportWidth =>
    buildSmallMultiples(dataset, { ...options, symbols: listed }, { ...context, viewportWidth }));
  const [original] = outputs;
  if (!original.ok) throw new Error(original.message);
  const traces = plotted(original);
  expect(traces.map(trace => trace.name)).toEqual(listed);
  expect(new Set(traces.map(trace => trace.uid)).size).toBe(12);

  outputs.forEach((result, i) => {
    expect(plotted(result)).toEqual(traces);
    expect(result).toMatchObject({ revision: original.revision, figure: { layout: {
      height: [2700, 1380, 940][i], grid: { columns: [1, 2, 3][i], rows: [12, 6, 4][i] },
    } } });
    if (!result.ok) throw new Error(result.message);
    traces.forEach((trace, index) => {
      const suffix = index === 0 ? '' : String(index + 1);
      expect([trace.xaxis, trace.yaxis]).toEqual([`x${suffix}`, `y${suffix}`]);
      expect(result.figure.layout[`xaxis${suffix}`]).toMatchObject({ range: [date(1), date(3)] });
      expect(result.figure.layout[`yaxis${suffix}`]).toMatchObject({ range: [90, 110] });
    });
  });
});

it('changes the revision when the selected panel order changes', () => {
  const dataset = source([100, 110], [200, 240]);
  const original = build(dataset);
  const reordered = buildSmallMultiples(dataset, { ...options, symbols: ['B', 'A'] }, context);
  if (!original.ok || !reordered.ok) throw new Error('Expected both questions to build');
  expect(reordered.revision).not.toBe(original.revision);
  expect(plotted(reordered).map(trace => trace.uid)).toEqual(plotted(original).map(trace => trace.uid).reverse());
});
