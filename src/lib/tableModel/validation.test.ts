// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { validateTableModel } from './validation';

const model = () => ({ schemaVersion: 1, params: { promotePage: true, filters: [] }, enabled: true, categories: [{ id: 'year', name: 'Year', sourceFieldId: 'date', transform: 'Y' }], measures: [{ id: 'revenue', sourceFieldId: 'revenue' }], formulas: [], layout: { rows: ['year'], columns: [], values: [] }, checklists: [], resultFilters: [], subtotals: { grandTotal: true, groups: false } });

describe('model validation', () => {
  it('rejectsMultiplePages', () => {
    const raw = { ...model(), layout: { rows: [], columns: [], values: [], page: [{ categoryId: 'year', memberKey: 'n:2025' }, { categoryId: 'year', memberKey: 'n:2026' }] } };
    const result = validateTableModel(raw);
    expect(result.model).toBeUndefined();
    expect(result.raw).toBe(raw);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ path: 'layout.page', severity: 'error' }));
  });
  it('retainsInvalidImportedDefinitionsForInspection', () => {
    const raw = { ...model(), formulas: [{ id: 'broken', name: 'Broken', scope: 'source', expression: 'bad', ast: { kind: 'script', code: 'throw 1' } }, { id: 'good', name: 'Good', scope: 'source', expression: '1', ast: { kind: 'literal', value: 1 } }] };
    const result = validateTableModel(raw);
    expect(result.raw).toBe(raw);
    expect(result.model).toBeUndefined();
    expect(result.formulas[0].raw).toBe(raw.formulas[0]);
    expect(result.formulas[0].value).toBeUndefined();
    expect(result.formulas[1].value).toEqual(raw.formulas[1]);
  });
  it('preserves and refuses future schemas without interpreting definitions', () => {
    const raw = { schemaVersion: 99, formulas: ['future'] };
    const result = validateTableModel(raw);
    expect(result.raw).toBe(raw);
    expect(result.model).toBeUndefined();
    expect(result.diagnostics[0].code).toBe('unsupported-schema');
    expect(result.formulas).toEqual([]);
  });
  it('rejects missing and ambiguous references while retaining definitions', () => {
    const raw = model();
    raw.layout.rows = ['missing'];
    raw.categories.push({ ...raw.categories[0], name: 'Duplicate' });
    const result = validateTableModel(raw);
    expect(result.model).toBeUndefined();
    expect(result.categories).toHaveLength(2);
    expect(result.diagnostics.map(d => d.code)).toEqual(expect.arrayContaining(['duplicate-id', 'missing-reference']));
  });
  it('validates bound stable references and single typed page/checklist membership', () => {
    const raw = { ...model(), layout: { rows: [], columns: [], values: ['f'], page: { categoryId: 'year', memberKeys: ['n:2025'] } }, checklists: [{ categoryId: 'year', memberKeys: ['n:2025', 's:2025'] }], formulas: [{ id: 'f', name: 'Renamable', scope: 'aggregate', expression: 'Revenue', ast: { kind: 'reference', target: 'measure', id: 'revenue' } }], resultFilters: [{ id: 'filter', categoryId: 'year', target: { kind: 'formula', id: 'f' }, predicate: 'gt', value: 0 }] };
    expect(validateTableModel(raw).model).toEqual(raw);
    expect(validateTableModel({ ...raw, layout: { ...raw.layout, rows: ['year'] } }).model).toBeUndefined();
  });
  it('does not invoke accessors and bounds recursive input', () => {
    let calls = 0;
    const raw = Object.defineProperty({}, 'schemaVersion', { get() { calls++; return 1; }, enumerable: true });
    expect(validateTableModel(raw).model).toBeUndefined();
    expect(calls).toBe(0);
    const cycle: Record<string, unknown> = model(); cycle.self = cycle;
    expect(validateTableModel(cycle).model).toBeUndefined();
    expect(validateTableModel({ ...model(), subtotals: { grandTotal: 'yes', groups: false } }).model).toBeUndefined();
  });
});

it('refuses sparse definition arrays and malformed legacy evidence', () => {
  const raw = { ...model(), categories: new Array(2) };
  expect(validateTableModel(raw).model).toBeUndefined();
  const disguised = Object.assign(new Array(1), { extra: 'not an index' });
  expect(validateTableModel({ ...model(), categories: disguised }).model).toBeUndefined();
  expect(validateTableModel({ ...model(), legacyPivot: { enabled: 'yes' } }).model).toBeUndefined();
});

it('retains invalid operators and missing bound dependencies with targeted diagnostics', () => {
  const raw = { ...model(), measures: [{ id: 'bad', sourceFieldId: 'gone', aggregation: 'automatic' }], formulas: [{ id: 'dependent', name: 'Dependent', scope: 'aggregate', expression: 'Bad', ast: { kind: 'reference', target: 'measure', id: 'bad' } }] };
  const result = validateTableModel(raw);
  expect(result.model).toBeUndefined();
  expect(result.measures[0].raw).toEqual(raw.measures[0]);
  expect(result.formulas[0].diagnostics).toContainEqual(expect.objectContaining({ definitionId: 'dependent', dependencyId: 'bad', code: 'missing-reference' }));
});

