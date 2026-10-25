// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { tableRows } from "./tableRowValues";
import { identifyRows } from "./widgetData/identity";
import type { Row } from "./tableColumns";
import type { DatasetColumn, DatasetRow, WidgetDataset } from "./widgetData/types";
import { correctStatementRows, FISCAL_AS_REPORTED } from "./statementFiscal";
const extensionOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
};

/**
 * The stored bytes as something TableRenderer can render. SheetJS reads csv,
 * tsv, xls and xlsx from the same call; JSON is parsed directly, because
 * SheetJS would flatten an array of objects through its own coercion rules
 * rather than hand back what the file says.
 *
 * Imported lazily for the reason src/lib/export.ts states: SheetJS is ~780 KB
 * and Vite splits it into its own chunk, so a session with no local file
 * never fetches it.
 *
 * Exported for its own tests: everything here is a pure bytes-in/value-out
 * function, and testing it through the component would need the filesystem.
 */
export async function dataFromBytes(name: string, bytes: Uint8Array): Promise<unknown> {
  return (await parsedFromBytes(name, bytes)).data;
}
async function parsedFromBytes(name: string, bytes: Uint8Array): Promise<{data: unknown; formats?: NonNullable<DatasetRow['cellFormats']>[]}> {
  if (extensionOf(name) === "json") return {data:JSON.parse(new TextDecoder().decode(bytes))};
  await assertInflatesWithin(bytes, WORKBOOK_MAX_INFLATED_BYTES);
  const XLSX = await import("xlsx");
  const book = XLSX.read(bytes, { type: "array", cellNF: true });
  const first = book.SheetNames[0];
  // A workbook with no sheet at all is not an error; it has no rows.
  if (first === undefined) return {data:[]};
  const sheet = book.Sheets[first]!;
  const textFile = extensionOf(name) === "csv" || extensionOf(name) === "tsv";
  // SheetJS identifies date cells through their number format. Decode only
  // those cells: a plain numeric measure that resembles a serial stays numeric.
  // Excel dates are calendar values without a timezone, so SSF's calendar
  // decoder avoids Date's local-time conversion (including the 1904 epoch).
  for (const [address, cell] of Object.entries(sheet)) {
    if (address.startsWith("!") || cell.t !== "n" || !cell.z || !XLSX.SSF.is_date(cell.z)) continue;
    const original = cell.w;
    let value: string;
    if (textFile && original && /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/.test(original)) {
      // CSV preserves its original text here, including time and UTC offset.
      value = original;
    } else {
      const calendar = XLSX.SSF.parse_date_code(cell.v as number, { date1904: book.Workbook?.WBProps?.date1904 });
      if (!calendar) continue;
      const { y, m, d, H, M, S, u } = calendar;
      const date = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const hasTime = H !== 0 || M !== 0 || S !== 0 || u !== 0 || /[hHsS]/.test(cell.z);
      value = hasTime
        ? new Date(Date.UTC(y, m - 1, d, H, M, S, Math.round(u * 1000))).toISOString().replace(/\.000Z$/, "").replace(/Z$/, "")
        : date;
    }
    // sheet_to_json also examines z on string cells; clear the date format
    // after normalization so it cannot reinterpret the ISO text as a serial.
    sheet[address] = { ...cell, t: "s", v: value, z: undefined, w: undefined };
  }
  // raw: true keeps the cell's own value -- a number stays a number, so
  // formatCell and the numeric filters see what the file holds, not a string.
  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: true });
  if (textFile || !sheet['!ref']) return {data};
  const range = XLSX.utils.decode_range(sheet['!ref']);
  // Apply only uniquely named text headers; never guess at renamed duplicate or
  // blank SheetJS headers. Unsupported Excel display codes remain unformatted.
  const headers = Array.from({length:range.e.c-range.s.c+1}, (_, index) => {
    const column = range.s.c + index;
    const header = sheet[XLSX.utils.encode_cell({r:range.s.r,c:column})]?.v;
    return {column, header:typeof header === 'string' ? header : undefined};
  });
  const formats = data.map(row => {
    const result: NonNullable<DatasetRow['cellFormats']> = {};
    for (const {column,header} of headers) {
      if (!header || headers.filter(h => h.header === header).length !== 1 || typeof row[header] !== 'number' || typeof row.__rowNum__ !== 'number') continue;
      const code = sheet[XLSX.utils.encode_cell({r:row.__rowNum__,c:column})]?.z;
      if (typeof code !== 'string') continue;
      const match = /^(?:#,##)?0(?:\.(0{1,20}))?(%)?$/.exec(code);
      if (!match) continue;
      Object.defineProperty(result, header, {value:match[2] ? {formatterFn:'normalizedPercent',decimalPlaces:match[1]?.length ?? 0}
        : match[1] ? {decimalPlaces:match[1].length} : {formatterFn:'int'}, enumerable:true});
    }
    return result;
  });
  return {data,formats};
}

