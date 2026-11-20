// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Locator, type Page } from '@playwright/test';
import { openRail, read } from './fixtures';
import { card, plot } from './fixtures/chart-recipes';
import { importScreening, screeningNames, screeningPaths, screeningPayload, screeningSources,
  screeningTab, screeningWorkspace } from './fixtures/screening-income';

const [bubble, dividends, income] = screeningNames;
const [screenSource, dividendSource, incomeSource] = screeningSources;
const [screenPath, dividendPath, incomePath] = screeningPaths;
const apply = (widget: Locator) => widget.getByRole('button', { name: 'Apply chart settings' }).click();
const refresh = (page: Page, source: string) => card(page, source).getByRole('button', { name: 'Refresh', exact: true }).click();
const markers = (graph: Locator) => graph.locator('.scatterlayer .points .point');
const nodes = (graph: Locator) => graph.locator('.sankey-node .node-rect');
const ribbons = (graph: Locator) => graph.locator('.sankey-link');
const tip = (graph: Locator) => graph.locator('.hoverlayer');

type Graph = HTMLElement & {
  _fullData: { name: string; x: (string | number | null)[]; y: (number | null)[] }[];
  _fullLayout: { width: number; paper_bgcolor: string; uirevision: string; dragmode: string | false; xaxis: { range: unknown[] } };
};

test.use({ viewport: { width: 1560, height: 1040 }, actionTimeout: 7000 });
test.beforeEach(() => test.setTimeout(90000));

async function ready(page: Page) {
  await expect(markers(plot(page, bubble))).toHaveCount(4);
  await expect(markers(plot(page, dividends))).toHaveCount(4);
  await expect(nodes(plot(page, income))).toHaveCount(10);
}

async function expectPaintedRibbons(graph: Locator) {
  await expect(ribbons(graph)).toHaveCount(9);
  await expect.poll(() => ribbons(graph).evaluateAll(elements => elements.every(el => {
    const style = getComputedStyle(el);
    const bounds = el.getBoundingClientRect();
    return Number(style.opacity) >= .99 && Number(style.fillOpacity) > 0 && style.fill !== 'none'
      && bounds.width > 0 && bounds.height > 0;
  }))).toBe(true);
}

async function expectScatterLabelsToFit(graph: Locator, showLegend = false) {
  const canvas = (await graph.locator('svg.main-svg').first().boundingBox())!;
  const title = (await graph.locator('.g-gtitle .gtitle').boundingBox())!;
  expect(title.x).toBeGreaterThanOrEqual(canvas.x);
  expect(title.x + title.width).toBeLessThanOrEqual(canvas.x + canvas.width);
  if (showLegend) {
    const axis = (await graph.locator('.xtitle').boundingBox())!;
    const legend = (await graph.locator('.legend').boundingBox())!;
    expect(legend.y).toBeGreaterThanOrEqual(axis.y + axis.height);
    expect(legend.y + legend.height).toBeLessThanOrEqual(canvas.y + canvas.height + 1);
  }
}

