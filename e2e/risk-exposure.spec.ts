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
  _fullLayout: { dragmode: string | false; paper_bgcolor: string; xaxis: Axis; xaxis2: Axis; xaxis3: Axis;
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
  const panelPoint = multiples.locator('.scatterlayer .trace').first().locator('.points .point').nth(2);
  await expect(await hoverMark(page, multiples, panelPoint)).toContainText(/Index .*Baseline 100 on 2026-03-03/);
  await expect(await hoverMark(page, histogram, histogram.locator('.barlayer .point path').last())).toContainText(/25%\].*Count 3/);
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
  await expect(await hoverMark(page, graph, last)).toContainText(/1\.7976931348623157E310%\].*Count 1/);
  await graph.screenshot({ path: info.outputPath('extreme-bin.png') });
});

async function linkRegions(page: Page) {
  const widget = card(page, exposure);
  await widget.getByLabel('Exposure mode').selectOption('region');
  await expect(widget.getByRole('button', { name: 'Apply chart settings' })).toBeDisabled();
  await expect(widget).toContainText('Choose a presented exposure category field.');
  await expect(plot(page, exposure)).toContainText('sector exposure');
  await widget.getByRole('button', { name: 'Card menu' }).click();
  await page.getByRole('menuitem', { name: 'Choose source' }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose source' });
  await dialog.getByLabel('Source table').selectOption({ label: 'Region weights — Risk and exposure' });
  await dialog.getByRole('button', { name: 'Choose source' }).click();
  await expect(plot(page, exposure)).toHaveCount(0);
  await widget.getByLabel('Exposure mode').selectOption('region');
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
  const reopenedCounts = await plot(reopened, distribution).evaluate(el => (el as Graph)._fullData[0].y.map(Number));
  expect(reopenedCounts).toHaveLength(7);
  expect(reopenedCounts.reduce((sum, count) => sum + count, 0)).toBe(7);
  await expect(card(reopened, exposure).getByLabel('Exposure mode')).toHaveValue('region');
  await expect(card(reopened, exposure).getByLabel('Exposure category')).toHaveValue('country');
  expect(await plot(reopened, exposure).evaluate(el => (el as Graph)._fullData[1].x[0])).toBe(.18);
  await card(reopened, 'Region weights').getByRole('button', { name: 'Remove card', exact: true }).click();
  await expect(card(reopened, exposure)).toContainText(/source.*unavailable/i);
  await expect(plot(reopened, exposure)).toHaveCount(0);
  await expect(plot(reopened, pareto)).toHaveCount(1);
});

// Read the screen coordinate after native scroll momentum and responsive grid motion settle.
async function tapVisibleMarker(page: Page, marker: Locator, xFraction = .5) {
  await expect(marker).toBeInViewport();
  await marker.scrollIntoViewIfNeeded(); // Playwright waits for a stable element.
  const box = (await marker.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width * xFraction, box.y + box.height / 2);
}

async function swipeToBottom(page: Page, viewport: Locator, graph: Locator) {
  await viewport.scrollIntoViewIfNeeded();
  const touch = await page.context().newCDPSession(page);
  const top = (await viewport.boundingBox())!;
  for (let i = 0; i < 12 && await viewport.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop > 2); i++) {
    const surfaces = await graph.locator('.nsewdrag').evaluateAll(elements => elements.map(el => {
      const { left, top, right, bottom } = el.getBoundingClientRect();
      return { left, top, right, bottom };
    }));
    const visible = surfaces.map(rect => ({ x: (rect.left + rect.right) / 2, start: Math.min(rect.bottom, top.y + top.height) - 4,
      end: Math.max(rect.top, top.y) + 4 })).sort((a, b) => (b.start - b.end) - (a.start - a.end))[0];
    expect(visible.start - visible.end).toBeGreaterThan(15);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: visible.x, y: visible.start }] });
    for (let j = 1; j <= 8; j++) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: visible.x, y: visible.start - (visible.start - visible.end) * j / 8 }] });
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  await expect.poll(() => viewport.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(2);
  await touch.detach();
}

