// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Locator, type Page } from '@playwright/test';
import { isDiscoveryRequest, openRail, read } from './fixtures';
import { card, plot } from './fixtures/chart-recipes';
import { dropFile } from './fixtures/return-summary';
import {
  attachHoldings, backendOrigin, backendPath, chartName, chooseEtfSource, file, placeholder,
  prepareEtf, recipe, snapshot, tab, workspace,
} from './fixtures/etf-sunburst';

const apply = (widget: Locator) => widget.getByRole('button', { name: 'Apply chart settings' });
const holdings = (widget: Locator) => widget.getByRole('list', { name: 'Original holding weights' });
const paths = (graph: Locator) => graph.locator('.sunburstlayer path.surface');

function dataRequests(page: Page, appURL: string) {
  const origin = new URL(appURL).origin;
  const requests: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol)) return;
    const wasm = url.origin === origin && /\/pivot_wasm_bg(?:-[\w-]+)?\.wasm$/.test(url.pathname);
    if (!wasm && (url.origin !== origin || url.pathname.startsWith('/api/')
      || ['xhr', 'fetch'].includes(request.resourceType())) && !isDiscoveryRequest(request.url())) requests.push(request.url());
  });
  return requests;
}

async function saveWorkspace(page: Page) {
  await openRail(page);
  await page.locator('nav.left-rail').getByRole('button', { name: workspace, exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Save…' }).click();
  await page.getByRole('menuitem', { name: 'BDOBB Workspace', exact: true }).click();
}

async function slicePoint(graph: Locator, label: string) {
  return graph.evaluate((node, label) => {
    type Slice = { x0: number; x1: number; rpx0: number; rpx1: number; data: { data: { label: string } } };
    const { cx, cy } = (node as HTMLElement & { calcdata: { cx: number; cy: number }[][] }).calcdata[0][0];
    const { x, y } = node.getBoundingClientRect();
    for (const path of node.querySelectorAll<SVGPathElement>('.sunburstlayer path.surface')) {
      const { x0, x1, rpx0, rpx1, data } = (path as SVGPathElement & { __data__: Slice }).__data__;
      if (data.data.label !== label) continue;
      const angle = (x0 + x1) / 2, radius = (rpx0 + rpx1) / 2;
      return { x: x + cx + radius * Math.cos(angle), y: y + cy - radius * Math.sin(angle) };
    }
    throw new Error('No visible sunburst slice: ' + label);
  }, label);
}

type Drawing = { css: [number, number]; layout: [number, number]; revision: string; margin: object };

async function drawing(widget: Locator, previousWidth?: number) {
  const viewport = widget.locator('.linked-chart-plot--etf');
  let measured: Drawing | undefined;
  await expect.poll(async () => {
    measured = await viewport.evaluate((element, previousWidth) => {
      type Graph = HTMLElement & { _fullLayout?: { width: number; height: number; uirevision: string; margin: object } };
      const node = element.querySelector<Graph>('.js-plotly-plot');
      const layout = node?._fullLayout;
      if (!node || !layout || layout.width === previousWidth || !node.querySelector('.sunburstlayer path.surface')) return;
      const { width, height } = node.getBoundingClientRect();
      if (layout.width !== Math.round(width) || layout.height !== Math.round(height)) return;
      return { css: [width, height], layout: [layout.width, layout.height], revision: layout.uirevision, margin: layout.margin } satisfies Drawing;
    }, previousWidth);
    return Boolean(measured);
  }).toBe(true);
  return measured!;
}

test('chooses the acquired ETF defaults and drills with original financial values without another backend request', async ({ page, baseURL }, info) => {
  await page.setViewportSize({ width: 1110, height: 950 });
  await page.emulateMedia({ colorScheme: 'light' });
  const requests = dataRequests(page, baseURL!);
  const acquisitions = await prepareEtf(page, { backend: true });
  const widget = card(page, chartName), graph = plot(page, chartName);
  await widget.getByLabel('Chart type').selectOption({ label: 'ETF sunburst' });
  await expect(widget.getByRole('combobox', { name: 'Fund', exact: true })).toHaveValue('VTI.US');
  await expect(widget.getByRole('combobox', { name: 'Snapshot', exact: true })).toHaveValue('latest');
  await expect(widget.getByLabel('Hierarchy depth')).toHaveValue('2');
  const baseline = acquisitions.length;
  expect(baseline).toBeGreaterThan(0);
  await expect(apply(widget)).toBeEnabled();
  await apply(widget).click();
  await expect(graph.locator('.gtitle')).toContainText('35% of fund assets');
  await expect(widget).toContainText('Acquired coverage: unknown.');
  await expect(widget).toContainText('Report date unknown');
  await expect(widget).toContainText('Acquired vintage 2026-11-20T04:16:45Z');
  const holding = await slicePoint(graph, 'AAPL.US');
  await page.mouse.move(holding.x, holding.y);
  await expect(graph.locator('.hoverlayer')).toContainText('Original fund weight: 0.2 (20% of fund assets)');
  await expect(graph.locator('.hoverlayer')).toContainText('Share of delivered holdings: 57.14%');
  await widget.screenshot({ path: info.outputPath('etf-light.png') });
  const sector = await slicePoint(graph, 'Technology');
  await page.mouse.click(sector.x, sector.y);
  await expect(paths(graph)).toHaveCount(2);
  const drilledHolding = await slicePoint(graph, 'AAPL.US');
  await page.mouse.move(drilledHolding.x, drilledHolding.y);
  await expect(graph.locator('.hoverlayer')).toContainText('Share of delivered holdings: 57.14%');
  const center = await slicePoint(graph, 'Technology');
  await page.mouse.click(center.x, center.y);
  await expect(paths(graph)).toHaveCount(5);
  await page.mouse.click(sector.x, sector.y);
  await expect(paths(graph)).toHaveCount(2);
  await widget.getByRole('button', { name: 'Home' }).focus();
  await page.keyboard.press('Enter');
  await expect(paths(graph)).toHaveCount(5);
  await expect(widget.getByLabel('Sector view')).toHaveValue('');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => graph.evaluate(node => {
    const plot = node as HTMLElement & { _fullLayout?: { paper_bgcolor: string } };
    // Theme changes replace the measured worker figure and retire its old Plotly layout.
    return plot.isConnected ? plot._fullLayout?.paper_bgcolor : undefined;
  })).toBe('#1e242e');
  await widget.screenshot({ path: info.outputPath('etf-dark.png') });
  const table = card(page, 'Fictional ETF holdings');
  await table.getByRole('button', { name: 'Filter rows' }).click();
  await table.getByLabel('Filter symbol', { exact: true }).fill('AAPL.US');
  await expect(widget).toContainText('Visible holdings: 1 of 2 acquired · 20% of fund assets');
  await expect(widget).toContainText('1 acquired holdings omitted, excluded weight unavailable.');
  await expect(graph.locator('.gtitle')).toContainText('20% of fund assets');
  await expect(paths(graph)).toHaveCount(3);
  expect(acquisitions).toHaveLength(baseline);
  expect(requests).toEqual(Array(baseline).fill(backendOrigin + backendPath + '?chart_source=true&symbol=VTI.US'));
});

test('refuses an unrepresentable draft at real dimensions and keeps the applied geometry and original holding weights', async ({ page }) => {
  await page.setViewportSize({ width: 1020, height: 1070 });
  await prepareEtf(page, { options: { ...recipe, depth: 1 } });
  const widget = card(page, chartName), graph = plot(page, chartName);
  await attachHoldings(page, snapshot({ weights: [.35, Number.MIN_VALUE, 0], sameSector: true }));
  await expect(paths(graph)).toHaveCount(2);
  const first = await drawing(widget);
  expect(first.layout).toEqual(first.css.map(Math.round));
  expect(first.margin).toMatchObject({ l: 12, r: 12, t: 64, b: 12, autoexpand: false });
  await widget.getByText('ETF holdings details', { exact: true }).click();
  await expect(holdings(widget)).toContainText('AAYA.F');
  await expect(holdings(widget)).toContainText('5e-324 fund-assets fraction');
  await expect(holdings(widget)).toContainText('0 fund-assets fraction');
  await widget.getByText('ETF sunburst settings', { exact: true }).click();
  await widget.getByLabel('Hierarchy depth').selectOption('2');
  await expect(widget).toContainText(/geometry.*5e-324/i);
  await expect(apply(widget)).toBeDisabled();
  await expect(paths(graph)).toHaveCount(2);
  await expect(holdings(widget)).toContainText('5e-324');
  await page.setViewportSize({ width: 850, height: 1000 });
  const resized = await drawing(widget, first.layout[0]);
  expect(resized.layout).toEqual(resized.css.map(Math.round));
  expect(resized.revision).toBe(first.revision);
});

test('retains the local asset guard, then imports a source-free pin and repairs it using a newly acquired File', async ({ page, context, baseURL }) => {
  const requests = dataRequests(page, baseURL!);
  await prepareEtf(page, { options: { ...recipe, snapshot: '2026-09-30' } });
  const graph = plot(page, chartName);
  await attachHoldings(page, snapshot({ date: '2026-09-30' }));
  await expect(paths(graph)).toHaveCount(6);
  await saveWorkspace(page);
  await expect(page.getByText(/export refused.*MISSING_LOCAL_ASSET/i)).toBeVisible();
  const path = 'exports/' + workspace + '.apps.json';
  expect(await read(page, path)).toBeUndefined();
  await chooseEtfSource(page, placeholder);
  await card(page, file).getByRole('button', { name: 'Remove card', exact: true }).click();
  await expect(card(page, file)).toHaveCount(0);
  await saveWorkspace(page);
  await expect.poll(() => read(page, path)).toBeDefined();
  const text = (await read(page, path))!;
  expect(JSON.parse(text)[0].extensions.bdobb.cards[0].extras.linkedChart.recipe).toEqual({ ...recipe, snapshot: '2026-09-30' });
  expect(text).not.toMatch(/chart_sources|etfHierarchy|holding_keys|viewport|as_of|0\.15|2026-11-20T/);
  const fresh = await context.newPage();
  const reacquired = dataRequests(fresh, baseURL!);
  await prepareEtf(fresh, { empty: true });
  await dropFile(fresh, 'etf.apps.json', text);
  await fresh.getByRole('tab', { name: tab, exact: true }).click();
  const imported = card(fresh, chartName), importedGraph = plot(fresh, chartName);
  await expect(importedGraph).toHaveCount(0);
  await attachHoldings(fresh, snapshot({ date: '2026-10-31' }));
  await expect(imported).toContainText('The pinned ETF snapshot is unavailable');
  await imported.getByText('ETF sunburst settings', { exact: true }).click();
  await expect(imported.getByRole('combobox', { name: 'Snapshot', exact: true })).toHaveValue('2026-09-30');
  await expect(importedGraph).toHaveCount(0);
  await imported.getByRole('combobox', { name: 'Snapshot', exact: true }).selectOption('2026-10-31');
  await expect(apply(imported)).toBeEnabled();
  await apply(imported).click();
  await expect(paths(importedGraph)).toHaveCount(6);
  await expect(imported).toContainText('2026-10-31');
  expect(requests).toEqual([]);
  expect(reacquired).toEqual([]);
  await fresh.close();
  await expect(graph).toHaveCount(0);
});

test('inspects a wedge on a real touch viewport and uses handled sector navigation for a subpixel holding', async ({ browser, baseURL }, info) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, colorScheme: 'dark', baseURL,
    viewport: { width: 640, height: 1040 } });
  try {
    const page = await context.newPage();
    await prepareEtf(page, { options: recipe });
    const widget = card(page, chartName), graph = plot(page, chartName);
    const samples = snapshot({ weights: [.349999, .000001, 0] });
    await attachHoldings(page, samples);
    await expect(paths(graph)).toHaveCount(5);
    const view = widget.locator('.linked-chart-plot--etf .chart-scroll-viewport');
    await expect(view).not.toHaveClass(/touch-scroll/);
    const technology = await slicePoint(graph, 'Technology');
    await page.touchscreen.tap(technology.x, technology.y);
    await expect(graph.locator('.hoverlayer')).toContainText('34.9999% of fund assets');
    await page.touchscreen.tap(technology.x, technology.y);
    await expect(paths(graph)).toHaveCount(2);
    await widget.getByRole('button', { name: 'Home' }).tap();
    await expect(paths(graph)).toHaveCount(5);
    await widget.getByText('ETF holdings details', { exact: true }).tap();
    await expect(holdings(widget)).toContainText('0.000001 fund-assets fraction');
    await widget.getByLabel('Sector view').selectOption({ label: 'Sector unavailable' });
    await expect(paths(graph)).toHaveCount(2);
    const smallHolding = await slicePoint(graph, 'AAYA.F');
    await page.touchscreen.tap(smallHolding.x, smallHolding.y);
    await expect(graph.locator('.hoverlayer')).toContainText('Original fund weight: 0.000001');
    await widget.screenshot({ path: info.outputPath('etf-dark-touch.png') });
    const before = await drawing(widget);
    await page.setViewportSize({ width: 300, height: 925 });
    await expect(view).toHaveClass(/touch-scroll/);
    await expect(paths(graph)).toHaveCount(2);
    const after = await drawing(widget, before.layout[0]);
    expect(after.revision).toBe(before.revision);
    expect(after.layout).toEqual(after.css.map(Math.round));
    await view.scrollIntoViewIfNeeded();
    const box = (await view.boundingBox())!;
    const session = await context.newCDPSession(page);
    for (let step = 0; step <= 8; step++) await session.send('Input.dispatchTouchEvent', {
      type: step ? 'touchMove' : 'touchStart',
      touchPoints: [{ x: box.x + box.width * .8 - step * 9, y: box.y + box.height / 2 }],
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
    await expect.poll(() => view.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
    await widget.screenshot({ path: info.outputPath('etf-dark-narrow.png') });
  } finally { await context.close(); }
});
