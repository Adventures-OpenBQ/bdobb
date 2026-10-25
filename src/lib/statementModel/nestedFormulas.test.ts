// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { calculateView } from '../tableExecution/engine';
import type { FormulaAst, FormulaDef } from '../tableModel/types';
import { compileStatement } from './compile';
import { fixture } from './compileFixtures';

const wrappers: [string, (value: FormulaAst) => FormulaAst, number][] = [
    ['binary', value => ({ kind: 'binary', operator: '+', left: value, right: { kind: 'literal', value: 1 } }), 41],
    ['unary', value => ({ kind: 'unary', operator: '-', operand: value }), -40],
    ['IF', value => ({ kind: 'call', function: 'IF', args: [{ kind: 'literal', value: true }, value, { kind: 'literal', value: 0 }] }), 40],
];

function member(f: ReturnType<typeof fixture>, line: string, value: FormulaAst): FormulaAst {
    return { kind: 'member', selectors: [{ categoryId: f.ids.item, memberKey: f.ids.line(line) }], value };
}
function measure(f: ReturnType<typeof fixture>): FormulaAst {
    return { kind: 'reference', target: 'measure', id: f.ids.value };
}
function addDerived(f: ReturnType<typeof fixture>, ast: FormulaAst) {
    f.statement.template = structuredClone(f.statement.template);
    const lineId = f.ids.line('nested_profit');
    f.statement.template.sections[0].lineIds.push(lineId);
    f.statement.template.lines.push({
        id: lineId, label: 'Nested profit', required: false, policy: 'formula',
        formula: { id: f.ids.formula('nested_profit'), name: 'Nested profit', scope: 'aggregate', expression: 'nested member expression', ast },
    });
    return lineId;
}
function derivedValue(f: ReturnType<typeof fixture>, id: string) {
    const view = calculateView(f.source, { table: {}, search: '', analytical: f.statement }, { kind: 'none' });
    const column = view.columns.find(column => column.measureId === f.ids.value)!;
    const row = view.logicalRows.find(row => row.groupPath?.at(-1)?.memberKey === JSON.stringify(['string', id]));
    return row?.values[column.id];
}

for (const [name, wrap, expected] of wrappers) {
    it(`rejects a ${name} member self-cycle during compilation`, () => {
        const f = fixture();
        const pinned: FormulaDef = f.statement.template.lines.find((line: { formula?: FormulaDef }) => line.formula)!.formula!;
        f.statement.overrides.formulas = [{ ...pinned, ast: member(f, 'calculated_gross_profit', wrap(measure(f))) }];
        expect(() => compileStatement(f.statement, f.source.columns)).toThrow(/Circular reference/);
    });
    it(`evaluates a valid nested ${name} derived dependency`, () => {
        const f = fixture();
        const id = addDerived(f, member(f, 'calculated_gross_profit', wrap(measure(f))));
        expect(derivedValue(f, id)).toBe(expected);
    });
}
it('rejects a multi-formula cycle hidden inside unary and IF member values', () => {
    const f = fixture();
    const pinned: FormulaDef = f.statement.template.lines.find((line: { formula?: FormulaDef }) => line.formula)!.formula!;
    addDerived(f, member(f, 'calculated_gross_profit', wrappers[2][1](measure(f))));
    f.statement.overrides.formulas = [{ ...pinned, ast: member(f, 'nested_profit', wrappers[1][1](measure(f))) }];
    expect(() => compileStatement(f.statement, f.source.columns)).toThrow(/Circular reference/);
});
it('nested selectors replace the active line only within their own subtree', () => {
    const f = fixture();
    const ast = member(f, 'calculated_gross_profit', {
        kind: 'binary', operator: '+', left: measure(f),
        right: member(f, 'revenue', { kind: 'unary', operator: '-', operand: measure(f) }),
    });
    const id = addDerived(f, ast);
    expect(derivedValue(f, id)).toBe(-60);
});
