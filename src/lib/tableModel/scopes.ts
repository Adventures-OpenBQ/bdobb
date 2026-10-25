// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { ResolvedFiscalPeriod } from './fiscalContext';
import type { DatasetRow } from '../widgetData/types';
import type { EligiblePool } from './facets';
import type { MemberSelector, PageSelection, ModelError } from './types';
export type CompanyIds = ReadonlySet<string | number | boolean | null>;
export type ContextSlice = ReadonlyMap<string,string> | {categories: ReadonlyMap<string,string>; companyIds?: CompanyIds};
export const sliceCategories = (slice: ContextSlice): ReadonlyMap<string,string> => 'categories' in slice ? slice.categories : slice;
export type CalculationScope = {
  /** Explicit union of displayed-side identities; empty never means all records. */
  sourceRecordIds: ReadonlySet<string>;
  categoryConstraints: ReadonlyMap<string, string>;
  /** Surviving disjoint category contexts, supplied by the totals caller. */
  contextSlices?: readonly ContextSlice[];
  page?: PageSelection;
  /** Original requested evidence; member replacement must not shrink it to dependency survivors. */
  requestedFiscalScope?: { categoryId: string; dependentCategoryIds: readonly string[]; periods: readonly ResolvedFiscalPeriod[]; errors: readonly ModelError[] };
  /** Bound source context retained when a member changes line or fiscal period. */
  fieldConstraints?: ReadonlyMap<string, ReadonlySet<unknown>>;
  temporalContext: { dateFieldId?: string; companyFieldId?: string; companyIds?: ReadonlySet<string | number | boolean | null> };
};
export type ScopeResult = { ok: true; scope: CalculationScope } | { ok: false; errors: ModelError[] };
function constraints(scope: CalculationScope): {required: Map<string,ReadonlySet<string>>; companyIds?: CompanyIds}[] {
  return (scope.contextSlices ?? [new Map<string, string>()]).map(slice => {
    const result = new Map([...scope.categoryConstraints, ...sliceCategories(slice)].map(([id,key]) => [id,new Set([key]) as ReadonlySet<string>]));
    if (scope.page) result.set(scope.page.categoryId, new Set(scope.page.memberKeys));
    return {required:result,companyIds:'categories' in slice ? slice.companyIds ?? scope.temporalContext.companyIds : scope.temporalContext.companyIds};
  });
}
/** Unknown category values cannot prove that a failed record lies outside a scope. */
function matches(pool: EligiblePool, row: DatasetRow, required: ReadonlyMap<string, ReadonlySet<string>>, scope: CalculationScope, allowUnknown = false, sliceCompanies?: CompanyIds): boolean {
  if ([...required.values()].some(keys => !keys.size)) return false;
  for (const [categoryId, keys] of required) {
    const member = pool.members.get(row.id)?.get(categoryId);
    if (!member?.ok) { if (allowUnknown) continue; return false; }
    if (!keys.has(member.value.key)) return false;
  }
  for (const [field, values] of scope.fieldConstraints ?? []) {
    if (!Object.hasOwn(row.values, field)) { if (allowUnknown) continue; return false; }
    if (!values.has(row.values[field])) return false;
  }
  const { companyFieldId } = scope.temporalContext; const companyIds = sliceCompanies ?? scope.temporalContext.companyIds;
  if (companyIds) {
    if (!companyFieldId || !Object.hasOwn(row.values, companyFieldId) || pool.errors.get(row.id)?.has(companyFieldId)) return allowUnknown;
    if (!companyIds.has(row.values[companyFieldId] as string | number | boolean | null)) return false;
  }
  return true;
}
// Per-pool indexes: a scope visits only rows that can report an error, not every row (groups × rows was quadratic).
type PoolIndex = { diagnosticRows: Map<string, DatasetRow>; order: Map<DatasetRow, number>; unknownMember: Map<string, DatasetRow[]>; unknownCompany: Map<string, DatasetRow[]> };
const poolIndexes = new WeakMap<EligiblePool, PoolIndex>();
function poolIndex(pool: EligiblePool): PoolIndex {
  let index = poolIndexes.get(pool);
  if (!index) { index = { diagnosticRows: new Map(pool.universe.rows.map(row => [row.id, row])), order: new Map(pool.rows.map((row, i) => [row, i])), unknownMember: new Map(), unknownCompany: new Map() }; poolIndexes.set(pool, index); }
  return index;
}
const cached = (cache: Map<string, DatasetRow[]>, key: string, rows: () => DatasetRow[]) => { let value = cache.get(key); if (!value) { value = rows(); cache.set(key, value); } return value; };
/** Diagnostic universe only rules out irrelevant failures; it never supplies calculation values. */
export function scopeErrors(pool: EligiblePool, scope: CalculationScope): ModelError[] {
  if (scope.page && !scope.page.memberKeys.length) return [];
  const slices = constraints(scope);
  const index = poolIndex(pool);
  const couldAffect = (id: string) => {
    const row = index.diagnosticRows.get(id);
    return !row || slices.some(({required,companyIds}) => matches(pool, row, required, scope, true,companyIds));
  };
  const errors = pool.qualificationErrors.flatMap(error => {
    if (!error.recordIds?.length) return [error];
    const recordIds = error.recordIds.filter(couldAffect);
    return recordIds.length ? [{ ...error, recordIds }] : [];
  });
  const { companyFieldId, companyIds } = scope.temporalContext;
  // Only a row with an unknown required member or an unbound company can push an error below.
  const candidates = new Set<DatasetRow>();
  for (const categoryId of new Set(slices.flatMap(({required}) => [...required.keys()]))) for (const row of cached(index.unknownMember, categoryId, () => pool.rows.filter(row => !pool.members.get(row.id)?.get(categoryId)?.ok))) candidates.add(row);
  if (companyIds) for (const row of companyFieldId ? cached(index.unknownCompany, companyFieldId, () => pool.rows.filter(row => !Object.hasOwn(row.values, companyFieldId) || pool.errors.get(row.id)?.has(companyFieldId))) : pool.rows) candidates.add(row);
  for (const row of [...candidates].sort((a, b) => index.order.get(a)! - index.order.get(b)!)) if (couldAffect(row.id)) {
    for (const {required} of slices.filter(({required,companyIds}) => matches(pool, row, required, scope, true,companyIds))) for (const categoryId of required.keys()) {
      const member = pool.members.get(row.id)?.get(categoryId);
      if (!member?.ok) errors.push(member ? member.error : { code: 'missing-reference', message: 'Scope category is unavailable.', definitionId: categoryId, recordIds: [row.id] });
    }
    if (companyIds && (!companyFieldId || !Object.hasOwn(row.values, companyFieldId) || pool.errors.get(row.id)?.has(companyFieldId))) errors.push(pool.errors.get(row.id)?.get(companyFieldId ?? '') ?? { code: 'missing-input', message: 'Company scope binding is unavailable.', recordIds: [row.id] });
  }
  return [...new Map(errors.map(error => [JSON.stringify(error), error])).values()];
}
/** Authoritative evidence from eligible rows only; never a source for monetary facts. */
export function collectFiscalEvidence(pool: EligiblePool, ids: ReadonlySet<string>, categoryId: string) {
  const periods = new Map<string, ResolvedFiscalPeriod>();
  const errors: ModelError[] = [];
  for (const row of pool.rows) {
    if (!ids.has(row.id)) continue;
    const member = pool.members.get(row.id)?.get(categoryId);
    if (!member || !member.ok || !member.value.fiscal || member.value.fiscal.precision !== 'authoritative') {
      errors.push(member && !member.ok ? member.error : {
        code: 'fiscal-context', message: 'The requested fiscal scope requires authoritative period evidence.', recordIds: [row.id],
      });
      continue;
    }
    const period = member.value.fiscal;
    const key = JSON.stringify([period.companyKey, period.kind, period.year, period.quarter, period.start, period.end]);
    periods.set(key, period);
  }
  return { periods: [...periods.values()], errors };
}

