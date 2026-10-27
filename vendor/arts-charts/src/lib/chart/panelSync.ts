// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

/**
 * The glue between one chart per panel (v12.4.0, spec: panels and series).
 * A card used to be ONE lightweight-charts instance with stacked panes, so
 * the library kept the panes on one time axis and one crosshair for free;
 * a panel is now its own instance, and that sharing is this module's job --
 * plus the `ymin`/`ymax` links, which let a panel borrow another panel's
 * y-range.
 *
 * Everything here is a plain function over chart handles, or over numbers
 * alone, so the parts that decide anything (the mirroring guard, the link
 * resolution in dependency order, the sub-window clamp) are testable
 * without React or a canvas. `PanelHost` owns the lifecycle that calls
 * them.
 */
import type {
  IChartApi, ISeriesApi, LogicalRange, MouseEventParams, SeriesType, Time,
} from "lightweight-charts";
import type { PanelDef } from "./panels";

/** Which of a panel's two price scales a series is on. */
export type Side = "left" | "right";

/**
 * A price range, in AutoscaleInfo's own field names. `PanelHost` converts
 * at the chart boundary: `IPriceScaleApi` reads and writes `{ from, to }`.
 */
export type Range = { minValue: number; maxValue: number };

/**
 * One time axis across every panel: whichever chart the user scrolls or
 * zooms pushes its logical range onto all the others. `applying` is the
 * re-entrancy guard -- without it every mirrored `setVisibleLogicalRange`
 * fires the target's own handler and the charts push the range back and
 * forth forever. `onSynced` runs INSIDE the guard, after the mirror, which
 * is where a panel with an `xs`/`xe` sub-window re-clamps itself: its
 * correction is a range change like any other, and must not be mirrored
 * back out to the panels that are showing the full window.
 *
 * Returns the unsubscribe.
 */
