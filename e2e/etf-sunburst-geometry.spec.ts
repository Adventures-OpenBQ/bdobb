// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Locator, type Page } from '@playwright/test';
import { local, rows } from '../src/test/fixtures/etfHierarchyEvidence';
import type { EtfSunburstOptions } from '../src/lib/widgetData/chartRecipes/types';

type Datum = { x0: number; x1: number; rpx0: number; rpx1: number; data: { data: { label: string; v: number } } };
type Graph = HTMLElement & { calcdata: { cx: number; cy: number }[][]; _transitioning?: boolean };

async function draw(page: Page, weights: number[], theme: 'light' | 'dark', depth: 1 | 2 = 2, sameSector = false) {
  await page.goto('/');
  const holdings = weights.map((weight, i) => {
    const row = i < 2 ? rows[i] : { ...rows[0], symbol: 'OTHER' + i + '.US' };
    return { ...row, weight, sector: sameSector ? rows[0].sector : row.sector };
  });
  const source = { ...local, raw_count: holdings.length, normalized_count: holdings.length,
    delivered_count: holdings.length, holding_keys: holdings.map(row => row.symbol) };
  const result = await page.evaluate(async ({ holdings, source, theme, depth }) => {
    const tablePath = '/src/lib/localTableData.ts';
    const workerPath = '/src/lib/widgetData/chartRecipes/workerClient.ts';
    const plotlyPath = '/src/lib/plotly.ts';
    const { datasetFromBytes } = await import(tablePath) as typeof import('../src/lib/localTableData');
    const { createRecipeWorker } = await import(workerPath) as typeof import('../src/lib/widgetData/chartRecipes/workerClient');
    const { renderPlot } = await import(plotlyPath) as typeof import('../src/lib/plotly');
    const snapshot = { rows: holdings, completeness: 'partial', chart_sources: { version: 1, receipts: [source] } };
    const input = await datasetFromBytes('holdings.json', new TextEncoder().encode(JSON.stringify(snapshot)), 'holdings', 1);
    const options: EtfSunburstOptions = { version: 1, kind: 'etf-sunburst', fund: 'VTI.US', depth, snapshot: 'latest',
      fields: { holding: 'symbol', sector: 'sector', weight: 'weight' } };
    const width = theme === 'light' ? 600 : 340;
    const height = theme === 'light' ? 460 : 320;
    const worker = createRecipeWorker();
    try {
      const result = await worker.run(input, options, {
        theme, maxDecimals: 2, today: '2026-11-20', viewportWidth: width, viewportHeight: height,
      }, new AbortController().signal);
      if (result.ok) {
        const graph = document.createElement('div');
        graph.id = 'etf-geometry';
        graph.style.cssText = `position: fixed; top: 12px; left: 12px; width: ${width}px; height: ${height}px; z-index: 10000`;
        document.body.append(graph);
        await renderPlot(graph, result.figure, result.revision);
      }
      return result;
    } finally { worker.dispose(); }
  }, { holdings, source, theme, depth });
  return { result, graph: page.locator('#etf-geometry') };
}

async function inspect(graph: Locator, sampleHolding?: string) {
  return graph.evaluate((node, sampleHolding) => {
    const { cx, cy } = (node as Graph).calcdata[0][0];
    const { x, y } = node.getBoundingClientRect();
    return [...node.querySelectorAll<SVGPathElement>('.sunburstlayer path.surface')].map(path => {
      const { x0, x1, rpx0, rpx1, data: { data } } = (path as SVGPathElement & { __data__: Datum }).__data__;
      const r = (rpx0 + rpx1) / 2;
      const a = (x0 + x1) / 2;
      const point = new DOMPoint(cx + r * Math.cos(a), cy - r * Math.sin(a));
      const { width, height } = path.getBBox();
      let filledInteriorSamples: number | undefined;
      if (data.label === sampleHolding) {
        filledInteriorSamples = 0;
        for (let ri = 1; ri < 32; ri++) {
          const r = rpx0 + (rpx1 - rpx0) * ri / 32;
          for (let ai = 1; ai < 32; ai++) {
            const angle = x0 + (x1 - x0) * ai / 32;
            if (path.isPointInFill(new DOMPoint(cx + r * Math.cos(angle), cy - r * Math.sin(angle)))) filledInteriorSamples++;
          }
        }
      }
      return { label: data.label, value: data.v, angle: x1 - x0, data: path.getAttribute('d'),
        bounds: { width, height }, containsMidpoint: path.isPointInFill(point), filledInteriorSamples,
        screen: { x: x + point.x, y: y + point.y } };
    });
  }, sampleHolding);
}

