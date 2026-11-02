// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  cellVisual,
  colorRules,
  greenRedClass,
  titleCase,
  type ColorRule,
} from "./columnRender";

describe("greenRedClass", () => {
  it("classes a positive number green and a negative one red", () => {
    expect(greenRedClass(1.5)).toBe("cell-pos");
    expect(greenRedClass(-1.5)).toBe("cell-neg");
  });

  it("gives zero neither class", () => {
    // The spec is explicit: "zero: neither".
    expect(greenRedClass(0)).toBeUndefined();
    expect(greenRedClass(-0)).toBeUndefined();
  });

  it("gives a non-number neither class, and never NaN-colours anything", () => {
    expect(greenRedClass("1.5")).toBeUndefined();
    expect(greenRedClass(null)).toBeUndefined();
    expect(greenRedClass(undefined)).toBeUndefined();
    expect(greenRedClass(Number.NaN)).toBeUndefined();
  });
});

describe("titleCase", () => {
  it("upper-cases the first letter of each whitespace-delimited word", () => {
    expect(titleCase("some long name")).toBe("Some Long Name");
    expect(titleCase("SHOUTING at me")).toBe("Shouting At Me");
  });

  it("leaves an underscore inside a word alone — it is not a word break", () => {
    expect(titleCase("some_value")).toBe("Some_value");
  });

  it("passes an empty string and an em dash through", () => {
    expect(titleCase("")).toBe("");
    expect(titleCase("—")).toBe("—");
  });
});

describe("colorRules", () => {
  it("returns nothing when there are no renderFnParams or no colorRules", () => {
    expect(colorRules(undefined)).toEqual([]);
    expect(colorRules({})).toEqual([]);
    expect(colorRules({ colorRules: "nope" })).toEqual([]);
  });

  it("keeps a well-formed rule, condition and colour included", () => {
    expect(colorRules({ colorRules: [{ condition: "gt", value: 0, color: "green" }] })).toEqual([
      { condition: "gt", value: 0, color: "green" },
    ]);
  });

  it("keeps fill only when it is a boolean", () => {
    expect(
      colorRules({ colorRules: [{ condition: "eq", value: 1, color: "red", fill: true }] })[0].fill,
    ).toBe(true);
    expect(
      colorRules({ colorRules: [{ condition: "eq", value: 1, color: "red", fill: "yes" }] })[0],
    ).not.toHaveProperty("fill");
  });

  it("reads a between range from the reference's { min, max } object", () => {
    expect(
      colorRules({ colorRules: [{ condition: "between", range: { min: 1, max: 9 }, color: "c" }] })[0],
    ).toEqual({ condition: "between", color: "c", min: 1, max: 9 });
  });

  it("drops a rule whose condition compares against a value it never gives", () => {
    // A `gt` with no `value` has nothing to compare against. Keeping it would
    // mean deciding at match time what a missing bound means; dropping it is
    // the same call widgetsJson makes on any ill-typed property.
    expect(colorRules({ colorRules: [{ condition: "gt", color: "c" }] })).toEqual([]);
    expect(colorRules({ colorRules: [{ condition: "eq", color: "c" }] })).toEqual([]);
    expect(colorRules({ colorRules: [{ condition: "contains", color: "c" }] })).toEqual([]);
    expect(colorRules({ colorRules: [{ condition: "eq", value: undefined, color: "c" }] })).toEqual(
      [],
    );
    // `between` reads min/max, not value, so it survives without one.
    expect(
      colorRules({ colorRules: [{ condition: "between", range: { min: 1, max: 9 }, color: "c" }] }),
    ).toHaveLength(1);
  });

  it("drops a rule with an unknown condition, no colour, or the wrong shape", () => {
    expect(
      colorRules({
        colorRules: [
          { condition: "sideways", value: 1, color: "c" },
          { condition: "eq", value: 1 },
          { condition: "eq", value: 1, color: 7 },
          null,
          7,
          [],
        ],
      }),
    ).toEqual([]);
  });
});

