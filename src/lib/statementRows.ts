// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { titleCase } from "./columnRender";
import { columnsOf, errorCell } from "./export";
import type { CellFormat } from "./format";
import { formatFiscalLabel } from "./periods";
import { IDENTITY_FIELDS, OTHER_SECTION, TAXONOMY, detectStatement, type Statement } from "./statementTaxonomy";
import { read, tableColumns, type Row } from "./tableColumns";
import { uniqueHeaders } from "./transpose";
import type { TableSpec } from "./types";
import type { DatasetCellError } from './widgetData/types';

/**
 * The pivot view of a financial statement: the wide rows the backend sends
 * (one per period, newest first) turned into line items down the side,
 * grouped by statement section, with one column per period. A transpose
 * with composed headers and a taxonomy -- the brief's long fact table never
 * exists. Pure; the input is never mutated.
 *
 * `columns` is `[Section, Line item, ...headers]` in display order and every
 * consumer must read the order from there, never from a row's own keys (see
 * transposeRows for why: integer-like keys enumerate first).
 */
export const SECTION_COLUMN = "Section";
export const ITEM_COLUMN = "Line item";
/** Shown wherever statementRows returns null; one string, the card and the local table. */
export const NOTHING_TO_STATEMENT = "Nothing to show: the rows carry no statement line items.";

const EMPTY_HEADER = "—";

export type StatementItem = {
  field: string;
  /** The widget's headerName when it declares one, else the field in title case. */
  label: string;
  /** The column's own format, so a cell renders exactly as the table view renders it. */
  format?: CellFormat;
  /** One entry per header, in header order; undefined where the period lacks the field. */
  values: unknown[];
  formats?: (CellFormat | undefined)[];
  errors?: (DatasetCellError | undefined)[];
};
export type StatementSection = { id?: string; name: string; items: StatementItem[] };
export type StatementRows = {
  statement: Statement | 'template';
  /** The period headers only, in column order. */
  headers: string[];
  columns: string[];
  sections: StatementSection[];
  /** The export shape: one row per item, Section + Line item + one key per header. */
  rows: Row[];
};

/**
 * `isError(row, field)` marks a cell the worker delivered as a calculation
 * error ("#ERROR" plus its reason): it belongs to a numeric line rather than
 * disqualifying it (D-019).
 */
export function statementRows(served: Row[], spec?: TableSpec, isError?: (row: number, field: string) => boolean): StatementRows | null {
  if (served.length === 0) return null;
  // Long-form rows become the per-period rows below; every line then takes the
  // widget's `value` column format. ponytail: a long row's cell error is not
  // carried (none arrive from a backend); map it per period if a source sends one.
  const wide = widenLongRows(served);
  const rows = wide ?? served;
  if (wide) isError = undefined;
  const valueFormat = wide ? tableColumns(served, spec).find((c) => c.field === "value")?.format : undefined;
  const fields = columnsOf(rows);
  const statement = detectStatement(fields);
  if (statement === null) return null;

  const items = fields.filter((f) => !IDENTITY_FIELDS.has(f) && isNumericLine(rows, f, isError));
  if (items.length === 0) return null;

  // Several reporters: each column names its company (`AAPL FY2025`).
  const symbolOf = (row: Row) => { const s = read(row, "symbol"); return s === null || s === undefined || s === "" ? undefined : String(s); };
  const multi = new Set(rows.map(symbolOf).filter((s) => s !== undefined)).size > 1;
  const header = (row: Row) => (multi && symbolOf(row) !== undefined ? `${symbolOf(row)} ${periodHeader(row)}` : periodHeader(row));
  const headers = uniqueHeaders(rows.map(header), [SECTION_COLUMN, ITEM_COLUMN]);
  // tableColumns gives the same CellFormat the table view would use for the
  // field; the label rule is the view's own, so `declared` is checked on the
  // spec rather than on TableColumn.header (which is the field for an
  // undeclared column and would be indistinguishable from a headerName that
  // happens to equal the field).
  const formats = new Map(tableColumns(rows, spec).map((c) => [c.field, c.format]));
  const declared = new Map(spec?.columns.map((c) => [c.field, c.headerName]) ?? []);
  // ponytail: fixed acronym list (#24); extend it when another line reads wrong.
  const label = (field: string) => declared.get(field) ?? titleCase(field.replace(/_/g, " ")).replace(/\b(Ebitda|Ebit|Eps)\b/g, (w) => w.toUpperCase());

  const present = new Set(items);
  const listed = new Set<string>();
  const sections: StatementSection[] = [];
  for (const [name, list] of Object.entries(TAXONOMY[statement])) {
    const own = list.filter((f) => present.has(f));
    for (const f of own) listed.add(f);
    if (own.length > 0) sections.push({ name, items: own.map((f) => item(f)) });
  }
  const other = items.filter((f) => !listed.has(f));
  if (other.length > 0) sections.push({ name: OTHER_SECTION, items: other.map((f) => item(f)) });

  function item(field: string): StatementItem {
    return { field, label: label(field), format: formats.get(field) ?? valueFormat, values: rows.map((row) => read(row, field)) };
  }

  return { statement, headers, columns: [SECTION_COLUMN, ITEM_COLUMN, ...headers], sections, rows: exportRows(sections, headers) };
}

