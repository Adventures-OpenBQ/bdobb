// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { expect, test as base, type Locator, type Page } from '@playwright/test';
import { openRail, read } from './fixtures';
import { card, openParameters, plot } from './fixtures/chart-recipes';
import {
  alternateLiveOrigin, chooseReturnSource, dropFile, liveBackendId, liveOrigin, livePath, livePayload, liveRecipe, liveSourceId,
  liveTable, liveWorkspace, prepareLiveReturns, returnChart,
} from './fixtures/return-summary';

const scope = 'Observed quote-to-quote returns; exchange-session completeness unknown.';
const apply = (widget: Locator) => widget.getByRole('button', { name: 'Apply chart settings' });
const boxes = (graph: Locator) => graph.locator('.boxlayer path.box');
const violins = (graph: Locator) => graph.locator('.scatterlayer path.js-fill');
const listings = (graph: Locator) => graph.locator('.xtick text');
const refresh = (page: Page) => card(page, liveTable).getByRole('button', { name: 'Refresh', exact: true }).click();
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true }).last().click();
const edit = async (source: Locator, field: string, value: string) => {
  const control = source.getByLabel(field, { exact: true });
  await control.fill(value);
  await control.press('Enter');
};
const fixedQuery = {
  provider: 'eodhd', symbol: 'MCD.US,AAPL.US', interval: '1d', start_date: '2026-10-12', end_date: '2026-11-19', chart_source: 'true',
};

const test = base.extend<{ engineEvidence: void }>({
  engineEvidence: [async ({ page, browser, browserName }, use, info) => {
    await page.setViewportSize({ width: 1250, height: 930 });
    const wasm: string[] = [];
    page.on('response', response => {
      if (response.ok() && /\/pivot_wasm_bg(?:-[\w-]+)?\.wasm$/.test(new URL(response.url()).pathname)
        && response.headers()['content-type']?.includes('application/wasm')) wasm.push(response.url());
    });
    await use();
    const engine = process.env.VITE_TABLE_ENGINE || 'typescript';
    await info.attach('return-runtime', {
      body: JSON.stringify({ engine, browserName, browserVersion: browser.version(), wasm }), contentType: 'application/json',
    });
    if (info.status === 'passed') expect(wasm.length > 0).toBe(engine === 'rust');
  }, { auto: true }],
});

test('authors observed boxes and violins from the daily-price source and measures filtered common pins without another GET', async ({ page }, info) => {
  const { acquisitions, requests } = await prepareLiveReturns(page);
  const widget = card(page, returnChart), source = card(page, liveTable), graph = plot(page, returnChart);
  await expect(source.getByRole('columnheader', { name: /adjusted.close/i })).toBeVisible();
  await expect(graph.locator('.barlayer path').first()).toBeVisible();
  const acquired = acquisitions.length;
  expect(acquired).toBeGreaterThan(0);
  expect(requests.map(request => request.method())).toEqual(Array(acquired).fill('GET'));
  expect(acquisitions.map(url => Object.fromEntries(url.searchParams))).toEqual(Array(acquired).fill(fixedQuery));
  await expect(widget.getByRole('button', { name: 'Show parameters' })).toBeVisible();
  await expect(widget.getByLabel('Chart type')).toBeHidden();
  await widget.screenshot({ path: info.outputPath('parameters-closed.png') });
  await openParameters(widget);
  await widget.getByLabel('Chart type').selectOption('return-summary');
  await widget.getByLabel('MCD.US', { exact: true }).check();
  await widget.getByLabel('AAPL.US', { exact: true }).check();
  await expect(apply(widget)).toBeEnabled();
  await apply(widget).click();
  await expect(boxes(graph)).toHaveCount(2);
  await expect(listings(graph)).toHaveText([/MCD\.US.*N = 28/, /AAPL\.US.*N = 28/]);
  await expect(widget.getByText(scope, { exact: true })).toBeVisible();
  const summary = widget.getByText('Return listing details', { exact: true });
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(widget.getByText(/28 observed adjusted-price returns · 2026-10-13 to 2026-11-19/)).toBeVisible();
  await expect(widget.getByText(/pair may span multiple exchange sessions/i)).toBeVisible();
  await widget.screenshot({ path: info.outputPath('observed-box.png') });
  const boxValues = await widget.locator('.return-summary-details dd').allTextContents();
  await openParameters(widget);
  await widget.getByLabel('Return view').selectOption('violin');
  await widget.getByRole('button', { name: 'Hide parameters' }).click();
  await expect(boxes(graph)).toHaveCount(2);
  await openParameters(widget);
  await expect(widget.getByLabel('Return view')).toHaveValue('violin');
  await apply(widget).click();
  await expect(violins(graph)).toHaveCount(2);
  await expect(listings(graph)).toHaveText([/MCD\.US.*N = 28/, /AAPL\.US.*N = 28/]);
  await summary.click();
  await expect(widget.locator('.return-summary-details dd')).toHaveText(boxValues);
  await widget.screenshot({ path: info.outputPath('observed-violin.png') });
  await source.getByRole('button', { name: 'Filter rows' }).click();
  await source.getByLabel('Maximum volume', { exact: true }).fill('1');
  await expect(listings(graph)).toHaveText([/MCD\.US.*N = 26/, /AAPL\.US.*N = 26/]);
  await expect(widget).toContainText('Preserved 2 price gap(s) from table filtering.');
  await openParameters(widget);
  await widget.getByLabel('Return window').selectOption('common');
  await expect(widget.getByLabel('Start date')).toHaveValue('2026-10-12');
  await expect(widget.getByLabel('End date')).toHaveValue('2026-11-19');
  await widget.getByLabel('Start date').fill('2026-10-13');
  await widget.getByLabel('End date').fill('2026-11-18');
  await expect(apply(widget)).toBeEnabled();
  await apply(widget).click();
  await expect(listings(graph)).toHaveText([/MCD\.US.*N = 24/, /AAPL\.US.*N = 24/]);
  await expect(widget).toContainText('Common inclusive bounds 2026-10-13 to 2026-11-18');
  await widget.getByRole('button', { name: 'Hide parameters' }).click();
  await openParameters(widget);
  await expect(widget.getByLabel('Return view')).toHaveValue('violin');
  await expect(widget.getByLabel('Start date')).toHaveValue('2026-10-13');
  await expect(widget.getByLabel('End date')).toHaveValue('2026-11-18');
  expect(acquisitions).toHaveLength(acquired);
});

