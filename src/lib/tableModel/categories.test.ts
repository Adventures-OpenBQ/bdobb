// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { categoryRecipe, deriveCategories } from './categories';
import type { CategoryDef } from './types';
const defs: CategoryDef[] = [ { id: 'year', name: 'Year', sourceFieldId: 'ReportDate', transform: 'Y' }, { id: 'quarter', name: 'Quarter', sourceFieldId: 'ReportDate', transform: 'Q' } ];
const rows = [{ id: 'a', values: { ReportDate: '2025-02-28', Revenue: 10 } }, { id: 'b', values: { ReportDate: '2026-02-28', Revenue: 20 } }];

describe('category derivation', () => {
  it('sameDateFieldProvidesYearAndQuarter', () => {
    const result = deriveCategories(rows, defs, {});
    expect(result.rows[0].values).toEqual({ ReportDate: '2025-02-28', Revenue: 10, year: '2025', quarter: '2025-Q1' });
    expect(rows[0].values).toEqual({ ReportDate: '2025-02-28', Revenue: 10 });
    expect(result.members.get('a')?.get('quarter')).toMatchObject({ ok: true, value: { categoryId: 'quarter', key: '["string","2025-Q1"]', label: '2025 Q1', period: { start: '2025-01-01', end: '2025-03-31' } } });
    expect(result.errors.size).toBe(0);
  });
  it('quartersNeverPoolAcrossYears', () => {
    const result = deriveCategories(rows, [defs[1]], {});
    expect(result.rows.map(r => r.values.quarter)).toEqual(['2025-Q1', '2026-Q1']);
    expect(deriveCategories(rows, [...defs].reverse(), {}).rows).toEqual(deriveCategories(rows, defs, {}).rows);
  });
  it('retains typed native members and a distinct blank', () => {
    const input = [1, '1', null, false].map((v, i) => ({ id: String(i), values: { v } }));
    const result = deriveCategories(input, [{ id: 'cat', name: 'Values', sourceFieldId: 'v', transform: 'native' }], {});
    expect([...result.members.values()].map(m => { const c = m.get('cat'); return c?.ok ? c.value.key : undefined; })).toEqual(['["number",1]', '["string","1"]', '["blank",null]', '["boolean",false]']);
  });
  it('executes migrated week and month recipes through maintained calendar semantics', () => {
    const result = deriveCategories([{ id: 'r', values: { date: '2021-01-01' } }], ['week', 'month'].map(legacyBucket => ({ id: legacyBucket, name: legacyBucket, sourceFieldId: 'date', transform: 'native', legacyBucket } as CategoryDef)), {});
    expect(result.rows[0].values).toMatchObject({ week: '2020-W53', month: '2021-01' });
    expect(result.errors.size).toBe(0);
  });
  it('keys errors by record and category without losing valid independent categories', () => {
    const result = deriveCategories([{ id: 'r', values: { ReportDate: '2025-02-29', company: 'A' } }], [...defs, { id: 'company', name: 'Collision', sourceFieldId: 'company', transform: 'native' }], {});
    expect(result.errors.get('r')?.get('year')?.code).toBe('invalid-date');
    expect(result.errors.get('r')?.get('company')?.code).toBe('missing-reference');
    expect(result.rows[0].values).toEqual({ ReportDate: '2025-02-29', company: 'A' });
  });
  it('does not read origin fields or inherited source values', () => {
    const result = deriveCategories([{ id: 'r', values: Object.assign(Object.create({ ReportDate: '2026-01-01' }), { originDate: '2025-01-01' }) }], defs, {});
    expect(result.errors.get('r')?.get('year')?.code).toBe('missing-input');
  });
  it('retains fiscal bounds and rejects conflicting report date mappings', () => {
    const fiscalDef: CategoryDef = { id: 'fy', name: 'FY', sourceFieldId: 'ReportDate', transform: 'FY', fiscalBinding: { companyFieldId: 'company' } };
    const input = [{ id: 'r', values: { ReportDate: '2026-01-01', company: 'A' } }];
    const context = { companies: { A: { yearEndMonth: 9, source: 'file override' } } };
    expect(deriveCategories(input, [fiscalDef], context).rows[0].values.fy).toBe('FY2026');
    const bad = { ...fiscalDef, fiscalBinding: { ...fiscalDef.fiscalBinding!, dateFieldId: 'publicationDate' } };
    expect(deriveCategories(input, [bad], context).errors.get('r')?.get('fy')?.code).toBe('fiscal-context');
  });
  it('recipes survive names and layout but change when interpretation changes', () => {
    expect(categoryRecipe(defs[0])).toBe(categoryRecipe({ ...defs[0], name: 'Renamed' }));
    expect(categoryRecipe(defs[0])).not.toBe(categoryRecipe({ ...defs[0], transform: 'FY', fiscalBinding: { companyFieldId: 'company' } }));
    expect(categoryRecipe({ ...defs[0], transform: 'native', legacyBucket: 'week' })).not.toBe(categoryRecipe({ ...defs[0], transform: 'native', legacyBucket: 'month' }));
  });
});

