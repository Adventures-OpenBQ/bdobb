// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { bindFormula, type ModelSymbols } from './formulaBinding';
import { parseFormula } from './formulaSyntax';
import type { FormulaAst } from './types';
const symbols: ModelSymbols = {
  fields: [{ id: 'raw-revenue', name: 'Revenue' }, { id: 'raw-cost', name: 'Cost' }, { id: 'raw-scenario', name: 'Scenario' }],
  formulas: [{ id: 'profit', name: 'Profit', scope: 'source' }, { id: 'margin', name: 'Margin', scope: 'aggregate' }],
  measures: [{ id: 'mean-revenue', name: 'Revenue', sourceFieldId: 'raw-revenue', aggregation: 'mean' }],
  categories: [{ id: 'scenario', name: 'Scenario', sourceFieldId: 'raw-scenario', members: [{ key: 'actual', value: 'Actual' }, { key: 'prior', value: 'Prior Budget' }, { key: 'number', value: 1 }, { key: 'string', value: '1' }] }],
};
const draft = (text: string, scope: 'source' | 'aggregate' = 'aggregate', context = symbols) => bindFormula(parseFormula(text).ast!, context, scope);

describe('stable formula binding', () => {
  it('binds source names to input column IDs and formulas', () => {
    expect(draft('Revenue - Profit', 'source').ast).toEqual({ kind: 'binary', operator: '-', left: { kind: 'reference', target: 'field', id: 'raw-revenue' }, right: { kind: 'reference', target: 'formula', id: 'profit' } });
  });
  it('binds implicit measure instances but explicit aggregates use raw inputs', () => {
    expect(draft('Revenue').ast).toEqual({ kind: 'reference', target: 'measure', id: 'mean-revenue' });
    expect(draft('SUM(Revenue)').ast).toEqual({ kind: 'call', function: 'sum', args: [{ kind: 'reference', target: 'field', id: 'raw-revenue' }] });
    expect(draft('MEAN(Profit)').dependencies).toContainEqual({ kind: 'formula', id: 'profit' });
  });
  it('reports sibling measure ambiguity with stable candidate IDs', () => {
    const duplicate: ModelSymbols = { ...symbols, measures: [...symbols.measures, { id: 'sum-revenue', name: 'Revenue', sourceFieldId: 'raw-revenue', aggregation: 'sum' }] };
    expect(draft('Revenue', 'aggregate', duplicate).diagnostics).toContainEqual(expect.objectContaining({ code: 'ambiguous-reference', message: 'Revenue has more than one measure; use an explicit function such as SUM(Revenue)', candidateIds: ['mean-revenue', 'sum-revenue'] }));
    expect(draft('SUM(Revenue)', 'aggregate', duplicate).diagnostics).toEqual([]);
    expect(bindFormula({ kind: 'reference', target: 'measure', id: 'mean-revenue' }, duplicate, 'aggregate').diagnostics).toEqual([]);
  });
  it('rejects duplicate source/formula names instead of choosing a first match', () => {
    expect(draft('Revenue', 'source', { ...symbols, formulas: [...symbols.formulas, { id: 'other', name: 'Revenue', scope: 'source' }] }).diagnostics[0].code).toBe('ambiguous-reference');
  });
  it('preserves stable IDs after all display names change, then refuses deleted IDs', () => {
    const ast = draft('Revenue[Scenario="Prior Budget"]').ast!;
    const renamed: ModelSymbols = { ...symbols, fields: symbols.fields.map(f => ({ ...f, name: 'renamed' })), measures: symbols.measures.map(m => ({ ...m, name: 'New Revenue' })), categories: symbols.categories.map(c => ({ ...c, name: 'New Scenario', members: c.members.map(m => ({ ...m, value: 'renamed' })) })) };
    expect(bindFormula(ast, renamed, 'aggregate').ast).toEqual(ast);
    const removed: ModelSymbols = { ...symbols, measures: [{ ...symbols.measures[0], id: 'replacement' }] };
    expect(bindFormula(ast, removed, 'aggregate')).toMatchObject({ diagnostics: [expect.objectContaining({ code: 'missing-reference', dependencyIds: ['mean-revenue'] })] });
  });
  it('binds member values by type and supports repeated selectors with bracketed category names', () => {
    expect(draft('Revenue[Scenario=1]').ast).toMatchObject({ selectors: [{ categoryId: 'scenario', memberKey: 'number' }] });
    expect(draft('Revenue[Scenario="1"]').ast).toMatchObject({ selectors: [{ categoryId: 'scenario', memberKey: 'string' }] });
    const context = { ...symbols, categories: [...symbols.categories, { id: 'fy', name: 'Fiscal Year', sourceFieldId: 'raw-cost', members: [{ key: 'fy26', value: 2026 }] }] };
    expect(draft('Revenue[Scenario=Actual][[Fiscal Year]=2026]', 'aggregate', context).ast).toMatchObject({ selectors: [{ categoryId: 'scenario', memberKey: 'actual' }, { categoryId: 'fy', memberKey: 'fy26' }] });
    expect(draft('Revenue[Scenario=Actual][Scenario=Actual]').diagnostics[0].code).toBe('invalid-ast');
  });
  it('retains missing member intent and refuses ambiguous member/category names', () => {
    expect(draft('Revenue[Scenario=Budget]').diagnostics[0].code).toBe('missing-member');
    const ast: FormulaAst = { kind: 'member', value: { kind: 'reference', target: 'measure', id: 'mean-revenue' }, selectors: [{ categoryId: 'scenario', memberKey: 'gone' }] };
    expect(bindFormula(ast, symbols, 'aggregate').diagnostics[0]).toMatchObject({ code: 'missing-member', dependencyIds: ['scenario', 'gone'] });
    const categories = [{ ...symbols.categories[0], members: [{ key: 'one', value: 'Actual' }, { key: 'two', value: 'Actual' }] }];
    expect(draft('Revenue[Scenario=Actual]', 'aggregate', { ...symbols, categories }).diagnostics[0].code).toBe('ambiguous-reference');
  });
  it.each(['SUM(Revenue)', 'Margin', 'Revenue[Scenario=Actual]'])('rejects source dependence on aggregate expression %s', expression => {
    expect(draft(expression, 'source').diagnostics.some(d => d.code === 'scope')).toBe(true);
  });
  it('validates persisted target scope even when expression names are unavailable', () => {
    expect(bindFormula({ kind: 'reference', target: 'formula', id: 'margin' }, symbols, 'source').diagnostics[0].code).toBe('scope');
    expect(bindFormula({ kind: 'reference', target: 'measure', id: 'mean-revenue' }, symbols, 'source').diagnostics[0].code).toBe('scope');
    expect(draft('SUM(Margin)').diagnostics[0].code).toBe('scope');
    expect(draft('SUM(SUM(Revenue))').diagnostics[0].code).toBe('scope');
  });
  it('requires an explicit operator without falling back to Sum or a sibling', () => {
    const context = { ...symbols, measures: [{ ...symbols.measures[0], aggregation: undefined }] };
    expect(draft('Revenue[Scenario=Actual]', 'aggregate', context).diagnostics[0].code).toBe('missing-aggregation');
    expect(draft('SUM(Revenue)', 'aggregate', context).diagnostics).toEqual([]);
    expect(draft('Cost').diagnostics[0].code).toBe('missing-aggregation');
  });
  it('retains missing source IDs when input schema is unavailable', () => {
    expect(bindFormula({ kind: 'reference', target: 'field', id: 'raw-revenue' }, { ...symbols, fields: [] }, 'source').diagnostics[0]).toMatchObject({ code: 'missing-reference', dependencyIds: ['raw-revenue'] });
  });
  it('includes source formula dependencies behind measures and category selectors', () => {
    const context = { ...symbols, measures: [{ id: 'profit-measure', name: 'Total Profit', sourceFieldId: 'profit', aggregation: 'sum' as const }], categories: [{ ...symbols.categories[0], sourceFieldId: 'profit' }] };
    const bound = draft('[Total Profit][Scenario=Actual]', 'aggregate', context);
    expect(bound.diagnostics).toEqual([]);
    expect(bound.dependencies).toEqual(expect.arrayContaining([{ kind: 'formula', id: 'profit' }, { kind: 'measure', id: 'profit-measure' }, { kind: 'category', id: 'scenario' }, { kind: 'member', id: 'actual', categoryId: 'scenario' }]));
    expect(draft('[Total Profit]', 'aggregate', { ...context, fields: [...context.fields, { id: 'profit', name: 'Raw Profit' }] }).diagnostics[0].code).toBe('ambiguous-reference');
  });
  it('refuses malformed imported ASTs and keeps caller data unchanged', () => {
    const ast = { kind: 'call', function: 'sum', args: [] };
    expect(bindFormula(ast as unknown as FormulaAst, symbols, 'aggregate').diagnostics[0].code).toBe('invalid-ast');
    const committed: FormulaAst = { kind: 'reference', target: 'measure', id: 'mean-revenue' };
    Object.freeze(committed);
    expect(bindFormula(committed, symbols, 'aggregate').ast).toEqual(committed);
    expect(draft('Unknown').ast).toBeUndefined();
    expect(committed.id).toBe('mean-revenue');
  });
});

