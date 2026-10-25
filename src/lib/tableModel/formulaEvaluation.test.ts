// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { evaluateSourceFormulas } from './formulaEvaluation';
import { validateFormulaGraph } from './formulaGraph';
import type { FormulaAst } from './types';
import { context, formula, literal, profit, ref } from './evaluationTestHelpers';
describe('source formula evaluation', () => {
  it('executes bound IDs before dependent categories without mutating input', () => {
    const rows = [{ id: 'a', values: { revenue: 10, cost: 4 } }];
    const result = evaluateSourceFormulas(rows, context([profit], [{ id: 'p', name: 'Profit', sourceFieldId: 'profit', transform: 'native' }]));
    expect(result.rows[0].values).toMatchObject({ profit: 6, p: 6 });
    expect(rows[0].values).toEqual({ revenue: 10, cost: 4 });
  });
  it.each([null, '', '12', undefined])('rejects arithmetic on %s instead of coercing zero', value => {
    const result = evaluateSourceFormulas([{ id: 'a', values: { revenue: value, cost: 1 } }], context([profit]));
    expect(result.formulaCells.get('a')?.get('profit')).toMatchObject({ ok: false, error: { code: 'invalid-type', recordIds: ['a'], definitionId: 'profit' } });
  });
  it('evaluates only the selected IF branch, requires boolean condition and catches division/nonfinite', () => {
    const divide: FormulaAst = { kind: 'binary', operator: '/', left: literal(1), right: literal(0) };
    const defs = [formula('lazy', { kind: 'call', function: 'IF', args: [literal(true), literal(7), divide] }), formula('badIf', { kind: 'call', function: 'IF', args: [literal(1), literal(7), literal(0)] }), formula('zero', divide), formula('overflow', { kind: 'binary', operator: '*', left: literal(1e308), right: literal(1e308) })];
    const result = evaluateSourceFormulas([{ id: 'a', values: {} }], context(defs));
    expect(result.formulaCells.get('a')?.get('lazy')).toEqual({ ok: true, value: 7 });
    for (const [id, code] of [['badIf', 'invalid-type'], ['zero', 'division-by-zero'], ['overflow', 'nonfinite']]) expect(result.formulaCells.get('a')?.get(id)).toMatchObject({ ok: false, error: { code } });
  });
  it('requires external validation but keeps raw rows and independent valid imported formulas', () => {
    const broken = formula('broken', { kind: 'reference', target: 'formula', id: 'broken' });
    const model = context([broken, profit]);
    const rows = [{ id: 'a', values: { revenue: 10, cost: 4 } }];
    expect(evaluateSourceFormulas(rows, model).rows[0].values.profit).toBe(6);
    const unvalidated = evaluateSourceFormulas(rows, { ...model, graph: validateFormulaGraph([profit]) });
    expect(unvalidated.rows[0].values.profit).toBeUndefined();
    expect(unvalidated.formulaCells.get('a')?.get('profit')).toMatchObject({ ok: false, error: { code: 'unvalidated-model' } });
  });
  it('preserves failed dependency provenance through category derivation and deduplicates identities', () => {
    const dependent = formula('dependent', { kind: 'reference', target: 'formula', id: 'profit' });
    const row = { id: 'a', values: { revenue: null, cost: 4 } };
    const result = evaluateSourceFormulas([row, row], context([dependent, profit], [{ id: 'p', name: 'Profit', sourceFieldId: 'dependent', transform: 'native' }]));
    expect(result.rows).toHaveLength(1);
    expect(result.members.get('a')?.get('p')).toMatchObject({ ok: false, error: { code: 'blocked-dependency', recordIds: ['a'], dependencyIds: expect.arrayContaining(['profit', 'dependent']) } });
  });
});

