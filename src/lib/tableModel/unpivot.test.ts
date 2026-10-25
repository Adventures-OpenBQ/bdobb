// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { UnpivotSpec } from '../statementModel/types';
import { identifyRows } from '../widgetData/identity';
import type { WidgetDataset } from '../widgetData/types';
import { unpivotDataset, unpivotDatasetWithDescriptors } from './unpivot';
import { evaluateSourceFormulas } from './formulaEvaluation';
import { validateFormulaGraph } from './formulaGraph';
import { formula, ref } from './evaluationTestHelpers';

const spec: UnpivotSpec = { id: 'transform', carryFieldIds: ['company'], mappings: [{ sourceFieldId: 'Revenue', lineId: 'revenue' }, { sourceFieldId: 'Cost', lineId: 'cost' }], itemFieldId: 'item', valueFieldId: 'value' };
const dataset = (values: Record<string, unknown>[], keyed = false): WidgetDataset => ({
  rows: identifyRows(values, keyed ? ['company'] : undefined),
  columns: [{ id: 'company', label: 'Company', metadata: { nested: { x: 1 } } }, { id: 'Revenue', label: 'Revenue', dtype: 'number' }, { id: 'Cost', label: 'Cost', dtype: 'number' }],
  resultRevision: 3, outputRevision: 4, provenance: { sourceWidgetId: 'source', metadata: { x: 1 } },
  completeness: { kind: 'partial', warnings: ['partial'] }, freshness: { availability: 'updating', stale: true },
});

