// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { correctStatementRows, statementReporters, fiscalPeriodLabel, fiscalPeriodOptions, groupValueLabel, isStatementPeriodParam, type Row } from "./statementFiscal";
import { statementRows } from "./statementRows";
import aaplYf from "../test/fixtures/openbq-yfinance/aapl-income-annual.json";

const opt = (...values: string[]) => values.map((value) => ({ label: value, value }));

describe("fiscalPeriodLabel", () => {
  it("names each provider's value in the app's convention", () => {
    expect(["annual", "quarter", "quarterly", "Q", "ttm", "TTM", "quarterly_yoy", "FY"].map(fiscalPeriodLabel))
      .toEqual(["FY", "FQ", "FQ", "FQ", "TTM", "TTM", "FQ YoY", "FY"]);
  });
  it("leaves an unknown value unlabelled", () => {
    expect(fiscalPeriodLabel("monthly")).toBeUndefined();
  });
});

describe("isStatementPeriodParam", () => {
  it("is a period offering annual and a quarter form", () => {
    expect(isStatementPeriodParam({ paramName: "period", options: opt("annual", "quarter") })).toBe(true);
    expect(isStatementPeriodParam({ paramName: "period", options: opt("FY", "Q", "TTM") })).toBe(true);
  });
  it("is never a calendar frequency or a calendar period", () => {
    expect(isStatementPeriodParam({ paramName: "frequency", options: opt("annual", "quarter") })).toBe(false);
    expect(isStatementPeriodParam({ paramName: "calendar_period", options: opt("fy", "q1") })).toBe(false);
    expect(isStatementPeriodParam({ paramName: "period", options: opt("1d", "1w") })).toBe(false);
  });
});

describe("fiscalPeriodOptions", () => {
  it("relabels and keeps every value", () => {
    expect(fiscalPeriodOptions(opt("annual", "quarter"), "annual")).toEqual([
      { label: "FY", value: "annual" }, { label: "FQ", value: "quarter" },
    ]);
  });
  // Review Focus 4: TMX offers both quarter and quarterly.
  it("shows one FQ, keeping the stored value's option", () => {
    const tmx = opt("annual", "quarterly", "ttm", "quarter");
    expect(fiscalPeriodOptions(tmx, "quarter").map((o) => o.value)).toEqual(["annual", "ttm", "quarter"]);
    expect(fiscalPeriodOptions(tmx, "quarterly").map((o) => o.value)).toEqual(["annual", "quarterly", "ttm"]);
    expect(fiscalPeriodOptions(tmx, "annual").map((o) => o.value)).toEqual(["annual", "quarterly", "ttm"]);
  });
});

describe("groupValueLabel", () => {
  it("names a period group's value and leaves every other group alone", () => {
    expect(groupValueLabel({ paramName: "period", value: "annual" })).toBe("FY");
    expect(groupValueLabel({ paramName: "frequency", value: "quarter" })).toBe("quarter");
    expect(groupValueLabel({ paramName: "symbol", value: "AAPL" })).toBe("AAPL");
  });
});

