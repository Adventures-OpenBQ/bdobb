// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Locator, type Page } from '@playwright/test';
import { defaultSeed, read, seedApp } from './fixtures';
import { pivotValueKey } from '../src/lib/pivotKeys';
import { parseFormula } from '../src/lib/tableModel/formulaSyntax';
import { bindFormula } from '../src/lib/tableModel/formulaBinding';
import type { FormulaDef } from '../src/lib/tableModel/types';

const chainFile = '00000000-0000-0000-0000-0000000000c1.csv';
const fxFile = '00000000-0000-0000-0000-0000000000c2.csv';

// Stock fixture: AAA expiries in CSV order 2027-03-19, 2026-12-18, 2027-01-15; iv = put 0.2 + 0.001*|K-S| + 0.01*e, call = put + 0.02, e the chronological expiry index.
const stockFields = ['underlying_symbol', 'eod_date', 'underlying_price', 'expiration', 'dte', 'strike', 'option_type', 'implied_volatility'];
const chrono = ['2026-12-18', '2027-01-15', '2027-03-19'];
const dteOf: Record<string, number> = { '2026-12-18': 29, '2027-01-15': 57, '2027-03-19': 120 };
const stockRows = (symbol: string, spot: number, strikes: number[], expiries: string[]) => expiries.flatMap(expiration => strikes.flatMap(strike => {
  const put = 0.2 + 0.001 * Math.abs(strike - spot) + 0.01 * chrono.indexOf(expiration);
  return [['put', put], ['call', put + 0.02]].map(([type, iv]) => [symbol, '2026-11-19', spot, expiration, dteOf[expiration], strike, type, Number(iv).toFixed(4)].join(','));
}));
const stockCsv = [stockFields.join(','), ...stockRows('AAA', 100, [90, 100, 110], ['2027-03-19', '2026-12-18', '2027-01-15']), ...stockRows('BBB', 50, [45, 50, 55], ['2026-12-18', '2027-01-15'])].join('\n') + '\n';

// FX fixture: no option_type; pip 10000; the three bucket-0 rows at dte 30 carry 0.090, 0.091, 0.095 (median 0.091, mean 0.092).
const fxFields = ['underlying_symbol', 'eod_date', 'underlying_price', 'expiration', 'dte', 'strike', 'implied_volatility', 'pip'];
const fxStrikes: [number, number][] = [[1.095, 50], [1.099, 0], [1.1, 0], [1.1005, 0], [1.103, 25], [1.106, 50], [1.25, 1500]];
const fxTenorIndex: Record<number, number> = { 7: 0, 30: 2, 90: 4 };
const addDays = (days: number) => new Date(Date.UTC(2026, 10, 19) + days * 86400000).toISOString().slice(0, 10);
const fxCsv = [fxFields.join(','), ...[1, 7, 30, 90, 900].flatMap(dte => fxStrikes.map(([strike, bucket], i) => {
  const iv = dte === 30 && bucket === 0 ? [0.09, 0.091, 0.095][i - 1] : 0.08 + 0.01 * (fxTenorIndex[dte] ?? 0) + 0.0001 * bucket;
  return ['EURUSD', '2026-11-19', 1.1, addDays(dte), dte, strike, iv.toFixed(4), 10000].join(',');
}))].join('\n') + '\n';

