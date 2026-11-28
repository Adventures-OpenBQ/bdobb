// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { pivotValueKey } from '../pivotKeys';
import { correctStatementRows, inferYearEnds } from '../statementFiscal';
import { widenLongRows } from '../statementRows';
import { stampStatementRows } from '../statementSource';
import type { Row } from '../tableColumns';
import { calculateView } from '../tableExecution/engine';
import { input } from '../tableExecution/fixtures';
import type { WidgetDataset } from '../widgetData/types';
import { proposeStatement, type StatementProposal } from './autoBind';
import { compileStatement } from './compile';
import { STATEMENT_FIXTURES, statementFixture } from './fixtures/load';
import { statementOwnedIds } from './types';
import { validateStatementIntent } from './validation';
import { NOT_MONEY } from './vocabulary';

/** A recording as a bound card is given it: widened if long, labelled from its own year end, with the bound fields. */
function bound(name: string): Row[] {
  const fixture = statementFixture(name);
  const symbol = fixture.provenance.symbol;
  const period = fixture.provenance.params.period;
  const rows = widenLongRows(fixture.rows) ?? fixture.rows;
  const annual = name.replace(/-quarter$/, '-annual');
  const yearEnds = inferYearEnds(widenLongRows(statementFixture(annual).rows) ?? statementFixture(annual).rows, 'annual', [symbol]);
  return correctStatementRows(rows, period, yearEnds, [symbol], false, true).rows;
}
const columnsOf = (rows: Row[]) => [...new Set(rows.flatMap((r) => Object.keys(r)))].map((id) => ({ id, label: id }));
const dataset = (rows: Row[]): WidgetDataset => ({ ...input, columns: columnsOf(rows), rows: rows.map((values, i) => ({ id: `r${i}`, values })) }) as WidgetDataset;
const proposal = (rows: Row[]) => proposeStatement(columnsOf(rows), rows) as StatementProposal;
/** `Section > Line` → that row's values, one per value column, through the real engine. */
function calculate(rows: Row[], intent: StatementProposal['intent']) {
  const view = calculateView(dataset(rows), { table: {}, search: '', analytical: intent }, { kind: 'none' });
  const columns = view.columns.filter((c) => c.measureId);
  return {
    columns: columns.map((c) => (c.splitPath ?? []).map((s) => String(s.value)).join(' / ')),
    lines: new Map(view.logicalRows.filter((r) => (r.groupPath?.length ?? 0) === 2).map((r) => [String(r.groupPath!.at(-1)!.value).split('/').pop()!, columns.map((c) => r.values[c.id])])),
    diagnostics: view.diagnostics.map((d) => d.message),
  };
}