describe("correctStatementRows", () => {
  const wmt = [
    { period_ending: "2026-07-31", fiscal_period: "quarter", fiscal_year: 2026 },
    { period_ending: "2026-01-31", fiscal_period: "QQ4", fiscal_year: 2026 },
  ];
  it("labels a January filer's quarters FQ / FY", () => {
    const out = correctStatementRows(wmt, "quarter", { WMT: 1 }, ["WMT"]);
    expect(out.asReported).toBe(false);
    expect(out.rows.map((r) => [r.fiscal_period, r.fiscal_year])).toEqual([["FQ2", "FY2027"], ["FQ4", "FY2026"]]);
  });
  it("labels a December filer's quarters Q / plain year", () => {
    const out = correctStatementRows([{ period_ending: "2026-06-30" }], "quarter", { JPM: 12 }, ["JPM"]);
    expect(out.rows[0]).toMatchObject({ fiscal_period: "Q2", fiscal_year: "2026" });
  });
  it("labels annual rows FY, prefixing the year off December", () => {
    expect(correctStatementRows([{ period_ending: "2026-09-26" }], "annual", { AAPL: 9 }, ["AAPL"]).rows[0])
      .toMatchObject({ fiscal_period: "FY", fiscal_year: "FY2026" });
    expect(correctStatementRows([{ period_ending: "2025-12-31" }], "FY", { JPM: 12 }, ["JPM"]).rows[0])
      .toMatchObject({ fiscal_period: "FY", fiscal_year: "2025" });
  });
  it("counts a quarter ending in a month's first week toward the month before", () => {
    // A September filer's 52/53-week quarter ending 1 October is still Q4 of that year.
    expect(correctStatementRows([{ period_ending: "2022-10-01" }], "quarter", { AAPL: 9 }, ["AAPL"]).rows[0])
      .toMatchObject({ fiscal_period: "FQ4", fiscal_year: "FY2022" });
  });
  it("labels TTM rows TTM and leaves their year", () => {
    expect(correctStatementRows([{ period_ending: "2026-07-31", fiscal_year: 2026 }], "ttm", { WMT: 1 }, ["WMT"]).rows[0])
      .toMatchObject({ fiscal_period: "TTM", fiscal_year: 2026 });
  });
  it("treats quarterly_yoy and Q as quarterly", () => {
    expect(correctStatementRows([{ period_ending: "2026-07-31" }], "quarterly_yoy", { WMT: 1 }, ["WMT"]).rows[0].fiscal_period).toBe("FQ2");
    expect(correctStatementRows([{ period_ending: "2026-07-31" }], "Q", { WMT: 1 }, ["WMT"]).rows[0].fiscal_period).toBe("FQ2");
  });
  it("passes rows through as reported when the year end is unknown", () => {
    const out = correctStatementRows(wmt, "quarter", { WMT: null }, ["WMT"]);
    expect(out).toEqual({ rows: wmt, asReported: true });
  });
  // Review Focus 3: yfinance sends neither field.
  it("adds the fields to a row that has none", () => {
    expect(correctStatementRows([{ period_ending: "2026-07-31" }], "quarter", { WMT: 1 }, ["WMT"]).rows[0])
      .toEqual({ period_ending: "2026-07-31", fiscal_period: "FQ2", fiscal_year: "FY2027" });
  });
  // Review Focus 2.
  it("reads a datetime period end by its date", () => {
    expect(correctStatementRows([{ period_ending: "2026-07-31T00:00:00" }], "quarter", { WMT: 1 }, ["WMT"]).rows[0].fiscal_period).toBe("FQ2");
  });
  it("uses each row's own symbol on a multi-symbol card", () => {
    const rows = [{ symbol: "WMT", period_ending: "2026-07-31" }, { symbol: "JPM", period_ending: "2026-06-30" }];
    const out = correctStatementRows(rows, "quarter", { WMT: 1, JPM: 12 }, ["WMT", "JPM"]);
    expect(out.rows.map((r) => r.fiscal_period)).toEqual(["FQ2", "Q2"]);
  });
  // OPENBQ's yfinance long rows carry `date`, not `period_ending`.
  it("reads a row's date when it has no period_ending, so yfinance statements relabel", () => {
    const out = correctStatementRows(aaplYf as Row[], "annual", { AAPL: 9 }, ["AAPL"]);
    expect(out.asReported).toBe(false);
    expect(statementRows(out.rows)?.headers).toEqual(["FY2025", "FY2024"]);
  });
  it("is as reported, not silent, when a statement row's period end is unreadable", () => {
    const rows = [{ symbol: "WMT", period_ending: "2026-07-31" }, { symbol: "WMT", period_ending: "Q2 2026" }, { symbol: "WMT" }];
    expect(correctStatementRows(rows, "quarter", { WMT: 1 }, ["WMT"])).toEqual({ rows, asReported: true });
  });
  // Review Focus 1.
  it("passes rows through when several symbols share rows with no symbol column", () => {
    const rows = [{ period_ending: "2026-07-31" }];
    expect(correctStatementRows(rows, "quarter", { WMT: 1, JPM: 12 }, ["WMT", "JPM"])).toEqual({ rows, asReported: true });
  });
});

// User ruling 2026-10-15: a local table has no period param, so each row's own fiscal_period names its kind.
describe("correctStatementRows, per row", () => {
  const rows = [
    { symbol: "WMT", period_ending: "2026-07-31", fiscal_period: "Q2" },
    { symbol: "WMT", period_ending: "2026-01-31", fiscal_period: "FY" },
    { symbol: "WMT", period_ending: "2026-07-31", fiscal_period: "TTM", fiscal_year: 2026 },
    { symbol: "WMT", period_ending: "2026-07-31", fiscal_period: "H1" },
  ];
  it("reads each row's kind from its own fiscal_period, leaving unmatched rows unchanged", () => {
    const out = correctStatementRows(rows, "", { WMT: 1 }, [], true);
    expect(out.asReported).toBe(false);
    expect(out.rows.map((r) => [r.fiscal_period, r.fiscal_year])).toEqual([["FQ2", "FY2027"], ["FY", "FY2026"], ["TTM", 2026], ["H1", undefined]]);
  });
  it("is as reported when a matched row's reporter has no year end", () => {
    expect(correctStatementRows(rows, "", {}, [], true)).toEqual({ rows, asReported: true });
  });
  it("is not as reported when no row is a statement row", () => {
    const plain = [{ symbol: "WMT", revenue: 1 }];
    expect(correctStatementRows(plain, "", {}, [], true)).toEqual({ rows: plain, asReported: false });
  });
  it("names the reporters of the statement rows, or null when there are none", () => {
    expect(statementReporters([...rows, { symbol: "jpm", fiscal_period: "FQ1" }, { symbol: "IBM", fiscal_period: "H1" }])).toEqual(["WMT", "JPM"]);
    expect(statementReporters([{ symbol: "WMT", revenue: 1 }])).toBeNull();
    expect(statementReporters([{ fiscal_period: "FY" }])).toEqual([]);
  });
  it("names no reporters past the year-end protocol's limits: a symbol over 64 chars, or over 1000 symbols", () => {
    expect(statementReporters([{ symbol: "X".repeat(65), fiscal_period: "FY" }, { symbol: "WMT", fiscal_period: "FY" }])).toEqual([]);
    expect(statementReporters([{ symbol: "X".repeat(64), fiscal_period: "FY" }])).toEqual(["X".repeat(64)]);
    expect(statementReporters(Array.from({ length: 1001 }, (_, i) => ({ symbol: `S${i}`, fiscal_period: "FY" })))).toEqual([]);
    expect(statementReporters(Array.from({ length: 1000 }, (_, i) => ({ symbol: `S${i}`, fiscal_period: "FY" })))).toHaveLength(1000);
  });
});
