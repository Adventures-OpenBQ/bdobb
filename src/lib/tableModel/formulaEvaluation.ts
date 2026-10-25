// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { AnalyticalExecutionDescriptor } from './executionDescriptor';
import { evaluateStatementLine } from '../statementModel/linePolicy';
import type { DatasetColumn, DatasetRow } from '../widgetData/types';
import { deriveCategories, type CategorizedRows } from './categories';
import type { FiscalContext } from './fiscalContext';
import { bindFormula, type ModelSymbols } from './formulaBinding';
import type { GraphResult } from './formulaGraph';
import type { CategoryDef, CellResult, FormulaAst, ModelError, ModelWarning } from './types';
import { aggregate } from '../pivotTable';
import type { AggName } from '../types';
import type { EligiblePool } from './facets';
import { resolveMemberScope, scopeErrors, sliceCategories, type CalculationScope } from './scopes';

/** Worker-side evaluation context. Task 6 constructs this from validated entries. */
export type CompiledModel = Readonly<{
  execution?: AnalyticalExecutionDescriptor;
  graph: GraphResult; symbols: ModelSymbols; categories: readonly CategoryDef[];
  columns: readonly DatasetColumn[]; fiscal: FiscalContext;
}>;
export type EvaluatedRows = CategorizedRows & {
  columns: DatasetColumn[];
  formulaCells: Map<string, Map<string, CellResult>>;
  /** Actual direct bound inputs visited per source cell; aggregate metadata traverses this evidence. */
  sourceDependencies: Map<string, Map<string, ReadonlySet<string>>>;
  graphDiagnostics: GraphResult['diagnostics'];
};
/** Stable source identity union; overlapping record sets never multiply contributions. */
export function uniqueSourceRows(rows: readonly DatasetRow[]): DatasetRow[] {
  const seen = new Set<string>();
  return rows.filter(row => { if (seen.has(row.id)) return false; seen.add(row.id); return true; });
}
const success = (value: unknown): CellResult => ({ ok: true, value });
// One id → (first row, position) index per pool: a scope reads its own rows in pool order without rescanning the pool.
const sourceIndexes = new WeakMap<object, Map<string, { row: DatasetRow; at: number }>>();
function scopedSourceRows(pool: { rows: readonly DatasetRow[] }, ids: ReadonlySet<string>): DatasetRow[] {
  let index = sourceIndexes.get(pool);
  if (!index) { index = new Map(); for (const row of uniqueSourceRows(pool.rows)) index.set(row.id, { row, at: index.size }); sourceIndexes.set(pool, index); }
  return [...ids].flatMap(id => { const entry = index!.get(id); return entry ? [entry] : []; }).sort((a, b) => a.at - b.at).map(entry => entry.row);
}

