// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { isRecord } from "../../isRecord";
import { draftModelFor } from "../../tableModel/draftModel";
import { duplicateMeasure, updateMeasureAggregation } from "../../tableModel/measures";
import { bindFormulaDraft, type DraftBindings, type DraftMemberProof } from "../../../components/renderers/table-model/authoringValidation";
import { demote, promote, setPageKeys } from "../../tableModel/pivotParams";
import { isAlias, OpError, toArrangeError, type Arrangement, type ArrangeError, type Operation, type Ref } from "./contract";
import { isStatement, tableModelOf } from "./describe";
import { applyStatementOps } from "./statement";
import type { StatementUpdateConflict } from "../../statementModel/updates";
import type { TableDefinition } from "../../tableExecution/types";
import type { FiscalBinding, FormulaAst, ResultFilter, TableModelV1 } from "../../tableModel/types";
import type { AggName, TableSort } from "../../types";
import type { DatasetColumn } from "../../widgetData/types";

/** `view` is the last view.set's view: card state, not part of the definition, checked against the card's views by arrange. */
export type CandidateResult = { definition?: TableDefinition; ids: Record<string, string>; errors: ArrangeError[]; conflicts?: StatementUpdateConflict[]; view?: string; aggregationChoices?: ReadonlyMap<string, AggName>; aggregationOverrides?: ReadonlyMap<string, AggName> };

type Pool = "category" | "measure" | "formula";
export type Ctx = { ids?: Record<string, string>; fresh: (alias: unknown) => string; resolve: (ref: Ref, ...pools: Pool[]) => string; columns: readonly DatasetColumn[] };

const FISCAL_KEYS: Record<string, keyof FiscalBinding> = {
  company_field_id: "companyFieldId", date_field_id: "dateFieldId", metadata_key: "metadataKey", period_kind: "periodKind",
  period_start_field_id: "periodStartFieldId", period_end_field_id: "periodEndFieldId", fiscal_year_field_id: "fiscalYearFieldId", fiscal_quarter_field_id: "fiscalQuarterFieldId",
};
const bad = (path: string, message: string): never => { throw new OpError({ code: "invalid-field", path, message }); };

function fiscalBinding(raw: unknown): FiscalBinding {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(isRecord(raw) ? raw : {})) {
    const key = Object.hasOwn(FISCAL_KEYS, k) ? FISCAL_KEYS[k] : undefined;
    if (!key) bad(`fiscal_binding.${k}`, `unknown fiscal_binding key ${k}`);
    else out[key] = v;
  }
  return out as FiscalBinding;
}

function applyPresentation(definition: TableDefinition, op: Operation, columns: readonly DatasetColumn[]): void {
  const known = new Set(columns.map(c => c.id));
  const ids = (field: string): string[] => {
    const list = op[field] as string[];
    for (const id of list) if (!known.has(id)) bad(field, `${id} is not a column of this table`);
    return [...list];
  };
  const next = { ...definition.table };
  if (op.sorting !== undefined) {
    next.sorting = (op.sorting as unknown[]).map((s, i): TableSort => {
      if (!isRecord(s) || Object.keys(s).length !== 2 || typeof s.id !== "string" || typeof s.desc !== "boolean") return bad(`sorting[${i}]`, "sorting entries are { id, desc }");
      if (!known.has(s.id)) return bad(`sorting[${i}].id`, `${s.id} is not a column of this table`);
      return { id: s.id, desc: s.desc };
    });
  }
  if (op.column_order !== undefined) next.columnOrder = ids("column_order");
  if (op.hidden !== undefined) next.hidden = ids("hidden");
  definition.table = next;
}