test('scrolls to the final watchlist panel and zero-weight region and inspects both on touch cards', async ({ browser }, info) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:' + (process.env.BDOBB_BROWSER_PORT ?? 4173),
    hasTouch: true, isMobile: true, viewport: { width: 880, height: 980 } });
  try {
    const page = await context.newPage();
    await importRisk(page);
    await ready(page);
    await page.setViewportSize({ width: 600, height: 980 });
    const panelsPlot = plot(page, panels);
    const panelViewport = card(page, panels).locator('.chart-scroll-viewport');
    await expect.poll(() => panelsPlot.evaluate(el => (el as Graph)._fullLayout.grid.columns)).toBe(1);
    expect(await panelViewport.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(100);
    await swipeToBottom(page, panelViewport, panelsPlot);
    const point = panelsPlot.locator('.scatterlayer').last().locator('.points .point').nth(2);
    await tapVisibleMarker(page, point);
    await expect(panelsPlot.locator('.hoverlayer')).toContainText(/BIRCH.*Baseline 100 on 2026-03-03/);
    await card(page, panels).screenshot({ path: info.outputPath('narrow-panels.png') });
    // Reflow the same watchlist across the overflow boundary before changing any chart settings.
    await page.setViewportSize({ width: 1600, height: 1080 });
    const remaining = () => panelViewport.evaluate(el => el.scrollHeight - el.clientHeight);
    await expect.poll(remaining).toBe(0);
    await expect.poll(() => panelsPlot.evaluate(el => (el as Graph)._fullLayout.dragmode)).toBe('zoom');
    await page.setViewportSize({ width: 600, height: 980 });
    await expect.poll(remaining).toBeGreaterThan(100);
    await expect.poll(() => panelsPlot.evaluate(el => (el as Graph)._fullLayout.dragmode)).toBe(false);

    await page.setViewportSize({ width: 1100, height: 1080 });
    const watchlist = card(page, panels);
    for (const symbol of ['ALDER', 'BIRCH']) await watchlist.getByLabel(symbol, { exact: true }).uncheck();
    await apply(watchlist);
    await expect.poll(() => panelsPlot.evaluate(el => (el as Graph)._fullData.map(t => t.name))).toEqual(['CEDAR']);
    await expect.poll(remaining).toBe(0);
    const displayedDates = () => panelsPlot.evaluate(el => (el as Graph)._fullLayout.xaxis.range);
    const before = await displayedDates();
    const surface = panelsPlot.locator('.nsewdrag');
    await surface.scrollIntoViewIfNeeded();
    const rect = (await surface.boundingBox())!;
    const touch = await context.newCDPSession(page);
    for (let step = 0; step <= 8; step++) {
      const x = rect.x + rect.width * (.2 + .55 * step / 8);
      const y = rect.y + rect.height * (.2 + .55 * step / 8);
      await touch.send('Input.dispatchTouchEvent', { type: step ? 'touchMove' : 'touchStart', touchPoints: [{ x, y }] });
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await touch.detach();
    await expect.poll(async () => {
      const [start, end] = await displayedDates();
      return start > before[0] && end < before[1];
    }).toBe(true);
    await page.setViewportSize({ width: 880, height: 980 });
    await linkRegions(page);
    const widget = card(page, exposure);
    const graph = plot(page, exposure);
    const expected = JSON.parse(fixture('regions')).rows as { country: string; weight: number }[];
    expect(await graph.evaluate(el => (el as Graph)._fullData[1].y)).toEqual(expected.map(r => r.country));
    expect(await graph.evaluate(el => (el as Graph)._fullData[1].x)).toEqual(expected.map(r => r.weight));
    const viewport = widget.locator('.chart-scroll-viewport');
    const bounds = await viewport.evaluate(el => [el.clientHeight, el.scrollHeight]);
    expect(bounds[1]).toBeGreaterThan(bounds[0]);
    await swipeToBottom(page, viewport, graph);
    const points = graph.locator('.scatterlayer .trace').last().locator('.points .point');
    await expect(points).toHaveCount(expected.length);
    // The zero marker straddles the axis. Tap the half inside the plot.
    await tapVisibleMarker(page, points.last(), .75);
    await expect(graph.locator('.hoverlayer')).toContainText(expected.at(-1)!.country + 'Reported weight 0%');
    await widget.screenshot({ path: info.outputPath('narrow-region.png') });
  } finally {
    await context.close();
  }
});
