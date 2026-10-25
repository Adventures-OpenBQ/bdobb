// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord as object } from '../isRecord';
import { validateFormulaAst } from './formulaSyntax';
import { AGG_NAMES, BUCKETS, type PivotMeasure } from '../types';
import type { CategoryDef, FormulaAst, FormulaDef, ModelDiagnostic, ModelValidation, TableModelV1, ValidatedEntry } from './types';

type ObjectValue = Record<string, unknown>;
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(id);
const oneOf = (v: unknown, choices: readonly string[]) => typeof v === 'string' && choices.includes(v);
const scalar = (v: unknown) => v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

/** Inspect descriptors before values: accessors, cycles and huge/deep graphs are refused. */
export function boundedPlainData(raw: unknown): boolean {
  let remaining = 50_000;
  const ancestors = new Set<object>();
  const visit = (value: unknown, depth: number): boolean => {
    if (--remaining < 0 || depth > 256) return false;
    if (value === undefined || scalar(value)) return typeof value !== 'string' || value.length <= 1_000_000;
    if (typeof value !== 'object' || value === null || ancestors.has(value)) return false;
    const proto = Object.getPrototypeOf(value);
    if (Array.isArray(value) ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) return false;
    ancestors.add(value);
    const keys = Reflect.ownKeys(value);
    if (keys.length > remaining) return false;
    // Dense arrays only: a huge sparse length must not drive unbounded later loops.
    if (Array.isArray(value)) {
      if (value.length > remaining || keys.length !== value.length + 1) return false;
      for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i)) return false;
    }
    for (const key of keys) {
      if (typeof key !== 'string') return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!('value' in descriptor) || !visit(descriptor.value, depth + 1)) return false;
    }
    ancestors.delete(value);
    return true;
  };
  try { return visit(raw, 0); } catch { return false; }
}

function category(value: unknown): value is CategoryDef {
  if (!object(value) || !id(value.id) || !id(value.name) || !id(value.sourceFieldId) || !oneOf(value.transform, ['native', 'Y', 'Q', 'M', 'FY', 'FQ'])) return false;
  if (value.legacyBucket !== undefined && (value.transform !== 'native' || !oneOf(value.legacyBucket, ['week', 'month']))) return false;
  if (value.fiscalBinding === undefined) return true; // Missing context becomes a typed calculation error in Task 2.
  const binding = value.fiscalBinding;
  return object(binding) && id(binding.companyFieldId) && (binding.periodKind === undefined || oneOf(binding.periodKind, ['FY', 'FQ'])) && ['dateFieldId', 'metadataKey', 'periodStartFieldId', 'periodEndFieldId', 'fiscalYearFieldId', 'fiscalQuarterFieldId'].every(key => binding[key] === undefined || id(binding[key]));
}
function measure(value: unknown): value is PivotMeasure {
  return object(value) && id(value.id) && id(value.sourceFieldId) && (value.aggregation === undefined || oneOf(value.aggregation, AGG_NAMES)) && (value.customLabel === undefined || typeof value.customLabel === 'string');
}
function formula(value: unknown): value is FormulaDef {
  return object(value) && id(value.id) && id(value.name) && oneOf(value.scope, ['source', 'aggregate']) && typeof value.expression === 'string' && (value.format === undefined || typeof value.format === 'string');
}

