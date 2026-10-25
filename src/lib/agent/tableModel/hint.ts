// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { BUCKET_TOKEN, suggestionFor, suggestionNote } from "../../pivotSuggestion";
import { toAggregationHint } from "../../aggregationHint";
import { capabilitiesFor } from "./capabilities";
import type { Periodicity } from "../../periodicity";
import type { FieldKind } from "../../pivotTable";
import type { TableColumn } from "../../tableColumns";
import type { CategoryDef, TableModelV1 } from "../../tableModel/types";
import type { AggName, AggregationHint, Bucket, PivotConfig } from "../../types";
import type { DatasetColumn } from "../../widgetData/types";

type FieldHint = { hint: AggregationHint; suggested: AggName | null; suggestion_note: string | null };

/** A category's period, as pivotSuggestion's buckets name it. Fiscal periods are the provider's `annual` / `quarter`. */
const BUCKET: Record<CategoryDef["transform"], Bucket> = { native: "native", Y: "year", FY: "year", Q: "quarter", FQ: "quarter", M: "month" };
const kindOf = (c: DatasetColumn): FieldKind => c.dtype === "number" ? "number" : c.dtype === "boolean" ? "boolean" : c.dtype === "date" || c.dtype === "dateString" ? "date" : c.dtype === "text" ? "text" : "none";
/** The provider's frequency tokens as this table model's date transforms; the others (1d, 1W) have no category transform. */
const TRANSFORMS: Record<string, string[]> = Object.fromEntries(Object.values(BUCKET_TOKEN).map(f => [f, (Object.keys(BUCKET) as CategoryDef["transform"][]).filter(t => BUCKET_TOKEN[BUCKET[t] as keyof typeof BUCKET_TOKEN] === f)]));
/**
 * The provider hint backendTableSource put on a column's metadata, re-validated: metadata crossed the worker and a linked table.
 * An aggregated output column (a source table's measure) no longer holds the values the hint was written for.
 */
const hintOf = (c: DatasetColumn) => c.aggregation === undefined && c.measureId === undefined ? toAggregationHint(c.metadata?.aggregationHint) : undefined;

/**
 * Each hinted field's hint and pivotSuggestion's verdict under the model's placed categories -- the same ruleset the Pivot panel reads.
 * A table model groups by categories, not fields, so its rows/columns are read back to their source fields and transforms.
 * A suggestion the drawer does not offer for the field under this model (last with two date fields) is withheld: filled in, it would be refused.
 */
export function fieldHints(model: TableModelV1 | undefined, columns: readonly DatasetColumn[], periodicity: Readonly<Record<string, Periodicity>>): Map<string, FieldHint> {
  const hinted = columns.filter(c => hintOf(c));
  if (!hinted.length) return new Map();
  const byId = new Map((model?.categories ?? []).map(c => [c.id, c]));
  const placed = (ids: string[] = []) => ids.flatMap(id => byId.get(id) ?? []);
  const rows = placed(model?.layout.rows), cols = placed(model?.layout.columns);
  // ponytail: two date categories on one field (Y and Q) keep the last bucket; per-category buckets if that pairing matters.
  const config: PivotConfig = { enabled: true, grouping: rows.map(c => c.sourceFieldId), split: cols.map(c => c.sourceFieldId), buckets: Object.fromEntries([...rows, ...cols].map(c => [c.sourceFieldId, c.legacyBucket ?? BUCKET[c.transform]])) };
  const tableColumns = columns.map(c => ({ field: c.id, header: c.label, hint: hintOf(c) }) as TableColumn);
  const kinds = new Map(columns.map(c => [c.id, kindOf(c)]));
  const native = new Map(Object.entries(periodicity));
  const header = (field: string) => columns.find(c => c.id === field)?.label ?? field;
  const allowed = capabilitiesFor(model, columns, "authoring").aggregations_by_field;
  return new Map(hinted.map(c => {
    const s = suggestionFor({ field: c.id, columns: tableColumns, kinds, periodicity: native, config });
    const hint = hintOf(c)!;
    if (s.kind === "suggested" && !(allowed[c.id] ?? []).includes(s.fn))
      return [c.id, { hint, suggested: null, suggestion_note: `The provider's ${s.fn} is not available for this field in this arrangement.` }];
    const note = suggestionNote(s, header);
    // The Pivot panel's note says why no operator is offered yet; Rita also needs what to do about it in one call:
    // first/last are listed only once a date category exists, so a describe before any grouping never offers them.
    // Only when the date grouping is what is missing: an entity note already says what to group by, and adding
    // "it applies last" there contradicts it while the entity stays ungrouped.
    const transforms = s.kind === "frequency" && hint.time ? hint.frequencies.flatMap(f => TRANSFORMS[f] ?? []) : [];
    if (!transforms.length) return [c.id, { hint, suggested: s.kind === "suggested" ? s.fn : null, suggestion_note: note }];
    const list = transforms.length > 1 ? `${transforms.slice(0, -1).join(", ")} or ${transforms.at(-1)}` : transforms[0];
    const howTo = `To follow the provider, group by a ${list} date category and leave aggregation out of measure.add in the same arrange_table call: it applies ${hint.time}.`;
    return [c.id, { hint, suggested: null, suggestion_note: note ? `${note} ${howTo}` : howTo }];
  }));
}

/**
 * One pass over the model's measures, after `fieldHints`.
 * A measure this call added without an aggregation takes the provider's operator when the call's own arrangement meets the rule:
 * the model chose it about half the time when only told the rule. Measures that already existed, and named operators, are left alone.
 * A measure whose operator contradicts its field's suggestion is still applied -- the choice is the user's or Rita's -- but named.
 * Returns the applied notices, then the warnings.
 */
export function providerOperators(model: TableModelV1, previous: TableModelV1 | undefined, columns: readonly DatasetColumn[], periodicity: Readonly<Record<string, Periodicity>>) {
  const existing = new Set((previous?.measures ?? []).map(m => m.id));
  const hints = fieldHints(model, columns, periodicity);
  const applied: unknown[] = [], warnings: unknown[] = [];
  for (const m of model.measures) {
    const suggested = hints.get(m.sourceFieldId)?.suggested;
    if (!suggested) continue;
    if (!m.aggregation && !existing.has(m.id)) {
      m.aggregation = suggested;
      applied.push({ severity: "info", code: "provider-aggregation-applied", target_id: m.id, message: `${m.sourceFieldId}: ${suggested} applied, the provider's operator for this column` });
    } else if (m.aggregation && suggested !== m.aggregation)
      warnings.push({ severity: "warning", code: "provider-aggregation-hint", target_id: m.id, message: `${m.sourceFieldId}: ${m.aggregation} chosen, but the provider suggests ${suggested} for this column` });
  }
  return [...applied, ...warnings];
}
