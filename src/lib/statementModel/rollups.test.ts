// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { calculateView } from '../tableExecution/engine';
import { calculateTotals } from '../tableModel/totals';
import { fixture } from './compileFixtures';
import { pivotValueKey } from '../pivotKeys';
it('ratio recomputes policy-aware numerator/denominator over fiscal scopes', () => {
    const f = fixture();
    const formula = f.statement.template.lines.find((l) => l.formula)!.formula!;
    if (formula.ast.kind !== 'binary') throw new Error('Expected binary fixture');
    f.statement.overrides.formulas = [{
            ...formula, ast: {
                ...formula.ast, operator: '/'
            }
        }];
    f.source.rows.push({
        id: 'b', values: {
            ...f.source.rows[0].values, year: 2026, date: '2026-12-31', start: '2026-01-01', end: '2026-12-31', revenue: 200, cost_of_revenue: 100
        }
    });
    const calculate = () => {
        const v = calculateView(f.source, {
            table: {}, search: '', analytical: f.statement
        }, {
            kind: 'none'
        });
        const a = v.analytical!;
        return calculateTotals(new Set(a.pool.rows.map(r => r.id)), a.pool, a.compiled, {
            categoryConstraints: new Map([[f.ids.item, pivotValueKey(f.ids.line('calculated_gross_profit'))]])
        }).measures.cells.get(f.ids.value);
    };
    expect(calculate()).toEqual({
        ok: true, value: 300 / 160
    });
    f.statement.template = structuredClone(f.statement.template);
    f.statement.template.lines.find((l) => l.id === f.ids.line('cost_of_revenue'))!.policy = 'stock';
    expect(calculate()).toEqual({
        ok: true, value: 3
    });
});

it.each(['currency', 'unit'] as const)('rejects derived values with mixed %s dependencies', field => {
    const f = fixture();
    f.statement.bindings.shape = 'long';
    f.statement.bindings.mappings = [];
    f.statement.bindings.longFields = { itemFieldId: 'item', valueFieldId: 'amount' };
    if (field === 'currency') f.statement.bindings.currencyFieldId = field;
    else f.statement.bindings.unitFieldId = field;
    const base = f.source.rows[0].values;
    f.source.rows = [
        { id: 'r', values: { ...base, item: f.ids.line('revenue'), amount: 100, [field]: field === 'currency' ? 'USD' : 'dollars' } },
        { id: 'c', values: { ...base, item: f.ids.line('cost_of_revenue'), amount: 60, [field]: field === 'currency' ? 'EUR' : 'millions' } }
    ];
    f.source.columns = Object.keys(f.source.rows[0].values).map(id => ({ id, label: id }));
    const calculate = () => {
        const v = calculateView(f.source, { table: {}, search: '', analytical: f.statement }, { kind: 'none' });
        const col = v.columns.find(c => c.measureId === f.ids.value)!;
        const row = v.logicalRows.find(r => r.groupPath?.at(-1)?.value === f.ids.line('calculated_gross_profit'))!;
        return { value: row.values[col.id], error: row.cellErrors?.[col.id] };
    };
    expect(calculate().error).toBeDefined();
    expect(calculate().value).not.toBe(40);
    f.source.rows[1].values[field] = f.source.rows[0].values[field];
    expect(calculate()).toEqual({ value: 40, error: undefined });
    const unrelated = f.statement.template.lines.find(line => !line.formula && !['revenue', 'cost_of_revenue'].some(name => line.id === f.ids.line(name)))!;
    f.source.rows.push({ id: 'unrelated', values: { ...base, item: unrelated.id, amount: 500, [field]: field === 'currency' ? 'JPY' : 'thousands' } });
    expect(calculate()).toEqual({ value: 40, error: undefined });
});
