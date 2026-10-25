// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { colorRules, type ColorRule } from "./columnRender";
import { moveBefore } from "./dragDrop";
import { columnsOf } from "./export";
import { cellFormat, type CellFormat } from "./format";
import { isRecord } from "./isRecord";
import { parseSparkline, type SparklineConfig } from "./sparkline";
import type { AggregationHint, ColumnSpec, PinSide, TableCardState, TableSpec } from "./types";

export { tableRows } from './tableRowValues';
export type { Row } from './tableRowValues';
import type { Row } from './tableRowValues';

/** The dataTransfer type a dragged header cell carries. */
export const COLUMN_DRAG_TYPE = "application/x-bdobb-column";

/**
 * A column's `renderFn: "cellOnClick"` with `actionType: "groupBy"`, already
 * validated. Clicking such a cell assigns the cell's value to `paramName`.
 *
 * `forceUpdate` also refetches the SOURCE table, which is the only thing that
 * refreshes it when its own effective params did not change. `valueField`
 * names a different row key to take the value from than the one the column
 * displays. One paramName only: the reference documents no more.
 */
export type CellClick = { paramName: string; forceUpdate: boolean; valueField?: string };

/**
 * A column's `renderFn: "hoverCard"`, already validated. The cell holds an
 * object; `cellField` names the key the cell displays, and `markdown` is a
 * template whose `{key}` placeholders are filled from that same object.
 */
export type HoverCard = { cellField: string; title?: string; markdown: string };

/**
 * One rendered column: everything the spec says about it, already resolved,
 * plus the two defaults (its place in the order and whether it starts hidden)
 * that the card's persisted state may override.
 */
export type TableColumn = {
  hint?: AggregationHint;
  /** Opaque later-renderer metadata preserved/stripped by the maintained engine. */
  editable?: boolean;
  isLogo?: boolean;
  flash?: boolean;
  rangeBar?: unknown;
  rangeMeter?: unknown;
  percentKey?: string;
  field: string;
  /** headerName ?? field, wrapped in the spec's prefix and suffix. */
  header: string;
  tooltip?: string;
  cellDataType?: ColumnSpec["cellDataType"];
  format?: CellFormat;
  /** Always an array, empty when the column names no renderFn. */
  renderFn: string[];
  /**
   * `renderFnParams.colorRules`, validated HERE — once per column rather than
   * once per cell, because cellVisual runs on every cell of every render.
   * Always an array, empty when the column declares no usable rule.
   */
  colorRules: ColorRule[];
  /**
   * `renderFn: "showCellChange"`: flash the cell when its value changes,
   * coloured by the sign of `renderFnParams.colorValueKey`'s field. `enabled`
   * is false when the column set `enableCellChangeWs: false`. Absent when the
   * column names no showCellChange.
   */
  cellChange?: { colorValueKey?: string; enabled: boolean };
  /**
   * columnsDefs `sparkline`, resolved once here. When set and a cell is a
   * non-empty number array, TableRenderer draws a SparklineCell instead of text.
   */
  sparkline?: SparklineConfig;
  /**
   * `renderFn: "cellOnClick"`, validated HERE for the same reason colorRules
   * is: the body loop runs on every cell of every render. Absent when the
   * column declares no usable groupBy, and the column then renders plainly.
   */
  cellClick?: CellClick;
  /** `renderFn: "hoverCard"`, validated once per column like cellClick. */
  hoverCard?: HoverCard;
  pinned?: "left" | "right";
  /** columnsDefs `hide: true` — the default, before the card's own state. */
  hiddenByDefault: boolean;
  size?: number;
  minSize?: number;
  maxSize?: number;
};

/**
 * The `groupBy` cell click out of an opaque `renderFnParams`. Every one of
 * these checks must pass or the answer is `undefined` and the column renders
 * as a plain cell — a half-declared action would otherwise become a button
 * that does nothing when clicked, which is worse than no button at all.
 *
 * `forceUpdate` is read from a literal `true` only, and `valueField` only
 * from a non-empty string: the manifest is untrusted JSON, and coercing
 * `"true"` or `1` would refetch a table whose author never asked for it.
 *
 * The rest of renderFnParams stays opaque; hoverCard has its own reader
 * below, and columnColor remains parsed-and-ignored.
 */
