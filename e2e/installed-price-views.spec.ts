// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect } from '@playwright/test';
import type { RecipeOptions } from '../src/lib/widgetData/chartRecipes/types';
import { readCapture, replayInstalledPrices, sourceId, table, type CaptureRoute } from './fixtures/installed-prices';
import { card, openParameters, plot, plotlyTraces, recordRecipeReplies, type PlotlyTrace } from './fixtures/chart-recipes';
import { test } from './fixtures/return-summary';

type Point = { date: string; price: number | null };
const histogram = 'Captured return distribution';
const drawdown = 'Captured drawdown';
const comparison = 'Captured indexed prices';
const scopes = {
  'return-distribution': 'Observed quote-to-quote returns; exchange-session completeness unknown.',
  drawdown: 'Drawdown uses observed adjusted prices in the loaded history; exchange-session completeness and peaks during missing observations are unknown.',
  'small-multiples': 'Indexed observed adjusted prices; exchange-session completeness unknown.',
};
const symbols = ['MCD.US', 'AAPL.US'];
const fields = { date: 'date', price: 'adjusted_close', symbol: 'symbol' };
const bins = 8;
type PriceRecipe = Extract<RecipeOptions, { kind: keyof typeof scopes }>;
const options: PriceRecipe[] = [
  { kind: 'return-distribution', version: 1, fields, symbol: symbols[0], bins },
  { kind: 'drawdown', version: 1, fields, symbols },
  { kind: 'small-multiples', version: 1, fields, symbols },
];

function historiesFromCapture(body: CaptureRoute['body']) {
  const listings = body.extra.results_metadata.chart_sources.receipts[0].listings;
  return new Map(symbols.map(symbol => {
    const delivered = body.results.filter(row => row.symbol === symbol);
    const gaps = listings.find(listing => listing.symbol === symbol)!.omissions;
    // The delivered response arrays carry prices; the receipt supplies known
    // omission dates. A missing date on its own cannot establish a price gap.
    const points: Point[] = [
      ...delivered.map(({ date, adjusted_close }) => ({ date, price: adjusted_close })),
      ...gaps.map(([, date]) => ({ date, price: null })),
    ];
    points.sort((a, b) => a.date.localeCompare(b.date));
    return [symbol, { delivered, points }];
  }));
}

function samples(points: Point[]) {
  return points.slice(1).flatMap(({ date, price }, i) => {
    const previous = points[i].price;
    return price === null || previous === null ? [] : [{ date, value: price / previous - 1 }];
  });
}

function expectedBins(returns: ReturnType<typeof samples>) {
  const values = returns.map(sample => sample.value);
  const from = Math.min(...values), to = Math.max(...values);
  const step = (to - from) / bins;
  return Array.from({ length: bins }, (_, i) => {
    const left = from + i * step;
    const last = i === bins - 1;
    const right = last ? to : from + (i + 1) * step;
    return { left, width: right - left, count: values.filter(v => v >= left && (last ? v <= right : v < right)).length };
  });
}

function expectedDrawdown(histories: ReturnType<typeof historiesFromCapture>) {
  const bySymbol = new Map<string, Partial<PlotlyTrace>[]>();
  for (const [symbol, { points, delivered }] of histories) {
    const x = points.map(point => point.date);
    const y = points.map(({ date, price }) => price === null ? null
      : price / Math.max(...delivered.filter(row => row.date <= date).map(row => row.adjusted_close)) - 1);
    const fillX: PlotlyTrace['x'] = [], fillY: PlotlyTrace['y'] = [];
    for (const [i, date] of x.entries()) {
      const value = y[i];
      if (value === null) continue;
      if (y[i - 1] == null) {
        if (i > 0 && fillX.length) { fillX.push(null); fillY.push(null); }
        fillX.push(date); fillY.push(0);
      }
      fillX.push(date); fillY.push(value);
      if (y[i + 1] == null) { fillX.push(date); fillY.push(0); }
    }
    bySymbol.set(symbol, [
      { type: 'scatter', mode: 'none', fill: 'toself', legendgroup: symbol, x: fillX, y: fillY, connectgaps: false },
      { type: 'scatter', mode: 'lines+markers', name: symbol, legendgroup: symbol, x, y, connectgaps: false },
    ]);
  }
  return bySymbol;
}

