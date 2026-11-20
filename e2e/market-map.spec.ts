// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Locator, type Page } from '@playwright/test';
import { capMap, indexMap, marketSession } from '../src/test/fixtures/marketMap';
import index from '../src/test/fixtures/marketMapIndex.json' with { type: 'json' };
import { card, plot } from './fixtures/chart-recipes';
import { dataRequests } from './fixtures/dual-axis-overlay';
import { openRail, read } from './fixtures';
import { dropFile } from './fixtures/return-summary';
import { attachMarket, chartName, chooseMarketSource, liveOrigin, livePath, liveTitle, placeholder, sampleName, seedMarket, tab, workspace } from './fixtures/market-map';

const settings = (widget: Locator) => widget.getByText('Market map settings', { exact: true });
const applied = (widget: Locator) => widget.getByRole('button', { name: 'Apply chart settings' });
const facts = (widget: Locator) => widget.getByText('Market map details', { exact: true });
const nav = (widget: Locator) => widget.getByLabel('Sector view');
const title = (graph: Locator) => graph.locator('.gtitle');
const view = (graph: Locator) => graph.locator('.treemaplayer');
const sector = JSON.stringify(['market-sector', 'Technology']);
const root = JSON.stringify(['market-root', 'delivered-sample']);
type Tile = { id: string; path: boolean; area: number; fill: string; box: { x: number; y: number; width: number; height: number } };

async function drawing(graph: Locator) {
  return graph.evaluate(node => {
    const plot = node as HTMLElement & { _fullLayout: { width: number; height: number; uirevision: string; paper_bgcolor: string };
      _fullData: Array<{ level: string; type: string }> };
    const { width, height } = node.getBoundingClientRect();
    const { width: layoutWidth, height: layoutHeight, uirevision, paper_bgcolor } = plot._fullLayout;
    const [trace] = plot._fullData;
    return { size: [layoutWidth, layoutHeight], css: [width, height], question: uirevision, theme: paper_bgcolor, level: trace.level, type: trace.type };
  });
}

async function tiles(graph: Locator): Promise<Tile[]> {
  return graph.locator('.treemaplayer g.slice').evaluateAll(slices => slices.flatMap(slice => {
    const shape = slice.querySelector<SVGPathElement>('path.surface');
    if (!shape) return [];
    const datum = (slice as unknown as Element & { __data__: { data: { data: { id: string } } } }).__data__;
    const { width, height } = shape.getBBox();
    const box = shape.getBoundingClientRect();
    return [{ id: datum.data.data.id, path: !!shape.getAttribute('d'), area: width * height, fill: getComputedStyle(shape).fill,
      box: { x: box.x, y: box.y, width: box.width, height: box.height } }];
  }));
}
const leafId = (name: string) => JSON.stringify(['market-listing', name]);

async function point(graph: Locator, id: string, dx = 14, dy = 8) {
  const tile = (await tiles(graph)).find(tile => tile.id === id)!;
  return { x: tile.box.x + Math.min(tile.box.width / 2, dx), y: tile.box.y + Math.min(tile.box.height / 2, dy) };
}

async function expectSectorLabel(graph: Locator, label: string) {
  const text = view(graph).locator('g.slice text.slicetext').filter({ hasText: label });
  await expect.poll(() => text.evaluateAll(nodes => {
    if (nodes.length !== 1) return 0;
    const { width, height } = nodes[0].getBoundingClientRect();
    return Math.min(width, height);
  }), { message: `Rendered size of the ${label} sector label` }).toBeGreaterThan(8);
}

