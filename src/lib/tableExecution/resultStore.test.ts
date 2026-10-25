// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { compileAnalyticalModel } from '../tableModel/calculate';
import { it, expect } from 'vitest';
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