/** Structural/reference checks only. No parsing, evaluation, scope inference or identity proof. */
export function validateTableModel(raw: unknown): ModelValidation {
  const result: ModelValidation = { raw, diagnostics: [], categories: [], measures: [], formulas: [] };
  const issue = (path: string, message: string, code: ModelDiagnostic['code'] = 'invalid-structure', extra: Partial<ModelDiagnostic> = {}) => {
    const diagnostic: ModelDiagnostic = { code, severity: 'error', path, message, ...extra };
    result.diagnostics.push(diagnostic);
    return diagnostic;
  };
  if (!boundedPlainData(raw)) { issue('', 'Model must be bounded plain data without accessors or cycles.'); return result; }
  if (!object(raw)) { issue('', 'Expected a model object.'); return result; }
  if (raw.schemaVersion !== 1) { issue('schemaVersion', 'Unsupported model schema; original data retained.', 'unsupported-schema'); return result; }

  function entries<T>(key: string, accepts: (v: unknown) => v is T): ValidatedEntry<T>[] {
    const input = raw as ObjectValue;
    const list = input[key];
    if (!Array.isArray(list)) { issue(key, 'Expected an ordered definition array.'); return []; }
    const counts = new Map<string, number>();
    for (const value of list) if (object(value) && id(value.id)) counts.set(value.id, (counts.get(value.id) ?? 0) + 1);
    return list.map((value, index) => {
      const entry: ValidatedEntry<T> = { index, raw: value, diagnostics: [] };
      const definitionId = object(value) && id(value.id) ? value.id : undefined;
      if (!accepts(value)) entry.diagnostics.push(issue(`${key}.${index}`, 'Invalid definition structure; original entry retained.', 'invalid-structure', { definitionId }));
      else entry.value = value;
      if (key === 'formulas' && entry.value && object(value)) {
        const checked = validateFormulaAst(value.ast);
        const formulaDiagnostics = [...checked.diagnostics];
        if (new TextEncoder().encode(value.expression as string).length > 16384) formulaDiagnostics.push({ code: 'expression-limit', message: 'Formula exceeds the 16 KiB UTF-8 expression limit.' });
        for (const diagnostic of formulaDiagnostics) entry.diagnostics.push(issue(`${key}.${index}.ast`, diagnostic.message, diagnostic.code as ModelDiagnostic['code'], { definitionId }));
        if (formulaDiagnostics.length) delete entry.value;
      }
      if (definitionId && counts.get(definitionId)! > 1) {
        entry.diagnostics.push(issue(`${key}.${index}.id`, 'Definition ID is ambiguous.', 'duplicate-id', { definitionId }));
        delete entry.value;
      }
      return entry;
    });
  }
  result.categories = entries('categories', category);
  result.measures = entries('measures', measure);
  result.formulas = entries('formulas', formula);
  const ids = {
    category: new Set(result.categories.flatMap(e => e.value ? [e.value.id] : [])),
    measure: new Set(result.measures.flatMap(e => e.value ? [e.value.id] : [])),
    formula: new Set(result.formulas.flatMap(e => e.value ? [e.value.id] : [])),
  };
  function reference(kind: keyof typeof ids, value: unknown, path: string, definitionId?: string): ModelDiagnostic | undefined {
    if (!id(value) || !ids[kind].has(value)) return issue(path, 'Referenced definition is missing or invalid.', 'missing-reference', { definitionId, dependencyId: typeof value === 'string' ? value : undefined });
  }
  for (const entry of result.categories) {
    if (entry.value?.legacyBucket) entry.diagnostics.push(issue(`categories.${entry.index}.legacyBucket`, 'Retained maintained legacy bucket recipe.', 'legacy-bucket', { severity: 'warning', definitionId: entry.value.id }));
  }
  function references(node: FormulaAst, path: string, entry: ValidatedEntry<FormulaDef>) {
    const check = (kind: keyof typeof ids, value: string, subpath: string) => {
      const diagnostic = reference(kind, value, subpath, entry.value?.id);
      if (diagnostic) entry.diagnostics.push(diagnostic);
    };
    switch (node.kind) {
      case 'reference': if (node.target !== 'field') check(node.target, node.id, path); break;
      case 'unary': references(node.operand, `${path}.operand`, entry); break;
      case 'binary': references(node.left, `${path}.left`, entry); references(node.right, `${path}.right`, entry); break;
      case 'call': node.args.forEach((arg, i) => references(arg, `${path}.args.${i}`, entry)); break;
      case 'member':
        references(node.value, `${path}.value`, entry);
        node.selectors.forEach((s, i) => check('category', s.categoryId, `${path}.selectors.${i}`));
        if (new Set(node.selectors.map(s => s.categoryId)).size !== node.selectors.length) entry.diagnostics.push(issue(path, 'Member selectors must name each category at most once.', 'invalid-structure', { definitionId: entry.value?.id }));
    }
  }
  for (const entry of result.formulas) if (entry.value) references(entry.value.ast, `formulas.${entry.index}.ast`, entry);

  const params = raw.params;
  const boundedText = (value: unknown, empty = false) => typeof value === 'string' && (empty || value.trim().length > 0) && new TextEncoder().encode(value).length <= 256;
  if (!object(params) || typeof params.promotePage !== 'boolean' || !Array.isArray(params.filters) || params.filters.length > 64) issue('params', 'Expected explicit Page promotion and at most 64 promoted filters.');
  else {
    const paramIds = new Set<string>(); const categories = new Set<string>();
    params.filters.forEach((value, index) => {
      const path = `params.filters.${index}`;
      if (!object(value) || !boundedText(value.id) || !boundedText(value.categoryId) || !boundedText(value.label) || typeof value.multiSelect !== 'boolean') { issue(path, 'Invalid promoted filter metadata; IDs and labels must fit 256 UTF-8 bytes.'); return; }
      const paramId = value.id as string; const categoryId = value.categoryId as string;
      if (paramIds.has(paramId) || categories.has(categoryId)) issue(path, 'Duplicate promoted filter ID or category.', 'duplicate-id', { definitionId: paramId });
      paramIds.add(paramId); categories.add(categoryId);
      reference('category', categoryId, `${path}.categoryId`, paramId);
    });
  }
  if (typeof raw.enabled !== 'boolean') issue('enabled', 'Expected explicit pivot enabled boolean.');
  const layout = raw.layout;
  if (!object(layout)) issue('layout', 'Expected layout object.');
  else {
    if (!strings(layout.values)) issue('layout.values', 'Expected ordered Data value ID list.');
    else {
      const aggregateIds = new Set(result.formulas.flatMap(e => e.value?.scope === 'aggregate' ? [e.value.id] : []));
      const seen = new Set<string>();
      layout.values.forEach((value, index) => {
        const path = `layout.values.${index}`;
        if (!ids.measure.has(value) && !aggregateIds.has(value)) issue(path, 'Data value must reference a valid measure or aggregate formula.', 'missing-reference', { dependencyId: value });
        if (seen.has(value)) issue(path, 'Duplicate Data value ID.', 'duplicate-id', { definitionId: value });
        seen.add(value);
      });
    }
    const assigned: string[] = [];
    for (const axis of ['rows', 'columns']) {
      if (!strings(layout[axis])) issue(`layout.${axis}`, 'Expected category ID list.');
      else for (const value of layout[axis]) { assigned.push(value); reference('category', value, `layout.${axis}`); }
    }
    if (Object.hasOwn(layout, 'pages')) issue('layout.pages', 'Only one Page category is supported.');
    if (layout.page !== undefined) {
      if (!object(layout.page) || !id(layout.page.categoryId) || !strings(layout.page.memberKeys) || new Set(layout.page.memberKeys).size !== layout.page.memberKeys.length || Object.keys(layout.page).some(key => !['categoryId', 'memberKeys'].includes(key))) issue('layout.page', 'Expected one Page category and a unique member-key array.');
      else { const page = layout.page as { categoryId: string }; assigned.push(page.categoryId); reference('category', page.categoryId, 'layout.page.categoryId'); }
    }
    if (new Set(assigned).size !== assigned.length) issue('layout', 'A category can occupy only one layout position.');
  }
  if (!Array.isArray(raw.checklists)) issue('checklists', 'Expected checklist array.');
  else {
    const seen = new Set<string>();
    raw.checklists.forEach((value, i) => {
      const path = `checklists.${i}`;
      if (!object(value) || !id(value.categoryId) || !strings(value.memberKeys)) { issue(path, 'Invalid checklist.'); return; }
      reference('category', value.categoryId, `${path}.categoryId`);
      if (seen.has(value.categoryId) || new Set(value.memberKeys).size !== value.memberKeys.length) issue(path, 'Duplicate checklist category or member.');
      seen.add(value.categoryId);
    });
  }
  if (!Array.isArray(raw.resultFilters)) issue('resultFilters', 'Expected result filter array.');
  else {
    const seen = new Set<string>();
    raw.resultFilters.forEach((value, i) => {
      const path = `resultFilters.${i}`;
      if (!object(value) || !id(value.id) || !id(value.categoryId) || !object(value.target) || !oneOf(value.target.kind, ['measure', 'formula']) || !id(value.target.id) || !oneOf(value.predicate, ['eq', 'ne', 'gt', 'gte', 'lt', 'lte']) || !scalar(value.value)) { issue(path, 'Invalid result filter.'); return; }
      if (seen.has(value.id)) issue(`${path}.id`, 'Duplicate result filter ID.', 'duplicate-id', { definitionId: value.id });
      seen.add(value.id);
      reference('category', value.categoryId, `${path}.categoryId`, value.id);
      reference(value.target.kind as 'measure' | 'formula', value.target.id, `${path}.target`, value.id);
    });
  }
  if (!object(raw.subtotals) || typeof raw.subtotals.grandTotal !== 'boolean' || typeof raw.subtotals.groups !== 'boolean') issue('subtotals', 'Expected explicit total display booleans.');
  if (raw.legacyPivot !== undefined) {
    const legacy = raw.legacyPivot;
    const booleanMap = (value: unknown) => object(value) && Object.values(value).every(v => typeof v === 'boolean');
    if (!object(legacy) || typeof legacy.enabled !== 'boolean' || !strings(legacy.grouping) || !strings(legacy.split)
      || (legacy.measures !== undefined && (!Array.isArray(legacy.measures) || !legacy.measures.every(measure)))
      || (legacy.aggregationFns !== undefined && (!object(legacy.aggregationFns) || !Object.values(legacy.aggregationFns).every(v => oneOf(v, AGG_NAMES))))
      || (legacy.buckets !== undefined && (!object(legacy.buckets) || !Object.values(legacy.buckets).every(v => oneOf(v, BUCKETS))))
      || (legacy.expanded !== undefined && legacy.expanded !== true && !booleanMap(legacy.expanded))
      || (legacy.legacyExpanded !== undefined && !booleanMap(legacy.legacyExpanded))
      || (legacy.keyEncoding !== undefined && legacy.keyEncoding !== 'typed-v1')) issue('legacyPivot', 'Invalid retained legacy configuration.');
  }
  if (!result.diagnostics.some(d => d.severity === 'error')) result.model = raw as TableModelV1;
  return result;
}