test('ordinary historical rows stay visible while both return views remain ineligible', async ({ page }) => {
  const { acquisitions } = await prepareLiveReturns(page, { optIn: false });
  const widget = card(page, returnChart), graph = plot(page, returnChart);
  await expect(card(page, liveTable).getByRole('columnheader', { name: /adjusted.close/i })).toBeVisible();
  await expect(graph.locator('.barlayer path').first()).toBeVisible();
  await openParameters(widget);
  await widget.getByLabel('Chart type').selectOption('return-summary');
  await expect(widget.getByText(/choose a verified EODHD daily-price acquisition/i)).toBeVisible();
  await expect(widget.getByLabel('Return view')).toBeDisabled();
  await expect(apply(widget)).toBeDisabled();
  await expect(boxes(graph)).toHaveCount(0);
  expect(acquisitions.every(url => url.searchParams.get('chart_source') === 'false')).toBe(true);
});

test('retains one stale chart on matching failure and retires a held result after bounds replacement', async ({ page }, info) => {
  let fail = false;
  let hold = false;
  const original = holdResponse(), replacement = holdResponse();
  const { acquisitions, requests, completed } = await prepareLiveReturns(page, { options: liveRecipe, response: async url => {
    if (fail) return new Error('Daily history unavailable');
    if (hold) await (url.searchParams.get('start_date') === fixedQuery.start_date ? original : replacement).promise;
    return livePayload(url);
  } });
  const widget = card(page, returnChart), graph = plot(page, returnChart), source = card(page, liveTable);
  await expect(boxes(graph)).toHaveCount(2);
  fail = true;
  await refresh(page);
  await expect(widget.getByRole('alert')).toHaveCount(1);
  await expect(widget.getByRole('alert')).toContainText('Daily history unavailable');
  await expect(widget.getByText('Showing completed data (stale).', { exact: true })).toBeVisible();
  await expect(boxes(graph)).toHaveCount(2);
  await widget.screenshot({ path: info.outputPath('matching-failed-refresh.png') });
  fail = false;
  await refresh(page);
  await expect(widget.getByRole('alert')).toHaveCount(0);
  await expect(widget.getByText('Showing completed data (stale).', { exact: true })).toHaveCount(0);
  await expect(listings(graph)).toHaveText([/MCD\.US.*N = 28/, /AAPL\.US.*N = 28/]);

  const before = acquisitions.length;
  hold = true;
  await refresh(page);
  await expect.poll(() => acquisitions.length).toBe(before + 1);
  const retired = requests.at(-1)!;
  await edit(await openParameters(source), 'Source start', '2026-10-13');
  await expect.poll(() => acquisitions.at(-1)?.searchParams.get('start_date')).toBe('2026-10-13');
  await expect(boxes(graph)).toHaveCount(0);
  original.resolve();
  await expect.poll(() => completed.includes(retired)).toBe(true);
  await expect(widget.getByText(scope, { exact: true })).toHaveCount(0);
  replacement.resolve();
  await expect(listings(graph)).toHaveText([/MCD\.US.*N = 27/, /AAPL\.US.*N = 27/]);
  await expect(widget.getByRole('alert')).toHaveCount(0);
});

