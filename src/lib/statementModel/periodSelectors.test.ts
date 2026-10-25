// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { calculateView } from '../tableExecution/engine';
import type { FormulaAst, FormulaDef } from '../tableModel/types';
import type { WidgetDataset } from '../widgetData/types';
import { pivotValueKey } from '../pivotKeys';
import { fixture } from './compileFixtures';

function periodFixture(kind: 'FY' | 'FQ', nested = false) {
    const f = fixture();
    f.statement.periodKind = kind;
    f.statement.bindings.fiscal.periodKind = kind;
    f.statement.bindings.currencyFieldId = 'currency';
    f.statement.bindings.unitFieldId = 'unit';
    if (kind === 'FQ') f.statement.bindings.fiscal.fiscalQuarterFieldId = 'quarter';
    const periods = kind === 'FY'
        ? [{ year: 2025, start: '2025-01-01', end: '2025-12-31' }, { year: 2026, start: '2026-01-01', end: '2026-12-31' }]
        : [{ year: 2025, quarter: 1, start: '2025-01-01', end: '2025-03-31' }, { year: 2025, quarter: 2, start: '2025-04-01', end: '2025-06-30' }];
    const target = kind === 'FY' ? 'FY2025' : 'FY2025 Q1';
    const display = kind === 'FY' ? 'FY2026' : 'FY2025 Q2';
    const rows = periods.map((period, index) => ({
        id: `period-${index}`,
        values: { symbol: 'ACME', currency: 'USD', unit: 'dollars', period: kind, ...period, date: period.end, revenue: index ? 200 : 100, cost_of_revenue: index ? 100 : 60 },
    }));
    const source: WidgetDataset = { ...f.source, rows, columns: Object.keys(rows[0].values).map(id => ({ id, label: id })) };
    const ast: FormulaAst = {
        kind: 'member',
        selectors: [
            { categoryId: f.ids.item, memberKey: f.ids.line(nested ? 'calculated_gross_profit' : 'revenue') },
            { categoryId: f.ids.period, memberKey: pivotValueKey(target) },
        ],
        value: { kind: 'reference', target: 'measure', id: f.ids.value },
    };
    const pinned: FormulaDef = f.statement.template.lines.find((line: { formula?: FormulaDef }) => line.formula)!.formula!;
    let outputId = f.ids.line('calculated_gross_profit');
    if (nested) {
        f.statement.template = structuredClone(f.statement.template);
        outputId = f.ids.line('prior_profit');
        f.statement.template.sections[0].lineIds.push(outputId);
        f.statement.template.lines.push({
            id: outputId, label: 'Prior profit', required: false, policy: 'formula',
            formula: { ...pinned, id: f.ids.formula('prior_profit'), name: 'Prior profit', ast },
        });
    } else f.statement.overrides.formulas = [{ ...pinned, ast }];
    const run = () => {
        const view = calculateView(source, { table: {}, search: '', analytical: f.statement }, { kind: 'none' });
        const row = view.logicalRows.find(row => row.groupPath?.at(-1)?.memberKey === pivotValueKey(outputId))!;
        const value = (period: string) => {
            const column = view.columns.find(column => column.measureId === f.ids.value && column.splitPath?.some(part => part.memberKey === pivotValueKey(period)))!;
            return row.values[column.id];
        };
        return { view, value };
    };
    return { source, run, target, display, ast };
}

for (const kind of ['FY', 'FQ'] as const) {
    it(`${kind} explicit fiscal selector replaces requested evidence across display columns`, () => {
        const f = periodFixture(kind);
        const result = f.run();
        expect(result.value(f.target)).toBe(100);
        expect(result.value(f.display)).toBe(100);
    });
    it(`${kind} nested derived fiscal selector passes the replaced scope to its dependencies`, () => {
        const f = periodFixture(kind, true);
        const result = f.run();
        expect(result.value(f.target)).toBe(40);
        expect(result.value(f.display)).toBe(40);
    });
    it(`${kind} unavailable target fiscal member remains an error`, () => {
        const f = periodFixture(kind);
        if (f.ast.kind !== 'member') throw new Error('Expected fixture member');
        f.ast.selectors[1].memberKey = pivotValueKey(kind === 'FY' ? 'FY2024' : 'FY2024 Q4');
        expect(f.run().value(f.display)).toBe('#ERROR');
    });
    for (const field of ['symbol', 'currency', 'unit']) {
        it(`${kind} target evidence and facts cannot come from another ${field} context`, () => {
            const f = periodFixture(kind, true);
            f.source.rows[0].values[field] = 'OTHER';
            expect(f.run().value(f.display)).toBe('#ERROR');
        });
    }
}
