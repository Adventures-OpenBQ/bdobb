// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { TableModelV1 } from "./tableModel/types";
import type { FieldKind } from "./pivotTable";
import type { AggName, Bucket, PivotConfig } from "./types";

/** The legacy panel lists use columnOrder; independent Data instances use measures. */
export type PivotList = "grouping" | "split" | "data";

/**
 * What every edit returns: the whole next config, plus a new column order when
 * the edit moved something within or into Data Columns. One object, so the
 * caller makes ONE patch and the dashboard is written once per drop.
 */
export type PivotPatch = { pivot: PivotConfig; columnOrder?: string[] };

export const EMPTY_PIVOT: PivotConfig = { enabled: false, grouping: [], split: [] };

/**
 * The two group lists as the engine and the panel use them: only fields the
 * data has, no duplicates, and a field in both lists kept in the first. The
 * stored config is NOT rewritten — a column a parameter change dropped comes
 * back into its group when the column does.
 */
export function activeLists(
  config: PivotConfig,
  known: ReadonlySet<string>,
): { grouping: string[]; split: string[] } {
  const taken = new Set<string>();
  const keep = (fields: string[]) =>
    fields.filter((f) => {
      if (!known.has(f) || taken.has(f)) return false;
      taken.add(f);
      return true;
    });
  return { grouping: keep(config.grouping), split: keep(config.split) };
}

export function isPivoting(config: PivotConfig | undefined, known: ReadonlySet<string>): boolean {
  if (!config?.enabled) return false;
  const { grouping, split } = activeLists(config, known);
  return grouping.length + split.length > 0;
}

/** Data Columns: the column order, minus whatever is grouped. */
export function dataFieldsOf(order: string[], config: PivotConfig): string[] {
  const grouped = new Set([...config.grouping, ...config.split]);
  return order.filter((f) => !grouped.has(f));
}

const clamp = (index: number, length: number) => Math.max(0, Math.min(index, length));

/**
 * Move `field` to `index` of list `to`. `index` counts positions in the target
 * list AFTER the field has been taken out of wherever it was — which is what a
 * drop indicator between the OTHER pills naturally measures.
 *
 * Into a group list switches the pivot on: someone building a grouping wants
 * to see it. A field's aggregation and bucket are kept while it is grouped, so
 * dragging it back restores them.
 *
 * Into Data Columns rewrites columnOrder and nothing else: the field is placed
 * before whichever data column currently sits at `index`, and the grouped
 * fields keep their own slots in the order. `index` counts positions in Data
 * Columns ALONE — a still-grouped field can trail the last real data column
 * in columnOrder, and a drop past the end must land before that trailing
 * grouped field, not after it.
 */
export function moveField(
  config: PivotConfig,
  order: string[],
  field: string,
  to: PivotList,
  index: number,
): PivotPatch {
  const grouping = config.grouping.filter((f) => f !== field);
  const split = config.split.filter((f) => f !== field);
  const next: PivotConfig = { ...config, grouping, split };

  if (to !== "data") {
    const list = to === "grouping" ? grouping : split;
    list.splice(clamp(index, list.length), 0, field);
    next.enabled = true;
    return { pivot: next };
  }

  const rest = order.filter((f) => f !== field);
  // `index` is clamped against the DATA list's own length, not `rest`'s —
  // `rest` still carries any grouped field that trails the last data column.
  const dataFields = dataFieldsOf(rest, next);
  const anchor = dataFields[clamp(index, dataFields.length)];
  const at =
    anchor !== undefined
      ? rest.indexOf(anchor)
      : dataFields.length > 0
        ? rest.indexOf(dataFields[dataFields.length - 1]) + 1
        : 0;
  rest.splice(at, 0, field);
  return { pivot: next, columnOrder: rest };
}

/**
 * fromEntries, never `{ ...map, [field]: value }`: a field named "__proto__"
 * must land as an own property. An emptied map is removed rather than kept as
 * `{}`, so a config that says nothing leaves no residue.
 */
