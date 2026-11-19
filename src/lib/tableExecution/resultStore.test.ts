// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { compileAnalyticalModel } from '../tableModel/calculate';
import { it, expect } from 'vitest';
import { datasetFromBytes } from '../localTableData';
import { preparePrices } from '../widgetData/chartRecipes/input';
import { priceDataset, priceFields } from '../widgetData/chartRecipes/fixtures';
import { toggleGroupSelection } from '../widgetData/tableOutput';
import { calculateView } from './engine';
import { createResultStore } from './resultStore';
import { input, definition, revision } from './fixtures';
it('blocksDoNotChangeMeanOrLast', () => {
  const v = calculateView(input, definition, { kind: 'none' });
  const s = createResultStore(v, revision);
  for (const limit of [1, 2]) {
    s.rows('block', revision, { groupPath: [], offset: 1, limit });

    expect(s.totals('total', revision).values.revenue).toBe(40);
    expect(s.rows('first', revision, { groupPath: [], offset: 0, limit }).siblingCount).toBe(2);
  }

  expect(s.totals('total', revision).values.date).toBe('2026-01-03');
});

it('facetsTotalsAndChartsIgnoreFetchOrder', () => {
  const v = calculateView(input, definition, { kind: 'none' });
  const s = createResultStore(v, revision);
  const before = [s.facets('facet', revision, 'region'), s.totals('total', revision), s.chartData('chart', revision, ['revenue'])];
  s.rows('b', revision, { groupPath: [], offset: 1, limit: 1 });
  s.rows('a', revision, { groupPath: [], offset: 0, limit: 1 });

  expect([s.facets('facet', revision, 'region'), s.totals('total', revision), s.chartData('chart', revision, ['revenue'])]).toEqual(before);
  expect(s.chartData('chart', revision, ['revenue']).rows).toHaveLength(3);
});

it('binds revisions and streams an honest empty final batch', () => {
  const s = createResultStore(calculateView({ ...input, rows: [] }, { table: {}, search: '' }, { kind: 'none' }), revision);

  expect(() => s.totals('t', { ...revision, input: 2 })).toThrow('revision');
  expect([...s.presented('p', revision, 'transfer', 2)]).toMatchObject([{ requestId: 'p', transferId: 'transfer', rows: [], final: true, completeness: input.completeness }]);
});

it('child reads have sibling counts and cannot mutate the stored view', () => {
  const v = calculateView(input, definition, { kind: 'none' });
  const s = createResultStore(v, revision);
  const parent = v.groups[0];

  expect(s.rows('child', revision, { groupPath: parent.path, offset: 0, limit: 1 }).siblingCount).toBe(2);
  const child = parent.children[0];

  expect(s.rows('leaf', revision, { groupPath: child.path, offset: 0, limit: 5 }).rows.map(r => r.id)).toEqual(['r0']);
  const block = s.rows('block', revision, { groupPath: [], offset: 0, limit: 1 });
  block.rows[0].values.revenue = 999;
  block.revision.input = 999;

  expect(s.rows('again', revision, { groupPath: [], offset: 0, limit: 1 }).rows[0].values.revenue).toBe(15);
  expect(() => s.presented('p', revision, 't', 0)).toThrow('batch');
  v.definition.search = 'mutated';

  expect(s.ready('r', revision).inspection.definition.search).toBe('');
});

it('all responses preserve context and chart/subset IDs and revisions', () => {
  const source = { ...input, completeness: { kind: 'bounded' as const, acquiredRowCount: 3, totalRowCount: 20, totalRowCountKind: 'estimated' as const, warnings: ['Acquisition limit'] } };
  const v = calculateView(source, { table: {}, search: '' }, { kind: 'allMatching', excludedIds: ['r1'] });
  const s = createResultStore(v, revision);
  const responses = [s.ready('r', revision), s.rows('b', revision, { groupPath: [], offset: 0, limit: 1 }), s.facets('f', revision, 'region'), s.totals('t', revision), s.chartData('c', revision, ['revenue']), ...s.presented('p', revision, 'transfer', 1)];
  for (const result of responses) {

    expect(result.completeness).toEqual(source.completeness);
    expect(result.revision).toEqual(revision);
    expect(result.diagnostics).toEqual(v.diagnostics);
  }

  expect(s.chartData('c', revision, ['revenue']).rows.map(r => r.id)).toEqual(['r0', 'r2']);
  expect([...s.presented('p', revision, 'transfer', 1)].flatMap(b => b.rows.map(r => r.id))).toEqual(['r0', 'r2']);
});

