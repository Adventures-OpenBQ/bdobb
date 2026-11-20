// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Locator, type Page } from '@playwright/test';
import { isDiscoveryRequest, openRail, read } from './fixtures';
import { card, plot, captureParameters, openParameters } from './fixtures/chart-recipes';
import { dropFile } from './fixtures/return-summary';
import {
  attachEps, backendOrigin, backendPath, chooseKpiSource, epsFile, epsGauge, fictionalResponse,
  filename, metricName, pageTab, placeholder, prepareKpi, workspace, yieldCard,
} from './fixtures/linked-kpi';

const apply = (widget: Locator) => widget.getByRole('button', { name: 'Apply KPI settings' });
const details = (widget: Locator) => widget.getByText('KPI details', { exact: true });
const tip = (graph: Locator) => graph.locator('.hoverlayer');
const value = (widget: Locator) => widget.locator('.metric-value');
const outline = (graph: Locator) => graph.locator('.gauge-outline rect');

async function saveWorkspace(page: Page) {
  await openRail(page);
  await page.locator('nav.left-rail').getByRole('button', { name: workspace, exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Save…' }).click();
  await page.getByRole('menuitem', { name: 'BDOBB Workspace', exact: true }).click();
}

async function expectContrast(locator: Locator, hover = false) {
  expect(await locator.evaluate((node, hover) => {
    const luminance = (color: string) => [...color.matchAll(/[\d.]+/g)].slice(0, 3).reduce((value, part, channel) => {
      const intensity = Number(part[0]) / 255;
      return value + [0.2126, 0.7152, 0.0722][channel] * (intensity <= .04045 ? intensity / 12.92 : ((intensity + .055) / 1.055) ** 2.4);
    }, 0);
    const background = hover ? node.closest('.hovertext')?.querySelector('path') : node.closest('.widget-card');
    if (!background) throw new Error('Expected a visible chart background');
    const ink = getComputedStyle(node).fill;
    const paper = hover ? getComputedStyle(background).fill : getComputedStyle(background).backgroundColor;
    const tones = [luminance(ink), luminance(paper)].sort((a, b) => b - a);
    return (tones[0] + .05) / (tones[1] + .05);
  }, hover)).toBeGreaterThanOrEqual(4.5);
}

function trackDataRequests(page: Page, appURL: string) {
  const app = new URL(appURL).origin;
  const requests: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol)) return;
    const wasm = url.origin === app && /\/pivot_wasm_bg(?:-[\w-]+)?\.wasm$/.test(url.pathname);
    if (!wasm && (url.origin !== app || url.pathname.startsWith('/api/') ||
      ['xhr', 'fetch'].includes(request.resourceType()))) requests.push(request.url());
  });
  return requests;
}

async function importQuestion(page: Page, text: string) {
  await dropFile(page, 'kpi.apps.json', text);
  await page.getByRole('tab', { name: pageTab, exact: true }).last().click();
}