async function center(mark: Locator) {
  await mark.scrollIntoViewIfNeeded();
  const rect = (await mark.boundingBox())!;
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

async function hover(page: Page, mark: Locator) {
  const { x, y } = await center(mark);
  await page.mouse.move(x, y);
}

async function expectReadableTooltip(graph: Locator) {
  const rendered = await tip(graph).locator('.hovertext').evaluate(label => {
    const foreground = getComputedStyle(label.querySelector('text.nums')!).fill;
    const path = getComputedStyle(label.querySelector('path')!);
    const rgb = (color: string) => (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const luminance = (channels: number[]) => {
      const linear = channels.map(channel => {
        const srgb = channel / 255;
        return srgb <= .04045 ? srgb / 12.92 : ((srgb + .055) / 1.055) ** 2.4;
      });
      return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
    };
    const text = luminance(rgb(foreground));
    const opacity = Number(path.fillOpacity);
    // Plotly fades the label over the canvas. Black and white bound the
    // luminance of any underlying chart colors, including the ribbons.
    const backgrounds = [0, 255].map(under => luminance(rgb(path.fill)
      .map(channel => channel * opacity + under * (1 - opacity))));
    const lightest = Math.max(...backgrounds), darkest = Math.min(...backgrounds);
    const minimumContrast = text > lightest ? (text + .05) / (lightest + .05)
      : text < darkest ? (darkest + .05) / (text + .05) : 1;
    return { foreground, background: path.fill, opacity, minimumContrast };
  });
  expect.soft(rendered.minimumContrast, JSON.stringify(rendered)).toBeGreaterThanOrEqual(4.5);
}

// For a curved SVG ribbon, the box center can lie outside the actual painted area.
async function ribbonPoint(ribbon: Locator) {
  await ribbon.scrollIntoViewIfNeeded();
  return ribbon.evaluate(el => {
    const { left, right, top, bottom } = el.getBoundingClientRect();
    for (let y = Math.ceil(Math.max(0, top)); y < Math.min(innerHeight, bottom); y += 2) {
      for (let x = Math.ceil(Math.max(0, left)); x < Math.min(innerWidth, right); x += 2) {
        if (document.elementFromPoint(x, y) === el) return { x, y };
      }
    }
    throw new Error('No visible hit point on the requested Sankey link');
  });
}

test('reads delivered scope and original values from rendered bubbles, steps and Sankey geometry in both themes', async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await importScreening(page);
  await ready(page);
  const screen = card(page, bubble);
  await expect(screen).toContainText('7 delivered rows, 7 presented, 4 selected-date, 4 usable');
  await expect(screen).toContainText('offset 0, limit 50 and sort market_capitalization.desc');
  await expect(screen).toContainText('Universe coverage and random sampling are unverified.');
  await expect(screen).toContainText('Acquired filters exchange = us.');
  await expect(screen).toContainText('Price-data date 2026-08-31. Screen retrieved 2026-11-19T16:00:00Z.');
  await expect(screen).toContainText('may have a different measurement date');
  await expect(screen).toContainText('Unweighted OLS, N = 4, R² = 0.609524.');
  const bubbleGraph = plot(page, bubble);
  await expectScatterLabelsToFit(bubbleGraph, true);
  const bubbles = markers(bubbleGraph);
  const biggest = (await bubbles.first().boundingBox())!;
  const quarter = (await bubbles.nth(2).boundingBox())!;
  expect(biggest.width).toBeCloseTo(48, 1);
  expect(quarter.width).toBeCloseTo(24, 1);
  await hover(page, bubbles.first());
  await expect(tip(bubbleGraph)).toContainText(/CEDAR.US.*Cedar Works.*Industrials.*9600000000 USD.*2026-08-31.*4.00%.*7.00%/);
  await bubbleGraph.screenshot({ path: info.outputPath('bubble-hover.png') });

  const div = card(page, dividends);
  const divGraph = plot(page, dividends);
  await expect(div.getByLabel('Acquired instrument')).toHaveValue('CANOPY.US');
  await expect(div).toContainText('CANOPY.US · GBP payment currency · Split-adjusted to current-share terms.');
  await expect(div).toContainText('Verified acquired window 2026-01-01 to 2026-06-30 inclusive.');
  await expect(div).toContainText('4 acquired events, 4 delivered, 4 usable historical');
  await hover(page, markers(divGraph).nth(1));
  await expect(tip(divGraph)).toContainText(/2026-03-17.*Split-adjusted 0.375 GBP per share.*Special/);
  await divGraph.screenshot({ path: info.outputPath('dividend-hover.png') });

  const sunk = card(page, income);
  const sankey = plot(page, income);
  await expect(sunk).toContainText('CANOPY.US · FY 2026 ended 2026-06-30 · USD × 1000');
  await expect(sunk).toContainText('Net operating deductions (derived) -30 USD × 1000');
  await expectPaintedRibbons(sankey);
  await hover(page, nodes(sankey).first());
  await expect(tip(sankey)).toContainText(/Revenue.*Reported 100 USD × 1000/);
  await expectReadableTooltip(sankey);
  const link = await ribbonPoint(ribbons(sankey).nth(1));
  await page.mouse.move(link.x, link.y);
  await expect(tip(sankey)).toContainText(/Cost of revenue.*Reported 40 USD × 1000/);
  await expectReadableTooltip(sankey);

  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.mouse.move(750, 42);
    for (const [index, name] of screeningNames.entries()) {
      await expect.poll(() => plot(page, name).evaluate(el => (el as Graph)._fullLayout.paper_bgcolor))
        .toBe(theme === 'light' ? '#ffffff' : '#1e242e');
      if (name === income) await expectPaintedRibbons(sankey);
      await card(page, name).screenshot({ path: info.outputPath(`${theme}-${index + 1}.png`) });
    }
  }
});