it('reselected child reaches chart and subset while sibling stays excluded', () => {
  const original = calculateView(input, definition, { kind: 'none' });
  const parent = original.groups[0];
  const [child, sibling] = parent.children;
  const hierarchy = new Map([[parent.id, [child.id, sibling.id]]]);
  const excludedParent = toggleGroupSelection({ kind: 'allMatching', excludedIds: [] }, parent.rows[0], hierarchy);
  const selection = toggleGroupSelection(excludedParent, child.rows[0], hierarchy);
  const store = createResultStore(calculateView(input, definition, selection), revision);
  const expected = [child.id, original.groups[1].children[0].id];

  expect(store.chartData('chart', revision, ['revenue']).rows.map(row => row.id)).toEqual(expected);
  expect([...store.presented('subset', revision, 'transfer', 1)]
    .flatMap(batch => batch.rows.map(row => row.id))).toEqual(expected);
  expect(store.totals('totals', revision).values.revenue).toBe(40);
});

it('delivers declarative stable group paths and complete input schema', () => {
  const s = createResultStore(calculateView(input, definition, { kind: 'none' }), revision);
  const block = s.rows('b', revision, { groupPath: [], offset: 0, limit: 1 });
  expect(block.groups).toEqual([{ rowId: block.rows[0].id, path: [block.rows[0].id], childCount: 2 }]);
  block.groups[0].path.push('mutated');
  expect(s.rows('c', revision, { groupPath: [], offset: 0, limit: 1 }).groups[0].path).toHaveLength(1);
  expect(s.ready('r', revision).inspection.inputColumns).toEqual(input.columns);
});

it('file input inspection infers numeric and date kinds in the worker', () => {
  const raw = { ...input, columns: input.columns.map(({ id, label }) => ({ id, label })) };
  const ready = createResultStore(calculateView(raw, definition, { kind: 'none' }), revision).ready('r', revision);
  expect(ready.inspection.inputColumns.find(c => c.id === 'revenue')?.dtype).toBe('number');
  expect(ready.inspection.inputColumns.find(c => c.id === 'date')?.dtype).toBe('date');
});
it('inspection date periodicity uses complete input rather than loaded groups', () => {
  const weekly = { ...input, rows: input.rows.map((row, i) => ({ ...row, values: { ...row.values, date: `2026-01-${String(1 + i * 7).padStart(2, '0')}` } })) };
  const ready = createResultStore(calculateView(weekly, definition, { kind: 'none' }), revision).ready('r', revision);
  expect(ready.inspection.inputPeriodicity).toEqual({ date: 'weekly' });
});

it('serves independent measures consistently through tiny blocks chart and selected subsets', () => {
  const model = { search: '', table: { pivot: { enabled: true, grouping: ['region'], split: [], measures: [{ id: 'revenue', sourceFieldId: 'revenue', aggregation: 'mean' as const }, { id: 'total', sourceFieldId: 'revenue', aggregation: 'sum' as const }] } } };
  const original = calculateView(input, model, { kind: 'none' });
  const view = calculateView(input, model, { kind: 'explicit', ids: [original.groups[0].id] });
  const store = createResultStore(view, revision);
  for (const limit of [1, 2]) {
    store.rows('rows', revision, { groupPath: [], offset: 0, limit });
    expect(store.totals('totals', revision).values).toEqual({ revenue: 40, total: 120 });
    expect(store.chartData('chart', revision, ['revenue', 'total']).rows.map(r => r.values)).toEqual([{ revenue: 15, total: 30 }]);
    expect([...store.presented('subset', revision, 'transfer', limit)].flatMap(b => b.rows).map(r => r.values.total)).toEqual([30]);
  }
});

