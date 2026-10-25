// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { parseUdfHistory, udfHistoryEndpoint, udfHistoryParams } from "./udf";

describe("udfHistoryEndpoint", () => {
  it("appends /history to the widget's UDF base, with or without a trailing slash", () => {
    expect(udfHistoryEndpoint("/udf")).toBe("/udf/history");
    expect(udfHistoryEndpoint("/udf/")).toBe("/udf/history");
    expect(udfHistoryEndpoint("udf//")).toBe("udf/history");
  });
});

describe("udfHistoryParams", () => {
  it("asks for daily bars over the year to now, in whole unix seconds", () => {
    const now = Date.UTC(2026, 9, 4, 12, 0, 0, 500);
    const to = Math.floor(now / 1000);
    expect(udfHistoryParams("AAPL", now)).toEqual({
      symbol: "AAPL",
      resolution: "D",
      from: String(to - 365 * 24 * 60 * 60),
      to: String(to),
    });
  });
});

describe("parseUdfHistory", () => {
  it("turns an ok payload into bars", () => {
    expect(
      parseUdfHistory({ s: "ok", t: [10, 20], o: [1, 2], h: [3, 4], l: [0.5, 1.5], c: [2, 3], v: [100, 200] }),
    ).toEqual([
      { time: 10, open: 1, high: 3, low: 0.5, close: 2, volume: 100 },
      { time: 20, open: 2, high: 4, low: 1.5, close: 3, volume: 200 },
    ]);
  });

  it("is empty for no_data", () => {
    expect(parseUdfHistory({ s: "no_data", nextTime: 5 })).toEqual([]);
  });

  it("throws the backend's errmsg for an error payload", () => {
    expect(() => parseUdfHistory({ s: "error", errmsg: "Symbol not found" })).toThrow("Symbol not found");
  });

  it("refuses anything that is not a UDF history payload", () => {
    for (const bad of [null, "text", [], {}, { s: "ok" }, { s: "weird" }, { s: "ok", t: 1, o: [], h: [], l: [], c: [] }]) {
      expect(() => parseUdfHistory(bad)).toThrow("not a UDF history payload");
    }
  });

  it("refuses arrays of unequal length", () => {
    expect(() =>
      parseUdfHistory({ s: "ok", t: [1, 2], o: [1], h: [1, 2], l: [1, 2], c: [1, 2] }),
    ).toThrow("not a UDF history payload");
  });

  it("drops rows with a non-numeric OHLC or time", () => {
    const bars = parseUdfHistory({
      s: "ok",
      t: [1, 2, "x", 4],
      o: [1, null, 1, 1],
      h: [2, 2, 2, 2],
      l: [0, 0, 0, Number.NaN],
      c: [1, 1, 1, 1],
      v: [5, 5, 5, 5],
    });
    expect(bars.map((b) => b.time)).toEqual([1]);
  });

  // lightweight-charts asserts ascending, unique times and throws from
  // setData otherwise -- which, with no error boundary, takes the window down.
  it("sorts by time and keeps the last bar for a repeated time", () => {
    const bars = parseUdfHistory({ s: "ok", t: [30, 10, 30], o: [1, 2, 3], h: [9, 9, 9], l: [0, 0, 0], c: [1, 1, 7] });
    expect(bars.map((b) => [b.time, b.close])).toEqual([[10, 1], [30, 7]]);
  });

  it("reads a missing or non-numeric volume as 0", () => {
    expect(parseUdfHistory({ s: "ok", t: [1], o: [1], h: [1], l: [1], c: [1] })[0].volume).toBe(0);
    expect(parseUdfHistory({ s: "ok", t: [1], o: [1], h: [1], l: [1], c: [1], v: ["?"] })[0].volume).toBe(0);
  });
});