// Formulas are parsed and bound from their exact text, the way the Formulas tab would save them.
const formulas = (fields: string[], defs: [id: string, text: string][]): FormulaDef[] => {
  const symbols = { fields: fields.map(id => ({ id, name: id })), formulas: defs.map(([id]) => ({ id, name: id, scope: 'source' as const })), measures: [], categories: [] };
  return defs.map(([id, expression]) => {
    const parsed = parseFormula(expression);
    const bound = bindFormula(parsed.ast!, symbols, 'source');
    if (!bound.ast) throw new Error(`${id}: ${JSON.stringify([...parsed.diagnostics, ...bound.diagnostics])}`);
    return { id, name: id, scope: 'source' as const, expression, ast: bound.ast };
  });
};
const cascade = (labels: (string | number)[]) => {
  const cuts = [9, 20, 45, 75, 110, 200, 290, 400, 800].map((cut, i) => [cut, labels[i]] as const);
  return 'IF(dte <= 2, null, ' + cuts.map(([cut, label]) => `IF(dte <= ${cut}, ${typeof label === 'string' ? `"${label}"` : label}, `).join('') + 'null' + ')'.repeat(cuts.length + 1);
};
const tenors = ['1W', '2W', '1M', '2M', '3M', '6M', '9M', '1Y', '2Y'];
const fxFormulas = formulas(fxFields, [
  ['tenor_months', cascade([0.25, 0.5, 1, 2, 3, 6, 9, 12, 24])],
  ['tenor', cascade(tenors)],
  ['root_t', 'IF(tenor_months = null, null, SQRT(tenor_months / 12))'],
  ['strike_points', '(strike - underlying_price) * pip'],
  ['strike_distance', 'IF(strike_points < 0, -strike_points, strike_points)'],
  ['strike_bucket', 'IF(strike_distance > 1250, null, IF(strike_points < 0, -1, 1) * IF(strike_distance < 12.5, 0, IF(strike_distance < 37.5, 25, IF(strike_distance < 75, 50, IF(strike_distance < 125, 100, IF(strike_distance < 200, 150, IF(strike_distance < 375, 250, IF(strike_distance < 750, 500, 1000))))))))'],
]);
const stockFormulas = formulas(stockFields, [
  ['log_moneyness', 'LN(strike / underlying_price)'],
  ['root_t', 'SQRT(dte / 365)'],
  ['quoted', 'IF(implied_volatility > 0.0001, "quoted", "no quote")'],
  ['side', 'IF(option_type = "call", IF(strike >= underlying_price, "OTM call", "ITM call"), IF(strike < underlying_price, "OTM put", "ITM put"))'],
]);

const modelBase = { schemaVersion: 1, params: { promotePage: true, filters: [] }, categories: [], measures: [], formulas: [], layout: { rows: [], columns: [], values: [] }, checklists: [], resultFilters: [], subtotals: { grandTotal: false, groups: false } };
const category = (id: string, sourceFieldId: string, name = id) => ({ id, name, sourceFieldId, transform: 'native' as const });
const measure = (id: string, sourceFieldId: string, aggregation: string) => ({ id, sourceFieldId, aggregation });
const at = (y: number, h: number) => ({ x: 0, y, w: 40, h });
const card = (id: string, title: string, over: Record<string, unknown>) => ({ id, widgetId: 'linked_table', backendId: 'builtin', title, params: {}, ...over });
const source = (file: string, analytical: unknown) => card('chain', 'Chain', { widgetId: 'local_table', params: { file }, layout: at(0, 8), tableDefinition: { table: {}, search: '', analytical } });
const linkedTable = (analytical: unknown) => card('report', 'Report', { layout: at(8, 14), linkedSource: { kind: 'widget', sourceWidgetId: 'chain' }, tableDefinition: { table: {}, search: '', analytical }, tableSelection: { kind: 'none' } });
const linkedChart = (id: string, title: string, sourceId: string, settings: Record<string, unknown>, y: number) => card(id, title, { widgetId: 'linked_chart', layout: at(y, 12), linkedSource: { kind: 'widget', sourceWidgetId: sourceId }, linkedChart: { type: 'column', display: 'grouped', measures: [], ...settings } });
const seed = (file: string, csv: string, cards: unknown[]) => ({ ...defaultSeed(), 'dashboards/d1.json': JSON.stringify({ id: 'd1', name: 'Main', tabs: [{ id: 't1', name: 'Main', cards }] }), [`files/${file}`]: csv });