test('default card selects a certified headline explicitly and imports a fresh acquisition', async ({ page, context, baseURL }, info) => {
  await page.setViewportSize({ width: 1180, height: 1000 });
  await page.emulateMedia({ colorScheme: 'light' });
  const requests = trackDataRequests(page, baseURL!);
  const acquisitions = await prepareKpi(page, { backend: true });
  const widget = card(page, metricName), graph = plot(page, metricName);
  await expect(widget.getByLabel('KPI preset')).toBeHidden();
  const parameters = await openParameters(widget);
  await expect(parameters.getByLabel('KPI preset')).toBeVisible();
  await expect(widget.getByRole('option', { name: 'Trailing dividend yield' })).not.toHaveAttribute('disabled', '');
  const baseline = acquisitions.length;
  expect(baseline).toBeGreaterThan(0);
  await expect(apply(widget)).toBeDisabled();
  await expect(value(widget)).toHaveCount(0);
  for (const metric of ['Last price', 'Market capitalization', 'Trailing diluted EPS', 'Trailing revenue'])
    await expect(widget.getByRole('option', { name: metric })).toHaveAttribute('disabled', '');
  await widget.getByLabel('KPI preset').selectOption('dividend_yield');
  await expect(widget.getByLabel('Observation', { exact: true })).toHaveValue('@latest');
  await expect(widget.getByLabel('KPI view')).toHaveValue('card');
  await expect(widget.getByLabel('Original numeric field')).toHaveValue('dividend_yield');
  await apply(widget).click();
  await expect(value(widget)).toHaveText('0.3%');
  await expect(widget).toContainText('As of unknown');
  await expect(widget).toContainText('Retrieved 2026-11-20T04:16:46Z');
  await expect(widget).toContainText('Share class unknown');
  await expect(graph).toHaveCount(0);
  await expect(widget.locator('.metric-delta')).toHaveCount(0);
  await widget.screenshot({ path: info.outputPath('kpi-card-light.png') });
  expect(acquisitions).toHaveLength(baseline);
  const url = backendOrigin + backendPath + '?chart_source=true&symbol=AAPL.US';
  expect(requests.filter(request => !isDiscoveryRequest(request))).toEqual(Array(baseline).fill(url));

  await saveWorkspace(page);
  const path = 'exports/' + workspace + '.apps.json';
  await expect.poll(() => read(page, path)).toBeDefined();
  const text = (await read(page, path))!;
  expect(JSON.parse(text)[0].extensions.bdobb.cards[0].extras.linkedMetric).toEqual(yieldCard);
  expect(text).not.toMatch(/as_of_unknown|retrieved_at|metric_vintage|inputRevision|0\.003|2026-11-20T04:16:46Z/);
  const fresh = await context.newPage();
  const importedRequests = trackDataRequests(fresh, baseURL!);
  const fetched = await prepareKpi(fresh, { backend: true, empty: true, response: () => {
    const data = fictionalResponse();
    data.results[0].dividend_yield = .007;
    return data;
  } });
  await importQuestion(fresh, text);
  await expect(value(card(fresh, metricName))).toHaveText('0.7%');
  expect(fetched).toHaveLength(baseline);
  expect(importedRequests.filter(request => !isDiscoveryRequest(request))).toEqual(Array(baseline).fill(url));
  const imported = card(fresh, metricName);
  await openParameters(imported);
  await imported.getByLabel('Reference', { exact: true }).selectOption('user-target');
  await imported.getByLabel('User target', { exact: true }).fill('0.0035');
  await apply(imported).click();
  await expect(imported.locator('.metric-delta')).toHaveText('Δ +0.0035 fraction · +100% change');
  await expect(imported).toContainText('User target (assumption)');
  expect(fetched).toHaveLength(baseline);
  await fresh.close();
});