it('retains invalid imported source definitions as error cells while independent formulas execute', () => {
  const model = context([profit]);
  const invalid = { ...formula('invalid', literal(1)), ast: { kind: 'unsupported' } };
  model.symbols.formulas.push({ id: 'invalid', name: 'Invalid', scope: 'source' });
  const result = evaluateSourceFormulas([{ id: 'r', values: { revenue: 4, cost: 1 } }], { ...model, graph: validateFormulaGraph([invalid, profit], model.symbols) });
  expect(result.formulaCells.get('r')?.get('invalid')).toMatchObject({ ok: false, error: { definitionId: 'invalid', recordIds: ['r'] } });
  expect(result.rows[0].values.profit).toBe(3);
});
it('uses incoming column IDs instead of provenance and never overwrites colliding inputs', () => {
  const model = context([profit]);
  const result = evaluateSourceFormulas([{ id: 'a', values: { revenue: 100, cost: 4, profit: 99 } }], { ...model, columns: model.columns.map(c => ({ ...c, sourceFieldId: 'upstream-origin' })) });
  expect(result.rows[0].values.profit).toBe(99);
  expect(result.formulaCells.get('a')?.get('profit')).toMatchObject({ ok: false, error: { code: 'ambiguous-reference' } });
});
it('preserves blank references and compares typed scalars without coercion', () => {
  const defs = [formula('blank', ref('revenue')), formula('eq', { kind: 'binary', operator: '=', left: ref('revenue'), right: literal(0) }), formula('lt', { kind: 'binary', operator: '<', left: ref('revenue'), right: literal(0) })];
  const result = evaluateSourceFormulas([{ id: 'a', values: { revenue: null } }], context(defs));
  expect(result.formulaCells.get('a')?.get('blank')).toEqual({ ok: true, value: null });
  expect(result.rows[0].values.eq).toBe(false);
  expect(result.formulaCells.get('a')?.get('lt')).toMatchObject({ ok: false, error: { code: 'invalid-type' } });
});

