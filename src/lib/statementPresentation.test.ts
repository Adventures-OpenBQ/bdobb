// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import { projectGenericStatementDataset, projectStatementDataset, readStatementPresentation, type StatementPresentation } from './statementPresentation';
import { input } from './tableExecution/fixtures';

const descriptor: StatementPresentation = { schemaVersion: 1, sectionCategoryId: 'section', itemCategoryId: 'line', periodCategoryId: 'period', valueMeasureId: 'value',
  sections: [{ id: 'income', label: 'Income', lines: [{ id: 'revenue', label: 'Revenue' }] }] };
it.each([
  { ...descriptor, schemaVersion: 2 },
  { ...descriptor, formula: { kind: 'call', name: 'sum' } },
  { ...descriptor, sections: [{ ...descriptor.sections[0], lines: [descriptor.sections[0].lines[0], descriptor.sections[0].lines[0]] }] },
  { ...descriptor, sections: Array.from({ length: 257 }, (_, index) => ({ id: `s${index}`, label: `Section ${index}`, lines: [] })) },
  { ...descriptor, valueMeasureId: 'x'.repeat(4097) },
])('refuses unsupported, executable, duplicate or unbounded presentation metadata', raw => {
  expect(() => readStatementPresentation(raw)).toThrow(/presentation metadata/);
});
it('does not infer a template from ordinary field names or silently discard incompatible row structure', () => {
  const dataset = { ...input, columns: [{ id: 'fy', label: 'FY2025', measureId: 'value', splitPath: [{ field: 'period', categoryId: 'period', value: 'FY2025' }] }],
    rows: [{ id: 'raw', values: { revenue: 40 } }] };
  expect(() => projectStatementDataset(dataset, descriptor)).toThrow(/row structure/);
});
it('keeps an empty producer selection empty instead of filling template members', () => {
  const dataset = { ...input, rows: [], columns: [] };
  expect(projectStatementDataset(dataset, descriptor).sections).toEqual([]);
  expect(projectStatementDataset(dataset, descriptor).rows).toEqual([]);
});
// D-019 (#32, ruled 2026-10-10): the Statement view's export rows carry an
// error's reason inline, as the worker Default view's export does.
it('exports a template Statement #ERROR cell with its reason (D-019, #32)', () => {
  const reason = 'Mixed currency contexts cannot be combined in a derived Statement value.';
  const dataset = { ...input,
    columns: [{ id: 'fy', label: 'FY2025', measureId: 'value', splitPath: [{ field: 'period', categoryId: 'period', value: 'FY2025' }] }],
    rows: [{ id: 'r', values: { fy: '#ERROR' }, cellErrors: { fy: { code: 'scope', message: reason } },
      groupPath: [{ field: 'section', categoryId: 'section', value: 'income' }, { field: 'line', categoryId: 'line', value: 'revenue' }] }] };
  expect(projectStatementDataset(dataset, descriptor).rows).toEqual([{ Section: 'Income', 'Line item': 'Revenue', FY2025: `#ERROR: ${reason}` }]);
});
// D-019 (#32) on the generic (no-template) Statement: a line whose cell is a
// calculation error is kept, shows #ERROR there, and exports its reason.
// Regression V5-032: the line was dropped because "#ERROR" is not a number.
it('keeps a generic Statement line that has an error cell, and exports its reason (D-019, #32)', () => {
  const reason = 'Arithmetic requires numeric values; blanks and text are not zero.';
  const rows = [[2023, 100, 60, 40], [2024, 110, '#ERROR', '#ERROR'], [2025, 120, 70, 50]].map(([fiscal_year, revenue, cost_of_revenue, gross_profit], i) => ({
    id: `r${i}`, values: { fiscal_year, fiscal_period: 'FY', revenue, cost_of_revenue, gross_profit },
    ...(cost_of_revenue === '#ERROR' ? { cellErrors: { cost_of_revenue: { code: 'type', message: reason }, gross_profit: { code: 'type', message: reason } } } : {}) }));
  const out = projectGenericStatementDataset({ ...input, rows, columns: Object.keys(rows[0].values).map(id => ({ id, label: id })) })!;
  const gross = out.rows.find(row => row['Line item'] === 'Gross Profit');
  expect(gross).toMatchObject({ FY2023: 40, FY2024: `#ERROR: ${reason}`, FY2025: 50 });
  expect(out.rows.find(row => row['Line item'] === 'Cost Of Revenue')?.FY2024).toBe(`#ERROR: ${reason}`);
  // A line that is an error in every period is kept too.
  const allErr = rows.map(r => ({ ...r, values: { ...r.values, gross_profit: '#ERROR' }, cellErrors: { ...r.cellErrors, gross_profit: { code: 'type', message: reason } } }));
  const outAll = projectGenericStatementDataset({ ...input, rows: allErr, columns: Object.keys(rows[0].values).map(id => ({ id, label: id })) })!;
  expect(outAll.rows.find(row => row['Line item'] === 'Gross Profit')?.FY2023).toBe(`#ERROR: ${reason}`);
});
// The backend card's Statement view reads OPENBQ yfinance long-form rows
// (user ruling 2026-10-10): widened per period, exported per line.
it('projects a backend card\'s long-form statement rows, one column per served date', async () => {
  const income = (await import('../test/fixtures/openbq-yfinance/aapl-income-annual.json')).default as Record<string, unknown>[];
  const data = { ...input, rows: income.map((values, i) => ({ id: `r${i}`, values: values as Record<string, string | number | null> })), columns: ['symbol', 'date', 'period', 'line_item', 'value'].map(id => ({ id, label: id })) };
  const out = projectGenericStatementDataset(data)!;
  expect(out.headers).toEqual(['2025-09-30', '2024-09-30']);
  const net = out.sections.flatMap(s => s.items).find(i => i.field === 'net_income')!;
  expect(net.values).toEqual(['2025-09-30', '2024-09-30'].map(date => income.find(r => r.line_item === 'net_income' && r.date === date)!.value));
  expect(net.formats).toHaveLength(2);
  expect(net.errors).toHaveLength(2);
  expect(out.rows.find(r => r['Line item'] === 'Net Income')).toMatchObject({ '2025-09-30': net.values[0], '2024-09-30': net.values[1] });
});
