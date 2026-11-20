// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Locator, type Page } from '@playwright/test';
import { acquiredOwnershipPartition, acquiredOwnershipRows } from '../src/test/fixtures/ownershipEvidence';
import type { OwnershipSnapshotOptions } from '../src/lib/widgetData/chartRecipes/types';

type Axis = { range: number[]; _offset: number; _length: number; c2p: (value: number) => number };
type Graph = HTMLElement & { _fullLayout: { xaxis: Axis; yaxis: Axis } };

const bars = { view: 'bars', fields: { insiders: 'insider_pct', institutions: 'institution_ratio', freeFloat: 'free_float' } } as const;
const barsSource = {
  version: 1, kind: 'ownership', origin: 'acquired-snapshot', issuer: 'EXAMPLE.US', share_class: null,
  retrieved_at: acquiredOwnershipPartition.retrieved_at, raw_count: 1, normalized_count: 1, delivered_count: 1,
  diagnostics: [], unsafe: acquiredOwnershipPartition.unsafe,
  measures: {
    insiders: { unit: 'percent-points', basis: null, as_of: null },
    institutions: { unit: 'fraction', basis: 'shares-outstanding', as_of: '2026-09-30' },
    freeFloat: { unit: 'percent-points', basis: 'shares-outstanding', as_of: null },
  },
  field_origins: bars.fields, partition: { status: 'unavailable' },
};
const waffle = { view: 'waffle', fields: { bucket: 'bucket_id', share: 'reported_share' } } as const;

async function draw(page: Page, config: {
  source: unknown; rows: unknown[]; choice: typeof bars | typeof waffle; width: number; height: number; theme: 'light' | 'dark';
}) {
  await page.goto('/');
  const result = await page.evaluate(async ({ source, rows, choice, width, height, theme }) => {
    const tablePath = '/src/lib/localTableData.ts';
    const workerPath = '/src/lib/widgetData/chartRecipes/workerClient.ts';
    const plotlyPath = '/src/lib/plotly.ts';
    const { datasetFromBytes } = await import(tablePath) as typeof import('../src/lib/localTableData');
    const { createRecipeWorker } = await import(workerPath) as typeof import('../src/lib/widgetData/chartRecipes/workerClient');
    const { renderPlot } = await import(plotlyPath) as typeof import('../src/lib/plotly');
    const snapshot = { rows, completeness: 'complete', chart_sources: { version: 1, receipts: [source] } };
    const input = await datasetFromBytes('ownership.json', new TextEncoder().encode(JSON.stringify(snapshot)), 'ownership-source', 1);
    const options: OwnershipSnapshotOptions = { version: 1, kind: 'ownership-snapshot', issuer: 'EXAMPLE.US', ...choice };
    const worker = createRecipeWorker();
    try {
      const result = await worker.run(input, options, {
        theme, maxDecimals: 2, today: '2026-11-20', viewportWidth: width, viewportHeight: height,
      }, new AbortController().signal);
      if (!result.ok) return result;
      const node = document.createElement('div');
      node.id = 'ownership-geometry';
      node.style.cssText = `position: fixed; top: 12px; left: 12px; width: ${width}px; height: ${height}px; z-index: 10000`;
      document.body.append(node);
      await renderPlot(node, result.figure, result.revision);
      return { ok: true, notes: result.notes } as const;
    } finally { worker.dispose(); }
  }, config);
  return { result, graph: page.locator('#ownership-geometry') };
}

async function hover(page: Page, graph: Locator, x: number, y: number) {
  const point = await graph.evaluate((node, [x, y]) => {
    const { xaxis, yaxis } = (node as Graph)._fullLayout;
    const bounds = node.getBoundingClientRect();
    return { x: bounds.x + xaxis._offset + xaxis.c2p(x), y: bounds.y + yaxis._offset + yaxis.c2p(y) };
  }, [x, y]);
  await page.mouse.move(point.x, point.y);
  return graph.locator('.hoverlayer');
}

function barRows(insiders: number, institutions: number | null, freeFloat: number | null) {
  return [{ symbol: 'EXAMPLE.US', share_class: null, insider_pct: insiders, institution_ratio: institutions, free_float: freeFloat }];
}

test('installed Plotly draws independent bar lengths and distinct zero and unavailable hovers', async ({ page }) => {
  const { result, graph } = await draw(page, { source: barsSource, rows: barRows(33.3, 0, null), choice: bars,
    width: 620, height: 320, theme: 'light' });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  const geometry = await graph.evaluate(node => {
    const { xaxis } = (node as Graph)._fullLayout;
    const paths = [...node.querySelectorAll<SVGPathElement>('.barlayer path')];
    return {
      range: xaxis.range, length: xaxis._length, endpoint: xaxis.c2p(.333),
      bars: paths.map(path => ({ width: path.getBBox().width, height: path.getBBox().height, d: path.getAttribute('d') })),
      statuses: [...node.querySelectorAll('.scatterlayer path.point')].map(path => path.getAttribute('d')),
    };
  });
  expect(geometry.range).toEqual([0, 1]);
  expect(geometry.bars).toHaveLength(1);
  expect(geometry.bars[0].width).toBeCloseTo(geometry.endpoint, 1);
  expect(geometry.bars[0].height).toBeGreaterThan(30);
  expect(geometry.bars[0].d).not.toMatch(/NaN|Infinity/);
  expect(new Set(geometry.statuses).size).toBe(2);
  const bar = await hover(page, graph, .16, 0);
  await expect(bar).toContainText('33.3%');
  await expect(bar).toContainText('33.3 percent-points');
  await expect(bar).toContainText('As of unknown');
  const zero = await hover(page, graph, .02, 1);
  await expect(zero).toContainText('0%');
  await expect(zero).toContainText('2026-09-30');
  const unavailable = await hover(page, graph, .02, 2);
  await expect(unavailable).toContainText('Unavailable');
  await expect(unavailable).toContainText('Retrieved 2026-11-20');
  await test.info().attach('ordinary-bars-svg', { body: JSON.stringify(geometry), contentType: 'application/json' });
});