it('keeps generic cross-source and formula collisions distinct from sibling measure ambiguity',()=>{
 const other={...symbols,measures:[...symbols.measures,{id:'other',name:'Revenue',sourceFieldId:'raw-cost',aggregation:'sum' as const}]};
 expect(draft('Revenue','aggregate',other).diagnostics[0]).toMatchObject({message:'Ambiguous reference: Revenue. Choose a stable definition.',candidateIds:['mean-revenue','other']});
 const collision={...symbols,formulas:[...symbols.formulas,{id:'other',name:'Revenue',scope:'aggregate' as const}]};
 expect(draft('Revenue','aggregate',collision).diagnostics[0]).toMatchObject({message:'Ambiguous reference: Revenue. Choose a stable definition.'});
});

it.each(['true','null','A-B'])('suggests a parser-safe explicit aggregate for ambiguous source %s',name=>{
 const context:ModelSymbols={fields:[{id:'raw',name}],formulas:[],categories:[],measures:[{id:'total',name,sourceFieldId:'raw',aggregation:'sum'},{id:'average',name,sourceFieldId:'raw',aggregation:'mean'}]};
 const diagnostic=draft(`[${name}]`,'aggregate',context).diagnostics[0];
 const suggestion=`SUM([${name}])`;
 expect(diagnostic).toEqual({code:'ambiguous-reference',message:`${name} has more than one measure; use an explicit function such as ${suggestion}`,candidateIds:['total','average']});
 const parsed=parseFormula(diagnostic.message.split('such as ')[1]);
 expect(parsed.diagnostics).toEqual([]);
 expect(bindFormula(parsed.ast!,context,'aggregate')).toMatchObject({ast:{kind:'call',function:'sum',args:[{kind:'reference',target:'field',id:'raw'}]},diagnostics:[]});
});