export function syncTimeScales(charts: IChartApi[], onSynced?: () => void): () => void {
  let applying = false;
  const handlers = charts.map((chart, source) => {
    const handler = (range: LogicalRange | null): void => {
      if (applying || range === null) return;
      applying = true;
      try {
        charts.forEach((other, i) => { if (i !== source) other.timeScale().setVisibleLogicalRange(range); });
        onSynced?.();
      } finally {
        applying = false;
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
    return handler;
  });
  return () => { charts.forEach((chart, i) => { chart.timeScale().unsubscribeVisibleLogicalRangeChange(handlers[i]); }); };
}

/**
 * A series' price at a TIME, whichever of the two datum shapes it holds.
 *
 * By time, not by the hovered panel's logical index (the branch-end round,
 * finding 8): a performance line starts at its anchor and a study line has
 * its warm-up nulls filtered out, so their index spaces are offset from the
 * hovered panel's and the mirrored line sat on a different bar.
 *
 * ponytail: a linear scan per panel per pointer move, as the legend already
 * does over the same arrays. Binary search is the upgrade if a card ever
 * holds enough points for it to show.
 */
function priceAt(series: ISeriesApi<SeriesType>, time: Time): number | null {
  const item = series.data().find((point) => point.time === time) as { value?: number; close?: number } | undefined;
  if (item === undefined) return null;
  if (typeof item.value === "number") return item.value;
  return typeof item.close === "number" ? item.close : null;
}

/**
 * One crosshair across every panel: the hovered chart's time becomes a
 * crosshair on all the others, and a mouse leaving the card clears them.
 * `seriesFor` names the series each panel hangs its crosshair on (the
 * renderer sets it when it attaches the panel's first series); a panel
 * with no series yet is just skipped.
 *
 * ponytail: the mirrored panel's HORIZONTAL line sits on its own series at
 * that time, not at the pointer's y -- `setCrosshairPosition` takes a
 * price, and the library has no time-only crosshair. The vertical line,
 * which is what "one crosshair" means here, is exact. A pane primitive
 * drawing the vertical line itself is the upgrade if the horizontal one
 * ever misleads.
 */
export function syncCrosshair(
  charts: IChartApi[],
  seriesFor: (index: number) => ISeriesApi<SeriesType> | null,
): () => void {
  let applying = false;
  const handlers = charts.map((chart, source) => {
    const handler = (param: MouseEventParams<Time>): void => {
      if (applying) return;
      applying = true;
      try {
        charts.forEach((other, i) => {
          if (i === source) return;
          const series = seriesFor(i);
          const price = series === null || param.time === undefined ? null : priceAt(series, param.time);
          if (param.time === undefined || series === null || price === null) { other.clearCrosshairPosition(); return; }
          other.setCrosshairPosition(price, param.time, series);
        });
      } finally {
        applying = false;
      }
    };
    chart.subscribeCrosshairMove(handler);
    return handler;
  });
  return () => { charts.forEach((chart, i) => { chart.unsubscribeCrosshairMove(handlers[i]); }); };
}

/**
 * What each panel's y-axis should be forced to, walked in `scaleOrder`'s
 * `order` so a panel that borrows another's range is resolved only after
 * that one is -- a chain `P3 -> P2 -> P1` then sees P2's RESOLVED range,
 * not its raw one.
 *
 * `own` is each panel's current range, which `PanelHost` reads straight off
 * the scale (`priceScale(side).getVisibleRange()`, already unioned across
 * every series on it). A panel is mapped to `null` when it should just
 * autoscale, and a panel absent from `order` (one on a reference cycle, or
 * downstream of one) is absent from the result for the same reason -- the
 * caller autoscales anything it does not find here.
 *
 * An `ymin`/`ymax` that is a plain number is a fixed bound on that side; a
 * `P<n>` borrows that edge of the referenced panel; an unset side keeps
 * the panel's own autoscaled edge. A pair that comes out inverted or
 * incomplete (a bound whose reference has no range yet) autoscales rather
 * than drawing something impossible.
 */
export function applyYLinks(
  panels: PanelDef[],
  order: number[],
  own: ReadonlyMap<number, Range | null>,
): Map<number, Range | null> {
  const resolved = new Map<number, Range | null>();
  // A referenced panel's EFFECTIVE range: what it was forced to if it was
  // forced, and otherwise its own autoscaled range (a `null` in `resolved`
  // means "this panel autoscales", not "this panel has no range").
  const effective = (n: number): Range | null => resolved.get(n) ?? own.get(n) ?? null;

  for (const n of order) {
    const panel = panels[n - 1];
    if (panel === undefined) continue;
    if (panel.ymin === undefined && panel.ymax === undefined) { resolved.set(n, null); continue; }
    const base = own.get(n) ?? null;
    const edge = (value: number | { ref: number } | undefined, which: "minValue" | "maxValue"): number | undefined => {
      if (typeof value === "number") return value;
      if (value === undefined) return base === null ? undefined : base[which];
      const source = effective(value.ref);
      return source === null ? undefined : source[which];
    };
    const min = edge(panel.ymin, "minValue");
    const max = edge(panel.ymax, "maxValue");
    resolved.set(n, min === undefined || max === undefined || min >= max ? null : { minValue: min, maxValue: max });
  }
  return resolved;
}

/**
 * A panel's visible time range pulled back inside its `xs`/`xe` bounds --
 * `null` when it is already inside, so the caller only writes when the
 * user has actually scrolled out of the subset. A clamp that would collapse
 * the range (bounds crossing, or a view entirely past one edge) is refused
 * the same way: better a range outside the subset than an empty chart.
 */
export function clampRange(
  range: { from: number; to: number },
  bounds: { from: number | null; to: number | null },
): { from: number; to: number } | null {
  const from = bounds.from === null ? range.from : Math.max(range.from, bounds.from);
  const to = bounds.to === null ? range.to : Math.min(range.to, bounds.to);
  if (from === range.from && to === range.to) return null;
  return from < to ? { from, to } : null;
}
