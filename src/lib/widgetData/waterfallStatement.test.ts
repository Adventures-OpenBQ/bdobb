// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { calculateView } from '../tableExecution/engine';
import { fixture } from '../statementModel/compileFixtures';
import { buildLinkedFigure } from './chartFigure';

type Trace = { type: string; name: string; x: string[]; measure: string[]; y: number[] };

/** A compiled two-year income statement, charted the way the linked chart receives it (view columns + presented rows). */
function chart(moveCost: boolean) {
    const f = fixture();
    f.statement.bindings.mappings.push({ sourceFieldId: 'gross_profit', lineId: f.ids.line('gross_profit') });
    f.source.columns.push({ id: 'gross_profit', label: 'gross_profit' });
    const fy25 = f.source.rows[0];
    fy25.values = { ...fy25.values, gross_profit: 40 };
    f.source.rows.push({ id: 'b', values: { ...fy25.values, date: '2024-12-31', year: 2024, start: '2024-01-01', end: '2024-12-31', revenue: 90, cost_of_revenue: 50, gross_profit: 40 } });
    f.statement.overrides.labels[f.ids.line('cost_of_revenue')] = 'Cost of revenue';
    if (moveCost) f.statement.overrides.lineSection = { [f.ids.line('cost_of_revenue')]: f.statement.template.sections[0].id };
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
    const { traces, at, measures, shownIn } = chart(false);
    expect(shownIn('cost_of_revenue')).toBe('Expenses');
    expect(traces).toHaveLength(measures.length);
    expect(traces.map(t => t.name).sort()).toEqual(['FY2024', 'FY2025']);
    const fy25 = traces.find(t => t.name === 'FY2025')!, fy24 = traces.find(t => t.name === 'FY2024')!;
    for (const t of traces) expect(t.type).toBe('waterfall');
    expect(at(fy25, 'Revenue')).toEqual({ measure: 'relative', y: 100 });
    expect(at(fy25, 'Cost of revenue')).toEqual({ measure: 'relative', y: -60 });
    expect(at(fy25, 'Gross Profit')).toEqual({ measure: 'absolute', y: 40 });
    expect(at(fy24, 'Revenue')).toEqual({ measure: 'relative', y: 90 });
    expect(at(fy24, 'Cost of revenue')).toEqual({ measure: 'relative', y: -50 });
    expect(at(fy24, 'Gross Profit')).toEqual({ measure: 'absolute', y: 40 });
});

it('keeps a line moved into Income stepping down, by its home section', () => {
    const { traces, at, shownIn } = chart(true);
    expect(shownIn('cost_of_revenue')).toBe('Income');
    const fy25 = traces.find(t => t.name === 'FY2025')!;
    expect(at(fy25, 'Cost of revenue')).toEqual({ measure: 'relative', y: -60 });
    expect(at(fy25, 'Gross Profit')).toEqual({ measure: 'absolute', y: 40 });
});