async function touchDrag(page: Page, start: { x: number; y: number }, end: { x: number; y: number }) {
  const touch = await page.context().newCDPSession(page);
  try {
    for (let step = 0; step <= 8; step++) {
      await touch.send('Input.dispatchTouchEvent', {
        type: step ? 'touchMove' : 'touchStart',
        touchPoints: [{ x: start.x + (end.x - start.x) * step / 8, y: start.y + (end.y - start.y) * step / 8 }],
      });
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await touch.detach(); }
}

test('defaults to monetary area, conserves real tile areas and keeps hierarchy navigation on the same question', async ({ page, baseURL }, info) => {
  await page.setViewportSize({ width: 1040, height: 1050 });
  await page.emulateMedia({ colorScheme: 'light' });
  const requests = dataRequests(page, baseURL!);
  await seedMarket(page);
  const widget = card(page, chartName), graph = plot(page, chartName);
  await widget.getByLabel('Chart type').selectOption('market-map');
  await expect(widget.getByLabel('Area basis')).toHaveValue('delivered-cap');
  await expect(widget.getByRole('option', { name: 'Named index weights' })).toHaveAttribute('disabled', '');
  await expect(applied(widget)).toBeDisabled();

  const snapshot = marketSession();
  Object.assign(snapshot.rows[0], { area: 100 });
  Object.assign(snapshot.rows[1], { area: 300 });
  snapshot.rows.splice(1, 0, { ...snapshot.rows[0], listing: 'DELTA.US', sector: 'Technology', area: 200, change: 0 });
  Object.assign(snapshot.chart_sources.receipts[0], {
    raw_count: 5, delivered_count: 3, normalized_count: 3, listing_keys: ['ALFA.US', 'BETA.US', 'DELTA.US'],
    excluded_areas: { zero: 1, negative: 1, invalid: 0 },
  });
  await attachMarket(page, snapshot);
  await widget.getByLabel('Chart type').selectOption('market-map');
  await expect(widget.getByLabel('Completed session')).toHaveValue('latest');
  await expect(applied(widget)).toBeEnabled();
  await applied(widget).click();
  await expect(title(graph)).toContainText('Delivered-sample market cap');
  await expect(title(graph)).not.toContainText(/weight|index/i);
  await expect.poll(async () => (await drawing(graph)).type).toBe('treemap');
  const current = await drawing(graph);
  expect(current.level).toBe('');
  expect(current.size).toEqual(current.css);
  const actual = await tiles(graph);
  const area = (id: string) => actual.find(tile => tile.id === leafId(id))!;
  expect(area('DELTA.US').area / area('ALFA.US').area).toBeCloseTo(2, 3);
  // The two equal sectors have their own fixed headers. The wider sector's
  // single child has the same data area as the two children of Technology.
  expect(area('BETA.US').area / (area('ALFA.US').area + area('DELTA.US').area)).toBeCloseTo(1, 3);
  expect(area('ALFA.US').fill).toBe('rgb(240, 230, 217)');
  expect(area('BETA.US').fill).toBe('rgb(138, 164, 187)');
  await expectSectorLabel(graph, 'Technology');
  await expectSectorLabel(graph, 'Sector unavailable');
  await expect(graph.locator('.colorbar .cbaxis text')).toHaveText(['-1%', '0%', '1%']);
  const hover = await point(graph, leafId('ALFA.US'));
  await page.mouse.move(hover.x, hover.y);
  await expect(graph.locator('.hoverlayer')).toContainText('100 USD');
  await expect(graph.locator('.hoverlayer')).toContainText('0%');
  await expect(graph.locator('.hoverlayer')).toContainText('Capitalization retrieved 2026-11-13T22:00:00Z');
  await widget.screenshot({ path: info.outputPath('market-cap-light.png') });
  const click = await point(graph, sector, 20, 5);
  await page.mouse.click(click.x, click.y);
  await expect.poll(async () => (await drawing(graph)).level).toBe(sector);
  await expect(nav(widget)).toHaveValue(sector);
  await view(graph).locator('.pathbar').filter({ hasText: 'Delivered-sample market cap' }).first().click();
  await expect(nav(widget)).toHaveValue('');
  await expect.poll(async () => ['', root].includes((await drawing(graph)).level)).toBe(true);
  await nav(widget).focus();
  await page.keyboard.press('t');
  await expect.poll(async () => (await drawing(graph)).level).toBe(sector);
  const home = widget.getByRole('button', { name: 'Home', exact: true });
  await home.focus();
  await page.keyboard.press('Enter');
  await expect(nav(widget)).toHaveValue('');
  expect((await drawing(graph)).question).toBe(current.question);
  await facts(widget).click();
  const listing = widget.getByRole('table', { name: 'Original listing values' });
  await expect(listing).toContainText('BETA.US');
  await expect(listing).toContainText('Sector unavailable');
  await expect(listing).toContainText('Return unavailable');
  await expect(widget.getByText(/5 raw records/)).toContainText('0 omitted');
  await expect(widget.getByText(/Source area exclusions/)).toContainText('1 zero, 1 negative');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(async () => (await drawing(graph)).theme).toBe('#1e242e');
  await expectSectorLabel(graph, 'Technology');
  await expectSectorLabel(graph, 'Sector unavailable');
  await widget.screenshot({ path: info.outputPath('market-cap-dark.png') });
  await page.setViewportSize({ width: 285, height: 1050 });
  await expect.poll(async () => (await drawing(graph)).size[0]).toBe(320);
  expect((await drawing(graph)).question).toBe(current.question);
  const heading = (await title(graph).boundingBox())!;
  const narrow = (await graph.boundingBox())!;
  expect(heading.width).toBeLessThan(narrow.width);
  await widget.screenshot({ path: info.outputPath('market-cap-narrow.png') });
  for (const row of snapshot.rows) Object.assign(row, { change: null });
  await attachMarket(page, snapshot, 'market-missing-returns.json');
  await expect(title(graph)).toContainText('Delivered-sample market cap');
  await expect(widget.getByText('All listing returns are unavailable.')).toBeVisible();
  await expect(graph.locator('.colorbar')).toHaveCount(0);
  expect(requests).toEqual([]);
});

test('keeps ordinary sector labels visible on the minimum drawing surface in both themes', async ({ page, baseURL }) => {
  const requests = dataRequests(page, baseURL!);
  await page.setViewportSize({ width: 285, height: 800 });
  await page.emulateMedia({ colorScheme: 'light' });
  const sample = marketSession();
  Object.assign(sample.rows[0], { area: 100 });
  Object.assign(sample.rows[1], { area: 100, sector: 'Banks' });
  await seedMarket(page, capMap, false, 14);
  await attachMarket(page, sample);
  const graph = plot(page, chartName);
  await expect(title(graph)).toContainText('Delivered-sample market cap');
  const original = await drawing(graph);
  expect(original.css).toEqual([320, 260]);
  expect(original.size).toEqual(original.css);
  await expectSectorLabel(graph, 'Technology');
  await expectSectorLabel(graph, 'Banks');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => graph.evaluate(node => {
    const plot = node as HTMLElement & { _fullLayout?: { paper_bgcolor: string } };
    return plot.isConnected ? plot._fullLayout?.paper_bgcolor : undefined;
  })).toBe('#1e242e');
  await expectSectorLabel(graph, 'Technology');
  await expectSectorLabel(graph, 'Banks');
  expect((await drawing(graph)).question).toBe(original.question);
  expect(requests).toEqual([]);
});