// What the executor hands a chart for a card, read from the store the way LinkedChartRenderer does.
type Member = { field: string; categoryId?: string; value: unknown; memberKey?: string; label?: string };
type Col = { id: string; label: string; measureId?: string; splitPath?: Member[] };
type Out = { columns: Col[]; rows: { id: string; values: Record<string, unknown>; groupPath?: Member[]; cellErrors?: Record<string, unknown> }[] };
const snapshot = (page: Page, id: string): Promise<Out> => page.evaluate(async id => {
  const path = '/src/stores/tableExecutionStore.ts';
  const store = (await import(path)).tableExecutionStore as import('../src/stores/tableExecutionStore').TableExecutionStore;
  await store.settled('d1');
  const view = store.readView('d1', id);
  return await store.readExecutor('d1', id)!.chartData(view.active!, view.ready!.columns.map(c => c.id), new AbortController().signal) as unknown as Out;
}, id);
// What a linked chart on `linkedId` receives: its source's chartData at the revision the linked card holds.
const received = (page: Page, linkedId: string): Promise<Out> => page.evaluate(async linkedId => {
  const path = '/src/stores/tableExecutionStore.ts';
  const store = (await import(path)).tableExecutionStore as import('../src/stores/tableExecutionStore').TableExecutionStore;
  await store.settled('d1');
  const revision = store.readView('d1', linkedId).sourceRevision!;
  const view = store.readView('d1', revision.widgetId);
  return await store.readExecutor('d1', revision.widgetId)!.chartData(revision, view.ready!.columns.map(c => c.id), new AbortController().signal) as unknown as Out;
}, linkedId);
const leaves = (out: Out) => out.rows.filter(r => r.groupPath?.length === 2);
const cardOf = (page: Page, title: string): Locator => page.locator('.widget-card').filter({ has: page.locator('header').getByText(title, { exact: true }) });

test('stock chain: formulas, side checklist, pivot output and date order reach the report and a chart', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  const chain = { ...modelBase, enabled: false, formulas: stockFormulas, categories: [category('side_cat', 'side', 'Side')],
    params: { promotePage: true, filters: [{ id: 'side', categoryId: 'side_cat', label: 'Side', multiSelect: true }] },
    checklists: [{ categoryId: 'side_cat', memberKeys: [pivotValueKey('OTM call'), pivotValueKey('OTM put')] }] };
  const report = { ...modelBase, enabled: true, categories: [category('underlying', 'underlying_symbol'), category('strike_cat', 'strike', 'Strike'), category('expiry', 'expiration')],
    measures: [measure('iv', 'implied_volatility', 'median'), measure('n', 'implied_volatility', 'count'), measure('lm', 'log_moneyness', 'mean'), measure('rt', 'root_t', 'mean')],
    layout: { rows: ['underlying', 'strike_cat'], columns: ['expiry'], values: ['iv', 'n', 'lm', 'rt'] } };
  await seedApp(page, seed(chainFile, stockCsv, [source(chainFile, chain), linkedTable(report), linkedChart('probe', 'Probe', 'chain', { category: 'strike', measures: ['log_moneyness'] }, 22), linkedChart('follower', 'Follower', 'report', {}, 34)]));

  const out = await snapshot(page, 'report');
  const iv = out.columns.filter(c => c.measureId === 'iv');
  const col = (measureId: string, i = 0) => out.columns.filter(c => c.measureId === measureId)[i];
  const leaf = (u: string, k: number) => out.rows.find(r => r.groupPath?.length === 2 && r.groupPath[0].value === u && r.groupPath[1].value === k)!;
  expect(iv.every(c => c.splitPath?.length === 1)).toBe(true);                                                          // (c)
  expect(iv.map(c => String(c.splitPath![0].label ?? c.splitPath![0].value))).toEqual(['2026-12-18', '2027-01-15', '2027-03-19']); // (d)
  expect(leaf('AAA', 110).values[col('lm').id]).toBeCloseTo(0.0953, 4);            // (a) LN(110 / 100)
  expect(leaf('AAA', 110).values[col('rt').id]).toBeCloseTo(Math.sqrt(29 / 365), 6); // SQRT(dte / 365) at the first expiry
  expect(leaf('AAA', 90).values[iv[0].id]).toBeCloseTo(0.21);   // (b) OTM: put only
  expect(leaf('AAA', 110).values[iv[0].id]).toBeCloseTo(0.23);  // (b) OTM: call only
  expect(Number(leaf('AAA', 90).values[out.columns.find(c => c.measureId === 'n' && c.splitPath![0].memberKey === iv[0].splitPath![0].memberKey)!.id])).toBe(1); // pivot counts are emitted as strings

  // (b) all four sides: tick them in the Side popup on the Chain card.
  const chainCard = cardOf(page, 'Chain');
  await chainCard.getByRole('button', { name: /^Side:/ }).click();
  const popup = page.getByRole('dialog', { name: 'Side values' });
  for (const side of ['OTM call', 'OTM put', 'ITM call', 'ITM put']) await popup.getByLabel(side, { exact: true }).check();
  await popup.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(async () => { const o = await snapshot(page, 'report'); const c = o.columns.filter(x => x.measureId === 'iv')[0]; return o.rows.find(r => r.groupPath?.length === 2 && r.groupPath[0].value === 'AAA' && r.groupPath[1].value === 90)?.values[c.id]; }).toBeCloseTo(0.22, 6);

  // (c) the probe chart on the long table: no alert, one trace.
  const probe = cardOf(page, 'Probe');
  await expect(probe.getByRole('alert')).toHaveCount(0);
  await expect(probe.locator('.js-plotly-plot')).toHaveCount(1);
  await expect.poll(() => probe.locator('.js-plotly-plot').evaluate(el => (el as unknown as { data: unknown[] }).data.length)).toBe(1);

  // (f) selection on the report narrows what a linked card receives.
  const reportCard = cardOf(page, 'Report');
  const leafKeys = (o: Out) => leaves(o).map(r => `${r.groupPath![0].value}/${r.groupPath![1].value}`).sort();
  const all = ['AAA/100', 'AAA/110', 'AAA/90', 'BBB/45', 'BBB/50', 'BBB/55'];
  expect(leafKeys(await received(page, 'follower'))).toEqual(all);
  await reportCard.getByRole('button', { name: 'Expand AAA', exact: true }).click();
  // Rows are numbered in view order: with AAA expanded, 2 is AAA/90 and 4 is AAA/110.
  const rowBox = (n: number) => reportCard.getByRole('checkbox', { name: `Select row ${n}`, exact: true });
  await rowBox(2).click();
  await rowBox(4).click();
  await expect.poll(async () => leafKeys(await received(page, 'follower'))).toEqual(['AAA/110', 'AAA/90']);
  const clear = reportCard.getByRole('button', { name: 'Clear selection', exact: true });
  await clear.click();
  await expect.poll(async () => leafKeys(await received(page, 'follower'))).toEqual(all);
});