function evaluate(ast: FormulaAst, row: DatasetRow, cells: Map<string, CellResult>, definitionId: string, scoped?: (ast: FormulaAst) => CellResult | undefined): CellResult {
  const resolved = scoped?.(ast);
  if (resolved) return resolved;
  const fail = (code: ModelError['code'], message: string, dependencyIds?: string[]): CellResult => ({ ok: false, error: { code, message, definitionId, recordIds: [row.id], ...(dependencyIds ? { dependencyIds } : {}) } });
  const numeric = (result: CellResult): CellResult => !result.ok ? result : typeof result.value !== 'number' ? fail('invalid-type', 'Arithmetic requires numeric values; blanks and text are not zero.') : !Number.isFinite(result.value) ? fail('nonfinite', 'Numeric value must be finite.') : result;
  switch (ast.kind) {
    case 'literal': return success(ast.value);
    case 'reference': {
      if (ast.target === 'formula') {
        const cell = cells.get(ast.id);
        if (!cell) return fail('missing-reference', 'Formula dependency is unavailable.', [ast.id]);
        return cell.ok ? cell : fail('blocked-dependency', cell.error.message, [...new Set([ast.id, ...(cell.error.dependencyIds ?? [])])]);
      }
      if (ast.target !== 'field') return fail('scope', 'Source expressions cannot read measures.');
      if (!Object.hasOwn(row.values, ast.id)) return fail('missing-input', `Source field ${ast.id} is unavailable.`, [ast.id]);
      const value = row.values[ast.id];
      if (typeof value === 'number' && !Number.isFinite(value)) return fail('nonfinite', 'Source numeric value must be finite.', [ast.id]);
      return success(value);
    }
    case 'unary': {
      const operand = numeric(evaluate(ast.operand, row, cells, definitionId, scoped));
      return operand.ok ? success(ast.operator === '-' ? -(operand.value as number) : operand.value) : operand;
    }
    case 'binary': {
      let left = evaluate(ast.left, row, cells, definitionId, scoped), right = evaluate(ast.right, row, cells, definitionId, scoped);
      if (!left.ok) return left;
      if (!right.ok) return right;
      if (['+', '-', '*', '/'].includes(ast.operator)) {
        left = numeric(left); right = numeric(right);
        if (!left.ok) return left;
        if (!right.ok) return right;
        const a = left.value as number, b = right.value as number;
        if (ast.operator === '/' && b === 0) return fail('division-by-zero', 'Cannot divide by zero.');
        const value = ast.operator === '+' ? a + b : ast.operator === '-' ? a - b : ast.operator === '*' ? a * b : a / b;
        return Number.isFinite(value) ? success(value) : fail('nonfinite', 'Calculation result must be finite.');
      }
      const a = left.value, b = right.value;
      const scalar = (v: unknown) => v == null || ['string', 'boolean', 'number', 'bigint'].includes(typeof v);
      if (!scalar(a) || !scalar(b)) return fail('invalid-type', 'Comparison requires scalar values.');
      if (ast.operator === '=' || ast.operator === '!=') return success(ast.operator === '=' ? a === b : a !== b);
      if (typeof a !== typeof b || !['number', 'string'].includes(typeof a)) return fail('invalid-type', 'Ordered comparison requires two numbers or two strings.');
      return success(ast.operator === '<' ? (a as number) < (b as number) : ast.operator === '<=' ? (a as number) <= (b as number) : ast.operator === '>' ? (a as number) > (b as number) : (a as number) >= (b as number));
    }
    case 'call': {
      if (ast.function !== 'IF') return fail('scope', 'Aggregate calls require aggregate scope.');
      const condition = evaluate(ast.args[0], row, cells, definitionId, scoped);
      if (!condition.ok) return condition;
      if (typeof condition.value !== 'boolean') return fail('invalid-type', 'IF condition must be boolean.');
      return evaluate(ast.args[condition.value ? 1 : 2], row, cells, definitionId, scoped);
    }
    case 'member': return fail('scope', 'Member expressions require aggregate scope.');
  }
}

/** Count producers deliberately publish strings for display; only their operator metadata authorizes normalization. */
function countInput(row: DatasetRow, columns: readonly DatasetColumn[], definitionId: string) {
  return (ast: FormulaAst): CellResult | undefined => {
    if (ast.kind !== 'reference' || ast.target !== 'field') return undefined;
    const incoming = row.cellErrors && Object.hasOwn(row.cellErrors,ast.id) ? row.cellErrors[ast.id] : undefined;
    if (incoming) return {ok:false,error:{code:'blocked-dependency',message:incoming.message,definitionId,recordIds:[row.id],dependencyIds:[ast.id,...(incoming.dependencyIds??[])]}};
    const column = columns.find(c => c.id === ast.id);
    if (column?.aggregation !== 'count' && column?.aggregation !== 'uniqueCount') return undefined;
    if (!Object.hasOwn(row.values, ast.id)) return undefined;
    const value = row.values[ast.id];
    if (typeof value !== 'string') return undefined;
    if (!/^\d+$/.test(value)) return { ok: false, error: { code: 'invalid-type', message: 'Incoming count must be an integer.', definitionId, recordIds: [row.id], dependencyIds: [ast.id] } };
    if (!Number.isSafeInteger(Number(value))) return { ok: false, error: { code: 'nonfinite', message: 'Incoming count exceeds the exact integer range.', definitionId, recordIds: [row.id], dependencyIds: [ast.id] } };
    return success(Number(value));
  };
}

