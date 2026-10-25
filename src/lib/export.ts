// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { TableExecutor, Revision } from './tableExecution/types';
import { beginSubset, appendSubset, commitSubset } from './tableExecution/subsetTransfer';

/** Complete revision-bound output, never the renderer's cache. Card exports keep their
 * existing all-eligible scope; callers can request the selected presented scope. */
export async function collectPresentedExport(executor: TableExecutor, revision: Revision, signal: AbortSignal, ignoreSelection = true) {
  let transfer: ReturnType<typeof beginSubset> | undefined;
  for await (const batch of executor.presented(revision, signal, ignoreSelection)) {
    signal.throwIfAborted();
    transfer ??= beginSubset(batch.transferId, revision);
    appendSubset(transfer, batch);
  }
  signal.throwIfAborted();
  if (!transfer) throw new Error('Table export returned no complete result');
  const data = commitSubset(transfer);
  return presentedForExport(data.columns, data.rows);
}

/**
 * Pure payload → bytes helpers for the card's Export menu. Nothing here
 * touches the filesystem, the dialog plugin or React: WidgetCard pairs these
 * with save()/writeTextFile()/writeFile().
 *
 * Everything written is the RAW payload value, with one exception: a CSV
 * string cell that a spreadsheet would run as a formula gets a leading ' (see
 * cell below). formatCell (src/lib/format.ts) is a view concern — a table
 * showing "2.3M" must still export 2300000.
 */

import { isRecord } from "./isRecord";
import { LABEL_FIELD } from "./pivotTable";
import type { DatasetColumn, DatasetRow } from "./widgetData/types";

/** Anything reserved on macOS or Windows, plus the C0 control characters. */
const ILLEGAL_IN_FILENAME = /[\\/:*?"<>|\u0000-\u001f]/g;

/** Filenames are capped here, extension included. */
const MAX_FILENAME = 120;

/**
 * The design's eligibility table, in one place, because the card needs the
 * same answer twice: once to disable the CSV/Excel items and once to pick
 * which writer runs.
 *
 * An empty array is refused along with the scalars: it has no columns, so
 * "export it as CSV" can only ever produce an empty file.
 */
export function rowsForExport(data: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(data)) {
    return data.length > 0 && data.every(isRecord) ? (data as Record<string, unknown>[]) : null;
  }
  return isRecord(data) ? [data] : null;
}

/**
 * A worker table's presented result (its presented() stream) as rows for the
 * writers below. Each header is what the table shows: the column-group
 * members, then the column's own label, joined with " · " -- the same
 * levels LocalTableRenderer stacks above the column. Values stay raw; a
 * missing cell is null. Grand totals are not part of the presented rows and
 * are not exported, as a backend table's export carries none either.
 */
/** A calculation error as an export cell: "#ERROR: <reason>", the same in CSV, JSON and Excel (D-019, #32). */
export const errorCell = (error: { message: string }) => `#ERROR: ${error.message}`;

