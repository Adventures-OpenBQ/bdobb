// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { card } from "../test/fixtures";
import type { Dashboard } from "./types";
import {
  buildSymbolList,
  canFeedGroup,
  defaultTickerColumn,
  shouldWrite,
  SYMBOL_GROUP_CAP,
  tableLabel,
  tickerColumns,
} from "./symbolGroupSource";

describe("buildSymbolList (spec 2026-11-13 §1)", () => {
  it("trims, upper-cases and drops nulls and blanks, keeping duplicates in place", () => {
    expect(buildSymbolList([" aapl ", null, "", "msft", undefined, "AAPL", "  "])).toEqual({ list: "AAPL,MSFT,AAPL", capped: false });
  });

  it("converts non-text cells to text and drops a cell holding a comma", () => {
    expect(buildSymbolList([7203, true, "brk.b", "A,B", "spy"])).toEqual({ list: "7203,TRUE,BRK.B,SPY", capped: false });
  });

  it(`keeps the first ${SYMBOL_GROUP_CAP} and says so only when more were available`, () => {
    const many = Array.from({ length: SYMBOL_GROUP_CAP + 1 }, (_, i) => `T${i}`);
    const capped = buildSymbolList(many);
    expect(capped.capped).toBe(true);
    expect(capped.list.split(",")).toHaveLength(SYMBOL_GROUP_CAP);
    expect(capped.list.endsWith(`,T${SYMBOL_GROUP_CAP - 1}`)).toBe(true);
    expect(buildSymbolList(many.slice(0, SYMBOL_GROUP_CAP)).capped).toBe(false);
  });

  it("is empty for an empty or all-blank column", () => {
    expect(buildSymbolList([])).toEqual({ list: "", capped: false });
    expect(buildSymbolList([null, " "])).toEqual({ list: "", capped: false });
  });
});

describe("shouldWrite", () => {
  it("writes a changed list, never an unchanged or empty one", () => {
    expect(shouldWrite("AAPL", "AAPL,MSFT")).toBe(true);
    expect(shouldWrite(undefined, "AAPL")).toBe(true);
    expect(shouldWrite("AAPL,MSFT", "AAPL,MSFT")).toBe(false);
    expect(shouldWrite("AAPL", "")).toBe(false);
  });
});

describe("ticker columns (G5)", () => {
  const columns = [
    { id: "name", label: "Name", dtype: "text" as const },
    { id: "px", label: "Price", dtype: "number" as const },
    { id: "c3", label: " Ticker " },
  ];

  it("offers text and untyped columns and preselects one named symbol or ticker", () => {
    expect(tickerColumns(columns).map((c) => c.id)).toEqual(["name", "c3"]);
    expect(defaultTickerColumn(columns)).toBe("c3");
    expect(defaultTickerColumn([{ id: "SYMBOL", label: "x" }])).toBe("SYMBOL");
    expect(defaultTickerColumn([columns[0]])).toBeUndefined();
  });
});

describe("canFeedGroup", () => {
  const table = card({ id: "t", widgetId: "local_table", backendId: "builtin", title: "Prices" });
  const bound = card({ id: "b", widgetId: "local_table", backendId: "builtin", bindings: [{ groupId: "g", paramName: "symbol" }] });
  const chart = card({
    id: "c", widgetId: "linked_chart", backendId: "builtin",
    linkedSource: { kind: "widget", sourceWidgetId: "t" },
    linkedChart: { type: "column", measures: [], display: "grouped" },
  });
  const dashboard: Dashboard = { id: "d", name: "D", tabs: [{ id: "x", name: "First", cards: [table, bound, chart] }] };

  it("takes a worker table, not a chart, a missing card, or a table bound to the group it would feed", () => {
    expect(canFeedGroup(dashboard, "g", "t")).toBe(true);
    expect(canFeedGroup(dashboard, undefined, "b")).toBe(true);
    expect(canFeedGroup(dashboard, "g", "b")).toBe(false);
    expect(canFeedGroup(dashboard, "g", "c")).toBe(false);
    expect(canFeedGroup(dashboard, "g", "gone")).toBe(false);
  });

  it("names a table by title and tab, as the linked-widget picker does", () => {
    expect(tableLabel(dashboard, "t")).toBe("Prices — First");
    expect(tableLabel(dashboard, "gone")).toBeUndefined();
  });
});
