// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { statementFixture } from "./statementModel/fixtures/load";
import { annualPeriodValue, correctStatementRows, inferYearEnds, isQuarterPeriod, knownYearEnds } from "./statementFiscal";
import { stampStatementRows } from "./statementSource";

const rows = (name: string) => statementFixture(name).rows;

describe("inferYearEnds", () => {
  it("reads an annual row's closing month: Walmart January, Apple September, JPMorgan December", () => {
    expect(inferYearEnds(rows("libre/wmt-yfinance-income-annual"), "annual", ["wmt"])).toEqual({ WMT: 1 });
    expect(inferYearEnds(rows("libre/aapl-yfinance-income-annual"), "annual", ["AAPL"])).toEqual({ AAPL: 9 });
    expect(inferYearEnds(rows("libre/jpm-sec-balance-annual"), "annual", ["JPM"])).toEqual({ JPM: 12 });
  });

  it("reads it from long rows too, by their own symbol", () => {
    expect(inferYearEnds(rows("openbqYfinance/wmt-income-annual"), "annual", [])).toEqual({ WMT: 1 });
  });

  it("says nothing for quarterly rows, whether or not they name a quarter", () => {
    expect(inferYearEnds(rows("libre/wmt-yfinance-income-quarter"), "quarter", ["WMT"])).toEqual({ WMT: null });
    // SEC names Walmart's July quarter Q2, truly fiscal. Other providers name Apple's December quarter Q4, the
    // calendar's. Nothing in a row says which convention it follows, so neither is read.
    expect(inferYearEnds(rows("libre/wmt-sec-income-quarter"), "quarterly", ["WMT"])).toEqual({ WMT: null });
    expect(inferYearEnds([{ symbol: "AAPL", period_ending: "2025-12-27", fiscal_period: "Q4" }], "quarter", ["AAPL"])).toEqual({ AAPL: null });
  });

  it("counts a 52/53-week year closing in the first days of a month toward the month before", () => {
    expect(inferYearEnds([{ period_ending: "2026-10-03" }], "annual", ["X"])).toEqual({ X: 9 });
  });

  it("tells companies apart by each row's symbol", () => {
    const merged = [
      ...stampStatementRows(rows("libre/aapl-yfinance-income-annual"), "AAPL", "annual"),
      ...stampStatementRows(rows("libre/wmt-yfinance-income-annual"), "WMT", "annual"),
    ];
    expect(inferYearEnds(merged, "annual", ["AAPL", "WMT"])).toEqual({ AAPL: 9, WMT: 1 });
  });

  it("guesses nothing: no symbol on the rows and several on the card, an unreadable date, a period it does not know", () => {
    expect(inferYearEnds(rows("libre/wmt-yfinance-income-annual"), "annual", ["AAPL", "WMT"])).toEqual({});
    expect(inferYearEnds([{ period_ending: "soon" }], "annual", ["X"])).toEqual({ X: null });
    expect(inferYearEnds(rows("libre/wmt-yfinance-income-annual"), "ttm", ["WMT"])).toEqual({ WMT: null });
  });
});

describe("knownYearEnds", () => {
  it("takes the lookup's answer first and the rows' where it has none", () => {
    expect(knownYearEnds({ AAPL: 9, WMT: null }, { AAPL: 12, WMT: 1, JPM: 12 })).toEqual({ AAPL: 9, WMT: 1, JPM: 12 });
    expect(knownYearEnds({ XOM: null }, {})).toEqual({ XOM: null });
  });
});

