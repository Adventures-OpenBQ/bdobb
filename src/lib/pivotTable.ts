// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { bucketKey, bucketLabel, detectPeriodicity, expectedCount } from "./periodicity";
import type { CategoryMetadata } from "./tableModel/categories";
import { resolveMeasures } from "./tableModel/measureMigration";
import { measureLabel } from "./tableModel/measures";
import type { PivotMeasure } from "./types";
import { KEY_SEP, pivotValueKey } from "./pivotKeys";
import {
  activeLists,
  bucketOf,
  isOpen,
  isPivoting,
} from "./pivotConfig";
import type { Row, TableColumn } from "./tableColumns";
import { accessorFor } from "./tableFiltering";
import type { AggName, Bucket, PivotConfig, TableSort } from "./types";

export { KEY_SEP };
/**
 * The synthetic first column: a group's label, its fold, its count.
 *
 * Prefixed with U+001E, the record separator, and NOT with KEY_SEP: a split
 * column's id is `comboId + KEY_SEP + field`. The label stays distinct
 * from split columns even when the split key is blank.
 */
export const LABEL_FIELD = "\x1egroup";
/** Verbatim from the spec. Past this the engine refuses rather than hangs the webview. */
export const MAX_PIVOT_COLUMNS = 500;
export const BLANK_LABEL = "(blank)";
export const TOTAL_LABEL = "Total";

/** Structurally TableFilterRow's FilterKind, restated so `lib` imports nothing from `components`. */
export type FieldKind = "text" | "number" | "date" | "boolean" | "none";

export type PivotRowMeta =
  | {
      kind: "group";
      depth: number;
      /** Group keys from the root, joined by KEY_SEP. The key `expanded` is read by. */
      path: string;
      label: string;
      /** Source rows beneath this group, at every depth. */
      count: number;
      /** False for the deepest group under a split: it has nothing to unfold. */
      expandable: boolean;
      open: boolean;
      /** A calendar bucket holding fewer native observations than a full one. */
      incomplete?: { have: number; expected: number };
    }
  | { kind: "leaf"; depth: number; sourceIndex?: number }
  | { kind: "total"; depth: 0; label: string; count: number };

/**
 * A column of the pivoted table. `groupPath` is the split headers above it,
 * outermost first (empty when there is no split); `source` is the field it
 * was made from, which is what formatting heuristics keyed on a column NAME
 * must be given instead of the synthetic id.
 */
export type PivotColumn = TableColumn & { groupPath: string[]; source?: string; measureId?: string; aggregation?: AggName; splitKeys?: string[] };

export type PivotInput = {
  /** Compiler-derived dimensions; raw source dates remain available for completeness checks. */
  categoryMetadata?: ReadonlyMap<string, CategoryMetadata>;
  /** Presentation/export may request the existing explicit aggregate total without groups. */
  aggregateOnly?: boolean;
  /** Rows that already survived the column filters. */
  rows: Row[];
  /** Every source column, hidden ones included. */
  columns: TableColumn[];
  kinds: ReadonlyMap<string, FieldKind>;
  /** The VISIBLE column order: a hidden column stays hidden under a pivot. */
  order: string[];
  config: PivotConfig;
  sorting: readonly TableSort[];
};

export type PivotResult =
  | { ok: true; rows: Row[]; meta: PivotRowMeta[]; columns: PivotColumn[] }
  | { ok: false; reason: string };

/** Object.hasOwn, as everywhere a row is read by a computed key: it came from JSON.parse. */
const read = (row: Row, field: string): unknown =>
  Object.hasOwn(row, field) ? row[field] : undefined;

const missing = (v: unknown): boolean => v === null || v === undefined || v === "";

/**
 * `numeric: true` so a count — emitted as a string, see `aggregate` — still
 * orders 9 before 30. Case-insensitive, as the table's own text sort is.
 */
