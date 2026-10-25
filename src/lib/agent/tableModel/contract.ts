// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { AGG_NAMES } from "../../types";
import { CATEGORY_TRANSFORMS, RESULT_PREDICATES } from "../../tableModel/validation";
import { isRecord } from "../../isRecord";
import type { StatementUpdateConflict } from "../../statementModel/updates";

export const TABLE_MODEL_CONTRACT = "table-model/1";
export const ARRANGE_LIMITS = { operations: 64, stringBytes: 4096, listItems: 1024 } as const;
export type Ref = { id: string } | { alias: string };
export const isAlias = (r: Ref): r is { alias: string } => "alias" in r;

type Rule = "string" | "boolean" | "ref" | "refs" | "strings" | "stringsOrNull" | "scalar" | "object" | "array" | readonly string[];
export const SCOPES = ["source", "aggregate"] as const;
export const AGGREGATION_INTENTS = ["user_override"] as const;
const KINDS = ["measure", "formula"] as const;
export const TEMPLATES = ["income", "balance", "cashflow"] as const;
export const PERIODS = ["FY", "FQ"] as const;

/** The whole authorable surface. Semantics are checked later by the drawer's own validators. */
export const OPERATIONS = {
  "category.add": { required: { name: "string", source_field_id: "string", transform: CATEGORY_TRANSFORMS }, optional: { alias: "string", fiscal_binding: "object" }, creates: true },
  "category.update": { required: { target: "ref" }, optional: { name: "string", transform: CATEGORY_TRANSFORMS, fiscal_binding: "object" } },
  "category.remove": { required: { target: "ref" }, optional: {} },
  "measure.add": { required: { source_field_id: "string" }, optional: { alias: "string", aggregation: AGG_NAMES, aggregation_intent: AGGREGATION_INTENTS, label: "string" }, creates: true },
  "measure.duplicate": { required: { target: "ref" }, optional: { alias: "string", aggregation_intent: AGGREGATION_INTENTS }, creates: true },
  "measure.update": { required: { target: "ref" }, optional: { aggregation: AGG_NAMES, aggregation_intent: AGGREGATION_INTENTS, label: "string" } },
  "measure.remove": { required: { target: "ref" }, optional: {} },
  "formula.set": { required: { target: "ref", name: "string", scope: SCOPES, expression: "string", bindings: "object" }, optional: { members: "array", format: "string" } },
  "formula.remove": { required: { target: "ref" }, optional: {} },
  "layout.set": { required: {}, optional: { rows: "refs", columns: "refs", values: "refs" } },
  "page.set": { required: { category: "ref", member_keys: "strings" }, optional: {} },
  "page.clear": { required: {}, optional: {} },
  "checklist.set": { required: { category: "ref", member_keys: "strings" }, optional: {} },
  "checklist.clear": { required: { category: "ref" }, optional: {} },
  "result_filter.add": { required: { category: "ref", target: "ref", target_kind: KINDS, predicate: RESULT_PREDICATES, value: "scalar" }, optional: { alias: "string" }, creates: true },
  "result_filter.remove": { required: { target: "ref" }, optional: {} },
  "totals.set": { required: {}, optional: { grand_total: "boolean", groups: "boolean" } },
  "control.promote": { required: { category: "ref", label: "string", multi_select: "boolean" }, optional: {} },
  "control.demote": { required: { category: "ref" }, optional: {} },
  "control.promote_page": { required: { enabled: "boolean" }, optional: {} },
  "model.enable": { required: { enabled: "boolean" }, optional: {} },
  "presentation.set": { required: {}, optional: { sorting: "array", column_order: "strings", hidden: "strings" } },
  // The card's view (one of describe_table's `views`); "table" is the default view.
  "view.set": { required: { view: "string" }, optional: {} },
  "statement.apply": { required: { template_id: TEMPLATES, template_version: "string", bindings: "object", period_kind: PERIODS }, optional: {} },
  "statement.override": { required: {}, optional: { labels: "object", line_order: "object", section_order: "strings", hidden_ids: "strings" } },
  "statement.reset": { required: {}, optional: { id: "string" } },
  "statement.update_template": { required: { template_version: "string" }, optional: {} },
  "viewer.set": { required: { key: "string", member_keys: "stringsOrNull" }, optional: {} },
  "viewer.reset": { required: {}, optional: { key: "string" } },
} as const satisfies Record<string, { required: Record<string, Rule>; optional: Record<string, Rule>; creates?: boolean }>;
export type OperationName = keyof typeof OPERATIONS;
export type Operation = { op: OperationName } & Record<string, unknown>;
export type Arrangement = { contract: typeof TABLE_MODEL_CONTRACT; operations: Operation[] };
export type ArrangeErrorCode = "invalid-envelope" | "unknown-operation" | "invalid-field" | "duplicate-alias" | "unknown-reference" | "id-collision" | "validation" | "viewer-scope" | "calculation" | "provider-override-required";
export type ArrangeError = { code: ArrangeErrorCode; operation_index?: number; target_id?: string; path?: string; message: string; alternatives?: string[]; affected_ids?: string[] };
/** One operation's refusal; `conflicts` rides along for a Statement template update. */
export class OpError extends Error { constructor(readonly detail: Omit<ArrangeError, "operation_index">, readonly conflicts?: StatementUpdateConflict[]) { super(detail.message); } }
/** The refusal as the error list reports it, at operation `index`. */
export const toArrangeError = (error: OpError, index: number): ArrangeError => ({ ...error.detail, operation_index: index, path: error.detail.path ?? `operations[${index}]` });

