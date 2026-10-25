// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { pivotValueKey } from '../pivotKeys';
import { context } from './evaluationTestHelpers';
import { evaluateSourceFormulas } from './formulaEvaluation';
import { eligiblePool } from './facets';
import { resolveMemberScope, type CalculationScope } from './scopes';
const categories = [
  { id: 's', name: 'Scenario', sourceFieldId: 'scenario', transform: 'native' as const },
  { id: 'r', name: 'Region', sourceFieldId: 'region', transform: 'native' as const },
  { id: 'y', name: 'Year', sourceFieldId: 'date', transform: 'Y' as const },
  { id: 'q', name: 'Quarter', sourceFieldId: 'date', transform: 'Q' as const },
];
const rows = [
  { id: 'a', values: { scenario: 'Actual', region: 'West', date: '2026-01-01', revenue: 10 } },
  { id: 'b', values: { scenario: 'Budget', region: 'West', date: '2026-01-01', revenue: 20 } },
  { id: 'east', values: { scenario: 'Budget', region: 'East', date: '2026-01-01', revenue: 999 } },
  { id: 'old', values: { scenario: 'Budget', region: 'West', date: '2025-01-01', revenue: 30 } },
];
const selector = (categoryId: string, value: string) => ({ categoryId, memberKey: pivotValueKey(value) });
function fixture(exclude = false) {
  const model = context([], categories);
  const pool = eligiblePool(evaluateSourceFormulas(rows, model), { columns: model.columns, checklists: exclude ? [{ categoryId: 's', memberKeys: [pivotValueKey('Actual')] }] : [] });
  const scope: CalculationScope = { sourceRecordIds: new Set(['a']), categoryConstraints: new Map([['r', pivotValueKey('West')], ['y', pivotValueKey('2026')], ['q', pivotValueKey('2026-Q1')]]), page: {categoryId:'s',memberKeys:[pivotValueKey('Actual')]}, temporalContext: { dateFieldId: 'date' } };
  return { pool, scope };
}
describe('member scopes', () => {
  it('crosses the page while retaining region and full temporal keys', () => {
    const { pool, scope } = fixture();
    const result = resolveMemberScope(pool, scope, [selector('s', 'Budget')]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect([...result.scope.sourceRecordIds]).toEqual(['b']);
      expect(result.scope.temporalContext).toEqual(scope.temporalContext);
    }
    expect([...scope.sourceRecordIds]).toEqual(['a']);
  });
  it('distinguishes excluded from missing without reading excluded values', () => {
    const { pool, scope } = fixture(true);
    expect(resolveMemberScope(pool, scope, [selector('s', 'Budget')])).toMatchObject({ ok: false, errors: [{ code: 'excluded-member' }] });
    expect(resolveMemberScope(pool, scope, [selector('s', 'Forecast')])).toMatchObject({ ok: false, errors: [{ code: 'missing-member' }] });
  });
  it('requires explicit replacement of both Year and its year-qualified Quarter', () => {
    const { pool, scope } = fixture();
    expect(resolveMemberScope(pool, scope, [selector('s', 'Budget'), selector('y', '2025')])).toMatchObject({ ok: false, errors: [{ code: 'no-counterpart' }] });
    const result = resolveMemberScope(pool, scope, [selector('s', 'Budget'), selector('y', '2025'), selector('q', '2025-Q1')]);
    expect(result.ok && [...result.scope.sourceRecordIds]).toEqual(['old']);
  });
});

