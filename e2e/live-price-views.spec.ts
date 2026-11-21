// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { existsSync, readFileSync } from 'node:fs';
import { expect, type Locator, type Page } from '@playwright/test';
import { card, openParameters, plot, plotlyTraces, recordRecipeReplies } from './fixtures/chart-recipes';
import {
  dropFile, holdResponse, livePayload, liveSourceId, liveTable, mockRitaPriceReads,
  prepareLiveReturns, returnChart, saveWorkspace, test,
} from './fixtures/return-summary';

const example = new URL('../docs/examples/v10-live-price-views.apps.json', import.meta.url);
const workspace = 'Live price views';
const viewsTab = 'AAPL and MCD price views';
const histogram = 'Observed return distribution';
const drawdown = 'Observed drawdown';
const multiples = 'Observed price comparison';
const sourceTable = 'EODHD AAPL and MCD daily prices';
const chartTypes = [
  [histogram, 'return-distribution', 'Observed quote-to-quote returns; exchange-session completeness unknown.'],
  [drawdown, 'drawdown', 'Drawdown uses observed adjusted prices in the loaded history; exchange-session completeness and peaks during missing observations are unknown.'],
  [multiples, 'small-multiples', 'Indexed observed adjusted prices; exchange-session completeness unknown.'],
] as const;
const fixedQuery = {
  provider: 'eodhd', symbol: 'AAPL.US,MCD.US', interval: '1d', start_date: '2026-10-12', end_date: '2026-11-19', chart_source: 'true',
};
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true }).last().click();
const editStart = async (source: Locator) => {
  const start = (await openParameters(source)).getByLabel('Source start', { exact: true });
  await start.fill('2026-10-13');
  await start.press('Enter');
};
const apply = (panel: Locator) => panel.getByRole('button', { name: 'Apply chart settings', exact: true }).click();
const hide = (widget: Locator) => widget.getByRole('button', { name: 'Hide parameters', exact: true }).click();
const traces = (page: Page, title: string) => plotlyTraces(plot(page, title));
const status = (widget: Locator, text: string) => widget.getByRole('status').getByText(text, { exact: true });
const count = (widget: Locator, n: number, symbol: string, start = '2026-10-13') =>
  status(widget, `N = ${n} observed quote-to-quote returns for ${symbol} from ${start} to 2026-11-19.`);
const queries = (acquisitions: URL[]) => acquisitions.map(url => Object.fromEntries(url.searchParams));
const binTotal = (y: (number | null)[]) => y.reduce<number>((sum, value) => sum + (value ?? 0), 0);

async function importPriceViews(page: Page, manifest?: string) {
  if (manifest === undefined) expect(existsSync(example), 'The importable v10 Live Price Views example exists').toBe(true);
  await dropFile(page, 'v10-live-price-views.apps.json', manifest ?? readFileSync(example, 'utf8'));
  await tab(page, viewsTab);
}

