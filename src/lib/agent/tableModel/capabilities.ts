// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { AGG_NAMES } from "../../types";
import { CATEGORY_TRANSFORMS, RESULT_PREDICATES } from "../../tableModel/validation";
import { FORMULA_BINARY_OPERATORS } from "../../tableModel/formulaSyntax";
import { INSTALLED_STATEMENT_TEMPLATES } from "../../statementModel/catalog";
import { paramRow } from "../../tableModel/pivotParams";
import { measureEligibility } from "../../../components/renderers/table-model/measureEligibility";
import { OPERATIONS, PERIODS, SCOPES } from "./contract";
import type { TableModelV1 } from "../../tableModel/types";
import type { DatasetColumn } from "../../widgetData/types";

export type Capabilities = ReturnType<typeof capabilitiesFor>;
const EMPTY: TableModelV1 = { schemaVersion: 1, enabled: true, params: { promotePage: false, filters: [] }, categories: [], measures: [], formulas: [], layout: { rows: [], columns: [], values: [] }, checklists: [], resultFilters: [], subtotals: { grandTotal: false, groups: false } };
const VIEWER_OPS = ["viewer.set", "viewer.reset"];
const req = (op: keyof typeof OPERATIONS) => Object.keys(OPERATIONS[op].required).join(", ");
const NATIVE: (typeof CATEGORY_TRANSFORMS)[number] = "native";
/** The field / category / measure roles in a few lines, built from OPERATIONS; live Rita kept placing field ids directly. */
const HOW_TO_ARRANGE = [
  "A field (fields[].id) is a source column. It is never placed directly: make a category or a measure from it first.",
  `category.add {${req("category.add")}, alias} makes a category (a grouping) from the field source_field_id; transform comes from category_transforms ("${NATIVE}" groups by the field's own values).`,
  `measure.add {${req("measure.add")}, aggregation, alias} makes a measure (one number per group) from the field source_field_id; aggregation must be listed in aggregations_by_field for that field; on a field with a provider hint, leave it out and arrange_table applies the provider's operator when the arrangement meets its rule. A field with no "sum" there cannot be summed: say so instead of arranging.`,
  "first/last become available when the arrangement's date categories (Y/Q/M/FY/FQ) all sit on exactly one field, with at most one fiscal company; add that category in the same call.",
  "layout.set places objects: rows and columns take categories, values take measures or formulas. Each entry is {\"alias\":\"...\"} for an object created earlier in the same request or {\"id\":\"...\"} for an existing one listed in the model summary (its categories, measures and formulas), never a field id.",
  "Send every operation in one arrange_table call. Quote only numbers that are values in the result's preview.rows. The grand total and the row count are not there: never work them out; state the source table's row count only as describe_table's exact completeness.totalRowCount. For a read-only ask pass mode \"preview\": nothing is committed.",
];

/** Everything here is read from the shared validators/constants the drawer uses; no private legal lists. */
export function capabilitiesFor(model: TableModelV1 | undefined, columns: readonly DatasetColumn[], mode: "authoring" | "viewer") {
  const m = model ?? EMPTY;
  const eligibility = columns.map(c => [c.id, measureEligibility({ model: m, columns, sourceFieldId: c.id })] as const);
  const operations = mode === "viewer" ? VIEWER_OPS : Object.keys(OPERATIONS).filter(op => !VIEWER_OPS.includes(op));
  return {
    how_to_arrange: mode === "viewer" ? undefined : HOW_TO_ARRANGE,
    operations,
    /** The fields each operation takes (reference fields take {id} or {alias} objects), so a caller need not guess them. */
    operation_fields: Object.fromEntries(operations.map(op => [op, { required: Object.keys(OPERATIONS[op as keyof typeof OPERATIONS].required), optional: Object.keys(OPERATIONS[op as keyof typeof OPERATIONS].optional) }])),
    category_transforms: CATEGORY_TRANSFORMS.map(transform => ({ transform, requires_fiscal_binding: transform === "FY" || transform === "FQ" })),
    aggregations_by_field: Object.fromEntries(eligibility.map(([id, e]) => [id, [...e.operators]])) as Record<string, string[]>,
    chronology: eligibility[0]?.[1].chronology ?? false,
    // 'IF' and unary +/- are the literal FormulaAst members (types.ts); formulaSyntax holds no runtime list for them.
    formula: { functions: [...AGG_NAMES, "IF"], binary_operators: [...FORMULA_BINARY_OPERATORS], unary_operators: ["+", "-"], scopes: [...SCOPES], binding_targets: ["field", "formula", "measure"] },
    filters: [
      { stage: "source" as "source" | "result", operation: "checklist.set", meaning: "restricts which source observations every calculation uses", predicates: undefined as string[] | undefined },
      { stage: "result" as "source" | "result", operation: "result_filter.add", meaning: "decides which calculated groups are presented", predicates: [...RESULT_PREDICATES] as string[] | undefined },
    ],
    page: { max_categories: 1 as const, selection: "the complete selected member set; an empty list is None" },
    statement: { templates: INSTALLED_STATEMENT_TEMPLATES.map(t => ({ ...t })), period_kinds: [...PERIODS] },
    viewer_controls: paramRow(m).map(p => ({ key: p.key, category_id: p.categoryId, label: p.label, multi_select: p.multiSelect, source: p.source })),
  };
}