export function cellClickOf(spec: ColumnSpec): CellClick | undefined {
  if (!spec.renderFn?.includes("cellOnClick")) return undefined;
  const params = spec.renderFnParams;
  if (!params || params.actionType !== "groupBy") return undefined;
  const g = params.groupBy;
  if (!isRecord(g)) return undefined;
  if (typeof g.paramName !== "string" || g.paramName === "") return undefined;

  const click: CellClick = { paramName: g.paramName, forceUpdate: g.forceUpdate === true };
  if (typeof g.valueField === "string" && g.valueField !== "") click.valueField = g.valueField;
  return click;
}

/**
 * The hover card out of an opaque `renderFnParams.hoverCard`. Without a
 * string `cellField` and `markdown` there is nothing to show in the cell or
 * on hover, so the column renders plainly.
 */
export function hoverCardOf(spec: ColumnSpec): HoverCard | undefined {
  if (!spec.renderFn?.includes("hoverCard")) return undefined;
  const h = spec.renderFnParams?.hoverCard;
  if (!isRecord(h)) return undefined;
  if (typeof h.cellField !== "string" || typeof h.markdown !== "string") return undefined;
  const card: HoverCard = { cellField: h.cellField, markdown: h.markdown };
  if (typeof h.title === "string") card.title = h.title;
  return card;
}

/** A field no columnsDefs entry declares. It still inherits the table default. */
function undeclared(field: string, spec: TableSpec | undefined): TableColumn {
  return {
    field,
    header: field,
    format: cellFormat(undefined, spec),
    renderFn: [],
    colorRules: [],
    hiddenByDefault: false,
  };
}

function declared(column: ColumnSpec, spec: TableSpec): TableColumn {
  return {
    field: column.field,
    header: `${column.prefix ?? ""}${column.headerName ?? column.field}${column.suffix ?? ""}`,
    tooltip: column.headerTooltip,
    cellDataType: column.cellDataType,
    format: cellFormat(column, spec),
    renderFn: column.renderFn ?? [],
    colorRules: colorRules(column.renderFnParams),
    cellChange: (column.renderFn ?? []).includes("showCellChange")
      ? {
          colorValueKey:
            typeof column.renderFnParams?.colorValueKey === "string"
              ? column.renderFnParams.colorValueKey
              : undefined,
          // enableCellChangeWs defaults to true; only an explicit false opts out.
          enabled: column.enableCellChangeWs !== false,
        }
      : undefined,
    sparkline: parseSparkline(column.sparkline),
    cellClick: cellClickOf(column),
    hoverCard: hoverCardOf(column),
    hint: column.aggregation,
    pinned: column.pinned,
    hiddenByDefault: column.hide === true,
    size: column.width,
    minSize: column.minWidth,
    maxSize: column.maxWidth,
  };
}

/**
 * The column set, before any persisted state is applied.
 *
 * With NO spec this is exactly what the renderer did before columnsDefs was
 * parsed at all: the FIRST row's keys, in their own order. Deliberately not
 * the union of every row's keys — widening it would change what a widget
 * without columnsDefs renders, which the design forbids.
 *
 * With a spec: every declared field the payload actually carries, in
 * columnsDefs order, then every remaining field in first-seen order across
 * the whole payload (measured at 12 ms over 133k rows x 10 keys, and the
 * caller memoises on `rows`).
 */
export function tableColumns(rows: Row[], spec: TableSpec | undefined): TableColumn[] {
  if (!spec) return Object.keys(rows[0] ?? {}).map((field) => undeclared(field, undefined));

  const fields = columnsOf(rows);
  const present = new Set(fields);
  const taken = new Set<string>();
  const out: TableColumn[] = [];
  for (const column of spec.columns) {
    if (taken.has(column.field) || !present.has(column.field)) continue;
    taken.add(column.field);
    out.push(declared(column, spec));
  }
  for (const field of fields) {
    if (taken.has(field)) continue;
    taken.add(field);
    out.push(undeclared(field, spec));
  }
  return out;
}

/**
 * The rendered order: the persisted order first, minus anything the payload no
 * longer carries, then every column it does not mention in spec order — so a
 * backend that adds a column does not hide it behind stale state.
 */
export function orderFields(columns: TableColumn[], persisted: string[] | undefined): string[] {
  const all = columns.map((c) => c.field);
  if (!persisted) return all;
  const known = new Set(all);
  const kept = persisted.filter((f) => known.has(f));
  const seen = new Set(kept);
  return [...kept, ...all.filter((f) => !seen.has(f))];
}

/**
 * Which columns are hidden. The card's own list wins outright once it exists —
 * an EMPTY list included, which is how a user un-hides a column the widget
 * ships with `hide: true`.
 */