test('synthetic transport: imports the fixed example and applies all three forms without another GET', async ({ page }, info) => {
  const replies = await recordRecipeReplies(page);
  const { acquisitions } = await prepareLiveReturns(page, { empty: true });
  await importPriceViews(page);
  for (const [title, kind, scope] of chartTypes) {
    const widget = card(page, title);
    await expect(plot(page, title)).toBeVisible();
    await expect(status(widget, scope)).toBeVisible();
    await expect(widget.getByRole('button', { name: 'Show parameters', exact: true })).toBeVisible();
    await expect(widget.getByRole('region', { name: 'Parameters' })).toHaveCount(0);
    const panel = await openParameters(widget);
    await expect(panel.getByLabel('Chart type')).toHaveValue(kind);
    await hide(widget);
  }
  const acquired = acquisitions.length;
  expect(acquired).toBeGreaterThan(0);
  expect(queries(acquisitions)).toEqual(Array(acquired).fill(fixedQuery));
  await page.locator('main.dashboard-area').screenshot({ path: info.outputPath('price-views-closed.png') });

  const hist = card(page, histogram);
  await expect(count(hist, 28, 'AAPL.US')).toBeVisible();
  const hp = await openParameters(hist);
  await expect(hp.getByRole('combobox', { name: 'Symbol', exact: true })).toHaveValue('AAPL.US');
  await expect(hp.getByLabel('Bins', { exact: true })).toHaveValue('12');
  await hp.getByRole('combobox', { name: 'Symbol', exact: true }).selectOption('MCD.US');
  await hp.getByLabel('Bins', { exact: true }).fill('7');
  await apply(hp);
  await expect(count(hist, 28, 'MCD.US')).toBeVisible();
  await expect.poll(async () => (await traces(page, histogram))[0]?.y.length).toBe(7);
  await hide(hist);
  await expect((await openParameters(hist)).getByRole('combobox', { name: 'Symbol', exact: true })).toHaveValue('MCD.US');
  await expect(hp.getByLabel('Bins', { exact: true })).toHaveValue('7');
  await hist.screenshot({ path: info.outputPath('histogram-parameters-open.png') });
  await hide(hist);

  const dd = card(page, drawdown);
  const dp = await openParameters(dd);
  await expect(dp.getByLabel('AAPL.US', { exact: true })).toBeChecked();
  await expect(dp.getByLabel('MCD.US', { exact: true })).toBeChecked();
  await dp.getByLabel('MCD.US', { exact: true }).uncheck();
  await apply(dp);
  await expect.poll(async () => (await traces(page, drawdown)).map(t => t.legendgroup)).toEqual(['AAPL.US', 'AAPL.US']);
  await hide(dd);
  await openParameters(dd);
  await expect(dp.getByLabel('AAPL.US', { exact: true })).toBeChecked();
  await expect(dp.getByLabel('MCD.US', { exact: true })).not.toBeChecked();
  await dd.screenshot({ path: info.outputPath('drawdown-parameters-open.png') });
  await hide(dd);

  const small = card(page, multiples);
  const sp = await openParameters(small);
  await expect.poll(async () => (await traces(page, multiples)).map(t => t.name)).toEqual(['AAPL.US', 'MCD.US']);
  await sp.getByLabel('AAPL.US', { exact: true }).uncheck();
  await sp.getByLabel('AAPL.US', { exact: true }).check();
  await apply(sp);
  const order = () => sp.getByRole('group', { name: 'Symbols', exact: true }).locator('label').allTextContents();
  await expect.poll(async () => (await traces(page, multiples)).map(t => [t.name, t.xaxis])).toEqual([['MCD.US', 'x'], ['AAPL.US', 'x2']]);
  await hide(small);
  await openParameters(small);
  await expect.poll(order).toEqual(['MCD.US', 'AAPL.US']);
  await expect(sp.getByLabel('MCD.US', { exact: true })).toBeChecked();
  await expect(sp.getByLabel('AAPL.US', { exact: true })).toBeChecked();
  await small.screenshot({ path: info.outputPath('small-multiples-parameters-open.png') });
  await hide(small);
  expect(acquisitions).toHaveLength(acquired);

  const source = card(page, sourceTable);
  await source.getByRole('button', { name: 'Filter rows' }).click();
  await source.getByLabel('Maximum volume', { exact: true }).fill('1');
  const gap = '2026-10-22'; // The ninth delivered row has volume 2 for each listing.
  await expect(count(hist, 26, 'MCD.US')).toBeVisible();
  await expect(status(hist, 'Preserved 2 price gap(s) from table filtering.')).toBeVisible();
  await expect.poll(async () => binTotal((await traces(page, histogram))[0].y)).toBe(26);
  await expect.poll(async () => {
    const [fill, line] = await traces(page, drawdown);
    return [line.y[line.x.indexOf(gap)], line.connectgaps, fill.x.includes(null), fill.fill];
  }).toEqual([null, false, true, 'toself']);
  await expect.poll(async () => (await traces(page, multiples)).map(t => [
    t.name, t.y[0], t.y[t.x.indexOf(gap)], t.connectgaps,
  ])).toEqual([['MCD.US', 100, null, false], ['AAPL.US', 100, null, false]]);
  expect(acquisitions).toHaveLength(acquired);
  const worker = await replies();
  for (const [, kind] of chartTypes) {
    const latest = worker.filter(event => event.options.kind === kind).at(-1);
    expect(latest?.reply).toMatchObject({ result: { ok: true, notes: expect.arrayContaining(['Preserved 2 price gap(s) from table filtering.']) } });
  }
  await info.attach('synthetic-worker-replies', { body: JSON.stringify(worker), contentType: 'application/json' });
});

