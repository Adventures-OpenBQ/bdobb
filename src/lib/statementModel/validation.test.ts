// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { StatementIntent } from './types';
import type { FormulaDef, FormulaAst } from '../tableModel/types';

import { expect, it } from 'vitest';
import { intent } from './testFixtures';
import { validateStatementIntent } from './validation';
it('unknownSchemasStayInert', () => {
  expect(validateStatementIntent({ schemaVersion: 999 }).value).toBeUndefined();
  expect(validateStatementIntent({ schemaVersion: 999 }).diagnostics[0].code).toBe('unsupported-schema');
});
it('rejectUnsafeSnapshotAndUnownedFormulaIds', () => {
  let reads = 0; const raw = Object.defineProperty({}, 'schemaVersion', { get() { reads++; throw Error(); } });
  expect(validateStatementIntent(raw).value).toBeUndefined(); expect(reads).toBe(0);
  const v = structuredClone(intent()); const line = v.template.lines.find((l) => l.policy === 'formula')!;
  expect(line.formula!.ast.kind).toBe('binary');
  memberAst(line.formula!.ast).selectors[0].memberKey = 'unowned';
  expect(validateStatementIntent(v).diagnostics.some(d => d.code === 'missing-reference')).toBe(true);
  expect(validateStatementIntent(v).value).toBeUndefined();
});
it('rejectDuplicateDestinationMappings', () => {
  const v = intent(); const lineId = v.template.lines[0].id;
  v.bindings.mappings = [{ sourceFieldId: 'a', lineId }, { sourceFieldId: 'b', lineId }];
  expect(validateStatementIntent(v).diagnostics.some(d => d.code === 'duplicate-id')).toBe(true);
});
it('rejects contradictory orders, malformed bindings and formula policies', () => {
  for (const mutate of [
    (v: StatementIntent) => v.overrides.sectionOrder = ['unknown'],
    (v: StatementIntent) => v.overrides.lineOrder[v.template.sections[0].id] = [v.template.sections[1].lineIds[0]],
    (v: StatementIntent) => v.bindings.fiscal.companyFieldId = 'other',
    (v: StatementIntent) => v.template.lines[0].policy = 'formula',
    (v: StatementIntent) => v.checklists = [{ categoryId: 'unknown', memberKeys: [] }],
    (v: StatementIntent) => Object.assign(memberAst(v.template.lines.find(l => l.formula)!.formula!.ast).selectors[0], {memberKeys:['bad']}),
  ]) { const v = structuredClone(intent()); mutate(v); expect(validateStatementIntent(v).value).toBeUndefined(); }
});
it('rejects missing fiscal context and source/identity collisions', () => {
  for (const mutate of [
    (v: StatementIntent) => v.bindings.fiscal = { companyFieldId: 'symbol' },
    (v: StatementIntent) => v.bindings.mappings = [{ sourceFieldId: 'symbol', lineId: v.template.lines[0].id }],
    (v: StatementIntent) => v.bindings.periodKindFieldId = 'symbol',
  ]) { const v = structuredClone(intent()); mutate(v); expect(validateStatementIntent(v).value).toBeUndefined(); }
});
it('returns detached validated intent and never executes nested accessors', () => {
  const v = intent(); const checked = validateStatementIntent(v); expect(checked.value).toBeDefined();
  expect(checked.value).not.toBe(v); checked.value!.bindings.companyFieldId = 'changed'; expect(v.bindings.companyFieldId).toBe('symbol');
  let reads = 0; Object.defineProperty(v, 'bindings', {value: Object.defineProperty({}, 'companyFieldId', { get() { reads++; return 'symbol'; } })});
  expect(validateStatementIntent(v).value).toBeUndefined(); expect(reads).toBe(0);
});
it('allows explicit reuse of a source field for distinct lines', () => {
  const v = intent(); v.bindings.mappings = v.template.lines.slice(0, 2).map((l) => ({ sourceFieldId: 'amount', lineId: l.id }));
  expect(validateStatementIntent(v).diagnostics).toEqual([]);
});
it('rejects hostile graphs and unowned formula definition/value/category IDs', () => {
  const cycle: Record<string, unknown> = { schemaVersion: 2 }; cycle.self = cycle;
  for (const raw of [cycle, new Date(), { schemaVersion: 2, x: Array(50001) }, Object.assign(Object.create({}), { schemaVersion: 2 })]) expect(validateStatementIntent(raw).value).toBeUndefined();
  for (const mutate of [
    (f: FormulaDef) => f.id = 'foreign',
    (f: FormulaDef) => Object.assign(memberAst(f.ast).value, {id:'foreign'}),
    (f: FormulaDef) => memberAst(f.ast).selectors[0].categoryId = 'foreign',
    (f: FormulaDef) => memberAst(f.ast).selectors[0].memberKey = 'foreign',
    (f: FormulaDef) => Object.assign(memberAst(f.ast).selectors, {0:{categoryId:'bad',memberKeys:[]}}),
    (f: FormulaDef) => Object.assign(f, {ast:{kind:'script',source:'alert(1)'}}),
  ]) { const v = structuredClone(intent()); mutate(v.template.lines.find((l) => l.formula)!.formula!); expect(validateStatementIntent(v).value).toBeUndefined(); }
  const v = structuredClone(intent()); v.template.lines[0].formula = v.template.lines.find((l) => l.formula)!.formula!;
  expect(validateStatementIntent(v).value).toBeUndefined();
});
it('allows owned replacement formulas but rejects unknown targets and duplicate overrides', () => {
  const v = structuredClone(intent()); const formula = v.template.lines.find((l) => l.formula)!.formula!;
  v.overrides.formulas = [{ ...formula, name: 'My gross profit' }];
  expect(validateStatementIntent(v).diagnostics).toEqual([]);
  v.overrides.formulas.push({ ...formula }); expect(validateStatementIntent(v).value).toBeUndefined();
  v.overrides.formulas = [{ ...formula, id: formula.id + '_unknown' }]; expect(validateStatementIntent(v).value).toBeUndefined();
});
it.each([
  ['top-level schema', (v: StatementIntent) => Object.defineProperty(v, 'schemaVersion', { value: 2, enumerable: false })],
  ['nested binding', (v: StatementIntent) => Object.defineProperty(v.bindings, 'companyFieldId', { value: 'symbol', enumerable: false })],
  ['nested line ID', (v: StatementIntent) => Object.defineProperty(v.template.lines[0], 'id', { value: v.template.lines[0].id, enumerable: false })],
  ['nested AST kind', (v: StatementIntent) => Object.defineProperty(v.template.lines.find((l) => l.formula)!.formula!.ast, 'kind', { value: 'binary', enumerable: false })],
] as const)('rejects non-enumerable required property: %s', (_label, hide) => {
  const v = structuredClone(intent());
  hide(v);
  const checked = validateStatementIntent(v);
  expect(checked.value).toBeUndefined();
  expect(checked.diagnostics.length).toBeGreaterThan(0);
});

function memberAst(ast: FormulaAst): Extract<FormulaAst, {kind:'member'}> {
 if(ast.kind!=='binary'||ast.left.kind!=='member')throw new Error('Expected bound fixture member');
 return ast.left;
}
it('bounds override labels to 4096 UTF-16 units, as presentation does', () => {
  const at = (label: string) => { const v = intent(); v.overrides.labels[v.template.lines[0].id] = label; return validateStatementIntent(v); };
  expect(at('x'.repeat(4096)).value).toBeDefined();
  const over = at('x'.repeat(4097));
  expect(over.value).toBeUndefined();
  expect(over.diagnostics.map(d => d.path)).toContain('overrides.labels');
});
