// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RangeBar } from "./RangeBar";

/**
 * The marker's position as the fraction it encodes, or null when no bar was
 * drawn at all.
 *
 * Parsed out of the `calc()` rather than compared as a string: jsdom's CSS
 * serialiser reorders the operands and trims trailing zeros, so asserting the
 * literal would be testing jsdom's formatting rather than the bar's position.
 */
function markerFraction(container: HTMLElement): number | null {
  const marker = container.querySelector<HTMLElement>(".cell-range-marker");
  if (marker === null) return null;
  const match = /calc\(4px \+ ([\d.]+) \* \(100% - 8px\)\)/.exec(marker.style.left);
  return match ? Number(match[1]) : null;
}

function trackBackground(container: HTMLElement): string {
  return container.querySelector<HTMLElement>(".cell-range-track")?.style.background ?? "";
}

describe("RangeBar", () => {
  it("draws nothing when an end is missing", () => {
    const { container } = render(<RangeBar low={null} high={42} value={40} />);
    expect(container.querySelector(".cell-range")).toBeNull();
  });

  it("draws nothing when an end is not a finite number", () => {
    // A vendor payload that sent "NA" or NaN must not produce a bar whose
    // marker is at NaN% -- which CSS silently drops, leaving a bar that looks
    // deliberate and is meaningless.
    const { container } = render(<RangeBar low={Number.NaN} high={42} value={40} />);
    expect(container.querySelector(".cell-range")).toBeNull();
  });

  it("draws nothing when the range has no width", () => {
    // low === high would divide by zero. A flat range is not a shorter bar.
    const { container } = render(<RangeBar low={40} high={40} value={40} />);
    expect(container.querySelector(".cell-range")).toBeNull();
  });

  it("draws nothing when the ends are inverted", () => {
    const { container } = render(<RangeBar low={50} high={40} value={45} />);
    expect(container.querySelector(".cell-range")).toBeNull();
  });

  it("puts the marker at the low end for a value at the low", () => {
    const { container } = render(<RangeBar low={35} high={40} value={35} />);
    expect(markerFraction(container)).toBe(0);
  });

  it("puts the marker at the high end for a value at the high", () => {
    const { container } = render(<RangeBar low={35} high={40} value={40} />);
    expect(markerFraction(container)).toBe(1);
  });

  it("puts the marker halfway for the midpoint", () => {
    // The design's own worked example: 35 ----|---- 40 for a value of 37.5.
    const { container } = render(<RangeBar low={35} high={40} value={37.5} />);
    expect(markerFraction(container)).toBe(0.5);
  });

  it("clamps a value that has printed outside the range", () => {
    // A price above a stale 52-week high belongs at the end of the bar, not
    // off it -- an unclamped fraction would put the marker outside the cell.
    const above = render(<RangeBar low={35} high={40} value={99} />);
    expect(markerFraction(above.container)).toBe(1);
    const below = render(<RangeBar low={35} high={40} value={1} />);
    expect(markerFraction(below.container)).toBe(0);
  });

  it("paints the 52-week palette by default", () => {
    const { container } = render(<RangeBar low={35} high={40} value={37.5} />);
    // Red at the low end, green at the high: the sell/buy reading.
    expect(trackBackground(container)).toContain("rgba(239,83,80,0.55) 0%");
    expect(trackBackground(container)).toContain("rgba(38,166,154,0.55) 100%");
  });

  it("paints a visibly different palette for the day range", () => {
    // The two bars sit side by side in one row; identical colours would read
    // as one repeated column.
    const week52 = render(<RangeBar low={35} high={40} value={37.5} palette="week52" />);
    const day = render(<RangeBar low={35} high={40} value={37.5} palette="day" />);
    expect(trackBackground(day.container)).toContain("rgba(66,133,244,0.55) 0%");
    expect(trackBackground(day.container)).not.toBe(trackBackground(week52.container));
  });

  it("renders one track and one marker, and no chart node", () => {
    // The bar is CSS, not a plot: nothing here should mount a canvas or an
    // svg, which is what makes sixty of them viable at 4Hz.
    const { container } = render(<RangeBar low={35} high={40} value={37.5} />);
    expect(container.querySelectorAll(".cell-range-track")).toHaveLength(1);
    expect(container.querySelectorAll(".cell-range-marker")).toHaveLength(1);
    expect(container.querySelector("canvas")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });
});