test('installed Plotly paints the rounded cell counts with the original percentages in hover', async ({ page }) => {
  const keys = ['a', 'b', 'c'];
  const source = { ...acquiredOwnershipPartition, raw_count: 3, normalized_count: 3, delivered_count: 3, bucket_keys: keys };
  const rows = [33.3, 33.3, 33.4].map((reported_share, i) => ({ ...acquiredOwnershipRows[0], bucket_id: keys[i], reported_share }));
  const { result, graph } = await draw(page, { source, rows, choice: waffle, width: 480, height: 320, theme: 'light' });
  expect(result).toMatchObject({ ok: true, notes: expect.arrayContaining([expect.stringMatching(/Total discrepancy 0 percentage points/)]) });
  const counts = await graph.locator('.scatterlayer path.point').evaluateAll(points => {
    const counts = new Map<string, number>();
    for (const point of points) {
      const fill = getComputedStyle(point).fill;
      counts.set(fill, (counts.get(fill) ?? 0) + 1);
    }
    return Array.from(counts.entries());
  });
  expect(counts.map(([, count]) => count)).toEqual([33, 33, 34]);
  const first = await hover(page, graph, 0, 0);
  await expect(first).toContainText('33.3% reported');
  await expect(first).toContainText('33 of 100 cells');
  const last = await hover(page, graph, 9, 9);
  await expect(last).toContainText('33.4% reported');
  await expect(last).toContainText('34 of 100 cells');
  await test.info().attach('ordinary-waffle-color-counts', { body: JSON.stringify(counts), contentType: 'application/json' });
});

test('installed Plotly keeps the complete 10 by 10 waffle even when only one bucket gets cells', async ({ page }) => {
  const tiny = Number.MIN_VALUE;
  const rows = [{ ...acquiredOwnershipRows[0], reported_share: 100 }, { ...acquiredOwnershipRows[1], reported_share: tiny }];
  const { result, graph } = await draw(page, { source: acquiredOwnershipPartition, rows, choice: waffle,
    width: 296, height: 280, theme: 'dark' });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  const geometry = await graph.evaluate(node => {
    const { xaxis, yaxis } = (node as Graph)._fullLayout;
    const points = [...node.querySelectorAll<SVGPathElement>('.scatterlayer path.point')];
    return {
      ranges: [xaxis.range, yaxis.range], lengths: [xaxis._length, yaxis._length],
      coordinates: points.map(path => path.getAttribute('transform')),
      squares: points.map(path => ({ d: path.getAttribute('d'), width: path.getBBox().width, height: path.getBBox().height })),
    };
  });
  expect(geometry.ranges).toEqual([[-.5, 9.5], [9.5, -.5]]);
  expect(Math.abs(geometry.lengths[0] - geometry.lengths[1])).toBeLessThanOrEqual(1);
  expect(new Set(geometry.coordinates).size).toBe(100);
  for (const square of geometry.squares) {
    expect(square.width).toBeGreaterThan(10);
    expect(square.width).toBeCloseTo(square.height);
    expect(square.d).not.toMatch(/NaN|Infinity/);
  }
  const tooltip = await hover(page, graph, 0, 0);
  await expect(tooltip).toContainText('control');
  await expect(tooltip).toContainText('100%');
  await expect(tooltip).toContainText('100 of 100 cells');
  await expect(tooltip).toContainText('2026-09-30');
  await test.info().attach('extreme-waffle-svg', { body: JSON.stringify(geometry), contentType: 'application/json' });
});

test('installed Plotly renders a full and a near-zero bar without rounding it up to a full pixel', async ({ page }) => {
  const { result, graph } = await draw(page, { source: barsSource, rows: barRows(100, .005, null), choice: bars,
    width: 360, height: 270, theme: 'dark' });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  const actual = await graph.evaluate(node => {
    const { xaxis } = (node as Graph)._fullLayout;
    return {
      range: xaxis.range, length: xaxis._length, smallEndpoint: xaxis.c2p(.005),
      bars: [...node.querySelectorAll<SVGPathElement>('.barlayer path')].map(path => ({
        width: path.getBBox().width, d: path.getAttribute('d'),
      })),
    };
  });
  expect(actual.range).toEqual([0, 1]);
  expect(actual.bars[0].width).toBeCloseTo(actual.length, 1);
  expect(actual.bars[1].width).toBeGreaterThan(1);
  expect(actual.bars[1].width).toBeCloseTo(actual.smallEndpoint, 1);
  expect(actual.bars.every(bar => !/NaN|Infinity/.test(bar.d ?? ''))).toBe(true);
  await expect(await hover(page, graph, .004, 1)).toContainText('0.005 fraction');
  await test.info().attach('extreme-bars-svg', { body: JSON.stringify(actual), contentType: 'application/json' });
});

test('the real worker refuses when a required positive bar would collapse', async ({ page }) => {
  const { result, graph } = await draw(page, { source: barsSource, rows: barRows(Number.MIN_VALUE, .5, 20), choice: bars,
    width: 360, height: 270, theme: 'light' });
  expect(result).toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/geometry.*widen/i) });
  await expect(graph).toHaveCount(0);
});
