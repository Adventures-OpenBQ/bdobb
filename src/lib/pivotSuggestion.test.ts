// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import type { Periodicity } from "./periodicity";
import { suggestionFor } from "./pivotSuggestion";
import type { FieldKind } from "./pivotTable";
import { tableColumns, type Row } from "./tableColumns";
import type { AggregationHint, PivotConfig, TableSpec } from "./types";

const hint = (over: Partial<AggregationHint>): AggregationHint => ({
  time: "last",
  frequencies: ["annual", "quarter"],
  entity: "require_selection",
  status: "conditional",
  ruleset: "2026-09-20.1",
  ...over,
});

/** A cash-flow statement widget as openbq-eodhd now describes it. */
const spec: TableSpec = {
  columns: [
    { field: "period_ending", cellDataType: "date", aggregation: hint({ time: null, status: "dimension" }) },
    { field: "fiscal_year", aggregation: hint({ time: null, status: "dimension" }) },
    { field: "cash_at_end_of_period", cellDataType: "number", aggregation: hint({ time: "last" }) },
    { field: "net_change_in_cash", cellDataType: "number", aggregation: hint({ time: "sum" }) },
    { field: "minority_interest", cellDataType: "number", aggregation: hint({ time: null, status: "requires_selection" }) },
    { field: "sector" },
    { field: "note" },
  ],
};
const rows: Row[] = ["2024-03-31", "2024-06-30", "2024-09-30", "2024-12-31"].map((d, i) => ({
  period_ending: d, fiscal_year: 2024, cash_at_end_of_period: i, net_change_in_cash: 1, minority_interest: 0, sector: "Tech", note: "n",
}));
const columns = tableColumns(rows, spec);
const kinds = new Map<string, FieldKind>([
  ["period_ending", "date"], ["fiscal_year", "number"], ["cash_at_end_of_period", "number"],
  ["net_change_in_cash", "number"], ["minority_interest", "number"], ["sector", "text"], ["note", "text"],
]);
const periodicity = new Map<string, Periodicity>([["period_ending", "quarterly"]]);
const ask = (field: string, config: Partial<PivotConfig>) =>
  suggestionFor({ field, columns, kinds, periodicity, config: { enabled: true, grouping: [], split: [], ...config } });

describe("suggestionFor", () => {
  it("offers the provider's rule when the pivot buckets by a reviewed frequency", () => {
    // Native quarterly data split by quarter: reviewed.
    expect(ask("cash_at_end_of_period", { split: ["period_ending"] })).toEqual({ kind: "suggested", fn: "last" });
    // Rolled up to the year: also reviewed ("annual").
    expect(ask("net_change_in_cash", { split: ["period_ending"], buckets: { period_ending: "year" } })).toEqual({ kind: "suggested", fn: "sum" });
  });

  it("says nothing for a column with no hint, or a dimension", () => {
    expect(ask("note", { split: ["period_ending"] })).toEqual({ kind: "none" });
    expect(ask("period_ending", { split: ["period_ending"] })).toEqual({ kind: "none" });
  });

  it("distinguishes a reviewed no-rule column from one with no hint at all", () => {
    expect(ask("minority_interest", { split: ["period_ending"] })).toEqual({ kind: "unreviewed" });
  });

  it("withholds the rule when the effective bucket was not reviewed", () => {
    expect(ask("cash_at_end_of_period", { split: ["period_ending"], buckets: { period_ending: "month" } })).toEqual({
      kind: "frequency",
      reviewed: ["annual", "quarter"],
    });
    // No date grouping at all collapses every period into one cell: not a reviewed frequency either.
    expect(ask("cash_at_end_of_period", { grouping: ["fiscal_year"] })).toEqual({ kind: "frequency", reviewed: ["annual", "quarter"] });
  });

  it("withholds the rule when a group would combine entities", () => {
    expect(ask("cash_at_end_of_period", { grouping: ["sector"], split: ["period_ending"] })).toEqual({ kind: "entity", field: "sector" });
    // A dimension row group keeps entities apart and is fine.
    expect(ask("cash_at_end_of_period", { grouping: ["fiscal_year"], split: ["period_ending"] })).toEqual({ kind: "suggested", fn: "last" });
  });

  it("maps EOD intervals: daily data suggests at native, week and month, not quarter", () => {
    const bars: TableSpec = {
      columns: [
        { field: "date", cellDataType: "date", aggregation: hint({ time: null, status: "dimension", frequencies: ["1d", "1W", "1M"] }) },
        { field: "close", cellDataType: "number", aggregation: hint({ time: "last", frequencies: ["1d", "1W", "1M"] }) },
      ],
    };
    const barRows: Row[] = ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"].map((date, i) => ({ date, close: i }));
    const input = { columns: tableColumns(barRows, bars), kinds: new Map<string, FieldKind>([["date", "date"], ["close", "number"]]), periodicity: new Map<string, Periodicity>([["date", "daily"]]) };
    const at = (bucket?: "week" | "month" | "quarter") =>
      suggestionFor({ ...input, field: "close", config: { enabled: true, grouping: [], split: ["date"], ...(bucket ? { buckets: { date: bucket } } : {}) } });
    expect(at()).toEqual({ kind: "suggested", fn: "last" });
    expect(at("week")).toEqual({ kind: "suggested", fn: "last" });
    expect(at("month")).toEqual({ kind: "suggested", fn: "last" });
    expect(at("quarter")).toEqual({ kind: "frequency", reviewed: ["1d", "1W", "1M"] });
  });

  it("never suggests an operator the column cannot take", () => {
    // first/last need a date column; without one the suggestion is withheld, not shown.
    const noDate = { columns, kinds: new Map(kinds).set("period_ending", "text"), periodicity: new Map<string, Periodicity>() };
    expect(suggestionFor({ ...noDate, field: "cash_at_end_of_period", config: { enabled: true, grouping: ["fiscal_year"], split: [] } })).toEqual({ kind: "none" });
  });
});