const TEXT_ORDER = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** Ascending, missing last. */
function compareValues(a: unknown, b: unknown): number {
  const am = missing(a);
  const bm = missing(b);
  if (am || bm) return am === bm ? 0 : am ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return TEXT_ORDER.compare(String(a), String(b));
}

/** Missing sorts last in BOTH directions, which is the table's own rule (sortingFnFor). */
export function compareSorted(a: unknown, b: unknown, desc: boolean): number {
  if (missing(a) || missing(b)) return compareValues(a, b);
  return desc ? -compareValues(a, b) : compareValues(a, b);
}

/**
 * One cell of a group row. Nulls are skipped everywhere; with nothing left the
 * answer is undefined and the cell is blank — except the two counts, for which
 * zero is an answer.
 *
 * The counts are returned as STRINGS. Every formatter in formatCell passes a
 * string through untouched and no colour rule fires on one, so a count in a
 * normalizedPercent column renders "30" rather than "3,000 %".
 *
 * `first` / `last` order by the table's date column and pass over rows whose
 * own value is null; among equal dates the source order decides. Array sort is
 * stable, so `first` takes the earliest-in-source of the earliest date and
 * `last`, reading the same order from the other end, the latest-in-source of
 * the latest.
 */
export function aggregate(
  fn: AggName,
  rows: Row[],
  field: string,
  dateField: string | undefined,
): unknown {
  return aggregateValues(fn, rows.map(row => read(row, field)), dateField === undefined ? undefined : rows.map(row => read(row, dateField)));
}

