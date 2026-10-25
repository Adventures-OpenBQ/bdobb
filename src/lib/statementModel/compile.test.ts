// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { FormulaAst } from '../tableModel/types';
import { previewStatementUpdate } from './updates';
import { expect, it } from 'vitest';
import { calculateView } from '../tableExecution/engine';
import { fixture } from './compileFixtures';
const run = (f: ReturnType<typeof fixture>) => calculateView(f.source, {
    table: {}, search: '', analytical: f.statement
}, {
    kind: 'none'
});
it('statementExpandsIntoOrdinaryReportRows and sectionHeadingsNeverSumComponents', () => {
    const f = fixture();
    const view = run(f);
    const money = view.columns.find(c => c.measureId === f.ids.value)!;
    expect(money).toBeDefined();
    const line = (id: string) => view.logicalRows.find(r => r.groupPath?.some(p => p.memberKey === JSON.stringify(['string', id])));
    expect(line(f.ids.line('revenue'))?.values[money.id]).toBe(100);
    expect(line(f.ids.line('cost_of_revenue'))?.values[money.id]).toBe(60);
    expect(line(f.ids.line('calculated_gross_profit'))?.values[money.id]).toBe(40);
    expect(view.totals.empty).toBe(true);
    expect(view.totals.values).toEqual({});
    for (const r of view.logicalRows.filter(r => r.groupPath?.length === 1))
        expect(r.values[money.id]).toBeUndefined();
    const profit = line(f.ids.line('calculated_gross_profit'))!;
    expect(view.selectionIdentityRows.some(r => r.id === profit.id)).toBe(true);
    expect(view.definition.analytical).toEqual(f.statement);
});
it('duplicateFactsFailWithoutRevisionGuess', () => {
    const f = fixture();
    f.source.rows.push({
        ...f.source.rows[0], id: 'b'
    });
    const v = run(f);
    expect(v.diagnostics.some(d => /duplicate/i.test(d.message))).toBe(true);
});
it('annualQuarterOverlapBlocked', () => {
    const f = fixture();
    f.source.rows.push({
        ...f.source.rows[0], id: 'q', values: {
            ...f.source.rows[0].values, period: 'FQ'
        }
    });
    expect(() => run(f)).toThrow(/period|FY|FQ/i);
});
it('hiddenParentFieldCannotBeRecovered and restored schema recovers', () => {
    const f = fixture();
    f.source.columns = f.source.columns.filter(c => c.id !== 'revenue');
    expect(() => run(f)).toThrow(/revenue/);
    expect(() => run(fixture())).not.toThrow();
});
it('required unmapped lines fail instead of borrowing other line facts', () => {
    const f = fixture();
    f.statement.template = structuredClone(f.statement.template);
    f.statement.template.lines.find((l) => l.id === f.ids.line('operating_income'))!.required = true;
    const v = run(f);
    const col = v.columns.find(c => c.measureId === f.ids.value)!;
    const row = v.logicalRows.find(r => r.groupPath?.at(-1)?.memberKey === JSON.stringify(['string', f.ids.line('operating_income')]))!;
    expect(row.values[col.id]).toBe('#ERROR');
    expect(row.cellErrors?.[col.id]?.message).toMatch(/no facts/);
});
it('hidden output retains formula dependencies while suppressing observed rows', () => {
    const f = fixture();
    f.statement.overrides.hiddenIds = [f.ids.line('revenue')];
    const v = run(f);
    expect(v.logicalRows.some(r => r.groupPath?.at(-1)?.memberKey === JSON.stringify(['string', f.ids.line('revenue')]))).toBe(false);
    const col = v.columns.find(c => c.measureId === f.ids.value)!;
    expect(v.logicalRows.find(r => r.groupPath?.at(-1)?.memberKey === JSON.stringify(['string', f.ids.line('calculated_gross_profit')]))?.values[col.id]).toBe(40);
});
it('derived row selection survives reconciliation and reorder', () => {
    const f = fixture();
    const v = run(f);
    const row = v.logicalRows.find(r => r.groupPath?.at(-1)?.memberKey === JSON.stringify(['string', f.ids.line('calculated_gross_profit')]))!;
    const selected = calculateView(f.source, {
        table: {}, search: '', analytical: f.statement
    }, {
        kind: 'explicit', ids: [row.id]
    }, true, v.selectionNamespace);
    expect(selected.selection).toEqual({
        kind: 'explicit', ids: [row.id]
    });
    expect(selected.presentedRows.map(r => r.id)).toContain(row.id);
});
it('formula override replaces pinned definition before cycle validation', () => {
    const f = fixture();
    const formula = f.statement.template.lines.find((l) => l.formula)!.formula!;
    f.statement.overrides.formulas = [{
            ...formula, ast: {
                kind: 'literal', value: 9
            }
        }];
    const v = run(f);
    const col = v.columns.find(c => c.measureId === f.ids.value)!;
    expect(v.logicalRows.find(r => r.groupPath?.at(-1)?.memberKey === JSON.stringify(['string', f.ids.line('calculated_gross_profit')]))?.values[col.id]).toBe(9);
    f.statement.overrides.formulas = [{
            ...formula, ast: {
                kind: 'member', value: {
                    kind: 'reference', target: 'measure', id: f.ids.value
                }, selectors: [{
                        categoryId: f.ids.item, memberKey: f.ids.line('calculated_gross_profit')
                    }]
            }
        }];
    expect(() => run(f)).toThrow(/circular/i);
});
it('empty runtime map works, unsupported runtime values fail', () => {
    const f = fixture();
    expect(() => calculateView(f.source, {
        table: {}, search: '', analytical: f.statement
    }, {
        kind: 'none'
    }, true, undefined, [], {})).not.toThrow();
    expect(() => calculateView(f.source, {
        table: {}, search: '', analytical: f.statement
    }, {
        kind: 'none'
    }, true, undefined, [], {
        'pivot:page': {
            source: 'viewer', memberKeys: []
        }
    })).toThrow(/Runtime/);
});
it('incoming cell errors survive private projection', () => {
    const f = fixture();
    f.source.rows[0] = {
        ...f.source.rows[0], cellErrors: {
            revenue: {
                code: 'blocked-dependency', message: 'incoming revenue failure'
            }
        }
    };
    const v = run(f);
    expect(v.diagnostics.some(d => d.message === 'incoming revenue failure')).toBe(true);
    expect(JSON.stringify(v.presentedRows)).not.toContain('sourceColumnsByRowId');
});
it('fiscal bounds-only binding gives repairable diagnostics instead of calendar defaults', () => {
    const f = fixture();
    delete f.statement.bindings.fiscal.dateFieldId;
    expect(() => run(f)).toThrow(/report date/);
});
it('error display tokens preserve their incoming error without unpivot type failure', () => {
    const f = fixture();
    f.source.rows[0] = {
        ...f.source.rows[0], values: {
            ...f.source.rows[0].values, revenue: '#ERROR'
        }, cellErrors: {
            revenue: {
                code: 'blocked-dependency', message: 'remote value failed'
            }
        }
    };
    expect(run(f).diagnostics.some(d => d.message === 'remote value failed')).toBe(true);
});
it('long source binds item and value without unpivot and rejects unknown item identities', () => {
    const f = fixture();
    const row = f.source.rows[0];
    f.statement.bindings.shape = 'long';
    f.statement.bindings.mappings = [];
    f.statement.bindings.longFields = {
        itemFieldId: 'item', valueFieldId: 'amount'
    };
    f.source.columns = f.source.columns.filter(c => !['revenue', 'cost_of_revenue'].includes(c.id)).concat([{
            id: 'item', label: 'Item'
        }, {
            id: 'amount', label: 'Amount'
        }]);
    f.source.rows = ['revenue', 'cost_of_revenue'].map((line, i) => ({
        id: line, values: {
            ...row.values, item: f.ids.line(line), amount: i ? 60 : 100
        }
    }));
    const view = run(f);
    const col = view.columns.find(c => c.measureId === f.ids.value)!;
    expect(view.logicalRows.find(r => r.groupPath?.at(-1)?.memberKey === JSON.stringify(['string', f.ids.line('calculated_gross_profit')]))?.values[col.id]).toBe(40);
    expect(view.analytical?.compiled.execution?.sourceColumnsByRowId).toBeUndefined();
    expect(view.logicalRows.filter(r => r.groupPath?.length === 2)).toHaveLength(3);
    f.source.rows[0].values = {
        ...f.source.rows[0].values, item: 'unknown'
    };
    expect(() => run(f)).toThrow(/line|item/i);
});
it('authoritative cross-company fiscal warnings retain source and bounds', () => {
    const f = fixture();
    f.source.rows.push({
        id: 'b', values: {
            ...f.source.rows[0].values, symbol: 'OTHER', date: '2025-06-30', start: '2024-07-01', end: '2025-06-30'
        }
    });
    f.statement.page = {
        categoryId: f.ids.company, memberKeys: [JSON.stringify(['string', 'ACME']), JSON.stringify(['string', 'OTHER'])]
    };
    const v = run(f);
    expect(v.definition.analytical).toEqual(f.statement);
    expect(v.diagnostics.some(d => d.code === 'fiscal-alignment')).toBe(true);
    expect(v.analytical?.warnings.find(w => w.code === 'fiscal-alignment')?.periods).toEqual(expect.arrayContaining([expect.objectContaining({
            companyKey: 'OTHER', start: '2024-07-01', end: '2025-06-30', source: 'bound period fields'
        })]));
    expect(v.diagnostics.some(d => /Mixed symbol/.test(d.message))).toBe(true);
});
it('result filters evaluate declared derived members before qualification', () => {
    const f = fixture();
    f.statement.resultFilters = [{
            id: 'profit-filter', categoryId: f.ids.item, target: {
                kind: 'measure', id: f.ids.value
            }, predicate: 'eq', value: 40
        }];
    const v = run(f);
    const leaves = v.logicalRows.filter(r => r.groupPath?.length === 2);
    expect(leaves).toHaveLength(1);
    expect(leaves[0].groupPath?.at(-1)?.memberKey).toBe(JSON.stringify(['string', f.ids.line('calculated_gross_profit')]));
    const column = v.columns.find(c => c.measureId === f.ids.value)!;
    expect(leaves[0].values[column.id]).toBe(40);
});
it('derived member references compose across sections without source facts', () => {
    const f = fixture();
    f.statement.template = structuredClone(f.statement.template);
    const id = f.ids.line('margin');
    f.statement.template.sections[0].lineIds.push(id);
    const member = (line: string): FormulaAst => ({
        kind: 'member', value: {
            kind: 'reference', target: 'measure', id: f.ids.value
        }, selectors: [{
                categoryId: f.ids.item, memberKey: f.ids.line(line)
            }]
    });
    f.statement.template.lines.push({
        id, label: 'Margin', required: false, policy: 'formula', formula: {
            id: f.ids.formula('margin'), name: 'Margin', scope: 'aggregate', expression: 'Profit / Revenue', ast: {
                kind: 'binary', operator: '/', left: member('calculated_gross_profit'), right: member('revenue')
            }
        }
    });
    const view = run(f);
    const col = view.columns.find(c => c.measureId === f.ids.value)!;
    expect(view.logicalRows.find(r => r.groupPath?.at(-1)?.memberKey === JSON.stringify(['string', id]))?.values[col.id]).toBe(0.4);
});
it('unqualified Value in a line formula is rejected before recursive evaluation', () => {
    const f = fixture();
    const formula = f.statement.template.lines.find((l) => l.formula)!.formula!;
    f.statement.overrides.formulas = [{
            ...formula, ast: {
                kind: 'reference', target: 'measure', id: f.ids.value
            }
        }];
    expect(() => run(f)).toThrow(/member|scope|bound/i);
});
it('hidden derived member remains a valid formula dependency', () => {
    const f = fixture();
    f.statement.template = structuredClone(f.statement.template);
    const id = f.ids.line('double_profit');
    f.statement.template.sections[0].lineIds.push(id);
    f.statement.template.lines.push({
        id, label: 'Double profit', required: false, policy: 'formula', formula: {
            id: f.ids.formula('double_profit'), name: 'Double profit', scope: 'aggregate', expression: '2 * Profit', ast: {
                kind: 'binary', operator: '*', left: {
                    kind: 'literal', value: 2
                }, right: {
                    kind: 'member', value: {
                        kind: 'reference', target: 'measure', id: f.ids.value
                    }, selectors: [{
                            categoryId: f.ids.item, memberKey: f.ids.line('calculated_gross_profit')
                        }]
                }
            }
        }
    });
    f.statement.overrides.hiddenIds = [f.ids.line('calculated_gross_profit')];
    const v = run(f);
    const col = v.columns.find(c => c.measureId === f.ids.value)!;
    expect(v.logicalRows.find(r => r.groupPath?.at(-1)?.memberKey === JSON.stringify(['string', id]))?.values[col.id]).toBe(80);
});