describe('private Unpivot', () => {
  it('unpivotPreservesNullAndDistinctIdentity', () => {
    const output = unpivotDataset(dataset([{ company: 'A', Revenue: 100, Cost: 60 }, { company: 'B', Revenue: null }]), spec);
    expect(output.rows.map(r => [r.values.item, r.values.value])).toEqual([['revenue', 100], ['cost', 60], ['revenue', null], ['cost', undefined]]);
    expect(Object.hasOwn(output.rows[3].values, 'value')).toBe(false);
    expect(new Set(output.rows.map(r => r.id)).size).toBe(4);
    expect(new Set(unpivotDataset(dataset([{ Revenue: 100, Cost: 60 }, { Revenue: 100, Cost: 60 }]), spec).rows.map(r => r.id)).size).toBe(4);
  });
  it('preserves keyed identity across reorder, content and label changes', () => {
    const before = unpivotDataset(dataset([{ company: 'A', Revenue: 100 }, { company: 'B', Revenue: 60 }], true), spec);
    const input = dataset([{ company: 'B', Revenue: 70 }, { company: 'A', Revenue: 110 }], true);
    input.columns[1].label = 'Renamed';
    expect(unpivotDataset(input, spec).rows.map(r => r.id)).toEqual([before.rows[2].id, before.rows[3].id, before.rows[0].id, before.rows[1].id]);
    expect(unpivotDataset(input, { ...spec, id: 'other' }).rows[0].id).not.toBe(before.rows[2].id);
    expect(unpivotDataset({ ...input, provenance: { sourceWidgetId: 'other' } }, spec).rows[0].id).not.toBe(before.rows[2].id);
  });
  it('detaches output and preserves metadata, freshness, literal carry fields and undefined', () => {
    const input = dataset([{ company: { name: 'A' }, Revenue: undefined, Cost: null }]);
    const original = structuredClone(input);
    const output = unpivotDataset(input, spec);
    expect(output.freshness).toEqual(input.freshness);
    expect(output.provenance).toEqual(input.provenance);
    expect(output.completeness).toEqual(input.completeness);
    expect(output.resultRevision).toBe(3);
    expect(output.outputRevision).toBe(4);
    expect(output.columns.map(c => c.id)).toEqual(['company', 'item', 'value']);
    expect(Object.hasOwn(output.rows[0].values, 'value')).toBe(true);
    expect(output.rows[0]).not.toHaveProperty('sourceRowId');
    expect(output).not.toHaveProperty('sourceColumnsByRowId');
    (output.rows[0].values.company as { name: string }).name = 'changed';
    output.columns[0].label = 'changed';
    output.provenance.metadata!.x = 2;
    expect(input).toEqual(original);
    const literal = dataset([JSON.parse('{"__proto__":{"name":"A"},"Revenue":1}')]);
    literal.columns.push({ id: '__proto__', label: 'Literal' });
    const carried = unpivotDataset(literal, { ...spec, carryFieldIds: ['__proto__'] });
    expect(Object.hasOwn(carried.rows[0].values, '__proto__')).toBe(true);
    expect(carried.rows[0].values.__proto__).toEqual({ name: 'A' });
  });
  it.each(['100', true, {}, [], NaN, Infinity])('rejects invalid mapped value %j without coercion', value => {
    expect(() => unpivotDataset(dataset([{ Revenue: value }]), spec)).toThrow(expect.objectContaining({ code: 'invalid-type', fieldId: 'Revenue' }));
  });
  it.each([
    { ...spec, mappings: [{ sourceFieldId: 'absent', lineId: 'revenue' }] },
    { ...spec, carryFieldIds: ['absent'] },
    { ...spec, mappings: [{ sourceFieldId: 'Revenue', lineId: 'same' }, { sourceFieldId: 'Cost', lineId: 'same' }] },
    { ...spec, carryFieldIds: ['value'] },
    { ...spec, carryFieldIds: ['company', 'company'] },
    { ...spec, itemFieldId: 'company' },
    { ...spec, itemFieldId: 'value' },
  ])('rejects invalid binding configuration %#', invalid => {
    expect(() => unpivotDataset(dataset([]), invalid)).toThrow(expect.objectContaining({ code: invalid.mappings.some(m => m.sourceFieldId === 'absent') || invalid.carryFieldIds.includes('absent') ? 'missing-reference' : 'duplicate-id' }));
  });
  it('allows one source field mapped to distinct lines and leaves empty input empty', () => {
    const repeated = { ...spec, mappings: [{ sourceFieldId: 'Revenue', lineId: 'one' }, { sourceFieldId: 'Revenue', lineId: 'two' }] };
    const output = unpivotDataset(dataset([{ Revenue: 10 }]), repeated);
    expect(output.rows.map(r => [r.values.item, r.values.value])).toEqual([['one', 10], ['two', 10]]);
    expect(output.rows[0].id).not.toBe(output.rows[1].id);
    expect(unpivotDataset(dataset([]), spec).rows).toEqual([]);
  });
  it('does not collapse duplicate incoming IDs or delimiter-shaped ownership', () => {
    const input = dataset([{ Revenue: 1 }, { Revenue: 2 }]);
    input.rows[1].id = input.rows[0].id;
    expect(new Set(unpivotDataset(input, spec).rows.map(r => r.id)).size).toBe(4);
    const one = unpivotDataset({ ...input, provenance: { sourceWidgetId: 'a/b' } }, { ...spec, id: 'c' });
    const two = unpivotDataset({ ...input, provenance: { sourceWidgetId: 'a' } }, { ...spec, id: 'b/c' });
    expect(one.rows[0].id).not.toBe(two.rows[0].id);
  });
});