describe('proposeStatement', () => {
  it.each(STATEMENT_FIXTURES.map((f) => f.name))('binds %s without a hand: valid, compiles, and leaves only ratios unmapped', (name) => {
    const rows = bound(name);
    const out = proposeStatement(columnsOf(rows), rows);
    expect(out, JSON.stringify(out).slice(0, 200)).toHaveProperty('intent');
    const { intent, unmapped } = out as StatementProposal;
    expect(validateStatementIntent(intent).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(() => compileStatement(intent, columnsOf(rows))).not.toThrow();
    expect(unmapped.filter((f) => !NOT_MONEY.has(f))).toEqual([]);
    expect(intent.template.version).toBe('1.1.0');
    expect(intent.periodKind).toBe(name.endsWith('-quarter') ? 'FQ' : 'FY');
  });

  it('calculates Walmart\'s income statement from Libre\'s rows, every figure the provider sent', () => {
    const rows = bound('libre/wmt-yfinance-income-annual');
    const { intent } = proposal(rows);
    const out = calculate(rows, intent);
    expect(out.diagnostics).toEqual([]);
    expect(out.columns.slice(-1)).toEqual(['FY2026']);
    const served = statementFixture('libre/wmt-yfinance-income-annual').rows;
    const latest = served[0];
    for (const [field, value] of Object.entries(latest)) {
      if (typeof value !== 'number' || NOT_MONEY.has(field)) continue;
      expect(out.lines.get(field)?.at(-1), field).toBe(value);
    }
    expect([...out.lines.values()].flat()).not.toContain('#ERROR');
  });

  it('calculates the same statement from openbq-yfinance\'s long rows', () => {
    const rows = bound('openbqYfinance/wmt-income-annual');
    const out = calculate(rows, proposal(rows).intent);
    expect(out.diagnostics).toEqual([]);
    expect(out.columns.slice(-1)).toEqual(['FY2026']);
    expect(typeof out.lines.get('total_revenue')?.at(-1)).toBe('number');
    expect([...out.lines.values()].flat()).not.toContain('#ERROR');
  });

  it('labels a quarterly statement by the reporter\'s fiscal quarters', () => {
    const rows = bound('libre/wmt-sec-income-quarter');
    const { intent } = proposal(rows);
    expect(intent.bindings.fiscal.fiscalQuarterFieldId).toBe('fiscal_period');
    const out = calculate(rows, intent);
    expect(out.diagnostics).toEqual([]);
    // Walmart's quarter ending 2026-07-31 is the second of its fiscal 2027.
    expect(out.columns).toContain('FY2027 Q2');
  });

  it('hides the calculated gross profit when its inputs are not among the columns, and keeps it when they are', () => {
    const libre = bound('libre/wmt-yfinance-income-annual');
    const owned = statementOwnedIds(proposal(libre).intent.template);
    expect(proposal(libre).intent.overrides.hiddenIds).toEqual([owned.line('calculated_gross_profit')]);
    const fmp = libre.map((r) => ({ ...r, revenue: r.total_revenue }));
    expect(proposal(fmp).intent.overrides.hiddenIds).toEqual([]);
  });

  it('pages several companies one at a time, the first to start with, each on its own fiscal year', () => {
    const merged = [
      ...stampStatementRows(statementFixture('libre/aapl-yfinance-income-annual').rows, 'AAPL', 'annual'),
      ...stampStatementRows(statementFixture('libre/wmt-yfinance-income-annual').rows, 'WMT', 'annual'),
    ];
    const rows = correctStatementRows(merged, 'annual', inferYearEnds(merged, 'annual', ['AAPL', 'WMT']), ['AAPL', 'WMT'], false, true).rows;
    const { intent } = proposal(rows);
    const owned = statementOwnedIds(intent.template);
    expect(intent.page).toEqual({ categoryId: owned.company, memberKeys: [pivotValueKey('AAPL')] });
    const apple = calculate(rows, intent);
    // Fiscal-year matching is what was asked for, and the engine says what it costs: Apple's 2026 and
    // Walmart's 2026 are not the same twelve months. That notice is the only thing it has to say.
    expect(apple.diagnostics.length).toBeGreaterThan(0);
    expect(apple.diagnostics.every((d) => /^Fiscal periods do not align across companies\. FY\d{4} represents different date ranges\.$/.test(d))).toBe(true);
    expect(apple.lines.get('total_revenue')?.at(-1)).toBe(statementFixture('libre/aapl-yfinance-income-annual').rows[0].total_revenue);

    const sideBySide = calculate(rows, { ...intent, layout: 'lines-by-company', page: { categoryId: owned.period, memberKeys: [pivotValueKey('FY2026')] } });
    expect(sideBySide.columns).toEqual(['AAPL', 'WMT']);
    expect(sideBySide.lines.get('total_revenue')).toEqual([
      statementFixture('libre/aapl-yfinance-income-annual').rows[0].total_revenue,
      statementFixture('libre/wmt-yfinance-income-annual').rows[0].total_revenue,
    ]);
  });

  it('lists a numeric column it has no line for, and never maps by resemblance', () => {
    const rows = bound('libre/wmt-yfinance-income-annual').map((r) => ({ ...r, totalrevenue: 1, made_up_line: 2 }));
    const { intent, unmapped } = proposal(rows);
    expect(unmapped).toEqual(expect.arrayContaining(['totalrevenue', 'made_up_line']));
    expect(intent.bindings.mappings.map((m) => m.sourceFieldId)).not.toContain('totalrevenue');
  });

  it('refuses rows it cannot bind, saying why', () => {
    const asReported = statementFixture('libre/wmt-yfinance-income-annual').rows;
    expect(proposeStatement(columnsOf(asReported), asReported)).toMatchObject({ reason: expect.stringContaining('fiscal year') });
    expect(proposeStatement([{ id: 'price' }], [{ price: 1 }])).toMatchObject({ reason: expect.stringContaining('not an income statement') });
    const mixed = [...bound('libre/wmt-yfinance-income-annual'), ...bound('libre/wmt-yfinance-income-quarter')];
    expect(proposeStatement(columnsOf(mixed), mixed)).toMatchObject({ reason: expect.stringContaining('one period kind') });
  });
});