export function presentedForExport(
  datasetColumns: DatasetColumn[],
  datasetRows: DatasetRow[],
): { columns: string[]; rows: Record<string, unknown>[]; dates: string[] } {
  // Nested row groups: the table shows one "Company › Month" column holding
  // only the leaf's own member, which would leave a month with no company.
  // Each level becomes its own column, filled from the row's groupPath.
  const depth = Math.max(0, ...datasetRows.map((r) => r.groupPath?.length ?? 0));
  type Source = (r: DatasetRow) => unknown;
  const sources = datasetColumns.flatMap((c): { header: string; read: Source; date?: boolean }[] => {
    if (c.id === LABEL_FIELD && depth > 0) {
      const names = c.label.split(" › ");
      return Array.from({ length: depth }, (_, level) => ({
        header: names.length === depth ? names[level] : (datasetRows.find((r) => r.groupPath?.[level])?.groupPath?.[level].field ?? `Level ${level + 1}`),
        // The member's display label when it has one (Statement sections and lines, #29).
        read: (r: DatasetRow) => r.groupPath?.[level]?.label ?? r.groupPath?.[level]?.value ?? null,
      }));
    }
    return [{
      header: [...(c.splitPath ?? []).map((m) => m.label ?? String(m.value)), c.label].join(" · "),
      // A calculation error carries the reason the cell shows on screen (D-019).
      read: (r: DatasetRow) => (r.cellErrors && Object.hasOwn(r.cellErrors, c.id) ? errorCell(r.cellErrors[c.id])
        : Object.hasOwn(r.values, c.id) ? (r.values[c.id] ?? null) : null),
      date: c.dtype === "date" || c.dtype === "dateString",
    }];
  });
  const used = new Set<string>();
  const columns = sources.map(({ header }) => {
    // Two columns can flatten to one header; a repeat would overwrite a key,
    // so a suffix skips any header already emitted (including a literal "X (2)").
    let candidate = header;
    for (let n = 2; used.has(candidate); n++) candidate = `${header} (${n})`;
    used.add(candidate);
    return candidate;
  });
  const rows = datasetRows.map((r) => Object.fromEntries(sources.map((s, i) => [columns[i], s.read(r)])));
  return { columns, rows, dates: columns.filter((_, i) => sources[i].date) };
}

/**
 * Union of every row's own keys, in the order they were first seen. Exported
 * because src/lib/tableColumns.ts has to answer exactly this question — which
 * fields does the payload actually carry, and in what order — and two
 * implementations of it would eventually disagree.
 */
export function columnsOf(rows: Record<string, unknown>[]): string[] {
  return [...new Set(rows.flatMap((r) => Object.keys(r)))];
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "object" ? JSON.stringify(value) : String(value);
  // A spreadsheet opening this file runs a field that starts with = + - @
  // (or a tab or CR) as a formula, and the strings are a backend's, so a
  // leading ' makes such a field text. Only strings, and not one that is
  // itself a plain number ("-1.25"): a number is written bare, as above.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text) && !Number.isFinite(Number(text))) {
    text = `'${text}`;
  }
  // RFC 4180: quote only when the field carries a delimiter, a quote or a
  // line break, and double any quote inside.
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Own keys only, as for cells below: a column named "constructor" must not
 * be headed by Object.prototype's. */
function labelOf(labels: Record<string, string>, column: string): string {
  return Object.hasOwn(labels, column) ? labels[column] : column;
}

/**
 * `columns` is the column list AND its order. It defaults to the payload's own
 * key union, which is what every ordinary export wants; the transposed view
 * passes transposeRows' explicit list instead, because a transposed row's keys
 * enumerate integer-like headers (e.g. "2024") ahead of `Field`.
 *
 * `labels` heads a column with the backend's columnsDefs headerName
 * ("Real Personal Income" for `RPI`); a column without one keeps its key.
 */
export function toCsv(
  rows: Record<string, unknown>[],
  columns: string[] = columnsOf(rows),
  labels: Record<string, string> = {},
): string {
  const lines = [columns.map((c) => cell(labelOf(labels, c))).join(",")];
  for (const row of rows) {
    // Object.hasOwn, not a bare index: a column named e.g. "constructor" is
    // an own key on the row that declared it, but reading it off a row that
    // did not would walk the prototype chain and write out a function.
    lines.push(columns.map((c) => cell(Object.hasOwn(row, c) ? row[c] : undefined)).join(","));
  }
  return lines.join("\r\n");
}

export function toJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Rows as pretty JSON, one object per row, keys in `columns` order — the JSON
 * counterpart of toCsv's explicit column list, and for the same reason.
 *
 * The top level is assembled by hand because neither obvious route works:
 * re-building each row object reorders nothing (an integer-like key such as
 * "2024" enumerates before "Field" whatever the insertion order), and
 * JSON.stringify's array replacer, which DOES honour the given order, applies
 * at every depth — it would strip the keys of a nested object value. Each
 * VALUE is still stringified by JSON.stringify itself and re-indented, so
 * anything nested is written out in full, exactly as toJson would.
 */
