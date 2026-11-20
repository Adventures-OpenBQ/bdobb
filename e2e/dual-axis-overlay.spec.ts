// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Locator, type Page } from '@playwright/test';
import { openRail, read } from './fixtures';
import { card, plot, captureParameters, openParameters } from './fixtures/chart-recipes';
import { dropFile } from './fixtures/return-summary';
import {
  attachOverlay, chartName, chooseOverlaySource, dataRequests, macroRecipe, placeholder,
  prepared, priceRecipe, sampleName, seedOverlay, tab, workspace,
} from './fixtures/dual-axis-overlay';

const apply = (widget: Locator) => widget.getByRole('button', { name: 'Apply chart settings' });
const details = (widget: Locator) => widget.getByText('Overlay observations', { exact: true });
const hover = (graph: Locator) => graph.locator('.hoverlayer');
const marker = (graph: Locator, side: number, index = 0) => graph.locator('.scatterlayer .trace').nth(side).locator('.point').nth(index);
type Axis = { range: [string | number, string | number]; _rangeInitial0: string | number; _rangeInitial1: string | number };
type Graph = HTMLElement & { _fullLayout: Record<'xaxis' | 'yaxis' | 'yaxis2', Axis>
  & { width: number; height: number; uirevision: string; paper_bgcolor: string } };

async function drawing(graph: Locator) {
  return graph.evaluate(node => {
    const layout = (node as Graph)._fullLayout;
    const { width, height } = node.getBoundingClientRect();
    const axes = [layout.xaxis, layout.yaxis, layout.yaxis2];
    return { ranges: axes.map(axis => axis.range), defaults: axes.map(axis => [axis._rangeInitial0, axis._rangeInitial1]),
      size: [layout.width, layout.height], surface: [Math.round(width), Math.round(height)],
      revision: layout.uirevision, paper: layout.paper_bgcolor };
  });
}

