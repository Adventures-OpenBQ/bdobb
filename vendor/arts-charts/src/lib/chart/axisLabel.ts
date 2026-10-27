// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import { contrastInk } from "./createChartTheme";

/**
 * One series' value on its panel's price axis, in the series' own colour,
 * FOLLOWING THE CROSSHAIR (owner, 2026-09-27).
 *
 * The library's own per-series label (`lastValueVisible`) is coloured
 * correctly but reads `lastValueData(false)`, which is the last VISIBLE bar --
 * it does not track the pointer. Its single crosshair label does track, but a
 * chart has exactly one of those and it takes one colour, which since v12.4.0
 * (one chart per panel) means one grey label per panel.
 *
 * `priceAxisViews()` is the way out: a series primitive contributes its OWN
 * axis labels, each with its own `text`, `backColor` and `textColor`. This is
 * one label per series, so a banded study puts up one per drawn output.
 *
 * It REPLACES the library's label rather than joining it -- the caller turns
 * `lastValueVisible` off for any series carrying one. Two labels per series
 * while hovering (a resting one and a crosshair one) would be six on a card
 * with a band and a MACD, which is more than the axis can hold.
 *
 * At rest it shows the series' last point, which is what the library's label
 * showed; under the crosshair it shows the value there.
 */

/** The little of a series this needs; structural, so a test needs no library. */
export type LabelSeries = {
  priceToCoordinate: (price: number) => number | null;
  priceFormatter: () => { format: (price: number) => string };
  data: () => readonly { time?: unknown; value?: number; close?: number }[];
};

/** A point's price, whichever of the two datum shapes a series holds. */
function priceOf(point: { value?: number; close?: number } | undefined): number | null {
  if (point === undefined) return null;
  if (typeof point.value === "number") return point.value;
  return typeof point.close === "number" ? point.close : null;
}

/**
 * A coordinate far off the top of any axis, for a label that must not draw.
 *
 * `visible()` is what actually hides it; this is belt-and-braces for the
 * library's own placement pass, which reads `coordinate()` whether or not the
 * view is visible and would otherwise reserve a slot at y=0 for a label that
 * is not there.
 */
const OFFSCREEN = -1000;

export function createAxisLabel(color: string) {
  let series: LabelSeries | null = null;
  // The crosshair's TIME, not a value: the label looks its own point up, so
  // the renderer's per-move handler stays one loop of setters and every
  // series answers for itself. The scan is the linear one the legend already
  // makes over the same arrays.
  // ponytail: binary search if a card ever holds enough points to show.
  let at: unknown = null;
  let text = "";
  let coordinate = OFFSCREEN;
  let visible = false;

  const recompute = (): void => {
    visible = false;
    text = "";
    coordinate = OFFSCREEN;
    if (series === null) return;
    // Under the crosshair, this series' point AT that time; at rest, its last
    // point -- which is the label the library used to draw. A crosshair over a
    // time this series has no point for (a study still in its warm-up, whose
    // nulls are filtered out before they are drawn) hides the label rather
    // than showing the last value, which would read as a value at the
    // pointer that is nothing of the kind. The legend blanks there too.
    const point = at === null ? series.data().at(-1) : series.data().find((p) => p.time === at);
    const price = priceOf(point);
    if (price === null || !Number.isFinite(price)) return;
    const y = series.priceToCoordinate(price);
    if (y === null || !Number.isFinite(y)) return;
    // The series' OWN formatter, so this label reads exactly as the axis does
    // -- a percent for a performance line, a volume for the histogram, and
    // the right number of decimals for a price.
    text = series.priceFormatter().format(price);
    coordinate = y;
    visible = text !== "";
  };

  const view = {
    coordinate: () => coordinate,
    text: () => text,
    textColor: () => contrastInk(color),
    backColor: () => color,
    visible: () => visible,
    tickVisible: () => true,
  };
  const views = [view];

  return {
    /** The crosshair's time; null returns the label to the series' last point. */
    setTime(time: unknown): void { at = time ?? null; },
    /** The series' colour, when an edit recolours it under a live primitive. */
    setColor(next: string): void { color = next; },
    attached(param: { series: LabelSeries }): void { series = param.series; recompute(); },
    detached(): void { series = null; },
    // The library calls this before every paint, which is exactly when the
    // label has to be right -- so nothing has to push an update on a redraw.
    updateAllViews(): void { recompute(); },
    priceAxisViews(): readonly typeof view[] { return views; },
  };
}
