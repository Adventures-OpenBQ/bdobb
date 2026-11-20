// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Locator, type Page } from '@playwright/test';
import { dashboardSeed, openRail, read, seedApp } from './fixtures';
import { card, plot, captureParameters, openParameters } from './fixtures/chart-recipes';
import { chooseReturnSource, closes, dropFile, placeholder, prepareReturns, returnChart, returnRecipe, returnSnapshot, sampleName, workspace } from './fixtures/return-summary';

type Axis = { _offset: number; range: number[]; tickvals?: number[]; c2p: (coordinate: number) => number };
type Graph = HTMLElement & {
  _fullLayout: { xaxis: Axis; yaxis: Axis; width: number; height: number; minreducedwidth: number; minreducedheight: number; uirevision: string };
};
const apply = (widget: Locator) => widget.getByRole('button', { name: 'Apply chart settings' });
const boxes = (graph: Locator) => graph.locator('.boxlayer path.box');
const tooltip = (graph: Locator) => graph.locator('.hoverlayer');
const normal = returnSnapshot({ 'ZZZ.US': closes(.125), 'AAA.US': closes(.0625) });
const boxOptions = { ...returnRecipe, symbols: ['ZZZ.US'] };

async function point(graph: Locator, x: number, y: number) {
  return graph.evaluate((node, [x, y]) => {
    const { xaxis, yaxis } = (node as Graph)._fullLayout;
    const bounds = node.getBoundingClientRect();
    return { x: bounds.x + xaxis._offset + xaxis.c2p(x), y: bounds.y + yaxis._offset + yaxis.c2p(y) };
  }, [x, y]);
}

