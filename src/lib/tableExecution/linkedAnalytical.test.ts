// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { calculateView } from './engine';
import { createResultStore } from './resultStore';
import { beginSubset, appendSubset, commitSubset } from './subsetTransfer';
import { input, revision } from './fixtures';
import type { TableModelV1 } from '../tableModel/types';
import type { WidgetDataset } from '../widgetData/types';
const model = (): TableModelV1 => ({ schemaVersion: 1, params: { promotePage: true, filters: [] }, enabled: true, categories: [], measures: [], formulas: [], layout: { rows: [], columns: [], values: [] }, checklists: [], resultFilters: [], subtotals: { grandTotal: true, groups: false } });
function transfer(data: WidgetDataset, analytical?: TableModelV1) {
  const view = calculateView(data, { table: {}, search: '', ...(analytical ? { analytical } : {}) }, { kind: 'explicit', ids: ['r1'] });
  const store = createResultStore(view, revision), transaction = beginSubset('transfer', revision);
  for (const batch of store.presented('subset', revision, 'transfer', 1)) appendSubset(transaction, batch);
  return commitSubset(transaction);
}
it('passes upstream qualified warnings through ordinary tables without changing source age or acquisition bounds', () => {
  const source = structuredClone(input);
  source.diagnostics = [{ code: 'fiscal-alignment', message: 'Companies have different fiscal period boundaries.', severity: 'warning' }];
  source.freshness.lastSuccessAt = 123;
  source.completeness = { kind: 'bounded', acquiredRowCount: 3, totalRowCount: 200, totalRowCountKind: 'estimated', warnings: ['Only acquired rows are available.'] };
  const result = transfer(source);
  expect(result.rows.map(r => r.id)).toEqual(['r1']);
  expect(result.diagnostics).toContainEqual(source.diagnostics[0]);
  expect(result.freshness.lastSuccessAt).toBe(123);
  expect(result.completeness).toEqual(source.completeness);
});
it('keeps incoming errors beside new local errors and publishes no private analytical state', () => {
  const source = structuredClone(input);
  source.rows[1].cellErrors = { revenue: { code: 'division-by-zero', message: 'Upstream failed', affectedRecordCount: 200, recordPreview: ['observed'] } };
  source.rows[1].values.revenue = '#ERROR';
  const local = model(); local.formulas = [{ id: 'failure', name: 'Failure', scope: 'source', expression: '1/0', ast: { kind: 'binary', operator: '/', left: { kind: 'literal', value: 1 }, right: { kind: 'literal', value: 0 } } }];
  const result = transfer(source, local);
  expect(result.rows[0].cellErrors?.revenue).toEqual(source.rows[1].cellErrors.revenue);
  expect(result.rows[0].cellErrors?.failure.code).toBe('division-by-zero');
  expect(JSON.stringify(result)).not.toMatch(/sourceDependencies|sourceRecordIds|formulaCells/);
});
it('treats upstream formula columns as received values without replaying the producer formula', () => {
  const first = model(); first.formulas = [{ id: 'twice', name: 'Twice', scope: 'source', expression: '[Revenue]*2', ast: { kind: 'binary', operator: '*', left: { kind: 'reference', target: 'field', id: 'revenue' }, right: { kind: 'literal', value: 2 } } }];
  const received = transfer(input, first);
  const second = model(); second.formulas = [{ id: 'again', name: 'Again', scope: 'source', expression: '', ast: { kind: 'binary', operator: '+', left: { kind: 'reference', target: 'field', id: 'twice' }, right: { kind: 'literal', value: 1 } } }];
  const result = transfer(received, second);
  expect(result.rows.map(r => r.values.again)).toEqual([41]);
  expect(result.columns.find(c => c.id === 'twice')?.id).toBe('twice');
});
it('transfers compact warning origins and formula descriptors through a second producer', () => {
  const source = structuredClone(input);
  source.modelWarnings = [{ code: 'fiscal-alignment', message: 'Different company bounds; preview is incomplete.', categoryId: 'upstreamCategory', periodCount: 240, origin: { widgetId: 'original', input: 2, model: 3, output: 4 } }];
  source.modelWarningCount = 150;
  const local = model(); local.formulas = [{ id: 'twice', name: 'Twice', scope: 'source', expression: 'private display expression', ast: { kind: 'binary', operator: '*', left: { kind: 'reference', target: 'field', id: 'revenue' }, right: { kind: 'literal', value: 2 } } }];
  const result = transfer(transfer(source, local));
  expect(result.modelWarnings).toEqual(source.modelWarnings);
  expect(result.modelWarningCount).toBe(150);
  expect(result.columns.find(c => c.id === 'twice')?.analytical).toMatchObject({ kind: 'formula', definitionId: 'twice', name: 'Twice', scope: 'source' });
  expect(JSON.stringify(result)).not.toContain('private display expression');
  expect(result.provenance.presentation).toEqual({ scope: 'presented', rowCount: 1, revision });
});
it('rejects private or oversized warning projections at the worker boundary', async () => {
  const { validateExecutionRequest } = await import('./validation');
  const source = structuredClone(input);
  const warning = { code: 'fiscal-alignment' as const, message: 'Different bounds', periodCount: 3, origin: revision };
  const request = () => ({ kind: 'registerInput', requestId: 'r', revision, inputRevision: 1, input: source });
  source.modelWarnings = [{ ...warning, periods: ['private'] } as typeof warning]; source.modelWarningCount = 1;
  expect(() => validateExecutionRequest(request())).toThrow();
  source.modelWarnings = Array.from({ length: 101 }, () => warning); source.modelWarningCount = 101;
  expect(() => validateExecutionRequest(request())).toThrow();
  source.modelWarnings = [warning]; source.modelWarningCount = 0;
  expect(() => validateExecutionRequest(request())).toThrow();
  source.modelWarningCount = 1;
  expect(() => validateExecutionRequest(request())).not.toThrow();
  source.columns[0].analytical = { kind: 'formula', definitionId: 'f', name: 'F', scope: 'source', ast: {} } as NonNullable<typeof source.columns[0]['analytical']>;
  expect(() => validateExecutionRequest(request())).toThrow();
});
it('retains temporal category meaning on selected aggregate member paths', () => {
  const analytical = model(); analytical.categories = [{ id: 'year', name: 'Report year', sourceFieldId: 'date', transform: 'Y' }];
  analytical.layout.rows = ['year']; analytical.measures = [{ id: 'total', sourceFieldId: 'revenue', aggregation: 'sum' }];
  const view = calculateView(input, { table: {}, search: '', analytical }, { kind: 'none' });
  const batches = [...createResultStore(view, revision).presented('members', revision, 'members')];
  expect(batches[0].rows[0].groupPath?.[0]).toMatchObject({ categoryId: 'year', sourceBindingId: 'date', transform: 'Y' });
  expect(batches[0].rows).toHaveLength(1);
  expect(batches[0].rows[0].values.total).toBe(120);
});
it('a linked report totals past an upstream pivot group whose values are all null', () => {
  const source = structuredClone(input);
  (source.rows[2].values as Record<string, unknown>).revenue = null;
  const view = calculateView(source, { table: { pivot: { enabled: true, grouping: ['region'], split: [], aggregationFns: { revenue: 'sum' } } }, search: '' }, { kind: 'none' });
  const store = createResultStore(view, revision), transaction = beginSubset('transfer', revision);
  for (const batch of store.presented('subset', revision, 'transfer', 1)) appendSubset(transaction, batch);
  const linked = commitSubset(transaction);
  expect(linked.rows.map(r => r.values.revenue)).toEqual([30, null]);
  const report = model(); report.measures = [{ id: 'total', sourceFieldId: 'revenue', aggregation: 'sum' }]; report.layout.values = ['total'];
  expect(calculateView(linked, { table: {}, search: '', analytical: report }, { kind: 'none' }).totals).toMatchObject({ values: { total: 30 } });
});