test('validates acquired named index area and keeps original tiny values in the narrow detail and hover', async ({ page, baseURL }, info) => {
  const requests = dataRequests(page, baseURL!);
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const sample = structuredClone(index);
  Object.assign(sample.rows[0], { area: 1e-7, change: 1e-7 });
  Object.assign(sample.rows[1], { area: .9999999, change: -.1 });
  await page.setViewportSize({ width: 282, height: 1050 });
  await seedMarket(page, indexMap);
  await attachMarket(page, sample);
  const widget = card(page, chartName), graph = plot(page, chartName);
  await expect(title(graph)).toContainText('Complete index weights');
  await expect(widget.locator('.linked-chart-status').getByText(/Membership and weights as of/)).toContainText('2026-11-12');
  await expect(widget.getByText(/Completed close-to-close return/)).toContainText('2026-11-13');
  await expect.poll(async () => (await tiles(graph)).some(tile => tile.id === leafId('ALFA.US') && tile.path && tile.area > 0)).toBe(true);
  await facts(widget).click();
  await expect(widget.getByRole('table', { name: 'Original listing values' })).toContainText('fraction 1e-7');
  await expect(widget.getByRole('table', { name: 'Original listing values' })).toContainText('fraction 0.9999999');
  const hover = await point(graph, leafId('BETA.US'), 20, 8);
  await page.mouse.move(hover.x, hover.y);
  await expect(graph.locator('.hoverlayer')).toContainText('fraction 0.9999999');
  await expect(graph.locator('.hoverlayer')).toContainText('fraction -0.1');
  await widget.screenshot({ path: info.outputPath('market-index-tiny.png') });
  const source = card(page, sampleName);
  await source.getByRole('button', { name: 'Filter rows' }).click();
  await source.getByLabel('Filter listing', { exact: true }).fill('BETA.US');
  await expect(title(graph)).toContainText('Delivered index components');
  await expect(widget.getByText(/1 visible listings of 2 acquired/)).toContainText('1 omitted');
  await expect(widget.getByText(/Delivered index components.*acquired coverage complete/)).toContainText('fraction 0.9999999');
  // Retire a live Plotly hierarchy and its event listener during an actual source relink.
  await chooseMarketSource(page, placeholder);
  await expect(graph).toHaveCount(0);
  await chooseMarketSource(page, sampleName);
  await expect(title(graph)).toContainText('Delivered index components');

  const tiny = structuredClone(index);
  tiny.completeness = 'partial';
  tiny.chart_sources.receipts[0].coverage = 'partial';
  for (const row of tiny.rows) row.area = 1.2345678901234568e-128;
  await attachMarket(page, tiny, 'market-tiny-weights.json');
  await expect(title(graph)).toContainText('Delivered index components');
  for (const [id, original] of [
    [leafId('ALFA.US'), '1.2345678901234568e-128'],
    [sector, '1.2345678901234568e-128'],
    [JSON.stringify(['market-root', 'EXAMPLE.INDX']), '2.4691357802469136e-128'],
  ]) {
    const target = await point(graph, id, 20, 8);
    await page.mouse.move(target.x, target.y);
    const hover = graph.locator('.hoverlayer .hovertext');
    await expect(hover).toContainText(`fraction ${original}`);
    const tip = (await hover.boundingBox())!, surface = (await graph.boundingBox())!;
    expect(tip.x).toBeGreaterThanOrEqual(surface.x - 1);
    expect(tip.x + tip.width).toBeLessThanOrEqual(surface.x + surface.width + 1);
  }
  await widget.screenshot({ path: info.outputPath('market-index-original-fraction.png') });
  expect(pageErrors).toEqual([]);
  expect(requests).toEqual([]);
});

