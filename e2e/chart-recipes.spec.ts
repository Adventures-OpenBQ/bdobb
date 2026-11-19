// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Locator, type Page } from '@playwright/test';
import { card, fixture, importExample, names, plot } from './fixtures/chart-recipes';
import { openRail, read } from './fixtures';

type Axis = { _offset: number; range: (string | number)[]; c2p: (v: number) => number; };
type Graph = HTMLElement & {
  _fullLayout: { paper_bgcolor: string; xaxis: Axis; yaxis: Axis; };
  _fullData: { name: string; visible: boolean | string; legendgroup: string; type: string; x?: unknown[]; y?: unknown[]; z?: unknown[][]; value?: number; text?: string[]; }[];
};

test.use({ timezoneId: 'America/New_York', actionTimeout: 7000 });
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  // May 1 UTC is still April 30 in the user's timezone.
  await page.clock.setFixedTime(new Date('2026-05-01T02:00:00Z'));
});

async function heatmapHover(page: Page, graph: Locator, x: number, y: number) {
  await graph.scrollIntoViewIfNeeded();
  const point = await graph.evaluate((element, cell) => {
    const { xaxis, yaxis } = (element as Graph)._fullLayout;
    const rect = element.getBoundingClientRect();
    return { x: rect.left + xaxis._offset + xaxis.c2p(cell.x), y: rect.top + yaxis._offset + yaxis.c2p(cell.y) };
  }, { x, y });
  await page.mouse.move(point.x, point.y);
  return graph.locator('.hoverlayer');
}

async function allPlots(page: Page) {
  for (const name of names) await expect(plot(page, name).locator('svg.main-svg').first()).toBeAttached();
}

test('native import draws seven charts in both themes and preserves usable missing-value hover', async ({ page }, info) => {
  test.setTimeout(90000);
  const workers: string[] = [];
  page.on('worker', worker => workers.push(worker.url()));
  await importExample(page);
  await allPlots(page);
  expect(workers.some(url => url.includes('recipe.worker'))).toBe(true);
  const monthly = plot(page, 'Monthly returns');
  await expect(await heatmapHover(page, monthly, 1, 1)).toContainText('0 %');
  await expect(await heatmapHover(page, monthly, 2, 1)).toContainText('Missing or invalid price');
  await expect(await heatmapHover(page, monthly, 3, 1)).toContainText('Incomplete because this is the current month');
  const corr = plot(page, 'Daily return correlation');
  const ordinary = await heatmapHover(page, corr, 0, 1);
  await expect(ordinary).toContainText(/N = \d+/);
  await expect(ordinary).toContainText(/Paired return dates 2026-\d\d-\d\d to 2026-04-30/);
  await expect(await heatmapHover(page, corr, 0, 4)).toContainText(/variance|constant/i);
  await expect(plot(page, 'Estimate ranges').locator('.ytick text')).toHaveText(['FQ1 2025', 'FQ2 2025', 'FQ3 2025', 'FQ4 2025']);
  await expect(card(page, 'Estimate ranges')).toContainText(/FQ4 2025.*withheld/);
  await expect(plot(page, 'Income statement bridge')).toContainText('Other');
  const draw = plot(page, 'Drawdown');
  await expect(draw).toContainText('Drawdown from peak in loaded history');
  const paths = await draw.locator('.js-fill').evaluateAll(elements => elements.map(e => e.getAttribute('d') ?? ''));
  expect(paths.some(path => (path.match(/M/g) ?? []).length >= 2)).toBe(true);
  await page.mouse.move(900, 30);
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const [index, name] of names.entries()) {
      const graph = plot(page, name);
      await expect.poll(() => graph.evaluate(e => (e as Graph)._fullLayout.paper_bgcolor)).toBe(theme === 'light' ? '#ffffff' : '#1e242e');
      await graph.screenshot({ path: info.outputPath(theme + '-' + (index + 1) + '.png') });
    }
  }
  await page.setViewportSize({ width: 980, height: 850 });
  const curve = plot(page, 'Yield curve');
  const ticks = curve.locator('.xtick text');
  await expect(ticks).toHaveText(['3M', '5Y', '10Y', '30Y']);
  const bounds = await ticks.evaluateAll(elements => elements.map(e => { const r = e.getBoundingClientRect(); return [r.left, r.right]; }));
  expect(bounds.slice(1).every((box, index) => box[0] >= bounds[index][1])).toBe(true);
  await expect(corr.locator('.xtick text')).toHaveCount(6);
});