/** Fiscal selection replaces its requested evidence without narrowing it to one line's facts. */
function replaceRequestedFiscalScope(pool: EligiblePool, scope: CalculationScope, selectors: MemberSelector[]): CalculationScope['requestedFiscalScope'] {
  const requested = scope.requestedFiscalScope;
  if (!requested || !selectors.some(selector => selector.categoryId === requested.categoryId)) return requested;
  const dependent = new Set(requested.dependentCategoryIds);
  const retain = (categories: ReadonlyMap<string, string>) => new Map([...categories].filter(([id]) => !dependent.has(id)));
  const evidenceScope: CalculationScope = {
    ...scope,
    categoryConstraints: retain(scope.categoryConstraints),
    contextSlices: scope.contextSlices?.map(slice => ({
      categories: retain(sliceCategories(slice)),
      ...('categories' in slice ? { companyIds: slice.companyIds } : {}),
    })),
    page: scope.page && dependent.has(scope.page.categoryId) ? undefined : scope.page,
  };
  const ids = new Set<string>();
  const errors = scopeErrors(pool, evidenceScope);
  for (const { required, companyIds } of constraints(evidenceScope)) {
    const rows = pool.rows.filter(row => matches(pool, row, required, evidenceScope, false, companyIds));
    rows.forEach(row => ids.add(row.id));
    if (!rows.length) errors.push({ code: 'missing-member', message: 'The requested fiscal member has no authoritative evidence in the retained source context.' });
  }
  const evidence = collectFiscalEvidence(pool, ids, requested.categoryId);
  return { ...requested, periods: evidence.periods, errors: [...errors, ...evidence.errors] };
}
export function resolveMemberScope(pool: EligiblePool, current: CalculationScope, selectors: MemberSelector[], declaredMembers?: readonly {selectors: MemberSelector[]; formulaId?:string}[]): ScopeResult {
  // Formula-backed declared members have no facts of their own. Resolve real
  // context anchors with the dependent categories removed, then replace those
  // categories for the shared evaluator; company/period/Page context survives.
  const declared=declaredMembers?.find(member=>member.formulaId && member.selectors.every(s=>selectors.some(other=>other.categoryId===s.categoryId&&other.memberKey===s.memberKey)));
  if(declared) {
    const replaced=new Set(declared.selectors.map(s=>s.categoryId));
    const retained=(map:ReadonlyMap<string,string>)=>new Map([...map].filter(([id])=>!replaced.has(id)));
    const anchor:CalculationScope={...current,categoryConstraints:retained(current.categoryConstraints),contextSlices:current.contextSlices?.map(slice=>({categories:retained(sliceCategories(slice)),...('categories' in slice?{companyIds:slice.companyIds}:{})})),page:current.page&&replaced.has(current.page.categoryId)?undefined:current.page};
    const resolved=resolveMemberScope(pool,anchor,selectors.filter(s=>!replaced.has(s.categoryId)));
    if(!resolved.ok)return resolved;
    const pairs=selectors.map(s=>[s.categoryId,s.memberKey] as const);
    return {ok:true,scope:{...resolved.scope,categoryConstraints:new Map([...resolved.scope.categoryConstraints,...pairs]),contextSlices:resolved.scope.contextSlices?.map(slice=>({categories:new Map([...sliceCategories(slice),...pairs]),...('categories' in slice?{companyIds:slice.companyIds}:{})}))}};
  }
  const slices = constraints(current);
  for (const selector of selectors) {
    if (!pool.categories.has(selector.categoryId)) return { ok: false, errors: [{ code: 'missing-reference', message: 'Member category is unavailable.', definitionId: selector.categoryId }] };
    slices.forEach(({required}) => required.set(selector.categoryId, new Set([selector.memberKey])));
  }
  const categoryConstraints = new Map(current.categoryConstraints);
  selectors.forEach(s => categoryConstraints.set(s.categoryId, s.memberKey));
  const replacement = current.page && selectors.find(s => s.categoryId === current.page!.categoryId);
  const page = replacement ? { categoryId: replacement.categoryId, memberKeys: [replacement.memberKey] } : current.page;
  const contextSlices = (current.contextSlices ?? [new Map<string,string>()]).map(slice => ({
    categories: new Map([...sliceCategories(slice), ...selectors.map(s => [s.categoryId,s.memberKey] as const)]),
    companyIds: 'categories' in slice ? slice.companyIds : undefined,
  }));
  const scope: CalculationScope = { ...current, categoryConstraints, contextSlices, page, sourceRecordIds: new Set() };
  if (!current.sourceRecordIds.size) return { ok: true, scope };
  scope.requestedFiscalScope = replaceRequestedFiscalScope(pool, scope, selectors);
  const errors = scopeErrors(pool, scope);
  for (const selector of selectors) if (!pool.observedMembers.get(selector.categoryId)?.has(selector.memberKey)) {
    for (const row of pool.universe.rows) { const member=pool.universe.members.get(row.id)?.get(selector.categoryId); if(member && !member.ok) errors.push(member.error); }
  }
  const ids = new Set<string>();
  for (const {required,companyIds} of slices) {
    const rows = pool.rows.filter(row => matches(pool, row, required, scope,false,companyIds));
    rows.forEach(row => ids.add(row.id));
    if (!rows.length && !errors.length) {
      const observed = pool.universe.rows.some(row => matches(pool, row, required, scope,false,companyIds));
      const eligible = selectors.every(selector => pool.eligibleMembers.get(selector.categoryId)?.has(selector.memberKey));
      const excluded = selectors.some(selector => pool.observedMembers.get(selector.categoryId)?.has(selector.memberKey) && !pool.eligibleMembers.get(selector.categoryId)?.has(selector.memberKey));
      errors.push({ code: observed || excluded ? 'excluded-member' : eligible ? 'no-counterpart' : 'missing-member', message: observed || excluded ? 'The requested member context is excluded by source constraints.' : eligible ? 'No counterpart records exist for this group in the retained company and category context.' : 'The requested member context is absent from acquired input.' });
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, scope: { ...scope, sourceRecordIds: ids } };
}
