// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import edge from '../../test/fixtures/sec-statements/edge-cases.json';
import { evaluateStatementLine } from './linePolicy';
import type { LinePolicy } from './types';
import type { DatasetRow } from '../widgetData/types';
import { calculateView } from '../tableExecution/engine';
import { fixture } from './compileFixtures';
import { StatementCompilationError } from './compile';

// These tests detect silent summation, zero substitution, weakened context/error
// checks and calendar-year assumptions. Expectations are hand-specified JSON.
for (const c of edge.cases) {
    it(c.name, () => {
        const context = c.definition.context as Parameters<typeof evaluateStatementLine>[3];
        const result = evaluateStatementLine(c.definition.policy as LinePolicy, c.source as DatasetRow[], c.definition.valueFieldId, context);
        if (c.expected.error) {
            expect(result).toEqual({ ok: false, error: c.expected.error });
        } else {
            const value = Number(c.expected.valueDecimal);
            if (c.expected.exactSafeInteger) expect(Number.isSafeInteger(value)).toBe(true);
            expect(result).toEqual({ ok: true, value });
        }
    });
}
it(edge.amendment.name, () => {
    // Fixture policy only: no acquisition behavior is added to the evaluator.
    for (const expected of edge.amendment.expected) {
        const selected = edge.amendment.source.filter(f => f.filed <= expected.cutoff)
            .sort((a, b) => b.filed.localeCompare(a.filed)).slice(0, 1);
        expect(selected.map(f => f.id)).toEqual(expected.ids);
        const f = fixture();
        f.source.rows = selected.map(s => ({ id: s.id, values: { ...f.source.rows[0].values, revenue: s.value } }));
        const view = calculateView(f.source, { table: {}, search: '', analytical: f.statement }, { kind: 'none' });
        const column = view.columns.find(c => c.measureId === f.ids.value)!;
        const revenue = view.logicalRows.find(r => r.groupPath?.at(-1)?.value === f.ids.line('revenue'))!;
        expect(revenue.values[column.id]).toBe(expected.value);
        expect(revenue.values[column.id]).not.toBe(190);
    }
});
it(edge.annualQuarterOverlap.name, () => {
    const f = fixture();
    f.source.rows = edge.annualQuarterOverlap.source.map(s => ({ id: s.id, values: { ...f.source.rows[0].values, period: s.period } }));
    expect(f.source.rows.map(r => r.id)).toEqual(edge.annualQuarterOverlap.expected.affectedSourceIds);
    const before = structuredClone(f.source);
    let caught: unknown;
    try { calculateView(f.source, { table: {}, search: '', analytical: f.statement }, { kind: 'none' }); }
    catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(StatementCompilationError);
    expect((caught as StatementCompilationError).diagnostics).toEqual([edge.annualQuarterOverlap.expected.diagnostic]);
    expect(f.source).toEqual(before);
});
it(edge.reportedAndCalculated.name, () => {
    const f = fixture();
    f.statement.bindings.mappings.push({ sourceFieldId: 'reported_profit', lineId: f.ids.line('gross_profit') });
    f.source.columns.push({ id: 'reported_profit', label: 'reported_profit' });
    Object.assign(f.source.rows[0].values, edge.reportedAndCalculated.source.values);
    for (const missing of [false, true]) {
        if (missing) f.source.rows[0].values.cost_of_revenue = null;
        const view = calculateView(f.source, { table: {}, search: '', analytical: f.statement }, { kind: 'none' });
        const column = view.columns.find(c => c.measureId === f.ids.value)!;
        const reported = view.logicalRows.find(r => r.groupPath?.at(-1)?.value === f.ids.line('gross_profit'))!;
        const calculated = view.logicalRows.find(r => r.groupPath?.at(-1)?.value === f.ids.line('calculated_gross_profit'))!;
        expect(reported.id).not.toBe(calculated.id);
        expect(reported.values[column.id]).toBe(Number(edge.reportedAndCalculated.expected.reported));
        expect(calculated.values[column.id]).toBe(missing ? '#ERROR' : Number(edge.reportedAndCalculated.expected.calculated));
        if (missing) expect(calculated.cellErrors?.[column.id]).toMatchObject(edge.reportedAndCalculated.expected.missingDependencyError);
    }
});
