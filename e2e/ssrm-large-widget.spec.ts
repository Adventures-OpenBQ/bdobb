// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {test, expect} from '@playwright/test';
import {seedApp, dashboardSeed} from './fixtures';

// The entry shape the API serves for a rewritten large-dataset widget:
// type ssrm_table, endpoint <route>/ssrm, ssrm capabilities. The bare route
// must never be fetched -- it would be the whole (very large) result.
const ROUTE = '/api/v1/large/dataset';
const ENDPOINT = ROUTE + '/ssrm';
const CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'};

test('a rewritten large-dataset widget pages and never issues the full GET', async ({page}) => {
  const bareGets: string[] = [], posts: {url: string; body: Record<string, unknown>}[] = [];
  await page.route('**' + ROUTE + '**', async r => {
    const req = r.request(), url = new URL(req.url());
    if (req.method() === 'OPTIONS') return r.fulfill({status: 204, headers: CORS});
    if (req.method() === 'POST' && url.pathname.endsWith('/ssrm')) {
      const body = req.postDataJSON();
      posts.push({url: req.url(), body});
      const all = Array.from({length: 1205}, (_, i) => ({cusip: `C${i}`, price: i + 1}));
      const rowData = all.slice(body.startRow, Math.min(body.endRow, body.startRow + 1000));
      return r.fulfill({headers: CORS, contentType: 'application/json', body: JSON.stringify({rowData, rowCount: all.length})});
    }
    bareGets.push(`${req.method()} ${url.pathname}`);   // anything else on the route is the failure
    return r.fulfill({status: 500, headers: CORS, body: 'unexpected full GET'});
  });
  // One POST per (startRow, sortModel, filterModel): the open/sort/filter first page is read once, not twice.
  const expectNoDuplicates = () => {
    const keys = posts.map(p => JSON.stringify([p.body.startRow, p.body.sortModel, p.body.filterModel]));
    expect(keys.length).toBe(new Set(keys).size);
  };
  await seedApp(page, dashboardSeed([]));
  await page.evaluate(async ({endpoint}) => {
    const r = '/src/stores/widgetRegistryStore.ts', d = '/src/stores/dashboardStore.ts', n = '/src/lib/widgetsJson.ts';
    const registry = (await import(r)).useWidgetRegistryStore as typeof import('../src/stores/widgetRegistryStore').useWidgetRegistryStore;
    const dashboards = (await import(d)).useDashboardStore as typeof import('../src/stores/dashboardStore').useDashboardStore;
    const normalize = (await import(n)).normalizeWidgets as typeof import('../src/lib/widgetsJson').normalizeWidgets;
    registry.setState(s => ({widgets: s.widgets.filter(w => w.type !== 'keys' && !w.id.includes('provider_api_keys'))}));
    registry.setState(s => ({widgets: [...s.widgets, ...normalize({
      large: {name: 'Large dataset', type: 'ssrm_table', endpoint, params: [{paramName: 'symbol', type: 'text', value: 'AAPL'}], ssrm: {sorting: true, filtering: ['text', 'number']}},
    }, 'b1').widgets]}));
    dashboards.setState({dashboards: [{id: 'd1', name: 'Main', tabs: [{id: 't1', name: 'Main',
      cards: [{id: 'large', widgetId: 'large', backendId: 'b1', params: {symbol: 'AAPL'}, layout: {x: 0, y: 0, w: 40, h: 20}}]}]}], activeId: 'd1', activeTabId: 't1'});
  }, {endpoint: ENDPOINT});
  await expect(page.getByText(/LIVE · paged/)).toBeVisible();
  await expect(page.getByText('C0', {exact: true}).first()).toBeVisible();
  expect(posts.length).toBeGreaterThan(0);
  expectNoDuplicates();
  expect(new URL(posts[0].url).searchParams.get('symbol')).toBe('AAPL');
  expect(posts[0].body).toMatchObject({startRow: 0});

  const before = posts.length;
  await page.getByRole('button', {name: 'price', exact: true}).click();
  await expect.poll(() => posts.length).toBeGreaterThan(before);
  expect(JSON.stringify(posts.at(-1)!.body.sortModel)).toContain('price');
  expectNoDuplicates();

  const afterSort = posts.length;
  await page.getByRole('textbox', {name: 'Filter cusip'}).fill('C12');
  await expect.poll(() => posts.length).toBeGreaterThan(afterSort);
  expect(JSON.stringify(posts.at(-1)!.body.filterModel)).toContain('C12');
  expectNoDuplicates();

  expect(bareGets).toEqual([]);                          // never the whole GET
});
