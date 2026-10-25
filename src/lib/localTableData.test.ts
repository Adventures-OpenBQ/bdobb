// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { datasetFromBytes } from './localTableData';
it('normalizes literal column IDs and complete local provenance', async () => {
  const result = await datasetFromBytes('data.json', new TextEncoder().encode('[{"a.b":10},{"a.b":20}]'), 'widget', 4);
  expect(result.columns).toEqual([{ id: 'a.b', label: 'a.b' }]);
  expect(result.rows.map(r => r.values['a.b'])).toEqual([10, 20]);
  expect(new Set(result.rows.map(r => r.id)).size).toBe(2);
  expect(result.completeness).toEqual({ kind: 'complete', warnings: [], acquiredRowCount: 2, totalRowCount: 2, totalRowCountKind: 'exact' });
  expect(result.provenance.sourceKind).toBe('localFile');
});
it('rejects malformed files without leaking contents', async () => {
  await expect(datasetFromBytes('data.json', new TextEncoder().encode('private secret'), 'widget', 1)).rejects.toThrow(/^Could not parse local table$/);
});
// D-011: SheetJS leaves a blank cell out of its row, and a JSON row may omit a
// key. Either way the column exists on every row, holding null.
it.each([
  ['blank.csv', 'Company,Amount\nAAPL,100\nMSFT,\nIBM,50\n'],
  ['blank.json', '[{"Company":"AAPL","Amount":100},{"Company":"MSFT"},{"Company":"IBM","Amount":50}]'],
])('%s: an absent cell is present as null on its row', async (name, text) => {
  const result = await datasetFromBytes(name, new TextEncoder().encode(text), 'widget', 1);
  const blank = result.rows[1].values;
  expect(Object.hasOwn(blank, 'Amount')).toBe(true);
  expect(blank.Amount).toBeNull();
  expect(result.rows.map(r => r.values.Amount)).toEqual([100, null, 50]);
});
it('fills an absent __proto__ field as an own null value without touching the prototype', async () => {
  const result = await datasetFromBytes('proto.json', new TextEncoder().encode('[{"__proto__":1,"a":2},{"a":3}]'), 'widget', 1);
  const filled = result.rows[1].values;
  expect(Object.hasOwn(filled, '__proto__')).toBe(true);
  expect(Object.getOwnPropertyDescriptor(filled, '__proto__')?.value).toBeNull();
  expect(Object.getPrototypeOf(filled)).toBe(Object.prototype);
  expect(result.columns.map(c => c.id)).toEqual(['__proto__', 'a']);
});
// User ruling 2026-10-15: a local statement table is relabelled in the worker, from year ends the main thread fetched.
it('relabels statement rows from the given year ends before rows are identified', async () => {
  const { STATEMENT_CSV, STATEMENT_YEAR_ENDS, STATEMENT_LABELS } = await import('../test/fixtures/statementRows');
  const bytes = new TextEncoder().encode(STATEMENT_CSV);
  const result = await datasetFromBytes('s.csv', bytes, 'widget', 1, STATEMENT_YEAR_ENDS);
  expect(result.rows.map(r => [r.values.fiscal_period, r.values.fiscal_year])).toEqual(STATEMENT_LABELS);
  expect(result.diagnostics).toBeUndefined();
  const plain = await datasetFromBytes('s.csv', bytes, 'widget', 1, {});
  expect(plain.rows.map(r => r.values.fiscal_period)).toEqual(['Q2', 'FY', 'Q2']);
  expect(plain.diagnostics).toEqual([{ code: 'FISCAL_AS_REPORTED', severity: 'info', message: 'Fiscal labels as reported' }]);
  expect((await datasetFromBytes('s.csv', bytes, 'widget', 1)).diagnostics).toBeUndefined();
});