export function evaluateSourceFormulas(rows: DatasetRow[], model: CompiledModel): EvaluatedRows {
  const entries = model.graph.entries.filter(entry => entry.value?.scope === 'source');
  const definitions = new Map(entries.map(entry => [entry.value!.id, entry]));
  const sources = new Map([...model.symbols.formulas.filter(f => f.scope === 'source'), ...entries.map(e => e.value!)].map(f => [f.id, f]));
  const allowed = new Set(model.graph.externalValidation === 'complete' ? model.graph.order.filter(id => !model.graph.blockedIds.includes(id)) : []);
  const formulaCells: EvaluatedRows['formulaCells'] = new Map();
  const sourceDependencies: EvaluatedRows['sourceDependencies'] = new Map();
  const errors: CategorizedRows['errors'] = new Map();
  const evaluated = uniqueSourceRows(rows).map(input => {
    const row = { ...input, values: { ...input.values } };
    const cells = new Map<string, CellResult>(); formulaCells.set(row.id, cells);
    const dependencies = new Map<string, ReadonlySet<string>>(); sourceDependencies.set(row.id, dependencies);
    for (const { id } of sources.values()) {
      const entry = definitions.get(id);
      const diagnostics = model.graph.diagnostics.filter(d => d.definitionId === id);
      const collision = model.columns.some(c => c.id === id) || Object.hasOwn(input.values, id);
      if (!entry || !allowed.has(id) || diagnostics.length || collision) {
        const error: ModelError = { code: model.graph.externalValidation !== 'complete' ? 'unvalidated-model' : collision ? 'ambiguous-reference' : diagnostics.some(d => d.code === 'cycle') ? 'cycle' : diagnostics[0]?.code === 'scope' ? 'scope' : 'blocked-dependency', message: diagnostics[0]?.message ?? 'Formula is not approved for source evaluation.', definitionId: id, recordIds: [row.id], dependencyIds: diagnostics.flatMap(d => d.dependencyIds ?? []) };
        cells.set(id, { ok: false, error });
      }
    }
    for (const id of model.graph.order) {
      const entry = definitions.get(id);
      if (!entry || cells.has(id) || !allowed.has(id)) continue;
      const inputs = new Set<string>(); dependencies.set(id, inputs);
      const readCount = countInput(row, model.columns, id);
      const result = evaluate(entry.value!.ast, row, cells, id, ast => {
        if (ast.kind === 'reference') {
          inputs.add(ast.id);
        }
        return readCount(ast);
      }); cells.set(id, result);
      if (result.ok) Object.defineProperty(row.values, id, { value: result.value, enumerable: true, writable: true, configurable: true });
    }
    const failures = new Map([...cells].filter(([, cell]) => !cell.ok).map(([id, cell]) => [id, (cell as Extract<CellResult, { ok: false }>).error]));
    if (failures.size) errors.set(row.id, failures);
    return row;
  });
  const originalValues = new Map(rows.map(row => [row.id, row.values]));
  const categorized = deriveCategories(evaluated, [...model.categories], model.fiscal, model.columns);
  for (const row of categorized.rows) for (const category of model.categories) {
    const incoming = row.cellErrors && Object.hasOwn(row.cellErrors,category.sourceFieldId) ? row.cellErrors[category.sourceFieldId] : undefined;
    const dependency: CellResult | undefined = formulaCells.get(row.id)?.get(category.sourceFieldId) ?? (incoming ? {ok:false,error:{code:'blocked-dependency',message:incoming.message,recordIds:[row.id]}} : undefined);
    if (dependency && !dependency.ok) {
      const error: ModelError = { ...dependency.error, code: 'blocked-dependency', definitionId: category.id, dependencyIds: [...new Set([category.sourceFieldId, ...(dependency.error.dependencyIds ?? [])])] };
      categorized.members.get(row.id)!.set(category.id, { ok: false, error });
      const rowErrors = categorized.errors.get(row.id) ?? new Map(); rowErrors.set(category.id, error); categorized.errors.set(row.id, rowErrors);
      if (!Object.hasOwn(originalValues.get(row.id)!, category.id)) delete row.values[category.id];
    }
  }
  for (const row of evaluated) for (const [id,error] of Object.entries(row.cellErrors??{})) { const existing=categorized.errors.get(row.id)??new Map();existing.set(id,{code:'blocked-dependency',message:error.message,definitionId:id,recordIds:[row.id],dependencyIds:error.dependencyIds});categorized.errors.set(row.id,existing); }
  for (const [id, failures] of errors) categorized.errors.set(id, new Map([...(categorized.errors.get(id) ?? []), ...failures]));
  const columns = [...model.columns];
  for (const source of sources.values()) if (!columns.some(c => c.id === source.id)) columns.push({ id: source.id, label: source.name });
  return { ...categorized, columns, formulaCells, sourceDependencies, graphDiagnostics: model.graph.diagnostics };
}


