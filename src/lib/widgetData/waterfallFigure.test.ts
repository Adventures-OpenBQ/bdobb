// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { buildWaterfall, walkRole } from './waterfallFigure';
import { buildLinkedFigure } from './chartFigure';
import { calculateView } from '../tableExecution/engine';
import { fixture } from '../statementModel/compileFixtures';
import type { DatasetColumn, DatasetRow, WidgetDataset } from './types';

const item = (template: string, name: string, section = 'Income'): DatasetRow['groupPath'] => {
    const line = `statement/${template}/1.0.0/line/${name}`;
    return [
        { field: 'Section', categoryId: `statement/${template}/1.0.0/category/section`, memberKey: JSON.stringify(['s', section]), value: section },
        { field: 'Item', categoryId: `statement/${template}/1.0.0/category/item`, memberKey: JSON.stringify(['s', line]), value: line, label: name },
    ];
};
const period = (year: string): DatasetColumn => ({ id: year, label: 'Value', dtype: 'number', splitPath: [{ field: 'Period', categoryId: 'statement/income/1.0.0/category/period', memberKey: JSON.stringify(['s', year]), value: year, label: year }] });
/** Lines as [name, value per year]; the label defaults to the line name. */
function walk(lines: [string, ...(number | null)[]][], years = ['FY2023'], template = 'income', labels = lines.map(l => l[0])) {
    const rows: DatasetRow[] = lines.map(([name, ...values]) => ({ id: name, values: { item: name, ...Object.fromEntries(years.map((y, i) => [y, values[i]])) }, groupPath: item(template, name) }));
    const measures = years.map((y, i) => ({ id: y, name: `${y} — Value`, colorKey: y, column: period(y), values: lines.map(l => l[i + 1] as number | null) }));
    return buildWaterfall(rows, labels, measures);
}
type Trace = { type: string; name: string; x: string[]; measure: string[]; y: number[]; text: string[] };
function ok(result: ReturnType<typeof walk>) { if (!result.ok) throw new Error(result.message); return { ...result, traces: result.data as Trace[], xaxis: result.xaxis as { type: string; tickvals: string[]; ticktext: string[] } }; }

it('takes the role from the home template section, not the displayed one', () => {
    expect(walkRole({ id: 'r', values: {}, groupPath: item('income', 'revenue', 'Expenses') })).toEqual({ templateId: 'income', line: 'revenue', role: 'step' });
    expect(walkRole({ id: 'r', values: {}, groupPath: item('income', 'cost_of_revenue') })?.role).toBe('cost');
    expect(walkRole({ id: 'r', values: {}, groupPath: item('income', 'gross_profit') })?.role).toBe('subtotal');
    expect(walkRole({ id: 'r', values: {}, groupPath: item('income', 'discontinued_operations') })?.role).toBe('step');
    expect(walkRole({ id: 'r', values: {}, groupPath: item('income', 'net_income_from_discontinued_operations') })?.role).toBe('step');
    expect(walkRole({ id: 'r', values: {}, groupPath: item('income', 'calculated_gross_profit') })?.role).toBe('calculated');
    expect(walkRole({ id: 'r', values: {}, groupPath: item('income', 'ebitda') })?.role).toBe('ebitda');
    expect(walkRole({ id: 'r', values: {} })).toBeUndefined();
});

it('walks revenue up, costs down and draws a reported subtotal at its value', () => {
    const { traces, xaxis, notes } = ok(walk([['revenue', 100], ['cost_of_revenue', 60], ['gross_profit', 40], ['income_tax_expense', -5]]));
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({ type: 'waterfall', name: 'FY2023', x: ['revenue', 'cost_of_revenue', 'gross_profit', 'income_tax_expense'], measure: ['relative', 'relative', 'absolute', 'relative'], y: [100, -60, 40, 5], hovertemplate: '%{text}<extra></extra>', textposition: 'none' });
    expect(xaxis).toMatchObject({ type: 'category', tickvals: ['revenue', 'cost_of_revenue', 'gross_profit', 'income_tax_expense'], ticktext: ['revenue', 'cost_of_revenue', 'gross_profit', 'income_tax_expense'] });
    expect(notes).toEqual(['Expenses shown as decreases.']);
});

it('sends a revenue line shown under Expenses up', () => {
    const rows: DatasetRow[] = [{ id: 'r', values: {}, groupPath: item('income', 'revenue', 'Expenses') }];
    const result = buildWaterfall(rows, ['revenue'], [{ id: 'FY2023', name: 'FY2023', colorKey: 'FY2023', column: period('FY2023'), values: [100] }]);
    expect(result.ok && (result.data[0] as Trace).y).toEqual([100]);
});

it('inserts Other only where a gap precedes a subtotal', () => {
    const gap = ok(walk([['revenue', 100], ['cost_of_revenue', 60], ['research_and_development_expense', 20], ['operating_income', 15]]));
    expect(gap.traces[0]).toMatchObject({ x: ['revenue', 'cost_of_revenue', 'research_and_development_expense', 'other:3', 'operating_income'], measure: ['relative', 'relative', 'relative', 'relative', 'absolute'], y: [100, -60, -20, -5, 15] });
    expect(gap.xaxis.ticktext[3]).toBe('Other');
    expect(gap.traces[0].text[3]).toContain('Not in the lines shown');
    expect(ok(walk([['revenue', 100], ['cost_of_revenue', 60], ['gross_profit', 40]])).traces[0].x).not.toContain('other:2');
});

