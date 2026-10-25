// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { createTable, getCoreRowModel, getFilteredRowModel, type ColumnDef } from '@tanstack/react-table';
import { accessorFor, filterFnFor, filterKindFor } from '../tableFiltering';
import type { TableColumn } from '../tableColumns';
import type { TableCardState } from '../types';
import type { DatasetColumn, DatasetRow } from '../widgetData/types';
import type { CategorizedRows, CategoryMember } from './categories';
import { uniqueSourceRows, type EvaluatedRows } from './formulaEvaluation';
import type { ChecklistConstraint, ModelError, PageSelection } from './types';

export type SourceConstraints = {
  columns: readonly DatasetColumn[];
  table?: TableCardState;
  search?: string;
  checklists?: readonly ChecklistConstraint[];
};
export type MemberFacet = CategoryMember & { count: number };
export type Exclusion = { kind: 'column-filter' | 'search' | 'checklist'; definitionId?: string } | { kind: 'error'; error: ModelError };
export type EligiblePool = EvaluatedRows & {
  universe: EvaluatedRows;
  constraints: SourceConstraints;
  excludedRecordIds: Set<string>;
  exclusions: Map<string, Exclusion[]>;
  observedMembers: Map<string, Map<string, MemberFacet>>;
  eligibleMembers: Map<string, Map<string, MemberFacet>>;
  /** False means constraint evaluation failed; consumers must not publish partial complete totals. */
  classificationComplete: boolean;
  qualificationErrors: ModelError[];
};
export type PageResult = { rows: DatasetRow[]; selection?: PageSelection; errors: ModelError[]; classificationComplete: boolean };