test('real worker and installed Plotly draw 35% delivered holdings and keep original hover through drill', async ({ page }) => {
  const { result, graph } = await draw(page, [.12, .15, .08, 0], 'light');
  expect(result.ok, JSON.stringify(result)).toBe(true);
  const title = graph.locator('.gtitle');
  await expect(title).toContainText('VTI.US · Delivered holdings');
  await expect(title).toContainText('35% of fund assets');
  const slices = await inspect(graph);
  const root = slices.find(slice => slice.label === 'Delivered holdings')!;
  const sector = slices.find(slice => slice.label === 'Technology')!;
  const holding = slices.find(slice => slice.label === 'AAPL.US')!;
  expect(slices).toHaveLength(6);
  expect(root.value).toBeCloseTo(.35, 14);
  expect(root.bounds.width).toBeGreaterThan(120);
  expect(sector.value).toBe(.2);
  expect(sector.angle).toBeCloseTo(2 * Math.PI * .2 / .35, 14);
  expect(holding.angle).toBeCloseTo(2 * Math.PI * .12 / .35, 14);
  expect(slices.every(slice => slice.data?.includes('A') && !/NaN|Infinity/.test(slice.data) && slice.containsMidpoint)).toBe(true);
  await page.mouse.move(holding.screen.x, holding.screen.y);
  const tooltip = graph.locator('.hoverlayer');
  await expect(tooltip).toContainText('Original fund weight: 0.12 (12% of fund assets)');
  await expect(tooltip).toContainText('Share of delivered holdings: 34.29%');
  await page.mouse.click(sector.screen.x, sector.screen.y);
  await expect(graph.locator('.sunburstlayer path.surface')).toHaveCount(3);
  const drilled = await inspect(graph);
  const drilledHolding = drilled.find(slice => slice.label === 'AAPL.US')!;
  expect(drilledHolding.value).toBe(.12);
  expect(drilledHolding.angle).toBeCloseTo(2 * Math.PI * .12 / .2, 14);
  await page.mouse.move(drilledHolding.screen.x, drilledHolding.screen.y);
  await expect(tooltip).toContainText('Original fund weight: 0.12 (12% of fund assets)');
  await expect(tooltip).toContainText('Share of delivered holdings: 34.29%');
  const center = drilled.find(slice => slice.label === 'Technology')!;
  await page.mouse.click(center.screen.x, center.screen.y);
  await expect(graph.locator('.sunburstlayer path.surface')).toHaveCount(6);
  await test.info().attach('etf-svg-and-drill', { body: JSON.stringify({ slices, drilled }), contentType: 'application/json' });
});

test('installed Plotly keeps a distinct SVG wedge below one pixel with its exact weight', async ({ page }) => {
  const { result, graph } = await draw(page, [.349999, .000001], 'dark');
  expect(result).toMatchObject({ ok: true, etfHierarchy: {
    holdings: expect.arrayContaining([expect.objectContaining({ symbol: 'AAYA.F', value: .000001 })]),
  } });
  const slices = await inspect(graph);
  const tiny = slices.find(slice => slice.label === 'AAYA.F')!;
  expect(slices).toHaveLength(5);
  expect(tiny.value).toBe(.000001);
  expect(tiny.angle).toBeCloseTo(2 * Math.PI * .000001 / .35, 13);
  expect(tiny.bounds.height).toBeGreaterThan(0);
  expect(tiny.bounds.height).toBeLessThan(.01);
  expect(tiny.data).not.toMatch(/NaN|Infinity/);
  expect(tiny.containsMidpoint).toBe(true);
  await test.info().attach('etf-subpixel-svg', { body: JSON.stringify(slices), contentType: 'application/json' });
});