// ponytail: fixed ceiling, the table service's default max_parse_bytes (crates/table-service/src/config.rs);
// pass the operator's configured value through ingestFile if one is ever set lower.
export const WORKBOOK_MAX_INFLATED_BYTES = 256 * 1024 * 1024;

/**
 * SheetJS inflates every zip entry whole, and keeps it, before it compares any
 * size: a 1 MB upload whose sheet is 1 GB of spaces held 1 GB of memory, off
 * the V8 heap and so past the ingest child's --max-old-space-size. Inflate each
 * deflated entry first, walking the zip as SheetJS's parse_zip does (the last
 * end-of-central-directory record, each central entry, its local header), and
 * count the bytes actually produced -- the declared sizes are never trusted.
 * The stream yields small chunks, so the walk stops one chunk past the budget.
 * A zip the walk cannot read is refused rather than handed to SheetJS.
 */
async function assertInflatesWithin(bytes: Uint8Array, limit: number) {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return; // SheetJS opens "PK" input as a zip.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 4;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error("Unreadable workbook");
  let entry = view.getUint32(end + 16, true), total = 0;
  for (let count = view.getUint16(end + 8, true); count > 0; count--) {
    const compressed = view.getUint32(entry + 20, true), local = view.getUint32(entry + 42, true);
    entry += 46 + view.getUint16(entry + 28, true) + view.getUint16(entry + 30, true) + view.getUint16(entry + 32, true);
    const method = view.getUint16(local + 8, true);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + compressed > bytes.length) throw new Error("Unreadable workbook");
    if (method === 0) total += compressed;
    else if (method === 8) {
      const reader = new Blob([bytes.slice(start, start + compressed)]).stream()
        .pipeThrough(new DecompressionStream("deflate-raw")).getReader();
      for (let chunk = await reader.read(); !chunk.done && total <= limit; chunk = await reader.read()) total += chunk.value.length;
      if (total > limit) await reader.cancel();
    }
    if (total > limit) throw new Error(`Workbook expands past ${limit / (1024 * 1024)} MB`);
  }
}

/**
 * With `yearEnds` (by upper-cased symbol), statement rows are relabelled by each
 * row's own fiscal_period before rows are identified, as a backend statement
 * card's rows are; rows that stay as reported carry FISCAL_AS_REPORTED.
 */
export async function datasetFromBytes(name: string, bytes: Uint8Array, widgetId: string, inputRevision: number, yearEnds?: Record<string, number | null>): Promise<WidgetDataset> {
  let dataset: WidgetDataset;
  try {
    const parsed = await parsedFromBytes(name, bytes);
    let rows = tableRows(parsed.data);
    if (!rows) throw new Error();
    const fiscal = yearEnds ? correctStatementRows(rows, '', yearEnds, [], true) : undefined;
    if (fiscal) rows = fiscal.rows;
    dataset = datasetFromRows(rows, widgetId, inputRevision, 'localFile', parsed.formats);
    if (fiscal?.asReported) dataset.diagnostics = [{ ...FISCAL_AS_REPORTED }];
  } catch { throw new Error('Could not parse local table'); }
  return dataset;
}

/**
 * Rows as the worker's input. Mutates `rows` (absent keys become null), so a
 * caller whose rows are shared copies them first. `columns` sets the order and
 * labels; fields it leaves out follow in row order.
 */
export function datasetFromRows(rows: Row[], widgetId: string, inputRevision: number, sourceKind: string,
  formats?: NonNullable<DatasetRow['cellFormats']>[], columns: DatasetColumn[] = []): WidgetDataset {
  const fields = [...new Set(rows.flatMap(row => Object.keys(row)))];
  // SheetJS leaves a blank cell out of its row and JSON rows may omit a key;
  // the engine reads an absent key as an unavailable field, so a file column
  // is present as null on every row. defineProperty keeps "__proto__" an own key.
  for (const row of rows) for (const field of fields) if (!Object.hasOwn(row, field))
    Object.defineProperty(row, field, {value:null, enumerable:true, writable:true, configurable:true});
  const declared = columns.filter(c => fields.includes(c.id)), named = new Set(declared.map(c => c.id));
  return {
    rows: identifyRows(rows).map((row,index) => ({...row, ...(formats?.[index] && Object.keys(formats[index]).length ? {cellFormats:formats[index]} : {})})),
    columns: [...declared, ...fields.filter(id => !named.has(id)).map(id => ({ id, label: id }))],
    resultRevision: inputRevision, outputRevision: inputRevision,
    provenance: { sourceWidgetId: widgetId, sourceKind },
    completeness: { kind: 'complete', warnings: [], acquiredRowCount: rows.length, totalRowCount: rows.length, totalRowCountKind: 'exact' },
    freshness: { availability: 'available', stale: false },
  };
}