test('touch first inspects a hierarchy tile, then drills and returns through the native breadcrumb', async ({ browser, baseURL }, info) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, colorScheme: 'dark', baseURL,
    viewport: { width: 680, height: 1050 } });
  try {
    const page = await context.newPage(), requests = dataRequests(page, baseURL!);
    const source = marketSession();
    source.rows[0].area = 50000;
    await seedMarket(page, capMap);
    await attachMarket(page, source);
    const widget = card(page, chartName), graph = plot(page, chartName);
    const viewport = widget.locator('.linked-chart-plot--market .chart-scroll-viewport');
    await expect(title(graph)).toContainText('Delivered-sample market cap');
    await expect(viewport).not.toHaveClass(/touch-scroll/);
    const leaf = await point(graph, leafId('BETA.US'));
    await page.touchscreen.tap(leaf.x, leaf.y);
    await expect(graph.locator('.hoverlayer')).toContainText('98765.4321 USD');
    const node = await point(graph, sector, 20, 5);
    await page.touchscreen.tap(node.x, node.y);
    await expect(graph.locator('.hoverlayer')).toContainText('Technology');
    expect((await drawing(graph)).level).toBe('');
    await page.touchscreen.tap(node.x, node.y);
    await expect.poll(async () => (await drawing(graph)).level).toBe(sector);
    const breadcrumb = view(graph).locator('.pathbar').filter({ hasText: 'Delivered-sample market cap' }).first();
    await breadcrumb.tap();
    await expect(nav(widget)).toHaveValue('');
    await widget.screenshot({ path: info.outputPath('market-touch.png') });
    const current = (await drawing(graph)).question;
    await page.setViewportSize({ width: 285, height: 1050 });
    await expect(viewport).toHaveClass(/touch-scroll/);
    await expect.poll(async () => (await drawing(graph)).size[0]).toBe(320);
    expect((await drawing(graph)).question).toBe(current);
    const box = (await viewport.boundingBox())!;
    await touchDrag(page, { x: box.x + box.width * .8, y: box.y + 130 }, { x: box.x + box.width * .24, y: box.y + 130 });
    await expect.poll(() => viewport.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
    await widget.screenshot({ path: info.outputPath('market-touch-overflow.png') });
    expect(requests).toEqual([]);
  } finally { await context.close(); }
});