it('keeps unrepresentable imported-name ambiguity diagnostic instead of throwing from the autocomplete quoting guard',()=>{
 const name='bad] name';
 const context:ModelSymbols={fields:[{id:'raw',name}],formulas:[],categories:[],measures:[{id:'total',name,sourceFieldId:'raw',aggregation:'sum'},{id:'average',name,sourceFieldId:'raw',aggregation:'mean'}]};
 expect(bindFormula({kind:'name',name},context,'aggregate').diagnostics[0]).toEqual({code:'ambiguous-reference',message:'bad] name has more than one measure; use an explicit function such as SUM([bad] name])',candidateIds:['total','average']});
});
it('binds an unquoted number to a bucketed category member, which is a string', () => {
  // A Y/Q/M bucket's members are strings ("2024"), but people type Revenue[Year=2024].
  const years: ModelSymbols = { ...symbols, categories: [{ id: 'year', name: 'Year', sourceFieldId: 'raw-scenario', transform: 'Y', members: [{ key: 'y2024', value: '2024' }] }] };
  for (const text of ['Revenue[Year=2024]', 'Revenue[Year="2024"]']) expect(draft(text, 'aggregate', years).ast).toMatchObject({ kind: 'member', selectors: [{ categoryId: 'year', memberKey: 'y2024' }] });
  // A native category keeps 1 and "1" distinct.
  expect(draft('Revenue[Scenario=1]').ast).toMatchObject({ selectors: [{ memberKey: 'number' }] });
});
it('binds a fiscal quarter by its displayed label FY2025-Q1 as well as its stored value FY2025 Q1', () => {
  // Author ruling 2026-10-16: headers read FY2025-Q1; saved formulas keep the stored spelling.
  const quarters: ModelSymbols = { ...symbols, categories: [{ id: 'fq', name: 'Quarter', sourceFieldId: 'raw-scenario', transform: 'FQ', members: [{ key: 'q1', value: 'FY2025 Q1' }] }] };
  for (const text of ['Revenue[Quarter="FY2025-Q1"]', 'Revenue[Quarter="FY2025 Q1"]']) expect(draft(text, 'aggregate', quarters).ast).toMatchObject({ kind: 'member', selectors: [{ categoryId: 'fq', memberKey: 'q1' }] });
  expect(draft('Revenue[Quarter="FY2025-Q2"]', 'aggregate', quarters).diagnostics[0]).toMatchObject({ code: 'missing-member' });
  // Only a fiscal quarter reads the label: a native category keeps its text as typed.
  const native: ModelSymbols = { ...symbols, categories: [{ ...quarters.categories[0], transform: 'native' }] };
  expect(draft('Revenue[Quarter="FY2025-Q1"]', 'aggregate', native).diagnostics[0]).toMatchObject({ code: 'missing-member' });
});