it('reports instance aggregations and preserves their metadata across chart and subset transfers', () => {
  const view = calculateView(input, { search: '', table: { pivot: { enabled: true, grouping: ['region'], split: [], aggregationFns: { revenue: 'last' }, measures: [{ id: 'revenue', sourceFieldId: 'revenue', aggregation: 'mean' }, { id: 'copy', sourceFieldId: 'revenue', aggregation: 'sum' }] } } }, { kind: 'none' });
  const store = createResultStore(view, revision);
  expect(store.ready('ready', revision).inspection.aggregations).toEqual({ revenue: 'mean', copy: 'sum' });
  expect(store.chartData('chart', revision, ['copy']).columns).toMatchObject([{ id: 'copy', measureId: 'copy', sourceBindingId: 'revenue', sourceFieldId: 'revenue', aggregation: 'sum' }]);
  expect([...store.presented('subset', revision, 'transfer', 1)][0].columns).toEqual(view.columns);
});

it('reaggregates only presented upstream instance values in a linked child', () => {
  const model = { search: '', table: { pivot: { enabled: true, grouping: ['region'], split: [], measures: [{ id: 'revenue', sourceFieldId: 'revenue', aggregation: 'mean' as const }, { id: 'copy', sourceFieldId: 'revenue', aggregation: 'sum' as const }] } } };
  const all = calculateView(input, model, { kind: 'none' });
  for (const selected of [false, true]) {
    const parent = calculateView(input, model, selected ? { kind: 'explicit', ids: [all.groups[0].id] } : { kind: 'none' });
    const store = createResultStore(parent, revision);
    const batches = [...store.presented('linked', revision, 'transfer', 1)];
    const childInput = { ...input, columns: batches[0].columns!, rows: batches.flatMap(batch => batch.rows), provenance: batches[0].provenance! };
    const child = calculateView(childInput, { search: '', table: { pivot: { enabled: true, grouping: [], split: [], measures: [{ id: 'childMean', sourceFieldId: 'revenue', aggregation: 'mean' }, { id: 'childTotal', sourceFieldId: 'copy', aggregation: 'sum' }] } } }, { kind: 'none' });
    expect(child.totals.values).toEqual(selected ? { childMean: 15, childTotal: 30 } : { childMean: 52.5, childTotal: 120 });
    expect(child.provenance.inputMayContainAggregates).toBe(true);
    expect(store.totals('parentTotal', revision).values).toEqual({ revenue: 40, copy: 120 });
  }
});

it('keeps an already bound split chart stable across duplication edits and new split members', () => {
  const basePivot = { enabled: true, grouping: [], split: ['region'], aggregationFns: { revenue: 'mean' as const } };
  const bound = '["string","A"]\x1frevenue';
  const old = createResultStore(calculateView(input, { search: '', table: { pivot: basePivot } }, { kind: 'none' }), revision);
  expect(old.chartData('old', revision, [bound]).rows[0].values[bound]).toBe(15);
  const measures = [{ id: 'revenue', sourceFieldId: 'revenue', aggregation: 'sum' as const, customLabel: 'Chosen total' }, { id: 'copy', sourceFieldId: 'revenue', aggregation: 'sum' as const }];
  const added = { ...input, rows: [...input.rows, { id: 'new', values: { revenue: 5, region: 'C' } }] };
  const current = createResultStore(calculateView(added, { search: '', table: { pivot: { ...basePivot, measures } } }, { kind: 'none' }), revision);
  expect(current.chartData('current', revision, [bound])).toMatchObject({ columns: [{ id: bound, label: 'Chosen total' }], rows: [{ values: { [bound]: 30 } }] });
  const removed = createResultStore(calculateView(added, { search: '', table: { pivot: { ...basePivot, measures: [measures[1]] } } }, { kind: 'none' }), revision);
  expect(() => removed.chartData('missing', revision, [bound])).toThrow('Unknown chart field');
  expect(current.chartData('restored', revision, [bound]).rows[0].values[bound]).toBe(30);
});
it('incoming producer formula columns remain raw inputs while local source outputs stay out of authoring symbols',()=>{
 const source={...input,columns:[{id:'incoming',label:'Upstream ratio',dtype:'number' as const,sourceFieldId:'origin',metadata:{formulaId:'producer-formula'}}],rows:[{id:'a',values:{incoming:20}},{id:'b',values:{incoming:30}}]};
 const analytical={schemaVersion:1 as const,params:{promotePage:true,filters:[]},enabled:true,categories:[],measures:[],formulas:[{id:'local',name:'Local',scope:'source' as const,expression:'[Upstream ratio]+1',ast:{kind:'binary' as const,operator:'+' as const,left:{kind:'reference' as const,target:'field' as const,id:'incoming'},right:{kind:'literal' as const,value:1}}}],layout:{rows:[],columns:[], values: []},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:false}};
 const store=createResultStore(calculateView(source,{table:{},search:'',analytical},{kind:'none'}),revision);const ready=store.ready('r',revision);
 expect(ready.inspection.inputColumns).toEqual(source.columns);expect(ready.columns.map(c=>c.id)).toContain('local');expect(compileAnalyticalModel(analytical,{columns:ready.inspection.inputColumns}).graph.diagnostics).toEqual([]);expect(store.inspect('i',revision,{collection:'definitions',definitionId:'local',offset:0,limit:1}).rows[0]).toMatchObject({sourceFilterKind:'number'});
});