async function exportMarket(page: Page) {
  await openRail(page);
  await page.locator('nav.left-rail').getByRole('button', { name: workspace, exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Save…' }).click();
  await page.getByRole('menuitem', { name: 'BDOBB Workspace', exact: true }).click();
}

test('keeps attached File export refusal, then repairs a source-free pin with a freshly acquired session', async ({ page, context, baseURL }) => {
  const requests = dataRequests(page, baseURL!);
  const pinned = { ...capMap, session: '2026-11-13' };
  await seedMarket(page, pinned);
  await attachMarket(page, marketSession());
  await expect(title(plot(page, chartName))).toContainText('2026-11-13');
  await exportMarket(page);
  await expect(page.getByText(/export refused.*MISSING_LOCAL_ASSET/i)).toBeVisible();
  const path = 'exports/' + workspace + '.apps.json';
  expect(await read(page, path)).toBeUndefined();
  await chooseMarketSource(page, placeholder);
  await card(page, sampleName).getByRole('button', { name: 'Remove card', exact: true }).click();
  await expect(card(page, sampleName)).toHaveCount(0);
  await exportMarket(page);
  await expect.poll(() => read(page, path)).toBeDefined();
  const text = (await read(page, path))!;
  expect(JSON.parse(text)[0].extensions.bdobb.cards[0].extras.linkedChart.recipe).toEqual(pinned);
  expect(text).not.toMatch(/chart_sources|viewport|ALFA\.US|example\/acquisition/);

  const fresh = await context.newPage();
  try {
    const newRequests = dataRequests(fresh, baseURL!);
    await seedMarket(fresh, undefined, true);
    await dropFile(fresh, 'market.apps.json', text);
    await fresh.getByRole('tab', { name: tab, exact: true }).click();
    const widget = card(fresh, chartName), graph = plot(fresh, chartName);
    await expect(graph).toHaveCount(0);
    await attachMarket(fresh, marketSession('2026-11-12', '2026-11-11'));
    await expect(widget.getByText(/pinned market-map session is unavailable/i)).toBeVisible();
    await expect(graph).toHaveCount(0);
    await settings(widget).click();
    await expect(applied(widget)).toBeDisabled();
    await widget.getByLabel('Completed session').selectOption('latest');
    await expect(applied(widget)).toBeEnabled();
    await applied(widget).click();
    await expect(title(graph)).toContainText('2026-11-12');
    expect(newRequests).toEqual([]);
  } finally { await fresh.close(); }
  expect(requests).toEqual([]);
});

test('the live screener owns its own request and remains unavailable for both market map modes', async ({ page, baseURL }) => {
  const requests = dataRequests(page, baseURL!);
  await seedMarket(page, capMap, false, 25, true);
  await expect(card(page, liveTitle).getByText('ALFA.US')).toBeVisible();
  const widget = card(page, chartName);
  await expect(widget.getByText(/Relink a verified local market-map acquisition/i)).toBeVisible();
  await settings(widget).click();
  await expect(widget.getByRole('option', { name: 'Named index weights' })).toHaveAttribute('disabled', '');
  await expect(applied(widget)).toBeDisabled();
  await expect(plot(page, chartName)).toHaveCount(0);
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every(url => url.startsWith(liveOrigin + livePath))).toBe(true);
});
