// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { statementRows } from "../statementRows";
import { repeatedLines } from "./duplicates";
import { statementFixture } from "./fixtures/load";

const line = (field: string, ...values: unknown[]) => ({ field, values });

describe("repeatedLines", () => {
  it("names the later of two lines with the same figure in every period", () => {
    expect(repeatedLines([{ items: [line("a", 1, 2), line("b", 3, 4)] }, { items: [line("c", 1, 2)] }])).toEqual(new Set(["c"]));
  });

  it("needs every period to agree, missing ones included", () => {
    expect(repeatedLines([{ items: [line("a", 1, 2), line("b", 1, 3), line("c", 1, null), line("d", 1, undefined)] }])).toEqual(new Set(["d"]));
  });

  it("never calls two empty lines, a text line or a line with an error a repeat", () => {
    expect(repeatedLines([{ items: [line("a", null, null), line("b", null, null)] }])).toEqual(new Set());
    expect(repeatedLines([{ items: [line("a", "x", "y"), line("b", "x", "y")] }])).toEqual(new Set());
    expect(repeatedLines([{ items: [line("a", 1, 2), { field: "b", values: [1, 2], errors: [undefined, { message: "no" }] }] }])).toEqual(new Set());
  });

  it("never calls a total or subtotal a repeat", () => {
    expect(repeatedLines([{ items: [line("operating_revenue", 5, 6), { ...line("total_revenue", 5, 6), emphasis: "total" }, line("again", 5, 6)] }])).toEqual(new Set(["again"]));
  });

  it("finds what Yahoo reports twice in Apple's income statement, and nothing a reader would miss", () => {
    const out = statementRows(statementFixture("libre/aapl-yfinance-income-annual").rows)!;
    const repeats = repeatedLines(out.sections);
    expect(repeats.has("interest_income_non_operating")).toBe(true);
    expect(repeats.has("other_income_expense")).toBe(true);
    for (const kept of ["total_revenue", "gross_profit", "operating_income", "net_income", "interest_income", "other_non_operating_income_expenses"]) {
      expect(repeats.has(kept), kept).toBe(false);
    }
  });
});