export type FormulaMetadata = {
  format?: string;
  valueKind?: 'number';
  /** Incoming binding/provenance hints retained without reading origin fields. */
  sourceColumns: DatasetColumn[];
  scopes: CalculationScope[];
  /** Actual Statement facts read by this expression, excluding unrelated lines. */
  statementRecordIds?: Set<string>;
};
export type FormulaValues = {
  empty: boolean;
  measureCells: Map<string, CellResult>;
  measureMetadata: Map<string, FormulaMetadata>;
  metadata: Map<string, FormulaMetadata>;
  cells: Map<string, CellResult>;
  scopeErrors: ModelError[];
  warnings: ModelWarning[];
  formats: Map<string, string>;
};
/** Semantic scope identity lets repeated member expressions share one provenance entry. */
function metadataScopeKey(scope: CalculationScope): string {
  const sorted = (entries: Iterable<unknown>) => [...entries].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify([sorted(scope.sourceRecordIds), sorted(scope.categoryConstraints), scope.contextSlices && sorted(scope.contextSlices.map(slice => [sorted(sliceCategories(slice)), 'categories' in slice && slice.companyIds ? sorted(slice.companyIds) : null])), scope.page && [scope.page.categoryId, sorted(new Set(scope.page.memberKeys))],
    scope.temporalContext.dateFieldId, scope.temporalContext.companyFieldId, scope.temporalContext.companyIds && sorted(scope.temporalContext.companyIds)]);
}
function mergeMetadata(target: FormulaMetadata, source: FormulaMetadata): void {
  for (const column of source.sourceColumns) if (!target.sourceColumns.some(c => c.id === column.id)) target.sourceColumns.push(column);
  const keys = new Set(target.scopes.map(metadataScopeKey));
  for (const scope of source.scopes) { const key = metadataScopeKey(scope); if (!keys.has(key)) { target.scopes.push(scope); keys.add(key); } }
  if (source.statementRecordIds) {
    target.statementRecordIds ??= new Set();
    for (const id of source.statementRecordIds) target.statementRecordIds.add(id);
  }
  if (source.valueKind) target.valueKind = source.valueKind;
  // An explicit format belongs to its own definition, never to a consumer.
}
/** Evaluate each aggregate definition afresh at this scope, with source cells already computed. */
export function evaluateAggregateFormulas(scope: CalculationScope, pool: EligiblePool, model: CompiledModel): FormulaValues {
  const entries = new Map(model.graph.entries.filter(e => e.value?.scope === 'aggregate').map(e => [e.value!.id, e]));
  const headers = new Map([...model.symbols.formulas.filter(f => f.scope === 'aggregate'), ...[...entries.values()].map(e => e.value!)].map(f => [f.id, f]));
  const allowed = new Set(model.graph.externalValidation === 'complete' ? model.graph.order.filter(id => !model.graph.blockedIds.includes(id)) : []);
  const errors = scopeErrors(pool, scope);
  const cells = new Map<string, CellResult>();
  const formats = new Map<string, string>();
  const metadata = new Map<string, FormulaMetadata>();
  const scopedMetadata = new Map<CalculationScope, Map<string, FormulaMetadata>>([[scope, metadata]]);
  const memo = new Map<CalculationScope, Map<string, CellResult>>();
  memo.set(scope, cells);
  const fail = (code: ModelError['code'], message: string, definitionId: string, at: CalculationScope, causes: ModelError[] = [], dependencies: string[] = []): CellResult => ({ ok: false, error: { code, message, definitionId,
    recordIds: [...new Set(causes.length ? causes.flatMap(e => e.recordIds ?? []) : [...at.sourceRecordIds])],
    ...(causes.length || dependencies.length ? { dependencyIds: [...new Set([...dependencies, ...causes.flatMap(e => e.dependencyIds ?? [])])] } : {}) } });
  const aggregateInput = (ast: FormulaAst, operator: AggName, at: CalculationScope, id: string, meta: FormulaMetadata): CellResult => {
    mergeMetadata(meta, { sourceColumns: [], scopes: [at], ...(operator === 'count' || operator === 'uniqueCount' ? { valueKind: 'number' as const } : {}) });
    const qualification = scopeErrors(pool, at);
    if (qualification.length) return fail('blocked-dependency', qualification[0].message, id, at, qualification);
    const rows = scopedSourceRows(pool, at.sourceRecordIds);
    if (rows.length && (operator === 'first' || operator === 'last') && !at.temporalContext.dateFieldId) return fail('missing-input','Bind one report date explicitly for chronological aggregation.',id,at);
    const source = rows.map(row => {
      const readCount = countInput(row, model.columns, id);
      const result = evaluate(ast, row, pool.formulaCells.get(row.id) ?? new Map(), id, node => {
        if (node.kind === 'reference') {
          const inputs = new Set([node.id]);
          if (node.target === 'formula') {
            const pending = [node.id];
            for (let index = 0; index < pending.length; index++) for (const input of pool.sourceDependencies.get(row.id)?.get(pending[index]) ?? []) {
              if (!inputs.has(input)) { inputs.add(input); pending.push(input); }
            }
          }
          for (const input of inputs) {
            const column = pool.columns.find(c => c.id === input);
            if (column && !meta.sourceColumns.some(c => c.id === input)) meta.sourceColumns.push(column);
          }
        }
        return readCount(node);
      });
      return { row, result };
    });
    const failures = source.flatMap(({ result }) => result.ok ? [] : [result.error]);
    if ((operator === 'first' || operator === 'last') && at.temporalContext.dateFieldId) {
      const dateField = at.temporalContext.dateFieldId;
      for (const row of rows) {
        const upstreamError=pool.errors.get(row.id)?.get(dateField);
        if(upstreamError) failures.push(upstreamError);
        const cell = pool.formulaCells.get(row.id)?.get(dateField);
        if (cell && !cell.ok) failures.push({ ...cell.error, dependencyIds: [...new Set([dateField, ...(cell.error.dependencyIds ?? [])])] });
      }
    }
    if (failures.length) return fail('blocked-dependency', failures[0].message, id, at, failures);
    const values = source.map(({ row, result }) => ({ value: result.ok ? result.value : undefined, date: at.temporalContext.dateFieldId ? row.values[at.temporalContext.dateFieldId] : undefined }));
    let value = aggregate(operator, values, 'value', at.temporalContext.dateFieldId ? 'date' : undefined);
    if (operator === 'count' || operator === 'uniqueCount') {
      if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) return fail('nonfinite', 'Count exceeds the exact integer range.', id, at);
      value = Number(value);
    }
    return typeof value === 'number' && !Number.isFinite(value) ? fail('nonfinite', 'Aggregate result must be finite.', id, at) : success(value);
  };
  const run = (id: string, at: CalculationScope): CellResult => {
    let values = memo.get(at); if (!values) { values = new Map(); memo.set(at, values); }
    const previous = values.get(id); if (previous) return previous;
    let metadataForScope = scopedMetadata.get(at);
    if (!metadataForScope) { metadataForScope = new Map(); scopedMetadata.set(at, metadataForScope); }
    const meta: FormulaMetadata = { sourceColumns: [], scopes: [] }; metadataForScope.set(id, meta);
    const entry = entries.get(id);
    if (entry?.value?.format !== undefined) meta.format = entry.value.format;
    const diagnostics = model.graph.diagnostics.filter(d => d.definitionId === id);
    let result: CellResult;
    if (!entry || !allowed.has(id) || entry.diagnostics.length || diagnostics.length) {
      const diagnostic = diagnostics[0];
      const code = model.graph.externalValidation !== 'complete' ? 'unvalidated-model' : diagnostic?.code === 'missing-aggregation' ? 'missing-aggregation' : diagnostic?.code === 'cycle' ? 'cycle' : diagnostic?.code === 'scope' ? 'scope' : 'blocked-dependency';
      result = fail(code, diagnostic?.message ?? 'Formula is not approved for aggregate evaluation.', id, at, [], diagnostics.flatMap(d => d.dependencyIds ?? []));
    } else {
      result = expression(entry.value!.ast, at, id, meta);
      const policy = model.execution?.policy;
      if (result.ok && policy && meta.statementRecordIds?.size) {
        const records = scopedSourceRows(pool, meta.statementRecordIds!);
        for (const field of [policy.companyFieldId, policy.currencyFieldId, policy.unitFieldId]) {
          if (field && new Set(records.map(row => JSON.stringify(row.values[field]))).size > 1) {
            result = fail('scope', `Mixed ${field} contexts cannot be combined in a derived Statement value.`, id, at);
            break;
          }
        }
      }
    }
    values.set(id, result); return result;
  };
  const expression = (expressionAst: FormulaAst, at: CalculationScope, id: string, meta: FormulaMetadata): CellResult => {
    const scoped = (ast: FormulaAst): CellResult | undefined => {
      if (ast.kind === 'member') {
        const resolved = resolveMemberScope(pool, at, ast.selectors, model.execution?.scopeMembers);
        return resolved.ok ? expression(ast.value, resolved.scope, id, meta) : fail(resolved.errors[0].code, resolved.errors[0].message, id, at, resolved.errors);
      }
      if (ast.kind === 'call' && ast.function !== 'IF') return aggregateInput(ast.args[0], ast.function, at, id, meta);
      if (ast.kind !== 'reference') return undefined;
      if (ast.target === 'formula') {
        const dependency = run(ast.id, at);
        const dependencyMetadata = scopedMetadata.get(at)?.get(ast.id);
        if (dependencyMetadata) mergeMetadata(meta, dependencyMetadata);
        return dependency.ok ? dependency : fail('blocked-dependency', dependency.error.message, id, at, [dependency.error], [ast.id]);
      }
      if (ast.target !== 'measure') return fail('scope', 'Unqualified aggregate inputs require a configured measure.', id, at);
      const measure = model.symbols.measures.find(m => m.id === ast.id);
      if (!measure) return fail('missing-reference', 'Measure instance is unavailable.', id, at, [], [ast.id]);
      if (!measure.aggregation) return fail('missing-aggregation', `Choose an aggregation for ${measure.name}.`, id, at, [], [ast.id]);
      const policy = model.execution?.policy;
      if (policy && measure.id === policy.measureId) {
        const key = at.categoryConstraints.get(policy.categoryId);
        const selected = key && policy.members[key];
        if (!selected) return fail('scope','Select one line member before evaluating its measure policy.',id,at);
        if (selected === 'formula') {
          const formulaId = policy.formulas[key!];
          const result = run(formulaId, at);
          const dependencyMetadata = scopedMetadata.get(at)?.get(formulaId);
          if (dependencyMetadata) mergeMetadata(meta, dependencyMetadata);
          return result;
        }
        const qualification=scopeErrors(pool,at);
        if(qualification.length)return fail('blocked-dependency',qualification[0].message,id,at,qualification);
        const records=scopedSourceRows(pool,at.sourceRecordIds).filter(row=>(()=>{const member=pool.members.get(row.id)?.get(policy.categoryId);return member?.ok && member.value.key===key;})());
        mergeMetadata(meta,{sourceColumns:records.flatMap(row=>{const column=model.execution?.sourceColumnsByRowId?.get(row.id)??model.columns.find(c=>c.id===policy.valueFieldId);return column?[column]:[];}),scopes:[at],valueKind:'number',statementRecordIds:new Set(records.map(row=>row.id))});
        if(at.requestedFiscalScope?.errors.length)return fail('fiscal-context',at.requestedFiscalScope.errors[0].message,id,at,[...at.requestedFiscalScope.errors]);
        return evaluateStatementLine(selected,records,policy.valueFieldId,{...policy,fiscalContext:model.fiscal,requestedPeriods:at.requestedFiscalScope?.periods,required:policy.required[key!]});
      }
      const target = model.columns.some(c => c.id === measure.sourceFieldId) ? 'field' : 'formula';
      return aggregateInput({ kind: 'reference', target, id: measure.sourceFieldId }, measure.aggregation, at, id, meta);
    };
    const evaluated = evaluate(expressionAst, { id: '', values: {} }, new Map(), id, scoped);
    return evaluated.ok || evaluated.error.recordIds?.[0] !== '' ? evaluated : { ok: false, error: { ...evaluated.error, recordIds: [...at.sourceRecordIds] } };
  };
  for (const id of model.graph.order) if (headers.has(id)) run(id, scope);
  for (const id of headers.keys()) {
    if (!cells.has(id)) run(id, scope);
    const format = entries.get(id)?.value?.format;
    const meta = metadata.get(id) ?? { sourceColumns: [], scopes: [] };
    if (format !== undefined) { formats.set(id, format); meta.format = format; }
    metadata.set(id, meta);
  }
  const measureCells = new Map<string, CellResult>();
  const measureMetadata = new Map<string, FormulaMetadata>();
  for (const measure of model.symbols.measures) {
    const meta: FormulaMetadata = {sourceColumns: [], scopes: []};
    const bound = bindFormula({kind:'reference',target:'measure',id:measure.id},model.symbols,'aggregate',{boundMembers:'structural'});
    const diagnostic=bound.diagnostics[0];
    const code=diagnostic && ['missing-reference','ambiguous-reference','missing-aggregation','scope'].includes(diagnostic.code)?diagnostic.code as ModelError['code']:'blocked-dependency';
    const cell = model.graph.externalValidation !== 'complete' ? fail('unvalidated-model', 'Measure bindings have not been validated.', measure.id, scope)
      // An unchosen aggregation is blank, not an error; formulas that reference it still fail.
      : diagnostic?.code === 'missing-aggregation' ? { ok: true as const, value: null }
      : diagnostic ? fail(code,diagnostic.message,measure.id,scope,[],diagnostic.dependencyIds) : expression({kind: 'reference', target: 'measure', id: measure.id}, scope, measure.id, meta);
    measureCells.set(measure.id, cell); measureMetadata.set(measure.id, meta);
  }
  return { cells, measureCells, measureMetadata, scopeErrors: errors, warnings: [...pool.warnings], formats, metadata, empty: !pool.rows.some(row => scope.sourceRecordIds.has(row.id)) };
}