test('source refresh preserves legend selections and handles refused, stale and removed sources', async ({ page }, info) => {
  test.setTimeout(90000);
  const overrides = await importExample(page);
  await allPlots(page);
  const curve = plot(page, 'Yield curve');
  const refresh = (name: string) => card(page, name).getByRole('button', { name: 'Refresh', exact: true }).click();
  const traces = (graph: Locator) => graph.evaluate(e => (e as Graph)._fullData.map(t => [t.name, t.visible]));
  await curve.locator('.legend .traces').filter({ hasText: '2026-03-31' }).click();
  await expect.poll(() => traces(curve)).toContainEqual(['2026-03-31', 'legendonly']);
  const curves = JSON.parse(fixture('curves'));
  const extra = curves.rows.filter((row: { date: string; }) => row.date === '2026-01-30').map((row: object) => ({ ...row, date: '2026-01-15' }));
  overrides.set('curves.json', { body: JSON.stringify({ ...curves, rows: [...extra, ...curves.rows] }) });
  await refresh('Treasury observations');
  await expect.poll(() => traces(curve)).toHaveLength(3);
  expect(await traces(curve)).toContainEqual(['2026-03-31', 'legendonly']);
  overrides.delete('curves.json');
  await refresh('Treasury observations');
  await expect.poll(() => traces(curve)).toHaveLength(2);
  expect(await traces(curve)).toContainEqual(['2026-03-31', 'legendonly']);

  overrides.set('curves.json', { body: JSON.stringify(curves.rows) });
  await refresh('Treasury observations');
  await expect(card(page, 'Yield curve')).toContainText('The source must be fully loaded. Acquisition is unknown.');
  await expect(curve).toHaveCount(0);
  overrides.delete('curves.json');
  await refresh('Treasury observations');
  await expect.poll(() => traces(curve)).toHaveLength(2);

  const draw = plot(page, 'Drawdown'), source = 'Daily adjusted prices';
  const xRange = () => draw.evaluate(e => (e as Graph)._fullLayout.xaxis.range);
  const fullRange = await xRange();
  const drag = draw.locator('.nsewdrag');
  await drag.scrollIntoViewIfNeeded();
  const area = (await drag.boundingBox())!;
  await page.mouse.move(area.x + area.width * 0.2, area.y + area.height * 0.15);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width * 0.8, area.y + area.height * 0.85, { steps: 10 });
  await page.mouse.up();
  await expect.poll(xRange).not.toEqual(fullRange);
  const zoomed = await xRange();
  await draw.locator('.legend .traces').filter({ hasText: 'ALDER' }).click();
  const group = () => draw.evaluate(e => (e as Graph)._fullData.filter(t => t.legendgroup === 'ALDER').map(t => t.visible));
  await expect.poll(group).toEqual(['legendonly', 'legendonly']);
  const prices = JSON.parse(fixture('prices'));
  const gap = prices.rows.find((row: { symbol: string; date: string; }) => row.symbol === 'ALDER' && row.date === '2026-02-04');
  gap.adjusted_close = null;
  overrides.set('prices.json', { body: JSON.stringify(prices) });
  await refresh(source);
  await expect(card(page, 'Drawdown')).toContainText('2 price gap');
  expect(await group()).toEqual(['legendonly', 'legendonly']);
  expect(await xRange()).toEqual(zoomed);
  const width = await draw.evaluate(e => e.clientWidth);
  const handle = page.locator('.react-grid-item').filter({ has: draw }).locator('.react-resizable-handle-se');
  await handle.scrollIntoViewIfNeeded();
  const corner = (await handle.boundingBox())!;
  await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
  await page.mouse.down();
  await page.mouse.move(corner.x - 110, corner.y - 20, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => draw.evaluate(e => e.clientWidth)).toBeLessThan(width);
  expect(await xRange()).toEqual(zoomed);

  overrides.set('prices.json', { body: '{}', status: 503 });
  await refresh(source);
  await expect(card(page, 'Drawdown')).toContainText('showing completed data (stale)');
  await card(page, 'Drawdown').screenshot({ path: info.outputPath('stale.png') });
  overrides.set('prices.json', { body: JSON.stringify({ ...prices, completeness: 'paged' }) });
  await refresh(source);
  await expect(card(page, 'Drawdown')).toContainText('The source must be fully loaded. Acquisition is paged.');
  await expect(draw).toHaveCount(0);
  await card(page, 'Drawdown').screenshot({ path: info.outputPath('refusal.png') });
  overrides.delete('prices.json');
  await refresh(source);
  await expect(draw).toHaveCount(1);
  const table = card(page, source);
  await table.getByRole('button', { name: 'Filter rows' }).click();
  await table.getByLabel('Filter symbol', { exact: true }).fill('ALDER');
  await expect(card(page, 'Drawdown')).toContainText(/Omitted.*MAPLE/);
  await table.getByRole('button', { name: 'Remove card', exact: true }).click();
  await expect(draw).toHaveCount(0);
  await expect(card(page, 'Drawdown')).toContainText(/source.*unavailable/i);
});