import { prepareCategoryPivot } from './categories';
import { pivotTable } from '../pivotTable';
import { tableColumns } from '../tableColumns';
import { migratePivot } from './migration';

it('groups synthetic categories through the maintained pivot without losing measures or source formatting', () => {
  const sourceRows = [{ id: 'a', values: { ReportDate: '2026-01-31', Revenue: 10 } }, { id: 'b', values: { ReportDate: '2026-02-28', Revenue: 20 } }, { id: 'c', values: { ReportDate: '2026-04-30', Revenue: 40 } }, { id: 'd', values: { ReportDate: '2026-05-31', Revenue: 60 } }];
  const columns = tableColumns(sourceRows.map(r => r.values), undefined);
  columns[1].format = { decimalPlaces: 2 };
  const measures = [{ id: 'sum', sourceFieldId: 'Revenue', aggregation: 'sum' as const }, { id: 'mean', sourceFieldId: 'Revenue', aggregation: 'mean' as const }, { id: 'unset', sourceFieldId: 'Revenue' }];
  const result = prepareCategoryPivot({ columns, order: ['ReportDate', 'Revenue'], kinds: new Map([['ReportDate', 'date'], ['Revenue', 'number']]), sorting: [] }, deriveCategories(sourceRows, defs, {}), { layout: { values: [], rows: ['year', 'quarter'], columns: [] }, measures });
  if (!result.ok) throw new Error('expected input');
  expect(result.input.columns.slice(0, 2)).toEqual(columns);
  expect(result.input.order).toEqual(['ReportDate', 'Revenue']);
  expect(result.input.config.measures).toEqual(measures);
  const pivot = pivotTable(result.input);
  if (!pivot?.ok) throw new Error('expected pivot');
  const groups = pivot.meta.flatMap((m, i) => m.kind === 'group' ? [{ ...m, values: pivot.rows[i] }] : []);
  expect(groups.map(g => g.label)).toEqual(['2026', '2026 Q1', '2026 Q2']);
  expect(groups[1]).toMatchObject({ incomplete: { have: 2, expected: 3 }, values: { sum: 30, mean: 15 } });
  expect(groups[1].values.unset).toBeUndefined();
  expect(pivot.columns.find(c => c.measureId === 'sum')?.format).toEqual(columns[1].format);
  const moved = prepareCategoryPivot({ ...result.input, columns }, deriveCategories(sourceRows, defs, {}), { layout: { values: [], rows: ['year'], columns: ['quarter'] }, measures });
  if (!moved.ok) throw new Error('expected moved input');
  const split = pivotTable(moved.input);
  if (!split?.ok) throw new Error('expected split');
  expect(split.columns.some(c => c.groupPath.includes('2026 Q1 (2 of 3)'))).toBe(true);
});

it.each(['week', 'month'] as const)('executes migrated %s grouping without pooling or losing aggregates', bucket => {
  const sourceRows = [{ id: 'a', values: { date: '2021-01-01', value: 10 } }, { id: 'b', values: { date: '2021-01-08', value: 20 } }];
  const model = migratePivot({ enabled: true, grouping: ['date'], split: [], buckets: { date: bucket }, measures: [{ id: 'total', sourceFieldId: 'value', aggregation: 'sum' }] });
  const prepared = prepareCategoryPivot({ columns: tableColumns(sourceRows.map(r => r.values), undefined), order: ['date', 'value'], kinds: new Map([['date', 'date'], ['value', 'number']]), sorting: [] }, deriveCategories(sourceRows, model.categories, {}), model);
  if (!prepared.ok) throw new Error('expected input');
  const result = pivotTable(prepared.input);
  if (!result?.ok) throw new Error('expected pivot');
  expect(result.meta.filter(m => m.kind === 'group').map(m => m.label)).toEqual(bucket === 'week' ? ['2020-W53', '2021-W01'] : ['2021-01']);
  expect(result.rows[0].total).toBe(bucket === 'week' ? 10 : 30);
});

