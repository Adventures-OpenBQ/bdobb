// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

import { render, screen } from "@testing-library/react";
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

  it("fills left-to-right from a floor, for a bounded scale like RSI", () => {
    render(<RangeBar value={70} min={0} max={100} guides={[30, 50, 70]} />);
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "70");
  });

  it("marks its guides so 30 and 70 are readable without counting pixels", () => {
    render(<RangeBar value={70} min={0} max={100} guides={[30, 50, 70]} />);
    expect(screen.getAllByTestId("range-guide")).toHaveLength(3);
  });

  it("draws a signed bar from the centre, not from the floor", () => {
    const { rerender } = render(<RangeBar value={-0.02} signed />);
    const negative = screen.getByRole("meter").getAttribute("data-origin");
    rerender(<RangeBar value={0.02} signed />);
    expect(screen.getByRole("meter").getAttribute("data-origin")).toBe(negative);
  });

  it("renders nothing for a null value, rather than an empty bar at zero", () => {
    const { container } = render(<RangeBar value={null} min={0} max={100} />);
    expect(container.querySelector('[role="meter"]')).toBeNull();
  });

  it("keeps aria-valuenow inside its own declared range even when the value overflows the scale", () => {
    // A crypto row 8% off its anchored VWAP -- routine on a watchlist -- well
    // past the default +/-5% signed scale. The bar pins visually at the edge;
    // it must announce the same pinned value, not a number outside its own
    // aria-valuemin/aria-valuemax.
    render(<RangeBar value={0.08} signed />);
    const meter = screen.getByRole("meter");
    const now = Number(meter.getAttribute("aria-valuenow"));
    const lo = Number(meter.getAttribute("aria-valuemin"));
    const hi = Number(meter.getAttribute("aria-valuemax"));
    expect(now).toBeGreaterThanOrEqual(lo);
    expect(now).toBeLessThanOrEqual(hi);
    // The true, unclamped value is still available via valuetext -- a
    // screen reader should hear the real deviation, not the pinned one.
    expect(meter.getAttribute("aria-valuetext")).toBe("0.08");
  });

  it("honours an explicit min in signed mode, not just the negation of max", () => {
    render(<RangeBar value={-8} signed min={-10} max={5} />);
    const meter = screen.getByRole("meter");
    expect(meter.getAttribute("aria-valuemin")).toBe("-10");
    expect(meter.getAttribute("aria-valuemax")).toBe("5");
  });
});

/**
 * The fraction out of a `calc(4px + (100% - 8px) * f)` offset, or the width
 * form `calc((100% - 8px) * f)`. Parsed rather than string-matched because
 * jsdom's CSS serialiser REORDERS the operands -- asserting the literal tests
 * jsdom's formatting, not the geometry. Same reason as markerFraction above.
 */
function trackFraction(css: string): number | null {
  const m = /([\d.]+)\s*\*\s*\(100% - 8px\)|\(100% - 8px\)\s*\*\s*([\d.]+)/.exec(css);
  return m ? Number(m[1] ?? m[2]) : null;
}

/** The fill's background colour, or "" when no meter was drawn. */
function fillColor(container: HTMLElement): string {
  return container.querySelector<HTMLElement>(".cell-meter-fill")?.style.background ?? "";
}

