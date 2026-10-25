// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { bucketKey, bucketLabel, detectPeriodicity, straddles, type Periodicity } from '../periodicity';
import { pivotValueKey } from '../pivotKeys';
import { categoryPivotConfig } from '../pivotConfig';
import type { PivotInput } from '../pivotTable';
import type { Bucket } from '../types';
import type { DatasetColumn, DatasetRow } from '../widgetData/types';
import { alignmentWarnings, fiscalContextRecipe, monthBounds, periodDate, resolveFiscalPeriod, type FiscalContext, type ResolvedFiscalPeriod } from './fiscalContext';
import type { CategoryDef, ModelError, ModelWarning, TableModelV1 } from './types';

export type CategoryMember = {
  categoryId: string; key: string; label: string; value: unknown;
  period?: { start: string; end: string };
  fiscal?: ResolvedFiscalPeriod;
};
export type CategoryMemberResult = { ok: true; value: CategoryMember } | { ok: false; error: ModelError };
export type CategoryMetadata = {
  id: string; name: string; sourceFieldId: string; transform: CategoryDef['transform'];
  /** Recipe, not stable ID/display label, must participate in downstream group compatibility. */
  recipe: string;
  bucket: Bucket;
  periodicity: Periodicity;
};
export type CategorizedRows = {
  rows: DatasetRow[];
  members: Map<string, Map<string, CategoryMemberResult>>;
  errors: Map<string, Map<string, ModelError>>;
  categories: Map<string, CategoryMetadata>;
  warnings: ModelWarning[];
};

/** Stable under rename/reorder. This is recipe metadata, not an identity-witness proof. */
export function categoryRecipe(definition: CategoryDef): string {
  const b = definition.fiscalBinding;
  return JSON.stringify([definition.sourceFieldId, definition.transform, definition.legacyBucket ?? null,
    b ? [b.companyFieldId, b.dateFieldId ?? definition.sourceFieldId, b.metadataKey ?? null, b.periodStartFieldId ?? null, b.periodEndFieldId ?? null, b.fiscalYearFieldId ?? null, b.fiscalQuarterFieldId ?? null, b.periodKind ?? null] : null]);
}
export function categoryBucket(definition: CategoryDef): Bucket {
  return definition.legacyBucket ?? (definition.transform === 'Y' ? 'year' : definition.transform === 'Q' ? 'quarter' : definition.transform === 'M' ? 'month' : 'native');
}
const read = (row: DatasetRow, field: string): unknown => Object.hasOwn(row.values, field) ? row.values[field] : undefined;