test('fx chain without option_type: bucket formulas give null outside the grid and a checklist keeps those rows out (e)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  const chain = { ...modelBase, enabled: false, formulas: fxFormulas };
  const grid = [-1000, -500, -250, -150, -100, -50, -25, 0, 25, 50, 100, 150, 250, 500, 1000];
  const report = { ...modelBase, enabled: true, categories: [category('strike_cat', 'strike_bucket', 'Strike'), category('expiry', 'tenor')],
    checklists: [{ categoryId: 'expiry', memberKeys: tenors.map(pivotValueKey) }, { categoryId: 'strike_cat', memberKeys: grid.map(pivotValueKey) }],
    measures: [measure('iv', 'implied_volatility', 'median'), measure('n', 'implied_volatility', 'count'), measure('rt', 'root_t', 'mean')],
    layout: { rows: ['strike_cat'], columns: ['expiry'], values: ['iv', 'n', 'rt'] } };
  await seedApp(page, seed(fxFile, fxCsv, [source(fxFile, chain), linkedTable(report)]));

  const out = await snapshot(page, 'report');
  expect(out.rows.every(r => (r.groupPath ?? []).every(m => m.value !== null && m.value !== '' && m.label !== ''))).toBe(true);
  expect(out.columns.every(c => (c.splitPath ?? []).every(m => m.value !== null && m.value !== '' && m.label !== ''))).toBe(true);
  expect(JSON.stringify(out.rows.map(r => [r.values, r.cellErrors]))).not.toContain('#ERROR');
  expect(out.rows.filter(r => r.groupPath?.length === 1 && r.groupPath[0].value === 0)).toHaveLength(1);
  const split = (measureId: string, tenor: string) => out.columns.find(c => c.measureId === measureId && c.splitPath?.[0].value === tenor)!;
  const zero = out.rows.find(r => r.groupPath?.[0].value === 0)!;
  expect(Number(zero.values[split('iv', '1M').id])).toBeCloseTo(0.091, 9);
  expect(Number(zero.values[split('n', '1M').id])).toBe(3);
  expect(Number(zero.values[split('rt', '1M').id])).toBeCloseTo(Math.sqrt(1 / 12), 6);
});