test('synthetic transport: refuses ordinary rows without qualified acquisition evidence', async ({ page }) => {
  const { acquisitions } = await prepareLiveReturns(page, {
    empty: true, response: url => ({ results: livePayload(url).results }),
  });
  await importPriceViews(page);
  for (const [title, , scope] of chartTypes) {
    const widget = card(page, title);
    await expect(widget.getByRole('status').filter({ hasText: /^The source must be fully loaded\. Acquisition is unknown\.$/ })).toBeVisible();
    await expect(status(widget, scope)).toHaveCount(0);
    await expect(plot(page, title)).toHaveCount(0);
  }
  await expect(card(page, sourceTable).getByRole('columnheader', { name: /adjusted.close/i })).toBeVisible();
  expect(acquisitions.length).toBeGreaterThan(0);
  expect(queries(acquisitions)).toEqual(Array(acquisitions.length).fill(fixedQuery));
});

test('synthetic transport: retains stale charts on matching failure and retires a held GET after bounds replacement', async ({ page }) => {
  let failing = false;
  let holding = false;
  const old = holdResponse(), next = holdResponse();
  const { acquisitions, requests, completed } = await prepareLiveReturns(page, {
    empty: true, response: async url => {
      if (failing) return new Error('Daily history unavailable');
      if (holding) await (url.searchParams.get('start_date') === fixedQuery.start_date ? old : next).promise;
      return livePayload(url);
    },
  });
  await importPriceViews(page);
  const source = card(page, sourceTable);
  const refresh = () => source.getByRole('button', { name: 'Refresh', exact: true }).click();
  const hist = card(page, histogram);
  await expect(count(hist, 28, 'AAPL.US')).toBeVisible();
  const initial = completed.length;
  failing = true;
  await refresh();
  await expect.poll(() => completed.length).toBe(initial + 1);
  for (const [title] of chartTypes) {
    const widget = card(page, title);
    await expect(widget.getByRole('alert')).toContainText('Daily history unavailable');
    await expect(status(widget, 'Showing completed data (stale).')).toBeVisible();
    await expect(plot(page, title)).toBeVisible();
  }

  failing = false;
  await refresh();
  await expect.poll(() => completed.length).toBe(initial + 2);
  for (const [title] of chartTypes) {
    await expect(card(page, title).getByRole('alert')).toHaveCount(0);
    await expect(status(card(page, title), 'Showing completed data (stale).')).toHaveCount(0);
  }
  await expect(count(hist, 28, 'AAPL.US')).toBeVisible();

  holding = true;
  try {
    const before = acquisitions.length;
    await refresh();
    await expect.poll(() => acquisitions.length).toBe(before + 1);
    const retired = requests.at(-1)!;
    await editStart(source);
    await expect.poll(() => acquisitions.at(-1)?.searchParams.get('start_date')).toBe('2026-10-13');
    for (const [title] of chartTypes) await expect(plot(page, title)).toHaveCount(0);
    old.resolve();
    await expect.poll(() => completed.includes(retired)).toBe(true);
    for (const [title, , scope] of chartTypes) await expect(status(card(page, title), scope)).toHaveCount(0);
    next.resolve();
    await expect(count(hist, 27, 'AAPL.US', '2026-10-14')).toBeVisible();
    await expect.poll(async () => (await traces(page, drawdown)).filter(t => t.mode === 'lines+markers').map(t => t.x[0]))
      .toEqual(['2026-10-13', '2026-10-13']);
    await expect(status(card(page, multiples), 'Shared baseline 100 on 2026-10-13. All panels end on 2026-11-19.')).toBeVisible();
  } finally {
    old.resolve();
    next.resolve();
  }
});