it('preserves a JSON snapshot receipt and filtered dates across chart projection, without excluded values', async () => {
  const receipt = { interval: '1d', start_date: '2026-01-01', end_date: '2026-01-31' };
  const rows = [100, 123456789, 121].map((adjusted_close, i) => ({
    symbol: 'A', date: '2026-01-0' + (i + 2), adjusted_close, tag: i === 1 ? 'exclude' : 'include', currency: 'USD',
  }));
  const snapshot = (data: typeof rows) => datasetFromBytes('daily.json', new TextEncoder().encode(JSON.stringify({ rows: data, receipt, completeness: 'bounded' })), 'source', 1);
  const read = (data: typeof input, search = '') => {
    const store = createResultStore(calculateView(data, { table: {}, search }, { kind: 'none' }), revision);
    return store.chartData('c', revision, Object.values(priceFields));
  };
  const dataset = await snapshot(rows);
  const result = read(dataset, 'include');
  expect(result.rows).toHaveLength(2);
  expect(result.provenance.receipt).toEqual(receipt);
  expect(result.completeness.kind).toBe('bounded');
  expect(JSON.stringify(result)).not.toContain('123456789');
  expect(preparePrices(result, priceFields)).toMatchObject({ ok: true, series: [{ symbol: 'A', points: [
    { date: '2026-01-02', price: 100 }, { date: '2026-01-03', price: null }, { date: '2026-01-04', price: 121 },
  ] }] });
  const mixed = await snapshot(rows.map((row, i) => ({ ...row, currency: i === 1 ? 'EUR' : 'USD' })));
  expect(preparePrices(read(mixed), priceFields)).toMatchObject({ ok: false, refused: true });
});

it.each(['typescript', 'rust'] as const)('%s imports an evidenced daily file through its production executor and handles a missing date', async engine => {
  const { ProviderBoundary } = await import('../../test/tableProviderBoundary');
  const { createTableProvider } = await import('./rust/providerFactory');
  const workerFactory = () => new ProviderBoundary(engine === 'rust' ? 'rust.worker' : 'table.worker') as unknown as Worker;
  const executor = createTableProvider('source', engine, { workerFactory });
  const signal = new AbortController().signal;
  const rows = [10, 11, 12].map((adjusted_close, i) => ({ symbol: 'A', date: '2026-01-0' + (i + 2), adjusted_close, tag: i === 1 ? 'exclude' : 'include' }));
  const receipt = { interval: '1d', start_date: '2026-01-01', end_date: '2026-01-31' };
  try {
    await executor.importFile('prices.json', new TextEncoder().encode(JSON.stringify({ rows, receipt, completeness: 'bounded' })), 1, signal);
    await executor.applyModel({ table: {}, search: '' }, { kind: 'none' }, revision, signal);
    const all = preparePrices(await executor.chartData(revision, Object.values(priceFields), signal), priceFields);
    expect(all).toMatchObject({ ok: true, scope: { start: '2026-01-01', end: '2026-01-31' } });
    const filtered = { ...revision, model: 2, output: 2 };
    await executor.applyModel({ table: {}, search: 'include' }, { kind: 'none' }, filtered, signal);
    const reduced = preparePrices(await executor.chartData(filtered, Object.values(priceFields), signal), priceFields);
    if (engine === 'rust') expect(reduced).toMatchObject({ ok: false, refused: true });
    else expect(reduced).toMatchObject({ ok: true, series: [{ points: [{ price: 10 }, { date: '2026-01-03', price: null }, { price: 12 }] }] });
  } finally { executor.dispose(); }
});

