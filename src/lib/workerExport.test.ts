// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// D-018 / V4-009: a worker table exports what it presents. The rows come
// through the same presented() stream a linked table consumes, then through
// the backend table's own writers. Real SheetJS here (export.test.ts stubs
// it), so the Excel case is read back independently.
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { calculateView } from "./tableExecution/engine";
import { createResultStore } from "./tableExecution/resultStore";
import type { TableModelV1 } from "./tableModel/types";
import type { WidgetDataset } from "./widgetData/types";
import { presentedForExport, toCsv, toJsonRows, toXlsx } from "./export";
import { dataFromBytes } from "./localTableData";

const revision = { widgetId: "w", input: 1, model: 1, output: 1 };
// practice.csv-shaped: Company, Date, Amount. AAPL months 250/300/850 (sum
// 1400 over 5 rows); MSFT 200/650/1050 (sum 1900 over 6 rows).
const facts: [string, string, number | null][] = [
  ["AAPL", "2025-01-10", 100], ["AAPL", "2025-01-20", 150], ["AAPL", "2025-02-05", 300],
  ["AAPL", "2025-03-03", 400], ["AAPL", "2025-03-17", 450],
  ["MSFT", "2025-01-08", 200], ["MSFT", "2025-02-02", 300], ["MSFT", "2025-02-20", 350],
  ["MSFT", "2025-03-04", 500], ["MSFT", "2025-03-12", 250], ["MSFT", "2025-03-25", 300],
];
function dataset(rows: typeof facts): WidgetDataset {
  return {
    rows: rows.map(([Company, Date, Amount], i) => ({ id: `r${i}`, values: Amount === null ? { Company, Date } : { Company, Date, Amount } })),
    columns: [{ id: "Company", label: "Company", dtype: "text" }, { id: "Date", label: "Date", dtype: "date" }, { id: "Amount", label: "Amount", dtype: "number" }],
    resultRevision: 1, outputRevision: 1, provenance: { sourceWidgetId: "w" },
    completeness: { kind: "complete", warnings: [] }, freshness: { availability: "available", stale: false },
  };
}
const model = (over: Partial<TableModelV1>): TableModelV1 => ({
  schemaVersion: 1, params: { promotePage: true, filters: [] }, enabled: true,
  categories: [{ id: "co", name: "Company", sourceFieldId: "Company", transform: "native" }, { id: "mo", name: "Month", sourceFieldId: "Date", transform: "M" }],
  measures: [{ id: "sum", sourceFieldId: "Amount", aggregation: "sum" }],
  formulas: [], layout: { rows: ["co"], columns: [], values: ["sum"] }, checklists: [], resultFilters: [],
  subtotals: { grandTotal: true, groups: true }, ...over,
});

/** What the card does: drain presented(), then flatten for the writers. */
function exported(input: WidgetDataset, analytical?: TableModelV1) {
  const view = calculateView(input, { table: {}, search: "", analytical }, { kind: "none" });
  const batches = [...createResultStore(view, revision).presented("p", revision, "t")];
  return presentedForExport(batches[0].columns!, batches.flatMap((b) => b.rows));
}
async function readXlsx(rows: Record<string, unknown>[], columns: string[]) {
  const book = XLSX.read(await toXlsx(rows, columns), { type: "array" });
  return XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[book.SheetNames[0]], { header: 1, defval: null });
}

