// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { validateLinkedBindings } from './linkedBindings';
import { calculateView } from '../tableExecution/engine';
import { input } from '../tableExecution/fixtures';
import type { TableModelV1 } from './types';
const model = (): TableModelV1 => ({ schemaVersion: 1, params: { promotePage: true, filters: [] }, enabled: true, categories: [], measures: [], formulas: [], layout: { rows: [], columns: [], values: [] }, checklists: [], resultFilters: [], subtotals: { grandTotal: true, groups: false } });
it('blocks an initial linked raw binding while nonlinked calculations retain independent errors', () => {
  const analytical = model();
  analytical.measures = [{ id: 'missing', sourceFieldId: 'absent', aggregation: 'sum' }, { id: 'valid', sourceFieldId: 'revenue', aggregation: 'sum' }];
  const definition = { table: {}, search: '', analytical };
  expect(() => validateLinkedBindings(definition, input.columns)).toThrow(/absent/);
  const result = calculateView(input, definition, { kind: 'none' });
  expect(result.totals.values.valid).toBe(120);
  expect(result.totals.cellErrors?.missing).toBeDefined();
});
it('does not require fields from cyclic or malformed formulas or inactive filters', () => {
  const analytical = model();
  analytical.formulas = [{ id: 'cycle', name: 'Cycle', scope: 'source', expression: '', ast: { kind: 'binary', operator: '+', left: { kind: 'reference', target: 'formula', id: 'cycle' }, right: { kind: 'reference', target: 'field', id: 'absent' } } }];
  expect(() => validateLinkedBindings({ table: { columnFilters: [{ id: 'missing', value: [] }] }, search: '', analytical }, input.columns)).not.toThrow();
  expect(() => validateLinkedBindings({ table: {}, search: '', analytical: { ...analytical, formulas: [...analytical.formulas, { id: 'bad' }] } }, input.columns)).not.toThrow();
});
it('validates active raw formula and fiscal bindings but does not mistake a local source formula for incoming data', () => {
  const analytical = model();
  analytical.formulas = [{ id: 'sourceFormula', name: 'Formula', scope: 'source', expression: '', ast: { kind: 'reference', target: 'field', id: 'revenue' } }];
  analytical.measures = [{ id: 'm', sourceFieldId: 'sourceFormula', aggregation: 'sum' }];
  expect(() => validateLinkedBindings({ table: {}, search: '', analytical }, input.columns)).not.toThrow();
  expect(() => validateLinkedBindings({ table: {}, search: '', analytical }, input.columns.filter(c => c.id !== 'revenue'))).toThrow(/revenue/);
  analytical.categories = [{ id: 'fy', name: 'Fiscal', sourceFieldId: 'date', transform: 'FY', fiscalBinding: { companyFieldId: 'company' } }];
  expect(() => validateLinkedBindings({ table: {}, search: '', analytical }, input.columns)).toThrow(/company/);
});
it('retains malformed local source identities without blocking independent linked calculations', () => {
  const analytical = { ...model(),
    formulas: [{ id: 'f', name: 'F', scope: 'source', expression: '', ast: { kind: 'not-supported' } }],
    measures: [{ id: 'dependent', sourceFieldId: 'f', aggregation: 'sum' }, { id: 'valid', sourceFieldId: 'revenue', aggregation: 'sum' }],
  };
  const definition = { table: {}, search: '', analytical };
  expect(() => validateLinkedBindings(definition, input.columns)).not.toThrow();
  const result = calculateView(input, definition, { kind: 'none' });
  expect(result.totals.values.valid).toBe(120);
  expect(result.totals.cellErrors?.dependent).toBeDefined();
  expect(result.diagnostics.some(d => d.severity === 'error')).toBe(true);
  expect(result.definition.analytical).toEqual(analytical);
  expect(() => validateLinkedBindings(definition, input.columns.filter(c => c.id !== 'revenue'))).toThrow(/revenue/);
});