function withEntry<T>(
  map: Record<string, T> | undefined,
  field: string,
  value: T | null,
): Record<string, T> | undefined {
  const entries = Object.entries(map ?? {}).filter(([f]) => f !== field);
  if (value !== null) entries.push([field, value]);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function without<K extends keyof PivotConfig>(config: PivotConfig, key: K): PivotConfig {
  const next = { ...config };
  delete next[key];
  return next;
}

export function setAggregation(config: PivotConfig, field: string, fn: AggName | null): PivotPatch {
  const aggregationFns = withEntry(config.aggregationFns, field, fn);
  return {
    pivot: aggregationFns ? { ...config, aggregationFns } : without(config, "aggregationFns"),
  };
}

/** `native` is stored as absence, like every other default in the table state. */
export function setBucket(config: PivotConfig, field: string, bucket: Bucket): PivotPatch {
  const buckets = withEntry(config.buckets, field, bucket === "native" ? null : bucket);
  return { pivot: buckets ? { ...config, buckets } : without(config, "buckets") };
}

/** An absent path is OPEN; only an explicit false folds. See PivotConfig. */
export function isOpen(config: PivotConfig, path: string): boolean {
  const { expanded } = config;
  if (config.keyEncoding !== "typed-v1" || expanded === undefined || expanded === true) return true;
  return !(Object.hasOwn(expanded, path) && expanded[path] === false);
}

export function toggleExpanded(config: PivotConfig, path: string): PivotPatch {
  const legacyExpanded = config.keyEncoding === "typed-v1"
    ? config.legacyExpanded
    : config.expanded && config.expanded !== true ? { ...config.expanded, ...config.legacyExpanded } : config.legacyExpanded;
  const current = config.keyEncoding === "typed-v1" && config.expanded !== true ? config.expanded : undefined;
  const expanded = withEntry(current, path, isOpen(config, path) ? false : null);
  const next: PivotConfig = { ...config, keyEncoding: "typed-v1", legacyExpanded };
  if (expanded) next.expanded = expanded;
  else delete next.expanded;
  return { pivot: next };
}

/**
 * "Clear groups". An explicit empty config rather than removing `pivot`: with
 * `pivot` absent the widget's own preset is the effective one, and the groups
 * the user just cleared would come straight back.
 */
export function clearedPivot(): PivotPatch {
  return { pivot: { enabled: false, grouping: [], split: [] } };
}

/**
 * A field's aggregation and bucket, read the one way: by computed key, only
 * through `Object.hasOwn`. Task 4's engine and Task 6's panel would otherwise
 * each write this same pair of lookups — the config comes off `JSON.parse`d
 * app state, by way of `toPivot`, so a payload naming a field `__proto__`
 * must not resolve through the prototype chain instead of coming back absent.
 */
export function aggregationOf(config: PivotConfig, field: string): AggName | undefined {
  const fns = config.aggregationFns;
  return fns && Object.hasOwn(fns, field) ? fns[field] : undefined;
}

/** Same reading rule as `aggregationOf`; a bucket that was never set is `native`. */
export function bucketOf(config: PivotConfig, field: string): Bucket {
  const buckets = config.buckets;
  return buckets && Object.hasOwn(buckets, field) ? buckets[field] : "native";
}

/** Arithmetic is for numbers; everything else works on any value. */
const NUMERIC_ONLY: ReadonlySet<AggName> = new Set<AggName>(["sum", "mean", "median"]);
const AGG_ORDER: AggName[] = ["sum", "mean", "median", "min", "max", "first", "last", "count", "uniqueCount"];

/**
 * The aggregations the panel's menu offers a column, in menu order. The one
 * place this rule lives: PivotPanel draws it, and Rita's arrange_table accepts
 * exactly it, so what the panel would let a hand pick is what the tool lets
 * the model pick.
 */
export function legalAggregations(kind: FieldKind, hasDate: boolean): AggName[] {
  return AGG_ORDER.filter((fn) => {
    if (NUMERIC_ONLY.has(fn)) return kind === "number";
    if (fn === "first" || fn === "last") return hasDate;
    if (fn === "min" || fn === "max") return kind !== "none";
    return true;
  });
}

/** Categories are already derived. Never bucket synthetic labels a second time or infer operators. */
export function categoryPivotConfig(model: Pick<TableModelV1, 'layout' | 'measures'>): PivotConfig {
  return { enabled: true, grouping: [...model.layout.rows], split: [...model.layout.columns], measures: model.measures.map(measure => ({ ...measure })), keyEncoding: 'typed-v1' };
}