/** Applies one model operation to a detached model; the caller owns the clone. */
export function applyModelOp(model: TableModelV1, op: Operation, ctx: Ctx): TableModelV1 {
  const { fresh, resolve } = ctx;
  const str = (k: string) => op[k] as string;
  switch (op.op) {
    case "category.add":
      model.categories.push({ id: fresh(op.alias), name: str("name"), sourceFieldId: str("source_field_id"), transform: op.transform as TableModelV1["categories"][number]["transform"], ...(op.fiscal_binding ? { fiscalBinding: fiscalBinding(op.fiscal_binding) } : {}) });
      return model;
    case "category.update": {
      const c = model.categories.find(x => x.id === resolve(op.target as Ref, "category"))!;
      if (op.name !== undefined) c.name = str("name");
      if (op.transform !== undefined) c.transform = op.transform as typeof c.transform;
      if (op.fiscal_binding !== undefined) c.fiscalBinding = fiscalBinding(op.fiscal_binding);
      return model;
    }
    case "category.remove": {
      const id = resolve(op.target as Ref, "category");
      if (model.resultFilters.some(f => f.categoryId === id)) throw new OpError({ code: "validation", target_id: id, message: "a result filter uses this category; remove the filter first" });
      model.categories = model.categories.filter(c => c.id !== id);
      model.layout.rows = model.layout.rows.filter(x => x !== id);
      model.layout.columns = model.layout.columns.filter(x => x !== id);
      if (model.layout.page?.categoryId === id) delete model.layout.page;
      model.checklists = model.checklists.filter(c => c.categoryId !== id);
      return demote(model, id);
    }
    case "measure.add":
      model.measures.push({ id: fresh(op.alias), sourceFieldId: str("source_field_id"), ...(op.aggregation ? { aggregation: op.aggregation as AggName } : {}), ...(op.label !== undefined ? { customLabel: str("label") } : {}) });
      return model;
    case "measure.duplicate":
      model.measures = duplicateMeasure(model.measures, resolve(op.target as Ref, "measure"), fresh(op.alias));
      return model;
    case "measure.update": {
      const id = resolve(op.target as Ref, "measure");
      if (op.aggregation !== undefined) model.measures = updateMeasureAggregation(model.measures, id, op.aggregation as AggName);
      if (op.label !== undefined) model.measures = model.measures.map(m => { if (m.id !== id) return m; const { customLabel: _drop, ...rest } = m; return op.label === "" ? rest : { ...rest, customLabel: str("label") }; });
      return model;
    }
    case "measure.remove": {
      const id = resolve(op.target as Ref, "measure");
      model.measures = model.measures.filter(m => m.id !== id);
      model.layout.values = model.layout.values.filter(x => x !== id);
      return model;
    }
    case "layout.set": {
      const ids = (k: string, ...pools: Pool[]) => (op[k] as Ref[]).map(r => ctx.resolve(r, ...pools));
      if (op.rows) model.layout.rows = ids("rows", "category");
      if (op.columns) model.layout.columns = ids("columns", "category");
      if (op.values) model.layout.values = ids("values", "measure", "formula");
      return model;
    }
    case "totals.set":
      model.subtotals = { ...model.subtotals, ...(op.grand_total !== undefined ? { grandTotal: op.grand_total as boolean } : {}), ...(op.groups !== undefined ? { groups: op.groups as boolean } : {}) };
      return model;
    case "control.promote": {
      const categoryId = resolve(op.category as Ref, "category");
      const existing = model.params.filters.find(p => p.categoryId === categoryId);
      return promote(model, categoryId, { id: existing?.id ?? fresh(undefined), label: str("label"), multiSelect: op.multi_select as boolean });
    }
    case "control.demote":
      return demote(model, resolve(op.category as Ref, "category"));
    case "control.promote_page":
      model.params = { ...model.params, promotePage: op.enabled as boolean };
      return model;
    case "model.enable":
      model.enabled = op.enabled as boolean;
      return model;
    case "formula.set": {
      const target = op.target as Ref;
      const known = isAlias(target) ? ctx.ids?.[target.alias] : target.id;
      const existing = known ? model.formulas.find(f => f.id === known) : undefined;
      if (!isAlias(target) && !existing) throw new OpError({ code: "unknown-reference", target_id: target.id, message: `no formula ${target.id}` });
      const id = existing?.id ?? fresh(isAlias(target) ? target.alias : undefined);
      const fail = (message: string, affected?: string[]): never => { throw new OpError({ code: "validation", target_id: id, message, ...(affected?.length ? { affected_ids: affected } : {}) }); };
      const sourceIds = new Set([...ctx.columns.map(c => c.id), ...model.formulas.filter(f => f.scope === "source").map(f => f.id)]);
      const bindings: DraftBindings = new Map();
      for (const [name, raw] of Object.entries(op.bindings as Record<string, { target: "field" | "formula" | "measure"; ref: Ref }>)) {
        if (!isRecord(raw) || !isRecord(raw.ref) || !["field", "formula", "measure"].includes(raw.target)) fail(`binding ${name} is { target, ref }`);
        let refId: string;
        if (raw.target === "field") {
          refId = (raw.ref as { id?: string }).id ?? "";
          if (!sourceIds.has(refId)) fail(`binding ${name}: ${refId || "(no id)"} is not a column or source formula of this table`);
        } else refId = resolve(raw.ref, raw.target);
        bindings.set(name, { kind: "reference", target: raw.target, id: refId });
      }
      const proofs: DraftMemberProof[] = ((op.members ?? []) as { token: string; category: Ref; member_key: string; value: DraftMemberProof["value"] }[]).map(m => {
        const categoryId = resolve(m.category, "category");
        return { token: m.token, categoryId, categoryName: model.categories.find(c => c.id === categoryId)!.name, memberKey: m.member_key, value: m.value };
      });
      const result = bindFormulaDraft(model, ctx.columns, { id, name: str("name"), scope: op.scope as "source" | "aggregate", expression: str("expression"), ...(op.format !== undefined ? { format: str("format") } : {}) }, existing, bindings, undefined, proofs);
      if (!result.model) fail(result.errors.join(" ") || "formula was refused", [...new Set([id, ...(result.diagnostics ?? []).filter(d => d.code === "cycle").flatMap(d => d.dependencyIds ?? [])])]);
      return result.model!;
    }
    case "formula.remove": {
      const id = resolve(op.target as Ref, "formula");
      const uses = (ast: FormulaAst): boolean => ast.kind === "reference" ? ast.id === id : ast.kind === "literal" ? false : ast.kind === "unary" ? uses(ast.operand) : ast.kind === "binary" ? uses(ast.left) || uses(ast.right) : ast.kind === "call" ? ast.args.some(uses) : uses(ast.value);
      if (model.formulas.some(f => f.id !== id && uses(f.ast)) || model.resultFilters.some(f => f.target.id === id)) throw new OpError({ code: "validation", target_id: id, message: "another formula or result filter uses this formula; remove that first" });
      model.formulas = model.formulas.filter(f => f.id !== id);
      model.layout.values = model.layout.values.filter(x => x !== id);
      return model;
    }
    case "page.set": {
      const categoryId = resolve(op.category as Ref, "category");
      const keys = op.member_keys as string[];
      if (model.layout.page?.categoryId === categoryId) return setPageKeys(model, categoryId, keys);
      model.layout.page = { categoryId, memberKeys: [...new Set(keys)] };
      return model;
    }
    case "page.clear":
      delete model.layout.page;
      return model;
    case "checklist.set": {
      const categoryId = resolve(op.category as Ref, "category");
      model.checklists = [...model.checklists.filter(c => c.categoryId !== categoryId), { categoryId, memberKeys: [...new Set(op.member_keys as string[])] }];
      return model;
    }
    case "checklist.clear": {
      const categoryId = resolve(op.category as Ref, "category");
      model.checklists = model.checklists.filter(c => c.categoryId !== categoryId);
      return model;
    }
    case "result_filter.add": {
      const kind = op.target_kind as ResultFilter["target"]["kind"];
      const categoryId = resolve(op.category as Ref, "category");
      const targetId = resolve(op.target as Ref, kind);
      model.resultFilters.push({ id: fresh(op.alias), categoryId, target: { kind, id: targetId }, predicate: op.predicate as ResultFilter["predicate"], value: op.value as ResultFilter["value"] });
      return model;
    }
    case "result_filter.remove": {
      const ref = op.target as Ref;
      const id = isAlias(ref) ? ctx.ids?.[ref.alias] : ref.id;
      if (!id || !model.resultFilters.some(f => f.id === id)) throw new OpError({ code: "unknown-reference", target_id: isAlias(ref) ? ref.alias : ref.id, message: "no such result filter" });
      model.resultFilters = model.resultFilters.filter(f => f.id !== id);
      return model;
    }
    default:
      throw new OpError({ code: "validation", message: `${op.op} is not available` });
  }
}