/** `columns` supply a declared display key (`metadata.cellField`, the hoverCard cellField) for object cells. */
export function deriveCategories(rows: DatasetRow[], definitions: CategoryDef[], fiscal: FiscalContext, columns: readonly DatasetColumn[] = []): CategorizedRows {
  const displayFields = new Map(columns.flatMap(c => typeof c.metadata?.cellField === 'string' ? [[c.id, c.metadata.cellField] as const] : []));
  const members: CategorizedRows['members'] = new Map();
  const errors: CategorizedRows['errors'] = new Map();
  const categories: CategorizedRows['categories'] = new Map();
  const warnings: ModelWarning[] = [];
  const fiscalPeriods = new Map<string, ResolvedFiscalPeriod[]>();
  const sourceFields = new Set(rows.flatMap(row => Object.keys(row.values)));
  const duplicateIds = new Set(definitions.filter((d, i) => definitions.findIndex(other => other.id === d.id) !== i).map(d => d.id));
  for (const definition of definitions) {
    const bucket = categoryBucket(definition);
    const periodicity = detectPeriodicity(rows.map(row => read(row, definition.sourceFieldId)));
    categories.set(definition.id, { id: definition.id, name: definition.name, sourceFieldId: definition.sourceFieldId, transform: definition.transform, recipe: definition.transform === 'FY' || definition.transform === 'FQ' ? JSON.stringify([categoryRecipe(definition), fiscalContextRecipe(definition.fiscalBinding, fiscal)]) : categoryRecipe(definition), bucket, periodicity });
    if (straddles(periodicity, bucket)) warnings.push({ code: 'approximate-period', categoryId: definition.id, message: 'Weekly observations assigned to calendar buckets may straddle period boundaries; summing them is approximate.' });
  }
  const output = rows.map(row => {
    const rowMembers = new Map<string, CategoryMemberResult>();
    members.set(row.id, rowMembers);
    const additions: [string, unknown][] = [];
    for (const definition of definitions) {
      const { id, sourceFieldId, transform } = definition;
      const fail = (code: ModelError['code'], message: string): CategoryMemberResult => ({ ok: false, error: { code, message, definitionId: id, recordIds: [row.id] } });
      const derive = (): CategoryMemberResult => {
        if (sourceFields.has(id) || duplicateIds.has(id)) return fail('missing-reference', 'A category ID collides with another category or an input field.');
        if (!Object.hasOwn(row.values, sourceFieldId)) return fail('missing-input', `Source field ${sourceFieldId} is unavailable.`);
        const cell = read(row, sourceFieldId);
        // A declared key wins; with none (a local file), an object's scalar
        // `value` is its display value, the reference Hover Card shape (user
        // ruling 2026-10-09). Any other undeclared object is refused below.
        const declared = displayFields.get(sourceFieldId);
        const valueKey = typeof cell === 'object' && cell !== null && Object.hasOwn(cell, 'value') && ['string', 'number', 'boolean', 'bigint'].includes(typeof (cell as Record<string, unknown>).value) ? 'value' : undefined;
        const cellField = declared ?? valueKey;
        const source = cellField !== undefined && typeof cell === 'object' && cell !== null ? (Object.hasOwn(cell, cellField) ? (cell as Record<string, unknown>)[cellField] : undefined) : cell;
        if (typeof source === 'number' && !Number.isFinite(source)) return fail('nonfinite', 'A category member must be finite.');
        if (source !== null && source !== undefined && !['string', 'number', 'boolean', 'bigint'].includes(typeof source)) return fail('missing-input', declared === undefined
          ? `A category member must be a scalar value; ${sourceFieldId} holds objects and declares no display field.`
          : `A category member must be a scalar value; display field ${cellField} of ${sourceFieldId} is not one.`);
        let value = source;
        let label = source === null || source === undefined || source === '' ? '(blank)' : String(source);
        let period: CategoryMember['period'];
        let resolved: ResolvedFiscalPeriod | undefined;
        if (transform === 'FY' || transform === 'FQ') {
          const binding = definition.fiscalBinding;
          if (!binding || (binding.dateFieldId !== undefined && binding.dateFieldId !== sourceFieldId)) return fail('fiscal-context', 'Bind the category report date and company explicitly; conflicting date mappings cannot be applied.');
          const result = resolveFiscalPeriod(row, { ...binding, dateFieldId: sourceFieldId }, fiscal);
          const selected = transform === 'FY' ? result.year : result.quarter;
          if (!selected.ok) return { ok: false, error: { ...selected.error, definitionId: id } };
          resolved = selected.value;
          value = resolved.key; label = resolved.label; period = { start: resolved.start, end: resolved.end };
        } else if (transform !== 'native' || definition.legacyBucket) {
          if (source === null || source === undefined || source === '') value = null;
          else {
            const date = periodDate(source);
            if (!date) return fail('invalid-date', `Source field ${sourceFieldId} is not a valid period date.`);
            const bucket = categoryBucket(definition);
            value = bucketKey(date, bucket);
            label = bucketLabel(String(value), bucket);
            const year = Number(date.slice(0, 4));
            const month = Number(date.slice(5, 7));
            if (bucket === 'year') period = monthBounds(year, 1, 12);
            else if (bucket === 'quarter') period = monthBounds(year, Math.floor((month - 1) / 3) * 3 + 1, 3);
            else if (bucket === 'month') period = monthBounds(year, month, 1);
            else if (bucket === 'week') {
              const monday = new Date(`${date}T00:00:00Z`);
              monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
              const start = monday.toISOString().slice(0, 10);
              monday.setUTCDate(monday.getUTCDate() + 6);
              period = { start, end: monday.toISOString().slice(0, 10) };
            }
          }
        }
        return { ok: true, value: { categoryId: id, key: pivotValueKey(value), value, label, ...(period ? { period } : {}), ...(resolved ? { fiscal: resolved } : {}) } };
      };
      const member = derive();
      rowMembers.set(id, member);
      if (member.ok) {
        additions.push([id, member.value.value]);
        if (member.value.fiscal) {
          const periods = fiscalPeriods.get(id) ?? [];
          periods.push(member.value.fiscal); fiscalPeriods.set(id, periods);
        }
      } else {
        const rowErrors = errors.get(row.id) ?? new Map<string, ModelError>();
        rowErrors.set(id, member.error); errors.set(row.id, rowErrors);
      }
    }
    return { ...row, values: Object.fromEntries([...Object.entries(row.values), ...additions]) };
  });
  for (const [categoryId, periods] of fiscalPeriods) warnings.push(...alignmentWarnings(periods).map(warning => ({ ...warning, categoryId })));
  return { rows: output, members, errors, categories, warnings };
}

/** Pure seam for the worker compiler. Failed grouping values must not become blank aggregates. */
export function prepareCategoryPivot(
  source: Omit<PivotInput, 'rows' | 'config'>,
  derived: CategorizedRows,
  model: Pick<TableModelV1, 'layout' | 'measures'>,
): { ok: true; input: PivotInput } | { ok: false; errors: ModelError[] } {
  const active = new Set([...model.layout.rows, ...model.layout.columns]);
  const errors = [...derived.errors.values()].flatMap(row => [...row].filter(([id]) => active.has(id)).map(([, error]) => error));
  for (const id of active) {
    if (!derived.categories.has(id)) errors.push({ code: 'missing-reference', message: `Category ${id} is unavailable.`, definitionId: id });
    if (source.columns.some(c => c.field === id)) errors.push({ code: 'missing-reference', message: `Category ${id} collides with an input field.`, definitionId: id });
  }
  if (errors.length) return { ok: false, errors };
  const synthetic = [...derived.categories.values()].filter(c => !source.columns.some(column => column.field === c.id)).map(c => ({ field: c.id, header: c.name, renderFn: [], colorRules: [], hiddenByDefault: false }));
  return { ok: true, input: { ...source, rows: derived.rows.map(row => row.values), columns: [...source.columns, ...synthetic],
    kinds: new Map([...source.kinds, ...synthetic.map(c => [c.field, 'text'] as const)]),
    config: categoryPivotConfig(model), categoryMetadata: derived.categories } };
}
