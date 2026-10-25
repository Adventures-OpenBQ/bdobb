// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { parseSparkline, sparklineGeometry, sparklineValues } from "./sparkline";

describe("parseSparkline", () => {
  it("defaults an absent type to line and tooltip to true", () => {
    expect(parseSparkline({})).toEqual({ type: "line", tooltip: true });
  });

  it("keeps an explicit bar or area type", () => {
    expect(parseSparkline({ type: "bar" })?.type).toBe("bar");
    expect(parseSparkline({ type: "area" })?.type).toBe("area");
  });

  it("returns undefined for a present but unknown type", () => {
    expect(parseSparkline({ type: "pie" })).toBeUndefined();
  });

  it("returns undefined for a non-object", () => {
    expect(parseSparkline(null)).toBeUndefined();
    expect(parseSparkline("line")).toBeUndefined();
  });

  it("flattens colors, strokeWidth, markers and pointsOfInterest out of options", () => {
    const c = parseSparkline({
      type: "line",
      options: {
        stroke: "#22c55e",
        fill: "rgba(0,0,0,0.1)",
        strokeWidth: 2,
        markers: { enabled: true, size: 2, fill: "#22c55e" },
        pointsOfInterest: {
          maximum: { fill: "#ffd700", stroke: "#ffb000", strokeWidth: 2, size: 6 },
          minimum: { fill: "#ef4444" },
        },
      },
    });
    expect(c?.stroke).toBe("#22c55e");
    expect(c?.fill).toBe("rgba(0,0,0,0.1)");
    expect(c?.strokeWidth).toBe(2);
    expect(c?.markers).toEqual({ enabled: true, size: 2, fill: "#22c55e" });
    expect(c?.poi?.maximum).toEqual({ fill: "#ffd700", stroke: "#ffb000", strokeWidth: 2, size: 6 });
    expect(c?.poi?.minimum).toEqual({ fill: "#ef4444" });
  });

  it("honors tooltip.enabled=false and drops padding unless all four sides are numbers", () => {
    expect(parseSparkline({ options: { tooltip: { enabled: false } } })?.tooltip).toBe(false);
    expect(parseSparkline({ options: { padding: { top: 5, right: 5, bottom: 5 } } })?.padding).toBeUndefined();
    expect(parseSparkline({ options: { padding: { top: 1, right: 2, bottom: 3, left: 4 } } })?.padding).toEqual({
      top: 1, right: 2, bottom: 3, left: 4,
    });
  });
});

const LINE = parseSparkline({ type: "line" });

describe("sparklineGeometry", () => {
  it("returns empty geometry for an empty array", () => {
    const g = sparklineGeometry([], LINE!, 96, 24);
    expect(g.points).toEqual([]);
    expect(g.linePath).toBe("");
    expect(g.minIdx).toBe(-1);
    expect(g.maxIdx).toBe(-1);
  });

  it("emits one point per value with strictly increasing x", () => {
    const g = sparklineGeometry([1, 2, 3, 4], LINE!, 96, 24);
    expect(g.points).toHaveLength(4);
    for (let i = 1; i < g.points.length; i++) expect(g.points[i].x).toBeGreaterThan(g.points[i - 1].x);
    expect(g.bars).toHaveLength(4);
  });

  it("puts higher values at a smaller y and marks first-occurrence min/max", () => {
    const g = sparklineGeometry([5, 1, 5, 3], LINE!, 96, 24);
    expect(g.maxIdx).toBe(0); // first 5
    expect(g.minIdx).toBe(1);
    expect(g.points[0].y).toBeLessThan(g.points[1].y); // 5 higher on screen than 1
  });

  it("draws a flat full-width line for a single value (never a blank cell)", () => {
    const g = sparklineGeometry([7], LINE!, 96, 24);
    expect(g.linePath).toMatch(/^M/);
    expect(g.areaPath).toMatch(/Z$/);
    // flat: the two endpoints share a y
    const ys = [...g.linePath.matchAll(/[ML][\d.]+,([\d.]+)/g)].map((m) => Number(m[1]));
    expect(ys).toHaveLength(2);
    expect(ys[0]).toBeCloseTo(ys[1]);
  });

  it("does not divide by zero on a single value or a flat series", () => {
    for (const g of [sparklineGeometry([7], LINE!, 96, 24), sparklineGeometry([3, 3, 3], LINE!, 96, 24)]) {
      for (const p of g.points) expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it("applies padding as insets", () => {
    const g = sparklineGeometry([1, 2], { type: "line", tooltip: true, padding: { top: 4, right: 6, bottom: 4, left: 6 } }, 96, 24);
    expect(g.points[0].x).toBeCloseTo(6); // left inset
    expect(g.points[1].x).toBeCloseTo(90); // width - right inset
  });

  // A bar measures from zero: the minimum keeps its height, and a negative
  // value hangs below the zero line instead of looking positive.
  const BAR = parseSparkline({ type: "bar" })!;

  it("draws bars from zero so the minimum value keeps its height", () => {
    const g = sparklineGeometry([1, 2, 4], BAR, 96, 24);
    const base = g.bars[2].y + g.bars[2].h; // zero line = bottom of the tallest bar
    expect(g.bars[0].h).toBeGreaterThan(0);
    expect(g.bars[0].y + g.bars[0].h).toBeCloseTo(base);
    expect(g.bars[0].h * 4).toBeCloseTo(g.bars[2].h); // 1 is a quarter of 4
  });

  it("hangs a negative bar below the zero line", () => {
    const g = sparklineGeometry([2.1, -1.5], BAR, 96, 24);
    const [pos, neg] = g.bars;
    expect(pos.y + pos.h).toBeCloseTo(neg.y); // both meet at zero: pos above, neg below
    expect(pos.h / neg.h).toBeCloseTo(2.1 / 1.5);
  });
});

describe("sparklineValues", () => {
  const line = parseSparkline({ type: "line" })!;

  it("keeps the finite numbers of a number array", () => {
    expect(sparklineValues([1, "x", 2, Number.NaN, 3], line)).toEqual([1, 2, 3]);
  });

  // The reference backend's bar sparklines send {x, y} points and name the
  // keys with options.xKey/yKey; those cells rendered as raw JSON.
  it("reads options.yKey from object points", () => {
    const bar = parseSparkline({ type: "bar", options: { xKey: "m", yKey: "ret" } })!;
    expect(sparklineValues([{ m: "Jan", ret: 2.1 }, { m: "Feb", ret: -1.5 }], bar)).toEqual([2.1, -1.5]);
  });

  it("reads y from object points when no yKey is given", () => {
    expect(sparklineValues([{ x: "Jan", y: 2 }, { x: "Feb", y: 4 }], line)).toEqual([2, 4]);
  });
});
