// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Locator, type Page } from '@playwright/test';
import { openRail, read } from './fixtures';
import { card, plot, captureParameters, openParameters, refuseQueuedChartApplyAfterResize } from './fixtures/chart-recipes';
import { importNews, newsChart, newsManifest, newsPayload, newsTable, newsWorkspace } from './fixtures/news-calendar';

type Axis = { _offset: number; range: number[]; c2p: (coordinate: number) => number };
type Graph = HTMLElement & { _fullLayout: { xaxis: Axis; yaxis: Axis; uirevision: string; width: number } };
const tip = (graph: Locator) => graph.locator('.hoverlayer');
const ready = (graph: Locator) => expect(graph.locator('.heatmaplayer .hm image').first()).toBeVisible();
const apply = (widget: Locator) => widget.getByRole('button', { name: 'Apply chart settings' });
const refresh = (page: Page) => card(page, newsTable).getByRole('button', { name: 'Refresh' }).click();

async function point(graph: Locator, week: number, weekday: number) {
  return graph.evaluate((node, [x, y]) => {
    const { xaxis, yaxis } = (node as Graph)._fullLayout;
    const bounds = node.getBoundingClientRect();
    return { x: bounds.x + xaxis._offset + xaxis.c2p(x), y: bounds.y + yaxis._offset + yaxis.c2p(y) };
  }, [week, weekday]);
}