// Aggregate scopes must reread their own input identities, never group formula outputs.
import { evaluateAggregateFormulas, type CompiledModel } from './formulaEvaluation';
import { eligiblePool } from './facets';
import type { CalculationScope } from './scopes';
import type { FormulaDef } from './types';
import type { AggName } from '../types';
import { pivotValueKey } from '../pivotKeys';
const aggregateDef = (id: string, ast: FormulaAst): FormulaDef => ({ ...formula(id, ast), scope: 'aggregate' });
const sum = (id: string): FormulaAst => ({ kind: 'call', function: 'sum', args: [ref(id)] });
function aggregateFixture(definitions: FormulaDef[], aggregation: AggName | undefined = 'sum', rows = [{ id: 'a', values: { revenue: 10, cost: 2 } }, { id: 'b', values: { revenue: 30, cost: 8 } }]) {
  const initial = context(definitions);
  const symbols = { ...initial.symbols, measures: [{ id: 'm', name: 'Revenue', sourceFieldId: 'revenue', ...(aggregation ? { aggregation } : {}) }] };
  const model: CompiledModel = { ...initial, symbols, graph: validateFormulaGraph(definitions, symbols) };
  const pool = eligiblePool(evaluateSourceFormulas(rows, model), { columns: model.columns });
  const scope: CalculationScope = { sourceRecordIds: new Set(rows.map(r => r.id)), categoryConstraints: new Map(), temporalContext: {} };
  return { model, pool, scope };
}
describe('aggregate formula evaluation', () => {
  it.each([['sum', 40], ['mean', 20]] as const)('uses the configured %s instance and lets explicit SUM override it', (operator, expected) => {
    const defs = [aggregateDef('implicit', { kind: 'reference', target: 'measure', id: 'm' }), aggregateDef('explicit', sum('revenue'))];
    const { scope, pool, model } = aggregateFixture(defs, operator);
    const result = evaluateAggregateFormulas(scope, pool, model);
    expect(result.cells.get('implicit')).toEqual({ ok: true, value: expected });
    expect(result.cells.get('explicit')).toEqual({ ok: true, value: 40 });
  });
  it('reports a missing operator while independent explicit aggregation executes', () => {
    const { scope, pool, model } = aggregateFixture([aggregateDef('implicit', { kind: 'reference', target: 'measure', id: 'm' }), aggregateDef('explicit', sum('revenue'))], undefined);
    // Remove the fixture default explicitly to exercise the persisted missing operator.
    delete model.symbols.measures[0].aggregation;
    const checked = { ...model, graph: validateFormulaGraph(model.graph.entries.map(e => e.raw), model.symbols) };
    const result = evaluateAggregateFormulas(scope, pool, checked);
    expect(result.cells.get('implicit')).toMatchObject({ ok: false, error: { code: 'missing-aggregation' } });
    expect(result.cells.get('explicit')).toEqual({ ok: true, value: 40 });
    // The measure's own cell is blank until an aggregation is chosen, never an error.
    expect(result.measureCells.get('m')).toEqual({ ok: true, value: null });
  });
  it('reevaluates total ratios even when a lower scope has a zero denominator', () => {
    const margin = aggregateDef('margin', { kind: 'binary', operator: '/', left: sum('cost'), right: sum('revenue') });
    const { scope, pool, model } = aggregateFixture([margin], 'sum', [{ id: 'a', values: { revenue: 0, cost: 2 } }, { id: 'b', values: { revenue: 10, cost: 3 } }]);
    expect(evaluateAggregateFormulas({ ...scope, sourceRecordIds: new Set(['a']) }, pool, model).cells.get('margin')).toMatchObject({ ok: false, error: { code: 'division-by-zero', recordIds: ['a'] } });
    expect(evaluateAggregateFormulas(scope, pool, model).cells.get('margin')).toEqual({ ok: true, value: 0.5 });
  });
  it('propagates failed source dependencies but preserves independent formulas and lazy IF', () => {
    const source = formula('bad', { kind: 'binary', operator: '/', left: ref('revenue'), right: literal(0) });
    const bad = aggregateDef('totalBad', { kind: 'call', function: 'sum', args: [{ kind: 'reference', target: 'formula', id: 'bad' }] });
    const lazy = aggregateDef('lazy', { kind: 'call', function: 'IF', args: [literal(true), sum('revenue'), { kind: 'reference', target: 'formula', id: 'totalBad' }] });
    const { scope, pool, model } = aggregateFixture([source, bad, lazy]);
    const result = evaluateAggregateFormulas(scope, pool, model);
    expect(result.cells.get('totalBad')).toMatchObject({ ok: false, error: { recordIds: ['a', 'b'], dependencyIds: expect.arrayContaining(['bad']) } });
    expect(result.cells.get('lazy')).toEqual({ ok: true, value: 40 });
  });
});

it('makes maintained count results numeric for formula arithmetic, without coercing source strings', () => {
  const count: FormulaAst = { kind: 'call', function: 'count', args: [ref('revenue')] };
  const { scope, pool, model } = aggregateFixture([aggregateDef('countPlus', { kind: 'binary', operator: '+', left: count, right: literal(1) })]);
  expect(evaluateAggregateFormulas(scope, pool, model).cells.get('countPlus')).toEqual({ ok: true, value: 3 });
});
it('member comparisons use eligible counterparts with configured operator and no unrelated dimensions', () => {
  const categories = [{ id: 's', name: 'Scenario', sourceFieldId: 'scenario', transform: 'native' as const }];
  const member: FormulaAst = { kind: 'member', value: { kind: 'reference', target: 'measure', id: 'm' }, selectors: [{ categoryId: 's', memberKey: pivotValueKey('Budget') }] };
  const definitions = [aggregateDef('budget', member)];
  const base = context(definitions, categories);
  const symbols = { ...base.symbols, categories: base.symbols.categories.map(c => ({ ...c, members: [{ key: pivotValueKey('Actual'), value: 'Actual' }, { key: pivotValueKey('Budget'), value: 'Budget' }] })), measures: [{ id: 'm', name: 'Revenue', sourceFieldId: 'revenue', aggregation: 'mean' as const }] };
  const model = { ...base, symbols, graph: validateFormulaGraph(definitions, symbols) };
  const pool = eligiblePool(evaluateSourceFormulas([{ id: 'a', values: { scenario: 'Actual', revenue: 5 } }, { id: 'b', values: { scenario: 'Budget', revenue: 20 } }, { id: 'c', values: { scenario: 'Budget', revenue: 40 } }], model), { columns: model.columns });
  const scope: CalculationScope = { sourceRecordIds: new Set(['a']), categoryConstraints: new Map(), page: { categoryId: 's', memberKeys: [pivotValueKey('Actual')] }, temporalContext: {} };
  expect(evaluateAggregateFormulas(scope, pool, model).cells.get('budget')).toEqual({ ok: true, value: 30 });
});

