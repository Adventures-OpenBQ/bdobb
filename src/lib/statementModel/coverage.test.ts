// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { calculateView } from '../tableExecution/engine';
import { calculateTotals } from '../tableModel/totals';
import type { WidgetDataset } from '../widgetData/types';
import { pivotValueKey } from '../pivotKeys';
import { fixture } from './compileFixtures';

function coverageFixture(kind: 'FY' | 'FQ', policy: 'flow' | 'stock', missing: number[]) {
    const f = fixture();
    f.statement.template = structuredClone(f.statement.template);
    f.statement.template.lines.find((line: { id: string }) => line.id === f.ids.line('cost_of_revenue'))!.policy = policy;
    f.statement.periodKind = kind;
    f.statement.bindings.shape = 'long';
    f.statement.bindings.mappings = [];
    f.statement.bindings.longFields = { itemFieldId: 'item', valueFieldId: 'amount' };
    f.statement.bindings.fiscal.periodKind = kind;
    if (kind === 'FQ') f.statement.bindings.fiscal.fiscalQuarterFieldId = 'quarter';
    const periods = kind === 'FY'
        ? [2025, 2026, 2027].map(year => ({ year, start: `${year}-01-01`, end: `${year}-12-31` }))
        : [
            { year: 2025, quarter: 1, start: '2025-01-01', end: '2025-03-31' },
            { year: 2025, quarter: 2, start: '2025-04-01', end: '2025-06-30' },
            { year: 2025, quarter: 3, start: '2025-07-01', end: '2025-09-30' },
        ];
    const rows = periods.flatMap((period, index) => {
        const values = { symbol: 'ACME', period: kind, ...period, date: period.end };
        return [
            { id: `revenue-${index}`, values: { ...values, item: f.ids.line('revenue'), amount: (index + 1) * 100 } },
            ...(!missing.includes(index) ? [{ id: `cost-${index}`, values: { ...values, item: f.ids.line('cost_of_revenue'), amount: (index + 1) * 60 } }] : []),
        ];
    });
    const source: WidgetDataset = { ...f.source, rows, columns: Object.keys(rows[0].values).map(id => ({ id, label: id })) };
    const view = calculateView(source, { table: {}, search: '', analytical: f.statement }, { kind: 'none' });
    const analytical = view.analytical!;
    return calculateTotals(
        new Set(analytical.pool.rows.map(row => row.id)),
        analytical.pool,
        analytical.compiled,
        { categoryConstraints: new Map([[f.ids.item, pivotValueKey(f.ids.line('calculated_gross_profit'))]]) },
    ).measures.cells.get(f.ids.value);
}

for (const kind of ['FY', 'FQ'] as const) {
    for (const [position, index] of [['leading', 0], ['internal', 1], ['trailing', 2]] as const) {
        it(`${kind} flow refuses a missing ${position} dependency period in the requested scope`, () => {
            expect(coverageFixture(kind, 'flow', [index])).toMatchObject({ ok: false });
        });
    }
    it(`${kind} stock refuses a missing requested latest endpoint`, () => {
        expect(coverageFixture(kind, 'stock', [2])).toMatchObject({ ok: false });
    });
    it(`${kind} complete flow and explicit latest stock retain their distinct results`, () => {
        expect(coverageFixture(kind, 'flow', [])).toEqual({ ok: true, value: 240 });
        expect(coverageFixture(kind, 'stock', [0, 1])).toEqual({ ok: true, value: 420 });
    });
}
