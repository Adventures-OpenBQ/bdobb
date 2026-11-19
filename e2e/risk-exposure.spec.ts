// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Locator, type Page } from '@playwright/test';
import { openRail, read } from './fixtures';
import { card, plot } from './fixtures/chart-recipes';
import { fixture, importRisk, riskNames } from './fixtures/risk-exposure';

type Axis = { range: [number, number] | [string, string]; domain: [number, number] };
type Trace = { x: (string | number)[]; y: (string | number | null)[]; name: string; width: number[] };
type Graph = HTMLElement & {
  _fullData: Trace[];
  _fullLayout: { paper_bgcolor: string; xaxis: Axis; xaxis2: Axis; xaxis3: Axis;
    yaxis: Axis; yaxis2: Axis; yaxis3: Axis; grid: { columns: number } };
};

const [distribution, panels, pareto, exposure] = riskNames;
const refresh = (page: Page, name: string) => card(page, name).getByRole('button', { name: 'Refresh', exact: true }).click();
const apply = (widget: Locator) => widget.getByRole('button', { name: 'Apply chart settings' }).click();

test.use({ viewport: { width: 1600, height: 1000 }, actionTimeout: 7000 });
test.beforeEach(() => test.setTimeout(90000));

async function ready(page: Page) {
  for (const name of riskNames) await expect(plot(page, name).locator('svg.main-svg').first()).toBeAttached();
}

async function hoverMark(page: Page, graph: Locator, mark: Locator) {
  await mark.scrollIntoViewIfNeeded();
  const box = (await mark.boundingBox())!;
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  return graph.locator('.hoverlayer');
}

test('renders four financial questions with original units, panel order and coverage in both themes', async ({ page }, info) => {
  const workers: string[] = [];
  page.on('worker', worker => workers.push(worker.url()));
  await importRisk(page);
  await ready(page);
  expect(workers.some(url => url.includes('recipe.worker'))).toBe(true);
  const histogram = plot(page, distribution);
  const bins = await histogram.evaluate(el => {
    const { x, y, width } = (el as Graph)._fullData[0];
    return { x, y, width };
  });
  expect(bins.y).toEqual([2, 0, 2, 0, 3]);
  bins.x.forEach((left, i) => {
    expect(left).toBeCloseTo(-.2 + .09 * i, 12);
    expect(bins.width[i]).toBeCloseTo(.09, 12);
  });
  await expect(card(page, distribution)).toContainText('N = 7 daily returns for ALDER');
  await expect(card(page, distribution)).toContainText('2 known price gap(s)');
  await expect(await hoverMark(page, histogram, histogram.locator('.barlayer .point path').last())).toContainText(/25%\].*3 observations/);

  const multiples = plot(page, panels);
  const series = await multiples.evaluate(el => (el as Graph)._fullData.map(t => ({ name: t.name, x: t.x, y: t.y })));
  expect(series.map(t => t.name)).toEqual(['CEDAR', 'ALDER', 'BIRCH']);
  for (const trace of series) {
    expect([trace.x[0], trace.y[0], trace.x.at(-1)]).toEqual(['2026-03-03', 100, '2026-03-16']);
  }
  expect(series[1].y.filter(y => y === null)).toHaveLength(2);
  const ranges = await multiples.evaluate(el => {
    const l = (el as Graph)._fullLayout;
    return [l.yaxis.range, l.yaxis2.range, l.yaxis3.range];
  });
  expect(ranges).toEqual([ranges[0], ranges[0], ranges[0]]);
  await expect(card(page, panels)).toContainText('Shared baseline 100 on 2026-03-03');
  const holdings = plot(page, pareto);
  const [bars, line] = await holdings.evaluate(el => (el as Graph)._fullData.map(t => t.y));
  expect(bars).toHaveLength(50);
  expect(bars[0]).toBeCloseTo(.024);
  expect(line.at(-1)).toBeCloseTo(.71);
  await expect(card(page, pareto)).toContainText('Shown holdings: 50 of 60 delivered (71% of fund assets)');
  await expect(card(page, pareto)).toContainText('Delivered weight: 73.2%');
  await expect(card(page, pareto)).toContainText('Transport coverage is complete. Provider holdings coverage is partial.');
  await expect(card(page, pareto)).toContainText('Snapshot as of 2026-03-17');
  const sector = plot(page, exposure);
  expect(await sector.evaluate(el => (el as Graph)._fullData[1].x)).toEqual([.4, .32, .21, .07, 0]);
  const dots = sector.locator('.scatterlayer .trace').last().locator('.points .point');
  await expect(dots).toHaveCount(5);
  await expect(await hoverMark(page, sector, dots.last())).toContainText(/Utilities.*Reported weight 0%.*equity exposure/);
  await page.mouse.move(950, 35);
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const [i, name] of riskNames.entries()) {
      await expect.poll(() => plot(page, name).evaluate(el => (el as Graph)._fullLayout.paper_bgcolor))
        .toBe(theme === 'light' ? '#ffffff' : '#1e242e');
      await card(page, name).screenshot({ path: info.outputPath(theme + '-' + (i + 1) + '.png') });
    }
  }
});