it('retains an omitted date when symbol labels differ only in surrounding spaces', () => {
  const data = priceDataset(['A', ' A ', 'A'].map((symbol, i) => ({
    symbol, date: '2026-01-0' + (2 + i), adjusted_close: 10 + i, tag: i === 1 ? 'omit' : 'show',
  })));
  const store = createResultStore(calculateView(data, { table: {}, search: 'show' }, { kind: 'none' }), revision);
  expect(preparePrices(store.chartData('c', revision, Object.values(priceFields)), priceFields)).toMatchObject({
    ok: true, series: [{ symbol: 'A', points: [{ price: 10 }, { date: '2026-01-03', price: null }, { price: 12 }] }],
  });
});

const dailyReceipt = { interval: '1d', start_date: '2026-01-01', end_date: '2026-01-31' };
const dailySnapshot = (rows: Record<string, unknown>[]) =>
  new TextEncoder().encode(JSON.stringify({ rows, receipt: dailyReceipt, completeness: 'bounded' }));

async function priceProjection(source: typeof input | Uint8Array, search: string, fields: string[]) {
  const { ProviderBoundary } = await import('../../test/tableProviderBoundary');
  const { createTableProvider } = await import('./rust/providerFactory');
  const executor = createTableProvider('source', 'typescript', { workerFactory: () => new ProviderBoundary('table.worker') as unknown as Worker });
  const signal = new AbortController().signal;
  try {
    if ('rows' in source) await executor.registerInput(source, 1, signal);
    else await executor.importFile('prices.json', source.slice(), 1, signal);
    await executor.applyModel({ table: {}, search }, { kind: 'none' }, revision, signal);
    return await executor.chartData(revision, fields, signal);
  } finally { executor.dispose(); }
}

it.each([
  ['currency', { currency: 'USD', Currency: 'USD' }, { currency: 'USD', Currency: 'EUR' }],
  ['currency case', { Currency: 'USD' }, { Currency: 'EUR' }],
  ['unit', { UNIT: 'dollars' }, { UNIT: 'cents' }],
  ['symbol alias', { Ticker: 'A' }, { Ticker: 'B' }],
  ['venue', { Exchange: 'XNYS', EXCHANGE: 'XNYS' }, { Exchange: 'XNYS', EXCHANGE: 'XLON' }],
  ['interval', { Interval: '1d' }, { Interval: '1wk' }],
] as const)('refuses a snapshot with conflicting %s declarations after field projection', async (_dimension, first, second) => {
  const data = dailySnapshot([first, second].map((extra, i) => ({
    symbol: 'A', date: '2026-01-0' + (2 + i), adjusted_close: 10 + i, ...extra,
  })));
  expect(preparePrices(await priceProjection(data, '', Object.values(priceFields)), priceFields)).toMatchObject({ ok: false, refused: true });
});

it('checks units across the acquisition before a filtered raw chart can claim comparable prices', async () => {
  const data = priceDataset(['USD', 'EUR', 'USD'].map((currency, i) => ({
    symbol: 'A', date: '2026-01-0' + (2 + i), adjusted_close: 10 + i, currency, tag: i === 1 ? 'omit' : 'show',
  })));
  const projected = await priceProjection(data, 'show', [...Object.values(priceFields), 'currency']);
  expect(projected.rows.map(row => row.values.currency)).toEqual(['USD', 'USD']);
  expect(preparePrices(projected, priceFields)).toMatchObject({ ok: false, refused: true });
});

it.each(['symbol', 'Ticker', 'SYMBOL'])('binds the verified %s alias even when a different alias is first in the snapshot', async symbol => {
  const data = dailySnapshot([10, 11, 12].map((adjusted_close, i) => ({
    ticker: 'A', symbol: 'A', Ticker: 'A', SYMBOL: 'A', date: '2026-01-0' + (2 + i), adjusted_close, tag: i === 1 ? 'omit' : 'show',
  })));
  const fields = { ...priceFields, symbol };
  const expected = { ok: true, series: [{ symbol: 'A', points: [{ price: 10 }, { date: '2026-01-03', price: null }, { price: 12 }] }] };
  expect(preparePrices(await priceProjection(data, 'show', Object.values(fields)), fields)).toMatchObject(expected);
  expect(preparePrices(await priceProjection(data, 'show', ['ticker', ...Object.values(fields)]), fields)).toMatchObject(expected);
});