async function contrast(text: Locator) {
  expect(await text.evaluate(el => {
    const luma = (rgb: string) => [...rgb.matchAll(/[\d.]+/g)].slice(0, 3).reduce((sum, match, i) => {
      const x = Number(match[0]) / 255;
      return sum + [0.2126, 0.7152, 0.0722][i] * (x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
    }, 0);
    const tip = el.closest('.hovertext')?.querySelector('path');
    const svg = el.closest('.svg-container')?.querySelector('.main-svg');
    if (!svg) throw new Error('No rendered Plotly paper');
    const background = tip ? getComputedStyle(tip).fill : getComputedStyle(svg).backgroundColor;
    const values = [luma(background), luma(getComputedStyle(el).fill)].sort((a, b) => b - a);
    return (values[0] + .05) / (values[1] + .05);
  })).toBeGreaterThanOrEqual(4.5);
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

test('uses an acquired box with original outliers and keyboard listing details', async ({ page }, info) => {
  await page.setViewportSize({ width: 1250, height: 930 });
  await page.emulateMedia({ colorScheme: 'light' });
  await prepareReturns(page, returnSnapshot({ 'ZZZ.US': [16, 4, 1, 1, 1, 1, 1, 1, 1] }), boxOptions);
  const widget = card(page, returnChart);
  const graph = plot(page, returnChart);
  await captureParameters(widget, 'Return view', file => info.outputPath(file));
  const parameters = await openParameters(widget);
  await expect(parameters.getByLabel('Return view')).toHaveValue('box');
  await widget.getByRole('button', { name: 'Hide parameters' }).click();
  await expect(boxes(graph)).toHaveCount(1);
  await expect.poll(() => graph.evaluate(node => Math.abs((node as Graph)._fullLayout.height - node.getBoundingClientRect().height))).toBeLessThan(.51);
  await boxes(graph).scrollIntoViewIfNeeded();
  const median = await point(graph, 0, 0);
  await page.mouse.move(median.x, median.y);
  await expect(tooltip(graph)).toContainText('Q1: -18.75% (-0.1875)');
  await graph.locator('.scatterlayer path.point').last().scrollIntoViewIfNeeded();
  const outlier = await point(graph, 0, -.75);
  await page.mouse.move(outlier.x, outlier.y);
  await expect(tooltip(graph)).toContainText('Outlier');
  await expect(tooltip(graph)).toContainText('-75% (-0.75)');
  await contrast(tooltip(graph).locator('.nums').first());
  await contrast(graph.locator('.xtick text').first());
  await widget.screenshot({ path: info.outputPath('return-light-outlier.png') });
  const details = widget.getByText('Return listing details', { exact: true });
  await details.focus();
  await page.keyboard.press('Enter');
  await expect(widget.getByRole('list', { name: 'Outlier observations' }).getByRole('listitem')).toHaveCount(2);
  await expect(widget.getByRole('list', { name: 'Outlier observations' })).toContainText('2026-01-03 · -75% (-0.75)');
  await openParameters(widget);
  await widget.getByLabel('Return view').selectOption('violin');
  await expect(apply(widget)).toBeEnabled();
  await apply(widget).click();
  await expect(widget).toContainText('Box view shown because KDE for ZZZ.US needs at least 20 returns and has 8.');
  await expect(boxes(graph)).toHaveCount(1);
});

test('uses the same drawing dimensions to validate a draft and draws shared density in listing order', async ({ page }, info) => {
  await page.setViewportSize({ width: 980, height: 890 });
  await prepareReturns(page, normal);
  const widget = card(page, returnChart), graph = plot(page, returnChart);
  await expect(boxes(graph)).toHaveCount(2);
  const originalRevision = await graph.evaluate(node => (node as Graph)._fullLayout.uirevision);
  await expect(graph.locator('.xtick text')).toHaveText([/ZZZ\.US.*N = 20/, /AAA\.US.*N = 20/]);
  await openParameters(widget);
  await widget.getByLabel('Return view').selectOption('violin');
  await widget.getByLabel('Return window').selectOption('common');
  await expect(widget.getByLabel('Start date')).toHaveValue('2026-01-01');
  await expect(widget.getByLabel('End date')).toHaveValue('2026-01-21');
  await widget.getByLabel('Start date').fill('2026-01-19');
  await expect(apply(widget)).toBeDisabled();
  await expect(widget).toContainText('At least 5 finite daily returns are required for ZZZ.US');
  await expect(boxes(graph)).toHaveCount(2);
  await widget.getByLabel('Start date').fill('2026-01-01');
  await expect(apply(widget)).toBeEnabled();
  await apply(widget).click();
  const paths = graph.locator('.scatterlayer path.js-fill');
  await expect(paths).toHaveCount(2);
  expect(await graph.evaluate(node => (node as Graph)._fullLayout.uirevision)).not.toBe(originalRevision);
  const geometry = await graph.evaluate(node => {
    const { xaxis, yaxis, width, height, minreducedwidth, minreducedheight } = (node as Graph)._fullLayout;
    const shapes = [...node.querySelectorAll<SVGPathElement>('.scatterlayer path.js-fill')];
    const vertex = shapes[0].getPointAtLength(0), rect = node.getBoundingClientRect();
    const probe = node.closest('.linked-chart-renderer')?.querySelector('.return-summary-draft-probe .chart-plot');
    return {
      widths: shapes.map(path => path.getBBox().width),
      point: { x: rect.x + xaxis._offset + vertex.x, y: rect.y + yaxis._offset + vertex.y },
      canvas: [width, height], surface: [rect.width, rect.height], probe: [probe?.getBoundingClientRect().width, probe?.getBoundingClientRect().height],
      admittedMinimum: [minreducedwidth, minreducedheight],
    };
  });
  expect(geometry.widths[0] / geometry.widths[1]).toBeCloseTo(.5, 2);
  geometry.canvas.forEach((value, i) => expect(value).toBeCloseTo(geometry.surface[i], 2));
  expect(geometry.probe).toEqual(geometry.surface);
  expect(geometry.admittedMinimum).toEqual([Math.floor((geometry.surface[0] - 82) / 2), Math.floor((geometry.surface[1] - 116) / 2)]);
  await page.mouse.move(geometry.point.x, geometry.point.y);
  await expect(tooltip(graph)).toContainText('Smoothed density');
  await expect(tooltip(graph)).toContainText('0% (0)');
  await contrast(tooltip(graph).locator('.nums').first());
  await widget.screenshot({ path: info.outputPath('return-light-density.png') });
});

test('a worker geometry refusal keeps the applied box details and candidate order', async ({ page }) => {
  await prepareReturns(page, returnSnapshot({ 'ZZZ.US': closes(.125), 'AAA.US': closes(.125e-10) }));
  const widget = card(page, returnChart), graph = plot(page, returnChart);
  await expect(boxes(graph)).toHaveCount(2);
  await widget.getByText('Return listing details', { exact: true }).click();
  await widget.getByRole('combobox', { name: 'Return listing', exact: true }).selectOption('AAA.US');
  await openParameters(widget);
  await widget.getByLabel('Return view').selectOption('violin');
  await expect(widget).toContainText('The shared density scale cannot preserve violin geometry');
  await expect(apply(widget)).toBeDisabled();
  await expect(boxes(graph)).toHaveCount(2);
  await expect(widget.getByRole('combobox', { name: 'Return listing', exact: true })).toHaveValue('AAA.US');
  await widget.getByLabel('Return view').selectOption('box');
  await expect(apply(widget)).toBeEnabled();
});

test('keeps original-percent ticks on a real narrow touch zoom and preserves the zoom on resize', async ({ browser, baseURL }, info) => {
  const ctx = await browser.newContext({ baseURL, hasTouch: true, isMobile: true, viewport: { width: 520, height: 960 } });
  try {
    const page = await ctx.newPage();
    await page.emulateMedia({ colorScheme: 'dark' });
    await prepareReturns(page, returnSnapshot({ 'ZZZ.US': closes(1e-8) }), boxOptions);
    const widget = card(page, returnChart), graph = plot(page, returnChart);
    await expect(boxes(graph)).toHaveCount(1);
    const size = () => graph.evaluate(node => {
      const { yaxis, uirevision, width } = (node as Graph)._fullLayout;
      return { y: [...yaxis.range], ticks: [...(yaxis.tickvals ?? [])], revision: uirevision, width };
    });
    const initial = await size();
    await expect(widget.locator('.linked-chart-plot > .chart-scroll-viewport')).not.toHaveClass(/--touch-scroll/);
    const marker = await graph.locator('.scatterlayer path.point').first().boundingBox();
    await page.touchscreen.tap(marker!.x + marker!.width / 2, marker!.y + marker!.height / 2);
    await expect(tooltip(graph)).toContainText(/Median: .*% \(/);
    await contrast(tooltip(graph).locator('.nums').first());
    const drag = (await graph.locator('.nsewdrag').boundingBox())!;
    const [lower, upper] = initial.ticks.slice(1, 3);
    const low = await point(graph, 0, lower + (upper - lower) * .15);
    const high = await point(graph, 0, lower + (upper - lower) * .85);
    await touchDrag(page, { x: drag.x + drag.width * .3, y: high.y },
      { x: drag.x + drag.width * .7, y: low.y });
    await expect.poll(async () => (await size()).y).not.toEqual(initial.y);
    const ticks = graph.locator('.ytick text');
    await expect(ticks.first()).toHaveText(/E-\d+%/);
    const percentages = (await ticks.allTextContents()).map(text => Number(text.replace('%', '')));
    expect(percentages.length).toBeGreaterThan(2);
    expect(percentages.every(value => value > 1e-6 && value < 2e-6)).toBe(true);
    await contrast(ticks.first());
    const zoomed = await size();
    await page.setViewportSize({ width: 435, height: 960 });
    await expect.poll(async () => (await size()).width).toBeLessThan(zoomed.width);
    await expect.poll(async () => (await size()).y).toEqual(zoomed.y);
    expect((await size()).revision).toBe(initial.revision);
    await expect(graph.locator('.ytick text').first()).toHaveText(/E-\d+%/);
    await widget.screenshot({ path: info.outputPath('return-dark-narrow-zoom.png') });
  } finally { await ctx.close(); }
});

test('scrolls a wide return comparison by touch', async ({ browser, baseURL }, info) => {
  const ctx = await browser.newContext({ baseURL, hasTouch: true, isMobile: true, viewport: { width: 390, height: 900 } });
  try {
    const page = await ctx.newPage();
    await page.emulateMedia({ colorScheme: 'dark' });
    const symbols = ['ZZZ.US', 'AAA.US', 'BBB.US', 'CCC.US', 'DDD.US'];
    await prepareReturns(page, returnSnapshot(Object.fromEntries(symbols.map(symbol => [symbol, closes(.125)]))),
      { ...returnRecipe, symbols }, 20);
    const widget = card(page, returnChart), graph = plot(page, returnChart);
    await expect(boxes(graph)).toHaveCount(5);
    const viewport = widget.locator('.linked-chart-plot > .chart-scroll-viewport');
    await expect(viewport).toHaveClass(/--touch-scroll/);
    const bounds = (await viewport.boundingBox())!;
    const start = { x: bounds.x + bounds.width - 25, y: bounds.y + 110 };
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('nsewdrag'), start)).toBe(true);
    const stopped = viewport.evaluate(node => new Promise<void>(resolve => node.addEventListener('scrollend', () => resolve(), { once: true })));
    await touchDrag(page, start, { x: start.x - 155, y: start.y });
    await stopped;
    await expect.poll(() => viewport.evaluate(node => node.scrollLeft)).toBeGreaterThan(30);
    const visibleMedian = await graph.evaluate(node => Array.from(node.querySelectorAll('.scatterlayer path.point')).map(marker => {
      const rect = marker.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }).find(({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('nsewdrag')));
    expect(visibleMedian).toBeDefined();
    await page.touchscreen.tap(visibleMedian!.x, visibleMedian!.y);
    await expect(tooltip(graph)).toContainText('Median: 25% (0.25)');
    await contrast(tooltip(graph).locator('.nums').first());
    await widget.screenshot({ path: info.outputPath('return-dark-narrow-scroll.png') });
  } finally { await ctx.close(); }
});

async function saveWorkspace(page: Page) {
  await openRail(page);
  await page.locator('nav.left-rail').getByRole('button', { name: workspace, exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Save…' }).click();
  await page.getByRole('menuitem', { name: 'BDOBB Workspace', exact: true }).click();
}

test('exports authored pins after detaching the local asset, and reacquires with explicit repair on a new page', async ({ page, context, baseURL }) => {
  await prepareReturns(page, normal);
  const widget = card(page, returnChart);
  await expect(boxes(plot(page, returnChart))).toHaveCount(2);
  await openParameters(widget);
  await widget.getByLabel('Return window').selectOption('common');
  await expect(widget.getByLabel('End date')).toHaveValue('2026-01-21');
  await apply(widget).click();
  await expect(widget).toContainText('Common inclusive bounds 2026-01-01 to 2026-01-21');
  await saveWorkspace(page);
  await expect(page.getByText(/export refused.*MISSING_LOCAL_ASSET/i)).toBeVisible();

  await chooseReturnSource(page, placeholder);
  await card(page, sampleName).getByRole('button', { name: 'Remove card', exact: true }).click();
  await expect(card(page, sampleName)).toHaveCount(0);
  await saveWorkspace(page);
  const path = 'exports/' + workspace + '.apps.json';
  await expect.poll(() => read(page, path)).toBeDefined();
  const text = (await read(page, path))!;
  expect(text).not.toMatch(/returnSummary|viewportHeight|acquiredRowCount|receipt|observed-prices|commonWindow/);
  expect(JSON.parse(text)[0].extensions.bdobb.cards[0].extras.linkedChart.recipe).toEqual({
    ...returnRecipe, window: { mode: 'common', start: '2026-01-01', end: '2026-01-21' },
  });
  const fresh = await context.newPage();
  const appOrigin = new URL(baseURL!).origin;
  const dataRequests: string[] = [];
  fresh.on('request', request => {
    const url = new URL(request.url());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    const appAsset = url.origin === appOrigin && /\/pivot_wasm_bg(?:-[\w-]+)?\.wasm$/.test(url.pathname);
    if (!appAsset && (url.origin !== appOrigin || url.pathname.startsWith('/api/')
      || ['xhr', 'fetch'].includes(request.resourceType()))) dataRequests.push(request.method() + ' ' + request.url());
  });
  await seedApp(fresh, { ...dashboardSeed([]), 'backends.json': '[]' });
  await dropFile(fresh, 'saved.apps.json', text);
  await fresh.getByRole('tab', { name: 'Returns', exact: true }).last().click();
  const reopened = card(fresh, returnChart), graph = plot(fresh, returnChart);
  await expect(graph).toHaveCount(0);
  await openParameters(reopened);
  await expect(reopened.getByLabel('End date')).toHaveValue('2026-01-21');
  const shorter = returnSnapshot({ 'ZZZ.US': closes(.125).slice(5), 'AAA.US': closes(.0625).slice(5) });
  const replacement = JSON.stringify({ ...JSON.parse(shorter), receipt: { interval: '1d', start_date: '2026-01-01', end_date: '2026-01-16' } });
  await dropFile(fresh, 'shorter.json', replacement);
  await chooseReturnSource(fresh, 'shorter.json');
  await expect(reopened).toContainText(/inclusive common window within the acquired daily date bounds/);
  await expect(graph).toHaveCount(0);
  await expect(apply(reopened)).toBeDisabled();
  await openParameters(reopened);
  await expect(reopened.getByLabel('End date')).toHaveValue('2026-01-21');
  await reopened.getByLabel('End date').fill('2026-01-16');
  await expect(apply(reopened)).toBeEnabled();
  await apply(reopened).click();
  await expect(boxes(graph)).toHaveCount(2);
  await expect(graph.locator('.xtick text')).toHaveText([/ZZZ\.US.*N = 15/, /AAA\.US.*N = 15/]);
  expect(dataRequests).toEqual([]);
});