test('keeps zoom on matched panels across a grid resize', async ({ page }) => {
  await importRisk(page);
  await ready(page);
  const graph = plot(page, panels);
  const layout = () => graph.evaluate(el => {
    const { grid, xaxis, xaxis2, xaxis3, yaxis, yaxis2, yaxis3 } = (el as Graph)._fullLayout;
    return { columns: grid.columns, x: [xaxis.range, xaxis2.range, xaxis3.range],
      y: [yaxis.range, yaxis2.range, yaxis3.range], order: (el as Graph)._fullData.map(t => t.name) };
  });
  await expect.poll(async () => (await layout()).columns).toBe(3);
  const before = await layout();
  const drag = graph.locator('.nsewdrag').first();
  await drag.scrollIntoViewIfNeeded();
  const box = (await drag.boundingBox())!;
  await page.mouse.move(box.x + box.width * .18, box.y + box.height * .15);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .8, box.y + box.height * .85, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await layout()).x[0]).not.toEqual(before.x[0]);
  const zoom = await layout();
  expect(zoom.x.every(range => JSON.stringify(range) === JSON.stringify(zoom.x[0]))).toBe(true);
  expect(zoom.y.every(range => JSON.stringify(range) === JSON.stringify(zoom.y[0]))).toBe(true);
  const handle = page.locator('.react-grid-item').filter({ has: graph }).locator('.react-resizable-handle-se');
  await handle.scrollIntoViewIfNeeded();
  const corner = (await handle.boundingBox())!;
  await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
  await page.mouse.down();
  await page.mouse.move(corner.x - 695, corner.y, { steps: 12 });
  await page.mouse.up();
  await expect.poll(layout).toEqual({ ...zoom, columns: 2 });
});

test('draws the entire extreme count-one bin and hovers its original return', async ({ page }, info) => {
  const { overrides } = await importRisk(page);
  await ready(page);
  const source = JSON.parse(fixture('prices'));
  source.rows = [1, Number.MAX_VALUE, Number.MAX_VALUE].map((adjusted_close, i) => ({
    date: '2026-03-0' + (i + 2), symbol: 'ALDER', currency: 'USD', adjusted_close,
  }));
  overrides.set('prices.json', JSON.stringify(source));
  await refresh(page, 'Daily adjusted prices');
  const graph = plot(page, distribution);
  await expect.poll(() => graph.evaluate(el => (el as Graph)._fullData[0].y)).toEqual([1, 0, 0, 0, 1]);
  const { left, right, axis } = await graph.evaluate(el => {
    const graph = el as Graph;
    const trace = graph._fullData[0];
    const left = Number(trace.x[4]);
    return { left, right: left + trace.width[4], axis: graph._fullLayout.xaxis.range.map(Number) };
  });
  expect(right * 2 ** 512).toBe(Number.MAX_VALUE);
  expect(left).toBeGreaterThanOrEqual(axis[0]);
  expect(right).toBeLessThanOrEqual(axis[1]);
  const last = graph.locator('.barlayer .point path').last();
  await last.scrollIntoViewIfNeeded();
  const bar = (await last.boundingBox())!;
  const area = (await graph.locator('.nsewdrag').boundingBox())!;
  expect(bar.x).toBeGreaterThanOrEqual(area.x - 1);
  expect(bar.x + bar.width).toBeLessThanOrEqual(area.x + area.width + 1);
  await expect(await hoverMark(page, graph, last)).toContainText(/1\.7976931348623157E310%\].*1 observations/);
  await graph.screenshot({ path: info.outputPath('extreme-bin.png') });
});