it('accepts separate calendar/fiscal recipes and never inserts fiscal context', () => {
  const raw = { ...model(), categories: [{ id: 'fy', name: 'Fiscal Year', sourceFieldId: 'date', transform: 'FY' }, { id: 'fq', name: 'Fiscal Quarter', sourceFieldId: 'date', transform: 'FQ', fiscalBinding: { companyFieldId: 'company', metadataKey: 'providerFiscal' } }], layout: { rows: ['fy', 'fq'], columns: [], values: [] } };
  const result = validateTableModel(raw);
  expect(result.model).toEqual(raw);
  expect(result.categories[0].value?.fiscalBinding).toBeUndefined();
  expect(validateTableModel({ ...raw, categories: [{ ...raw.categories[1], fiscalBinding: { companyFieldId: 1 } }] }).model).toBeUndefined();
});

it('validates an explicit fiscal bound kind without discarding invalid imported mappings', () => {
  const raw = { ...model(), categories: [{ id: 'fy', name: 'Fiscal year', sourceFieldId: 'date', transform: 'FY', fiscalBinding: { companyFieldId: 'company', periodKind: 'month' } }], layout: { rows: ['fy'], columns: [], values: [] } };
  const invalid = validateTableModel(raw);
  expect(invalid.model).toBeUndefined();
  expect(invalid.categories[0].raw).toBe(raw.categories[0]);
  raw.categories[0].fiscalBinding.periodKind = 'FY';
  expect(validateTableModel(raw).model).toEqual(raw);
});

it('applies exact formula AST depth and node limits per entry, preserving independent imports', () => {
  type Ast = import('./types').FormulaAst;
  let ast: Ast = { kind: 'literal', value: 1 };
  for (let i = 0; i < 63; i++) ast = { kind: 'unary', operator: '-', operand: ast };
  const formula = (id: string, tree: Ast, expression = '1') => ({ id, name: id, scope: 'source', expression, ast: tree });
  const good = formula('good', ast);
  expect(validateTableModel({ ...model(), formulas: [good] }).model).toBeDefined();
  const tree = (leaves: number): Ast => leaves === 1 ? { kind: 'literal', value: 1 } : { kind: 'binary', operator: '+', left: tree(Math.floor(leaves / 2)), right: tree(Math.ceil(leaves / 2)) };
  const raw = { ...model(), formulas: [formula('deep', { kind: 'unary', operator: '-', operand: ast }), formula('wide', tree(513)), formula('text', tree(1), `"${'é'.repeat(8192)}"`), good] };
  const result = validateTableModel(raw);
  expect(result.formulas.map(e => e.diagnostics[0]?.code)).toEqual(['depth-limit', 'node-limit', 'expression-limit', undefined]);
  expect(result.formulas[0].raw).toBe(raw.formulas[0]);
  expect(result.formulas[0].value).toBeUndefined();
  expect(result.formulas[3].value).toEqual(good);
  expect(validateTableModel({ ...model(), formulas: [formula('edge', { kind: 'unary', operator: '-', operand: tree(512) })] }).model).toBeDefined();
});

it('retains raw malicious whole-model resources without iterating huge sparse arrays', () => {
  let deep: unknown = 1;
  for (let i = 0; i < 257; i++) deep = { child: deep };
  for (const payload of [deep, 'x'.repeat(1_000_001), new Array(2 ** 32 - 1), Array.from({ length: 50_001 }, () => 1)]) {
    const raw = { ...model(), payload };
    const result = validateTableModel(raw);
    expect(result.raw).toBe(raw);
    expect(result.model).toBeUndefined();
    expect(result.diagnostics[0].code).toBe('invalid-structure');
  }
});

it('requires explicit pivot controls and retains indexed invalid values intent', () => {
  const raw = { ...model(), enabled: false, layout: { ...model().layout, values: ['revenue'] } };
  expect(validateTableModel(raw).model).toBe(raw);
  const { enabled: _enabled, ...absent } = raw;
  expect(validateTableModel(absent).diagnostics).toContainEqual(expect.objectContaining({ path: 'enabled' }));
  expect(validateTableModel({ ...raw, layout: { rows: [], columns: [] } }).diagnostics).toContainEqual(expect.objectContaining({ path: 'layout.values' }));
  const invalid = { ...raw, layout: { ...raw.layout, values: ['revenue', 'revenue', 'year', 'unknown', 'source'] }, formulas: [{ id: 'source', name: 'Source', scope: 'source', expression: '1', ast: { kind: 'literal', value: 1 } }] };
  const result = validateTableModel(invalid);
  expect(result.raw).toBe(invalid);
  expect(result.diagnostics.map(d => d.path)).toEqual(expect.arrayContaining(['layout.values.1', 'layout.values.2', 'layout.values.3', 'layout.values.4']));
});
it('refuses unsafe and oversized values arrays without reading accessors',()=>{
 const raw={...model(),enabled:true};let calls=0;
 const values=Object.defineProperty([],0,{get(){calls++;return 'revenue';},enumerable:true});
 expect(validateTableModel({...raw,layout:{...raw.layout,values}}).diagnostics[0].path).toBe('');expect(calls).toBe(0);
 expect(validateTableModel({...raw,layout:{...raw.layout,values:new Array(100000)}}).model).toBeUndefined();
 const cycle:unknown[]=[];cycle.push(cycle);expect(validateTableModel({...raw,layout:{...raw.layout,values:cycle}}).model).toBeUndefined();
 expect(validateTableModel({...raw,enabled:'yes'}).diagnostics).toContainEqual(expect.objectContaining({path:'enabled'}));
});

it('requires authored parameter metadata rather than defaulting missing saved models',()=>{
 const raw:Record<string,unknown>=model(); delete raw.params; const checked=validateTableModel(raw);
 expect(checked.model).toBeUndefined();expect(checked.raw).toBe(raw);
 expect(checked.diagnostics).toContainEqual(expect.objectContaining({path:'params',severity:'error'}));
});