async function checkTextContrast(text: Locator) {
  const contrast = await text.evaluate(el => {
    const rgb = (value: string) => [...value.matchAll(/[\d.]+/g)].map(match => Number(match[0]));
    const luminance = (channels: number[]) => channels.slice(0, 3).reduce((sum, value, index) => {
      const srgb = value / 255;
      return sum + [0.2126, 0.7152, 0.0722][index] * (srgb <= .04045 ? srgb / 12.92 : ((srgb + .055) / 1.055) ** 2.4);
    }, 0);
    const style = getComputedStyle(el);
    const hoverBox = el.closest('.hovertext')?.querySelector('path');
    const paper = el.closest('.svg-container')?.querySelector('.main-svg');
    if (!paper) throw new Error('No rendered Plotly paper');
    const background = hoverBox ? getComputedStyle(hoverBox).fill : getComputedStyle(paper).backgroundColor;
    const values = [luminance(rgb(style.fill)), luminance(rgb(background))].sort((a, b) => b - a);
    return (values[0] + .05) / (values[1] + .05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
}

test('shows the acquired page, original cell values and keyboard details without another source request', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 950 });
  const acquisitions = await importNews(page);
  const widget = card(page, newsChart);
  const graph = plot(page, newsChart);
  await ready(graph);
  const initiallyAcquired = acquisitions.length;
  expect(initiallyAcquired).toBeGreaterThan(0);
  await captureParameters(widget, 'Acquired instrument', file => info.outputPath(file));
  await expect(widget.getByLabel('Chart type')).toBeHidden();
  await expect(widget.getByLabel('Acquired instrument')).toBeHidden();
  await widget.getByRole('button', { name: 'Show parameters' }).click();
  const parameters = widget.getByRole('region', { name: 'Parameters' });
  await expect(parameters.getByRole('button', { name: 'Choose source' })).toBeFocused();
  await expect(parameters.getByLabel('Chart type')).toHaveValue('news-sentiment-calendar');
  await expect(parameters.getByRole('group', { name: 'Article fields' })).toBeVisible();
  const revision = await graph.evaluate(node => (node as Graph)._fullLayout.uirevision);
  await expect(widget.getByLabel('Acquired instrument')).toHaveValue('CANOPY.US');
  await expect(widget.getByLabel('Acquired instrument').locator('option')).toHaveCount(1);
  await widget.getByRole('button', { name: 'Hide parameters' }).click();
  await ready(graph);
  await expect(widget).toContainText('5 delivered articles · 4 scored in this calendar view.');
  await expect(widget).toContainText('Acquired page limit 10, offset 0');
  await expect(widget).toContainText('Retrieved 2026-11-19T16:00:00Z');
  for (const [day, label] of [[2, '0.123456789'], [1, 'No scored articles delivered'], [0, 'No delivered articles']] as const) {
    const cell = await point(graph, 52, day);
    await page.mouse.move(cell.x, cell.y);
    await expect(tip(graph)).toContainText(label);
  }
  const original = await point(graph, 52, 2);
  await page.mouse.move(original.x, original.y);
  await expect(tip(graph)).toContainText('2026-11-19T00:30:00+01:00');
  await checkTextContrast(tip(graph).locator('.nums').first());
  await checkTextContrast(graph.locator('.ytick text').first());
  await widget.screenshot({ path: info.outputPath('news-calendar-light-hover.png') });

  const details = widget.getByText('Calendar day details', { exact: true });
  await details.focus();
  await page.keyboard.press('Enter');
  const day = widget.getByRole('combobox', { name: 'Calendar day', exact: true });
  await page.keyboard.press('Tab');
  await expect(day).toBeFocused();
  await expect(day).toHaveValue('2026-11-19');
  await page.keyboard.press('Tab');
  await expect(widget.getByRole('button', { name: 'Previous day' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(day).toHaveValue('2026-11-18');
  await expect(widget.getByRole('list', { name: 'Presented article values' })).toContainText('2026-11-19T00:30:00+01:00 · Polarity 0.123456789');
  await page.keyboard.press('Enter');
  await expect(widget.getByRole('list', { name: 'Presented article values' })).toContainText('Unscored');
  expect(acquisitions).toHaveLength(initiallyAcquired);
  expect(await graph.evaluate(node => (node as Graph)._fullLayout.uirevision)).toBe(revision);
});

test('keeps the applied window through an incompatible draft, then reacquires a pinned export on a new page', async ({ page, context }) => {
  const acquisitions = await importNews(page);
  const widget = card(page, newsChart);
  const graph = plot(page, newsChart);
  await ready(graph);
  const initiallyAcquired = acquisitions.length;
  expect(initiallyAcquired).toBeGreaterThan(0);
  await openParameters(widget);
  const windowMode = widget.getByLabel('Calendar window');
  await windowMode.selectOption('pinned');
  const start = widget.getByLabel('Start date');
  const end = widget.getByLabel('End date');
  await start.fill('2024-01-01');
  const question = await graph.evaluate(node => (node as Graph)._fullLayout.uirevision);
  await widget.getByRole('button', { name: 'Hide parameters' }).click();
  await expect(start).toBeHidden();
  await ready(graph);
  await openParameters(widget);
  await expect(start).toHaveValue('2024-01-01');
  expect(await graph.evaluate(node => (node as Graph)._fullLayout.uirevision)).toBe(question);
  expect(acquisitions).toHaveLength(initiallyAcquired);
  await expect(apply(widget)).toBeDisabled();
  await expect(widget).toContainText('The pinned window is outside the acquired calendar dates.');
  await ready(graph);
  await start.fill('2026-11-15');
  await end.fill('2026-11-18');
  await expect(apply(widget)).toBeEnabled();
  await refuseQueuedChartApplyAfterResize(page, widget, widget.locator('.news-calendar-width-probe'));
  await apply(widget).click();
  await expect(widget).toContainText('Calendar dates 2026-11-15 to 2026-11-18 UTC, inclusive.');
  expect(acquisitions).toHaveLength(initiallyAcquired);

  await openRail(page);
  await page.locator('nav.left-rail').getByRole('button', { name: newsWorkspace, exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Save…' }).click();
  await page.getByRole('menuitem', { name: 'BDOBB Workspace', exact: true }).click();
  const path = 'exports/' + newsWorkspace + '.apps.json';
  await expect.poll(() => read(page, path)).toBeDefined();
  const saved = (await read(page, path))!;
  expect(saved).not.toMatch(/chart_sources|coordinates|daySummaries|viewportWidth|0\.123456789|2026-11-19T16:00:00Z/);
  expect(JSON.parse(saved)[0].extensions.bdobb.cards[0].extras.linkedChart.recipe.window)
    .toEqual({ mode: 'pinned', start: '2026-11-15', end: '2026-11-18' });

  const reopened = await context.newPage();
  const payload = newsPayload();
  const proof = payload.extra.results_metadata.chart_sources.receipts[0];
  proof.retrieved_at = '2026-11-19T17:30:00Z';
  payload.results[3].polarity = -.222222;
  let answer: unknown = payload;
  const requests = await importNews(reopened, saved, () => answer);
  const reopenedWidget = card(reopened, newsChart);
  const reopenedPlot = plot(reopened, newsChart);
  await ready(reopenedPlot);
  await expect(reopenedWidget).toContainText('Retrieved 2026-11-19T17:30:00Z');
  const reopenedAcquisitions = requests.length;
  expect(reopenedAcquisitions).toBeGreaterThan(0);
  expect(Object.fromEntries(requests[0].searchParams)).toMatchObject({
    chart_source: 'true', symbol: 'CANOPY.US', start_date: '2025-11-19', end_date: '2026-11-19', limit: '10', offset: '0',
  });
  const original = await point(reopenedPlot, 1, 2);
  await reopened.mouse.move(original.x, original.y);
  await expect(tip(reopenedPlot)).toContainText('Mean polarity: -0.222222');
  const later = newsPayload();
  const laterProof = later.extra.results_metadata.chart_sources.receipts[0];
  later.results = later.results.slice(-1);
  laterProof.coordinates = laterProof.coordinates.slice(-1);
  laterProof.raw_count = laterProof.normalized_count = laterProof.delivered_count = 1;
  laterProof.diagnostics = [];
  laterProof.scope.offset = 10;
  answer = later;
  const table = card(reopened, newsTable);
  await table.getByRole('button', { name: 'Card menu' }).click();
  await reopened.getByRole('menuitem', { name: 'Parameters', exact: true }).click();
  const offset = table.getByRole('region', { name: 'Parameters' }).getByLabel('Offset', { exact: true });
  await offset.fill('10');
  await offset.press('Tab');
  await expect(reopenedPlot).toHaveCount(0);
  await openParameters(reopenedWidget);
  await expect(reopenedWidget.getByLabel('Start date')).toHaveValue('2026-11-15');
  await expect(apply(reopenedWidget)).toBeDisabled();
  await reopenedWidget.getByLabel('Calendar window').selectOption('latest-12-months');
  await apply(reopenedWidget).click();
  await ready(reopenedPlot);
  await expect(reopenedWidget).toContainText('Calendar dates 2026-11-19 to 2026-11-19 UTC');
  await expect(reopenedWidget).toContainText('Acquired page limit 10, offset 10');
  expect(requests).toHaveLength(reopenedAcquisitions + 1);
  expect(requests.at(-1)?.searchParams.get('offset')).toBe('10');
});

test('clears a chart applied without the receipt and leaves refresh errors with the chart card parent', async ({ page }) => {
  const payload = newsPayload();
  let answer: unknown = { results: payload.results };
  await importNews(page, newsManifest, () => answer);
  const widget = card(page, newsChart);
  const graph = plot(page, newsChart);
  await expect(widget.locator('.card-body')).toContainText('Acquire CompanyNews with verified article identity, dates and polarity evidence.');
  await expect(widget.getByRole('button', { name: 'Open Parameters', exact: true })).toBeVisible();
  await openParameters(widget);
  await expect(apply(widget)).toBeDisabled();
  await expect(graph).toHaveCount(0);
  answer = payload;
  await refresh(page);
  await ready(graph);
  answer = new Error('CompanyNews refresh failed');
  await refresh(page);
  await expect(widget.getByRole('alert')).toHaveCount(1);
  await expect(widget.getByRole('alert')).toContainText(/Source .*: HTTP 500: CompanyNews refresh failed/);
  await expect(widget.getByText('Showing completed data (stale).', { exact: true })).toBeVisible();
  await ready(graph);
  answer = payload;
  await refresh(page);
  await expect(widget.getByRole('alert')).toHaveCount(0);
  await ready(graph);
});

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
  } finally {
    await touch.detach();
  }
}

test('taps and zooms a fitting dark calendar, then retains the question across narrow resize and recovery', async ({ browser, baseURL }, info) => {
  const context = await browser.newContext({ baseURL, hasTouch: true, isMobile: true, viewport: { width: 760, height: 950 } });
  try {
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: 'dark' });
    await importNews(page);
    const widget = card(page, newsChart);
    const graph = plot(page, newsChart);
    const viewport = widget.locator('.chart-scroll-viewport');
    await ready(graph);
    const layout = () => graph.evaluate(node => {
      const { xaxis, uirevision, width } = (node as Graph)._fullLayout;
      return { range: [...xaxis.range], uirevision, width };
    });
    const before = await layout();
    await page.setViewportSize({ width: 390, height: 950 });
    await expect.poll(async () => (await layout()).width).toBeLessThan(before.width);
    await expect.poll(() => graph.evaluate(node => Math.abs((node as Graph)._fullLayout.width - node.clientWidth))).toBeLessThanOrEqual(1);
    await expect(viewport).not.toHaveClass(/--touch-scroll/);
    await expect(graph.locator('.nsewdrag')).toBeVisible();
    const original = await point(graph, 52, 2);
    await page.touchscreen.tap(original.x, original.y);
    await expect(tip(graph)).toContainText('2026-11-19T00:30:00+01:00');
    await expect(tip(graph)).toContainText('0.123456789');
    await checkTextContrast(tip(graph).locator('.nums').first());
    await checkTextContrast(graph.locator('.ytick text').first());
    await widget.screenshot({ path: info.outputPath('news-calendar-dark-narrow-tap.png') });
    const unscored = await point(graph, 52, 1);
    await page.touchscreen.tap(unscored.x, unscored.y);
    await expect(tip(graph)).toContainText('No scored articles delivered');
    const area = (await graph.locator('.nsewdrag').boundingBox())!;
    const originalRange = (await layout()).range;
    await touchDrag(page, { x: area.x + area.width * .18, y: area.y + area.height * .18 },
      { x: area.x + area.width * .80, y: area.y + area.height * .8 });
    await expect.poll(async () => (await layout()).range).not.toEqual(originalRange);
    const zoomed = await layout();
    await page.setViewportSize({ width: 470, height: 950 });
    await expect.poll(async () => (await layout()).width).toBeGreaterThan(zoomed.width);
    await expect.poll(async () => (await layout()).range).toEqual(zoomed.range);
    expect((await layout()).uirevision).toBe(before.uirevision);
    await page.setViewportSize({ width: 240, height: 950 });
    await expect(widget).toContainText('Narrow the calendar window or widen the chart');
    await expect(graph).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 950 });
    await ready(graph);
    expect((await layout()).uirevision).toBe(before.uirevision);
  } finally {
    await context.close();
  }
});

