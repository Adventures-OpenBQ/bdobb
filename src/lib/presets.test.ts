// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  BUILTIN_PRESETS,
  RELATIVE_OPTIONS,
  appliesTo,
  expressionFromRows,
  isRelativeType,
  parsePresets,
  presetsFor,
  rowsFromExpression,
} from "./presets";

describe("the anchor and unit table", () => {
  it("offers exactly the spec's anchors and units per type", () => {
    expect(RELATIVE_OPTIONS.date).toEqual({
      anchors: ["T", "trade_date", "prev_trade_date", "W0", "M0", "Q0", "Y0", "FQ0", "FY0"],
      units: ["d", "bd", "w", "m", "q", "y", "fq", "fy"],
    });
    expect(RELATIVE_OPTIONS.date_range).toEqual(RELATIVE_OPTIONS.date);
    expect(RELATIVE_OPTIONS.datetime).toEqual({
      // `$today` extends the spec's table on purpose: it is the one anchor
      // that means the START of the day, and a datetime is the only type
      // where that differs from `T` at all -- on a date the projection makes
      // them identical, so it is deliberately NOT offered there.
      anchors: ["now", "T", "$today", "session_open", "session_close", "trade_date", "prev_trade_date"],
      units: ["s", "min", "h", "d", "bd", "w", "m"],
    });
    expect(RELATIVE_OPTIONS.week).toEqual({ anchors: ["T", "W0", "trade_date"], units: ["w", "d", "bd", "m", "q", "y"] });
    expect(RELATIVE_OPTIONS.quarter).toEqual({ anchors: ["T", "Q0", "FQ0"], units: ["q", "fq", "y", "fy"] });
    expect(RELATIVE_OPTIONS.fiscal_year).toEqual({ anchors: ["T", "FY0"], units: ["fy", "y"] });
    expect(isRelativeType("time")).toBe(false);
    expect(isRelativeType("date")).toBe(true);
    expect(isRelativeType(undefined)).toBe(false);
    // An own key of RELATIVE_OPTIONS, not anything `in` it: no prototype name.
    expect(isRelativeType("toString")).toBe(false);
  });
});

describe("rows", () => {
  it("loads an expression into rows, expanding a shorthand into its anchor and own-unit offset", () => {
    expect(rowsFromExpression("date", "T-5bd")).toEqual({ start: { anchor: "T", offsets: [{ sign: -1, amount: 5, unit: "bd" }] } });
    expect(rowsFromExpression("quarter", "Q-4")).toEqual({ start: { anchor: "Q0", offsets: [{ sign: -1, amount: 4, unit: "q" }] } });
    expect(rowsFromExpression("quarter", "FQ+1-1fq")).toEqual({
      start: { anchor: "FQ0", offsets: [{ sign: 1, amount: 1, unit: "fq" }, { sign: -1, amount: 1, unit: "fq" }] },
    });
    expect(rowsFromExpression("date_range", "M0/T")).toEqual({ start: { anchor: "M0", offsets: [] }, end: { anchor: "T", offsets: [] } });
    expect(rowsFromExpression("date", "$currentDate-7")).toEqual({ start: { anchor: "T", offsets: [{ sign: -1, amount: 7, unit: "d" }] } });
  });

  it("refuses what the type's rows cannot express, and a literal", () => {
    expect(rowsFromExpression("date", "now")).toBeNull();
    expect(rowsFromExpression("date", "T-1h")).toBeNull();
    expect(rowsFromExpression("week", "Q0")).toBeNull();
    expect(rowsFromExpression("quarter", "Q0-4")).toBeNull();
    expect(rowsFromExpression("date", "T-7d/T")).toBeNull();
    expect(rowsFromExpression("date_range", "T")).toBeNull();
    expect(rowsFromExpression("date", "2026-09-14")).toBeNull();
    expect(rowsFromExpression("fiscal_year", "FQ0")).toBeNull();
  });

  it("writes rows back canonically, folding a single own-unit offset on a period anchor into the shorthand", () => {
    expect(expressionFromRows({ start: { anchor: "Q0", offsets: [{ sign: -1, amount: 4, unit: "q" }] } })).toBe("Q-4");
    expect(expressionFromRows({ start: { anchor: "Q0", offsets: [{ sign: -1, amount: 4, unit: "d" }] } })).toBe("Q0-4d");
    expect(expressionFromRows({ start: { anchor: "Q0", offsets: [{ sign: -1, amount: 4, unit: "q" }, { sign: 1, amount: 1, unit: "d" }] } })).toBe("Q0-4q+1d");
    expect(expressionFromRows({ start: { anchor: "T", offsets: [] } })).toBe("$currentDate");
    expect(expressionFromRows({ start: { anchor: "trade_date", offsets: [{ sign: -1, amount: 5, unit: "bd" }] }, end: { anchor: "trade_date", offsets: [] } })).toBe("trade_date-5bd/trade_date");
    expect(expressionFromRows({ start: { anchor: "FY0", offsets: [{ sign: -1, amount: 1, unit: "fy" }] } })).toBe("FY-1");
  });
});