for (const depth of [1, 2] as const) {
  test(`installed Plotly draws the narrow two-sector allocation at depth ${depth}`, async ({ page }) => {
    const weights = [.34999995, .00000005];
    const { result, graph } = await draw(page, weights, 'light', depth);
    expect(result).toMatchObject({ ok: true, etfHierarchy: {
      holdings: expect.arrayContaining([expect.objectContaining({ symbol: 'AAYA.F', value: weights[1] })]),
    } });
    const paths = graph.locator('.sunburstlayer path.surface');
    const overview = await inspect(graph);
    expect(overview).toHaveLength(depth === 1 ? 3 : 5);
    expect(overview.every(slice => slice.bounds.height > 0 && slice.bounds.width > 0 && slice.containsMidpoint)).toBe(true);
    const narrowSector = overview.find(slice => slice.label === 'Sector unavailable')!;
    expect(narrowSector.value).toBe(weights[1]);
    expect(narrowSector.angle).toBeCloseTo(2 * Math.PI * weights[1] / .35, 14);
    expect(narrowSector.bounds.height).toBeLessThan(.001);
    const drills = [];
    if (depth === 2) {
      const waitForTransition = () => expect.poll(() => graph.evaluate(node => (node as Graph)._transitioning === true)).toBe(false);
      for (const [sectorLabel, holdingLabel, expected] of [
        ['Technology', 'AAPL.US', weights[0]], ['Sector unavailable', 'AAYA.F', weights[1]],
      ] as const) {
        // The subpixel path cannot be targeted by a pixel pointer. Dispatch the real Plotly click to its SVG element.
        await paths.nth(overview.findIndex(slice => slice.label === sectorLabel)).dispatchEvent('click');
        await expect(paths).toHaveCount(2);
        await waitForTransition();
        const rendered = await inspect(graph);
        const holding = rendered.find(slice => slice.label === holdingLabel)!;
        expect(holding.value).toBe(expected);
        expect(holding.angle).toBeCloseTo(2 * Math.PI, 14);
        expect(rendered.every(slice => slice.bounds.height > 0 && slice.bounds.width > 0 && slice.containsMidpoint)).toBe(true);
        drills.push(rendered);
        await paths.nth(rendered.findIndex(slice => slice.label === sectorLabel)).dispatchEvent('click');
        await expect(paths).toHaveCount(5);
        await waitForTransition();
      }
    }
    await test.info().attach('narrow-sector-geometry', { body: JSON.stringify({ overview, drills }), contentType: 'application/json' });
  });
}

for (const weights of [
  [.08726681249999999, 3.899296105751436e-9, .26273318360070386],
  [.15614308710594246, 5.236459842602384e-9, .19385690765759772],
]) {
  test(`the real worker refuses a missed SVG midpoint for ${weights[1]}`, async ({ page }) => {
    const { result, graph } = await draw(page, weights, 'light', 2, true);
    if (result.ok) {
      const slices = await inspect(graph, 'AAYA.F');
      await test.info().attach('unexpected-narrow-holding-paths', { body: JSON.stringify(slices), contentType: 'application/json' });
    }
    expect(result).toMatchObject({ ok: false, refused: true,
      message: expect.stringContaining(`Original fund weight ${weights[1]}. Select sector depth`) });
    await expect(graph).toHaveCount(0);

    const sector = await draw(page, weights, 'light', 1, true);
    expect(sector.result).toMatchObject({ ok: true, etfHierarchy: {
      holdings: expect.arrayContaining([expect.objectContaining({ symbol: 'AAYA.F', value: weights[1] })]),
    } });
    const paths = await inspect(sector.graph);
    expect(paths).toHaveLength(2);
    for (const slice of paths) {
      expect(slice.angle).toBeCloseTo(2 * Math.PI, 14);
      expect(slice.containsMidpoint).toBe(true);
    }
    await test.info().attach('verified-sector-repair', { body: JSON.stringify(paths), contentType: 'application/json' });
  });
}

test('installed Plotly retains the angular fill of a near-resolution holding before and after drill', async ({ page }) => {
  const weights = [.14747811893136722, 6.057835021435319e-9, .20252187501079774];
  const { result, graph } = await draw(page, weights, 'light', 2, true);
  expect(result).toMatchObject({ ok: true, etfHierarchy: {
    holdings: expect.arrayContaining([expect.objectContaining({ symbol: 'AAYA.F', value: weights[1] })]),
  } });
  const overview = await inspect(graph, 'AAYA.F');
  expect(overview).toHaveLength(5);
  const technology = overview.find(slice => slice.label === 'Technology')!;
  await page.mouse.click(technology.screen.x, technology.screen.y);
  await expect(graph.locator('.sunburstlayer path.surface')).toHaveCount(4);
  await expect.poll(() => graph.evaluate(node => (node as Graph)._transitioning === true)).toBe(false);
  const drill = await inspect(graph, 'AAYA.F');

  for (const slices of [overview, drill]) {
    const holding = slices.find(slice => slice.label === 'AAYA.F')!;
    expect(holding.value).toBe(weights[1]);
    expect(holding.angle).toBeCloseTo(2 * Math.PI * weights[1] / .35, 13);
    expect(holding.containsMidpoint).toBe(true);
    expect(holding.filledInteriorSamples).toBeGreaterThan(800);
  }
  await test.info().attach('retained-angular-fill', { body: JSON.stringify({ overview, drill }), contentType: 'application/json' });
});

test('real worker refuses a weight that would collapse before calling Plotly', async ({ page }) => {
  const { result, graph } = await draw(page, [.2, Number.MIN_VALUE], 'dark');
  expect(result).toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/geometry.*5e-324/i) });
  await expect(graph).toHaveCount(0);
});
