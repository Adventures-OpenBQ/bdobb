// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { FIELD_COLUMN, NOTHING_TO_TRANSPOSE, transposeRows } from "./transpose";

describe("transposeRows", () => {
  it("makes the first column's values the headers and the other columns the rows", () => {
    const rows = [
      { date: "2026-01-02", open: 1, close: 2 },
      { date: "2026-01-03", open: 3, close: 4 },
    ];
    expect(transposeRows(rows)).toEqual({
      columns: [FIELD_COLUMN, "2026-01-02", "2026-01-03"],
      rows: [
        { [FIELD_COLUMN]: "open", "2026-01-02": 1, "2026-01-03": 3 },
        { [FIELD_COLUMN]: "close", "2026-01-02": 2, "2026-01-03": 4 },
      ],
    });
  });

  it("passes values through untouched: numbers stay numbers, null stays null", () => {
    const out = transposeRows([{ k: "a", v: 1.5 }, { k: "b", v: null }]);
    expect(out).toEqual({
      columns: [FIELD_COLUMN, "a", "b"],
      rows: [{ [FIELD_COLUMN]: "v", a: 1.5, b: null }],
    });
  });

  it("takes the column union in first-seen order, filling holes with undefined", () => {
    const out = transposeRows([{ k: "a", x: 1 }, { k: "b", y: 2 }]);
    expect(out).toEqual({
      columns: [FIELD_COLUMN, "a", "b"],
      rows: [
        { [FIELD_COLUMN]: "x", a: 1, b: undefined },
        { [FIELD_COLUMN]: "y", a: undefined, b: 2 },
      ],
    });
  });

  it("suffixes duplicate headers, counting from 2, and never clobbers Field", () => {
    const out = transposeRows([
      { k: "AAPL", v: 1 },
      { k: "AAPL", v: 2 },
      { k: "AAPL", v: 3 },
      { k: "Field", v: 4 },
    ]);
    expect(out).toEqual({
      columns: [FIELD_COLUMN, "AAPL", "AAPL (2)", "AAPL (3)", "Field (2)"],
      rows: [
        { [FIELD_COLUMN]: "v", AAPL: 1, "AAPL (2)": 2, "AAPL (3)": 3, "Field (2)": 4 },
      ],
    });
  });

  it("shows an empty first-column value as an em dash", () => {
    const out = transposeRows([{ k: "", v: 1 }, { k: null, v: 2 }, { v: 3 }]);
    expect(out).toEqual({
      columns: [FIELD_COLUMN, "—", "— (2)", "— (3)"],
      rows: [{ [FIELD_COLUMN]: "v", "—": 1, "— (2)": 2, "— (3)": 3 }],
    });
  });

  it("stringifies non-string headers", () => {
    expect(transposeRows([{ year: 2024, v: 1 }])).toEqual({
      columns: [FIELD_COLUMN, "2024"],
      rows: [{ [FIELD_COLUMN]: "v", "2024": 1 }],
    });
  });

  it("keeps Field first in columns even when a header is integer-like", () => {
    // JS enumerates integer-like object keys before string keys regardless
    // of insertion order, so a row's own Object.keys() would put "2024"
    // ahead of "Field". The explicit `columns` array must not do that.
    const out = transposeRows([{ year: 2024, v: 1 }]);
    expect(out?.columns).toEqual(["Field", "2024"]);
    expect(out?.columns[0]).toBe(FIELD_COLUMN);
  });

  it("does not mutate the input rows", () => {
    const rows = Object.freeze([
      Object.freeze({ date: "2026-01-02", open: 1, close: 2 }),
      Object.freeze({ date: "2026-01-03", open: 3, close: 4 }),
    ]) as unknown as Record<string, unknown>[];
    expect(() => transposeRows(rows)).not.toThrow();
    expect(transposeRows(rows)).toEqual({
      columns: [FIELD_COLUMN, "2026-01-02", "2026-01-03"],
      rows: [
        { [FIELD_COLUMN]: "open", "2026-01-02": 1, "2026-01-03": 3 },
        { [FIELD_COLUMN]: "close", "2026-01-02": 2, "2026-01-03": 4 },
      ],
    });
  });

  it("returns null when there is nothing to transpose", () => {
    expect(transposeRows([])).toBeNull();
    expect(transposeRows([{ only: 1 }, { only: 2 }])).toBeNull();
  });

  it("reads a column named after an Object.prototype member off the rows that own it only", () => {
    // A bare row[field] would answer Object.prototype.constructor for row B
    // and transpose a function into the grid.
    expect(transposeRows([{ sym: "A", constructor: 1 }, { sym: "B" }])).toEqual({
      columns: [FIELD_COLUMN, "A", "B"],
      rows: [{ [FIELD_COLUMN]: "constructor", A: 1, B: undefined }],
    });
  });

  it("reads a header column named after an Object.prototype member the same way", () => {
    expect(transposeRows([{ constructor: "A", v: 1 }, { v: 2 }])).toEqual({
      columns: [FIELD_COLUMN, "A", "—"],
      rows: [{ [FIELD_COLUMN]: "v", A: 1, "—": 2 }],
    });
  });
});

describe("NOTHING_TO_TRANSPOSE", () => {
  it("names both reasons transposeRows returns null", () => {
    expect(NOTHING_TO_TRANSPOSE).toBe(
      "Nothing to transpose: the table needs at least one row and two columns.",
    );
  });
});
