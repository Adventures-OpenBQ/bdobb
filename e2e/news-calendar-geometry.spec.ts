// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Locator, type Page } from '@playwright/test';
import { calendarArticle as article, calendarContext, calendarOptions, calendarSnapshot } from '../src/test/fixtures/newsCalendar';

type Axis = { _offset: number; range: number[]; c2p: (coordinate: number) => number };
type Graph = HTMLElement & { _fullLayout: { xaxis: Axis; yaxis: Axis } };
type Position = { week: number; weekday: number };

async function plot(
  page: Page,
  snapshot: ReturnType<typeof calendarSnapshot>,
  theme: 'light' | 'dark',
  viewportWidth: number,
) {
  await page.goto('/');
  await page.evaluate(async ({ snapshot, options, context, viewportWidth }) => {
    const tablePath = '/src/lib/localTableData.ts';
    const workerPath = '/src/lib/widgetData/chartRecipes/workerClient.ts';
    const plotlyPath = '/src/lib/plotly.ts';
    const { datasetFromBytes } = await import(tablePath) as typeof import('../src/lib/localTableData');
    const { createRecipeWorker } = await import(workerPath) as typeof import('../src/lib/widgetData/chartRecipes/workerClient');
    const { renderPlot } = await import(plotlyPath) as typeof import('../src/lib/plotly');
    const dataset = await datasetFromBytes('news.json', new TextEncoder().encode(JSON.stringify(snapshot)), 'calendar', 1);
    const worker = createRecipeWorker();
    try {
      const result = await worker.run(dataset, options, context, new AbortController().signal);
      if (!result.ok) throw new Error(result.message);
      const node = document.createElement('div');
      node.id = 'calendar-geometry';
      node.style.cssText = `position: fixed; top: 12px; left: 12px; width: ${viewportWidth}px; height: 340px; z-index: 10000`;
      document.body.append(node);
      await renderPlot(node, result.figure, result.revision);
    } finally {
      worker.dispose();
    }
  }, { snapshot, options: calendarOptions, context: { ...calendarContext, theme, viewportWidth }, viewportWidth });
  return page.locator('#calendar-geometry');
}

async function cellRaster(graph: Locator, positions: Position[]) {
  return graph.evaluate(async (node, cells) => {
    const { xaxis, yaxis } = (node as Graph)._fullLayout;
    const images = await Promise.all([...node.querySelectorAll<SVGImageElement>('.heatmaplayer .hm image')].map(async svg => {
      const decoded = new Image();
      decoded.src = svg.href.baseVal;
      await decoded.decode();
      const canvas = document.createElement('canvas');
      canvas.width = decoded.width;
      canvas.height = decoded.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(decoded, 0, 0);
      return { svg, canvas, context };
    }));
    return {
      ranges: [xaxis.range, yaxis.range],
      weekWidth: Math.abs(xaxis.c2p(.5) - xaxis.c2p(-.5)),
      images: images.map(({ svg }) => [svg.width.baseVal.value, svg.height.baseVal.value]),
      pixels: cells.map(({ week, weekday }) => images.map(({ svg, canvas, context }) => {
        // Plotly aligns the filled rectangle to rounded cell edges. In a narrow view the
        // mathematical center can fall in the one-pixel gutter to the right of the fill.
        const x = Math.round((xaxis.c2p(week - .5) - svg.x.baseVal.value) * canvas.width / svg.width.baseVal.value);
        const y = Math.floor((yaxis.c2p(weekday) - svg.y.baseVal.value) * canvas.height / svg.height.baseVal.value);
        return Array.from(context.getImageData(x, y, 1, 1).data);
      }).filter(pixel => pixel[3] > 0)),
    };
  }, positions);
}

async function hover(page: Page, graph: Locator, position: Position) {
  const point = await graph.evaluate((node, { week, weekday }) => {
    const { xaxis, yaxis } = (node as Graph)._fullLayout;
    const bounds = node.getBoundingClientRect();
    return { x: bounds.x + xaxis._offset + xaxis.c2p(week), y: bounds.y + yaxis._offset + yaxis.c2p(weekday) };
  }, position);
  await page.mouse.move(point.x, point.y);
  return graph.locator('.hoverlayer');
}

