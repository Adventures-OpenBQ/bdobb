// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { BuiltInFilterFn, FilterFn } from "@tanstack/react-table";
import { isIsoDate } from "./format";
import type { Row, TableColumn } from "./tableColumns";
/** One control per visible column, chosen by the column's data type. */
export type FilterKind = "text" | "number" | "date" | "boolean" | "none";

export type NumberFilter = { min?: number; max?: number };
export type DateFilter = { from?: string; to?: string };

const DECLARED_KIND: Record<NonNullable<TableColumn["cellDataType"]>, FilterKind> = {
  text: "text",
  number: "number",
  boolean: "boolean",
  date: "date",
  dateString: "date",
  object: "none",
};

/** The filter kind a declared data type implies; "none" for no type or an unknown one. */
export function declaredKind(dtype: string | undefined): FilterKind {
  return dtype !== undefined && Object.hasOwn(DECLARED_KIND, dtype) ? DECLARED_KIND[dtype as keyof typeof DECLARED_KIND] : "none";
}

/**
 * `cellDataType` when the spec gives one; otherwise the type of the column's
 * first non-null value, as the design specifies. A column that is null all
 * the way down gets no control rather than a guessed one.
 */
export function filterKindFor(column: TableColumn, rows: Row[]): FilterKind {
  const declared = column.cellDataType;
  if (declared !== undefined && Object.hasOwn(DECLARED_KIND, declared)) return DECLARED_KIND[declared];
  for (const row of rows) {
    const value = row[column.field];
    if (value === null || value === undefined) continue;
    if (typeof value === "number") return "number";
    if (typeof value === "boolean") return "boolean";
    if (typeof value === "string") return isIsoDate(value) ? "date" : "text";
    return "none";
  }
  return "none";
}

const numberFilter: FilterFn<Row> = (row, columnId, value) => {
  const cell = row.getValue(columnId);
  if (typeof cell !== "number") return false;
  const { min, max } = value as NumberFilter;
  if (min !== undefined && cell < min) return false;
  if (max !== undefined && cell > max) return false;
  return true;
};

/**
 * Compares the leading YYYY-MM-DD as text. Deliberately never `new Date()`:
 * parsing a timezone-less date-time reads it as local time and can shift it
 * onto the next calendar day — the same contract formatCell keeps.
 */
const dateFilter: FilterFn<Row> = (row, columnId, value) => {
  const cell = row.getValue(columnId);
  if (typeof cell !== "string") return false;
  const day = cell.slice(0, 10);
  const { from, to } = value as DateFilter;
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
};

/**
 * Ours rather than table-core's `equalsString`, which lower-cases the cell
 * before comparing: a column the spec declares `cellDataType: "boolean"` can
 * still hold the string "TRUE", and that would then match the select's
 * "true" where today it does not. Widening the match is a behaviour change,
 * not a simplification.
 */
const booleanFilter: FilterFn<Row> = (row, columnId, value) =>
  String(row.getValue(columnId)) === value;

/**
 * `text` is table-core's own `includesString` by name -- a built-in name needs
 * no `FilterFns` module augmentation, and its case-insensitive substring match
 * on the cell's string form is exactly what this row asked for. The other
 * three have no built-in equivalent and are handed over as functions.
 */
const FILTER_FNS: Record<FilterKind, BuiltInFilterFn | FilterFn<Row> | undefined> = {
  text: "includesString",
  number: numberFilter,
  date: dateFilter,
  boolean: booleanFilter,
  none: undefined,
};

export function filterFnFor(kind: FilterKind): BuiltInFilterFn | FilterFn<Row> | undefined {
  return FILTER_FNS[kind];
}


export const accessorFor = (column: TableColumn) => (row: Row): unknown => {
 const value = Object.hasOwn(row, column.field) ? row[column.field] : undefined;
 const field = column.hoverCard?.cellField;
 if (field !== undefined && typeof value === "object" && value !== null) {
 const record = value as Record<string, unknown>; return Object.hasOwn(record, field) ? record[field] : undefined;
 }
 return value;
};