test('edits chart and Statement settings and reopens the native export', async ({ page, context }) => {
  test.setTimeout(90000);
  await importExample(page);
  await allPlots(page);
  const bullet = card(page, 'Earnings versus estimates');
  await bullet.getByLabel('Quarter').selectOption('FQ1 2025');
  await expect(bullet).toContainText('No estimate range was supplied.');
  await bullet.getByLabel('Quarter').selectOption('FQ4 2025');
  await expect(bullet).toContainText('Estimate range withheld.');
  await expect(bullet).toContainText('vs consensus');
  await expect.poll(() => plot(page, 'Earnings versus estimates').evaluate(e => (e as Graph)._fullData[0].value)).toBe(1.3);
  await bullet.getByLabel('Quarter').selectOption('FQ3 2025');
  await expect.poll(() => plot(page, 'Earnings versus estimates').evaluate(e => (e as Graph)._fullData[0].value)).toBe(1.2);
  await expect(bullet.locator('g.value-bullet rect')).toHaveCount(2);
  const gauges = bullet.locator('g.value-bullet');
  expect(await gauges.evaluateAll(bars => bars.every(bar => {
    const bands = bar.parentElement!.querySelectorAll('.bg-bullet');
    return bands.length > 0 && [...bands].every(band => band.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING);
  }))).toBe(true);
  const corr = card(page, 'Daily return correlation');
  await corr.getByLabel('Lookback').fill('25');
  await corr.getByRole('button', { name: 'Apply chart settings' }).click();
  await expect(corr).toContainText('25 of 25 return-date positions');
  const source = card(page, 'Income statement inputs');
  await source.getByRole('button', { name: 'Pivot', exact: true }).click();
  await source.getByRole('tab', { name: 'Saved', exact: true }).click();
  await source.getByRole('button', { name: 'Statement template', exact: true }).click();
  await source.getByLabel('Section cost_of_revenue', { exact: true }).selectOption({ label: 'Income' });
  await source.getByRole('button', { name: 'Move cost_of_revenue up', exact: true }).click();
  await source.getByRole('button', { name: 'Calculate preview', exact: true }).click();
  await source.getByRole('button', { name: 'Apply Statement model', exact: true }).click();
  await source.getByRole('button', { name: 'Close pivot drawer', exact: true }).click();
  await expect(plot(page, 'Income statement bridge')).toContainText('Cost of revenue');
  await openRail(page);
  await page.locator('nav.left-rail').getByRole('button', { name: 'Financial chart examples', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Save…' }).click();
  await page.getByRole('menuitem', { name: 'BDOBB Workspace', exact: true }).click();
  const path = 'exports/Financial chart examples.apps.json';
  await expect.poll(() => read(page, path)).toBeDefined();
  const saved = (await read(page, path))!;
  expect(saved).toContain('"lineSection"');
  const reopened = await context.newPage();
  await importExample(reopened, saved);
  await allPlots(reopened);
  await expect(card(reopened, 'Daily return correlation').getByLabel('Lookback')).toHaveValue('25');
  await expect.poll(() => plot(reopened, 'Income statement bridge').evaluate(e => (e as Graph)._fullData.flatMap(t => t.text ?? []).some(text => text.includes('Cost of revenue') && text.includes('Step: -')))).toBe(true);
});

test('a narrow touch card renders a dense curve and preserves its numeric maturities', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:' + (process.env.BDOBB_BROWSER_PORT ?? 4173), hasTouch: true, viewport: { width: 920, height: 800 } });
  try {
    const page = await context.newPage();
    // This context is independent of the runner's page fixture.
    const overrides = await importExample(page);
    const curve = plot(page, 'Yield curve');
    await expect(curve.locator('.xtick text').first()).toBeAttached();
    const doc = JSON.parse(fixture('curves'));
    const months = [1, 2, 3, 6, 12, 24, 36, 60, 84, 120, 240, 360];
    doc.rows = months.map((m, i) => ({ date: '2026-03-31', maturity: m < 12 ? 'month_' + m : 'year_' + m / 12, rate: 0.031 + i * 0.001 }));
    overrides.set('curves.json', { body: JSON.stringify(doc) });
    await card(page, 'Treasury observations').getByRole('button', { name: 'Refresh', exact: true }).tap();
    await expect.poll(() => curve.evaluate(e => (e as Graph)._fullData[0].x)).toEqual(months);
    const ticks = await curve.locator('.xtick text').evaluateAll(elements => elements.filter(e => e.textContent).map(e => {
      const r = e.getBoundingClientRect();
      return { left: r.left, right: r.right, label: e.textContent };
    }));
    expect(ticks.length).toBeGreaterThan(2);
    expect(ticks.slice(1).filter((box, i) => box.left < ticks[i].right), JSON.stringify(ticks)).toEqual([]);
  } finally {
    await context.close();
  }
});