it('does not hide a $100 discrepancy against a $1T reported subtotal', () => {
    const { traces, xaxis } = ok(walk([['revenue', 1_000_000_000_100], ['gross_profit', 1_000_000_000_000]]));
    expect(xaxis.ticktext).toEqual(['revenue', 'Other', 'gross_profit']);
    expect(traces[0]).toMatchObject({ measure: ['relative', 'relative', 'absolute'], y: [1_000_000_000_100, -100, 1_000_000_000_000] });
    expect(traces[0].text[1]).toContain('Step: -100');
});

it('preserves a one-unit residual even when machine precision reaches that scale', () => {
    const { traces, xaxis } = ok(walk([['revenue', 5_000_000_000_000_001], ['gross_profit', 5_000_000_000_000_000]]));
    expect(xaxis.ticktext).toContain('Other');
    expect(traces[0].y[1]).toBe(-1);
});

it('keeps an explicit decimal residual that exceeds binary rounding error', () => {
    const { traces, xaxis } = ok(walk([['revenue', 100.0000001], ['gross_profit', 100]]));
    expect(xaxis.ticktext).toContain('Other');
    expect(traces[0].y[1]).toBeCloseTo(-0.0000001, 13);
});

it('omits Other for binary rounding in decimal sums, including after cancellation', () => {
    const totals = ok(walk([['revenue', 0.1], ['discontinued_operations', 0.2], ['gross_profit', 0.3]]));
    expect(totals.xaxis.ticktext).toEqual(['revenue', 'discontinued_operations', 'gross_profit']);
    const cancelled = ok(walk([['revenue', 0.1], ['discontinued_operations', 0.2], ['cost_of_revenue', 0.3], ['net_income', 0]]));
    expect(cancelled.xaxis.ticktext).toEqual(['revenue', 'discontinued_operations', 'cost_of_revenue', 'net_income']);
});

it('draws one trace per year on shared positions; a year without a gap has Other at zero', () => {
    const { traces } = ok(walk([['revenue', 100, 200], ['cost_of_revenue', 60, 120], ['gross_profit', 30, 80]], ['FY2023', 'FY2024']));
    expect(traces.map(t => t.name)).toEqual(['FY2023', 'FY2024']);
    expect(traces[1].x).toEqual(traces[0].x);
    expect(traces[0].y).toEqual([100, -60, -10, 30]);
    expect(traces[1].y).toEqual([200, -120, 0, 80]);
});

it('ticks calculated gross profit as calculated and refuses EBITDA', () => {
    const { traces, xaxis } = ok(walk([['revenue', 100], ['cost_of_revenue', 60], ['calculated_gross_profit', 40], ['discontinued_operations', -3]]));
    expect(traces[0].measure).toEqual(['relative', 'relative', 'absolute', 'relative']);
    expect(traces[0].y[3]).toBe(-3);
    expect(xaxis.ticktext[2]).toBe('calculated_gross_profit (calculated)');
    expect(walk([['revenue', 100], ['ebitda', 40]])).toEqual({ ok: false, refused: true, message: "EBITDA isn't part of the walk — untick it" });
});

it('skips a missing step and a missing subtotal, and notes them by their shown label', () => {
    const { traces, notes } = ok(walk([['revenue', 100, 100], ['cost_of_revenue', 60, null], ['gross_profit', null, 100], ['net_income', 30, 100]], ['FY2023', 'FY2024'], 'income', ['Revenue', 'Cost of revenue', 'Gross profit', 'Net income']));
    expect(traces[0]).toMatchObject({ measure: ['relative', 'relative', 'relative', 'relative', 'absolute'], y: [100, -60, 0, -10, 30] });
    expect(traces[1]).toMatchObject({ y: [100, 0, 100, 0, 100] });
    expect(notes).toEqual(['Expenses shown as decreases.', 'Missing: Cost of revenue (FY2024), Gross profit (FY2023)']);
});

it('refuses non-income tables and non-period measures', () => {
    const income = "Waterfall needs an income statement table";
    expect(walk([['total_assets', 100]], ['FY2023'], 'balance')).toEqual({ ok: false, refused: true, message: income });
    const bare = buildWaterfall([{ id: 'r', values: {} }], ['x'], [{ id: 'FY2023', name: 'FY2023', colorKey: 'FY2023', column: period('FY2023'), values: [1] }]);
    expect(bare).toEqual({ ok: false, refused: true, message: income });
    const yoy = buildWaterfall([{ id: 'r', values: {}, groupPath: item('income', 'revenue') }], ['revenue'], [{ id: 'yoy', name: 'YoY %', colorKey: 'yoy', column: { id: 'yoy', label: 'YoY %', dtype: 'number' }, values: [1] }]);
    expect(yoy).toEqual({ ok: false, refused: true, message: 'Waterfall needs period columns' });
});