it('refuses failed active categories and retains the pivot column limit', () => {
  const source = { columns: tableColumns(rows.map(r => r.values), undefined), order: ['Revenue'], kinds: new Map([['ReportDate', 'date' as const], ['Revenue', 'number' as const]]), sorting: [] };
  const invalid = deriveCategories([{ id: 'bad', values: { ReportDate: 'bad', Revenue: 1 } }], defs, {});
  expect(prepareCategoryPivot(source, invalid, { layout: { values: [], rows: ['year'], columns: [] }, measures: [] })).toMatchObject({ ok: false, errors: [{ code: 'invalid-date' }] });
  const prepared = prepareCategoryPivot(source, deriveCategories(rows, defs, {}), { layout: { values: [], rows: [], columns: ['year'] }, measures: Array.from({ length: 250 }, (_, i) => ({ id: `m${i}`, sourceFieldId: 'Revenue', aggregation: 'sum' as const })) });
  if (!prepared.ok) throw new Error('expected input');
  expect(pivotTable(prepared.input)).toMatchObject({ ok: false, reason: expect.stringContaining('501 columns') });
});

it('rejects unsupported native values instead of merging objects or nonfinite values by their labels', () => {
  const input = [{ id: 'object', values: { source: { a: 1 } } }, { id: 'number', values: { source: Infinity } }];
  const result = deriveCategories(input, [{ id: 'cat', name: 'Category', sourceFieldId: 'source', transform: 'native' }], {});
  expect(result.errors.get('object')?.get('cat')?.code).toBe('missing-input');
  expect(result.errors.get('number')?.get('cat')?.code).toBe('nonfinite');
});

it('retains week bounds and warns about coarse weekly calendar grouping', () => {
  const input = ['2021-01-01', '2021-01-08', '2021-01-15'].map((date, i) => ({ id: String(i), values: { date } }));
  const result = deriveCategories(input, [{ id: 'week', name: 'Week', sourceFieldId: 'date', transform: 'native', legacyBucket: 'week' }, { id: 'year', name: 'Year', sourceFieldId: 'date', transform: 'Y' }], {});
  expect(result.members.get('0')?.get('week')).toMatchObject({ ok: true, value: { period: { start: '2020-12-28', end: '2021-01-03' } } });
  expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'approximate-period', categoryId: 'year' }));
});

it('changes derived fiscal recipe metadata when per-company calendar interpretation changes', () => {
  const definition: CategoryDef = { id: 'fy', name: 'Year', sourceFieldId: 'date', transform: 'FY', fiscalBinding: { companyFieldId: 'company' } };
  const input = [{ id: 'r', values: { date: '2026-01-01', company: 'A' } }];
  const september = deriveCategories(input, [definition], { companies: { A: { yearEndMonth: 9, source: 'file' } } });
  const december = deriveCategories(input, [definition], { companies: { A: { yearEndMonth: 12, source: 'file' } } });
  expect(september.rows[0].values.fy).toBe(december.rows[0].values.fy);
  expect(september.categories.get('fy')?.recipe).not.toBe(december.categories.get('fy')?.recipe);
});

it('carries mixed-company alignment details out of category derivation', () => {
  const input = ['A', 'B'].map(company => ({ id: company, values: { date: '2026-01-01', company } }));
  const result = deriveCategories(input, [{ id: 'fy', name: 'Fiscal year', sourceFieldId: 'date', transform: 'FY', fiscalBinding: { companyFieldId: 'company' } }], { companies: { A: { yearEndMonth: 9, source: 'override' }, B: { yearEndMonth: 12, source: 'metadata' } } });
  expect(result.warnings).toEqual([{ code: 'fiscal-alignment', categoryId: 'fy', message: expect.stringContaining('FY2026'), periods: [{ companyKey: 'A', start: '2025-10-01', end: '2026-09-30', source: 'override' }, { companyKey: 'B', start: '2026-01-01', end: '2026-12-31', source: 'metadata' }] }]);
});

it('keeps explicit bound period kind in category compatibility recipes', () => {
  const definition: CategoryDef = { id: 'fy', name: 'Fiscal year', sourceFieldId: 'date', transform: 'FY', fiscalBinding: { companyFieldId: 'company', periodKind: 'FY' } };
  expect(categoryRecipe(definition)).not.toBe(categoryRecipe({ ...definition, fiscalBinding: { ...definition.fiscalBinding!, periodKind: 'FQ' } }));
});