it.each(['finite', 'null', 'missing'] as const)('preserves presented upstream %s error blocking and detached public context', kind => {
  const input = dataset([{ company: 'A', ...(kind === 'missing' ? {} : { Revenue: kind === 'finite' ? 100 : null }), Cost: 60 }]);
  input.rows[0].cellErrors = { company: { code: 'fiscal-context', message: 'Company blocked', dependencyIds: ['upstream-company'] }, Revenue: { code: 'division-by-zero', message: 'Revenue blocked', dependencyIds: ['upstream-formula'] }, Cost: { code: 'missing-member', message: 'Cost blocked' } };
  input.rows[0].groupPath = [{ field: 'period', transform: 'FY', value: { start: '2025-01-01', end: '2025-12-31' }, label: 'FY2025' }];
  input.columns[1].splitPath = [{ field: 'period', transform: 'FY', value: 2025 }];
  input.columns[1].analytical = { kind: 'category', definitionId: 'fy', name: 'Fiscal year', transform: 'FY' };
  input.columns[2].splitPath = [{ field: 'period', transform: 'FQ', value: 1 }];
  const before = structuredClone(input);
  const result = unpivotDatasetWithDescriptors(input, spec);
  expect(result.dataset.rows[0].groupPath).toEqual(input.rows[0].groupPath);
  expect(result.dataset.rows[0].cellErrors).toEqual({ company: input.rows[0].cellErrors.company, value: input.rows[0].cellErrors.Revenue });
  expect(result.dataset.rows[1].cellErrors?.value.message).toBe('Cost blocked');
  const formulas = [formula('read-value', ref('value')), formula('read-company', ref('company'))];
  const symbols = { fields: result.dataset.columns.map(c => ({ id: c.id, name: c.label })), formulas, measures: [], categories: [] };
  const model = { columns: result.dataset.columns, symbols, categories: [], fiscal: {}, graph: validateFormulaGraph(formulas, symbols) };
  expect(model.graph.diagnostics).toEqual([]);
  const evaluated = evaluateSourceFormulas(result.dataset.rows, model);
  for (const row of result.dataset.rows) for (const id of ['read-value', 'read-company']) {
    expect(evaluated.formulaCells.get(row.id)?.get(id)).toMatchObject({ ok: false, error: { code: 'blocked-dependency', message: id === 'read-company' ? 'Company blocked' : row.values.item === 'revenue' ? 'Revenue blocked' : 'Cost blocked' } });
  }
  const revenueDescriptor = result.sourceColumnsByRowId.get(result.dataset.rows[0].id)!;
  const costDescriptor = result.sourceColumnsByRowId.get(result.dataset.rows[1].id)!;
  expect(revenueDescriptor.splitPath).toEqual(input.columns[1].splitPath);
  expect(revenueDescriptor.analytical).toEqual(input.columns[1].analytical);
  expect(costDescriptor.splitPath).toEqual(input.columns[2].splitPath);
  expect(result.dataset.columns[2].splitPath).toBeUndefined();
  expect(result.dataset).not.toHaveProperty('sourceColumnsByRowId');
  expect(result.dataset.rows[0]).not.toHaveProperty('sourceRowId');
  result.dataset.rows[0].cellErrors!.value.dependencyIds!.push('changed');
  result.dataset.rows[0].groupPath![0].label = 'changed';
  revenueDescriptor.splitPath![0].value = 999;
  revenueDescriptor.analytical!.name = 'changed';
  expect(input).toEqual(before);
  expect(result.dataset.rows[1].groupPath![0].label).toBe('FY2025');
});
it('detaches envelope metadata and remaps cell formats without sharing input rows',()=>{
 const input=dataset([{company:'A',Revenue:100,Cost:60}]);
 input.provenance.metadata={nested:{value:1}};input.diagnostics=[{code:'source',message:'Context',severity:'info'}];
 input.rows[0].cellFormats={Revenue:{formatterFn:'normalizedPercent',decimalPlaces:2},Cost:{formatterFn:'int'}};
 const before=structuredClone(input),result=unpivotDataset(input,spec);
 expect(result.rows.map(r=>r.cellFormats?.value)).toEqual([{formatterFn:'normalizedPercent',decimalPlaces:2},{formatterFn:'int'}]);
 expect(result.provenance).toEqual(input.provenance);expect(result.completeness).toEqual(input.completeness);expect(result.freshness).toEqual(input.freshness);
 result.provenance.metadata!.nested={value:9};result.diagnostics![0].message='Edited';result.rows[0].cellFormats!.value.decimalPlaces=5;result.rows[0].values.value=999;
 expect(input).toEqual(before);
});