it('uses an explicit chronological date binding and propagates failures in that binding', () => {
  const defs = [aggregateDef('first', { kind: 'call', function: 'first', args: [ref('revenue')] }), aggregateDef('last', { kind: 'call', function: 'last', args: [ref('revenue')] })];
  const { model, scope } = aggregateFixture(defs);
  const rows = [{ id: 'late', values: { revenue: 20, date: '2026-03-01' } }, { id: 'early', values: { revenue: 10, date: '2026-01-01' } }];
  const pool = eligiblePool(evaluateSourceFormulas(rows, model), { columns: model.columns });
  const at = { ...scope, sourceRecordIds: new Set(['late', 'early']), temporalContext: { dateFieldId: 'date' } };
  expect(evaluateAggregateFormulas(at, pool, model).cells.get('first')).toEqual({ ok: true, value: 10 });
  expect(evaluateAggregateFormulas(at, pool, model).cells.get('last')).toEqual({ ok: true, value: 20 });
  pool.formulaCells.get('early')!.set('badDate', { ok: false, error: { code: 'invalid-date', message: 'failed date', recordIds: ['early'] } });
  expect(evaluateAggregateFormulas({ ...at, temporalContext: { dateFieldId: 'badDate' } }, pool, model).cells.get('first')).toMatchObject({ ok: false, error: { recordIds: ['early'] } });
});
it('normalizes proven incoming count columns but never dereferences producer origin bindings', () => {
  const source = formula('plus', { kind: 'binary', operator: '+', left: ref('revenue'), right: literal(1) });
  const defs = [source, aggregateDef('total', sum('revenue'))];
  const { model, scope } = aggregateFixture(defs);
  const incoming = { ...model, columns: model.columns.map(c => c.id === 'revenue' ? { ...c, aggregation: 'count' as const, sourceFieldId: 'upstream-raw', sourceBindingId: 'producer-id' } : c) };
  const rows = [{ id: 'a', values: { revenue: '3' } }, { id: 'b', values: { revenue: '4' } }];
  const evaluated = evaluateSourceFormulas(rows, incoming);
  expect(evaluated.formulaCells.get('a')?.get('plus')).toEqual({ ok: true, value: 4 });
  expect(evaluateAggregateFormulas(scope, eligiblePool(evaluated, { columns: incoming.columns }), incoming).cells.get('total')).toEqual({ ok: true, value: 7 });
  expect(rows[0].values.revenue).toBe('3');
  expect(evaluateSourceFormulas(rows, model).formulaCells.get('a')?.get('plus')).toMatchObject({ ok: false, error: { code: 'invalid-type' } });
});
it('exposes empty scope and formula formats separately from operator count formatting', () => {
  const defs = [{ ...aggregateDef('formatted', sum('revenue')), format: 'percent' }, aggregateDef('count', { kind: 'call', function: 'count', args: [ref('revenue')] })];
  const { model, pool, scope } = aggregateFixture(defs);
  const result = evaluateAggregateFormulas({ ...scope, sourceRecordIds: new Set() }, pool, model);
  expect(result.empty).toBe(true);
  expect(result.cells.get('formatted')).toEqual({ ok: true, value: undefined });
  expect(result.cells.get('count')).toEqual({ ok: true, value: 0 });
  expect(result.metadata.get('formatted')?.format).toBe('percent');
  expect(result.metadata.get('count')?.valueKind).toBe('number');
});