test('Plotly renders separate neutral, missing and unscored calendar cells with original-value hover', async ({ page }) => {
  const graph = await plot(page, calendarSnapshot([
    [article('neutral', '2026-11-15T03:00:00Z', 0), '2026-11-15'],
    [article('unscored', '2026-11-17T03:00:00Z', null), '2026-11-17'],
    [article('scored', '2026-11-19T00:30:00+01:00', .123456789), '2026-11-18'],
    [article('one-tenth', '2026-11-19T00:00:00Z', .1), '2026-11-19'],
    [article('two-tenths', '2026-11-19T01:00:00Z', .2), '2026-11-19'],
    [article('three-tenths', '2026-11-19T02:00:00Z', .3), '2026-11-19'],
  ]), 'light', 740);
  const positions = [
    { week: 0, weekday: 6 }, { week: 1, weekday: 0 }, { week: 1, weekday: 1 }, { week: 0, weekday: 0 },
  ];
  const raster = await cellRaster(graph, positions);
  expect(raster.ranges).toEqual([[-.5, 1.5], [6.5, -.5]]);
  expect(raster.images).toHaveLength(3);
  expect(raster.pixels.map(cell => cell.length)).toEqual([1, 1, 1, 0]);
  expect(new Set(raster.pixels.slice(0, 3).map(cell => cell[0].join(','))).size).toBe(3);
  const original = await hover(page, graph, { week: 1, weekday: 2 });
  await expect(original).toContainText('2026-11-18');
  await expect(original).toContainText('2026-11-19T00:30:00+01:00');
  await expect(original).toContainText('0.123456789');
  await expect(await hover(page, graph, { week: 1, weekday: 3 })).toContainText(/Mean polarity: 0\.2\s*Delivered:/);
  await expect(await hover(page, graph, positions[1])).toContainText('No delivered articles');
  await expect(await hover(page, graph, positions[2])).toContainText('No scored articles');
});

test('Plotly paints the first and last weeks of a full extreme-date calendar at narrow width', async ({ page }) => {
  const graph = await plot(page, calendarSnapshot([
    [article('out-of-window', '0001-01-01T10:00:00Z', .5), '0001-01-01'],
    [article('low', '9998-12-31T23:00:00Z', -1), '9998-12-31'],
    [article('high', '9999-12-31T00:00:00Z', 1), '9999-12-31'],
  ]), 'dark', 260);
  const first = { week: 0, weekday: 3 };
  const last = { week: 52, weekday: 4 };
  const gap = { week: 26, weekday: 0 };
  const raster = await cellRaster(graph, [first, last, gap]);
  expect(raster.ranges).toEqual([[-.5, 52.5], [6.5, -.5]]);
  expect(raster.weekWidth).toBeGreaterThan(2);
  expect(raster.pixels.map(cell => cell.length)).toEqual([1, 1, 1]);
  expect(raster.pixels.map(cell => cell[0])).toEqual([[162, 57, 85, 255], [22, 120, 98, 255], [52, 64, 85, 255]]);
  const monthLabelsFit = await graph.evaluate(node => {
    const bounds = node.getBoundingClientRect();
    const ticks = [...node.querySelectorAll('.xtick text')].map(label => label.getBoundingClientRect());
    return ticks.length > 1 && ticks.every((tick, i) => tick.bottom <= bounds.bottom
      && tick.left >= bounds.left && tick.right <= bounds.right && (!ticks[i + 1] || tick.right < ticks[i + 1].left));
  });
  expect(monthLabelsFit, 'the month labels fit inside the narrow plot without overlap').toBe(true);
  const earliest = await hover(page, graph, first);
  await expect(earliest).toContainText('9998-12-31');
  await expect(earliest).toContainText('Mean polarity: -1');
  const latest = await hover(page, graph, last);
  await expect(latest).toContainText('9999-12-31');
  await expect(latest).toContainText('Mean polarity: 1');
});