describe("the built-in catalog", () => {
  it("is the spec's table, and every entry is expressible in the rows of each type it declares", () => {
    const byName = Object.fromEntries(BUILTIN_PRESETS.map((p) => [`${p.group}/${p.name}`, p]));
    expect(byName["Dates/Today"]).toMatchObject({ expr: "T", types: ["date"] });
    expect(byName["Dates/Last 7 days"]).toMatchObject({ expr: "T-7d/T", types: ["date_range"] });
    expect(byName["Dates/YTD"]).toMatchObject({ expr: "Y0/T", types: ["date_range"] });
    expect(byName["Trading/Last 5 trading days"]).toMatchObject({ expr: "trade_date-5bd/trade_date", types: ["date_range"] });
    expect(byName["Intraday/Prior close"]).toMatchObject({ expr: "session_close-1bd", types: ["datetime"] });
    expect(byName["Weeks/Last week"]).toMatchObject({ expr: "W-1", types: ["week"] });
    expect(byName["Calendar quarters/Same quarter last year"]).toMatchObject({ expr: "Q-4", types: ["quarter"] });
    expect(byName["Fiscal quarters/Fiscal YoY"]).toMatchObject({ expr: "FQ-4", types: ["quarter"] });
    expect(byName["Fiscal years/Prior"]).toMatchObject({ expr: "FY-1", types: ["fiscal_year"] });
    expect(BUILTIN_PRESETS).toHaveLength(30);
    for (const p of BUILTIN_PRESETS) {
      for (const type of p.types) expect(appliesTo(type, p.expr), `${p.name} on ${type}`).toBe(true);
    }
  });

  // Controller ruling (task-8-brief.md): the brief's saved example "Two
  // weeks" (T-2w) is ALSO datetime-expressible (T and w are both in
  // RELATIVE_OPTIONS.datetime), which would break the "date only" claim this
  // test makes about it. "Two quarters" (T-2q) is valid on date (q is a date
  // unit) but not on datetime (q is not a datetime unit), so it proves the
  // same filtering without the contradiction.
  it("offers a type its built-ins plus the saved presets its rows can express", () => {
    const saved = [{ name: "Two quarters", expr: "T-2q" }, { name: "Hour", expr: "now-1h" }, { name: "Junk", expr: "AAPL" }];
    const date = presetsFor("date", saved);
    expect(date.filter((p) => p.saved).map((p) => p.name)).toEqual(["Two quarters"]);
    expect(date.filter((p) => !p.saved).map((p) => p.name)).toEqual(["Today", "Yesterday", "Last trading day", "Prior session"]);
    expect(date.find((p) => p.saved)?.group).toBe("Saved");
    expect(presetsFor("datetime", saved).filter((p) => p.saved).map((p) => p.name)).toEqual(["Hour"]);
    expect(presetsFor("fiscal_year", undefined).map((p) => p.name)).toEqual(["Current", "Prior"]);
  });
});

describe("quarter_range (v5.4.0)", () => {
  it("offers the quarter anchors and units, and reads a range only", () => {
    expect(isRelativeType("quarter_range")).toBe(true);
    expect(RELATIVE_OPTIONS.quarter_range).toEqual({ anchors: ["T", "Q0", "FQ0", "Y0", "FY0"], units: ["q", "fq", "y", "fy"] });
    expect(rowsFromExpression("quarter_range", "FQ-4")).toBeNull();
    expect(rowsFromExpression("quarter_range", "T-5bd/T")).toBeNull();
    expect(rowsFromExpression("quarter_range", "FQ-4/FQ0")).toEqual({
      start: { anchor: "FQ0", offsets: [{ sign: -1, amount: 4, unit: "fq" }] },
      end: { anchor: "FQ0", offsets: [] },
    });
  });

  it("carries the four presets in the spec's order, each round-tripping through the rows", () => {
    const offered = presetsFor("quarter_range", undefined).map((p) => [p.group, p.name, p.expr]);
    expect(offered).toEqual([
      ["Quarter ranges", "Last 4 quarters", "Q-4/Q-1"],
      ["Quarter ranges", "Last 4 fiscal quarters", "FQ-4/FQ0"],
      ["Quarter ranges", "Fiscal year to date", "FY0/FQ0"],
      ["Quarter ranges", "Year ago to now", "Q-4/Q0"],
    ]);
    for (const [, , expr] of offered) {
      expect(expressionFromRows(rowsFromExpression("quarter_range", expr)!)).toBe(expr);
    }
  });
});

describe("parsePresets", () => {
  it("keeps well-formed entries and drops the rest", () => {
    expect(parsePresets([{ name: "A", expr: "T" }, { name: "", expr: "T" }, { name: "B" }, { name: 3, expr: "T" }, null, "x"])).toEqual([{ name: "A", expr: "T" }]);
    expect(parsePresets(undefined)).toBeUndefined();
    expect(parsePresets({ name: "A", expr: "T" })).toBeUndefined();
  });
});

// A weekday expression has no "amount / unit" row to render -- the unit is a
// weekday name, not a duration -- so the Relative tab declines it and the
// popover opens on Absolute instead of drawing a select with no valid option.
describe("weekday expressions in the Relative tab", () => {
  it("are not expressible as rows, on any type", () => {
    for (const type of ["date", "datetime", "date_range"] as const) {
      expect(rowsFromExpression(type, "T-2MON"), type).toBeNull();
      expect(rowsFromExpression(type, "T+FRI"), type).toBeNull();
      // Weekdays fold case since the 5.3.4 back-port: still no row.
      expect(rowsFromExpression(type, "T-Mon"), type).toBeNull();
    }
    // The ordinary forms still are, so this is a weekday rule and not a
    // blanket refusal.
    expect(rowsFromExpression("date", "T-2d")).not.toBeNull();
  });
});

it("refuses rows for an atom with @ or (MIC), so Apply cannot strip it", () => {
  expect(rowsFromExpression("datetime", "T@14:00")).toBeNull();
  expect(rowsFromExpression("date", "T-1bd(XLON)")).toBeNull();
  expect(rowsFromExpression("date_range", "T-5bd(XLON)/T")).toBeNull();
});