it('keeps invalid aggregate definitions inspectable and refuses unvalidated graph execution', () => {
  const cyclic = aggregateDef('cyclic', { kind: 'reference', target: 'formula', id: 'cyclic' });
  const { model, pool, scope } = aggregateFixture([cyclic, aggregateDef('good', sum('revenue'))]);
  expect(evaluateAggregateFormulas(scope, pool, model).cells.get('cyclic')).toMatchObject({ ok: false, error: { code: 'cycle' } });
  expect(evaluateAggregateFormulas(scope, pool, model).cells.get('good')).toEqual({ ok: true, value: 40 });
  const unvalidated = { ...model, graph: validateFormulaGraph(model.graph.entries.map(e => e.raw)) };
  expect(evaluateAggregateFormulas(scope, pool, unvalidated).cells.get('good')).toMatchObject({ ok: false, error: { code: 'unvalidated-model' } });
  const invalid = { ...aggregateDef('invalid', literal(1)), ast: { kind: 'bad' } };
  const symbols = { ...model.symbols, formulas: [...model.symbols.formulas, { id: 'invalid', name: 'Invalid', scope: 'aggregate' as const }] };
  expect(evaluateAggregateFormulas(scope, pool, { ...model, symbols, graph: validateFormulaGraph([...model.graph.entries.map(e => e.raw), invalid], symbols) }).cells.get('invalid')).toMatchObject({ ok: false });
});
it('consumes computed source cells exactly once and propagates source IDs through aggregate dependencies', () => {
  const source = formula('derived', { kind: 'binary', operator: '/', left: ref('revenue'), right: ref('cost') });
  const total = aggregateDef('total', { kind: 'call', function: 'sum', args: [{ kind: 'reference', target: 'formula', id: 'derived' }] });
  const dependent = aggregateDef('dependent', { kind: 'reference', target: 'formula', id: 'total' });
  const { model, pool, scope } = aggregateFixture([source, total, dependent]);
  // These cells are the authoritative result of the earlier source stage.
  pool.formulaCells.get('a')!.set('derived', { ok: true, value: 100 });
  expect(evaluateAggregateFormulas(scope, pool, model).cells.get('total')).toEqual({ ok: true, value: 103.75 });
  pool.formulaCells.get('a')!.set('derived', { ok: false, error: { code: 'division-by-zero', message: 'zero', recordIds: ['a'] } });
  expect(evaluateAggregateFormulas(scope, pool, model).cells.get('dependent')).toMatchObject({ ok: false, error: { recordIds: ['a'], dependencyIds: expect.arrayContaining(['derived', 'total']) } });
});
it('rejects nonboolean aggregate IF and handles explicit source arithmetic without changing sum null rules', () => {
  const defs = [aggregateDef('badIf', { kind: 'call', function: 'IF', args: [literal(1), literal(2), literal(3)] }), aggregateDef('profitTotal', { kind: 'call', function: 'sum', args: [{ kind: 'binary', operator: '-', left: ref('revenue'), right: ref('cost') }] })];
  const { model, pool, scope } = aggregateFixture(defs);
  const result = evaluateAggregateFormulas(scope, pool, model);
  expect(result.cells.get('badIf')).toMatchObject({ ok: false, error: { code: 'invalid-type' } });
  expect(result.cells.get('profitTotal')).toEqual({ ok: true, value: 30 });
});
it('rejects unsafe or malformed proven incoming counts without accepting ordinary strings', () => {
  const def = formula('read', ref('revenue'));
  const model = context([def]);
  const countModel = { ...model, columns: model.columns.map(c => ({ ...c, aggregation: 'uniqueCount' as const })) };
  for (const [value, code] of [['9007199254740993', 'nonfinite'], ['3.5', 'invalid-type']]) {
    expect(evaluateSourceFormulas([{ id: 'a', values: { revenue: value } }], countModel).formulaCells.get('a')?.get('read')).toMatchObject({ ok: false, error: { code } });
  }
});
it('evaluates aggregate-formula dependencies independently at each member scope', () => {
  const revenue = aggregateDef('revenueTotal', sum('revenue'));
  const member = (value: string): FormulaAst => ({ kind: 'member', value: { kind: 'reference', target: 'formula', id: 'revenueTotal' }, selectors: [{ categoryId: 's', memberKey: pivotValueKey(value) }] });
  const comparison = aggregateDef('variance', { kind: 'binary', operator: '-', left: member('Actual'), right: member('Budget') });
  const base = context([revenue, comparison], [{ id: 's', name: 'Scenario', sourceFieldId: 'scenario', transform: 'native' }]);
  const symbols = { ...base.symbols, categories: base.symbols.categories.map(c => ({ ...c, members: ['Actual', 'Budget'].map(value => ({ key: pivotValueKey(value), value })) })) };
  const model = { ...base, symbols, graph: validateFormulaGraph([revenue, comparison], symbols) };
  const input = evaluateSourceFormulas([{ id: 'a', values: { scenario: 'Actual', revenue: 10 } }, { id: 'b', values: { scenario: 'Budget', revenue: 40 } }], model);
  const pool = eligiblePool(input, { columns: model.columns });
  const scope: CalculationScope = { sourceRecordIds: new Set(['a']), categoryConstraints: new Map(), page: { categoryId: 's', memberKeys: [pivotValueKey('Actual')] }, temporalContext: {} };
  expect(evaluateAggregateFormulas(scope, pool, model).cells.get('variance')).toEqual({ ok: true, value: -30 });
  const excluded = eligiblePool(input, { columns: model.columns, checklists: [{ categoryId: 's', memberKeys: [pivotValueKey('Actual')] }] });
  expect(evaluateAggregateFormulas(scope, excluded, model).cells.get('variance')).toMatchObject({ ok: false, error: { code: 'excluded-member' } });
});