function qualify(input: CategorizedRows, constraints: SourceConstraints, excludingCategoryId?: string) {
  const rows = uniqueSourceRows(input.rows);
  const columns: TableColumn[] = constraints.columns.map(c => ({ field: c.id, header: c.label, cellDataType: c.dtype, format: c.format, renderFn: [], colorRules: [], hiddenByDefault: false }));
  const values = rows.map(r => r.values);
  const kinds = new Map(columns.map(c => [c.field, filterKindFor(c, values)]));
  // Match the filter controls' removal semantics before qualifying failed cells.
  const filters = (constraints.table?.columnFilters ?? []).filter(filter => {
    if (filter.value === undefined || filter.value === '') return false;
    const value = filter.value;
    if (value && typeof value === 'object') {
      const range = value as Record<string, unknown>;
      if (kinds.get(filter.id) === 'number') return range.min !== undefined || range.max !== undefined;
      if (kinds.get(filter.id) === 'date') return Boolean(range.from || range.to);
    }
    return true;
  });
  const exclusions = new Map<string, Exclusion[]>();
  const errors: ModelError[] = [];
  const exclude = (row: DatasetRow, reason: Exclusion) => { exclusions.set(row.id, [...(exclusions.get(row.id) ?? []), reason]); if (reason.kind === 'error') errors.push(reason.error); };
  for (const filter of filters) {
    if (!columns.some(c => c.field === filter.id)) {
      const error: ModelError = { code: 'missing-reference', message: `Filtered field ${filter.id} is unavailable.`, definitionId: filter.id };
      errors.push(error); rows.forEach(row => exclude(row, { kind: 'error', error: { ...error, recordIds: [row.id] } }));
    }
  }
  const defs: ColumnDef<DatasetRow>[] = columns.map(c => ({ id: c.field, accessorFn: row => accessorFor(c)(row.values), filterFn: filterFnFor(kinds.get(c.field) ?? 'none') as ColumnDef<DatasetRow>['filterFn'] }));
  const table = createTable<DatasetRow>({ data: rows, columns: defs, state: { columnFilters: filters.filter(f => columns.some(c => c.field === f.id) && kinds.get(f.id) !== 'none') }, onStateChange: () => {}, renderFallbackValue: undefined, getCoreRowModel: getCoreRowModel(), getFilteredRowModel: getFilteredRowModel() });
  const matching = new Set(table.getFilteredRowModel().rows.map(r => r.original.id));
  const search = constraints.search?.toLowerCase();
  for (const row of rows) {
    for (const filter of filters) {
      const error = input.errors.get(row.id)?.get(filter.id);
      if (error) exclude(row, { kind: 'error', error });
    }
    if (!matching.has(row.id)) exclude(row, { kind: 'column-filter' });
    if (search && !columns.some(c => String(accessorFor(c)(row.values) ?? '').toLowerCase().includes(search))) {
      const failed = columns.flatMap(c => { const error = input.errors.get(row.id)?.get(c.field); return error ? [error] : []; });
      if (failed.length) failed.forEach(error => exclude(row, { kind: 'error', error }));
      else exclude(row, { kind: 'search' });
    }
    for (const checklist of constraints.checklists ?? []) {
      if (checklist.categoryId === excludingCategoryId) continue;
      const member = input.members.get(row.id)?.get(checklist.categoryId);
      if (!member || !member.ok) exclude(row, { kind: 'error', error: member && !member.ok ? member.error : { code: 'missing-reference', message: `Category ${checklist.categoryId} is unavailable.`, definitionId: checklist.categoryId, recordIds: [row.id] } });
      else if (!checklist.memberKeys.includes(member.value.key)) exclude(row, { kind: 'checklist', definitionId: checklist.categoryId });
    }
  }
  return { rows: rows.filter(row => !exclusions.has(row.id)), exclusions, errors };
}
function membersFor(input: CategorizedRows, rows: DatasetRow[]): Map<string, Map<string, MemberFacet>> {
  const result = new Map<string, Map<string, MemberFacet>>();
  for (const row of rows) for (const [categoryId, member] of input.members.get(row.id) ?? []) {
    if (!member.ok) continue;
    const category = result.get(categoryId) ?? new Map<string, MemberFacet>(); result.set(categoryId, category);
    const previous = category.get(member.value.key);
    category.set(member.value.key, { ...member.value, count: (previous?.count ?? 0) + 1 });
  }
  return result;
}
/** Counts exclude only this category's checklist, never source predicates or other checklists. */
export function categoryFacets(input: CategorizedRows, constraints: SourceConstraints, excludingCategoryId: string): MemberFacet[] {
  const qualified = qualify(input, constraints, excludingCategoryId);
  return [...(membersFor(input, qualified.rows).get(excludingCategoryId)?.values() ?? [])];
}
export function eligiblePool(input: EvaluatedRows, constraints: SourceConstraints): EligiblePool {
  const qualified = qualify(input, constraints);
  return { ...input, rows: qualified.rows, universe: input, constraints, exclusions: qualified.exclusions, excludedRecordIds: new Set(qualified.exclusions.keys()), observedMembers: membersFor(input, uniqueSourceRows(input.rows)), eligibleMembers: membersFor(input, qualified.rows), qualificationErrors: qualified.errors, classificationComplete: qualified.errors.length === 0 };
}
export function activePage(pool: EligiblePool, selection?: PageSelection): PageResult {
  if (!selection) return { rows: pool.rows, errors: [], classificationComplete: pool.classificationComplete };
  const acquiredCategoryErrors = pool.universe.rows.flatMap(row => { const member = pool.universe.members.get(row.id)?.get(selection.categoryId); return member && !member.ok ? [member.error] : []; });
  const membershipComplete = pool.universe.rows.every(row => pool.universe.members.get(row.id)?.get(selection.categoryId)?.ok === true);
  const base = { selection, rows: [] as DatasetRow[], classificationComplete: pool.classificationComplete && membershipComplete };
  if (!selection.memberKeys.length) return { ...base, classificationComplete: pool.classificationComplete, errors: [] };
  const categoryErrors = [...pool.qualificationErrors.filter(error => error.definitionId === selection.categoryId), ...pool.rows.flatMap(row => { const result = pool.members.get(row.id)?.get(selection.categoryId); return result && !result.ok ? [result.error] : []; })];
  if (categoryErrors.length) return { ...base, errors: categoryErrors, classificationComplete: false };
  if (!pool.categories.has(selection.categoryId)) return { ...base, errors: [{ code: 'missing-reference', message: 'Page category is unavailable.', definitionId: selection.categoryId }] };
  const keys = new Set(selection.memberKeys);
  const errors: ModelError[] = [];
  for (const key of keys) if (!pool.eligibleMembers.get(selection.categoryId)?.has(key)) {
    const excluded = pool.observedMembers.get(selection.categoryId)?.has(key);
    if (!excluded && !membershipComplete) { errors.push(...acquiredCategoryErrors); continue; }
    errors.push({ code: excluded ? 'excluded-member' : 'missing-member', message: excluded ? 'The selected Page member is excluded by source constraints.' : 'The selected Page member is absent from acquired input.', definitionId: selection.categoryId });
  }
  return { ...base, rows: pool.rows.filter(row => { const member = pool.members.get(row.id)?.get(selection.categoryId); return member?.ok && keys.has(member.value.key); }), errors: [...new Map(errors.map(error => [JSON.stringify(error),error])).values()] };
}
