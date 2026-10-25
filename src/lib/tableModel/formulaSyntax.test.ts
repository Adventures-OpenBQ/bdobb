// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { parseFormula, validateFormulaAst } from './formulaSyntax';
import type { FormulaAst } from './types';

const literal = (value: number): FormulaAst => ({ kind: 'literal', value });

describe('formula syntax', () => {
  it('preserves arithmetic precedence, left associativity, unary and comparison structure', () => {
    expect(parseFormula('-2 + 3 * 4 / 2 >= 1').ast).toEqual({ kind: 'binary', operator: '>=',
      left: { kind: 'binary', operator: '+', left: { kind: 'unary', operator: '-', operand: literal(2) },
        right: { kind: 'binary', operator: '/', left: { kind: 'binary', operator: '*', left: literal(3), right: literal(4) }, right: literal(2) } }, right: literal(1) });
  });
  it('keeps IF branches as expressions and bracketed names unambiguous', () => {
    expect(parseFormula('IF([Net Revenue] != 0, SUM(Profit) / SUM([Net Revenue]), 0)').ast).toMatchObject({
      kind: 'call', function: 'IF', args: [
        { kind: 'binary', operator: '!=', left: { kind: 'name', name: 'Net Revenue' } },
        { kind: 'binary', operator: '/' }, literal(0),
      ],
    });
  });
  it('parses typed and quoted member values without treating them as variable references', () => {
    expect(parseFormula('Revenue[Scenario="Prior Budget"]').ast).toEqual({ kind: 'member', value: { kind: 'name', name: 'Revenue' }, selectors: [{ categoryName: 'Scenario', value: 'Prior Budget' }] });
    expect(parseFormula('Revenue[Year=2026]').ast).toMatchObject({ selectors: [{ categoryName: 'Year', value: 2026 }] });
    expect(parseFormula('Revenue[Scenario=Actual]').ast).toMatchObject({ selectors: [{ categoryName: 'Scenario', value: 'Actual' }] });
  });
  it.each(['SUM', 'MEAN', 'MEDIAN', 'MIN', 'MAX', 'COUNT', 'UNIQUECOUNT', 'FIRST', 'LAST'])('accepts %s explicitly', fn => {
    expect(parseFormula(`${fn}(Volume)`).diagnostics).toEqual([]);
  });
  it.each(['a.b', 'evil(1)', 'new Object()', '{}', '1; alert(1)', 'a["x"]', 'SUM()', 'SUM(1,2)', 'IF(1,2)', '1 2', '1e999', '"unterminated', '[unterminated'])('rejects unsafe or malformed syntax %s', text => {
    expect(parseFormula(text)).toMatchObject({ diagnostics: [expect.objectContaining({ code: 'syntax' })] });
    expect(parseFormula(text).ast).toBeUndefined();
  });
  it('enforces the UTF-8 byte limit at the real Unicode boundary', () => {
    expect(parseFormula(`"${'é'.repeat(8191)}"`).diagnostics).toEqual([]);
    expect(parseFormula(`"${'é'.repeat(8191)}a"`).diagnostics).toEqual([expect.objectContaining({ code: 'expression-limit', message: expect.stringContaining('16 KiB') })]);
  });
  it('bounds nested parsing before a call-stack overflow', () => {
    expect(parseFormula('('.repeat(1000) + '1' + ')'.repeat(1000)).diagnostics[0]).toMatchObject({ code: 'parser-nesting-limit', message: expect.stringContaining('256') });
    expect(parseFormula('-'.repeat(63) + '1').diagnostics).toEqual([]);
    expect(parseFormula('-'.repeat(64) + '1').diagnostics[0].code).toBe('depth-limit');
  });
  it('does not count grouping parentheses as AST depth', () => {
    expect(parseFormula('-'.repeat(63) + '(1)').diagnostics).toEqual([]);
    for (const pairs of [64, 128, 256]) {
      expect(parseFormula('('.repeat(pairs) + '1' + ')'.repeat(pairs)).ast).toEqual(literal(1));
    }
    expect(parseFormula('('.repeat(257) + '1' + ')'.repeat(257)).diagnostics[0]).toMatchObject({ code: 'parser-nesting-limit', message: expect.stringContaining('256') });
  });
  it.each([
    ['unary', (text: string) => `-(${text})`],
    ['function', (text: string) => `IF(true, (${text}), 0)`],
    ['binary', (text: string) => `1 + (${text})`],
  ] as const)('checks actual AST depth across parenthesized %s shapes', (_name, wrap) => {
    let text = '1';
    for (let i = 0; i < 63; i++) text = wrap(text);
    expect(parseFormula(text).diagnostics).toEqual([]);
    expect(parseFormula(wrap(text)).diagnostics[0]).toMatchObject({ code: 'depth-limit', message: expect.stringContaining('64') });
  });
  it('accepts 1024 AST nodes and rejects 1025 with a named diagnostic', () => {
    const tree = (leaves: number): string => leaves === 1 ? '1' : `(${tree(Math.floor(leaves / 2))}+${tree(Math.ceil(leaves / 2))})`;
    expect(parseFormula(`-${tree(512)}`).diagnostics).toEqual([]);
    expect(parseFormula(tree(513)).diagnostics[0]).toMatchObject({ code: 'node-limit', message: expect.stringContaining('1,024') });
  });
});

