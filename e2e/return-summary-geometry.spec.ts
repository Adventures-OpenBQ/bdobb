// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Locator, type Page } from '@playwright/test';
import type { ReturnSummaryOptions } from '../src/lib/widgetData/chartRecipes/types';

type Axis = { _offset: number; _length: number; range: number[]; tickvals?: number[]; c2p: (coordinate: number) => number };
type Graph = HTMLElement & { _fullLayout: { xaxis: Axis; yaxis: Axis; minreducedwidth: number; minreducedheight: number } };

async function draw(
  page: Page, prices: number[], view: ReturnSummaryOptions['view'], theme: 'light' | 'dark' = 'light', peerPrices?: number[],
) {
  await page.goto('/');
  const plotWidth = theme === 'dark' ? 420 : 740;
  const plotHeight = 400;
  const outcome = await page.evaluate(async ({ prices, view, theme, plotWidth, plotHeight, peerPrices }) => {
    const tablePath = '/src/lib/localTableData.ts';
    const workerPath = '/src/lib/widgetData/chartRecipes/workerClient.ts';
    const plotlyPath = '/src/lib/plotly.ts';
    const { datasetFromBytes } = await import(tablePath) as typeof import('../src/lib/localTableData');
    const { createRecipeWorker } = await import(workerPath) as typeof import('../src/lib/widgetData/chartRecipes/workerClient');
    const { renderPlot } = await import(plotlyPath) as typeof import('../src/lib/plotly');
    const histories = peerPrices ? [prices, peerPrices] : [prices];
    const symbols = peerPrices ? ['AAA.US', 'BBB.US'] : ['AAA.US'];
    const rows = histories.flatMap((closes, listing) => closes.map((adjusted_close, i) => ({
      date: '2026-01-' + String(i + 1).padStart(2, '0'), adjusted_close, symbol: symbols[listing],
    })));
    const today = '2026-01-31';
    const snapshot = { rows, receipt: { interval: '1d', start_date: '2026-01-01', end_date: today }, completeness: 'bounded' };
    const dataset = await datasetFromBytes('returns.json', new TextEncoder().encode(JSON.stringify(snapshot)), 'prices', 1);
    const options: ReturnSummaryOptions = {
      version: 1, kind: 'return-summary', view, window: { mode: 'own' }, symbols,
      fields: { date: 'date', price: 'adjusted_close', symbol: 'symbol' },
    };
    const worker = createRecipeWorker();
    try {
      const result = await worker.run(dataset, options, {
        theme, maxDecimals: 2, today, viewportWidth: plotWidth, viewportHeight: plotHeight,
      }, new AbortController().signal);
      if (!result.ok) return result;
      const node = document.createElement('div');
      node.id = 'return-geometry';
      node.style.cssText = `position: fixed; top: 12px; left: 12px; width: ${plotWidth}px; height: ${plotHeight}px; z-index: 10000`;
      document.body.append(node);
      await renderPlot(node, result.figure, result.revision);
      return { ok: true } as const;
    } finally {
      worker.dispose();
    }
  }, { prices, view, theme, plotWidth, plotHeight, peerPrices });
  return { outcome, graph: page.locator('#return-geometry') };
}

async function plot(...args: Parameters<typeof draw>) {
  const { outcome, graph } = await draw(...args);
  if (!outcome.ok) throw new Error(outcome.message);
  return graph;
}

const closes = (scale: number) => Array.from({ length: 20 }, (_, i) => (i % 5) * scale)
  .reduce((values, value) => [...values, values.at(-1)! * (1 + value)], [1]);

async function hover(page: Page, graph: Locator, x: number, y: number) {
  const point = await graph.evaluate((node, [x, y]) => {
    const { xaxis, yaxis } = (node as Graph)._fullLayout;
    const bounds = node.getBoundingClientRect();
    return { x: bounds.x + xaxis._offset + xaxis.c2p(x), y: bounds.y + yaxis._offset + yaxis.c2p(y) };
  }, [x, y]);
  await page.mouse.move(point.x, point.y);
  return graph.locator('.hoverlayer');
}

test('installed Plotly draws R7 and inward observed whiskers with original outlier hovers', async ({ page }) => {
  const graph = await plot(page, [16, 4, 1, 1, 1, 1, 1, 1, 1], 'box');
  const actual = await graph.evaluate(node => {
    const { yaxis } = (node as Graph)._fullLayout;
    const box = node.querySelector<SVGPathElement>('.boxlayer path.box')!;
    const whiskers = [...node.querySelectorAll<SVGPathElement>('.scatterlayer path.js-line')];
    const { x, y, width, height } = box.getBBox();
    return {
      range: yaxis.range,
      quartileY: yaxis.c2p(-.1875),
      whiskerY: yaxis.c2p(0),
      boxD: box.getAttribute('d'),
      boxBounds: { x, y, width, height },
      whiskers: whiskers.map(path => path.getAttribute('d')),
      points: [...node.querySelectorAll('.scatterlayer path.point')].map(point => point.getAttribute('transform')),
    };
  });
  expect(actual.range[0]).toBeLessThan(-.75);
  expect(actual.range[1]).toBeGreaterThan(0);
  expect(actual.boxBounds.y).toBeCloseTo(actual.whiskerY, 1);
  expect(actual.boxBounds.y + actual.boxBounds.height).toBeCloseTo(actual.quartileY, 1);
  // Plotly insets a median one pixel when it equals a quartile.
  const medianY = Number(actual.boxD?.match(/^M[^,]+,([^H]+)H/)?.[1]);
  expect(Math.abs(medianY - actual.whiskerY)).toBeLessThanOrEqual(1.01);
  expect(actual.whiskers).toContainEqual(expect.stringMatching(new RegExp(`^M[^,]+,${actual.quartileY}L[^,]+,${actual.whiskerY}$`)));
  expect(actual.whiskers).toContainEqual(expect.stringMatching(new RegExp(`^M[^,]+,${actual.whiskerY}L[^,]+,${actual.whiskerY}$`)));
  expect(actual.points).toHaveLength(3);
  await expect(await hover(page, graph, 0, 0)).toContainText(/Q1: .*−18\.75%|Q1: .*-18\.75%/);
  const outlier = await hover(page, graph, 0, -.75);
  await expect(outlier).toContainText('Outlier');
  await expect(outlier).toContainText('-0.75');
  await test.info().attach('ordinary-box-geometry', { body: JSON.stringify(actual, null, 2), contentType: 'application/json' });
});

