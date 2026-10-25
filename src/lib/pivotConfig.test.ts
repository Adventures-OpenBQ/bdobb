// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  EMPTY_PIVOT,
  activeLists,
  aggregationOf,
  bucketOf,
  clearedPivot,
  dataFieldsOf,
  isOpen,
  isPivoting,
  legalAggregations,
  moveField,
  setAggregation,
  setBucket,
  toggleExpanded,
} from "./pivotConfig";
import type { PivotConfig } from "./types";

const ORDER = ["sector", "symbol", "year", "revenue", "volume"];
const KNOWN = new Set(ORDER);
const cfg = (over: Partial<PivotConfig> = {}): PivotConfig => ({ ...EMPTY_PIVOT, ...over });

it("quarantines legacy folds before the first typed fold is created", () => {
  const old = '["string","A"]';
  const result = toggleExpanded(cfg({ grouping: ["g"], expanded: { [old]: false } }), '["string","B"]');
  expect(result.pivot.keyEncoding).toBe("typed-v1");
  expect(result.pivot.legacyExpanded).toEqual({ [old]: false });
  expect(result.pivot.expanded).toEqual({ '["string","B"]': false });
});

describe("moveField", () => {
  it("moves a data column into Row Groups, and switches the pivot on", () => {
    const { pivot, columnOrder } = moveField(cfg(), ORDER, "sector", "grouping", 0);
    expect(pivot.grouping).toEqual(["sector"]);
    expect(pivot.enabled).toBe(true);
    // A grouped field never leaves columnOrder.
    expect(columnOrder).toBeUndefined();
  });

  it("moves, never copies: a field leaves the list it was in", () => {
    const { pivot } = moveField(cfg({ grouping: ["sector", "symbol"] }), ORDER, "symbol", "split", 0);
    expect(pivot.grouping).toEqual(["sector"]);
    expect(pivot.split).toEqual(["symbol"]);
  });

  it("reorders within a list; index is the position AFTER the field is removed", () => {
    const start = cfg({ grouping: ["sector", "symbol", "year"] });
    expect(moveField(start, ORDER, "sector", "grouping", 2).pivot.grouping).toEqual(["symbol", "year", "sector"]);
    expect(moveField(start, ORDER, "year", "grouping", 0).pivot.grouping).toEqual(["year", "sector", "symbol"]);
    expect(moveField(start, ORDER, "sector", "grouping", 99).pivot.grouping).toEqual(["symbol", "year", "sector"]);
  });

  it("drops a field back into Data Columns at a position, by rewriting columnOrder", () => {
    const start = cfg({ grouping: ["sector"] });
    // Data Columns without `sector`: symbol, year, revenue, volume. Index 2 = before revenue.
    const { pivot, columnOrder } = moveField(start, ORDER, "sector", "data", 2);
    expect(pivot.grouping).toEqual([]);
    expect(columnOrder).toEqual(["symbol", "year", "sector", "revenue", "volume"]);
  });

  it("appends to Data Columns when dropped past the end", () => {
    const { columnOrder } = moveField(cfg({ split: ["year"] }), ORDER, "year", "data", 99);
    expect(columnOrder).toEqual(["sector", "symbol", "revenue", "volume", "year"]);
  });

  it("reorders inside Data Columns around the grouped fields, which keep their slots", () => {
    const start = cfg({ grouping: ["symbol"] });
    // Data list: sector, year, revenue, volume. Move volume to index 0.
    const { columnOrder } = moveField(start, ORDER, "volume", "data", 0);
    expect(columnOrder).toEqual(["volume", "sector", "symbol", "year", "revenue"]);
  });

  it("keeps a field's aggregation and bucket while it is grouped", () => {
    const start = cfg({ aggregationFns: { revenue: "sum" }, buckets: { year: "quarter" } });
    const { pivot } = moveField(start, ORDER, "revenue", "grouping", 0);
    expect(pivot.aggregationFns).toEqual({ revenue: "sum" });
    expect(pivot.buckets).toEqual({ year: "quarter" });
  });

  it("appends past the end of Data Columns before a trailing grouped field, not after it", () => {
    // `volume` stays grouped throughout and keeps its trailing slot in
    // columnOrder; dropping `sector` past the end of Data Columns must land
    // it just after the last REAL data field (`revenue`), not at the very
    // end of columnOrder past `volume`.
    const start = cfg({ grouping: ["volume"], split: ["sector"] });
    const expected = ["symbol", "year", "revenue", "sector", "volume"];
    expect(moveField(start, ORDER, "sector", "data", 99).columnOrder).toEqual(expected);
    // Data Columns here is exactly 3 fields (symbol, year, revenue); index 3
    // is the exact past-the-end boundary and must resolve the same way.
    expect(moveField(start, ORDER, "sector", "data", 3).columnOrder).toEqual(expected);
  });
});