/** The red, green and blue channels of an `rgba(r,g,b,a)` fill. */
function rgb(container: HTMLElement): [number, number, number] {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(fillColor(container));
  if (m === null) throw new Error(`not an rgb fill: ${fillColor(container)}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

describe("RangeBar heat and sign colouring", () => {
  // The prototype's diverging RSI heat: deep green when oversold, deep red
  // when overbought, muted charcoal through the neutral band -- so a whole
  // column can be scanned for extremes without reading a single number.
  it("paints an overbought reading red", () => {
    const { container } = render(<RangeBar value={85} min={0} max={100} />);
    const [r, g, b] = rgb(container);
    expect(r).toBeGreaterThan(200);
    expect(r).toBeGreaterThan(g + 80);
    expect(r).toBeGreaterThan(b + 80);
  });

  it("paints an oversold reading green", () => {
    const { container } = render(<RangeBar value={15} min={0} max={100} />);
    const [r, g, b] = rgb(container);
    expect(g).toBeGreaterThan(170);
    expect(g).toBeGreaterThan(r + 80);
    expect(g).toBeGreaterThan(b + 40);
  });

  it("keeps the neutral band flat charcoal, not a colour ramp", () => {
    // 45 and 55 both sit inside the |t| < 0.4 deadzone. Without it the fill
    // would drift through colour on every tick of a symbol parked at 50,
    // which is exactly the noise the deadzone exists to kill.
    const a = render(<RangeBar value={45} min={0} max={100} />);
    const b = render(<RangeBar value={55} min={0} max={100} />);
    for (const c of [a, b]) {
      const [r, g, bl] = rgb(c.container);
      expect(Math.max(r, g, bl) - Math.min(r, g, bl)).toBeLessThan(40);
    }
  });

  it("shows the reading as a centred label", () => {
    render(<RangeBar value={61.4} min={0} max={100} />);
    // Rounded: the column is ~100px and a decimal buys nothing a trader reads
    // at a glance. The exact value stays on the meter's aria-valuetext.
    expect(screen.getByText("61")).toBeInTheDocument();
  });

  it("labels the reading even where the fill is short", () => {
    // A 4% fill is a sliver; the label must not live INSIDE the fill or it
    // would be clipped away exactly when the reading is most extreme.
    const { container } = render(<RangeBar value={4} min={0} max={100} />);
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(container.querySelector(".cell-meter-fill")?.textContent).toBe("");
  });

  it("colours a signed meter green above zero and red below", () => {
    const up = render(<RangeBar value={0.004} signed />);
    const down = render(<RangeBar value={-0.004} signed />);
    expect(fillColor(up.container)).toBe("rgb(38, 166, 154)");
    expect(fillColor(down.container)).toBe("rgb(239, 83, 80)");
  });

  it("carries no label on a signed meter", () => {
    // The deviation's magnitude is the bar; a number here would compete for a
    // cell that already sits between two range groups.
    const { container } = render(<RangeBar value={0.004} signed />);
    expect(container.querySelector(".cell-meter-box")).toBeNull();
  });

  it("saturates a signed meter at +/-100bp", () => {
    // The prototype's AVWAP_DEV_MAX. A half-track bar from the midline means
    // "at least 100bp off the anchor", the scale a trader reads it against.
    const { container } = render(<RangeBar value={0.01} signed />);
    const fill = container.querySelector<HTMLElement>(".cell-meter-fill");
    expect(trackFraction(fill?.style.width ?? "")).toBeCloseTo(0.5);
  });

  it("measures the fill against the inset track, not the cell", () => {
    // The track is inset 4px each side. A bare percentage puts a full bar's
    // ends outside the track it is meant to fill, which is what made the
    // column read as lopsided.
    const { container } = render(<RangeBar value={100} min={0} max={100} />);
    const fill = container.querySelector<HTMLElement>(".cell-meter-fill");
    expect(fill?.style.left).toContain("4px");
    expect(trackFraction(fill?.style.left ?? "")).toBeCloseTo(0);
    expect(trackFraction(fill?.style.width ?? "")).toBeCloseTo(1);
  });

  it("measures each guide against the inset track too", () => {
    const { container } = render(
      <RangeBar value={50} min={0} max={100} guides={[30, 50, 70]} />,
    );
    const lefts = [...container.querySelectorAll<HTMLElement>(".cell-meter-guide")]
      .map((g) => trackFraction(g.style.left));
    expect(lefts).toEqual([0.3, 0.5, 0.7]);
  });

  it("paints the guides after the fill so a buried tick still reads", () => {
    // An RSI of 32 covers its own 30 tick if the guides are drawn first --
    // and the 30/70 ticks are the whole point of the scale.
    const { container } = render(
      <RangeBar value={32} min={0} max={100} guides={[30, 50, 70]} />,
    );
    const kids = [...(container.querySelector(".cell-meter")?.children ?? [])]
      .map((el) => el.className);
    expect(kids.indexOf("cell-meter-fill")).toBeLessThan(kids.indexOf("cell-meter-guide"));
  });

  it("with bands, fills outward from the band it crossed: 15 from 30 down, 85 from 70 up", () => {
    const { container, rerender } = render(
      <RangeBar value={15} min={0} max={100} guides={[30, 50, 70]} bands={[30, 70]} />,
    );
    let fill = container.querySelector<HTMLElement>(".cell-meter-fill");
    expect(trackFraction(fill?.style.left ?? "")).toBeCloseTo(0.15);
    expect(trackFraction(fill?.style.width ?? "")).toBeCloseTo(0.15);
    rerender(<RangeBar value={85} min={0} max={100} guides={[30, 50, 70]} bands={[30, 70]} />);
    fill = container.querySelector<HTMLElement>(".cell-meter-fill");
    expect(trackFraction(fill?.style.left ?? "")).toBeCloseTo(0.7);
    expect(trackFraction(fill?.style.width ?? "")).toBeCloseTo(0.15);
  });

  it("with bands, draws no bar between them", () => {
    const { container } = render(<RangeBar value={50} min={0} max={100} bands={[30, 70]} />);
    const fill = container.querySelector<HTMLElement>(".cell-meter-fill");
    expect(trackFraction(fill?.style.width ?? "")).toBeCloseTo(0);
    // Still announced: no bar is not no reading.
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "50");
  });

  it("centres the reading in a neutral box over the 30-70 stretch, so colour only shows past a band", () => {
    const { container, rerender } = render(<RangeBar value={85.4} min={0} max={100} bands={[30, 70]} />);
    const box = () => container.querySelector<HTMLElement>(".cell-meter > .cell-meter-box");
    expect(box()?.textContent).toBe("85");
    expect(box()?.getAttribute("data-band")).toBe("range");
    expect(trackFraction(box()?.style.left ?? "")).toBeCloseTo(0.3);
    expect(trackFraction(box()?.style.width ?? "")).toBeCloseTo(0.4);
    // Painted last, so neither the fill nor a guide covers the number.
    const kids = [...(container.querySelector(".cell-meter")?.children ?? [])].map((el) => el.className);
    expect(kids.at(-1)).toBe("cell-meter-box");
    // The fill starts at the box's right edge: 70 up to 85.
    const fill = container.querySelector<HTMLElement>(".cell-meter-fill");
    expect(trackFraction(fill?.style.left ?? "")).toBeCloseTo(0.7);
    rerender(<RangeBar value={50} min={0} max={100} bands={[30, 70]} />);
    expect(box()?.textContent).toBe("50");
  });

  it("without bands, the reading spans the whole track as the old transparent label", () => {
    const { container } = render(<RangeBar value={42} min={0} max={100} />);
    const box = container.querySelector<HTMLElement>(".cell-meter-box");
    expect(box?.getAttribute("data-band")).toBe("none");
    expect(trackFraction(box?.style.left ?? "")).toBeCloseTo(0);
    expect(trackFraction(box?.style.width ?? "")).toBeCloseTo(1);
  });
});