test('lets touch scroll a short calendar and still inspect its cells after moving the viewport', async ({ browser, baseURL }, info) => {
  const context = await browser.newContext({ baseURL, hasTouch: true, isMobile: true, viewport: { width: 390, height: 940 } });
  try {
    const page = await context.newPage();
    const short = JSON.parse(newsManifest);
    short[0].tabs['news-calendar'].layout[0].h = 15;
    await page.emulateMedia({ colorScheme: 'dark' });
    await importNews(page, JSON.stringify(short));
    const widget = card(page, newsChart);
    const graph = plot(page, newsChart);
    const viewport = widget.locator('.chart-scroll-viewport');
    await ready(graph);
    await expect(viewport).toHaveClass(/--touch-scroll/);
    const initial = await viewport.evaluate(node => node.scrollTop);
    const bounds = (await viewport.boundingBox())!;
    const start = { x: bounds.x + bounds.width / 2, y: bounds.y + Math.min(bounds.height - 10, 105) };
    const hitPlot = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('nsewdrag'), start);
    expect(hitPlot).toBe(true);
    const stopped = viewport.evaluate(node => new Promise<void>(resolve => {
      node.addEventListener('scrollend', () => resolve(), { once: true });
    }));
    await touchDrag(page, start, { x: start.x, y: start.y - 85 });
    await stopped;
    await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBeGreaterThan(initial + 20);
    const neutral = await point(graph, 51, 6);
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('nsewdrag'), neutral)).toBe(true);
    await page.touchscreen.tap(neutral.x, neutral.y);
    await expect(tip(graph)).toContainText('2026-11-15T03:00:00Z');
    await expect(tip(graph)).toContainText('Mean polarity: 0');
    await checkTextContrast(tip(graph).locator('.nums').first());
    await widget.screenshot({ path: info.outputPath('news-calendar-dark-touch-scroll.png') });
  } finally {
    await context.close();
  }
});

