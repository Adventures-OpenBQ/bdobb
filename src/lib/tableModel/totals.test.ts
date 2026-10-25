// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { calculateTotals } from './totals';
import { eligiblePool } from './facets';
import { evaluateSourceFormulas } from './formulaEvaluation';
import { compileAnalyticalModel } from './calculate';
import type { TableModelV1 } from './types';
it('recalculates ratio, median and chronological Last from identity union with empty distinct', () => {
    const model: TableModelV1 = { schemaVersion: 1, params: { promotePage: true, filters: [] }, enabled: true, categories: [{ id: 'year', name: 'Year', sourceFieldId: 'date', transform: 'Y' }], measures: [{ id: 'last', sourceFieldId: 'x', aggregation: 'last' }, { id: 'median', sourceFieldId: 'x', aggregation: 'median' }], formulas: [{ id: 'ratio', name: 'Ratio', scope: 'aggregate', expression: '', ast: { kind: 'binary', operator: '/', left: { kind: 'call', function: 'sum', args: [{ kind: 'reference', target: 'field', id: 'x' }] }, right: { kind: 'call', function: 'sum', args: [{ kind: 'reference', target: 'field', id: 'y' }] } } }], layout: { rows: ['year'], columns: [], values: ['ratio'] }, checklists: [], resultFilters: [], subtotals: { grandTotal: true, groups: true } };
    const columns = [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }, { id: 'date', label: 'Date' }];
    const compiled = compileAnalyticalModel(model, { columns });
    const evaluated = evaluateSourceFormulas([{ id: 'a', values: { x: 100, y: 100, date: '2025-02-01' } }, { id: 'b', values: { x: 4, y: 2, date: '2025-01-01' } }, { id: 'c', values: { x: 6, y: 8, date: '2025-03-01' } }], compiled);
    const pool = eligiblePool(evaluated, { columns });
    const total = calculateTotals(new Set(['a', 'b', 'c']), pool, compiled);
    expect(total.formulas.cells.get('ratio')).toEqual({ ok: true, value: 1 });
    expect(total.measures.cells.get('median')).toEqual({ ok: true, value: 6 });
    expect(total.measures.cells.get('last')).toEqual({ ok: true, value: 6 });
    expect(calculateTotals(new Set(), pool, compiled)).toMatchObject({ empty: true });
});
it('requires an explicit unambiguous chronological binding for Last', () => {
    const columns = [{ id: 'x', label: 'X' }, { id: 'date', label: 'ReportDate' }];
    const raw: TableModelV1 = { schemaVersion: 1, params: { promotePage: true, filters: [] }, enabled: true, categories: [], measures: [{ id: 'last', sourceFieldId: 'x', aggregation: 'last' }], formulas: [], layout: { rows: [], columns: [], values: [] }, checklists: [], resultFilters: [], subtotals: { grandTotal: true, groups: true } };
    const compiled = compileAnalyticalModel(raw, { columns });
    const pool = eligiblePool(evaluateSourceFormulas([{ id: 'a', values: { x: 1, date: '2026-01-01' } }], compiled), { columns });
    expect(calculateTotals(new Set(['a']), pool, compiled).measures.cells.get('last')).toMatchObject({ ok: false, error: { code: 'missing-input' } });
});
