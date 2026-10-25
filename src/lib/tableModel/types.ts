// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { AggName, PivotConfig, PivotMeasure } from '../types';

export type ModelErrorCode = 'invalid-type' | 'blocked-dependency' | 'unvalidated-model' | 'ambiguous-reference' | 'excluded-member' | 'missing-member' | 'no-counterpart' | 'missing-input' | 'missing-aggregation' | 'invalid-date' | 'fiscal-context' | 'cycle' | 'scope' | 'division-by-zero' | 'nonfinite' | 'missing-reference';
export type ModelError = { code: ModelErrorCode; message: string; definitionId?: string; recordIds?: string[]; dependencyIds?: string[] };
export type CellResult = { ok: true; value: unknown } | { ok: false; error: ModelError };
export type FiscalBinding = {
  companyFieldId: string;
  /** Current input period-date binding; categories supply their sourceFieldId. */
  dateFieldId?: string;
  /** Explicit binding into per-company metadata; never an implicit December end. */
  metadataKey?: string;
  /** Declares which period the shared start/end fields describe, including stub years. */
  periodKind?: 'FY' | 'FQ';
  periodStartFieldId?: string;
  periodEndFieldId?: string;
  fiscalYearFieldId?: string;
  fiscalQuarterFieldId?: string;
};
export type ModelWarning = {
  code: 'fiscal-alignment' | 'approximate-period' | 'incomplete-period' | 'legacy-bucket';
  message: string;
  categoryId?: string;
  periods?: { companyKey: string; start: string; end: string; source: string }[];
};
export type CategoryDef = {
  id: string;
  name: string;
  sourceFieldId: string;
  transform: 'native' | 'Y' | 'Q' | 'M' | 'FY' | 'FQ';
  fiscalBinding?: FiscalBinding;
  /** Maintained legacy recipe; not new authoring vocabulary. */
  legacyBucket?: 'week' | 'month';
};
export type MemberSelector = { categoryId: string; memberKey: string };
/** Bound IDs only. Parsing, name binding, scope and cycle checking belong to Task 3. */
export type FormulaAst =
  | { kind: 'literal'; value: number | string | boolean | null }
  | { kind: 'reference'; target: 'field' | 'formula' | 'measure'; id: string }
  | { kind: 'unary'; operator: '+' | '-'; operand: FormulaAst }
  | { kind: 'binary'; operator: '+' | '-' | '*' | '/' | '=' | '!=' | '<' | '<=' | '>' | '>='; left: FormulaAst; right: FormulaAst }
  | { kind: 'call'; function: AggName | 'IF'; args: FormulaAst[] }
  | { kind: 'member'; value: FormulaAst; selectors: MemberSelector[] };
export type FormulaDef = {
  id: string;
  name: string;
  scope: 'source' | 'aggregate';
  expression: string;
  ast: FormulaAst;
  format?: string;
};
export type PageSelection = { categoryId: string; memberKeys: string[] };
export type ChecklistConstraint = { categoryId: string; memberKeys: string[] };
export type ResultFilter = {
  id: string;
  categoryId: string;
  target: { kind: 'measure' | 'formula'; id: string };
  predicate: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte';
  value: number | string | boolean | null;
};
export type PivotFilterParam = { id: string; categoryId: string; label: string; multiSelect: boolean };
export type PivotParams = { promotePage: boolean; filters: PivotFilterParam[] };
export type TableModelV1 = {
  params: PivotParams;
  schemaVersion: 1;
  enabled: boolean;
  categories: CategoryDef[];
  measures: PivotMeasure[];
  formulas: FormulaDef[];
  layout: { rows: string[]; columns: string[]; values: string[]; page?: PageSelection };
  checklists: ChecklistConstraint[];
  resultFilters: ResultFilter[];
  subtotals: { grandTotal: boolean; groups: boolean };
  /** Detached migration evidence only; never a second live configuration authority. */
  legacyPivot?: Readonly<PivotConfig>;
};
export type ModelDiagnostic = {
  code: 'invalid-ast' | 'expression-limit' | 'node-limit' | 'depth-limit' | 'invalid-structure' | 'unsupported-schema' | 'duplicate-id' | 'missing-reference' | 'legacy-bucket';
  severity: 'error' | 'warning';
  path: string;
  message: string;
  definitionId?: string;
  dependencyId?: string;
};
export type ValidatedEntry<T> = { index: number; raw: unknown; value?: T; diagnostics: ModelDiagnostic[] };
export type ModelValidation = {
  /** Retained by reference for inspection; unsafe input must not be serialized blindly. */
  raw: unknown;
  /** Structural validity only, never authorization to execute formulas. */
  model?: TableModelV1;
  diagnostics: ModelDiagnostic[];
  categories: ValidatedEntry<CategoryDef>[];
  measures: ValidatedEntry<PivotMeasure>[];
  formulas: ValidatedEntry<FormulaDef>[];
};