describe('imported AST validation', () => {
  it('validates arity, operators, targets, and finite scalar types', () => {
    for (const ast of [{ kind: 'call', function: 'IF', args: [literal(1)] }, { kind: 'call', function: 'EVAL', args: [] }, { kind: 'literal', value: Infinity }, { kind: 'reference', target: 'window', id: 'x' }, { kind: 'binary', operator: '**', left: literal(2), right: literal(3) }]) {
      expect(validateFormulaAst(ast).diagnostics[0].code).toBe('invalid-ast');
    }
  });
  it('never invokes accessors and refuses cycles, sparse arrays and hidden payloads', () => {
    let invoked = false;
    const getter = { get kind() { invoked = true; return 'literal'; }, value: 1 };
    const cyclic: Record<string, unknown> = { kind: 'unary', operator: '-' }; cyclic.operand = cyclic;
    for (const ast of [getter, cyclic, { kind: 'call', function: 'SUM', args: new Array(2 ** 32 - 1) }, { kind: 'literal', value: 1, script: 'danger' }]) {
      expect(validateFormulaAst(ast).diagnostics.length).toBeGreaterThan(0);
    }
    expect(invoked).toBe(false);
  });
  it('enforces node and depth budgets for persisted ASTs as well', () => {
    let ast: FormulaAst = literal(1);
    for (let i = 0; i < 63; i++) ast = { kind: 'unary', operator: '-', operand: ast };
    expect(validateFormulaAst(ast).diagnostics).toEqual([]);
    expect(validateFormulaAst({ kind: 'unary', operator: '-', operand: ast }).diagnostics[0].code).toBe('depth-limit');
    const tree = (leaves: number): FormulaAst => leaves === 1 ? literal(1) : { kind: 'binary', operator: '+', left: tree(Math.floor(leaves / 2)), right: tree(Math.ceil(leaves / 2)) };
    expect(validateFormulaAst({ kind: 'unary', operator: '-', operand: tree(512) }).diagnostics).toEqual([]);
    expect(validateFormulaAst(tree(513)).diagnostics[0].code).toBe('node-limit');
    expect(validateFormulaAst({ kind: 'literal', value: 'é'.repeat(8193) }).diagnostics[0].code).toBe('expression-limit');
  });
});

it.each([
 ['Revenue',{kind:'name',name:'Revenue'}],
 ['SUM(Revenue)',{kind:'call',function:'sum',args:[{kind:'name',name:'Revenue'}]}],
 ['Revenue[Scenario=Actual]',{kind:'member',value:{kind:'name',name:'Revenue'},selectors:[{categoryName:'Scenario',value:'Actual'}]}],
 ['[Net income][[Report year]=2024]',{kind:'member',value:{kind:'name',name:'Net income'},selectors:[{categoryName:'Report year',value:2024}]}],
])('parses canonical spec draft %s without artificial token suffixes',(expression,ast)=>{
 expect(parseFormula(expression)).toEqual({ast,diagnostics:[]});
});