async function point(locator: Locator) {
  const bounds = (await locator.boundingBox())!;
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
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

async function exportOverlay(page: Page) {
  await openRail(page);
  await page.locator('nav.left-rail').getByRole('button', { name: workspace, exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Save…' }).click();
  await page.getByRole('menuitem', { name: 'BDOBB Workspace', exact: true }).click();
}

test('offers the two closed recipes and shows both currency axes and original report facts', async ({ page, baseURL }, info) => {
  await page.setViewportSize({ width: 1120, height: 1050 });
  await page.emulateMedia({ colorScheme: 'light' });
  const requests = dataRequests(page, baseURL!);
  await seedOverlay(page);
  const widget = card(page, chartName), graph = plot(page, chartName);
  await expect(widget.getByLabel('Chart type')).toBeHidden();
  await openParameters(widget);
  await widget.getByLabel('Chart type').selectOption({ label: 'Dual-axis overlay' });
  const recipe = widget.getByLabel('Overlay recipe');
  await expect(recipe.locator('option')).toHaveText(['Adjusted closing price and reported diluted EPS', 'CPI and ten-year Treasury yield']);
  await expect(apply(widget)).toBeDisabled();
  await attachOverlay(page, prepared['price-eps']);
  await openParameters(widget);
  await widget.getByLabel('Chart type').selectOption({ label: 'Dual-axis overlay' });
  await expect(recipe).toHaveValue('price-eps');
  await expect(widget.getByRole('combobox', { name: 'Value', exact: true }).locator('option')).toHaveText(['Choose field', 'value']);
  await expect(apply(widget)).toBeEnabled();
  await apply(widget).click();
  await expect(graph.locator('.ytitle')).toHaveText('Adjusted close (USD/share)');
  await expect(graph.locator('.y2title')).toHaveText('Diluted FQ EPS (USD/share)');
  const eps = await point(marker(graph, 1));
  await page.mouse.move(eps.x, eps.y);
  await expect(hover(graph)).toContainText('1.98765 USD/share');
  await expect(hover(graph)).toContainText('Fiscal quarter: 2026-07-01 to 2026-09-30');
  await expect(hover(graph)).toContainText('2026-11-02T21:02:01.123456Z');
  await expect(hover(graph)).toContainText('after-market');
  await expect(hover(graph)).toContainText('sample/earnings-release');
  await widget.screenshot({ path: info.outputPath('overlay-light.png') });
  await details(widget).focus();
  await page.keyboard.press('Enter');
  await expect(widget.getByRole('list', { name: 'Adjusted close original observations' })).toContainText('302.0205 USD/share');
  await expect(widget.getByRole('list', { name: 'Diluted FQ EPS original observations' })).toContainText('currently restated');
  await openParameters(widget);
  await recipe.selectOption('cpi-ten-year');
  await expect(widget.getByText(/recipe certified by this prepared snapshot/i)).toBeVisible();
  await expect(apply(widget)).toBeDisabled();
  await expect(graph.locator('.y2title')).toHaveText('Diluted FQ EPS (USD/share)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => graph.evaluate(node => {
    const plot = node as HTMLElement & { _fullLayout?: { paper_bgcolor: string } };
    return plot.isConnected ? plot._fullLayout?.paper_bgcolor : undefined;
  })).toBe('#1e242e');
  await widget.screenshot({ path: info.outputPath('overlay-dark.png') });
  expect(requests).toEqual([]);
});

test('carries real x and both y zooms across updated default ranges and resets to the new endpoints', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 1050 });
  await seedOverlay(page, macroRecipe);
  const macro = structuredClone(prepared['cpi-ten-year']);
  await attachOverlay(page, macro);
  const widget = card(page, chartName), graph = plot(page, chartName);
  await expect(graph.locator('.y2title')).toHaveText('10-year yield (%)');
  await expect(graph.locator('.ytitle')).toHaveText('US CPI-U (1982–84 = 100)');
  const before = await drawing(graph);
  const cpi = await point(marker(graph, 0, 1));
  await page.mouse.move(cpi.x, cpi.y);
  await expect(hover(graph)).toContainText('Measurement month: 2026-10');
  await expect(hover(graph)).toContainText('Available: 2026-11-10');
  const yieldPoint = await point(marker(graph, 1));
  await page.mouse.move(yieldPoint.x, yieldPoint.y);
  await expect(hover(graph)).toContainText('5.12% (original fraction 0.0512)');
  const box = (await graph.locator('.nsewdrag').boundingBox())!;
  await page.mouse.move(box.x + box.width * .34, box.y + box.height * .29);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .67, box.y + box.height * .71, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await drawing(graph)).ranges.filter((range, i) =>
    JSON.stringify(range) !== JSON.stringify(before.ranges[i])).length).toBe(3);
  const zoomed = await drawing(graph);
  await expect(graph.locator('.y2tick text').first()).toContainText('%');
  const source = card(page, sampleName);
  const dashboard = JSON.parse((await read(page, 'dashboards/d1.json'))!);
  const storedFile: string = dashboard.tabs[0].cards.find((card: { title: string }) => card.title === sampleName).params.file;
  macro.rows[0].date = macro.chart_sources.receipts[0].coordinates.left[0] = '2025-09-01';
  macro.rows[0].value = macro.rows[0].source_value = 321.25;
  macro.rows[4].source_value = 3.125;
  macro.rows[4].value = .03125;
  // Change the existing acquired file, then drive the actual user refresh.
  const browserFs = '/src/browser-shim/fs.ts';
  await page.evaluate(async ({ entry, content, path }) => {
    const fs = await import(entry) as typeof import('../src/browser-shim/fs');
    await fs.writeFile(path, new TextEncoder().encode(content));
  }, { entry: browserFs, content: JSON.stringify(macro), path: 'files/' + storedFile });
  await source.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(widget.getByText(/Acquired coordinates: 2025-09-01 to 2026-10-01/)).toBeVisible();
  await expect.poll(async () => (await drawing(graph)).ranges).toEqual(zoomed.ranges);
  const refreshed = await drawing(graph);
  expect(refreshed.revision).toBe(before.revision);
  expect(refreshed.defaults[0]).not.toEqual(before.defaults[0]);
  expect(refreshed.defaults[1]).not.toEqual(before.defaults[1]);
  expect(refreshed.defaults[2]).not.toEqual(before.defaults[2]);
  await page.setViewportSize({ width: 950, height: 1020 });
  await expect.poll(async () => (await drawing(graph)).size[0]).toBeLessThan(refreshed.size[0]);
  await expect.poll(async () => (await drawing(graph)).ranges).toEqual(zoomed.ranges);
  const drag = graph.locator('.nsewdrag');
  await drag.dblclick();
  await expect.poll(async () => (await drawing(graph)).ranges).toEqual(refreshed.defaults);
  await details(widget).click();
  await expect(widget.getByRole('list', { name: '10-year yield original observations' })).toContainText('2026-11-17');
  await expect(widget.getByRole('list', { name: '10-year yield original observations' })).toContainText('Explicit missing observation');
  await source.getByRole('button', { name: 'Filter rows' }).click();
  const from = source.getByRole('textbox', { name: 'From date', exact: true });
  await from.fill('2026-01-01');
  await from.press('Tab');
  await expect(widget.getByText(/traced excluded coordinates remain gaps/i)).toBeVisible();
  await expect(graph.locator('.y2title')).toHaveText('10-year yield (%)');
  const filtered = await drawing(graph);
  expect(filtered.ranges).toEqual(filtered.defaults);
  if (!await widget.getByRole('list', { name: 'US CPI-U original observations' }).isVisible()) await details(widget).click();
  await expect(widget.getByRole('list', { name: 'US CPI-U original observations' })).toContainText('Omitted from the presentation');
  await attachOverlay(page, prepared['price-eps'], 'price-eps.json');
  await expect(graph).toHaveCount(0);
  await openParameters(widget);
  await widget.getByLabel('Overlay recipe').selectOption('price-eps');
  await expect(apply(widget)).toBeEnabled();
  await apply(widget).click();
  await expect(graph.locator('.y2title')).toHaveText('Diluted FQ EPS (USD/share)');
  const changed = await drawing(graph);
  expect(changed.revision).not.toBe(before.revision);
  expect(changed.ranges).toEqual(changed.defaults);
});