const bytes = (s: string) => new TextEncoder().encode(s).length;
const okString = (v: unknown): v is string => typeof v === "string" && v !== "" && bytes(v) <= ARRANGE_LIMITS.stringBytes;
const okStrings = (v: unknown): v is string[] => Array.isArray(v) && v.length <= ARRANGE_LIMITS.listItems && v.every(okString) && new Set(v).size === v.length;
const okRef = (v: unknown): v is Ref => isRecord(v) && Object.keys(v).length === 1 && (okString(v.id) || okString(v.alias));

function check(rule: Rule, v: unknown): boolean {
  if (typeof rule !== "string") return typeof v === "string" && rule.includes(v);
  switch (rule) {
    case "string": return okString(v);
    case "boolean": return typeof v === "boolean";
    case "ref": return okRef(v);
    case "refs": return Array.isArray(v) && v.length <= ARRANGE_LIMITS.listItems && v.every(okRef);
    case "strings": return okStrings(v);
    case "stringsOrNull": return v === null || okStrings(v);
    case "scalar": return v === null || typeof v === "boolean" || typeof v === "string" || (typeof v === "number" && Number.isFinite(v));
    case "object": return isRecord(v) && JSON.stringify(v).length <= 64 * 1024;
    case "array": return Array.isArray(v) && v.length <= ARRANGE_LIMITS.listItems;
  }
}

/** Strict structural pass only; unknown fields, operations and aliases are errors. */
export function parseArrangement(raw: unknown): { arrangement?: Arrangement; errors: ArrangeError[] } {
  const errors: ArrangeError[] = [];
  if (!isRecord(raw)) return { errors: [{ code: "invalid-envelope", path: "", message: "arrangement must be an object" }] };
  for (const key of Object.keys(raw)) if (key !== "contract" && key !== "operations") errors.push({ code: "invalid-envelope", path: key, message: `unknown field ${key}` });
  if (raw.contract !== TABLE_MODEL_CONTRACT) errors.push({ code: "invalid-envelope", path: "contract", message: `contract must be "${TABLE_MODEL_CONTRACT}"` });
  const ops = raw.operations;
  if (!Array.isArray(ops) || ops.length > ARRANGE_LIMITS.operations) {
    errors.push({ code: "invalid-envelope", path: "operations", message: `operations must be an array of at most ${ARRANGE_LIMITS.operations}` });
    return { errors };
  }
  const aliases = new Set<string>();
  /** Refs with the field path that held them: top-level refs/ref arrays, formula bindings[*].ref and members[*].category. */
  const refsIn = (op: Record<string, unknown>): { ref: Ref; path: string }[] => {
    const out: { ref: Ref; path: string }[] = [];
    for (const [k, v] of Object.entries(op)) {
      if (okRef(v)) out.push({ ref: v, path: k });
      else if (Array.isArray(v)) v.forEach((e, j) => { if (okRef(e)) out.push({ ref: e, path: `${k}[${j}]` }); else if (k === "members" && isRecord(e) && okRef(e.category)) out.push({ ref: e.category, path: `${k}[${j}].category` }); });
      else if (k === "bindings" && isRecord(v)) for (const [name, b] of Object.entries(v)) if (isRecord(b) && okRef(b.ref)) out.push({ ref: b.ref, path: `bindings.${name}.ref` });
    }
    return out;
  };
  ops.forEach((op, i) => {
    const at = (field: string) => `operations[${i}].${field}`;
    if (!isRecord(op) || typeof op.op !== "string" || !Object.hasOwn(OPERATIONS, op.op)) {
      errors.push({ code: "unknown-operation", operation_index: i, path: at("op"), message: "unknown operation", alternatives: Object.keys(OPERATIONS) });
      return;
    }
    const spec = OPERATIONS[op.op as OperationName];
    const rules: Record<string, Rule> = { ...spec.required, ...spec.optional };
    for (const key of Object.keys(op)) {
      if (key === "op") continue;
      const rule = Object.hasOwn(rules, key) ? rules[key] : undefined;
      if (!rule) { errors.push({ code: "invalid-field", operation_index: i, path: at(key), message: `${op.op} has no field ${key}`, alternatives: Object.keys(rules) }); continue; }
      if (!check(rule, op[key])) errors.push({ code: "invalid-field", operation_index: i, path: at(key), message: `invalid ${key}${rule === "ref" || rule === "refs" ? `: ${rule === "refs" ? "an array of " : ""}objects {"id":"..."} for an existing object or {"alias":"..."} for one created earlier in this request, not bare strings` : ""}`, ...(typeof rule !== "string" ? { alternatives: [...rule] } : {}) });
    }
    for (const key of Object.keys(spec.required)) if (!(key in op)) errors.push({ code: "invalid-field", operation_index: i, path: at(key), message: `${key} is required` });
    if ((op.op === "measure.add" || op.op === "measure.update") && op.aggregation_intent !== undefined && op.aggregation === undefined)
      errors.push({ code: "invalid-field", operation_index: i, path: at("aggregation_intent"), message: "user_override intent requires an explicit aggregation on this measure operation" });
    for (const { ref, path } of refsIn(op)) if (isAlias(ref) && !aliases.has(ref.alias) && !(op.op === "formula.set" && op.target === ref))
      errors.push({ code: "unknown-reference", operation_index: i, path: at(path), message: `alias ${ref.alias} is not declared by an earlier operation` });
    const declared = op.op === "formula.set" && okRef(op.target) && isAlias(op.target) ? op.target.alias : "creates" in spec && typeof op.alias === "string" ? op.alias : undefined;
    if (declared !== undefined) {
      if (aliases.has(declared)) errors.push({ code: "duplicate-alias", operation_index: i, path: at("alias"), message: `alias ${declared} is declared twice` });
      aliases.add(declared);
    }
  });
  return errors.length ? { errors } : { arrangement: raw as Arrangement, errors };
}