test("report's own checklists: the outer category picks the underlyings, a non-layout category drops placeholder vols (g)(h)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  const csv = stockCsv + ['AAA', '2026-11-19', 100, '2026-12-18', 29, 90, 'put', '0.00001'].join(',') + '\n';
  const chain = { ...modelBase, enabled: false, formulas: stockFormulas, categories: [category('side_cat', 'side', 'Side')],
    params: { promotePage: true, filters: [{ id: 'side', categoryId: 'side_cat', label: 'Side', multiSelect: true }] },
    checklists: [{ categoryId: 'side_cat', memberKeys: [pivotValueKey('OTM call'), pivotValueKey('OTM put')] }] };
  const quoteList = { categoryId: 'quote_cat', memberKeys: [pivotValueKey('quoted')] };
  const report = { ...modelBase, enabled: true, categories: [category('underlying', 'underlying_symbol'), category('strike_cat', 'strike', 'Strike'), category('expiry', 'expiration'), category('quote_cat', 'quoted', 'Quoted')],
    measures: [measure('iv', 'implied_volatility', 'median'), measure('n', 'implied_volatility', 'count'), measure('lm', 'log_moneyness', 'mean'), measure('rt', 'root_t', 'mean')],
    layout: { rows: ['underlying', 'strike_cat'], columns: ['expiry'], values: ['iv', 'n', 'lm', 'rt'] }, checklists: [quoteList] };
  await seedApp(page, seed(chainFile, csv, [source(chainFile, chain), linkedTable(report), linkedChart('follower', 'Follower', 'report', {}, 22)]));

  const out = await snapshot(page, 'report');
  const iv0 = out.columns.find(c => c.measureId === 'iv')!;
  const n0 = out.columns.find(c => c.measureId === 'n' && c.splitPath![0].memberKey === iv0.splitPath![0].memberKey)!;
  const cell = out.rows.find(r => r.groupPath?.length === 2 && r.groupPath[0].value === 'AAA' && r.groupPath[1].value === 90)!;
  expect(cell.values[iv0.id]).toBeCloseTo(0.21);   // (h) not 0.105
  expect(Number(cell.values[n0.id])).toBe(1);
  const leafKeys = (o: Out) => leaves(o).map(r => `${r.groupPath![0].value}/${r.groupPath![1].value}`).sort();
  const all = ['AAA/100', 'AAA/110', 'AAA/90', 'BBB/45', 'BBB/50', 'BBB/55'];
  expect(leafKeys(await received(page, 'follower'))).toEqual(all); // (g) no underlying checklist
  const saved = async () => (JSON.parse((await read(page, 'dashboards/d1.json'))!).tabs[0].cards[1].tableDefinition.analytical.checklists as { categoryId: string; memberKeys: string[] }[]);
  expect(await saved()).toEqual([quoteList]);

  const reportCard = cardOf(page, 'Report');
  await reportCard.getByRole('button', { name: 'Pivot', exact: true }).click();
  await reportCard.getByRole('tab', { name: 'Category filters', exact: true }).click();
  await reportCard.getByRole('combobox', { name: 'Checklist category', exact: true }).selectOption('underlying');
  await reportCard.getByRole('checkbox', { name: /^AAA \(/ }).uncheck();
  await reportCard.getByRole('button', { name: 'Apply checklist', exact: true }).click();
  await expect.poll(async () => leafKeys({ ...out, rows: leaves(await snapshot(page, 'report')) } as Out)).toEqual(['BBB/45', 'BBB/50', 'BBB/55']);
  await expect.poll(async () => leafKeys(await received(page, 'follower'))).toEqual(['BBB/45', 'BBB/50', 'BBB/55']);
  expect(await saved()).toEqual([quoteList, { categoryId: 'underlying', memberKeys: [pivotValueKey('BBB')] }]);

  await reportCard.getByRole('checkbox', { name: /^AAA \(/ }).check();
  await reportCard.getByRole('button', { name: 'Apply checklist', exact: true }).click();
  await expect.poll(async () => leafKeys(await snapshot(page, 'report'))).toEqual(all);
  await expect.poll(async () => leafKeys(await received(page, 'follower'))).toEqual(all);
  expect((await saved()).find(l => l.categoryId === 'underlying')?.memberKeys.sort()).toEqual([pivotValueKey('AAA'), pivotValueKey('BBB')]);
});