test('inspects on touch, zooms in a fitting card and scrolls an actual narrow overflow surface', async ({ browser, baseURL }, info) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, colorScheme: 'dark', baseURL,
    viewport: { width: 680, height: 1050 } });
  try {
    const page = await context.newPage();
    const requests = dataRequests(page, baseURL!);
    await seedOverlay(page, priceRecipe);
    await attachOverlay(page, prepared['price-eps']);
    const widget = card(page, chartName), graph = plot(page, chartName);
    await expect(graph.locator('.y2title')).toHaveText('Diluted FQ EPS (USD/share)');
    await captureParameters(widget, 'Overlay recipe', file => info.outputPath(file));
    await widget.getByRole('button', { name: 'Show parameters' }).tap();
    await expect(widget.getByRole('region', { name: 'Parameters' })).toBeVisible();
    await widget.getByRole('button', { name: 'Hide parameters' }).tap();
    const view = widget.locator('.linked-chart-plot--overlay .chart-scroll-viewport');
    await expect(view).not.toHaveClass(/touch-scroll/);
    const eps = await point(marker(graph, 1));
    await page.touchscreen.tap(eps.x, eps.y);
    await expect(hover(graph)).toContainText('1.98765 USD/share');
    await widget.screenshot({ path: info.outputPath('overlay-touch.png') });
    const before = await drawing(graph);
    const box = (await graph.locator('.nsewdrag').boundingBox())!;
    await touchDrag(page, { x: box.x + box.width * .38, y: box.y + box.height * .4 },
      { x: box.x + box.width * .66, y: box.y + box.height * .63 });
    await expect.poll(async () => (await drawing(graph)).ranges).not.toEqual(before.ranges);
    const zoomed = await drawing(graph);
    await page.setViewportSize({ width: 295, height: 1000 });
    await expect(view).toHaveClass(/touch-scroll/);
    await expect.poll(async () => (await drawing(graph)).size[0]).toBe(320);
    const narrow = await drawing(graph);
    expect(narrow.size).toEqual(narrow.surface);
    expect(narrow.size[1]).toBeGreaterThanOrEqual(210);
    expect(narrow.ranges).toEqual(zoomed.ranges);
    await view.scrollIntoViewIfNeeded();
    const narrowBox = (await view.boundingBox())!;
    await touchDrag(page, { x: narrowBox.x + narrowBox.width * .82, y: narrowBox.y + narrowBox.height / 2 },
      { x: narrowBox.x + narrowBox.width * .25, y: narrowBox.y + narrowBox.height / 2 });
    await expect.poll(() => view.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
    await expect(graph.locator('.y2title')).toBeVisible();
    await widget.screenshot({ path: info.outputPath('overlay-dark-narrow.png') });
    expect(requests).toEqual([]);
  } finally { await context.close(); }
});