test('missing evidence disables Apply and an incompatible exact draft keeps the applied gauge and details', async ({ page }, info) => {
  await page.setViewportSize({ width: 1120, height: 1000 });
  await page.emulateMedia({ colorScheme: 'light' });
  await prepareKpi(page, { options: { ...epsGauge, range: { ...epsGauge.range!, min: -150, max: 150 } } });
  const widget = card(page, metricName), graph = plot(page, metricName);
  await expect(widget.getByRole('alert')).toContainText('Source source:');
  await dropFile(page, 'ordinary-rows.json', JSON.stringify([{ eps_ttm: 11, issuer: 'EXAMPLE.US' }]));
  await chooseKpiSource(page, 'ordinary-rows.json');
  await openParameters(widget);
  await expect(widget.getByRole('alert')).toContainText(/verified KPI observation/i);
  await expect(apply(widget)).toBeDisabled();
  await expect(value(widget)).toHaveCount(0);
  await attachEps(page, filename, epsFile(120));
  await expect(value(widget)).toHaveText('120 USD per share');
  await expect(outline(graph)).toHaveCount(1);
  await expect(widget.locator('.metric-delta')).toContainText('43.456 USD per share');
  expect(await widget.locator('.metric-delta').evaluate(node => getComputedStyle(node).color))
    .toBe(await widget.locator('.metric-label').evaluate(node => getComputedStyle(node).color));
  await graph.locator('.annotation-text').first().hover();
  await expect(tip(graph)).toContainText('Original value: 120 USD per share');
  await expect(tip(graph)).toContainText('-150 USD per share to 150 USD per share');
  await expect(tip(graph)).toContainText('User range (assumption) · Planning range');
  await expectContrast(graph.locator('.annotation-text').nth(1));
  await expectContrast(tip(graph).locator('.hovertext text').first(), true);
  await widget.screenshot({ path: info.outputPath('kpi-gauge-light.png') });
  await widget.getByRole('button', { name: 'Hide parameters' }).click();
  await captureParameters(widget, 'Range maximum', file => info.outputPath(file));
  await details(widget).focus();
  await page.keyboard.press('Enter');
  await expect(widget.getByRole('list', { name: 'KPI values and evidence' })).toContainText('2025-10-01 to 2026-09-30');
  await expect(widget.getByRole('list', { name: 'KPI values and evidence' })).toContainText('76.544 USD per share');
  await openParameters(widget);
  await widget.getByLabel('Range minimum').fill('-1e308');
  await widget.getByLabel('Range maximum').fill('1e308');
  await expect(widget).toContainText(/gauge geometry cannot distinguish/i);
  await expect(apply(widget)).toBeDisabled();
  await expect(value(widget)).toHaveText('120 USD per share');
  await expect(outline(graph)).toHaveCount(1);
  await expect(widget.getByRole('list', { name: 'KPI values and evidence' })).toContainText('76.544 USD per share');
  await widget.getByLabel('Range minimum').fill('0');
  await widget.getByLabel('Range maximum').fill('100');
  await apply(widget).click();
  await expect(widget.getByRole('alert')).toContainText(/original KPI value is outside the user range/i);
  await expect(value(widget)).toHaveText('120 USD per share');
  await expect(graph).toHaveCount(0);
  await widget.screenshot({ path: info.outputPath('kpi-out-of-range.png') });
});

test('local export retains the standard file guard and an imported pin requires explicit repair', async ({ page, context, baseURL }) => {
  const requests = trackDataRequests(page, baseURL!);
  await prepareKpi(page, { options: epsGauge });
  await attachEps(page, filename);
  let widget = card(page, metricName);
  await expect(value(widget)).toHaveText('12.345 USD per share');
  await saveWorkspace(page);
  await expect(page.getByText(/export refused.*MISSING_LOCAL_ASSET/i)).toBeVisible();
  const path = 'exports/' + workspace + '.apps.json';
  expect(await read(page, path)).toBeUndefined();
  await chooseKpiSource(page, placeholder);
  const file = card(page, filename);
  await file.getByRole('button', { name: 'Remove card', exact: true }).click();
  await expect(file).toHaveCount(0);
  await saveWorkspace(page);
  await expect.poll(() => read(page, path)).toBeDefined();
  const text = (await read(page, path))!;
  expect(JSON.parse(text)[0].extensions.bdobb.cards[0].extras.linkedMetric).toEqual(epsGauge);
  expect(text).not.toMatch(/12\.345|76\.544|chart_sources|reporting_basis|retrieved_at/);
  const fresh = await context.newPage();
  const reacq = trackDataRequests(fresh, baseURL!);
  await prepareKpi(fresh, { empty: true });
  await importQuestion(fresh, text);
  widget = card(fresh, metricName);
  await expect(value(widget)).toHaveCount(0);
  await attachEps(fresh, filename, epsFile(0, true));
  await expect(widget.getByRole('alert')).toContainText(/pinned KPI observation is unavailable/i);
  await expect(value(widget)).toHaveCount(0);
  await openParameters(widget);
  await expect(widget.getByLabel('Observation', { exact: true })).toHaveValue('revised-report');
  await widget.getByLabel('Observation', { exact: true }).selectOption('first-report');
  await widget.getByLabel('Reference', { exact: true }).selectOption('none');
  await apply(widget).click();
  await expect(value(widget)).toHaveText('76.544 USD per share');
  expect(requests).toEqual([]);
  expect(reacq).toEqual([]);
  await fresh.close();
});

