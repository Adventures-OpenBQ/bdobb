// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Locator, type Page } from '@playwright/test';
import { openRail, read } from './fixtures';
import { card, plot } from './fixtures/chart-recipes';
import { dropFile } from './fixtures/return-summary';
import {
  attachPartition, backendOrigin, backendPath, backendPayload, backendTable, bars, chartName, chooseOwnershipSource,
  partition, placeholder, prepareOwnership, sampleName, tab, waffle, workspace,
} from './fixtures/ownership-snapshot';

type Axis = { _offset: number; range: number[]; c2p: (coordinate: number) => number };
type Graph = HTMLElement & { _fullLayout: { xaxis: Axis; yaxis: Axis; width: number; height: number; uirevision: string; dragmode: string | false } };
const apply = (widget: Locator) => widget.getByRole('button', { name: 'Apply chart settings' });
const tip = (graph: Locator) => graph.locator('.hoverlayer');
const barsDrawn = (graph: Locator) => graph.locator('.barlayer path');
const cells = (graph: Locator) => graph.locator('.scatterlayer path.point');
const plotViewport = (widget: Locator) => widget.locator('.linked-chart-plot > .chart-scroll-viewport');
const refresh = (page: Page) => card(page, backendTable).getByRole('button', { name: 'Refresh' }).click();

function drawing(graph: Locator) {
  return graph.evaluate(node => {
    const { width, height, uirevision, xaxis, yaxis } = (node as Graph)._fullLayout;
    const probe = node.closest('.linked-chart-renderer')?.querySelector('.ownership-draft-probe .chart-plot')?.getBoundingClientRect();
    const canvas = node.getBoundingClientRect();
    return { width, height, uirevision, x: [...xaxis.range], y: [...yaxis.range],
      probe: [probe?.width, probe?.height], canvas: [canvas.width, canvas.height] };
  });
}

function point(graph: Locator, x: number, y: number) {
  return graph.evaluate((node, [x, y]) => {
    const { xaxis, yaxis } = (node as Graph)._fullLayout;
    const bounds = node.getBoundingClientRect();
    return { x: bounds.x + xaxis._offset + xaxis.c2p(x), y: bounds.y + yaxis._offset + yaxis.c2p(y) };
  }, [x, y]);
}

