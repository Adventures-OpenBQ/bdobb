// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import type {
  IChartApi, IChartApiBase, IPanePrimitive, IPanePrimitivePaneView, IPrimitivePaneRenderer, ISeriesApi, PaneAttachedParameter, Time,
} from "lightweight-charts";
import { withAlpha } from "./createChartTheme";
import type { FillPattern } from "./pen";

type Target = Parameters<IPrimitivePaneRenderer["draw"]>[0];

/**
 * The two things this primitive asks of a line series: the points it holds
 * and the price-to-pixel map of the scale it sits on. Structural rather
 * than `ISeriesApi<"Line">` itself -- a real line series satisfies it as it
 * is, with nothing else in `attachBandFill`'s signature needing to change.
 */
export type BandSeries = Pick<ISeriesApi<"Line">, "data" | "priceToCoordinate">;

/** The shade's opacity when the instance names none (spec, the Shade ruling). */
export const DEFAULT_SHADE_OPACITY = 0.15;

/**
 * One tile of a hatch, in the shade colour, for `createPattern` to repeat
 * (docs/custom-studies.md: a band's fill pattern). Drawn once per colour and
 * pattern, not per frame. Null where there is no canvas to draw on -- a
 * non-browser host, or jsdom under test -- and the fill falls back to solid.
 *
 * ponytail: the strokes carry three times the fill's opacity (capped at 1),
 * because a hatch covers about a third of its tile and would otherwise read
 * as a fainter solid; a per-pattern coverage figure if a designer asks.
 */
function hatchTile(pattern: Exclude<FillPattern, "solid">, color: string, opacity: number): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const tile = document.createElement("canvas");
  tile.width = 8;
  tile.height = 8;
  const ctx = tile.getContext("2d");
  if (!ctx) return null;
  const ink = withAlpha(color, Math.min(1, opacity * 3));
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 1;
  if (pattern === "dots") {
    ctx.beginPath();
    ctx.arc(4, 4, 1.2, 0, Math.PI * 2);
    ctx.fill();
    return tile;
  }
  ctx.beginPath();
  ctx.moveTo(0, 8);
  ctx.lineTo(8, 0);
  if (pattern === "cross") {
    ctx.moveTo(0, 0);
    ctx.lineTo(8, 8);
  }
  ctx.stroke();
  return tile;
}

/**
 * The shade between a banded study's two outward lines (v12.3.1): a pane
 * primitive that fills the area between an upper and a lower line series in
 * the instance's own `style.shade`.
 *
 * Drawn on the `bottom` layer, unlike the session veil: a shade sits BEHIND
 * the candles and the study's own lines -- it is a background wash, not a
 * dimming. Both lines' values go through the UPPER series' priceToCoordinate
 * because a band's two outputs are always on one scale, and asking one of
 * them keeps the polygon's two edges in the same coordinate space even if a
 * pane ever grew a second scale.
 *
 * A null on either side is a gap, not a zero: the run ends there and a new
 * one starts at the next point both lines can place, so a warmup period or a
 * nulled output leaves a hole in the shade rather than a straight line
 * across it. A run of one point has no area and paints nothing.
 */
class BandFill implements IPanePrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private fill: string;
  private tile: HTMLCanvasElement | null = null;
  // One array for the life of the primitive: the library caches pane views
  // by array identity and a fresh array per call would defeat that.
  private readonly views: readonly IPanePrimitivePaneView[];

  constructor(
    private readonly upper: BandSeries, private readonly lower: BandSeries, color: string, opacity: number,
    pattern: FillPattern = "solid",
  ) {
    this.fill = withAlpha(color, opacity);
    this.tile = pattern === "solid" ? null : hatchTile(pattern, color, opacity);
    this.views = [{ zOrder: () => "bottom", renderer: () => ({ draw: (target) => this.draw(target) }) }];
  }

  attached({ chart, requestUpdate }: PaneAttachedParameter<Time>): void {
    this.chart = chart;
    this.requestUpdate = requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.requestUpdate = null;
  }

  paneViews(): readonly IPanePrimitivePaneView[] {
    return this.views;
  }

  /** The shade's colour and opacity; asks the chart to repaint. */
  setColor(color: string, opacity: number, pattern: FillPattern = "solid"): void {
    this.fill = withAlpha(color, opacity);
    this.tile = pattern === "solid" ? null : hatchTile(pattern, color, opacity);
    this.requestUpdate?.();
  }

  private draw(target: Target): void {
    const chart = this.chart;
    if (chart === null) return;
    const scale = chart.timeScale();
    // The lower line by time, not by index: the two series are served from
    // one indicator and so share a time axis, but an index walk would
    // silently pair the wrong points the first time one of them starts a
    // bar later than the other. Keying on the raw `time` value is sound
    // only because `StudyPoint.time` is a unix number (useStudySeries.ts);
    // a `BusinessDay` time would key by object identity and miss every
    // lookup.
    // ponytail: `.data()` returns a fresh N-object array and this builds a
    // fresh N-entry Map on every repaint (crosshair moves and pans, not
    // just new data) -- ~3N allocations per shaded study per frame. Fine at
    // this chart's sizes; upgrade path is clipping the walk to the visible
    // time range if a chart ever carries enough shaded studies for it to
    // show up in a profile.
    const below = new Map<unknown, number>();
    for (const point of this.lower.data()) {
      const value = (point as { value?: number }).value;
      if (value !== undefined) below.set(point.time, value);
    }
    target.useMediaCoordinateSpace(({ context }) => {
      // A hatch is the tile repeated; a context that cannot make one (or a
      // tile that could not be drawn) shades solid rather than not at all.
      const hatch = this.tile === null ? null : context.createPattern?.(this.tile, "repeat") ?? null;
      context.fillStyle = hatch ?? this.fill;
      let run: { x: number; up: number; lo: number }[] = [];
      const flush = () => {
        if (run.length >= 2) {
          context.beginPath();
          context.moveTo(run[0].x, run[0].up);
          for (const point of run.slice(1)) context.lineTo(point.x, point.up);
          for (let i = run.length - 1; i >= 0; i -= 1) context.lineTo(run[i].x, run[i].lo);
          context.closePath();
          context.fill();
        }
        run = [];
      };
      for (const point of this.upper.data()) {
        const top = (point as { value?: number }).value;
        const bottom = below.get(point.time);
        const x = scale.timeToCoordinate(point.time);
        const up = top === undefined ? null : this.upper.priceToCoordinate(top);
        const lo = bottom === undefined ? null : this.upper.priceToCoordinate(bottom);
        if (x === null || up === null || lo === null) { flush(); continue; }
        run.push({ x, up, lo });
      }
      flush();
    });
  }
}

/**
 * Attach a shade to one pane, exactly as attachVeil does: the studies
 * effect calls this once the pane's two lines exist, keeps the handle, and
 * detaches it when the study (or either line) goes away and in the chart
 * teardown before remove().
 */
export function attachBandFill(
  chart: Pick<IChartApi, "panes">,
  paneIndex: number,
  upper: BandSeries,
  lower: BandSeries,
  color: string,
  opacity: number,
  pattern: FillPattern = "solid",
): { setColor: (color: string, opacity: number, pattern?: FillPattern) => void; detach: () => void } {
  const pane = chart.panes()[paneIndex];
  const fill = new BandFill(upper, lower, color, opacity, pattern);
  pane.attachPrimitive(fill);
  return { setColor: (next, alpha, hatch) => fill.setColor(next, alpha, hatch), detach: () => pane.detachPrimitive(fill) };
}