test('dark touch gauge retains its question through resize and scrolls below the true minimum', async ({ browser, baseURL }, info) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 610, height: 900 },
    colorScheme: 'dark', baseURL });
  try {
    const page = await context.newPage();
    await prepareKpi(page, { options: { ...epsGauge, range: { min: -Number.MAX_VALUE, max: Number.MAX_VALUE, label: 'Extreme test' },
      reference: { kind: 'user-target', value: 0 } } });
    await attachEps(page, filename, epsFile(Number.MAX_VALUE / 2));
    const widget = card(page, metricName), graph = plot(page, metricName);
    await expect(outline(graph)).toHaveCount(1);
    await expect(value(widget)).toHaveText('8.988465674311579e+307 USD per share');
    const measure = () => graph.evaluate(node => {
      const actual = node.getBoundingClientRect();
      const probe = node.closest('.linked-kpi-renderer')!.querySelector('.linked-kpi-surface-probe .chart-plot')!.getBoundingClientRect();
      return {
        width: actual.width, band: node.querySelector<SVGRectElement>('.gauge-outline rect')!.getBBox().width,
        actual: [actual.width, actual.height], probe: [probe.width, probe.height],
        revision: (node as HTMLElement & { _fullLayout: { uirevision: string } })._fullLayout.uirevision,
      };
    });
    const first = await measure();
    expect(first.actual).toEqual(first.probe);
    await expect(widget.locator('.linked-kpi-plot .chart-scroll-viewport')).not.toHaveClass(/touch-scroll/);
    await graph.locator('.annotation-text').first().tap();
    await expect(tip(graph)).toContainText('Original value: 8.988465674311579e+307 USD per share');
    await expect(tip(graph)).toContainText('Minimum -1.7976931348623157e+308 USD per share');
    await expect(tip(graph)).toContainText('Maximum 1.7976931348623157e+308 USD per share');
    expect(await tip(graph).locator('.hovertext text').first().evaluate(node => {
      const text = node.getBoundingClientRect();
      const viewport = node.closest('.chart-scroll-viewport')!.getBoundingClientRect();
      return text.left >= viewport.left && text.right <= viewport.right;
    })).toBe(true);
    await expectContrast(graph.locator('.annotation-text').nth(2));
    await expectContrast(tip(graph).locator('.hovertext text').first(), true);
    await details(widget).tap();
    await expect(widget.getByRole('list', { name: 'KPI values and evidence' })).toContainText('User target (assumption)');
    await widget.screenshot({ path: info.outputPath('kpi-gauge-dark-touch.png') });
    await page.setViewportSize({ width: 280, height: 900 });
    const viewport = widget.locator('.linked-kpi-plot .chart-scroll-viewport');
    await expect.poll(async () => (await measure()).width).toBe(296);
    await expect.poll(async () => (await measure()).band).toBe(272);
    const narrow = await measure();
    expect(narrow.revision).toBe(first.revision);
    expect(narrow.actual).toEqual(narrow.probe);
    await expect(viewport).toHaveClass(/touch-scroll/);
    await viewport.scrollIntoViewIfNeeded();
    const box = (await viewport.boundingBox())!;
    expect(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.linked-kpi-plot'), {
      x: box.x + box.width * .8, y: box.y + box.height / 2,
    })).toBe(true);
    const session = await context.newCDPSession(page);
    for (let step = 0; step <= 8; step++) await session.send('Input.dispatchTouchEvent', {
      type: step ? 'touchMove' : 'touchStart',
      touchPoints: [{ x: box.x + box.width * .8 - step * 9, y: box.y + box.height / 2 }],
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
    await expect.poll(() => viewport.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    await widget.screenshot({ path: info.outputPath('kpi-gauge-dark-narrow.png') });
  } finally { await context.close(); }
});
