// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord as object } from '../isRecord';
import { boundedPlainData } from '../tableModel/validation';
import { astChildren, validateFormulaAst } from '../tableModel/formulaSyntax';
import type { FormulaAst, FormulaDef, ModelDiagnostic } from '../tableModel/types';
import { statementOwnedIds, type StatementIntent, type StatementValidation } from './types';
type Obj = Record<string, unknown>;
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(text);
const choice = (v: unknown, choices: string[]) => typeof v === 'string' && choices.includes(v);
const exact = (v: Obj, keys: string[]) => Object.keys(v).every(k => keys.includes(k));
/** Validate inert data and semantic bindings only; execution belongs to the shared engine. */
export function validateStatementIntent(raw: unknown): StatementValidation {
  const result: StatementValidation = { diagnostics: [] };
  const issue = (path: string, message: string, code: ModelDiagnostic['code'] = 'invalid-structure') => result.diagnostics.push({ path, message, code, severity: 'error' });
  if (!boundedPlainData(raw)) {
    issue('', 'Statement must be bounded plain data without accessors or cycles.');
    return result;
  }
  // Clone only after safe-data inspection, then validate the exact detached data
  // callers receive. structuredClone intentionally drops non-enumerable fields.
  raw = structuredClone(raw);
  if (!object(raw)) {
    issue('', 'Expected statement object.');
    return result;
  }
  if (raw.schemaVersion !== 2) {
    issue('schemaVersion', 'Unsupported statement schema.', 'unsupported-schema');
    return result;
  }
  if (raw.kind !== 'statement' || !exact(raw, ['schemaVersion', 'kind', 'template', 'bindings', 'overrides', 'periodKind', 'page', 'checklists', 'resultFilters']))
    issue('', 'Expected explicit statement intent.');
  const intent = raw;
  const t = intent.template;
  if (!object(t)
      || t.schemaVersion !== 1
      || !text(t.id)
      || !text(t.version)
      || !Array.isArray(t.lines)
      || !Array.isArray(t.sections)
      || !exact(t, ['schemaVersion', 'id', 'version', 'sections', 'lines'])) {
    issue('template', 'Invalid template snapshot.');
    return result;
  }
  const templateLines = t.lines;
  const owned = statementOwnedIds({ id: t.id, version: t.version });
  const lines = new Set<string>();
  const sections = new Map<string, string[]>();
  const formulas = new Set<string>();
  const categories = new Set([owned.item, owned.company, owned.period]);
  const unique = (values: string[], path: string) => {
    if (new Set(values).size !== values.length) issue(path, 'Duplicate ID.', 'duplicate-id');
  };
  const reference = (value: string, allowed: Set<string>, path: string) => {
    if (!allowed.has(value)) issue(path, 'Unknown or unowned reference.', 'missing-reference');
  };
  const formulaDefs: {
    raw: unknown;
    path: string;
  }[] = [];
  t.lines.forEach((line, index) => {
    const path = `template.lines.${index}`;
    if (!object(line)
        || !text(line.id)
        || !line.id.startsWith(`${owned.prefix}line/`)
        || !text(line.label)
        || typeof line.required !== 'boolean'
        || !choice(line.policy, ['single', 'flow', 'stock', 'formula'])
        || !exact(line, ['id', 'label', 'required', 'policy', 'formula', 'format', 'unit'])
        || ['format', 'unit'].some(k => line[k] !== undefined && !text(line[k]))) {
      issue(path, 'Invalid owned line.');
      return;
    }
    if (lines.has(line.id))
      issue(path, 'Duplicate line.', 'duplicate-id');
    lines.add(line.id);
    if (line.policy === 'formula') {
      if (line.formula === undefined)
        issue(path, 'Formula policy requires a definition.');
      else
        formulaDefs.push({ raw: line.formula, path: `${path}.formula` });
    }
    else if (line.formula !== undefined)
      issue(path, 'Only formula policy accepts a definition.');
  });
  const assigned: string[] = [];
  t.sections.forEach((s, i) => {
    const path = `template.sections.${i}`;
    if (!object(s) || !text(s.id) || !s.id.startsWith(`${owned.prefix}section/`) || !text(s.label) || !strings(s.lineIds) || !exact(s, ['id', 'label', 'lineIds'])) {
      issue(path, 'Invalid owned section.');
      return;
    }
    if (sections.has(s.id))
      issue(path, 'Duplicate section.', 'duplicate-id');
    sections.set(s.id, s.lineIds);
    for (const line of s.lineIds) {
      reference(line, lines, path);
      assigned.push(line);
    }
  });
  unique(assigned, 'template.sections');
  if (assigned.length !== lines.size || [...lines].some(l => !assigned.includes(l)))
    issue('template.sections', 'Each line must belong to exactly one section.');

  function validateBindings() {
    const b = intent.bindings;
    if (!object(b)
        || !choice(b.shape, ['wide', 'long'])
        || !text(b.companyFieldId)
        || !text(b.periodKindFieldId)
        || !object(b.fiscal)
        || !Array.isArray(b.mappings)
        || !exact(b, ['shape', 'companyFieldId', 'periodKindFieldId', 'currencyFieldId', 'unitFieldId', 'fiscal', 'mappings', 'longFields'])
        || ['currencyFieldId', 'unitFieldId'].some(k => b[k] !== undefined && !text(b[k])))
      issue('bindings', 'Invalid explicit source bindings.');
    else {
      const f = b.fiscal as Obj;
      if (!text(f.dateFieldId) && !(text(f.periodStartFieldId) && text(f.periodEndFieldId)) && !text(f.fiscalYearFieldId))
        issue('bindings.fiscal', 'Fiscal input requires date, period bounds or explicit fiscal year fields.');
      const identityFields = [b.companyFieldId, b.periodKindFieldId, b.currencyFieldId, b.unitFieldId].filter(text);
      unique(identityFields, 'bindings');
      const fiscalKeys = ['companyFieldId', 'dateFieldId', 'metadataKey', 'periodKind', 'periodStartFieldId', 'periodEndFieldId', 'fiscalYearFieldId', 'fiscalQuarterFieldId'];
      if (f.companyFieldId !== b.companyFieldId
          || !exact(f, fiscalKeys)
          || fiscalKeys.filter(k => k !== 'periodKind').some(k => f[k] !== undefined && !text(f[k]))
          || (f.periodKind !== undefined && f.periodKind !== intent.periodKind))
        issue('bindings.fiscal', 'Invalid or contradictory fiscal binding.');
      if (b.shape === 'long') {
        if (!object(b.longFields)
            || !text(b.longFields.itemFieldId)
            || !text(b.longFields.valueFieldId)
            || b.longFields.itemFieldId === b.longFields.valueFieldId
            || !exact(b.longFields, ['itemFieldId', 'valueFieldId']))
          issue('bindings.longFields', 'Long input requires distinct item/value fields.');
      }
      else if (b.longFields !== undefined)
        issue('bindings.longFields', 'Wide input cannot declare long fields.');
      const destinations: string[] = [];
      b.mappings.forEach((m, i) => {
        const path = `bindings.mappings.${i}`;
        if (!object(m) || !text(m.sourceFieldId) || !text(m.lineId) || !exact(m, ['sourceFieldId', 'lineId'])) {
          issue(path, 'Invalid explicit mapping.');
          return;
        }
        if (identityFields.includes(m.sourceFieldId))
          issue(path, 'Identity context cannot be mapped as a financial line.');
        reference(m.lineId, lines, path);
        destinations.push(m.lineId);
        if (templateLines.some(l => object(l) && l.id === m.lineId && l.policy === 'formula'))
          issue(path, 'Derived lines cannot receive source mappings.');
      });
      unique(destinations, 'bindings.mappings');
    }
  }
  validateBindings();

  function validateOverrides() {
    const o = intent.overrides;
    const allIds = new Set([...lines, ...sections.keys()]);
    if (!object(o)
        || !object(o.labels)
        || !object(o.lineOrder)
        || !strings(o.hiddenIds)
        || !Array.isArray(o.formulas)
        || !exact(o, ['labels', 'lineOrder', 'hiddenIds', 'formulas', 'sectionOrder']))
      issue('overrides', 'Invalid overrides.');
    else {
      for (const [key, label] of Object.entries(o.labels)) {
        reference(key, allIds, 'overrides.labels');
        if (!text(label))
          issue('overrides.labels', 'Expected nonempty label.');
      }
      unique(o.hiddenIds, 'overrides.hiddenIds');
      o.hiddenIds.forEach(id => reference(id, allIds, 'overrides.hiddenIds'));
      if (o.sectionOrder !== undefined) {
        if (!strings(o.sectionOrder))
          issue('overrides.sectionOrder', 'Invalid section order.');
        else {
          unique(o.sectionOrder, 'overrides.sectionOrder');
          if (o.sectionOrder.length !== sections.size)
            issue('overrides.sectionOrder', 'Order must include each section.');
          o.sectionOrder.forEach(id => reference(id, new Set(sections.keys()), 'overrides.sectionOrder'));
        }
      }
      for (const [section, order] of Object.entries(o.lineOrder)) {
        if (!sections.has(section) || !strings(order)) {
          issue('overrides.lineOrder', 'Unknown section or invalid order.');
          continue;
        }
        unique(order, 'overrides.lineOrder');
        const ids = sections.get(section)!;
        if (order.length !== ids.length)
          issue('overrides.lineOrder', 'Order must include every section line.');
        order.forEach(id => reference(id, new Set(ids), 'overrides.lineOrder'));
      }
      o.formulas.forEach((f, i) => formulaDefs.push({ raw: f, path: `overrides.formulas.${i}` }));
    }
  }
  validateOverrides();

  function validateFormulas() {
    const checked: {
      formula: FormulaDef;
      path: string;
    }[] = [];
    const overrideIds = new Set<string>();
    for (const { raw: f, path } of formulaDefs) {
      if (!object(f)
          || !text(f.id)
          || !f.id.startsWith(`${owned.prefix}formula/`)
          || !text(f.name)
          || !choice(f.scope, ['source', 'aggregate'])
          || typeof f.expression !== 'string'
          || (f.format !== undefined && !text(f.format))
          || !exact(f, ['id', 'name', 'scope', 'expression', 'ast', 'format'])) {
        issue(path, 'Invalid owned formula.');
        continue;
      }
      if (path.startsWith('overrides.')) {
        reference(f.id, formulas, path);
        if (overrideIds.has(f.id))
          issue(path, 'Duplicate formula override ID.', 'duplicate-id');
        overrideIds.add(f.id);
      }
      else {
        if (formulas.has(f.id))
          issue(path, 'Duplicate formula ID.', 'duplicate-id');
        formulas.add(f.id);
      }
      if (new TextEncoder().encode(f.expression).length > 16384)
        issue(path, 'Formula exceeds expression limit.', 'expression-limit');
      const ast = validateFormulaAst(f.ast);
      for (const d of ast.diagnostics)
        issue(`${path}.ast`, d.message, d.code as ModelDiagnostic['code']);
      if (ast.ast)
        checked.push({ formula: f as FormulaDef, path });
    }
    function refs(ast: FormulaAst, path: string) {
      astChildren(ast).forEach(a => refs(a, path));
      switch (ast.kind) {
        case 'reference':
          reference(ast.id, ast.target === 'formula' ? formulas : ast.target === 'measure' ? new Set([owned.value]) : new Set(), path);
          break;
        case 'member':
          unique(ast.selectors.map(s => s.categoryId), path);
          ast.selectors.forEach(s => { reference(s.categoryId, categories, path); if (s.categoryId === owned.item)
            reference(s.memberKey, lines, path); });
          break;
      }
    }
    checked.forEach(({ formula, path }) => refs(formula.ast, path));
  }
  validateFormulas();
  if (!choice(raw.periodKind, ['FY', 'FQ']))
    issue('periodKind', 'Expected FY or FQ.');
  function selection(value: unknown, path: string) {
    if (!object(value) || !text(value.categoryId) || !strings(value.memberKeys) || !exact(value, ['categoryId', 'memberKeys'])) {
      issue(path, 'Invalid category/member selection.');
      return;
    }
    reference(value.categoryId, categories, path);
    unique(value.memberKeys, path);
    if (value.categoryId === owned.item)
      value.memberKeys.forEach(k => reference(k, lines, path));
  }
  if (raw.page !== undefined)
    selection(raw.page, 'page');
  if (!Array.isArray(raw.checklists))
    issue('checklists', 'Expected checklists.');
  else {
    raw.checklists.forEach((v, i) => selection(v, `checklists.${i}`));
    unique(raw.checklists.flatMap(v => object(v) && text(v.categoryId) ? [v.categoryId] : []), 'checklists');
  }

  function validateResultFilters() {
    if (!Array.isArray(intent.resultFilters))
      issue('resultFilters', 'Expected filters.');
    else {
      const filterIds: string[] = [];
      intent.resultFilters.forEach((f, i) => {
        const path = `resultFilters.${i}`;
        if (!object(f)
            || !text(f.id)
            || !text(f.categoryId)
            || !object(f.target)
            || !text(f.target.id)
            || !choice(f.target.kind, ['measure', 'formula'])
            || !choice(f.predicate, ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'])
            || !exact(f, ['id', 'categoryId', 'target', 'predicate', 'value'])
            || !exact(f.target, ['kind', 'id'])
            || !(f.value === null
            || ['string', 'boolean'].includes(typeof f.value)
            || typeof f.value === 'number' && Number.isFinite(f.value))) {
          issue(path, 'Invalid result filter.');
          return;
        }
        filterIds.push(f.id);
        reference(f.categoryId, categories, path);
        reference(f.target.id, f.target.kind === 'formula' ? formulas : new Set([owned.value]), path);
      });
      unique(filterIds, 'resultFilters');
    }
  }
  validateResultFilters();
  if (!result.diagnostics.length)
    result.value = raw as StatementIntent;
  return result;
}