it('propagates only evaluated scoped dependency metadata, count kind and incoming provenance', () => {
  const a = { ...aggregateDef('A', { kind: 'call', function: 'count', args: [ref('revenue')] }), format: 'currency' };
  const member = (value: string): FormulaAst => ({ kind: 'member', value: { kind: 'reference', target: 'formula', id: 'A' }, selectors: [{ categoryId: 's', memberKey: pivotValueKey(value) }] });
  const b = { ...aggregateDef('B', { kind: 'binary', operator: '+', left: member('Budget'), right: member('Budget') }), format: 'decimal' };
  const c = aggregateDef('C', { kind: 'call', function: 'IF', args: [literal(true), member('Actual'), member('Budget')] });
  const d = aggregateDef('D', member('Budget'));
  const base = context([a, b, c, d], [{ id: 's', name: 'Scenario', sourceFieldId: 'scenario', transform: 'native' }]);
  const symbols = { ...base.symbols, categories: base.symbols.categories.map(cat => ({ ...cat, members: ['Actual', 'Budget'].map(value => ({ key: pivotValueKey(value), value })) })) };
  const columns = base.columns.map(col => col.id === 'revenue' ? { ...col, aggregation: 'sum' as const, sourceFieldId: 'producer-origin' } : col);
  const model = { ...base, columns, symbols, graph: validateFormulaGraph([a, b, c, d], symbols) };
  const input = evaluateSourceFormulas([{ id: 'actual', values: { scenario: 'Actual', revenue: 10 } }, { id: 'budget', values: { scenario: 'Budget', revenue: 40 } }], model);
  const scope: CalculationScope = { sourceRecordIds: new Set(['actual']), categoryConstraints: new Map(), page: { categoryId: 's', memberKeys: [pivotValueKey('Actual')] }, temporalContext: {} };
  const result = evaluateAggregateFormulas(scope, eligiblePool(input, { columns }), model);
  expect(result.cells.get('B')).toEqual({ ok: true, value: 2 });
  expect(result.cells.get('D')).toEqual({ ok: true, value: 1 });
  expect(result.metadata.get('D')?.valueKind).toBe('number');
  expect(result.metadata.get('D')?.scopes.map(s => [...s.sourceRecordIds])).toEqual([['budget']]);
  expect(result.metadata.get('D')?.sourceColumns.map(c => c.id)).toEqual(['revenue']);
  expect(result.metadata.get('B')).toMatchObject({ format: 'decimal', valueKind: 'number', sourceColumns: [{ id: 'revenue', aggregation: 'sum', sourceFieldId: 'producer-origin' }] });
  expect(result.metadata.get('B')?.scopes.map(s => [...s.sourceRecordIds])).toEqual([['budget']]);
  expect(result.metadata.get('C')?.scopes.map(s => [...s.sourceRecordIds])).toEqual([['actual']]);
  expect(result.metadata.get('A')?.scopes.map(s => [...s.sourceRecordIds])).toEqual([['actual']]);
  expect(result.metadata.get('C')?.format).toBeUndefined();
});
it('retains source formula output and evaluated underlying input hints without reading lazy branches', () => {
  const inner = formula('inner', { kind: 'call', function: 'IF', args: [literal(true), ref('revenue'), ref('cost')] });
  const outer = formula('outer', { kind: 'reference', target: 'formula', id: 'inner' });
  const total = aggregateDef('total', { kind: 'call', function: 'sum', args: [{ kind: 'reference', target: 'formula', id: 'outer' }] });
  const { model, pool, scope } = aggregateFixture([inner, outer, total]);
  pool.formulaCells.get('a')!.set('outer', { ok: true, value: 100 });
  const result = evaluateAggregateFormulas(scope, pool, model);
  expect(result.cells.get('total')).toEqual({ ok: true, value: 130 });
  expect(result.metadata.get('total')?.sourceColumns.map(c => c.id).sort()).toEqual(['inner', 'outer', 'revenue']);
});
it('explicit source-argument IF metadata excludes its unused input branch', () => {
  const total = aggregateDef('total', { kind: 'call', function: 'sum', args: [{ kind: 'call', function: 'IF', args: [literal(true), ref('revenue'), ref('cost')] }] });
  const { model, pool, scope } = aggregateFixture([total]);
  expect(evaluateAggregateFormulas(scope, pool, model).metadata.get('total')?.sourceColumns.map(c => c.id)).toEqual(['revenue']);
});
it('reads incoming error metadata only from own field keys', () => {
  const def = formula('value', ref('constructor'));
  const base = context([def]);
  const symbols = {...base.symbols, fields: [...base.symbols.fields, {id: 'constructor', name: 'Constructor'}]};
  const model = {...base, symbols, columns: [...base.columns, {id: 'constructor', label: 'Constructor'}], graph: validateFormulaGraph([def],symbols)};
  const result = evaluateSourceFormulas([{id:'r',values:{constructor:7},cellErrors:{other:{code:'missing-input',message:'Unrelated'}}}],model);
  expect(result.formulaCells.get('r')?.get('value')).toEqual({ok:true,value:7});
});