export function toJsonRows(
  rows: Record<string, unknown>[],
  columns: string[] = columnsOf(rows),
): string {
  if (rows.length === 0) return "[]";
  const objects = rows.map((row) => {
    const fields = columns
      // A key the row does not carry stays absent, and so does an explicit
      // undefined: both are what JSON.stringify itself would write.
      .filter((c) => Object.hasOwn(row, c) && row[c] !== undefined)
      .map((c) => {
        // No undefined fallback: the filter above already dropped every key
        // JSON.stringify would answer undefined for.
        const value = JSON.stringify(row[c], null, 2);
        return `    ${JSON.stringify(c)}: ${value.replace(/\n/g, "\n    ")}`;
      });
    return fields.length === 0 ? "  {}" : `  {\n${fields.join(",\n")}\n  }`;
  });
  return `[\n${objects.join(",\n")}\n]`;
}

/**
 * Imported lazily: SheetJS is ~780 KB (198 KB gzipped) and Vite splits it
 * into its own chunk, so a session that never exports never fetches it.
 * write({ type: "array" }) answers an ArrayBuffer; plugin-fs writeFile wants
 * bytes.
 */
export async function toXlsx(
  rows: Record<string, unknown>[],
  columns: string[] = columnsOf(rows),
  dates: readonly string[] = [],
  labels: Record<string, string> = {},
): Promise<Uint8Array> {
  const XLSX = await import("xlsx");
  // `header` is SheetJS's own name for the column list and its order — the
  // same explicit order toCsv takes, for the same reason.
  // A copy: SheetJS mutates the header array it is handed (it appends any
  // key the rows carry that the list does not), and `columns` belongs to the
  // caller -- for the transposed view it is Transposed.columns itself.
  const header = [...columns];
  const sheet = XLSX.utils.json_to_sheet(rows, { header });
  // #28: an ISO date in a date column is written as an Excel date (serial
  // days since 1899-12-30, computed in UTC so no timezone can shift it).
  for (const name of dates) {
    const c = header.indexOf(name);
    if (c < 0) continue;
    rows.forEach((row, r) => {
      const v = row[name];
      if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
      const [y, m, d] = v.split("-").map(Number);
      sheet[XLSX.utils.encode_cell({ r: r + 1, c })] = { t: "n", v: (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000, z: "yyyy-mm-dd" };
    });
  }
  // The header row as toCsv writes it. `header` now also holds any key
  // SheetJS appended, so the row is rewritten in its final order.
  if (Object.keys(labels).length > 0) {
    XLSX.utils.sheet_add_aoa(sheet, [header.map((c) => labelOf(labels, c))], { origin: "A1" });
  }
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Data");
  return new Uint8Array(XLSX.write(book, { bookType: "xlsx", type: "array" }) as ArrayBuffer);
}

/**
 * `<widget name> <k=v …> <YYYY-MM-DD>.<ext>`, sorted by param name so the
 * same card always suggests the same name. The local date, not UTC: the name
 * is for the person looking at the card — `en-CA` is the ISO YYYY-MM-DD
 * locale and toLocaleDateString reads the local calendar fields.
 */
export function exportFilename(
  widgetName: string,
  params: Record<string, string>,
  ext: string,
  today: Date = new Date(),
): string {
  const pairs = Object.keys(params)
    .sort()
    .filter((k) => (params[k] ?? "") !== "")
    .map((k) => `${k}=${params[k]}`);
  const base = [widgetName, ...pairs, today.toLocaleDateString("en-CA")]
    .join(" ")
    .replace(ILLEGAL_IN_FILENAME, "-")
    .trim();
  const room = MAX_FILENAME - ext.length - 1;
  return `${base.length > room ? base.slice(0, room).trimEnd() : base}.${ext}`;
}