test('keeps hidden screening conflicts and dividend gaps, refuses unknown evidence and repairs the source', async ({ page }, info) => {
  const { overrides } = await importScreening(page);
  await ready(page);
  const source = card(page, screenSource);
  await source.getByRole('button', { name: 'Filter rows' }).click();
  const filter = source.getByLabel('Filter symbol', { exact: true });
  await filter.fill('CEDAR');
  await expect(card(page, bubble)).toContainText('Presentation filter active.');
  await expect(card(page, bubble)).toContainText('7 delivered rows, 1 presented, 1 selected-date, 1 usable');
  await expect(card(page, bubble)).toContainText('Regression withheld');
  const conflict = screeningPayload(screenPath);
  const proof = conflict.extra.results_metadata.chart_evidence;
  conflict.results.push({ ...conflict.results[1], market_cap: 7100000000 });
  proof.raw_count++;
  proof.normalized_count++;
  proof.delivered_count++;
  proof.cohorts[0].raw_count++;
  proof.cohorts[0].conflicting_duplicates = true;
  proof.diagnostics = ['screener_duplicate_conflict'];
  overrides.set(screenPath, conflict);
  await refresh(page, screenSource);
  await expect(card(page, bubble)).toContainText('conflicting duplicate listings');
  await expect(plot(page, bubble)).toHaveCount(0);
  overrides.delete(screenPath);
  await refresh(page, screenSource);
  await expect(markers(plot(page, bubble))).toHaveCount(1);
  await filter.fill('');
  await expect(markers(plot(page, bubble))).toHaveCount(4);

  const divSource = card(page, dividendSource);
  await divSource.getByRole('button', { name: 'Filter rows' }).click();
  const frequency = divSource.getByLabel('Filter frequency', { exact: true });
  await frequency.fill('Quarterly');
  const divGraph = plot(page, dividends);
  await expect(card(page, dividends)).toContainText('3 usable historical, 0 invalid amount, 1 filtered or omitted');
  await expect(markers(divGraph)).toHaveCount(3);
  expect(await divGraph.evaluate(el => (el as Graph)._fullData[0].x)).toEqual([
    '2026-01-12', '2026-03-17', null, '2026-04-20', '2026-06-17',
  ]);
  const segments = divGraph.locator('.scatterlayer .trace').first().locator('.js-line');
  await expect(segments).toHaveCount(2);
  await card(page, dividends).screenshot({ path: info.outputPath('filtered-dividend-gap.png') });
  await frequency.fill('');

  overrides.set(dividendPath, screeningPayload(dividendPath + '-unknown'));
  await refresh(page, dividendSource);
  await expect(card(page, dividends)).toContainText('Dividend coverage is unknown.');
  await expect(plot(page, dividends)).toHaveCount(0);
  overrides.set(incomePath, screeningPayload(incomePath + '-unknown'));
  await refresh(page, incomeSource);
  await expect(card(page, income)).toContainText('Verify one monetary scale for the acquired income statement.');
  await expect(plot(page, income)).toHaveCount(0);
  overrides.delete(dividendPath);
  overrides.delete(incomePath);
  await refresh(page, dividendSource);
  await refresh(page, incomeSource);
  await ready(page);

  const widget = card(page, dividends);
  await widget.getByRole('button', { name: 'Card menu' }).click();
  await page.getByRole('menuitem', { name: 'Choose source' }).click();
  let dialog = page.getByRole('dialog', { name: 'Choose source' });
  await dialog.getByLabel('Source table').selectOption({ label: screenSource + ' — ' + screeningTab });
  await dialog.getByRole('button', { name: 'Choose source' }).click();
  await expect(plot(page, dividends)).toHaveCount(0);
  await expect(widget.getByLabel('Chart type').locator('option[value="dividend-steps"]')).toHaveAttribute('disabled', '');
  await widget.getByRole('button', { name: 'Card menu' }).click();
  await page.getByRole('menuitem', { name: 'Choose source' }).click();
  dialog = page.getByRole('dialog', { name: 'Choose source' });
  await dialog.getByLabel('Source table').selectOption({ label: dividendSource + ' — ' + screeningTab });
  await dialog.getByRole('button', { name: 'Choose source' }).click();
  await widget.getByLabel('Chart type').selectOption('dividend-steps');
  await apply(widget);
  await expect(markers(plot(page, dividends))).toHaveCount(4);
});