describe("the rest", () => {
  it("ignores fields the data no longer has, and keeps them in the config", () => {
    const config = cfg({ enabled: true, grouping: ["gone", "sector"], split: ["sector", "year"] });
    // `sector` is in both lists: the first placement wins.
    expect(activeLists(config, KNOWN)).toEqual({ grouping: ["sector"], split: ["year"] });
    expect(config.grouping).toEqual(["gone", "sector"]);
  });

  it("is pivoting only when enabled with a known field in a list", () => {
    expect(isPivoting(undefined, KNOWN)).toBe(false);
    expect(isPivoting(cfg({ enabled: true }), KNOWN)).toBe(false);
    expect(isPivoting(cfg({ enabled: true, grouping: ["gone"] }), KNOWN)).toBe(false);
    expect(isPivoting(cfg({ enabled: false, grouping: ["sector"] }), KNOWN)).toBe(false);
    expect(isPivoting(cfg({ enabled: true, split: ["year"] }), KNOWN)).toBe(true);
  });

  it("lists the data fields in column order, minus the grouped", () => {
    expect(dataFieldsOf(ORDER, cfg({ grouping: ["sector"], split: ["year"] }))).toEqual(["symbol", "revenue", "volume"]);
  });

  it("sets and clears an aggregation", () => {
    const set = setAggregation(cfg(), "revenue", "sum").pivot;
    expect(set.aggregationFns).toEqual({ revenue: "sum" });
    expect(setAggregation(set, "revenue", null).pivot.aggregationFns).toBeUndefined();
  });

  it("sets a bucket, and stores native as absence", () => {
    const set = setBucket(cfg(), "year", "quarter").pivot;
    expect(set.buckets).toEqual({ year: "quarter" });
    expect(setBucket(set, "year", "native").pivot.buckets).toBeUndefined();
  });

  it("folds and unfolds; an absent path is open", () => {
    const base = cfg({ grouping: ["sector"] });
    expect(isOpen(base, "Energy")).toBe(true);
    const folded = toggleExpanded(base, "Energy").pivot;
    expect(folded.expanded).toEqual({ Energy: false });
    expect(isOpen(folded, "Energy")).toBe(false);
    expect(isOpen(folded, "Technology")).toBe(true);
    expect(toggleExpanded(folded, "Energy").pivot.expanded).toBeUndefined();
    expect(isOpen(cfg({ expanded: true }), "Energy")).toBe(true);
  });

  it("stores payload-named keys as own properties", () => {
    const { pivot } = setAggregation(cfg(), "__proto__", "sum");
    expect(Object.hasOwn(pivot.aggregationFns ?? {}, "__proto__")).toBe(true);
  });

  it("clears to an explicit, disabled, empty config — so a widget preset does not come back", () => {
    expect(clearedPivot()).toEqual({ pivot: { enabled: false, grouping: [], split: [] } });
  });
});

// C3: the engine and the panel would each restate these two lookups verbatim,
// so they are read once, here, and imported everywhere a field's aggregation
// or bucket is needed.
describe("aggregationOf / bucketOf", () => {
  it("reads a field's aggregation, or undefined when it has none", () => {
    const config = cfg({ aggregationFns: { revenue: "sum" } });
    expect(aggregationOf(config, "revenue")).toBe("sum");
    expect(aggregationOf(config, "volume")).toBeUndefined();
    expect(aggregationOf(cfg(), "revenue")).toBeUndefined();
  });

  it("reads a field's bucket, defaulting to native", () => {
    const config = cfg({ buckets: { year: "quarter" } });
    expect(bucketOf(config, "year")).toBe("quarter");
    expect(bucketOf(config, "month")).toBe("native");
    expect(bucketOf(cfg(), "year")).toBe("native");
  });

  it("a field named __proto__ is read as an own property, never inherited", () => {
    expect(aggregationOf(cfg({ aggregationFns: {} }), "__proto__")).toBeUndefined();
    expect(bucketOf(cfg({ buckets: {} }), "__proto__")).toBe("native");
  });
});

describe("legalAggregations", () => {
  it("offers arithmetic to numbers only, and first/last only with a date column", () => {
    expect(legalAggregations("number", true)).toEqual(["sum", "mean", "median", "min", "max", "first", "last", "count", "uniqueCount"]);
    expect(legalAggregations("text", true)).toEqual(["min", "max", "first", "last", "count", "uniqueCount"]);
    expect(legalAggregations("date", false)).toEqual(["min", "max", "count", "uniqueCount"]);
    expect(legalAggregations("none", false)).toEqual(["count", "uniqueCount"]);
  });
});
