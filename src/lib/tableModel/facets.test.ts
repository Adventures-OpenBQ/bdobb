// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { evaluateSourceFormulas } from './formulaEvaluation';
import { activePage, categoryFacets, eligiblePool } from './facets';
import { pivotValueKey as key } from '../pivotKeys';
import { context, profit } from './evaluationTestHelpers';
const categories = ['scenario', 'region'].map(id => ({ id: `${id}Cat`, name: id, sourceFieldId: id, transform: 'native' as const }));
const rows = [
  { id: 'a', values: { scenario: 'Actual', region: 'US', revenue: 10, cost: 4 } },
  { id: 'b', values: { scenario: 'Budget', region: 'US', revenue: 20, cost: 2 } },
  { id: 'c', values: { scenario: 'Budget', region: 'EU', revenue: 3, cost: 2 } },
];
describe('source eligibility and facets', () => {
  it('filters computed Profit before checklists and counts under other constraints', () => {
    const input = evaluateSourceFormulas(rows, context([profit], categories));
    const constraints = { columns: input.columns, table: { columnFilters: [{ id: 'profit', value: { min: 5 } }] }, checklists: [{ categoryId: 'scenarioCat', memberKeys: [key('Actual')] }] };
    expect(eligiblePool(input, constraints).rows.map(r => r.id)).toEqual(['a']);
    expect(categoryFacets(input, constraints, 'scenarioCat').map(f => [f.label, f.count])).toEqual([['Actual', 1], ['Budget', 1]]);
  });
  it('retains page intent and distinguishes excluded from absent without fallback', () => {
    const input = evaluateSourceFormulas(rows, context([], categories));
    const pool = eligiblePool(input, { columns: input.columns, checklists: [{ categoryId: 'scenarioCat', memberKeys: [key('Actual')] }] });
    for (const [member, code] of [['Budget', 'excluded-member'], ['Forecast', 'missing-member']]) {
      const selection = { categoryId: 'scenarioCat', memberKeys: [key(member)] };
      expect(activePage(pool, selection)).toMatchObject({ rows: [], selection, errors: [expect.objectContaining({ code })] });
    }
    expect(pool.rows.map(r => r.id)).toEqual(['a']);
    expect(pool.excludedRecordIds).toEqual(new Set(['b', 'c']));
  });
  it('keeps typed duplicate labels and explicit blanks distinct', () => {
    const input = evaluateSourceFormulas([1, '1', null].map((scenario, i) => ({ id: String(i), values: { scenario } })), context([], categories.slice(0, 1)));
    const facets = categoryFacets(input, { columns: input.columns }, 'scenarioCat');
    expect(facets.map(f => f.key)).toEqual([key(1), key('1'), key(null)]);
    expect(facets.map(f => f.label)).toEqual(['1', '1', '(blank)']);
  });
  it('marks failed filter qualification incomplete but leaves unrelated errors usable', () => {
    const input = evaluateSourceFormulas([{ id: 'bad', values: { revenue: null, cost: 1, scenario: 'Actual' } }, ...rows], context([profit], categories));
    const unfiltered = eligiblePool(input, { columns: input.columns });
    expect(unfiltered.rows).toHaveLength(4);
    const filtered = eligiblePool(input, { columns: input.columns, table: { columnFilters: [{ id: 'profit', value: { min: 0 } }] } });
    expect(filtered.classificationComplete).toBe(false);
    expect(filtered.exclusions.get('bad')).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'error', error: expect.objectContaining({ definitionId: 'profit' }) })]));
  });
});

it('keeps malformed category dates inspectable through checklist and page qualification', () => {
  const input = evaluateSourceFormulas([{ id: 'a', values: { date: '2026-02-30' } }], context([], [{ id: 'year', name: 'Year', sourceFieldId: 'date', transform: 'Y' }]));
  const selection = { categoryId: 'year', memberKeys: [key('2026')] };
  const pool = eligiblePool(input, { columns: input.columns, checklists: [{ categoryId: 'year', memberKeys: selection.memberKeys }] });
  expect(pool.classificationComplete).toBe(false);
  expect(activePage(pool, selection)).toMatchObject({ rows: [], selection, errors: [expect.objectContaining({ code: 'invalid-date' })] });
});
it('honors search and other category checklists when excluding its own checklist', () => {
  const input = evaluateSourceFormulas(rows, context([], categories));
  const constraints = { columns: input.columns, search: 'US', checklists: [{ categoryId: 'regionCat', memberKeys: [key('US')] }, { categoryId: 'scenarioCat', memberKeys: [key('Actual')] }] };
  expect(categoryFacets(input, constraints, 'scenarioCat').map(f => f.count)).toEqual([1, 1]);
  expect(categoryFacets(input, constraints, 'regionCat').map(f => f.label)).toEqual(['US']);
});
it('preserves year-qualified quarter members and source fields for later comparison contexts', () => {
  const temporal = [{ id: 'year', name: 'Year', sourceFieldId: 'date', transform: 'Y' as const }, { id: 'quarter', name: 'Quarter', sourceFieldId: 'date', transform: 'Q' as const }];
  const input = evaluateSourceFormulas(['2025-03-01', '2026-03-01'].map((date, i) => ({ id: String(i), values: { date } })), context([], temporal));
  const pool = eligiblePool(input, { columns: input.columns });
  expect([...pool.observedMembers.get('quarter')!.keys()]).toEqual([key('2025-Q1'), key('2026-Q1')]);
  expect(pool.categories.get('quarter')?.sourceFieldId).toBe('date');
  expect(activePage(pool, { categoryId: 'year', memberKeys: [key('2026')] }).rows.map(r => r.id)).toEqual(['1']);
  expect(pool.rows).toHaveLength(2);
});
it('retains fiscal alignment warnings and explicit failed categories without native fallback', () => {
  const model = context([], [{ id: 'fy', name: 'FY', sourceFieldId: 'date', transform: 'FY', fiscalBinding: { companyFieldId: 'company' } }]);
  const input = evaluateSourceFormulas([{ id: 'a', values: { date: '2026-01-01', company: 'A' } }, { id: 'b', values: { date: '2026-01-01', company: 'B' } }], { ...model, fiscal: { companies: { A: { yearEndMonth: 9, source: 'metadata' }, B: { yearEndMonth: 12, source: 'metadata' } } } });
  expect(eligiblePool(input, { columns: input.columns }).warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'fiscal-alignment' })]));
});
it('search succeeds on a known match despite a failed formula and marks uncertain nonmatches incomplete', () => {
  const input = evaluateSourceFormulas([{ id: 'a', values: { revenue: null, cost: 1, scenario: 'Actual' } }], context([profit]));
  expect(eligiblePool(input, { columns: input.columns, search: 'actual' })).toMatchObject({ classificationComplete: true, rows: [expect.objectContaining({ id: 'a' })] });
  expect(eligiblePool(input, { columns: input.columns, search: 'unknown' })).toMatchObject({ classificationComplete: false, rows: [] });
});
it.each([undefined, '', {}, { min: undefined, max: undefined }])('ignores inactive empty numeric filter %s on a failed formula', value => {
  const input = evaluateSourceFormulas([{ id: 'a', values: { revenue: null, cost: 1 } }], context([profit]));
  const columns = input.columns.map(c => c.id === 'profit' ? { ...c, dtype: 'number' as const } : c);
  expect(eligiblePool(input, { columns, table: { columnFilters: [{ id: 'profit', value }] } })).toMatchObject({ classificationComplete: true, rows: [expect.objectContaining({ id: 'a' })] });
});