export function hiddenFields(columns: TableColumn[], persisted: string[] | undefined): string[] {
  if (persisted) return persisted.filter((f) => columns.some((c) => c.field === f));
  return columns.filter((c) => c.hiddenByDefault).map((c) => c.field);
}

/**
 * A column's effective pin side: the card's own override when it has one,
 * otherwise the widget spec's. The ONE place either source is consulted, so
 * the header menu, the pinned groups, the drag rule and the card's Columns
 * list can never disagree about where a column sits.
 *
 * Object.hasOwn rather than `persisted?.[field] !== undefined`: this map comes
 * back from JSON.parse and therefore inherits Object.prototype, so a column
 * named "toString" or "constructor" would otherwise read a function as its
 * side. A `null` entry is the user unpinning a column the widget pins.
 */
export function effectivePinned(
  column: TableColumn,
  persisted: TableCardState["pinned"] | undefined,
): PinSide | undefined {
  if (persisted && Object.hasOwn(persisted, column.field)) {
    return persisted[column.field] ?? undefined;
  }
  return column.pinned;
}

/**
 * Pin `field` to `side`, or unpin it with `null`. Returns the next override
 * map AND the re-positioned order together, so one user action is one patch
 * and one dashboard write.
 *
 * The map never holds an entry that agrees with the widget's own default
 * (`undefined` from the backend and `null` from the user mean the same thing
 * here), and an empty map comes back as `undefined` so the key leaves the
 * card entirely rather than being written as `{}`.
 *
 * `order` is the current effective order (orderFields' output, hidden fields
 * included) and the returned order is the same set, with `field` moved to the
 * inner edge of its new group: pinned left, it lands after the last
 * effective-left column; pinned right, before the first effective-right one;
 * unpinned, directly after the left group, which is where the first unpinned
 * column sits. Those positions are computed against the OTHER columns'
 * effective sides under the NEXT map, not the spec's. Neither input is
 * mutated.
 */
/** A field's effective pinned side under `pinned`, or undefined for an unknown field. */
function sideOf(columns: TableColumn[], pinned: TableCardState["pinned"] | undefined, field: string) {
  const column = columns.find((c) => c.field === field);
  return column ? effectivePinned(column, pinned) : undefined;
}

export function setPinned(
  columns: TableColumn[],
  order: string[],
  persisted: TableCardState["pinned"] | undefined,
  field: string,
  side: PinSide | null,
): { pinned: Record<string, PinSide | null> | undefined; columnOrder: string[] } {
  const backend = columns.find((c) => c.field === field)?.pinned;
  const entries = Object.entries(persisted ?? {}).filter(([f]) => f !== field);
  if (side !== (backend ?? null)) entries.push([field, side]);
  // fromEntries, not `{ ...persisted, [field]: side }`: a field named
  // "__proto__" must land as an own data property, not on the prototype
  // setter, or its own pin would be invisible to every later read.
  const pinned = entries.length > 0 ? Object.fromEntries(entries) : undefined;

  const at = (f: string) => sideOf(columns, pinned, f);
  const rest = order.filter((f) => f !== field);
  let index = 0;
  if (side === "left") {
    rest.forEach((f, i) => {
      if (at(f) === "left") index = i + 1;
    });
  } else {
    const first = rest.findIndex((f) => (side === "right" ? at(f) === "right" : at(f) !== "left"));
    index = first === -1 ? rest.length : first;
  }
  return { pinned, columnOrder: [...rest.slice(0, index), field, ...rest.slice(index)] };
}

/**
 * A header dropped on another header. Returns the new order, or null when the
 * move is refused: a column may only move within its own effective pinned
 * group, and an unpinned one only among unpinned columns, because a drag must
 * never silently pin or unpin anything — that is the header menu's job. The
 * input array is never mutated.
 *
 * `persisted` is the card's pin overrides: the rule follows what the user can
 * SEE, so a column they unpinned drags among the unpinned ones even though
 * the widget spec still pins it.
 *
 * The dragged column takes the target's own index in the shortened array,
 * which is the standard list-reorder rule; `moveBefore` in dragDrop.ts spells
 * that rule out and is shared with the rail and the tab strip.
 */
export function moveColumn(
  order: string[],
  columns: TableColumn[],
  from: string,
  to: string,
  persisted?: TableCardState["pinned"],
): string[] | null {
  if (from === to) return null;
  if (!order.includes(from) || !order.includes(to)) return null;
  if (sideOf(columns, persisted, from) !== sideOf(columns, persisted, to)) return null;
  return moveBefore(order, order.indexOf(from), order.indexOf(to));
}