test('synthetic transport: exports chart questions and waits for reacquisition after import', async ({ page, context }) => {
  await prepareLiveReturns(page, { empty: true });
  await importPriceViews(page);
  await expect(count(card(page, histogram), 28, 'AAPL.US')).toBeVisible();
  const exported = await saveWorkspace(page, workspace);
  expect(exported).not.toMatch(/chart_sources|daily-price|retrieved_at|raw_count|acquiredRowCount|priceOmissions|adjusted_close":\d/);
  const fresh = await context.newPage();
  const delivery = holdResponse();
  try {
    const { acquisitions } = await prepareLiveReturns(fresh, {
      empty: true, response: async url => { await delivery.promise; return livePayload(url); },
    });
    await importPriceViews(fresh, exported);
    await expect.poll(() => acquisitions.length).toBeGreaterThan(0);
    expect(queries(acquisitions)).toEqual(Array(acquisitions.length).fill(fixedQuery));
    for (const [title, , scope] of chartTypes) {
      const widget = card(fresh, title);
      await expect(widget).toBeVisible();
      await expect(status(widget, scope)).toHaveCount(0);
      await expect(plot(fresh, title)).toHaveCount(0);
    }
    delivery.resolve();
    for (const [title, , scope] of chartTypes) {
      const widget = card(fresh, title);
      await expect(status(widget, scope)).toBeVisible();
      await expect(widget.getByRole('button', { name: 'Show parameters', exact: true })).toBeVisible();
    }
    await expect(count(card(fresh, histogram), 28, 'AAPL.US')).toBeVisible();
  } finally {
    delivery.resolve();
    await fresh.close();
  }
});

test('synthetic transport: off-tab histogram and Rita follow Run while Rita retains explicit arguments', async ({ page }) => {
  const { ritaUrl, readWithRita } = await mockRitaPriceReads(page, liveSourceId);
  const { acquisitions } = await prepareLiveReturns(page, {
    options: { kind: 'return-distribution', version: 1, fields: { date: 'date', price: 'adjusted_close', symbol: 'symbol' },
      symbol: 'AAPL.US', bins: 12 },
    sourceOffTab: true, runButton: true, ritaUrl, sourceParams: { symbol: fixedQuery.symbol },
  });
  const widget = card(page, returnChart), source = card(page, liveTable);
  await expect(count(widget, 28, 'AAPL.US')).toBeVisible();
  await tab(page, 'Prices');
  await editStart(source);
  await expect(source.locator('.card-stale')).toBeVisible();
  await tab(page, 'Returns');
  await expect(source).toHaveCount(0);
  expect(acquisitions.length).toBeGreaterThan(0);
  expect(queries(acquisitions)).toEqual(Array(acquisitions.length).fill(fixedQuery));

  const pane = page.getByRole('complementary', { name: 'Rita AI pane' });
  await pane.hover();
  await pane.getByRole('button', { name: 'Lock' }).click();
  const explicit = { start_date: '2026-10-15', symbol: 'AAPL.US' };
  async function assertRead(start: string, firstPrice: number, input?: Record<string, string>) {
    const before = acquisitions.length;
    const tool = await readWithRita(input);
    expect(acquisitions.slice(before).map(url => Object.fromEntries(url.searchParams))).toEqual([{ ...fixedQuery, start_date: start, ...input }]);
    expect(tool).toMatchObject({ role: 'tool', function: 'get_widget_data' });
    expect(JSON.parse(tool!.data![0].items![0].content)[0]).toMatchObject({ date: start, adjusted_close: firstPrice });
  }
  await assertRead('2026-10-12', 100);
  await assertRead('2026-10-15', 124, explicit);
  await assertRead('2026-10-12', 100);
  await pane.getByRole('button', { name: 'Lock' }).click();
  await tab(page, 'Prices');
  await expect((await openParameters(source)).getByLabel('Source start', { exact: true })).toHaveValue('2026-10-13');
  await source.getByRole('button', { name: 'Run', exact: true }).click();
  await tab(page, 'Returns');
  await expect(count(widget, 27, 'AAPL.US', '2026-10-14')).toBeVisible();
  await pane.hover();
  await assertRead('2026-10-13', 108);
  await assertRead('2026-10-15', 124, explicit);
  await expect(count(widget, 27, 'AAPL.US', '2026-10-14')).toBeVisible();
});