test('installed Plotly draws a non-collapsed extreme violin between the observed endpoints', async ({ page }) => {
  const prices = Array.from({ length: 21 }, (_, i) => i % 2 === 0 ? 1 : (1 + (i % 7) / 8) * 2 ** 1023);
  const graph = await plot(page, prices, 'violin', 'dark');
  const actual = await graph.evaluate(node => {
    const { xaxis, yaxis, minreducedwidth, minreducedheight } = (node as Graph)._fullLayout;
    const path = node.querySelector<SVGPathElement>('.scatterlayer path.js-fill')!;
    const ticks = [...node.querySelectorAll('.ytick text')].map(tick => tick.textContent);
    const { x, y, width, height } = path.getBBox();
    return {
      ranges: [xaxis.range, yaxis.range],
      declaredMinimum: [minreducedwidth, minreducedheight],
      axisLengths: [xaxis._length, yaxis._length],
      bounds: { x, y, width, height },
      d: path.getAttribute('d'),
      observedMaxY: yaxis.c2p(yaxis.tickvals!.at(-1)!),
      observedMinY: yaxis.c2p(yaxis.tickvals![0]),
      expectedWidth: xaxis.c2p(.34) - xaxis.c2p(-.34),
      ticks,
    };
  });
  expect(actual.ranges.every(range => range.every(Number.isFinite) && range[0] < range[1])).toBe(true);
  expect(actual.declaredMinimum).toEqual([169, 142]);
  actual.axisLengths.forEach((length, i) => expect(length).toBeGreaterThanOrEqual(actual.declaredMinimum[i] - 1));
  expect(actual.bounds.width).toBeCloseTo(actual.expectedWidth, 1);
  expect(actual.bounds.height).toBeGreaterThan(180);
  expect(actual.bounds.y).toBeCloseTo(actual.observedMaxY, 1);
  expect(actual.bounds.y + actual.bounds.height).toBeCloseTo(actual.observedMinY, 1);
  expect(actual.d).not.toMatch(/NaN|Infinity/);
  expect(actual.ticks).toContain('-100%');
  expect(actual.ticks.some(tick => /E310%/.test(tick ?? ''))).toBe(true);
  await test.info().attach('extreme-violin-geometry', { body: JSON.stringify(actual, null, 2), contentType: 'application/json' });
});

test('installed Plotly paints different widths on one density scale and hovers a grid endpoint', async ({ page }) => {
  const graph = await plot(page, closes(.125), 'violin', 'light', closes(.0625));
  const actual = await graph.evaluate(node => {
    const { xaxis, yaxis, minreducedwidth, minreducedheight } = (node as Graph)._fullLayout;
    const paths = [...node.querySelectorAll<SVGPathElement>('.scatterlayer path.js-fill')];
    const start = paths[0].getPointAtLength(0);
    const bounds = node.getBoundingClientRect();
    return {
      ranges: [xaxis.range, yaxis.range],
      declaredMinimum: [minreducedwidth, minreducedheight],
      axisLengths: [xaxis._length, yaxis._length],
      widths: paths.map(path => path.getBBox().width),
      heights: paths.map(path => path.getBBox().height),
      hover: { x: bounds.x + xaxis._offset + start.x, y: bounds.y + yaxis._offset + start.y },
    };
  });
  expect(actual.declaredMinimum).toEqual([329, 142]);
  actual.axisLengths.forEach((length, i) => expect(length).toBeGreaterThanOrEqual(actual.declaredMinimum[i] - 1));
  expect(actual.widths).toHaveLength(2);
  expect(actual.widths[0] / actual.widths[1]).toBeCloseTo(.5, 2);
  expect(actual.heights[1] / actual.heights[0]).toBeCloseTo(.5, 2);
  await page.mouse.move(actual.hover.x, actual.hover.y);
  const tooltip = graph.locator('.hoverlayer');
  await expect(tooltip).toContainText('Smoothed density');
  await expect(tooltip).toContainText('0% (0)');
  await expect(tooltip).toContainText('Gaussian bandwidth');
  await test.info().attach('shared-violin-geometry', { body: JSON.stringify(actual, null, 2), contentType: 'application/json' });
});

test('real worker refuses a shared scale that collapses the installed renderer polygons', async ({ page }) => {
  const { outcome, graph } = await draw(page, closes(.125), 'violin', 'light', closes(.125e-10));
  if (outcome.ok) {
    const bounds = await graph.locator('.scatterlayer path.js-fill').evaluateAll(paths =>
      paths.map(path => {
        const { width, height } = (path as SVGPathElement).getBBox();
        return { width, height };
      }),
    );
    await test.info().attach('unexpected-drawn-svg-bounds', { body: JSON.stringify(bounds), contentType: 'application/json' });
  }
  expect(outcome).toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/geometry.*plot listings separately/i) });
  await expect(graph).toHaveCount(0);
});
