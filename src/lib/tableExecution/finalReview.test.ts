// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { createWorkerExecutor } from './workerClient';
import { Boundary } from '../../test/tableWorkerBoundary';
import { input } from './fixtures';
import { buildLinkedFigure } from '../widgetData/chartFigure';
import type { TableDefinition } from './types';
import { migratePivot } from '../tableModel/migration';
it.each(['count', 'uniqueCount'] as const)('ordinary %s over text publishes numeric counts to linked tables and charts only for aggregate cells', async aggregation => {
  const executor = createWorkerExecutor('root', () => new Boundary() as unknown as Worker);
  const signal = new AbortController().signal;
  const revision = { widgetId: 'root', input: 1, model: 1, output: 1 };
  await executor.registerInput(input, 1, signal);
  const ready = await executor.applyModel({ search: '', table: { pivot: { enabled: true, grouping: ['region'], split: [], measures: [{ id: 'n', sourceFieldId: 'team', aggregation }, { id: 'text', sourceFieldId: 'team', aggregation: 'first' }] } } }, { kind: 'none' }, revision, signal);
  expect(ready.columns.find(c => c.id === 'n')).toMatchObject({ dtype: 'number', format: { formatterFn: 'int' } });
  const batches = []; for await (const batch of executor.presented(revision, signal)) batches.push(batch);
  expect(batches[0].rows.map(r => r.values.n)).toEqual([2, 1]);
  expect(batches[0].rows.map(r => r.values.text)).toEqual(['0', '2']);
  const chart = await executor.chartData(revision, ready.columns.map(c => c.id), signal);
  expect(buildLinkedFigure(chart, { category: ready.columns[0].id, measures: ['n'], type: 'column', display: 'grouped' }, 'light').ok).toBe(true);
  const roots = await executor.rows(revision, { groupPath: [], offset: 0, limit: 10 }, signal);
  const leaves = await executor.rows(revision, { groupPath: roots.groups[0].path, offset: 0, limit: 10 }, signal);
  // A leaf is one row: its count is 1, never the raw value counted (the
  // fixture's team values are themselves '0' and '1').
  expect(leaves.rows.map(r => r.values.n)).toEqual(['1', '1']);
  expect((await executor.totals(revision, signal)).values.n).toBe(3);
  executor.dispose();
});
it.each([false, true])('analytical presentation projects hidden/order at worker and linked seams (grouped=%s), retaining private formula inputs', async grouped => {
  const executor = createWorkerExecutor('root', () => new Boundary() as unknown as Worker);
  const signal = new AbortController().signal;
  const revision = { widgetId: 'root', input: 1, model: 1, output: 1 };
  const analytical = migratePivot({ enabled: grouped, grouping: grouped ? ['region'] : [], split: [], measures: [{ id: 'twice-total', sourceFieldId: 'twice', aggregation: 'sum' }, { id: 'revenue', sourceFieldId: 'revenue', aggregation: 'sum' }] }, { columns: input.columns });
  analytical.formulas = [{ id: 'twice', name: 'Twice', scope: 'source', expression: '[Revenue]*2', ast: { kind: 'binary', operator: '*', left: { kind: 'reference', target: 'field', id: 'revenue' }, right: { kind: 'literal', value: 2 } } }];
  const definition: TableDefinition = { search: '', analytical, table: { hidden: ['revenue', 'team', 'date'], columnOrder: ['twice', 'twice-total', 'region'] } };
  await executor.registerInput(input, 1, signal);
  const ready = await executor.applyModel(definition, { kind: 'none' }, revision, signal);
  expect(ready.columns.map(c => c.id)).toEqual(grouped ? ['twice-total', '\x1egroup'] : ['twice', 'region']);
  expect(ready.inspection.inputColumns.some(c => c.id === 'revenue')).toBe(true);
  const batches = []; for await (const batch of executor.presented(revision, signal)) batches.push(batch);
  expect(batches[0].rows.map(r => r.values[grouped ? 'twice-total' : 'twice'])).toEqual(grouped ? [60, 180] : [20, 40, 180]);
  expect(batches[0].rows.every(r => !Object.hasOwn(r.values, 'revenue'))).toBe(true);
  const delivered = await executor.rows(revision, { groupPath: [], offset: 0, limit: 10 }, signal);
  expect(delivered.rows.every(r => !Object.hasOwn(r.values, 'revenue'))).toBe(true);
  executor.dispose();
});

it('normalizes only exact safe metadata-proven counts and retains missing/error cells', async () => {
  const { countValues } = await import('./counts');
  const columns = [{ id: 'n', label: 'Count', aggregation: 'uniqueCount' as const }, { id: 'text', label: 'Text' }];
  expect(countValues({ n: '9007199254740991', text: '123' }, columns)).toEqual({ n: Number.MAX_SAFE_INTEGER, text: '123' });
  for (const n of ['9007199254740992', 9007199254740992n, -1, 1.5, '1e2', Infinity]) expect(() => countValues({ n }, columns)).toThrow(/safe numeric/);
  for (const n of [null, undefined, '#ERROR', new Error('count failed')]) expect(countValues({ n }, columns).n).toBe(n);
  expect(countValues({ n: 12n }, columns).n).toBe(12);
});