function holdResponse() {
  let release = () => {};
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, resolve: release };
}

for (const replacementKind of ['symbol', 'interval', 'backend', 'selector', 'credential'] as const) {
  test(`retires a held live result when the ${replacementKind} is replaced`, async ({ page }) => {
    const old = holdResponse(), next = holdResponse();
    let held = 0;
    let holding = false;
    const { requests, completed } = await prepareLiveReturns(page, { options: liveRecipe, response: async url => {
      if (holding) await (++held === 1 ? old : next).promise;
      const payload = livePayload(url);
      return { ...payload, ordinary_rows: payload.results };
    } });
    const graph = plot(page, returnChart), widget = card(page, returnChart), source = card(page, liveTable);
    await expect(boxes(graph)).toHaveCount(2);
    holding = true;
    await refresh(page);
    await expect.poll(() => held).toBe(1);
    const retired = requests.at(-1)!;
    if (replacementKind === 'symbol') await edit(await openParameters(source), 'Symbol', 'AAPL.US,MCD.US');
    if (replacementKind === 'interval') await edit(await openParameters(source), 'Interval', '1W');
    if (replacementKind === 'selector') {
      // Change the discovering widget definition as a server catalogue update
      // would. The existing card ID and URL are preserved.
      await page.evaluate(async widgetBackend => {
        const path = '/src/stores/widgetRegistryStore.ts';
        const { useWidgetRegistryStore } = await import(path) as typeof import('../src/stores/widgetRegistryStore');
        useWidgetRegistryStore.setState(state => ({
          widgets: state.widgets.map(widget => widget.backendId === widgetBackend ? { ...widget, dataKey: 'ordinary_rows' } : widget),
        }));
      }, liveBackendId);
    }
    if (replacementKind === 'backend' || replacementKind === 'credential') {
      await page.evaluate(async ({ id, alternate, kind }) => {
        const path = '/src/stores/backendsStore.ts';
        const { useBackendsStore } = await import(path) as typeof import('../src/stores/backendsStore');
        useBackendsStore.setState(state => ({
          backends: state.backends.map(backend => backend.id !== id ? backend : kind === 'backend'
            ? { ...backend, baseUrl: alternate } : { ...backend, headerName: 'X-Fixture-Credential', headerValue: 'replacement' }),
        }));
      }, { id: liveBackendId, alternate: alternateLiveOrigin, kind: replacementKind });
    }
    await expect.poll(() => held).toBeGreaterThanOrEqual(2);
    const request = requests.at(-1)!;
    const url = new URL(request.url());
    if (replacementKind === 'symbol') expect(url.searchParams.get('symbol')).toBe('AAPL.US,MCD.US');
    if (replacementKind === 'interval') expect(url.searchParams.get('interval')).toBe('1W');
    if (replacementKind === 'backend') expect(url.origin).toBe(alternateLiveOrigin);
    if (replacementKind === 'credential') expect((await request.allHeaders())['x-fixture-credential']).toBe('replacement');
    await expect(boxes(graph)).toHaveCount(0);
    old.resolve();
    await expect.poll(() => completed.includes(retired)).toBe(true);
    await expect(widget.getByText(scope, { exact: true })).toHaveCount(0);
    next.resolve();
    if (replacementKind === 'interval' || replacementKind === 'selector') {
      await expect(card(page, liveTable).getByRole('columnheader', { name: /adjusted.close/i })).toBeVisible();
      await expect(widget).toContainText(/local adjusted-price snapshot/i);
      await expect(boxes(graph)).toHaveCount(0);
    } else await expect(listings(graph)).toHaveText([/MCD\.US.*N = 28/, /AAPL\.US.*N = 28/]);
  });
}

