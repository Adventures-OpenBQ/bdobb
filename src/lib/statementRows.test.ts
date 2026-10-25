// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { ITEM_COLUMN, SECTION_COLUMN, statementRows } from "./statementRows";
import { correctStatementRows } from "./statementFiscal";
import type { TableSpec } from "./types";
import incomeLong from "../test/fixtures/openbq-yfinance/aapl-income-annual.json";
import balanceLong from "../test/fixtures/openbq-yfinance/aapl-balance-annual.json";

// Two AAPL quarters, newest first, as the backend sends them.
const INCOME = [
  { period_ending: "2026-06-30", fiscal_period: "Q3", fiscal_year: 2026, reported_currency: "USD", revenue: 109417000000, cost_of_revenue: 54647000000, gross_profit: 54770000000, minority_interest: null, cik: 320193 },
  { period_ending: "2026-03-31", fiscal_period: "Q2", fiscal_year: 2026, reported_currency: "USD", revenue: 95359000000, cost_of_revenue: 50492000000, gross_profit: 44867000000, minority_interest: null, cik: 320193 },
];

describe("statementRows", () => {
  it("turns statement rows into sections × fiscal periods, newest first, in wire order", () => {
    const out = statementRows(INCOME);
    expect(out?.statement).toBe("income");
    expect(out?.headers).toEqual(["FY2026-Q3", "FY2026-Q2"]);
    expect(out?.columns).toEqual([SECTION_COLUMN, ITEM_COLUMN, "FY2026-Q3", "FY2026-Q2"]);
    expect(out?.sections.map((s) => [s.name, s.items.map((i) => i.field)])).toEqual([
      ["Income", ["revenue"]],
      ["Expenses", ["cost_of_revenue"]],
      ["Profit", ["gross_profit"]],
    ]);
    expect(out?.sections[0].items[0].values).toEqual([109417000000, 95359000000]);
  });

  it("flattens the same content into export rows keyed by Section and Line item", () => {
    const out = statementRows(INCOME);
    expect(out?.rows[0]).toEqual({
      [SECTION_COLUMN]: "Income",
      [ITEM_COLUMN]: "Revenue",
      "FY2026-Q3": 109417000000,
      "FY2026-Q2": 95359000000,
    });
    expect(out?.rows).toHaveLength(3);
  });

  it("drops identity fields, text fields and lines that are null in every period", () => {
    const fields = statementRows(INCOME)?.sections.flatMap((s) => s.items.map((i) => i.field));
    expect(fields).not.toContain("cik");
    expect(fields).not.toContain("reported_currency");
    expect(fields).not.toContain("minority_interest");
    // A line numeric in one period and text in another is not a line item either.
    const mixed = statementRows([{ revenue: 1, ebit: 2 }, { revenue: 2, ebit: "n/a" }]);
    expect(mixed?.sections.flatMap((s) => s.items.map((i) => i.field))).toEqual(["revenue"]);
  });

  it("labels from the widget's headerName, else the field name in title case with spaces", () => {
    const spec: TableSpec = { columns: [{ field: "revenue", headerName: "Total Revenue" }] };
    const items = statementRows(INCOME, spec)?.sections.flatMap((s) => s.items);
    expect(items?.find((i) => i.field === "revenue")?.label).toBe("Total Revenue");
    expect(items?.find((i) => i.field === "cost_of_revenue")?.label).toBe("Cost Of Revenue");
  });

  it("keeps EBIT, EBITDA and EPS upper case in a label made from the field name (#24)", () => {
    const items = statementRows([{ revenue: 1, ebit: 2, ebitda: 3, eps_diluted: 4 }])?.sections.flatMap((s) => s.items);
    expect(items?.find((i) => i.field === "ebit")?.label).toBe("EBIT");
    expect(items?.find((i) => i.field === "ebitda")?.label).toBe("EBITDA");
    expect(items?.find((i) => i.field === "eps_diluted")?.label).toBe("EPS Diluted");
  });

  it("carries the column's format so cells render as the table view would", () => {
    const spec: TableSpec = { columns: [{ field: "revenue", formatterFn: "int" }] };
    const items = statementRows(INCOME, spec)?.sections.flatMap((s) => s.items);
    expect(items?.find((i) => i.field === "revenue")?.format?.formatterFn).toBe("int");
  });

  // The fiscal-label correction (statementFiscal.ts) names a non-December
  // filer's year "FY2027" and its quarter "FQ2": the header must not read "FYFY2027".
  it("headers from corrected rows: FY2027-Q2 (January filer), FY2026-Q3 (December), FY2027 (annual), FY2020-TTM", () => {
    const rows = [{ period_ending: "2026-07-31", fiscal_period: "quarter", fiscal_year: 2026, revenue: 1 }];
    expect(statementRows(correctStatementRows(rows, "quarter", { WMT: 1 }, ["WMT"]).rows)?.headers).toEqual(["FY2027-Q2"]);
    expect(statementRows(correctStatementRows(rows, "annual", { WMT: 1 }, ["WMT"]).rows)?.headers).toEqual(["FY2027"]);
    const dec = [{ period_ending: "2026-09-30", fiscal_period: "quarter", fiscal_year: 2020, revenue: 1 }];
    expect(statementRows(correctStatementRows(dec, "quarter", { AAPL: 12 }, ["AAPL"]).rows)?.headers).toEqual(["FY2026-Q3"]);
    expect(statementRows(correctStatementRows(dec, "ttm", { AAPL: 12 }, ["AAPL"]).rows)?.headers).toEqual(["FY2020-TTM"]);
  });

  it("composes headers: annual rows read FY2025; rows without fiscal fields fall back to period_ending; duplicates get (n)", () => {
    expect(statementRows([{ fiscal_year: 2025, fiscal_period: "FY", revenue: 1 }])?.headers).toEqual(["FY2025"]);
    expect(statementRows([{ period_ending: "2025-09-27", revenue: 1 }])?.headers).toEqual(["2025-09-27"]);
    expect(statementRows([{ revenue: 1 }, { revenue: 2 }])?.headers).toEqual(["—", "— (2)"]);
    expect(
      statementRows([
        { fiscal_year: 2026, fiscal_period: "Q1", revenue: 1 },
        { fiscal_year: 2026, fiscal_period: "Q1", revenue: 2 },
      ])?.headers,
    ).toEqual(["FY2026-Q1", "FY2026-Q1 (2)"]);
  });

  it("a period header colliding with Section or Line item gets (2), the uniqueHeaders reserved-name rule", () => {
    expect(
      statementRows([
        { period_ending: "Line item", revenue: 1 },
        { period_ending: "Section", revenue: 2 },
      ])?.headers,
    ).toEqual(["Line item (2)", "Section (2)"]);
  });

  it("puts unlisted numeric fields in a trailing Other section, in first-seen order", () => {
    const out = statementRows([{ revenue: 1, zeta_line: 2, alpha_line: 3 }]);
    expect(out?.sections.map((s) => s.name)).toEqual(["Income", "Other"]);
    expect(out?.sections[1].items.map((i) => i.field)).toEqual(["zeta_line", "alpha_line"]);
  });

  it("detects the three statements and orders their sections", () => {
    expect(statementRows([{ net_income: 1, net_cash_from_operating_activities: 2, capital_expenditure: 3 }])?.sections.map((s) => s.name)).toEqual(["Operating", "Investing"]);
    expect(statementRows([{ total_assets: 1, total_liabilities: 2, net_income: 3 }])?.sections.map((s) => s.name)).toEqual(["Assets", "Liabilities", "Other"]);
  });

  it("is null when nothing qualifies", () => {
    expect(statementRows([])).toBeNull();
    expect(statementRows([{ symbol: "AAPL", price: 1 }])).toBeNull();
    expect(statementRows([{ revenue: null }])).toBeNull();
    expect(statementRows([{ revenue: "n/a" }])).toBeNull();
  });

  it("reads rows through Object.hasOwn: a column named constructor cannot reach the prototype", () => {
    const out = statementRows([{ revenue: 1 }, { revenue: 2, constructor: 3 }]);
    expect(out?.sections.flatMap((s) => s.items).find((i) => i.field === "constructor")?.values).toEqual([undefined, 3]);
  });
});

