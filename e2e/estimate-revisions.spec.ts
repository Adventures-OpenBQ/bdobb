// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Locator, type Page } from '@playwright/test';
import { revisionBump, revisionDenseValues, revisionHistory, revisionPath, revisionSlope, revisionTieValues } from '../src/test/fixtures/estimateRevisions';
import { openRail, read } from './fixtures';
import { card, plot } from './fixtures/chart-recipes';
import { dataRequests } from './fixtures/dual-axis-overlay';
import {
  attachRevisions, chartName, chooseRevisionSource, liveOrigin, livePath, liveTitle, placeholder, sampleName, seedRevisions, tab, workspace,
} from './fixtures/estimate-revisions';
import { dropFile } from './fixtures/return-summary';

const apply = (widget: Locator) => widget.getByRole('button', { name: 'Apply chart settings' });
const settings = (widget: Locator) => widget.getByText('Estimate revision settings', { exact: true });
const details = (widget: Locator) => widget.getByText('Estimate revision observations', { exact: true });
const marker = (graph: Locator, index: number) => graph.locator('.scatterlayer .trace').first().locator('.point').nth(index);
const pin = (widget: Locator, id: string) => widget.getByRole('checkbox', { name: new RegExp(id) });

async function drawing(graph: Locator) {
  return graph.evaluate(node => {
    const layout = (node as HTMLElement & { _fullLayout: {
      xaxis: { range: number[] }; yaxis: { range: number[] }; width: number; height: number;
      uirevision: string; paper_bgcolor: string;
    } })._fullLayout;
    const { width, height } = node.getBoundingClientRect();
    return { size: [layout.width, layout.height], surface: [Math.round(width), Math.round(height)],
      ranges: [layout.xaxis.range, layout.yaxis.range], revision: layout.uirevision, paper: layout.paper_bgcolor };
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

async function exportRevisions(page: Page) {
  await openRail(page);
  await page.locator('nav.left-rail').getByRole('button', { name: workspace, exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Save…' }).click();
  await page.getByRole('menuitem', { name: 'BDOBB Workspace', exact: true }).click();
}

test('offers explicit pins, repairs source scope and draws original slope and path data with gaps', async ({ page, baseURL }, info) => {
  await page.setViewportSize({ width: 1040, height: 1050 });
  await page.emulateMedia({ colorScheme: 'light' });
  const requests = dataRequests(page, baseURL!);
  await seedRevisions(page);
  const widget = card(page, chartName), graph = plot(page, chartName);
  const chartType = widget.getByLabel('Chart type');
  await expect(chartType.locator('option[value="estimate-revisions"]')).toHaveCount(1);
  await chartType.selectOption('estimate-revisions');
  await expect(widget.getByLabel('Revision view')).toHaveValue('slope');
  await expect(widget.getByRole('option', { name: /Bump/ })).toHaveAttribute('disabled', '');
  await expect(apply(widget)).toBeDisabled();
  await attachRevisions(page, revisionHistory([[0, null, 12], [10, 11, 12]], { unknown: true }));
  await chartType.selectOption('estimate-revisions');
  await expect(widget.getByLabel('Metric')).toHaveValue('eps');
  await expect(widget.getByRole('combobox', { name: 'Fiscal target', exact: true })).toHaveValue('FQ 2027-01-01 to 2027-03-31');
  await expect(widget.getByLabel('Qualified issuer')).toHaveValue('issuer');
  await expect(widget.getByRole('option', { name: /Bump/ })).toHaveAttribute('disabled', '');
  await pin(widget, 'snap-a').check();
  await pin(widget, 'snap-c').check();
  await expect(widget.getByText(/present exactly one acquired issuer/i)).toBeVisible();
  await expect(apply(widget)).toBeDisabled();
  const source = card(page, sampleName);
  await source.getByRole('button', { name: 'Filter rows' }).click();
  const issuer = source.getByLabel('Filter issuer', { exact: true });
  await issuer.fill('BETA.CA');
  await expect(apply(widget)).toBeEnabled();
  await apply(widget).click();
  await expect(graph.locator('.ytitle')).toHaveText('Consensus EPS (CAD/share)');
  await expect(graph.locator('.gtitle')).toContainText('FQ 2027-01-01 to 2027-03-31');
  await expect(graph.locator('.xtick text').last()).toHaveText('2026-11-1316:00:00.123456Z');
  const last = await point(marker(graph, 1));
  await page.mouse.move(last.x, last.y);
  await expect(graph.locator('.hoverlayer')).toContainText('+2 CAD/share');
  await expect(graph.locator('.hoverlayer')).toContainText('+20% (fraction 0.2)');
  await expect(graph.locator('.hoverlayer')).toContainText('2026-11-13T16:00:00.123456Z');
  await widget.screenshot({ path: info.outputPath('revisions-light.png') });
  const before = await drawing(graph);
  await issuer.fill('ALFA.US');
  await expect(graph.locator('.ytitle')).toHaveText('Consensus EPS (USD/share)');
  expect((await drawing(graph)).revision).not.toBe(before.revision);
  await details(widget).focus();
  await page.keyboard.press('Enter');
  await expect(widget.getByRole('list', { name: 'Original estimates for snap-a' })).toContainText('Consensus 0 USD/share');
  await expect(widget.getByRole('list', { name: 'Original estimates for snap-c' })).toContainText('unavailable (earlier estimate is zero or negative)');
  await settings(widget).click();
  await widget.getByLabel('Revision view').selectOption('path');
  await expect(widget.getByText(/Select at least three acquired vintages/i)).toBeVisible();
  await expect(apply(widget)).toBeDisabled();
  await expect(graph.locator('.xtick text')).toHaveCount(2);
  await pin(widget, 'snap-b').check();
  await expect(apply(widget)).toBeEnabled();
  await apply(widget).click();
  await expect(graph.locator('.xtick text')).toHaveCount(3);
  await expect(graph.locator('.scatterlayer .point')).toHaveCount(2);
  await expect(graph.locator('.scatterlayer .js-line[d*="L"]')).toHaveCount(0);
  if (!(await widget.getByRole('list', { name: 'Original estimates for snap-b' }).isVisible())) await details(widget).click();
  await expect(widget.getByRole('list', { name: 'Original estimates for snap-b' })).toContainText('Consensus missing at this vintage');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(async () => (await drawing(graph)).paper).toBe('#1e242e');
  await widget.screenshot({ path: info.outputPath('revisions-dark-gap.png') });
  expect(requests).toEqual([]);
});

test('converges to exact measured dense-tick and six-member surfaces with full tied hover', async ({ page, baseURL }, info) => {
  await page.setViewportSize({ width: 295, height: 1000 });
  const requests = dataRequests(page, baseURL!);
  await seedRevisions(page, revisionPath, false, 14);
  await attachRevisions(page, revisionHistory([revisionDenseValues]), 'dense.json');
  const widget = card(page, chartName), graph = plot(page, chartName);
  await expect(graph.locator('.ytitle')).toHaveText('Consensus EPS (USD/share)');
  await expect.poll(async () => (await drawing(graph)).size).toEqual([379, 230]);
  expect((await drawing(graph)).surface).toEqual([379, 230]);
  const tickLabels = await graph.locator('.xtick text').allTextContents();
  expect(tickLabels).toEqual(['2026-11-1116:00:00.123456Z', '2026-11-1216:00:00.123456Z', '2026-11-1316:00:00.123456Z']);
  const tickBoxes = await graph.locator('.xtick text').evaluateAll(nodes => nodes.map(node => {
    const { left, right } = node.getBoundingClientRect();
    return { left, right };
  }));
  expect(tickBoxes[0].right).toBeLessThan(tickBoxes[1].left);
  expect(tickBoxes[1].right).toBeLessThan(tickBoxes[2].left);
  await widget.screenshot({ path: info.outputPath('revisions-dense-narrow.png') });

  await attachRevisions(page, revisionHistory(revisionTieValues));
  await expect(graph).toHaveCount(0);
  await settings(widget).click();
  await widget.getByLabel('Revision view').selectOption('bump');
  await expect(apply(widget)).toBeEnabled();
  const probe = widget.locator('.estimate-revisions-draft-probe .chart-plot');
  await expect(probe).toHaveCSS('min-width', '320px');
  await expect(probe).toHaveCSS('height', '352px');
  await apply(widget).click();
  await expect(graph.locator('.ytitle')).toHaveText('Percentage revision rank');
  const geometry = await drawing(graph);
  expect(geometry.size).toEqual([320, 352]);
  expect(geometry.surface).toEqual(geometry.size);
  expect(geometry.ranges[1][0]).toBeGreaterThan(geometry.ranges[1][1]);
  expect((await graph.locator('.ytick text').allTextContents()).every(text => /^[1-6]$/.test(text))).toBe(true);
  const first = await point(marker(graph, 0));
  await page.mouse.move(first.x, first.y);
  const legend = graph.locator('.hoverlayer .legend');
  await expect(legend).toContainText('2026-11-11T16:00:00.123456Z');
  for (let i = 0; i < 6; i++) await expect(legend).toContainText(`RANK00${i}.US · rank 1 of 6`);
  const tooltip = (await legend.boundingBox())!, surface = (await graph.boundingBox())!;
  expect(tooltip.x).toBeGreaterThanOrEqual(surface.x - 1);
  expect(tooltip.x + tooltip.width).toBeLessThanOrEqual(surface.x + surface.width + 1);
  expect(tooltip.y).toBeGreaterThanOrEqual(surface.y - 1);
  expect(tooltip.y + tooltip.height).toBeLessThanOrEqual(surface.y + surface.height + 1);
  await widget.screenshot({ path: info.outputPath('revisions-six-member-tie.png') });
  expect(requests).toEqual([]);
});

test('shows unavailable whole rank columns while preserving all original estimates', async ({ page, baseURL }) => {
  const requests = dataRequests(page, baseURL!);
  await seedRevisions(page, revisionBump);
  await attachRevisions(page, revisionHistory([[10, null, 12], [20, 26, 24]]));
  const widget = card(page, chartName), graph = plot(page, chartName);
  await expect(graph.locator('.scatterlayer .point')).toHaveCount(4);
  await details(widget).click();
  await expect(widget.getByRole('region', { name: /snap-b/ })).toContainText('Entire rank column unavailable');
  await expect(widget.getByRole('list', { name: 'Original estimates for snap-b' })).toContainText('Consensus 26 CAD/share');
  expect(requests).toEqual([]);
});

test('uses real touch inspection and fitting zoom, then scrolls the measured overflow with the same question', async ({ browser, baseURL }, info) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, colorScheme: 'dark', baseURL,
    viewport: { width: 680, height: 1050 } });
  try {
    const page = await context.newPage();
    const requests = dataRequests(page, baseURL!);
    await seedRevisions(page, revisionPath);
    await attachRevisions(page, revisionHistory([[-4, -2, 2]]));
    const widget = card(page, chartName), graph = plot(page, chartName);
    await expect(graph.locator('.ytitle')).toHaveText('Consensus EPS (USD/share)');
    const viewport = widget.locator('.linked-chart-plot--revisions .chart-scroll-viewport');
    await expect(viewport).not.toHaveClass(/touch-scroll/);
    const later = await point(marker(graph, 1));
    await page.touchscreen.tap(later.x, later.y);
    await expect(graph.locator('.hoverlayer')).toContainText('Consensus -2 USD/share');
    await expect(graph.locator('.hoverlayer')).toContainText('+2 USD/share');
    await widget.screenshot({ path: info.outputPath('revisions-touch.png') });
    const before = await drawing(graph);
    const box = (await graph.locator('.nsewdrag').boundingBox())!;
    await touchDrag(page, { x: box.x + box.width * .25, y: box.y + box.height * .26 },
      { x: box.x + box.width * .68, y: box.y + box.height * .73 });
    await expect.poll(async () => (await drawing(graph)).ranges).not.toEqual(before.ranges);
    const zoomed = await drawing(graph);
    await page.setViewportSize({ width: 295, height: 1000 });
    await expect(viewport).toHaveClass(/touch-scroll/);
    await expect.poll(async () => (await drawing(graph)).size[0]).toBe(320);
    const narrow = await drawing(graph);
    expect(narrow.ranges).toEqual(zoomed.ranges);
    expect(narrow.revision).toBe(zoomed.revision);
    const scroll = (await viewport.boundingBox())!;
    await touchDrag(page, { x: scroll.x + scroll.width * .84, y: scroll.y + scroll.height / 2 },
      { x: scroll.x + scroll.width * .26, y: scroll.y + scroll.height / 2 });
    await expect.poll(() => viewport.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
    await widget.screenshot({ path: info.outputPath('revisions-touch-narrow.png') });
    expect(requests).toEqual([]);
  } finally { await context.close(); }
});

test('honors File export refusal and repairs missing pinned history only after fresh local reacquisition', async ({ page, context, baseURL }) => {
  const requests = dataRequests(page, baseURL!);
  await seedRevisions(page, revisionSlope);
  const original = revisionHistory([[10, 11, 12]], { unknown: true });
  await attachRevisions(page, original);
  await expect(plot(page, chartName).locator('.ytitle')).toHaveText('Consensus EPS (USD/share)');
  await exportRevisions(page);
  await expect(page.getByText(/export refused.*MISSING_LOCAL_ASSET/i)).toBeVisible();
  const path = 'exports/' + workspace + '.apps.json';
  expect(await read(page, path)).toBeUndefined();
  await chooseRevisionSource(page, placeholder);
  await card(page, sampleName).getByRole('button', { name: 'Remove card', exact: true }).click();
  await expect(card(page, sampleName)).toHaveCount(0);
  await exportRevisions(page);
  await expect.poll(() => read(page, path)).toBeDefined();
  const text = (await read(page, path))!;
  expect(JSON.parse(text)[0].extensions.bdobb.cards[0].extras.linkedChart.recipe).toEqual(revisionSlope);
  expect(text).not.toMatch(/chart_sources|estimateRevisionsSurface|viewport|batch-c|2026-11-13T|ALFA\.US|example\/shares/);

  const fresh = await context.newPage();
  try {
    const reacquired = dataRequests(fresh, baseURL!);
    await seedRevisions(fresh, undefined, true);
    await dropFile(fresh, 'revisions.apps.json', text);
    await fresh.getByRole('tab', { name: tab, exact: true }).click();
    const widget = card(fresh, chartName), graph = plot(fresh, chartName);
    await expect(graph).toHaveCount(0);
    await attachRevisions(fresh, original.rows, 'unsupported.json');
    await expect(widget.getByText(/Load a verified local history/i)).toBeVisible();
    await attachRevisions(fresh, revisionHistory([[10, 11, 12]], { unknown: true, missing: 'snap-c' }));
    await expect(widget.getByText(/A pinned acquired vintage is unavailable/i)).toBeVisible();
    await expect(graph).toHaveCount(0);
    await settings(widget).click();
    await expect(apply(widget)).toBeDisabled();
    await pin(widget, 'snap-c').click();
    await expect(pin(widget, 'snap-c')).toHaveCount(0);
    await pin(widget, 'snap-b').check();
    await expect(apply(widget)).toBeEnabled();
    await apply(widget).click();
    await expect(graph.locator('.xtick text').last()).toHaveText('2026-11-1216:00:00.123456Z');
    expect(requests).toEqual([]);
    expect(reacquired).toEqual([]);
  } finally { await fresh.close(); }
});

test('refuses legacy live fiscal targets and relative estimate fields without acquiring history', async ({ page, baseURL }) => {
  const requests = dataRequests(page, baseURL!);
  await seedRevisions(page, revisionSlope, false, 25, true);
  const widget = card(page, chartName);
  await expect(card(page, liveTitle).getByText('2027-03-31')).toBeVisible();
  await expect(widget.getByText(/Fiscal target dates and live estimate rows do not establish vintages/i)).toBeVisible();
  await settings(widget).click();
  await expect(widget.getByRole('option', { name: /Bump/ })).toHaveAttribute('disabled', '');
  await widget.getByLabel('Revision view').selectOption('path');
  await expect(apply(widget)).toBeDisabled();
  await expect(plot(page, chartName)).toHaveCount(0);
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every(url => url.startsWith(liveOrigin + livePath))).toBe(true);
});