async function saveWorkspace(page: Page, name: string) {
  await openRail(page);
  await page.locator('nav.left-rail').getByRole('button', { name, exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Save…' }).click();
  await page.getByRole('menuitem', { name: 'BDOBB Workspace', exact: true }).click();
  const path = 'exports/' + name + '.apps.json';
  await expect.poll(() => read(page, path)).toBeDefined();
  return (await read(page, path))!;
}

test('exports only the question, reacquires it after import, and refuses portable live authority', async ({ page, context }) => {
  const options = { ...liveRecipe, window: { mode: 'common', start: '2026-10-13', end: '2026-11-18' } } as const;
  await prepareLiveReturns(page, { options });
  await expect(boxes(plot(page, returnChart))).toHaveCount(2);
  const text = await saveWorkspace(page, liveWorkspace);
  expect(text).not.toMatch(/chart_sources|daily-price|retrieved_at|raw_count|acquiredRowCount|priceOmissions|returnSummary/);
  expect(JSON.parse(text)[0].extensions.bdobb.cards[0].extras.linkedChart.recipe).toEqual(options);

  const fresh = await context.newPage();
  const { acquisitions } = await prepareLiveReturns(fresh, { empty: true });
  await dropFile(fresh, 'observed.apps.json', text);
  await tab(fresh, 'Returns');
  const widget = card(fresh, returnChart), graph = plot(fresh, returnChart);
  await expect(listings(graph)).toHaveText([/MCD\.US.*N = 26/, /AAPL\.US.*N = 26/]);
  expect(acquisitions.length).toBeGreaterThan(0);
  expect(acquisitions.map(url => Object.fromEntries(url.searchParams))).toEqual(Array(acquisitions.length).fill(fixedQuery));
  const url = new URL(liveOrigin + livePath + '?' + new URLSearchParams(fixedQuery));
  const reply = livePayload(url);
  if (!('extra' in reply)) throw new Error('Expected live evidence in the portable-proof refusal fixture.');
  const rows = reply.results;
  await dropFile(fresh, 'saved-delivery.json', JSON.stringify({ rows, ...reply.extra.results_metadata }));
  await chooseReturnSource(fresh, 'saved-delivery.json');
  await expect(widget).toContainText('Could not parse local table');
  await expect(boxes(graph)).toHaveCount(0);
  await dropFile(fresh, 'ordinary-local.json', JSON.stringify(rows));
  await chooseReturnSource(fresh, 'ordinary-local.json');
  await expect(widget).toContainText(/local adjusted-price snapshot/i);
  await expect(boxes(graph)).toHaveCount(0);
  await dropFile(fresh, 'documented-local.json', JSON.stringify({ rows, completeness: 'bounded',
    receipt: { interval: '1d', start_date: fixedQuery.start_date, end_date: fixedQuery.end_date } }));
  await chooseReturnSource(fresh, 'documented-local.json');
  await expect(listings(graph)).toHaveText([/MCD\.US.*N = 26/, /AAPL\.US.*N = 26/]);
  await expect(widget.getByText(scope, { exact: true })).toHaveCount(0);
});

test('imports the fixed live examples against the generated mirror widget', async ({ page }) => {
  const source = readFileSync(new URL('../docs/examples/v9-next-return-box-violin.apps.json', import.meta.url), 'utf8');
  const { acquisitions } = await prepareLiveReturns(page, { empty: true });
  await dropFile(page, 'fixed-live-examples.apps.json', source);
  await tab(page, 'AAPL and MCD observed returns');
  const title = 'Observed return boxes and violins';
  await expect(card(page, title).getByText(scope, { exact: true })).toBeVisible();
  await expect(listings(plot(page, title))).toHaveText([/AAPL\.US.*N = 28/, /MCD\.US.*N = 28/]);
  await expect(card(page, title).getByRole('button', { name: 'Show parameters' })).toBeVisible();
  const matching = { ...fixedQuery, symbol: 'AAPL.US,MCD.US' };
  expect(acquisitions.length).toBeGreaterThan(0);
  expect(acquisitions.map(url => Object.fromEntries(url.searchParams))).toEqual(Array(acquisitions.length).fill(matching));
});

for (const pinned of [false, true]) {
  test(`Rita reads the committed ${pinned ? 'pinned' : 'configured'} source off-tab and preserves explicit overrides across Run`, async ({ page }) => {
    const ritaUrl = 'http://127.0.0.1:17917';
    let round = 0;
    let override: Record<string, string> | undefined;
    type RitaMessage = { role: string; function?: string; data?: { items?: { content: string }[] }[] };
    let lastTool: RitaMessage | undefined;
    await page.route(ritaUrl + '/**', async route => {
      const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' };
      const request = route.request();
      if (request.method() !== 'POST') {
        await route.fulfill({ headers, json: {} });
        return;
      }
      const { messages } = request.postDataJSON() as { messages: RitaMessage[] };
      const firstRound = round++ % 2 === 0;
      if (!firstRound) lastTool = messages.filter(message => message.role === 'tool').at(-1);
      const event = firstRound ? 'copilotFunctionCall' : 'copilotMessageChunk';
      const body = firstRound ? { function: 'get_widget_data', input_arguments: {
        data_sources: [{ widget_uuid: liveSourceId, origin: liveBackendId, input_args: override }],
      } } : { delta: 'Fixture read ' + round / 2 + '.' };
      await route.fulfill({ headers, contentType: 'text/event-stream', body: 'event: ' + event + '\ndata: ' + JSON.stringify(body) + '\n\n' });
    });
    const { acquisitions } = await prepareLiveReturns(page, { options: liveRecipe, sourceOffTab: true,
      runButton: true, pinned, ritaUrl });
    const widget = card(page, returnChart), graph = plot(page, returnChart), source = card(page, liveTable);
    await expect(boxes(graph)).toHaveCount(2);
    await expect(source).toHaveCount(0);
    await tab(page, 'Prices');
    const controls = await openParameters(source);
    await edit(controls, 'Source start', '2026-10-13');
    await expect(source.locator('.card-stale')).toBeVisible();
    await tab(page, 'Returns');
    await tab(page, 'Prices');
    await expect((await openParameters(source)).getByLabel('Source start', { exact: true })).toHaveValue('2026-10-13');
    await tab(page, 'Returns');
    expect(acquisitions.every(url => url.searchParams.get('start_date') === fixedQuery.start_date)).toBe(true);

    const pane = page.getByRole('complementary', { name: 'Rita AI pane' });
    await pane.hover();
    await pane.getByRole('button', { name: 'Lock' }).click();
    let turn = 0;
    async function ask(start: string, firstPrices: { symbol?: string; adjusted_close: number }[], input?: Record<string, string>) {
      override = input;
      lastTool = undefined;
      const textbox = pane.getByRole('textbox', { name: 'Message Rita' });
      await textbox.fill('Read the historical source ' + (++turn));
      const before = acquisitions.length;
      await textbox.press('Enter');
      await expect(pane.getByText('Fixture read ' + turn + '.', { exact: true })).toBeVisible();
      expect(acquisitions.slice(before).map(url => Object.fromEntries(url.searchParams))).toEqual([
        { ...fixedQuery, start_date: start, symbol: input?.symbol ?? fixedQuery.symbol },
      ]);
      expect(lastTool).toMatchObject({
        role: 'tool', function: 'get_widget_data',
        data: [{ items: [{ content: expect.any(String), data_format: { data_type: 'object', parse_as: 'table' }, citable: true }] }],
      });
      const rows = JSON.parse(lastTool!.data![0].items![0].content) as { symbol?: string; date: string; adjusted_close: number }[];
      expect(rows).toEqual(expect.any(Array));
      const deliveredListings = [...new Set(rows.map(row => row.symbol))];
      expect(deliveredListings).toEqual(firstPrices.map(price => price.symbol));
      for (const price of firstPrices) {
        expect(rows.find(row => row.symbol === price.symbol)).toMatchObject({ ...price, date: start });
      }
    }
    const originalPrices = [{ symbol: 'AAPL.US', adjusted_close: 100 }, { symbol: 'MCD.US', adjusted_close: 100 }];
    await ask('2026-10-12', originalPrices);
    // A single-listing response binds its identity in the request and has no symbol column.
    await ask('2026-10-15', [{ adjusted_close: 124 }], { start_date: '2026-10-15', symbol: 'AAPL.US' });
    await ask('2026-10-12', originalPrices);
    await pane.getByRole('button', { name: 'Lock' }).click();
    await tab(page, 'Prices');
    await source.getByRole('button', { name: 'Run', exact: true }).click();
    await tab(page, 'Returns');
    await expect(listings(graph)).toHaveText([/MCD\.US.*N = 27/, /AAPL\.US.*N = 27/]);
    await expect(widget.getByText(scope, { exact: true })).toBeVisible();
    await pane.hover();
    await ask('2026-10-13', [{ symbol: 'AAPL.US', adjusted_close: 108 }, { symbol: 'MCD.US', adjusted_close: 105 }]);
  });
}