describe("cellVisual colorRules matching", () => {
  const rule = (over: Record<string, unknown>) =>
    colorRules({ colorRules: [{ color: "c", ...over }] });

  /**
   * The colour cellVisual lands on, or undefined when no rule matched.
   * `renderFn: []` keeps greenRed out of it, so the answer is the rules'.
   */
  const colorOf = (value: unknown, rules: ColorRule[]) =>
    cellVisual({ renderFn: [], colorRules: rules }, value).color;

  it("matches each numeric comparison", () => {
    expect(colorOf(5, rule({ condition: "gt", value: 4 }))).toBe("c");
    expect(colorOf(4, rule({ condition: "gt", value: 4 }))).toBeUndefined();
    expect(colorOf(3, rule({ condition: "lt", value: 4 }))).toBe("c");
    expect(colorOf(4, rule({ condition: "gte", value: 4 }))).toBe("c");
    expect(colorOf(4, rule({ condition: "lte", value: 4 }))).toBe("c");
  });

  it("matches eq and ne strictly, with no coercion", () => {
    expect(colorOf("up", rule({ condition: "eq", value: "up" }))).toBe("c");
    // "1" is not 1: a manifest that quotes its number gets no match rather
    // than an invented one.
    expect(colorOf(1, rule({ condition: "eq", value: "1" }))).toBeUndefined();
    expect(colorOf(1, rule({ condition: "ne", value: "1" }))).toBe("c");
  });

  it("matches between inclusively, and not at all without a range", () => {
    const between = rule({ condition: "between", range: { min: 1, max: 9 } });
    expect(colorOf(1, between)).toBe("c");
    expect(colorOf(9, between)).toBe("c");
    expect(colorOf(10, between)).toBeUndefined();
    expect(colorOf(5, rule({ condition: "between" }))).toBeUndefined();
  });

  it("matches contains and notContains on the stringified value", () => {
    expect(colorOf("AAPL.US", rule({ condition: "contains", value: "US" }))).toBe("c");
    expect(colorOf("AAPL.US", rule({ condition: "notContains", value: "US" }))).toBeUndefined();
    expect(colorOf(120, rule({ condition: "contains", value: "2" }))).toBe("c");
  });

  it("matches nothing when the range is not the reference's object shape", () => {
    expect(colorOf(5, rule({ condition: "between", range: [1, 9] }))).toBeUndefined();
    expect(colorOf(10, rule({ condition: "between", range: [1, 9] }))).toBeUndefined();
  });

  it("matches contains and notContains against a NUMERIC rule value too", () => {
    // A manifest may write its needle unquoted. Requiring a string needle
    // would silently never match instead.
    expect(colorOf("120", rule({ condition: "contains", value: 2 }))).toBe("c");
    expect(colorOf(120, rule({ condition: "contains", value: 2 }))).toBe("c");
    expect(colorOf("134", rule({ condition: "contains", value: 2 }))).toBeUndefined();
    expect(colorOf("134", rule({ condition: "notContains", value: 2 }))).toBe("c");
  });

  it("takes the FIRST matching rule, not the last or the best", () => {
    const rules = colorRules({
      colorRules: [
        { condition: "gt", value: 0, color: "first" },
        { condition: "gt", value: 1, color: "second" },
      ],
    });
    expect(colorOf(5, rules)).toBe("first");
  });

  it("colours nothing for an empty rule list", () => {
    expect(cellVisual({ renderFn: [], colorRules: [] }, 5)).toEqual({});
  });
});

describe("cellVisual", () => {
  it("classes by sign for greenRed with no colorRules", () => {
    expect(cellVisual({ renderFn: ["greenRed"] }, 1.5)).toEqual({ className: "cell-pos" });
    expect(cellVisual({ renderFn: ["greenRed"] }, -1.5)).toEqual({ className: "cell-neg" });
    expect(cellVisual({ renderFn: ["greenRed"] }, 0)).toEqual({});
  });

  it("does nothing for a column with no renderFn at all", () => {
    expect(cellVisual({ renderFn: [] }, -1.5)).toEqual({});
  });

  it("lets a matching colorRule decide the colour, and drops the sign class", () => {
    // Both at once would put a cell-neg class and an inline colour on the same
    // cell, and the inline colour would silently win — so the rule takes over
    // outright rather than half-applying.
    const column = {
      renderFn: ["greenRed"],
      colorRules: colorRules({ colorRules: [{ condition: "lt", value: 0, color: "#f00" }] }),
    };
    expect(cellVisual(column, -1.5)).toEqual({ color: "#f00" });
    // No rule matched: no colour, and still no sign class, because colorRules
    // is what governs this column now.
    expect(cellVisual(column, 1.5)).toEqual({});
  });

  it("takes its rules already parsed, and never re-reads renderFnParams", () => {
    // tableColumns validates colorRules once per column; cellVisual runs per
    // cell and must not repeat that work. An unparsed renderFnParams reaching
    // it is therefore inert rather than quietly re-validated.
    const column = {
      renderFn: ["greenRed"],
      renderFnParams: { colorRules: [{ condition: "lt", value: 0, color: "#f00" }] },
    };
    expect(cellVisual(column, -1.5)).toEqual({ className: "cell-neg" });
  });

  it("puts the colour on the background when fill is set", () => {
    const column = {
      renderFn: [],
      colorRules: colorRules({
        colorRules: [{ condition: "eq", value: "bad", color: "#900", fill: true }],
      }),
    };
    expect(cellVisual(column, "bad")).toEqual({ color: "#900", fill: true });
  });

  it("ignores every renderFn the spec puts out of scope", () => {
    const column = {
      renderFn: ["hoverCard", "columnColor", "showCellChange", "sparkline", "cellOnClick"],
    };
    expect(cellVisual(column, -1.5)).toEqual({});
  });
});

describe("cellVisual with colorValueKey", () => {
  const rules: ColorRule[] = [{ condition: "eq", value: "Sarah Johnson", color: "blue", fill: true }];

  it("tests the rules against the named field of the same row, not the cell", () => {
    const column = { renderFn: ["columnColor"], colorRules: rules, colorValueKey: "Analyst" };
    expect(cellVisual(column, "AAPL", { Symbol: "AAPL", Analyst: "Sarah Johnson" })).toEqual({ color: "blue", fill: true });
    expect(cellVisual(column, "MSFT", { Symbol: "MSFT", Analyst: "Bob" })).toEqual({});
  });

  it("matches no rule when the row lacks the field, not even ne", () => {
    const column = {
      renderFn: ["columnColor"],
      colorRules: [{ condition: "ne", value: "x", color: "red" } as ColorRule],
      colorValueKey: "Analyst",
    };
    expect(cellVisual(column, "AAPL", { Symbol: "AAPL" })).toEqual({});
    expect(cellVisual(column, "AAPL")).toEqual({});
  });

  it("still tests the cell's own value when no colorValueKey is set", () => {
    expect(cellVisual({ renderFn: [], colorRules: rules }, "Sarah Johnson", { other: 1 })).toEqual({ color: "blue", fill: true });
  });
});
