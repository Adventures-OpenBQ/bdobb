// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { pivotValueKey } from '../pivotKeys';
import { calculateView } from '../tableExecution/engine';
import { StatementCompilationError, compileStatement } from './compile';
import { fixture } from './compileFixtures';
import { statementSnapshot } from './persistence';
import { intent } from './testFixtures';
import { validateStatementIntent } from './validation';

/** Two companies: ACME for fiscal 2024 and 2025, BETA for 2025. */
function twoCompanies() {
  const f = fixture();
  const base = f.source.rows[0].values;
  f.source.rows = [
    { id: 'a25', values: { ...base } },
    { id: 'a24', values: { ...base, date: '2024-12-31', year: 2024, start: '2024-01-01', end: '2024-12-31', revenue: 90, cost_of_revenue: 50 } },
    { id: 'b25', values: { ...base, symbol: 'BETA', revenue: 200, cost_of_revenue: 150 } },
  ];
  return f;
}
/** The calculated grid as text: column headers, then `Section > Line: value | value`. */
function grid(f: ReturnType<typeof fixture>) {
  const view = calculateView(f.source, { table: {}, search: '', analytical: f.statement }, { kind: 'none' });
  const columns = view.columns.filter((c) => c.measureId);
  return {
    columns: columns.map((c) => (c.splitPath ?? []).map((s) => String(s.value)).join(' / ')),
    rows: view.logicalRows.filter((r) => columns.some((c) => r.values[c.id] !== undefined))
      .map((r) => `${(r.groupPath ?? []).map((g) => g.label ?? g.value).join(' > ')}: ${columns.map((c) => String(r.values[c.id])).join(' | ')}`),
    presented: Object.hasOwn(view.provenance.metadata ?? {}, 'statementPresentation'),
    diagnostics: view.diagnostics.map((d) => d.message),
  };
}

describe('statement layout', () => {
  it('reads a statement saved before layouts existed as lines by period, and writes nothing back', () => {
    const saved = intent();
    expect(Object.hasOwn(saved, 'layout')).toBe(false);
    expect(statementSnapshot(saved)).toEqual(saved);
    expect(compileStatement(fixture().statement, fixture().source.columns).model.layout).toMatchObject({ columns: [fixture().ids.period] });
  });

  it('has one spelling of the default', () => {
    expect(Object.hasOwn(statementSnapshot({ ...intent(), layout: 'lines-by-period' }), 'layout')).toBe(false);
    expect(statementSnapshot({ ...intent(), layout: 'lines-by-company' }).layout).toBe('lines-by-company');
  });

  it('refuses a layout it does not know, lines across among them', () => {
    for (const layout of ['periods-by-line', 'sideways', 3]) {
      expect(validateStatementIntent({ ...intent(), layout }).diagnostics.map((d) => d.path)).toContain('layout');
    }
  });

  it('puts sections and lines down and periods across by default, exactly as before', () => {
    const f = fixture();
    const before = compileStatement(f.statement, f.source.columns).model.layout;
    expect(before).toEqual({ rows: [`${f.ids.prefix}category/section`, f.ids.item], columns: [f.ids.period], values: [f.ids.value] });
  });

  it('will not add two companies into one cell', () => {
    const out = grid(twoCompanies());
    expect(out.rows).toContain('Income > Revenue: 90 | #ERROR');
    expect(out.diagnostics).toContain('Mixed symbol contexts cannot be aggregated.');
  });

  it('pages lines by period through one company at a time', () => {
    const f = twoCompanies();
    f.statement.page = { categoryId: f.ids.company, memberKeys: [pivotValueKey('ACME')] };
    expect(grid(f)).toMatchObject({
      columns: ['FY2024', 'FY2025'],
      rows: ['Income > Revenue: 90 | 100', 'Expenses > Cost of Revenue: 50 | 60', 'Profit > Calculated gross profit: 40 | 40'],
      presented: true, diagnostics: [],
    });
    f.statement.page = { categoryId: f.ids.company, memberKeys: [pivotValueKey('BETA')] };
    expect(grid(f).rows).toEqual(['Income > Revenue: 200', 'Expenses > Cost of Revenue: 150', 'Profit > Calculated gross profit: 50']);
  });

  it('puts companies side by side under each fiscal period, formulas included', () => {
    const f = twoCompanies();
    f.statement.layout = 'lines-by-company';
    expect(grid(f)).toMatchObject({
      columns: ['FY2024 / ACME', 'FY2025 / ACME', 'FY2025 / BETA'],
      rows: ['Income > Revenue: 90 | 100 | 200', 'Expenses > Cost of Revenue: 50 | 60 | 150', 'Profit > Calculated gross profit: 40 | 40 | 50'],
      presented: false, diagnostics: [],
    });
  });

  it('pages companies side by side through one fiscal period at a time', () => {
    const f = twoCompanies();
    f.statement.layout = 'lines-by-company';
    f.statement.page = { categoryId: f.ids.period, memberKeys: [pivotValueKey('FY2025')] };
    expect(grid(f)).toMatchObject({ columns: ['ACME', 'BETA'], rows: ['Income > Revenue: 100 | 200', 'Expenses > Cost of Revenue: 60 | 150', 'Profit > Calculated gross profit: 40 | 50'] });
    f.statement.page = { categoryId: f.ids.period, memberKeys: [pivotValueKey('FY2024')] };
    expect(grid(f).columns).toEqual(['ACME']);
  });

  it('will not put companies side by side without a fiscal year on each row', () => {
    const f = twoCompanies();
    f.statement.layout = 'lines-by-company';
    f.statement.bindings.fiscal = { companyFieldId: 'symbol', dateFieldId: 'date' };
    let caught: unknown;
    try { compileStatement(f.statement, f.source.columns); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(StatementCompilationError);
    expect((caught as StatementCompilationError).diagnostics[0]).toMatchObject({ path: 'layout' });
  });
});