it.each([
  ['Adjusted_Close', 'Currency', 'USD', 'currency', 'EUR'],
  ['adjusted_price_after_splits', 'UNIT', 'dollars', 'Unit', 'cents'],
])('compares %s metadata with the acquired units after row dimensions are projected away', async (price, rowField, observed, metadataField, declared) => {
  const data = priceDataset([{ date: '2026-01-02', symbol: 'A', [price]: 100, [rowField]: observed }]);
  data.columns.find(c => c.id === price)!.metadata = { [metadataField]: declared };
  const fields = { ...priceFields, price };
  expect(preparePrices(data, fields)).toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/mixed or missing price (currency|unit)/) });
  const projected = await priceProjection(data, '', Object.values(fields));
  expect(projected.columns.map(c => c.id)).not.toContain(rowField);
  expect(preparePrices(projected, fields)).toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/mixed or missing price (currency|unit)/) });
});

it('validates only the bound price column against the acquired currency', async () => {
  const data = priceDataset([{ date: '2026-01-02', symbol: 'A', adjusted_close: 90, split_adjusted: 100, Currency: 'USD' }]);
  data.columns.find(c => c.id === 'adjusted_close')!.metadata = { currency: 'EUR' };
  data.columns.find(c => c.id === 'split_adjusted')!.metadata = { currency: 'USD' };
  const fields = { ...priceFields, price: 'split_adjusted' };
  const expected = { ok: true, series: [{ symbol: 'A', points: [{ date: '2026-01-02', price: 100 }] }] };
  expect(preparePrices(data, fields)).toMatchObject(expected);
  expect(preparePrices(await priceProjection(data, '', Object.values(fields)), fields)).toMatchObject(expected);
});

it('retains hidden ETF safety failures through two projections', async () => {
  const { readEtfEvidence } = await import('../widgetData/chartRecipes/etfEvidence');
  const { beginSubset, appendSubset, commitSubset } = await import('./subsetTransfer');
  const project = async (bad: Record<string, unknown> = {}) => {
    const common = { fund_symbol: 'FUND_A.US', weight_basis: 'fund-assets' };
    const rows = [{ ...common, symbol: 'HOLDING.US', weight: .25, tag: 'keep' },
      { ...common, symbol: 'OMITTED.US', weight: .12345678, tag: 'omit', ...bad }];
    const receipt = { ...common, etf_kind: 'holdings' };
    const raw = await datasetFromBytes('holdings.json', new TextEncoder().encode(JSON.stringify({ rows, receipt, completeness: 'paged' })), 'source', 1);
    const table = { hidden: ['fund_symbol', 'weight_basis', 'tag'] };
    const parent = createResultStore(calculateView(raw, { table, search: 'HOLDING.US' }, { kind: 'none' }), revision);
    const transfer = beginSubset('transfer', revision);
    for (const block of parent.presented('linked', revision, 'transfer')) appendSubset(transfer, block);
    const child = calculateView(commitSubset(transfer), { table: {}, search: '' }, { kind: 'none' });
    const projected = createResultStore(child, { ...revision, widgetId: 'child' }).chartData('chart', { ...revision, widgetId: 'child' }, ['symbol', 'weight']);
    expect(projected.rows.map(r => r.values)).toEqual([{ symbol: 'HOLDING.US', weight: .25 }]);
    expect(JSON.stringify(projected.provenance)).not.toContain('0.12345678');
    return projected;
  };
  const projected = await project();
  expect(projected.provenance.metadata?.etfEvidence).toMatchObject({ fund: 'FUND_A.US', basis: 'fund-assets' });
  expect(projected.completeness.kind).toBe('paged');
  expect(readEtfEvidence(projected, 'holdings')).toMatchObject({ ok: true, notes: expect.arrayContaining([expect.stringMatching(/filtered source/i)]) });
  for (const bad of [{ fund_symbol: 'FUND_B.US' }, { weight_basis: 'equity-exposure' }, { weight: null }, { weight: 2 }]) {
    const conflictingProjection = await project(bad);
    expect(readEtfEvidence(conflictingProjection, 'holdings').ok).toBe(false);
  }
});