/** The export shape: one row per item, Section + Line item + one key per header; an error cell exports as errorCell. */
export function exportRows(sections: StatementSection[], headers: string[]): Row[] {
  return sections.flatMap((section) => section.items.map((item) => ({ [SECTION_COLUMN]: section.name, [ITEM_COLUMN]: item.label,
    ...Object.fromEntries(headers.map((header, i) => [header, item.errors?.[i] ? errorCell(item.errors[i]!) : item.values[i]])) })));
}

const PERIOD_KEYS = ["date", "period", "fiscal_year", "fiscal_period", "period_ending"] as const;

/**
 * Long-form statement rows -- one fact per row, `line_item` + `value`, keyed by
 * its period (`date`, `period`, ...) -- as OPENBQ's yfinance statements arrive
 * (user ruling 2026-10-10), widened to one row per symbol and period. Periods
 * and line items keep their served order. Null for any other shape, so wide
 * rows pass through untouched.
 */
export function widenLongRows(rows: Row[]): Row[] | null {
  if (rows.length === 0 || !rows.every((r) => typeof read(r, "line_item") === "string" && Object.hasOwn(r, "value"))) return null;
  const periods = new Map<string, Row>();
  for (const r of rows) {
    const symbol = read(r, "symbol");
    const keys = PERIOD_KEYS.filter((k) => Object.hasOwn(r, k));
    const id = JSON.stringify([symbol ?? null, ...keys.map((k) => read(r, k))]);
    let wide = periods.get(id);
    if (!wide) {
      const fresh: Row = Object.fromEntries([...(symbol === undefined ? [] : [["symbol", symbol]]), ...keys.map((k) => [k, read(r, k)])]);
      // The header rule below names an undated fiscal row by its period end.
      if (!Object.hasOwn(fresh, "period_ending") && Object.hasOwn(fresh, "date")) fresh.period_ending = fresh.date;
      periods.set(id, fresh);
      wide = fresh;
    }
    const item = read(r, "line_item") as string;
    // An own key even for "__proto__"; an identity name cannot become a line.
    if (!IDENTITY_FIELDS.has(item)) Object.defineProperty(wide, item, { value: read(r, "value"), enumerable: true, writable: true, configurable: true });
  }
  return [...periods.values()];
}

/** A number in every row where it is non-null, and non-null in at least one. */
function isNumericLine(rows: Row[], field: string, isError?: (row: number, field: string) => boolean): boolean {
  let any = false;
  for (const [index, row] of rows.entries()) {
    if (isError?.(index, field)) { any = true; continue; }
    const v = read(row, field);
    if (v === null || v === undefined) continue;
    if (typeof v !== "number") return false;
    any = true;
  }
  return any;
}

/** `FY2026-Q3`, `FY2026-TTM`, `FY2025` for an annual row, else the period-ending date, else an em dash. */
function periodHeader(row: Row): string {
  const year = read(row, "fiscal_year");
  const period = read(row, "fiscal_period");
  if (year !== null && year !== undefined && year !== "" && typeof period === "string" && period !== "") {
    // The fiscal-label correction (statementFiscal.ts) names a non-December
    // filer's year "FY2027" and its quarter "FQ2"; the header reads FY2027-Q2
    // either way, the row values themselves untouched.
    const fy = String(year).replace(/^FY/, "");
    const quarter = /^F?Q([1-4])$/i.exec(period);
    return formatFiscalLabel(fy, period === "FY" ? undefined : quarter ? Number(quarter[1]) : period);
  }
  const end = read(row, "period_ending");
  if (end === null || end === undefined || end === "") return EMPTY_HEADER;
  return String(end);
}