// User ruling 2026-10-10: OPENBQ's yfinance statements are long-form rows
// (symbol, date, period, line_item, value). The Statement view widens them
// to the per-period rows it already reads. Fixtures are captured OPENBQ API
// responses (AAPL annual, two periods).

describe("statementRows on a multi-reporter statement", () => {
  it("prefixes each wide row's header with its symbol", () => {
    const rows = [
      { symbol: "AAPL", fiscal_year: 2025, fiscal_period: "FY", revenue: 1 },
      { symbol: "MSFT", fiscal_year: 2025, fiscal_period: "FY", revenue: 2 },
    ];
    expect(statementRows(rows)?.headers).toEqual(["AAPL FY2025", "MSFT FY2025"]);
    expect(statementRows([rows[0]])?.headers).toEqual(["FY2025"]);
  });
});

describe("statementRows on long-form OPENBQ yfinance rows", () => {
  const valueOf = (rows: typeof incomeLong, item: string, date: string) => rows.find((r) => r.line_item === item && r.date === date)?.value;
  const items = (out: ReturnType<typeof statementRows>) => out?.sections.flatMap((s) => s.items) ?? [];

  it("reads an income statement: one column per date in served order, the served values", () => {
    const out = statementRows(incomeLong);
    expect(out?.statement).toBe("income");
    expect(out?.headers).toEqual(["2025-09-30", "2024-09-30"]);
    const net = items(out).find((i) => i.field === "net_income");
    expect(net?.values).toEqual([valueOf(incomeLong, "net_income", "2025-09-30"), valueOf(incomeLong, "net_income", "2024-09-30")]);
    // Every line item with a value in some period is a line; none is lost.
    const withValue = new Set(incomeLong.filter((r) => r.value !== null).map((r) => r.line_item));
    expect(new Set(items(out).map((i) => i.field))).toEqual(withValue);
  });

  it("reads a balance sheet the same way", () => {
    const out = statementRows(balanceLong);
    expect(out?.statement).toBe("balance");
    expect(items(out).find((i) => i.field === "total_assets")?.values).toEqual([valueOf(balanceLong, "total_assets", "2025-09-30"), valueOf(balanceLong, "total_assets", "2024-09-30")]);
  });

  it("keeps line items outside the taxonomy in served order", () => {
    const out = statementRows(incomeLong)!;
    const other = out.sections.find((s) => s.name === "Other")?.items.map((i) => i.field) ?? [];
    const served = [...new Set(incomeLong.map((r) => r.line_item))].filter((f) => other.includes(f));
    expect(other).toEqual(served);
  });

  it("keeps every served symbol, its headers prefixed with the symbol", () => {
    const msft = incomeLong.map((r) => ({ ...r, symbol: "MSFT", value: r.value === null ? null : r.value + 1 }));
    const out = statementRows([...incomeLong, ...msft]);
    expect(out?.headers).toEqual(["AAPL 2025-09-30", "AAPL 2024-09-30", "MSFT 2025-09-30", "MSFT 2024-09-30"]);
    expect(items(out).find((i) => i.field === "net_income")?.values).toEqual([
      valueOf(incomeLong, "net_income", "2025-09-30"), valueOf(incomeLong, "net_income", "2024-09-30"),
      valueOf(msft, "net_income", "2025-09-30"), valueOf(msft, "net_income", "2024-09-30"),
    ]);
  });

  it("formats every line with the widget's value column format", () => {
    const out = statementRows(incomeLong, { columns: [{ field: "value", formatterFn: "int" }] });
    expect(items(out).find((i) => i.field === "net_income")?.format?.formatterFn).toBe("int");
  });
});