describe("a backend with no year-end lookup", () => {
  it("still labels an annual statement by the company's own year", () => {
    const served = rows("libre/wmt-yfinance-income-annual");
    const out = correctStatementRows(served, "annual", knownYearEnds({ WMT: null }, inferYearEnds(served, "annual", ["WMT"])), ["WMT"]);
    expect(out.asReported).toBe(false);
    expect(out.rows.map((r) => [r.period_ending, r.fiscal_year, r.fiscal_period]).slice(0, 2)).toEqual([
      ["2026-01-31", "FY2026", "FY"],
      ["2025-01-31", "FY2025", "FY"],
    ]);
  });

  it("leaves a quarterly statement as reported until something names the year end", () => {
    const served = rows("libre/wmt-yfinance-income-quarter");
    expect(correctStatementRows(served, "quarter", knownYearEnds({ WMT: null }, inferYearEnds(served, "quarter", ["WMT"])), ["WMT"]).asReported).toBe(true);
    // One annual row answers it: the July quarter is then Walmart's fiscal 2027 Q2.
    const labelled = correctStatementRows(served, "quarter", { WMT: 1 }, ["WMT"]);
    const july = labelled.rows.find((r) => r.period_ending === "2026-07-31")!;
    expect([july.fiscal_year, july.fiscal_period]).toEqual(["FY2027", "FQ2"]);
  });
});

describe("period bounds, when a Statement template asks for them", () => {
  const bounded = (name: string, period: string, yearEnds: Record<string, number | null>, symbol: string) =>
    correctStatementRows(rows(name), period, yearEnds, [symbol], false, true).rows;

  it("adds nothing unless asked", () => {
    const out = correctStatementRows(rows("libre/wmt-yfinance-income-annual"), "annual", { WMT: 1 }, ["WMT"]).rows;
    expect(out.some((r) => Object.hasOwn(r, "period_start") || Object.hasOwn(r, "period_end"))).toBe(false);
  });

  it("gives an annual row its fiscal year's two dates", () => {
    const [latest] = bounded("libre/wmt-yfinance-income-annual", "annual", { WMT: 1 }, "WMT");
    expect(latest).toMatchObject({ period_ending: "2026-01-31", fiscal_year: "FY2026", period_start: "2025-02-01", period_end: "2026-01-31" });
  });

  it("gives a quarterly row its fiscal quarter's two dates", () => {
    const july = bounded("libre/wmt-yfinance-income-quarter", "quarter", { WMT: 1 }, "WMT").find((r) => r.period_ending === "2026-07-31")!;
    expect(july).toMatchObject({ fiscal_year: "FY2027", fiscal_period: "FQ2", period_start: "2026-05-01", period_end: "2026-07-31" });
  });

  it("always holds the row's own closing date, for a filer that closes off the month's end", () => {
    const early = correctStatementRows([{ period_ending: "2026-09-26" }], "annual", { X: 9 }, ["X"], false, true).rows[0];
    expect(early).toMatchObject({ period_start: "2025-10-01", period_end: "2026-09-30" });
    const late = correctStatementRows([{ period_ending: "2026-10-03" }], "annual", { X: 9 }, ["X"], false, true).rows[0];
    expect(late).toMatchObject({ fiscal_year: "FY2026", period_start: "2025-10-01", period_end: "2026-10-03" });
  });

  it("gives a row it could not label no dates either", () => {
    const out = correctStatementRows(rows("libre/wmt-yfinance-income-quarter"), "quarter", { WMT: null }, ["WMT"], false, true);
    expect(out.asReported).toBe(true);
    expect(out.rows.some((r) => Object.hasOwn(r, "period_start"))).toBe(false);
  });

  it("gives a trailing-twelve-month row none", () => {
    const [ttm] = correctStatementRows([{ period_ending: "2026-07-31" }], "ttm", { X: 1 }, ["X"], false, true).rows;
    expect(ttm.fiscal_period).toBe("TTM");
    expect(Object.hasOwn(ttm, "period_start")).toBe(false);
  });
});

describe("period helpers", () => {
  it("knows a quarter period by any of its spellings", () => {
    expect(["quarter", "quarterly", "Q"].every(isQuarterPeriod)).toBe(true);
    expect(["annual", "FY", "ttm", ""].some(isQuarterPeriod)).toBe(false);
  });
  it("finds the value a period param takes for annual rows", () => {
    expect(annualPeriodValue([{ label: "FQ", value: "quarter" }, { label: "FY", value: "annual" }])).toBe("annual");
    expect(annualPeriodValue([{ label: "FY", value: "FY" }])).toBe("FY");
    expect(annualPeriodValue([{ label: "FQ", value: "quarter" }])).toBeUndefined();
    expect(annualPeriodValue(undefined)).toBeUndefined();
  });
});