test('applies a new price date and fiscal period, then exports settings and reacquires all table rows on another page', async ({ page, context }) => {
  await importScreening(page);
  await ready(page);
  const screen = card(page, bubble);
  await screen.getByLabel('Price date').selectOption('2026-08-28');
  await screen.getByLabel('Show regression').uncheck();
  await expect(screen).toContainText('Unweighted OLS, N = 4');
  await apply(screen);
  await expect(screen).toContainText('Price-data date 2026-08-28');
  await expect(markers(plot(page, bubble))).toHaveCount(3);
  await expect(screen).not.toContainText('Unweighted OLS');
  const sunk = card(page, income);
  await sunk.getByLabel('Income statement period').selectOption({ label: 'FY 2025 · 2025-06-30' });
  await expect(sunk).toContainText('FY 2026 ended 2026-06-30');
  await apply(sunk);
  await expect(sunk).toContainText('FY 2025 ended 2025-06-30');

  await openRail(page);
  await page.locator('nav.left-rail').getByRole('button', { name: screeningWorkspace, exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Save…' }).click();
  await page.getByRole('menuitem', { name: 'BDOBB Workspace', exact: true }).click();
  const path = 'exports/' + screeningWorkspace + '.apps.json';
  await expect.poll(() => read(page, path)).toBeDefined();
  const saved = (await read(page, path))!;
  expect(saved).not.toMatch(/chart_evidence|visibleCoordinates|9600000000|explicit-snapshot|2026-11-19T16:00:00Z/);
  const changedScreen = screeningPayload(screenPath);
  changedScreen.results.find((row: { last_day_data_date: string }) => row.last_day_data_date === '2026-08-28').dividend_yield = .055;
  const changedDividends = screeningPayload(dividendPath);
  changedDividends.results[0].amount = .1875;
  const changedIncome = screeningPayload(incomePath);
  changedIncome.results[1].net_income = 18;
  const reopened = await context.newPage();
  const { acquisitions } = await importScreening(reopened, saved, new Map([
    [screenPath, changedScreen], [dividendPath, changedDividends], [incomePath, changedIncome],
  ]));
  await expect(markers(plot(reopened, bubble))).toHaveCount(3);
  await expect(markers(plot(reopened, dividends))).toHaveCount(4);
  await expect(nodes(plot(reopened, income))).toHaveCount(11);
  expect(new Set(acquisitions.map(url => url.pathname))).toEqual(new Set(screeningPaths));
  expect(acquisitions.every(url => url.searchParams.get('chart_source') === 'true')).toBe(true);
  await expect(card(reopened, bubble).getByLabel('Price date')).toHaveValue('2026-08-28');
  await expect(card(reopened, bubble).getByLabel('Show regression')).not.toBeChecked();
  await expect(card(reopened, income)).toContainText('Net income 18 USD × 1000');
  await hover(reopened, markers(plot(reopened, bubble)).first());
  await expect(tip(plot(reopened, bubble))).toContainText('Dividend yield 5.50%');
  await hover(reopened, markers(plot(reopened, dividends)).first());
  await expect(tip(plot(reopened, dividends))).toContainText('Split-adjusted 0.1875 GBP per share');
});

async function touchDrag(page: Page, start: { x: number; y: number }, end: { x: number; y: number }) {
  const touch = await page.context().newCDPSession(page);
  for (let step = 0; step <= 8; step++) {
    await touch.send('Input.dispatchTouchEvent', {
      type: step ? 'touchMove' : 'touchStart',
      touchPoints: [{ x: start.x + (end.x - start.x) * step / 8, y: start.y + (end.y - start.y) * step / 8 }],
    });
  }
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await touch.detach();
}

test('taps Sankey nodes and links, scrolls from a fixed node and zooms fitting plots on a narrow touch dashboard', async ({ browser, baseURL }, info) => {
  const context = await browser.newContext({ baseURL, hasTouch: true, isMobile: true, viewport: { width: 880, height: 1000 } });
  try {
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: 'dark' });
    await importScreening(page);
    await ready(page);
    await page.setViewportSize({ width: 390, height: 1100 });
    // Keep the actual import notice below the card in the captured viewport.
    const incomeCard = card(page, income);
    await incomeCard.evaluate(el => el.scrollIntoView({ block: 'start' }));
    const sankey = plot(page, income);
    const viewport = card(page, income).locator('.chart-scroll-viewport');
    await expect(viewport).toHaveClass(/chart-scroll-viewport--touch-scroll/);
    await expect.poll(() => sankey.evaluate(el => Math.abs((el as Graph)._fullLayout.width - el.clientWidth))).toBeLessThanOrEqual(1);
    await expectPaintedRibbons(sankey);
    const labelsClearNodes = () => sankey.evaluate(el => {
      const right = Math.max(...[...el.querySelectorAll('.sankey-node .node-rect')].map(node => node.getBoundingClientRect().right));
      const left = Math.min(...[...el.querySelectorAll('.annotation-text')].map(label => label.getBoundingClientRect().left));
      return right < left;
    });
    await expect.poll(labelsClearNodes).toBe(true);
    const node = await center(nodes(sankey).first());
    await page.touchscreen.tap(node.x, node.y);
    await expect(tip(sankey)).toContainText(/Revenue.*Reported 100 USD × 1000/);
    await expectReadableTooltip(sankey);
    await incomeCard.screenshot({ path: info.outputPath('narrow-sankey-node.png') });
    const point = await ribbonPoint(ribbons(sankey).nth(1));
    await page.touchscreen.tap(point.x, point.y);
    await expect(tip(sankey)).toContainText(/Cost of revenue.*Reported 40 USD × 1000/);
    await expectReadableTooltip(sankey);
    await incomeCard.screenshot({ path: info.outputPath('narrow-sankey-link.png') });
    const scrollTop = () => viewport.evaluate(el => el.scrollTop);
    const draggable = await center(nodes(sankey).nth(2));
    const beforeScroll = await scrollTop();
    await touchDrag(page, draggable, { x: draggable.x, y: draggable.y - 105 });
    await expect.poll(scrollTop).toBeGreaterThan(beforeScroll + 35);
    const netIncome = nodes(sankey).last();
    await expect(netIncome).toBeInViewport();
    const terminal = await center(netIncome);
    await page.touchscreen.tap(terminal.x, terminal.y);
    await expect(tip(sankey)).toContainText(/Net income.*Reported 20 USD × 1000/);
    const notice = await page.getByText('Imported 1 dashboard, 6 cards', { exact: true }).boundingBox();
    const cardBounds = (await incomeCard.boundingBox())!;
    if (notice) expect(cardBounds.y + cardBounds.height).toBeLessThanOrEqual(notice.y);
    await incomeCard.screenshot({ path: info.outputPath('narrow-sankey-scrolled.png') });
    const dimensions = () => sankey.evaluate(el => {
      const { width, uirevision } = (el as Graph)._fullLayout;
      return { width, uirevision };
    });
    const before = await dimensions();
    const nodeRows = () => sankey.locator('.sankey-node').evaluateAll(elements => elements.map(el => {
      const plotTop = el.closest('.chart-plot')!.getBoundingClientRect().top;
      return Math.round(el.querySelector('.node-rect')!.getBoundingClientRect().top - plotTop);
    }));
    const rows = await nodeRows();
    expect(rows).toHaveLength(10);
    await page.setViewportSize({ width: 760, height: 950 });
    await expect.poll(async () => (await dimensions()).width).toBeGreaterThan(before.width);
    expect((await dimensions()).uirevision).toBe(before.uirevision);
    await expect.poll(nodeRows).toEqual(rows);
    await expectPaintedRibbons(sankey);

    for (const name of [bubble, dividends]) {
      const graph = plot(page, name);
      const ranges = () => graph.evaluate(el => (el as Graph)._fullLayout.xaxis.range);
      const area = graph.locator('.nsewdrag');
      await area.scrollIntoViewIfNeeded();
      const rect = (await area.boundingBox())!;
      const original = await ranges();
      await touchDrag(page, { x: rect.x + rect.width * .18, y: rect.y + rect.height * .18 },
        { x: rect.x + rect.width * .79, y: rect.y + rect.height * .8 });
      await expect.poll(ranges).not.toEqual(original);
      await expectScatterLabelsToFit(graph, name === bubble);
      await graph.screenshot({ path: info.outputPath(name === bubble ? 'narrow-bubble-zoom.png' : 'narrow-dividend-zoom.png') });
    }
  } finally {
    await context.close();
  }
});