async function linkRegions(page: Page) {
  const widget = card(page, exposure);
  await widget.getByLabel('Exposure mode').selectOption('region');
  await apply(widget);
  await expect(widget).toContainText('Choose an ETF source with the requested exposure kind.');
  await expect(plot(page, exposure)).toHaveCount(0);
  await widget.getByRole('button', { name: 'Card menu' }).click();
  await page.getByRole('menuitem', { name: 'Choose source' }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose source' });
  await dialog.getByLabel('Source table').selectOption({ label: 'Region weights — Risk and exposure' });
  await dialog.getByRole('button', { name: 'Choose source' }).click();
  await widget.getByLabel('Exposure category').selectOption('country');
  await apply(widget);
  await expect(plot(page, exposure)).toContainText('geographic exposure');
}

test('repairs the exposure source, filters holdings and reacquires a saved workspace on another page', async ({ page, context }) => {
  const { overrides } = await importRisk(page);
  await ready(page);
  const histogram = card(page, distribution);
  await histogram.getByLabel('Bins').fill('7');
  await apply(histogram);
  await expect.poll(() => plot(page, distribution).evaluate(el => (el as Graph)._fullData[0].y)).toHaveLength(7);
  await linkRegions(page);
  const source = card(page, 'Fund holdings');
  await source.getByRole('button', { name: 'Filter rows' }).click();
  await source.getByLabel('Filter symbol', { exact: true }).fill('H01');
  await expect(card(page, pareto)).toContainText('Filtered source delivered 10 of 60 acquired rows.');
  await source.getByLabel('Filter symbol', { exact: true }).fill('');
  await expect(card(page, pareto)).toContainText('50 of 60 delivered');
  const prices = JSON.parse(fixture('prices'));
  overrides.set('prices.json', JSON.stringify({ ...prices, completeness: 'paged' }));
  await refresh(page, 'Daily adjusted prices');
  await expect(histogram).toContainText(/paged/);
  await expect(plot(page, distribution)).toHaveCount(0);
  overrides.delete('prices.json');
  await refresh(page, 'Daily adjusted prices');
  await expect(histogram).toContainText('N = 7 daily returns');
  await openRail(page);
  await page.locator('nav.left-rail').getByRole('button', { name: 'Risk and ETF examples', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Save…' }).click();
  await page.getByRole('menuitem', { name: 'BDOBB Workspace', exact: true }).click();
  const path = 'exports/Risk and ETF examples.apps.json';
  await expect.poll(() => read(page, path)).toBeDefined();
  const saved = (await read(page, path))!;
  expect(saved).not.toMatch(/etfEvidence|priceDimensionsChecked|acquiredRowCount|viewportWidth|weight_basis/);
  const reopened = await context.newPage();
  const regions = JSON.parse(fixture('regions'));
  regions.rows[0].weight = .18;
  const changed = new Map([['regions.json', JSON.stringify(regions)]]);
  const { acquisitions } = await importRisk(reopened, saved, changed);
  await ready(reopened);
  expect(new Set(acquisitions)).toEqual(new Set(['prices', 'holdings', 'sectors', 'regions']));
  await expect(card(reopened, distribution).getByLabel('Bins')).toHaveValue('7');
  await expect(card(reopened, exposure).getByLabel('Exposure mode')).toHaveValue('region');
  await expect(card(reopened, exposure).getByLabel('Exposure category')).toHaveValue('country');
  expect(await plot(reopened, exposure).evaluate(el => (el as Graph)._fullData[1].x[0])).toBe(.18);
  await card(reopened, 'Region weights').getByRole('button', { name: 'Remove card', exact: true }).click();
  await expect(card(reopened, exposure)).toContainText(/source.*unavailable/i);
  await expect(plot(reopened, exposure)).toHaveCount(0);
  await expect(plot(reopened, pareto)).toHaveCount(1);
});

test('scrolls every region and reaches its zero-weight marker on a narrow touch card', async ({ browser }, info) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:' + (process.env.BDOBB_BROWSER_PORT ?? 4173),
    hasTouch: true, isMobile: true, viewport: { width: 880, height: 980 } });
  try {
    const page = await context.newPage();
    await importRisk(page);
    await ready(page);
    await linkRegions(page);
    const widget = card(page, exposure);
    const graph = plot(page, exposure);
    const expected = JSON.parse(fixture('regions')).rows as { country: string; weight: number }[];
    expect(await graph.evaluate(el => (el as Graph)._fullData[1].y)).toEqual(expected.map(r => r.country));
    expect(await graph.evaluate(el => (el as Graph)._fullData[1].x)).toEqual(expected.map(r => r.weight));
    const viewport = widget.locator('.chart-scroll-viewport');
    const bounds = await viewport.evaluate(el => [el.clientHeight, el.scrollHeight]);
    expect(bounds[1]).toBeGreaterThan(bounds[0]);
    await viewport.scrollIntoViewIfNeeded();
    const top = (await viewport.boundingBox())!;
    const touch = await context.newCDPSession(page);
    const x = top.x + top.width * .8;
    for (let i = 0; i < 8 && await viewport.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop > 2); i++) {
      const start = top.y + top.height * .85;
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: start }] });
      for (let j = 1; j <= 8; j++) {
        await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: start - top.height * .68 * j / 8 }] });
      }
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    await expect.poll(() => viewport.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(2);
    const points = graph.locator('.scatterlayer .trace').last().locator('.points .point');
    await expect(points).toHaveCount(expected.length);
    await expect(points.last()).toBeInViewport();
    const marker = (await points.last().boundingBox())!;
    // The zero marker straddles the axis. Tap the half inside the plot.
    await page.touchscreen.tap(marker.x + marker.width * .75, marker.y + marker.height / 2);
    await expect(graph.locator('.hoverlayer')).toContainText(expected.at(-1)!.country + 'Reported weight 0%');
    await widget.screenshot({ path: info.outputPath('narrow-region.png') });
  } finally {
    await context.close();
  }
});