function pinnedNews(start: string, end: string) {
  const manifest = JSON.parse(newsManifest);
  manifest[0].extensions.bdobb.cards[0].extras.linkedChart.recipe.window = { mode: 'pinned', start, end };
  return JSON.stringify(manifest);
}

async function expectDraftRefused(page: Page, reason: string, savedWindow: string, end: string) {
  const widget = card(page, newsChart);
  const graph = plot(page, newsChart);
  await ready(graph);
  await openParameters(widget);
  await expect(apply(widget)).toBeEnabled();
  const revision = await graph.evaluate(node => (node as Graph)._fullLayout.uirevision);
  await expect.poll(() => widget.evaluate(node => node.querySelector('.news-calendar-width-probe')!.clientWidth
    - node.querySelector('.chart-scroll-viewport')!.clientWidth)).toBe(0);
  const details = widget.getByText('Calendar day details', { exact: true });
  await details.click();
  const day = widget.getByRole('combobox', { name: 'Calendar day', exact: true });
  await expect(day).toHaveValue(end);
  const window = widget.getByLabel('Calendar window');
  await window.selectOption('latest-12-months');
  await expect(apply(widget)).toBeDisabled();
  await expect(widget).toContainText(reason);
  await expect(widget).toContainText(savedWindow);
  await expect(day).toHaveValue(end);
  expect(await graph.evaluate(node => (node as Graph)._fullLayout.uirevision)).toBe(revision);

  // Returning to the valid dates should recover Apply without closing details
  // or fetching a different source page.
  await window.selectOption('pinned');
  await expect(apply(widget)).toBeEnabled();
  await expect(widget).not.toContainText(reason);
  await expect(widget).toContainText(savedWindow);
  await expect(day).toHaveValue(end);
  expect(await graph.evaluate(node => (node as Graph)._fullLayout.uirevision)).toBe(revision);
}