async function contrast(text: Locator) {
  expect(await text.evaluate(el => {
    const luma = (rgb: string) => [...rgb.matchAll(/[\d.]+/g)].slice(0, 3).reduce((sum, match, index) => {
      const value = Number(match[0]) / 255;
      return sum + [0.2126, 0.7152, 0.0722][index] * (value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    }, 0);
    const hover = el.closest('.hovertext')?.querySelector('path');
    const paper = el.closest('.svg-container')?.querySelector('.main-svg');
    if (!paper) throw new Error('No rendered Plotly paper');
    const background = hover ? getComputedStyle(hover).fill : getComputedStyle(paper).backgroundColor;
    const colors = [luma(background), luma(getComputedStyle(el).fill)].sort((a, b) => b - a);
    return (colors[0] + .05) / (colors[1] + .05);
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

async function dragZoom(graph: Locator, page: Page) {
  const area = (await graph.locator('.nsewdrag').boundingBox())!;
  await touchDrag(page, { x: area.x + area.width * .15, y: area.y + area.height * .2 },
    { x: area.x + area.width * .82, y: area.y + area.height * .78 });
}

async function saveWorkspace(page: Page) {
  await openRail(page);
  await page.locator('nav.left-rail').getByRole('button', { name: workspace, exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Save…' }).click();
  await page.getByRole('menuitem', { name: 'BDOBB Workspace', exact: true }).click();
}

function trackDataRequests(page: Page, appURL: string) {
  const app = new URL(appURL).origin;
  const requests: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol)) return;
    const appAsset = url.origin === app && /\/pivot_wasm_bg(?:-[\w-]+)?\.wasm$/.test(url.pathname);
    if (!appAsset && (url.origin !== app || url.pathname.startsWith('/api/') ||
      ['xhr', 'fetch'].includes(request.resourceType()))) requests.push(request.method() + ' ' + request.url());
  });
  return requests;
}

async function reopen(page: Page, text: string) {
  await dropFile(page, 'ownership.apps.json', text);
  await page.getByRole('tab', { name: tab, exact: true }).last().click();
}

test('defaults to independently labeled bars and exports a backend question that reacquires on a new page', async ({ page, context, baseURL }, info) => {
  await page.setViewportSize({ width: 1250, height: 930 });
  await page.emulateMedia({ colorScheme: 'light' });
  const acquisitions = await prepareOwnership(page, { source: 'backend' });
  const widget = card(page, chartName), graph = plot(page, chartName);
  await expect(barsDrawn(graph)).toHaveCount(1);
  const initialRequests = acquisitions.length;
  expect(initialRequests).toBeGreaterThan(0);
  await widget.getByLabel('Chart type').selectOption('ownership-snapshot');
  await expect(widget.getByLabel('Ownership view')).toHaveValue('bars');
  await expect(widget.getByRole('option', { name: 'Waffle' })).toHaveAttribute('disabled', '');
  await expect(widget).toContainText(/acquire a certified partition.*waffle/i);
  await expect(widget.getByLabel('Acquired issuer')).toHaveValue('AAPL.US');
  await expect(widget.getByLabel('Insider ownership')).toHaveValue('percent_insiders');
  await expect(widget.getByLabel('Institutional ownership')).toHaveValue('percent_institutions');
  await expect(widget.getByLabel('Free float')).toHaveCount(0);
  await apply(widget).click();
  await expect(barsDrawn(graph)).toHaveCount(2);
  await expect(graph.locator('.ytick text')).toHaveText([/Insider ownership/, /Institutional\s*ownership/, /Free float.*Unavailable/]);
  const actual = await drawing(graph);
  expect(actual.probe).toEqual(actual.canvas);
  expect(actual.width).toBeCloseTo(actual.canvas[0], 0);
  expect(actual.height).toBeCloseTo(actual.canvas[1], 0);
  const insider = await point(graph, .01, 0);
  await page.mouse.move(insider.x, insider.y);
  await expect(tip(graph)).toContainText('1.687 percent-points');
  await expect(tip(graph)).toContainText('As of unknown');
  await expect(tip(graph)).toContainText('Retrieved 2026-11-20T04:16:46Z');
  await contrast(tip(graph).locator('.nums').first());
  await contrast(graph.locator('.ytick text').first());
  await widget.screenshot({ path: info.outputPath('ownership-bars-light.png') });
  const details = widget.getByText('Ownership snapshot details', { exact: true });
  await details.focus();
  await page.keyboard.press('Enter');
  const values = widget.getByRole('list', { name: 'Original ownership measures' });
  await expect(values).toContainText('66.375 percent-points');
  await expect(values).toContainText('Free float');
  await expect(widget).toContainText('Share class unknown');
  expect(acquisitions).toHaveLength(initialRequests);

  await saveWorkspace(page);
  const path = 'exports/' + workspace + '.apps.json';
  await expect.poll(() => read(page, path)).toBeDefined();
  const text = (await read(page, path))!;
  expect(text).not.toMatch(/chart_sources|ownershipSnapshot|viewportWidth|retrieved_at|66\.375|2026-11-20T04:16:46Z/);
  expect(JSON.parse(text)[0].extensions.bdobb.cards[0].extras.linkedChart.recipe).toEqual(bars);
  const fresh = await context.newPage();
  const requests = trackDataRequests(fresh, baseURL!);
  const newer = backendPayload();
  newer.results[0].percent_insiders = 2.875;
  newer.extra.results_metadata.chart_sources.receipts[0].retrieved_at = '2026-11-20T05:16:46Z';
  const fetched = await prepareOwnership(fresh, { source: 'backend', empty: true, response: () => newer });
  await reopen(fresh, text);
  const restored = card(fresh, chartName);
  await expect(barsDrawn(plot(fresh, chartName))).toHaveCount(2);
  await expect(restored).toContainText('Retrieved 2026-11-20T05:16:46Z');
  // The ordinary source card can request its data during startup and table initialization.
  expect(fetched).toHaveLength(initialRequests);
  for (const url of fetched) {
    expect(url.pathname).toBe(backendPath);
    expect(Object.fromEntries(url.searchParams)).toEqual({ chart_source: 'true', symbol: 'AAPL.US' });
  }
  const discovery = new Set(['/', '/apps.json', '/widgets.json'].map(path => 'GET ' + backendOrigin + path));
  expect(requests.filter(request => !discovery.has(request))).toEqual(fetched.map(url => 'GET ' + url.href));
});

test('refuses a remote prepared envelope and preserves one stale parent alert after a failed refresh', async ({ page }) => {
  const proven = backendPayload();
  let answer: unknown = partition('AAPL.US');
  await prepareOwnership(page, { source: 'backend', options: bars, response: () => answer });
  const widget = card(page, chartName), graph = plot(page, chartName);
  await expect(widget).toContainText(/verified field and issuer evidence/i);
  await expect(graph).toHaveCount(0);
  await expect(apply(widget)).toBeDisabled();
  answer = proven;
  await refresh(page);
  await expect(barsDrawn(graph)).toHaveCount(2);
  answer = new Error('Ownership refresh failed');
  await refresh(page);
  await expect(widget.getByRole('alert')).toHaveCount(1);
  await expect(widget.getByRole('alert')).toContainText(/Source .*: HTTP 500: Ownership refresh failed/);
  await expect(widget.getByText('Showing completed data (stale).', { exact: true })).toBeVisible();
  await expect(widget.getByText('Ownership snapshot details', { exact: true })).toBeVisible();
  await expect(barsDrawn(graph)).toHaveCount(2);
  answer = proven;
  await refresh(page);
  await expect(widget.getByRole('alert')).toHaveCount(0);
  await expect(barsDrawn(graph)).toHaveCount(2);
});

test('keeps an applied 100-cell local waffle and exact keyboard values through an incompatible draft', async ({ page }, info) => {
  await page.setViewportSize({ width: 1040, height: 940 });
  await prepareOwnership(page, { options: waffle });
  await attachPartition(page);
  const widget = card(page, chartName), graph = plot(page, chartName);
  await expect(cells(graph)).toHaveCount(100);
  const colors = await cells(graph).evaluateAll(points => {
    const counts = new Map<string, number>();
    for (const cell of points) {
      const fill = getComputedStyle(cell).fill;
      counts.set(fill, (counts.get(fill) ?? 0) + 1);
    }
    return [...counts.values()];
  });
  expect(colors).toEqual([33, 33, 34]);
  const last = await point(graph, 9, 9);
  await page.mouse.move(last.x, last.y);
  await expect(tip(graph)).toContainText('33.39% reported');
  await expect(tip(graph)).toContainText('34 of 100 cells');
  await expect(tip(graph)).toContainText('As of 2026-09-30');
  await contrast(tip(graph).locator('.nums').first());
  await widget.screenshot({ path: info.outputPath('ownership-waffle-light.png') });
  const details = widget.getByText('Ownership snapshot details', { exact: true });
  await details.focus();
  await page.keyboard.press('Enter');
  const values = widget.getByRole('list', { name: 'Original ownership buckets' });
  await expect(values).toContainText('treasury · 0.01% reported · 0 of 100 cells');
  await expect(values).toContainText('employees · 33.3% reported · 33 of 100 cells');
  await expect(widget).toContainText('100 cells at 1% visual granularity');
  await expect(widget).toContainText('Retrieved 2026-11-20T04:16:46Z');
  await widget.getByLabel('Ownership view').selectOption('bars');
  await expect(widget).toContainText(/acquire independent ownership measures for bars/i);
  await expect(apply(widget)).toBeDisabled();
  await expect(cells(graph)).toHaveCount(100);
  await expect(values).toBeVisible();
  await widget.getByLabel('Ownership view').selectOption('waffle');
  await expect(apply(widget)).toBeEnabled();
});

test('taps and zooms fitting dark ownership bars and retains zoom only for the same observation', async ({ browser, baseURL }, info) => {
  const context = await browser.newContext({ baseURL, hasTouch: true, isMobile: true, viewport: { width: 540, height: 950 } });
  try {
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: 'dark' });
    const response = backendPayload();
    await prepareOwnership(page, { source: 'backend', options: bars, response: () => response });
    const widget = card(page, chartName), graph = plot(page, chartName);
    await expect(barsDrawn(graph)).toHaveCount(2);
    await expect(plotViewport(widget)).not.toHaveClass(/--touch-scroll/);
    const original = await point(graph, .3, 1);
    await page.touchscreen.tap(original.x, original.y);
    await expect(tip(graph)).toContainText('66.375 percent-points');
    await contrast(tip(graph).locator('.nums').first());
    await contrast(graph.locator('.ytick text').first());
    await widget.screenshot({ path: info.outputPath('ownership-bars-dark-tap.png') });
    const initial = await drawing(graph);
    await dragZoom(graph, page);
    await expect.poll(async () => (await drawing(graph)).x).not.toEqual(initial.x);
    const zoomed = await drawing(graph);
    await page.setViewportSize({ width: 390, height: 950 });
    await expect.poll(async () => (await drawing(graph)).width).toBeLessThan(zoomed.width);
    await expect.poll(async () => (await drawing(graph)).x).toEqual(zoomed.x);
    expect((await drawing(graph)).uirevision).toBe(initial.uirevision);
    await expect(plotViewport(widget)).not.toHaveClass(/--touch-scroll/);
    await widget.screenshot({ path: info.outputPath('ownership-bars-dark-narrow-zoom.png') });

    await refresh(page);
    await expect.poll(async () => (await drawing(graph)).x).toEqual(zoomed.x);
    response.extra.results_metadata.chart_sources.receipts[0].retrieved_at = '2026-11-20T05:16:46Z';
    await refresh(page);
    await expect(widget).toContainText('Retrieved 2026-11-20T05:16:46Z');
    await expect.poll(async () => (await drawing(graph)).x).toEqual(initial.x);
    expect((await drawing(graph)).uirevision).not.toBe(initial.uirevision);
  } finally { await context.close(); }
});

test('taps and zooms a fitting waffle, then scrolls only when its narrow plot overflows', async ({ browser, baseURL }, info) => {
  const context = await browser.newContext({ baseURL, hasTouch: true, isMobile: true, viewport: { width: 560, height: 960 } });
  try {
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: 'dark' });
    await prepareOwnership(page, { options: waffle });
    await attachPartition(page);
    const widget = card(page, chartName), graph = plot(page, chartName);
    await expect(cells(graph)).toHaveCount(100);
    const initial = await drawing(graph);
    expect(initial.probe).toEqual(initial.canvas);
    await expect(plotViewport(widget)).not.toHaveClass(/--touch-scroll/);
    const original = await point(graph, 2, 2);
    await page.touchscreen.tap(original.x, original.y);
    await expect(tip(graph)).toContainText('33.3% reported');
    await contrast(tip(graph).locator('.nums').first());
    await dragZoom(graph, page);
    await expect.poll(async () => (await drawing(graph)).x).not.toEqual(initial.x);
    const zoomed = await drawing(graph);
    await page.setViewportSize({ width: 410, height: 960 });
    await expect.poll(async () => (await drawing(graph)).width).toBeLessThan(zoomed.width);
    await expect.poll(async () => (await drawing(graph)).x).toEqual(zoomed.x);
    expect((await drawing(graph)).uirevision).toBe(initial.uirevision);
    await expect(cells(graph)).toHaveCount(100);
    await widget.screenshot({ path: info.outputPath('ownership-waffle-dark-narrow-zoom.png') });

    await page.setViewportSize({ width: 280, height: 960 });
    const viewport = plotViewport(widget);
    await expect(viewport).toHaveClass(/--touch-scroll/);
    const overflow = await drawing(graph);
    expect(overflow.probe).toEqual(overflow.canvas);
    await expect.poll(() => graph.evaluate(node => (node as Graph)._fullLayout.dragmode)).toBe(false);
    // Grid width animates after the media resize. Start inside the visible drag area.
    const start = await viewport.evaluate(async node => {
      const animations = node.closest('.react-grid-item')?.getAnimations() ?? [];
      await Promise.allSettled(animations.map(animation => animation.finished));
      const view = node.getBoundingClientRect();
      const drag = node.querySelector('.nsewdrag')!.getBoundingClientRect();
      const left = Math.max(view.left, drag.left);
      const right = Math.min(view.right, drag.right, window.innerWidth);
      return { x: left + (right - left) * .72, y: Math.max(view.top, drag.top) + 50 };
    });
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('nsewdrag'), start)).toBe(true);
    const stopped = viewport.evaluate(node => new Promise<void>(resolve => node.addEventListener('scrollend', () => resolve(), { once: true })));
    await touchDrag(page, start, { x: start.x - 120, y: start.y });
    await expect.poll(() => viewport.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
    await stopped;
    const visible = await graph.evaluate(node => Array.from(node.querySelectorAll('.scatterlayer path.point')).map(marker => {
      const rect = marker.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }).find(({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('nsewdrag')));
    expect(visible).toBeDefined();
    await page.touchscreen.tap(visible!.x, visible!.y);
    await expect(tip(graph)).toContainText(/33\.(3|39)% reported/);
    await widget.screenshot({ path: info.outputPath('ownership-waffle-dark-overflow-tap.png') });
  } finally { await context.close(); }
});

