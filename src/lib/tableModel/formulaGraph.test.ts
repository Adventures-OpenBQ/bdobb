// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { validateFormulaGraph } from './formulaGraph';
import type { FormulaAst, FormulaDef } from './types';
import type { ModelSymbols } from './formulaBinding';
const ref = (id: string): FormulaAst => ({ kind: 'reference', target: 'formula', id });
const def = (id: string, ast: FormulaAst = { kind: 'literal', value: 1 }, scope: FormulaDef['scope'] = 'source'): FormulaDef => ({ id, name: id.toUpperCase(), ast, scope, expression: 'old display labels' });
const symbols: ModelSymbols = { fields: [], formulas: [], measures: [], categories: [] };

describe('formula dependency graph', () => {
  it('orders referenced source formulas before their dependents and aggregate consumers', () => {
    const result = validateFormulaGraph([def('margin', { kind: 'call', function: 'sum', args: [ref('profit')] }, 'aggregate'), def('profit', ref('cost')), def('cost')], symbols);
    expect(result.order).toEqual(['cost', 'profit', 'margin']);
    expect(result.diagnostics).toEqual([]);
    expect(result.externalValidation).toBe('complete');
  });
  it('reports self and indirect cycles by stable IDs and current names', () => {
    const self = validateFormulaGraph([def('self', ref('self'))], symbols);
    expect(self.cycles).toContainEqual(expect.objectContaining({ ids: ['self', 'self'], names: ['SELF', 'SELF'] }));
    const result = validateFormulaGraph([def('profit', ref('cost')), def('cost', ref('profit')), def('blocked', ref('profit')), def('independent')], symbols);
    expect(result.cycles).toContainEqual(expect.objectContaining({ ids: ['profit', 'cost', 'profit'], names: ['PROFIT', 'COST', 'PROFIT'] }));
    expect(result.blockedIds).toEqual(expect.arrayContaining(['profit', 'cost', 'blocked']));
    expect(result.order).toEqual(['independent']);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'blocked-dependency', definitionId: 'blocked' }));
  });
  it('detects aggregate cycles through member reference values', () => {
    const context = { ...symbols, fields: [{ id: 's', name: 'Scenario' }], categories: [{ id: 'scenario', name: 'Scenario', sourceFieldId: 's', members: [{ key: 'actual', value: 'Actual' }] }] };
    const member: FormulaAst = { kind: 'member', value: ref('b'), selectors: [{ categoryId: 'scenario', memberKey: 'actual' }] };
    const result = validateFormulaGraph([def('a', member, 'aggregate'), def('b', ref('a'), 'aggregate')], context);
    expect(result.cycles[0].ids).toEqual(['a', 'b', 'a']);
    expect(result.order).toEqual([]);
  });
  it('includes category/measure source-formula edges and blocks their dependent closure', () => {
    const context: ModelSymbols = { ...symbols, fields: [{ id: 'raw', name: 'Raw' }], categories: [{ id: 'category', name: 'Category', sourceFieldId: 'a', members: [{ key: 'one', value: 1 }] }], measures: [{ id: 'measure', name: 'Measure', sourceFieldId: 'a', aggregation: 'sum' }] };
    const member: FormulaAst = { kind: 'member', value: { kind: 'literal', value: 1 }, selectors: [{ categoryId: 'category', memberKey: 'one' }] };
    const result = validateFormulaGraph([def('a', ref('b')), def('b', member, 'aggregate'), def('c', { kind: 'reference', target: 'measure', id: 'measure' }, 'aggregate'), def('okay')], context);
    expect(result.cycles).toContainEqual(expect.objectContaining({ ids: ['a', 'b', 'category', 'a'], names: ['A', 'B', 'Category', 'A'] }));
    expect(result.order).toEqual(['okay']);
    expect(result.blockedIds).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });
  it('retains invalid imports while independent entries remain usable', () => {
    const invalid = { ...def('bad'), ast: { kind: 'call', function: 'EVAL', args: [] } };
    const result = validateFormulaGraph([invalid, def('dependent', ref('bad')), def('okay')], symbols);
    expect(result.entries[0].raw).toBe(invalid);
    expect(result.entries[0].value).toBeUndefined();
    expect(result.entries[0].diagnostics[0].code).toBe('invalid-ast');
    expect(result.order).toEqual(['okay']);
    expect(result.blockedIds).toContain('dependent');
  });
  it('validates missing stable IDs and source scope without reading stale expression names', () => {
    const result = validateFormulaGraph([def('aggregate', undefined, 'aggregate'), def('source', ref('aggregate')), def('missing', ref('deleted')), def('okay')], symbols);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ definitionId: 'source', code: 'scope' }));
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ definitionId: 'missing', code: 'missing-reference', dependencyIds: ['deleted'] }));
    expect(result.order).toEqual(['aggregate', 'okay']);
  });
  it('never marks external validation complete when no input schema is supplied', () => {
    const field: FormulaAst = { kind: 'reference', target: 'field', id: 'gone' };
    expect(validateFormulaGraph([def('a', field)]).externalValidation).toBe('not-performed');
    expect(validateFormulaGraph([def('a', field)], symbols).diagnostics).toContainEqual(expect.objectContaining({ code: 'missing-reference' }));
    expect(validateFormulaGraph([def('a', field)], symbols).order).toEqual([]);
    expect(validateFormulaGraph([def('a', ref('missing'))]).order).toEqual([]);
  });
  it('rejects duplicate IDs, allows already-bound duplicate names, and preserves drafts', () => {
    expect(validateFormulaGraph([def('a'), def('a'), def('b', ref('a'))], symbols).order).toEqual([]);
    const committed = Object.freeze([Object.freeze(def('a')), Object.freeze({ ...def('b'), name: 'A' })]);
    expect(validateFormulaGraph(committed, symbols).order).toEqual(['a', 'b']);
    validateFormulaGraph([{ ...committed[0], ast: ref('a') }, committed[1]], symbols);
    expect(committed[0].ast).toEqual({ kind: 'literal', value: 1 });
  });
  it('bounds imported expression text and ASTs without invoking definition getters', () => {
    let touched = false;
    const getter = { get id() { touched = true; return 'evil'; } };
    const result = validateFormulaGraph([getter, { ...def('huge'), expression: 'é'.repeat(8193) }, def('okay')], symbols);
    expect(touched).toBe(false);
    expect(result.entries[1].diagnostics[0].code).toBe('expression-limit');
    expect(result.order).toEqual(['okay']);
  });
});

it('blocks source formula output collisions with raw input IDs and their dependents', () => {
  const context = { ...symbols, fields: [{ id: 'a', name: 'Raw A' }] };
  const result = validateFormulaGraph([def('a'), def('b', ref('a')), def('okay')], context);
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'ambiguous-reference', definitionId: 'a' }));
  expect(result.order).toEqual(['okay']);
});

it('handles long formula dependency chains without overflowing the JS call stack', () => {
  const definitions = Array.from({ length: 5000 }, (_, i) => def(String(i), i < 4999 ? ref(String(i + 1)) : undefined));
  const result = validateFormulaGraph(definitions);
  expect(result.order).toHaveLength(5000);
  expect(result.order[0]).toBe('4999');
  expect(result.order[4999]).toBe('0');
});