describe("worker table export", () => {
  const byCompany = model({
    measures: [
      { id: "sum", sourceFieldId: "Amount", aggregation: "sum" },
      { id: "count", sourceFieldId: "Amount", aggregation: "count" },
      { id: "mean", sourceFieldId: "Amount", aggregation: "mean" },
    ],
    layout: { rows: ["co"], columns: [], values: ["sum", "count", "mean"] },
  });

  it("exports the arranged by-Company result with raw values and no grand total, in CSV, JSON and Excel", async () => {
    const { columns, rows } = exported(dataset(facts), byCompany);
    const header = ["Company", "Amount — Total", "Amount — Count", "Amount — Average"];
    expect(columns).toEqual(header);
    expect(toCsv(rows, columns).split("\r\n")).toEqual([
      header.join(","),
      "AAPL,1400,5,280",
      `MSFT,1900,6,${1900 / 6}`,
    ]);
    expect(JSON.parse(toJsonRows(rows, columns))).toEqual([
      { Company: "AAPL", "Amount — Total": 1400, "Amount — Count": 5, "Amount — Average": 280 },
      { Company: "MSFT", "Amount — Total": 1900, "Amount — Count": 6, "Amount — Average": 1900 / 6 },
    ]);
    expect(await readXlsx(rows, columns)).toEqual([header, ["AAPL", 1400, 5, 280], ["MSFT", 1900, 6, 1900 / 6]]);
  });

  it("flattens column-group levels into the header: <member> · <measure>", async () => {
    const { columns, rows } = exported(dataset(facts), model({ layout: { rows: ["co"], columns: ["mo"], values: ["sum"] } }));
    const header = ["Company", "2025-01 · Amount — Total", "2025-02 · Amount — Total", "2025-03 · Amount — Total"];
    expect(columns).toEqual(header);
    expect(toCsv(rows, columns).split("\r\n")).toEqual([header.join(","), "AAPL,250,300,850", "MSFT,200,650,1050"]);
    expect(JSON.parse(toJsonRows(rows, columns))).toEqual([
      Object.fromEntries(header.map((h, i) => [h, ["AAPL", 250, 300, 850][i]])),
      Object.fromEntries(header.map((h, i) => [h, ["MSFT", 200, 650, 1050][i]])),
    ]);
    expect(await readXlsx(rows, columns)).toEqual([header, ["AAPL", 250, 300, 850], ["MSFT", 200, 650, 1050]]);
  });

  it("carries every row-group value on each nested leaf row, with no subtotal rows", async () => {
    const { columns, rows } = exported(dataset(facts), model({ layout: { rows: ["co", "mo"], columns: [], values: ["sum"] } }));
    const header = ["Company", "Month", "Amount — Total"];
    const leaves = [["AAPL", "2025-01", 250], ["AAPL", "2025-02", 300], ["AAPL", "2025-03", 850], ["MSFT", "2025-01", 200], ["MSFT", "2025-02", 650], ["MSFT", "2025-03", 1050]];
    expect(columns).toEqual(header);
    expect(toCsv(rows, columns).split("\r\n")).toEqual([header.join(","), ...leaves.map((l) => l.join(","))]);
    expect(JSON.parse(toJsonRows(rows, columns))).toEqual(leaves.map((l) => Object.fromEntries(header.map((h, i) => [h, l[i]]))));
    expect(await readXlsx(rows, columns)).toEqual([header, ...leaves]);
  });

  it("keeps both of two measures that flatten to one header", () => {
    const twice = model({ measures: [{ id: "a", sourceFieldId: "Amount", aggregation: "sum" }, { id: "b", sourceFieldId: "Amount", aggregation: "sum" }], layout: { rows: ["co"], columns: [], values: ["a", "b"] } });
    const { columns, rows } = exported(dataset(facts), twice);
    expect(columns).toEqual(["Company", "Amount — Total", "Amount — Total (2)"]);
    expect(rows[0]).toEqual({ Company: "AAPL", "Amount — Total": 1400, "Amount — Total (2)": 1400 });
  });

  it("round-trips the raw rows with no model, keeping a missing value missing", async () => {
    const raw: typeof facts = [["AAPL", "2025-01-10", 100], ["AAPL", "2025-01-20", null], ["MSFT", "2025-01-08", 200]];
    const { columns, rows } = exported(dataset(raw));
    expect(columns).toEqual(["Company", "Date", "Amount"]);
    const csv = toCsv(rows, columns);
    expect(csv.split("\r\n")).toEqual(["Company,Date,Amount", "AAPL,2025-01-10,100", "AAPL,2025-01-20,", "MSFT,2025-01-08,200"]);
    // Read back through the app's own CSV importer, not this module: the
    // same rows as the source, the missing Amount still absent (not 0).
    expect(await dataFromBytes("back.csv", new TextEncoder().encode(csv))).toEqual(dataset(raw).rows.map((r) => r.values));
    expect(JSON.parse(toJsonRows(rows, columns))[1]).toEqual({ Company: "AAPL", Date: "2025-01-20", Amount: null });
    expect((await readXlsx(rows, columns))[2]).toEqual(["AAPL", "2025-01-20", null]);
  });
});

// #29: a Statement exports its Section / Line item labels as the grid shows
// them, relabels included, never the internal statement/... member ids.
it("exports a Statement's displayed Section and Line item labels, not internal ids (#29)", async () => {
  const { fixture } = await import("./statementModel/compileFixtures");
  const f = fixture();
  f.statement.overrides.labels[f.ids.line("revenue")] = "Sales";
  const { columns, rows } = exported(f.source, f.statement as unknown as TableModelV1);
  const text = JSON.stringify(rows);
  expect(text).not.toContain("statement/");
  expect(rows.map((r) => columns.slice(0, 2).map((c) => r[c]))).toContainEqual(["Income", "Sales"]);
});

// D-019 (#32, ruled 2026-10-10): a calculation error exports with the reason
// the cell shows on screen, inline, identically in CSV, JSON and Excel.
it("exports a #ERROR cell with its reason inline (D-019, #32)", async () => {
  const reason = "Mixed currency contexts cannot be combined in a derived Statement value.";
  const { columns, rows } = presentedForExport(
    [{ id: "item", label: "Line item" }, { id: "fy", label: "FY2026" }],
    [{ id: "r", values: { item: "Gross profit", fy: "#ERROR" }, cellErrors: { fy: { code: "scope", message: reason } } }],
  );
  expect(rows).toEqual([{ "Line item": "Gross profit", FY2026: `#ERROR: ${reason}` }]);
  expect(toCsv(rows, columns).split("\r\n")[1]).toBe(`Gross profit,#ERROR: ${reason}`);
  expect(JSON.parse(toJsonRows(rows, columns))[0].FY2026).toBe(`#ERROR: ${reason}`);
  expect((await readXlsx(rows, columns))[1]).toEqual(["Gross profit", `#ERROR: ${reason}`]);
});