/** Values are read once per source binding in a scope, then operators work independently. */
function aggregateValues(fn: AggName, sourceValues: unknown[], dates?: unknown[]): unknown {
  if (fn === "first" || fn === "last") {
    if (dates === undefined) return undefined;
    const dated = sourceValues.map((value, i) => ({ value, date: dates[i] }))
      .filter(item => !missing(item.date) && !missing(item.value))
      .sort((a, b) => compareValues(a.date, b.date));
    return (fn === "first" ? dated[0] : dated.at(-1))?.value;
  }
  const values = sourceValues.filter(v => !missing(v));
  if (fn === "count") return String(values.length);
  if (fn === "uniqueCount") return String(new Set(values.map(String)).size);
  if (values.length === 0) return undefined;
  if (fn === "min") return values.reduce((a, b) => (compareValues(b, a) < 0 ? b : a));
  if (fn === "max") return values.reduce((a, b) => (compareValues(b, a) > 0 ? b : a));

  const numbers = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (numbers.length === 0) return undefined;
  if (fn === "sum") return numbers.reduce((a, b) => a + b, 0);
  if (fn === "mean") return numbers.reduce((a, b) => a + b, 0) / numbers.length;
  // median
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

type Group = { key: string; raw: unknown; rows: Row[] };
type Described = { label: string; incomplete?: { have: number; expected: number } };

export function pivotTable(input: PivotInput): PivotResult | null {
  const { rows, columns, kinds, order, config, sorting } = input;
  const byField = new Map(columns.map((c) => [c.field, c]));
  const known = new Set(byField.keys());
  if (!isPivoting(config, known) && !(input.aggregateOnly && config.enabled)) return null;

  const { grouping, split } = activeLists(config, known);
  const measures = resolveMeasures({ ...config, grouping, split }, [], order)
    .filter(measure => known.has(measure.sourceFieldId) && (config.measures !== undefined || order.includes(measure.sourceFieldId)));
  const dateField = columns.find((c) => kinds.get(c.field) === "date")?.field;
  const headerOf = (field: string) => byField.get(field)?.header ?? field;

  // A stored bucket only applies to a field the data says is a date: a column
  // whose kind changed under a parameter keeps its bucket in the config, but
  // groups by its plain values until it is a date again.
  const bucketFor = (field: string): Bucket =>
    kinds.get(field) === "date" ? bucketOf(config, field) : "native";

  /** All blank values share one typed identity; display labels remain raw. */
  const keyOf = (row: Row, field: string): { key: string; raw: unknown } => {
    // The cell's displayed value: a hoverCard column groups by its cellField, as the table shows it.
    const shown = accessorFor(byField.get(field)!)(row);
    // No declared key: an object with a scalar `value` groups by it, as the
    // worker does for local files (#17, user ruling 2026-10-09).
    const inner = typeof shown === "object" && shown !== null && Object.hasOwn(shown, "value") ? (shown as Record<string, unknown>).value : undefined;
    const value = ["string", "number", "boolean", "bigint"].includes(typeof inner) ? inner : shown;
    if (missing(value)) return { key: pivotValueKey(null), raw: undefined };
    const bucket = bucketFor(field);
    if (bucket !== "native") {
      const key = bucketKey(String(value), bucket);
      if (key !== null) return { key: pivotValueKey(key), raw: key };
    }
    return { key: pivotValueKey(value), raw: value };
  };

  /** Groups of `field`, keys ascending, blank last. */
  const partition = (subset: Row[], field: string): Group[] => {
    const groups = new Map<string, Group>();
    for (const row of subset) {
      const { key, raw } = keyOf(row, field);
      const group = groups.get(key);
      if (group) group.rows.push(row);
      else groups.set(key, { key, raw, rows: [row] });
    }
    return [...groups.values()].sort((a, b) => compareValues(a.raw, b.raw));
  };

  // Detected once per bucketed date field, over ALL the rows: a group's own
  // handful of dates says nothing about how often the series reports.
  const periodicity = new Map(
    [...grouping, ...split]
      .filter((f) => (input.categoryMetadata?.get(f)?.bucket ?? bucketFor(f)) !== "native")
      .map((f) => [f, input.categoryMetadata?.get(f)?.periodicity ?? detectPeriodicity(rows.map((r) => read(r, f)))] as const),
  );

  const describe = (field: string, group: Group): Described => {
    if (missing(group.raw)) return { label: BLANK_LABEL };
    const category = input.categoryMetadata?.get(field);
    const bucket = category?.bucket ?? bucketFor(field);
    const label = bucket === "native" ? String(group.raw) : bucketLabel(String(group.raw), bucket);
    const native = periodicity.get(field);
    const expected = native === undefined ? undefined : expectedCount(native, bucket);
    if (expected === undefined) return { label };
    const have = new Set(
      group.rows
        .map((r) => read(r, category?.sourceFieldId ?? field))
        .filter((v) => !missing(v))
        .map((v) => String(v).slice(0, 10)),
    ).size;
    return have < expected ? { label, incomplete: { have, expected } } : { label };
  };

  // ---- Column Groups: the combinations that occur, in order -----------------
  type Combo = { id: string; labels: string[] };
  const combos: Combo[] = [];
  const walkSplit = (subset: Row[], depth: number, id: string, labels: string[]) => {
    if (depth === split.length) {
      combos.push({ id, labels });
      return;
    }
    for (const group of partition(subset, split[depth])) {
      const { label, incomplete } = describe(split[depth], group);
      // A header is a plain string, so the marker rides in the text here;
      // a ROW group carries it in meta instead and keeps its label clean.
      const text = incomplete ? `${label} (${incomplete.have} of ${incomplete.expected})` : label;
      walkSplit(
        group.rows,
        depth + 1,
        depth === 0 ? group.key : `${id}${KEY_SEP}${group.key}`,
        [...labels, text],
      );
    }
  };
  if (split.length > 0) walkSplit(rows, 0, "", []);
  const comboIdOf = (row: Row) => split.map((f) => keyOf(row, f).key).join(KEY_SEP);

  // The synthetic label is rendered in every pivot, including row-only pivots.
  const columnCount = 1 + (split.length > 0 ? combos.length * measures.length : measures.length);
  if (columnCount > MAX_PIVOT_COLUMNS) {
    return {
      ok: false,
      reason: split.length > 0
        ? `Column Groups on ${split.map(headerOf).join(", ")} would make ${columnCount} columns (the limit is ${MAX_PIVOT_COLUMNS}). Pick a coarser bucket, or move a field to Row Groups.`
        : `Row Groups would make ${columnCount} columns (the limit is ${MAX_PIVOT_COLUMNS}). Hide or remove data columns.`,
    };
  }

  // ---- One group row's cells -----------------------------------------------
  // fromEntries, never a computed-key spread: a field named "__proto__" must
  // land as an own property.
  const valuesFor = (subset: Row[], label: string): Row => {
    const entries: [string, unknown][] = [[LABEL_FIELD, label]];
    const fill = (rowsOf: Row[], prefix: string) => {
      const values = new Map<string, unknown[]>();
      const dates = dateField === undefined ? undefined : rowsOf.map(row => read(row, dateField));
      for (const measure of measures) {
        if (measure.aggregation === undefined) continue;
        let source = values.get(measure.sourceFieldId);
        if (!source) {
          source = measure.sourceFieldId === dateField ? dates! : rowsOf.map(row => read(row, measure.sourceFieldId));
          values.set(measure.sourceFieldId, source);
        }
        const value = aggregateValues(measure.aggregation, source, dates);
        // A group with no value keeps the key as null (missing), not absent: a linked
        // report model reads an absent field as an unavailable input (#ERROR).
        entries.push([`${prefix}${measure.id}`, value ?? null]);
      }
    };
    if (split.length === 0) {
      fill(subset, "");
    } else {
      const byCombo = new Map<string, Row[]>();
      for (const row of subset) {
        const id = comboIdOf(row);
        const list = byCombo.get(id);
        if (list) list.push(row);
        else byCombo.set(id, [row]);
      }
      for (const combo of combos) {
        const rowsOf = byCombo.get(combo.id);
        if (rowsOf) fill(rowsOf, `${combo.id}${KEY_SEP}`);
      }
    }
    return Object.fromEntries(entries);
  };

  /**
   * The user's sort, applied among siblings. Array sort is stable and the
   * input is already in default order, so that order is the tie-break — and a
   * sort naming a column this pivot does not have compares everything equal
   * and changes nothing.
   */
  const sortBy = <T>(items: T[], valueOf: (item: T, id: string) => unknown): T[] =>
    sorting.length === 0
      ? items
      : [...items].sort((a, b) => {
          for (const s of sorting) {
            const c = compareSorted(valueOf(a, s.id), valueOf(b, s.id), s.desc);
            if (c !== 0) return c;
          }
          return 0;
        });

  // ---- Rows -----------------------------------------------------------------
  const sourceIndices = new Map(rows.map((row, index) => [row, index]));
  const sourceBindings = new Map(measures.map(measure => [measure.id, measure.sourceFieldId]));
  // Explicit Data instances can share category IDs. Category sort intent wins;
  // legacy calls retain their existing field-sort behavior.
  const categoryFields = new Set(config.measures === undefined ? [] : [...grouping, ...split]);
  // A leaf is one row, and leaves carry the raw value: Sum, Mean, Median,
  // Min, Max, First and Last of one value are that value. Not so a count --
  // it counts the row, so a Count / Unique count reads "1" ("0" for a null,
  // as a group of only nulls reads "0"), never the raw value it counts.
  const leafValue = (measure: (typeof measures)[number], row: Row): unknown => {
    const raw = read(row, measure.sourceFieldId);
    return measure.aggregation === "count" || measure.aggregation === "uniqueCount" ? aggregateValues(measure.aggregation, [raw]) : raw;
  };
  const outRows: Row[] = [];
  const meta: PivotRowMeta[] = [];
  const emit = (subset: Row[], depth: number, parent: string | null) => {
    if (depth === grouping.length) {
      // The real rows, only while nothing splits the columns: under a split a
      // cell stands for many rows and a single row has no place to sit.
      if (split.length === 0) {
        for (const row of sortBy(subset, (row, id) => read(row, categoryFields.has(id) ? id : sourceBindings.get(id) ?? id))) {
          outRows.push(config.measures === undefined ? row : Object.fromEntries([
            ...Object.entries(row), ...measures.map(measure => [measure.id, leafValue(measure, row)]),
          ]));
          meta.push({ kind: "leaf", depth, ...(config.measures === undefined ? {} : { sourceIndex: sourceIndices.get(row) }) });
        }
      }
      return;
    }
    const field = grouping[depth];
    const nodes = partition(subset, field).map((group) => {
      const described = describe(field, group);
      return { group, described, values: valuesFor(group.rows, described.label) };
    });
    const sorted = sortBy(nodes, (node, id) => {
      if (id === LABEL_FIELD) return node.group.raw;
      // Only this grouping level has a single structural category value.
      // Ancestor, deeper and split category sorts must not read a measure cell.
      if (categoryFields.has(id)) return id === field ? node.group.raw : undefined;
      return read(node.values, id);
    });
    for (const { group, described, values } of sorted) {
      const path = parent === null ? group.key : `${parent}${KEY_SEP}${group.key}`;
      const expandable = depth + 1 < grouping.length || split.length === 0;
      const open = expandable && isOpen(config, path);
      outRows.push(values);
      meta.push({
        kind: "group",
        depth,
        path,
        label: described.label,
        count: group.rows.length,
        expandable,
        open,
        ...(described.incomplete ? { incomplete: described.incomplete } : {}),
      });
      if (open) emit(group.rows, depth + 1, path);
    }
  };
  if (grouping.length === 0) {
    outRows.push(valuesFor(rows, TOTAL_LABEL));
    meta.push({ kind: "total", depth: 0, label: TOTAL_LABEL, count: rows.length });
  } else {
    emit(rows, 0, null);
  }

  // ---- Columns --------------------------------------------------------------
  const label: PivotColumn = {
    field: LABEL_FIELD,
    header: grouping.map(headerOf).join(" › "),
    renderFn: [],
    colorRules: [],
    hiddenByDefault: false,
    pinned: "left",
    groupPath: [],
    // The synthetic label column is never a logo and never flashes: it holds
    // group names, not a streamed value.
    isLogo: false,
    flash: false,
    // Nor is it editable: there is no underlying row to write a typed value
    // back to. Same reasoning as isLogo/flash above, and the same answer
    // tableColumns.ts gives a column nothing declared editable.
    editable: false,
  };
  const out: PivotColumn[] = [label];
  const sources = measures.map((measure: PivotMeasure) => {
    const column = byField.get(measure.sourceFieldId)!;
    return { ...column, field: measure.id, source: measure.sourceFieldId, measureId: measure.id,
      aggregation: measure.aggregation,
      header: config.measures === undefined ? column.header : measureLabel(measure, column.header, measures) };
  });
  if (split.length === 0) {
    for (const column of sources) out.push({ ...column, groupPath: [], splitKeys: [] });
  } else {
    for (const combo of combos) {
      for (const column of sources) {
        out.push({
          ...column,
          field: `${combo.id}${KEY_SEP}${column.field}`,
          // A pin and a cell click both belong to a real field of a real row.
          pinned: undefined,
          cellClick: undefined,
          // Typing into an aggregate means nothing, and an aggregate is not
          // an image URL.
          editable: false,
          isLogo: false,
          // These read OTHER keys of the same row (a band's ends, a percent
          // beside the value), which a group row does not carry under this id.
          rangeBar: undefined,
          rangeMeter: undefined,
          percentKey: undefined,
          groupPath: combo.labels,
          splitKeys: combo.id.split(KEY_SEP),
        });
      }
    }
  }

  return { ok: true, rows: outRows, meta, columns: out };
}
