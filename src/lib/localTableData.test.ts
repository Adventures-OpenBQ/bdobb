// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { dataFromBytes, datasetFromBytes } from './localTableData';
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

it('keeps explicit acquisition status and requests out of the price rows when importing a snapshot', async () => {
  const rows = [{ date: '2026-01-02', adjusted_close: 100 }];
  const receipt = { start_date: '2026-01-01', end_date: '2026-01-31', interval: '1d', symbol: 'A' };
  for (const completeness of ['complete', 'bounded', 'paged', 'sample', 'unknown', 'partial']) {
    const bytes = new TextEncoder().encode(JSON.stringify({ rows, receipt, completeness }));
    const file = await datasetFromBytes('history.json', bytes, 'widget', 1);
    expect(await dataFromBytes('history.json', bytes)).toEqual(rows);
    expect(file.rows.map(row => row.values)).toEqual(rows);
    expect(file.provenance.receipt).toEqual(receipt);
    expect(file.completeness.kind).toBe(completeness);
  }
});

it('refuses a malformed snapshot or an undeclared receipt field', async () => {
  const rows = [{ symbol: 'A', adjusted_close: 100 }];
  for (const value of [
    { rows, receipt: {}, completeness: 'invented' },
    { rows, receipt: { interval: {} }, completeness: 'bounded' },
    { rows, receipt: { token: 'unused' }, completeness: 'bounded' },
    { rows, receipt: {}, completeness: 'complete', extra: true },
  ]) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    await expect(datasetFromBytes('invalid.json', bytes, 'widget', 1)).rejects.toThrow('Could not parse local table');
  }
});

it('rebuilds ETF evidence from each opened snapshot and refuses saved evidence injection', async () => {
  const receipt = { fund_symbol: 'FUND_A.US', etf_kind: 'sector', weight_basis: 'equity-exposure', as_of: '2026-09-30', holdings_coverage: 'partial', retrieved_at: '2026-11-19T12:00:00Z' };
  const snapshot = { receipt, rows: [{ sector: 'Energy', weight: .14 }], completeness: 'unknown' };
  const open = (value: unknown) => datasetFromBytes('sectors.json', new TextEncoder().encode(JSON.stringify(value)), 'fund', 1);
  const first = await open(snapshot);
  expect(first.provenance.metadata?.etfEvidence).toMatchObject({ fund: receipt.fund_symbol, holdingsCoverage: 'partial', asOf: '2026-09-30', retrievedAt: Date.parse(receipt.retrieved_at) });
  expect((await open({ ...snapshot, receipt: { ...receipt, fund_symbol: 'FUND_B.US' } })).provenance.metadata?.etfEvidence).toMatchObject({ fund: 'FUND_B.US' });
  await expect(open({ ...snapshot, metadata: first.provenance.metadata })).rejects.toThrow('Could not parse local table');
  await expect(open({ ...snapshot, receipt: { ...receipt, token: 'extra' } })).rejects.toThrow('Could not parse local table');
});