it('hovers with line, year, stored value, signed step and running total', () => {
    const text = ok(walk([['revenue', 100], ['cost_of_revenue', 60]])).traces[0].text[1];
    for (const part of ['cost_of_revenue', 'FY2023', '60', '-60', 'Running total: 40'])
        expect(text).toContain(part);
});

it('wraps the walk in a grouped waterfall figure', () => {
    const rows: DatasetRow[] = [{ id: 'revenue', values: { item: 'Revenue', FY2023: 100 }, groupPath: item('income', 'revenue') }];
    const dataset: WidgetDataset = { rows, columns: [{ id: 'item', label: 'Item', dtype: 'text' }, period('FY2023')], resultRevision: 1, outputRevision: 1, provenance: { sourceWidgetId: 's' }, completeness: { kind: 'complete', warnings: [] }, freshness: { availability: 'available', stale: false } };
    const result = buildLinkedFigure(dataset, { type: 'waterfall', category: 'item', measures: ['FY2023'], display: 'grouped' }, 'dark');
    if (!result.ok) throw new Error(result.message);
    expect(result.figure.layout).toMatchObject({ waterfallmode: 'group', xaxis: { ticktext: ['Revenue'] }, showlegend: true });
    expect(result.notes).toEqual(['Expenses shown as decreases.']);
});

/** A compiled two-year income statement, charted the way the linked chart receives it (view columns + presented rows). */
function compiledStatement() {
    const f = fixture();
    f.statement.bindings.mappings.push({ sourceFieldId: 'gross_profit', lineId: f.ids.line('gross_profit') });
    f.source.columns.push({ id: 'gross_profit', label: 'gross_profit' });
    const fy25 = f.source.rows[0];
    fy25.values = { ...fy25.values, gross_profit: 40 };
    f.source.rows.push({ id: 'b', values: { ...fy25.values, date: '2024-12-31', year: 2024, start: '2024-01-01', end: '2024-12-31', revenue: 90, cost_of_revenue: 50, gross_profit: 40 } });
    f.statement.overrides.labels[f.ids.line('cost_of_revenue')] = 'Cost of revenue';
    const view = calculateView(f.source, { table: {}, search: '', analytical: f.statement }, { kind: 'none' });
    const category = view.columns.find(c => !c.measureId)!.id;
    const measures = view.columns.filter(c => c.measureId === f.ids.value).map(c => c.id);
    const result = buildLinkedFigure({ ...f.source, columns: view.columns, rows: view.presentedRows }, { type: 'waterfall', category, measures, display: 'stacked' }, 'light');
    if (!result.ok) throw new Error(result.message);
    const traces = result.figure.data as Trace[];
    const ticks = (result.figure.layout as { xaxis: { ticktext: string[] } }).xaxis.ticktext;
    const at = (trace: Trace, tick: string) => { const i = ticks.indexOf(tick); expect(i).toBeGreaterThanOrEqual(0); return { measure: trace.measure[i], y: trace.y[i] }; };
    const shownIn = (line: string) => view.presentedRows.find(r => r.groupPath?.at(-1)?.value === f.ids.line(line))?.groupPath?.[0].label;
    return { traces, at, measures, shownIn };
}

it('walks a compiled income statement: revenue up, costs down, profit absolute at its reported value', () => {
    const { traces, at, measures, shownIn } = compiledStatement();
    expect(shownIn('cost_of_revenue')).toBe('Expenses');
    expect(traces).toHaveLength(measures.length);
    expect(traces.map(t => t.name).sort()).toEqual(['FY2024', 'FY2025']);
    const fy25 = traces.find(t => t.name === 'FY2025')!, fy24 = traces.find(t => t.name === 'FY2024')!;
    for (const t of traces) expect(t.type).toBe('waterfall');
    expect(at(fy25, 'revenue')).toEqual({ measure: 'relative', y: 100 });
    expect(at(fy25, 'Cost of revenue')).toEqual({ measure: 'relative', y: -60 });
    expect(at(fy25, 'gross_profit')).toEqual({ measure: 'absolute', y: 40 });
    expect(at(fy24, 'revenue')).toEqual({ measure: 'relative', y: 90 });
    expect(at(fy24, 'Cost of revenue')).toEqual({ measure: 'relative', y: -50 });
    expect(at(fy24, 'gross_profit')).toEqual({ measure: 'absolute', y: 40 });
});

it('carries a reported loss into subsequent steps and reconciles a negative net income', () => {
    const { traces, xaxis } = ok(walk([
        ['revenue', 100],
        ['cost_of_revenue', 120],
        ['gross_profit', -20],
        ['income_tax_expense', -5],
        ['net_income', -16],
    ]));
    expect(traces[0].measure).toEqual(['relative', 'relative', 'absolute', 'relative', 'relative', 'absolute']);
    expect(traces[0].y).toEqual([100, -120, -20, 5, -1, -16]);
    expect(traces[0].text[3]).toContain('Running total: -15');
    expect(xaxis.ticktext[4]).toBe('Other');
});