const captureCases = [
  ['deterministic-sdk', '/api/v1/eodhd/equity/price/historical'],
  ['deterministic-sdk', '/api/v1/eodhd/etf/historical'],
  ['public-demo', '/api/v1/eodhd/equity/price/historical'],
] as const;

for (const [name, endpoint] of captureCases) {
  test(`installed mirror replay: ${name} GET ${endpoint} reproduces the raw histories in all three views`, async ({ page, engineEvidence }, info) => {
    const capture = readCapture(name);
    const route = capture.routes[endpoint];
    expect(route.selector).toBe('results');
    expect(route.widget.data.dataKey).toBe('results');
    const readReplies = await recordRecipeReplies(page);
    const names = [histogram, drawdown, comparison];
    const charts = options.map((recipe, i) => ({
      id: recipe.kind, widgetId: 'linked_chart', backendId: 'builtin', title: names[i], params: {},
      linkedSource: { kind: 'widget', sourceWidgetId: sourceId },
      linkedChart: { type: recipe.kind, recipe, measures: [], display: 'grouped' },
      layout: { x: i === 1 ? 20 : 0, y: i === 2 ? 23 : 0, w: i === 2 ? 40 : 20, h: 23 },
    }));
    const requests = await replayInstalledPrices(page, endpoint, route, charts, 46);
    await expect(card(page, table).getByRole('columnheader', { name: /adjusted.close/i })).toBeAttached();
    for (const [i, recipe] of options.entries()) {
      await expect(plot(page, names[i])).toBeVisible();
      const widget = card(page, names[i]);
      await expect(widget.getByRole('status').getByText(scopes[recipe.kind], { exact: true })).toBeVisible();
      await expect(widget.getByRole('status').getByText('unknown data', { exact: true })).toBeVisible();
    }

    const histories = historiesFromCapture(route.body);
    const expectedSamples = Object.fromEntries([...histories].map(([symbol, { points }]) => [symbol, samples(points)]));
    if (name === 'public-demo') {
      for (const [symbol, { delivered }] of histories) {
        const direct = capture.directPublicCaptures?.[symbol].response;
        expect(direct?.map(({ date, adjusted_close }) => ({ date, adjusted_close })))
          .toEqual(delivered.map(({ date, adjusted_close }) => ({ date, adjusted_close })));
        expect(delivered).toHaveLength(29);
        expect(new Set(delivered.map(row => row.date)).size).toBe(29);
        expect(delivered.every(row => Number.isFinite(row.adjusted_close) && row.adjusted_close > 0)).toBe(true);
        expect(expectedSamples[symbol]).toHaveLength(28);
      }
    } else {
      expect(Object.values(expectedSamples).map(series => series.length)).toEqual([7, 9]);
    }

    const resultFor = async (kind: RecipeOptions['kind'], symbol?: string) => {
      const record = (await readReplies()).filter(({ options }) => options.kind === kind
        && (!symbol || (options.kind === 'return-distribution' && options.symbol === symbol))).at(-1);
      return record && 'result' in record.reply && record.reply.result.ok ? record.reply.result : undefined;
    };
    const workerData = async (kind: RecipeOptions['kind'], symbol?: string) =>
      (await resultFor(kind, symbol))?.figure.data as PlotlyTrace[] | undefined;
    const observed: Record<string, PlotlyTrace[]> = {};
    async function verifyHistogram(symbol: string) {
      const series = expectedSamples[symbol];
      const expected = expectedBins(series);
      const note = `N = ${series.length} observed quote-to-quote returns for ${symbol} from ${series[0].date} to ${series.at(-1)!.date}.`;
      await expect(card(page, histogram).getByRole('status').getByText(note, { exact: true })).toBeVisible();
      const trace = { type: 'bar', name: symbol, x: expected.map(bin => bin.left),
        y: expected.map(bin => bin.count), width: expected.map(bin => bin.width) };
      const worker = await workerData('return-distribution', symbol);
      expect(worker).toMatchObject([trace]);
      const plotted = () => plotlyTraces(plot(page, histogram));
      await expect.poll(plotted).toMatchObject([trace]);
      observed[symbol] = await plotted();
      expect(observed[symbol][0].y.reduce<number>((sum, count) => sum + (count ?? 0), 0)).toBe(series.length);
    }
    await verifyHistogram(symbols[0]);
    const acquired = requests.length;
    expect(acquired).toBeGreaterThan(0);
    expect(requests).toEqual(Array(acquired).fill({ method: route.method, query: route.query }));
    const form = await openParameters(card(page, histogram));
    await form.getByRole('combobox', { name: 'Symbol', exact: true }).selectOption(symbols[1]);
    await form.getByRole('button', { name: 'Apply chart settings', exact: true }).click();
    await verifyHistogram(symbols[1]);
    await card(page, histogram).getByRole('button', { name: 'Hide parameters' }).click();

    const drawOracle = expectedDrawdown(histories);
    const byListing = (traces: PlotlyTrace[] | undefined, symbol: string) => traces?.filter(trace => trace.legendgroup === symbol);
    const drawPlot = await plotlyTraces(plot(page, drawdown));
    const drawWorker = await workerData('drawdown');
    expect(drawWorker).toHaveLength(4);
    expect(drawPlot).toHaveLength(4);
    for (const symbol of symbols) {
      expect(byListing(drawWorker, symbol)).toMatchObject(drawOracle.get(symbol)!);
      // Plotly omits the line-only attribute on a mode:none fill trace.
      const [fill, line] = byListing(drawPlot, symbol)!;
      expect([{ ...fill, connectgaps: fill.connectgaps ?? false }, line])
        .toMatchObject(drawOracle.get(symbol)!.map(trace => ({ ...trace, visible: true })));
    }
    observed.drawdown = drawPlot;

    const a = histories.get(symbols[0])!.delivered;
    const b = histories.get(symbols[1])!.delivered;
    const shared = a.filter(row => b.some(peer => peer.date === row.date)).map(row => row.date).sort();
    const start = shared[0];
    const end = [a.map(row => row.date).sort().at(-1)!, b.map(row => row.date).sort().at(-1)!].sort()[0];
    const indexed = symbols.map((symbol, i) => {
      const { points } = histories.get(symbol)!;
      const base = points.find(point => point.date === start)!.price!;
      const visible = points.filter(point => point.date >= start && point.date <= end);
      return { name: symbol, xaxis: i === 0 ? 'x' : 'x2', yaxis: i === 0 ? 'y' : 'y2',
        x: visible.map(point => point.date), y: visible.map(({ price }) => price === null ? null : 100 * price / base), connectgaps: false };
    });
    expect(indexed.map(trace => trace.y[0])).toEqual([100, 100]);
    expect(await workerData('small-multiples')).toMatchObject(indexed);
    const multiplesPlot = () => plotlyTraces(plot(page, comparison));
    await expect.poll(multiplesPlot).toMatchObject(indexed);
    observed.indexed = await multiplesPlot();
    expect((await resultFor('small-multiples'))?.figure.layout).toMatchObject({
      xaxis: { range: [start, end] }, xaxis2: { range: [start, end], matches: 'x' },
    });
    await expect(card(page, comparison).getByRole('status')
      .getByText(`Shared baseline 100 on ${start}. All panels end on ${end}.`, { exact: true })).toBeVisible();
    expect(requests).toHaveLength(acquired);

    await info.attach('installed-replay', {
      body: JSON.stringify({ qualification: capture.qualification, engineEvidence, requests, expectedSamples, replies: await readReplies(), plotted: observed }),
      contentType: 'application/json',
    });
    await page.locator('main.dashboard-area').screenshot({ path: info.outputPath('installed-replay.png') });
  });
}