test('a narrow calendar keeps its fitting applied pin while a draft exceeds the measured width', async ({ page }) => {
  await page.setViewportSize({ width: 240, height: 950 });
  const acquisitions = await importNews(page, pinnedNews('2026-11-15', '2026-11-19'));
  await ready(plot(page, newsChart));
  const requests = acquisitions.length;
  await expectDraftRefused(page, 'Narrow the calendar window or widen the chart',
    'Calendar dates 2026-11-15 to 2026-11-19 UTC, inclusive.', '2026-11-19');
  expect(acquisitions).toHaveLength(requests);
});

test('a draft with an unrepresentable mean preserves the applied pin and its day details', async ({ page }) => {
  const payload = newsPayload();
  payload.results[4].polarity = Number.MIN_VALUE;
  const extra = { ...payload.results[4], url: 'https://example.com/canopy/extra', polarity: 0 };
  payload.results.push(extra);
  const receipt = payload.extra.results_metadata.chart_sources.receipts[0];
  receipt.coordinates.push({ article_id: extra.url, utc_day: '2026-11-19', scored: true });
  receipt.raw_count = receipt.normalized_count = receipt.delivered_count = 6;
  const acquisitions = await importNews(page, pinnedNews('2026-11-15', '2026-11-18'), () => payload);
  await ready(plot(page, newsChart));
  const requests = acquisitions.length;
  await expectDraftRefused(page, 'The mean for 2026-11-19 cannot be represented at chart polarity precision.',
    'Calendar dates 2026-11-15 to 2026-11-18 UTC, inclusive.', '2026-11-18');
  expect(acquisitions).toHaveLength(requests);
});