it('preserves a typed source scope diagnostic for imported member selectors through compact cell errors',()=>{
 const ast:FormulaAst={kind:'member',value:ref('revenue'),selectors:[{categoryId:'scenario',memberKey:'actual'}]};
 const model=context([formula('invalid',ast)],[{id:'scenario',name:'Scenario',sourceFieldId:'cost',transform:'native'}]);
 const result=evaluateSourceFormulas([{id:'a',values:{revenue:10,cost:1}}],model);
 const cell=result.formulaCells.get('a')!.get('invalid')!;
 expect(cell).toMatchObject({ok:false,error:{code:'scope',message:'Category member comparisons require aggregate scope.',definitionId:'invalid'}});
 if(!cell.ok)expect(compactCellError(cell.error)).toMatchObject({code:'scope',message:'Category member comparisons require aggregate scope.'});
});
it('preserves a typed aggregate scope diagnostic instead of a generic blocked dependency',()=>{
 const invalid=aggregateDef('invalid',{kind:'call',function:'sum',args:[sum('revenue')]});
 const {scope,pool,model}=aggregateFixture([invalid]);
 expect(evaluateAggregateFormulas(scope,pool,model).cells.get('invalid')).toMatchObject({ok:false,error:{code:'scope',message:'Aggregate calls are allowed only at aggregate scope.'}});
});
import {compactCellError} from './calculate';