it('executes authored item checklists before and after an explicit update without changing company/fiscal keys', () => {
    const f = fixture();
    f.statement.checklists = [
        { categoryId: f.ids.item, memberKeys: [f.ids.line('revenue')] },
        { categoryId: f.ids.company, memberKeys: [JSON.stringify(['string', 'ACME'])] },
        { categoryId: f.ids.period, memberKeys: [JSON.stringify(['string', 'FY2025'])] },
    ];
    const original = structuredClone(f.statement);
    const assertRevenue = (view: ReturnType<typeof run>) => {
        const leaves = view.logicalRows.filter(row => row.groupPath?.length === 2);
        expect(leaves).toHaveLength(1);
        expect(leaves[0].values[view.columns.find(c => c.measureId)!.id]).toBe(100);
    };
    assertRevenue(run(f));
    const next = JSON.parse(JSON.stringify(f.statement.template).replaceAll('/1.0.0/', '/2.0.0/').replace('"version":"1.0.0"', '"version":"2.0.0"'));
    f.statement = previewStatementUpdate(f.statement, next).next;
    assertRevenue(run(f));
    expect(original.checklists[0].memberKeys).toEqual([f.ids.line('revenue')]);
    expect(f.statement.checklists.slice(1).map(s=>s.memberKeys)).toEqual(original.checklists.slice(1).map(s=>s.memberKeys));
});