test('refuses attached-file export, then exports and repairs an unavailable issuer after explicit new-page reacquisition', async ({ page, context, baseURL }) => {
  await prepareOwnership(page, { options: waffle });
  await attachPartition(page);
  await expect(cells(plot(page, chartName))).toHaveCount(100);
  await saveWorkspace(page);
  await expect(page.getByText(/export refused.*MISSING_LOCAL_ASSET/i)).toBeVisible();
  await chooseOwnershipSource(page, placeholder);
  await card(page, sampleName).getByRole('button', { name: 'Remove card', exact: true }).click();
  await expect(card(page, sampleName)).toHaveCount(0);
  await saveWorkspace(page);
  const path = 'exports/' + workspace + '.apps.json';
  await expect.poll(() => read(page, path)).toBeDefined();
  const text = (await read(page, path))!;
  expect(text).not.toMatch(/chart_sources|ownershipSnapshot|viewportWidth|retrieved_at|example:ownership-register|2026-09-30/);
  expect(JSON.parse(text)[0].extensions.bdobb.cards[0].extras.linkedChart.recipe).toEqual(waffle);

  const fresh = await context.newPage();
  const requests = trackDataRequests(fresh, baseURL!);
  await prepareOwnership(fresh, { empty: true });
  await reopen(fresh, text);
  const widget = card(fresh, chartName), graph = plot(fresh, chartName);
  await expect(graph).toHaveCount(0);
  await attachPartition(fresh, 'new-ownership-register.json', partition('ANOTHER.US'));
  await expect(widget.getByLabel('Acquired issuer')).toHaveValue('EXAMPLE.US');
  await expect(widget.getByRole('option', { name: 'EXAMPLE.US (unavailable)' })).toHaveAttribute('disabled', '');
  await expect(widget).toContainText(/choose the acquired issuer ANOTHER\.US/i);
  await expect(apply(widget)).toBeDisabled();
  await expect(graph).toHaveCount(0);
  await widget.getByLabel('Acquired issuer').selectOption('ANOTHER.US');
  await apply(widget).click();
  await expect(cells(graph)).toHaveCount(100);
  expect(requests).toEqual([]);
});