test('keeps the narrow fractional regression sample and fitted endpoints inside the SVG plot', async ({ page }, info) => {
  await page.setViewportSize({ width: 2600, height: 1200 });
  const payload = screeningPayload(screenPath);
  const date = '2026-08-31';
  payload.results = [0.1, 0.10000000000000002, 0.10000000000000003].map((x, i) => ({
    ...payload.results[0], symbol: 'LIST' + i + '.US', last_day_data_date: date,
    dividend_yield: x, price_change_5d: i * .01, market_cap: 100,
  }));
  const evidence = payload.extra.results_metadata.chart_evidence;
  Object.assign(evidence, { raw_count: 3, normalized_count: 3, delivered_count: 3,
    cohorts: [{ ...evidence.cohorts[0], raw_count: 3, price_date: date }] });
  await importScreening(page, undefined, new Map([[screenPath, payload]]));
  const graph = plot(page, bubble);
  await expect(markers(graph)).toHaveCount(3);
  await expect(card(page, bubble)).toContainText('N = 3, R² = 1');
  for (const [width, height] of [[780, 480], [390, 440], [1100, 620]]) {
    await graph.evaluate((el, [w, h]) => {
      el.style.width = w + 'px';
      el.style.height = h + 'px';
    }, [width, height]);
    await expect.poll(() => graph.evaluate(el => (el as Graph)._fullLayout.width)).toBe(width);
    const geometry = await graph.evaluate(el => {
      const domain = el.querySelector<SVGRectElement>('.nsewdrag')!;
      const points = [...el.querySelectorAll<SVGGraphicsElement>('.points .point')].map(point => {
        const { e, f } = point.transform.baseVal.consolidate()!.matrix;
        return [e, f];
      });
      const line = el.querySelector<SVGPathElement>('.js-line')!;
      const endpoints = [0, line.getTotalLength()].map(length => {
        const { x, y } = line.getPointAtLength(length);
        return [x, y];
      });
      return { points, endpoints, width: domain.width.baseVal.value, height: domain.height.baseVal.value };
    });
    for (const [x, y] of [...geometry.points, ...geometry.endpoints]) {
      expect(x, JSON.stringify(geometry)).toBeGreaterThanOrEqual(0);
      expect(x, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.width);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(geometry.height);
    }
    for (const [index, endpoint] of geometry.endpoints.entries()) {
      expect(endpoint[0]).toBeCloseTo(geometry.points[index * 2][0], 0);
      expect(endpoint[1]).toBeCloseTo(geometry.points[index * 2][1], 0);
    }
    await info.attach('geometry-' + width, { body: JSON.stringify(geometry), contentType: 'application/json' });
    if (width === 780) await graph.screenshot({ path: info.outputPath('narrow-span-regression.png') });
  }
});