test('relabels the actual right axis in scientific percent after a tight zoom', async ({ page }, info) => {
  await page.setViewportSize({ width: 1060, height: 1000 });
  await seedOverlay(page, macroRecipe);
  const macro = structuredClone(prepared['cpi-ten-year']);
  macro.rows[2].source_value = .00000224;
  macro.rows[2].value = 2.24e-8;
  macro.rows[4].source_value = .0000019;
  macro.rows[4].value = 1.9e-8;
  await attachOverlay(page, macro);
  const graph = plot(page, chartName);
  const ticks = graph.locator('.y2tick text');
  await expect(ticks).toHaveCount(5);
  const defaults = await ticks.allTextContents();
  expect(defaults.every(label => /E-6%$/.test(label))).toBe(true);
  const box = (await graph.locator('.nsewdrag').boundingBox())!;
  await page.mouse.move(box.x + box.width * .25, box.y + box.height * .36);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .75, box.y + box.height * .47, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => ticks.allTextContents()).not.toEqual(defaults);
  await expect(ticks).toHaveCount(5);
  const zoomed = await ticks.allTextContents();
  expect(new Set(zoomed).size).toBe(5);
  expect(zoomed.every(label => /E-6%$/.test(label))).toBe(true);
  await expect(graph.locator('.y2title')).toHaveText('10-year yield (%)');
  await card(page, chartName).screenshot({ path: info.outputPath('overlay-scientific-ticks.png') });
});

test('keeps the attached File export guard and reacquires valid evidence in a fresh page', async ({ page, context, baseURL }) => {
  const requests = dataRequests(page, baseURL!);
  await seedOverlay(page, macroRecipe);
  await attachOverlay(page, prepared['cpi-ten-year']);
  await expect(plot(page, chartName).locator('.y2title')).toHaveText('10-year yield (%)');
  await exportOverlay(page);
  await expect(page.getByText(/export refused.*MISSING_LOCAL_ASSET/i)).toBeVisible();
  const path = 'exports/' + workspace + '.apps.json';
  expect(await read(page, path)).toBeUndefined();
  await chooseOverlaySource(page, placeholder);
  await card(page, sampleName).getByRole('button', { name: 'Remove card', exact: true }).click();
  await expect(card(page, sampleName)).toHaveCount(0);
  await exportOverlay(page);
  await expect.poll(() => read(page, path)).toBeDefined();
  const text = (await read(page, path))!;
  expect(JSON.parse(text)[0].extensions.bdobb.cards[0].extras.linkedChart.recipe).toEqual(macroRecipe);
  expect(text).not.toMatch(/chart_sources|viewport|source_value|sample\/prepared|336\.298/);

  const fresh = await context.newPage();
  const reacquired = dataRequests(fresh, baseURL!);
  await seedOverlay(fresh, undefined, true);
  await dropFile(fresh, 'overlay.apps.json', text);
  await fresh.getByRole('tab', { name: tab, exact: true }).click();
  const widget = card(fresh, chartName), graph = plot(fresh, chartName);
  await expect(graph).toHaveCount(0);
  await attachOverlay(fresh, prepared['cpi-ten-year'].rows, 'uncertified.json');
  await expect(widget.getByText(/Acquire an explicitly prepared overlay snapshot/i)).toBeVisible();
  await openParameters(widget);
  await expect(apply(widget)).toBeDisabled();
  await expect(graph).toHaveCount(0);
  await attachOverlay(fresh, prepared['cpi-ten-year']);
  await expect(graph.locator('.y2title')).toHaveText('10-year yield (%)');
  await expect(widget.getByText(/CPI publication timing is unknown/i)).toBeVisible();
  expect(requests).toEqual([]);
  expect(reacquired).toEqual([]);
  await fresh.close();
});