function seedFor(definition: TableDefinition, columns: readonly DatasetColumn[]): TableModelV1 {
  const draft = draftModelFor(definition, columns);
  // Keyed on a stored measure list, not on pivot existence: a no-pivot table and a stored
  // {enabled:false, grouping:[], split:[]} pivot must seed identically (empty); only a pivot that
  // carries its own measures keeps the migrated ones.
  if (definition.table.pivot?.measures !== undefined) return draft;
  return { ...draft, measures: [], layout: { ...draft.layout, values: [] } };
}

export function buildCandidate(current: TableDefinition, columns: readonly DatasetColumn[], arrangement: Arrangement, allocate: () => string = () => crypto.randomUUID()): CandidateResult {
  const definition: TableDefinition = structuredClone(current);
  const ids: Record<string, string> = {};
  const errors: ArrangeError[] = [];
  // Request-only intent, bound to the exact measure/operator; never part of TableDefinition.
  const aggregationChoices = new Map<string, AggName>();
  const aggregationOverrides = new Map<string, AggName>();
  let model: TableModelV1 | undefined = tableModelOf(definition);
  // The drawer's draft seeds a Data measure per source field when the table has no pivot to migrate;
  // Rita arranges explicitly, so that default seeding is dropped and only a real legacy pivot carries over.
  const ensureModel = () => (model ??= seedFor(definition, columns));
  const taken = () => new Set([...(model?.categories ?? []), ...(model?.measures ?? []), ...(model?.formulas ?? []), ...(model?.resultFilters ?? []), ...(model?.params.filters ?? [])].map(x => x.id));
  const fresh = (alias: unknown): string => {
    const id = allocate();
    if (taken().has(id)) throw new OpError({ code: "id-collision", target_id: id, message: `allocated id ${id} already exists` });
    if (typeof alias === "string") ids[alias] = id;
    return id;
  };
  const resolve = (ref: Ref, ...pools: Pool[]): string => {
    const id = isAlias(ref) ? ids[ref.alias] : ref.id;
    const m = ensureModel();
    const lists = { category: m.categories, measure: m.measures, formula: m.formulas };
    if (!id || !pools.some(p => lists[p].some(x => x.id === id))) {
      const name = isAlias(ref) ? ref.alias : ref.id;
      const wanted = pools.join(" or ");
      // A model kept placing field ids directly; say which operation turns the field into the object asked for.
      const message = !isAlias(ref) && columns.some(c => c.id === name)
        ? `${name} is a source field, not a ${wanted}: create one from it with ${pools.includes("category") ? "category.add" : "measure.add"} (give it an alias) earlier in this request and reference {"alias":"..."}`
        : `no ${wanted} ${name}`;
      throw new OpError({ code: "unknown-reference", target_id: name, message });
    }
    return id;
  };
  let conflicts: StatementUpdateConflict[] | undefined;
  const statementBatch: { op: Operation; index: number }[] = [];
  const statementOps = arrangement.operations.some(o => o.op.startsWith("statement."));
  let view: string | undefined;
  arrangement.operations.forEach((op, index) => {
    try {
      if (op.op.startsWith("statement.")) { statementBatch.push({ op, index }); return; }
      if (op.op.startsWith("viewer.")) throw new OpError({ code: "viewer-scope", message: "viewer controls change only in viewer mode" });
      if (op.op === "presentation.set") { applyPresentation(definition, op, columns); return; }
      if (op.op === "view.set") { view = op.view as string; return; }
      if (statementOps || isStatement(definition.analytical)) throw new OpError({ code: "validation", message: `${op.op} does not apply to a Statement; use statement.* operations` });
      const beforeMeasures = op.op === "measure.add" || op.op === "measure.duplicate"
        ? new Set(ensureModel().measures.map(measure => measure.id)) : undefined;
      model = applyModelOp(ensureModel(), op, { ids, fresh, resolve, columns });
      const chosenIds = beforeMeasures
        ? model.measures.filter(measure => !beforeMeasures.has(measure.id)).map(measure => measure.id)
        : op.op === "measure.update" && op.aggregation !== undefined ? [resolve(op.target as Ref, "measure")] : [];
      for (const id of chosenIds) {
        const aggregation = model.measures.find(measure => measure.id === id)?.aggregation;
        if (!aggregation) continue;
        aggregationChoices.set(id, aggregation);
        aggregationOverrides.delete(id);
        if (op.aggregation_intent === "user_override") aggregationOverrides.set(id, aggregation);
      }
    } catch (error) {
      if (!(error instanceof OpError)) throw error;
      errors.push(toArrangeError(error, index));
    }
  });
  if (statementBatch.length) {
    const applied = applyStatementOps(definition, statementBatch);
    errors.push(...applied.errors);
    conflicts = applied.conflicts;
    if (applied.definition) definition.analytical = applied.definition.analytical;
  }
  if (errors.length) return { ids, errors: errors.sort((a, b) => (a.operation_index ?? 0) - (b.operation_index ?? 0)), ...(conflicts?.length ? { conflicts } : {}) };
  if (model && !statementBatch.length) definition.analytical = model; // a Statement applied above must not be overwritten by the seeded/old table model
  return { definition, ids, errors, ...(view !== undefined ? { view } : {}),
    ...(aggregationChoices.size ? { aggregationChoices } : {}), ...(aggregationOverrides.size ? { aggregationOverrides } : {}) };
}