it('unions only surviving context slices and retains company restrictions without a company category', () => {
  const model = context([], categories);
  const input = [...rows.map(row => ({ ...row, values: { ...row.values, company: 'ACME' } })),
    { id: 'other-company', values: { scenario: 'Budget', region: 'West', date: '2026-01-01', company: 'OTHER', revenue: 999 } },
    { id: 'unrelated', values: { scenario: 'Budget', region: 'East', date: '2025-01-01', company: 'ACME', revenue: 999 } }];
  const pool = eligiblePool(evaluateSourceFormulas(input, model), { columns: model.columns });
  const { scope } = fixture();
  const surviving: CalculationScope = { ...scope, categoryConstraints: new Map(), contextSlices: [new Map([['r', pivotValueKey('West')], ['y', pivotValueKey('2026')]]), new Map([['r', pivotValueKey('West')], ['y', pivotValueKey('2025')]]), new Map([['r', pivotValueKey('West')], ['y', pivotValueKey('2025')]])], temporalContext: { dateFieldId: 'date', companyFieldId: 'company', companyIds: new Set(['ACME']) } };
  const result = resolveMemberScope(pool, surviving, [selector('s', 'Budget')]);
  expect(result.ok && [...result.scope.sourceRecordIds]).toEqual(['b', 'old']);
});
it('does not turn an explicitly empty identity set into all eligible counterpart rows', () => {
  const { pool, scope } = fixture();
  const result = resolveMemberScope(pool, { ...scope, sourceRecordIds: new Set() }, [selector('s', 'Budget')]);
  expect(result.ok && [...result.scope.sourceRecordIds]).toEqual([]);
});

import { scopeErrors } from './scopes';
import { formula, literal, ref } from './evaluationTestHelpers';
it('qualification failures affect only compatible category contexts, with unknown categories conservative', () => {
  const bad = formula('ratio', { kind: 'binary', operator: '/', left: ref('revenue'), right: literal(0) });
  const model = context([bad], categories);
  const pool = eligiblePool(evaluateSourceFormulas(rows, model), { columns: [...model.columns, { id: 'ratio', label: 'ratio', dtype: 'number' }], table: { columnFilters: [{ id: 'ratio', value: { min: 1 } }] } });
  const { scope } = fixture();
  const future = { ...scope, page: undefined, categoryConstraints: new Map([['y', pivotValueKey('2027')]]) };
  expect(scopeErrors(pool, future)).toEqual([]);
  expect(scopeErrors(pool, scope).flatMap(e => e.recordIds ?? [])).toEqual(['a']);
  const unknown = eligiblePool(evaluateSourceFormulas([{ id: 'unknown', values: { revenue: 2, date: 'bad' } }], model), { columns: [...model.columns, { id: 'ratio', label: 'ratio', dtype: 'number' }], table: { columnFilters: [{ id: 'ratio', value: { min: 1 } }] } });
  expect(scopeErrors(unknown, future)).toHaveLength(1);
});
it('returns no-counterpart for an eligible member outside the surviving company, while retaining zero records',()=>{const {pool,scope}=fixture();const other={...scope,categoryConstraints:new Map([['r',pivotValueKey('North')]])};expect(resolveMemberScope(pool,other,[selector('s','Budget')])).toMatchObject({ok:false,errors:[{code:'no-counterpart'}]});const zeroRows=[rows[0],{...rows[1],values:{...rows[1].values,revenue:0}}];const model=context([],categories),zero=eligiblePool(evaluateSourceFormulas(zeroRows,model),{columns:model.columns});const result=resolveMemberScope(zero,scope,[selector('s','Budget')]);expect(result.ok&&[...result.scope.sourceRecordIds]).toEqual(['b']);});
it('does not call a globally excluded member missing merely because this group has no counterpart',()=>{const {pool,scope}=fixture(true);expect(resolveMemberScope(pool,{...scope,categoryConstraints:new Map([['r',pivotValueKey('North')]])},[selector('s','Budget')])).toMatchObject({ok:false,errors:[{code:'excluded-member'}]});});
it('does not assert member absence when an excluded acquired row has unknown category classification',()=>{const model=context([],categories);const pool=eligiblePool(evaluateSourceFormulas([rows[0],{id:'unknown',values:{...rows[1].values,date:'bad',revenue:999}}],model),{columns:model.columns,table:{columnFilters:[{id:'revenue',value:{max:100}}]}});const {scope}=fixture();const result=resolveMemberScope(pool,scope,[selector('y','2025')]);expect(result).toMatchObject({ok:false,errors:[{code:'invalid-date'}]});});
