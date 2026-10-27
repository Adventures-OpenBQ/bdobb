// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import { createImageWatermark, type IChartApi } from "lightweight-charts";
import lightMark from "../../assets/arts-charts-mark.svg?raw";
import darkMark from "../../assets/arts-charts-mark-dark.svg?raw";
import type { ChartTheme } from "./createChartTheme";

/**
 * The Arts Charts bar-mark as a pane watermark (spec §8.4, addendum §12).
 *
 * Both variants ship bundled and are never recoloured at runtime: the dark
 * one is the light one under three colour swaps, checked into src/assets
 * beside it. The SVG goes in as a data URI so there is no network fetch and
 * chart.takeScreenshot() (slice 2) stays a clean, same-origin canvas.
 */
export function markDataUri(mode: "light" | "dark"): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(paddedMark(mode === "dark" ? darkMark : lightMark))}`;
}

/**
 * The primitive fits the whole image to the pane (minus padding), so the
 * only way to draw the mark SMALLER than the pane is to give the image
 * transparent margins: the canonical 500x200 viewBox is widened so the mark
 * fills WATERMARK_SCALE of it, centred. The assets stay canonical (addendum
 * §12); this is a rendering choice, tuned here.
 */
const WATERMARK_SCALE = 0.6;
const CANONICAL = 'viewBox="0 0 500 200"';
export function paddedMark(svg: string): string {
  const w = 500 / WATERMARK_SCALE;
  const h = 200 / WATERMARK_SCALE;
  const box = [-(w - 500) / 2, -(h - 200) / 2, w, h].map((n) => n.toFixed(3)).join(" ");
  return svg.replace(CANONICAL, `viewBox="${box}"`);
}

/**
 * The mark as a DOM element behind ALL the panels, centred on the whole card
 * (owner, 2026-09-27: "can the watermark be centered in the overall chart
 * instead of just the first panel").
 *
 * `createImageWatermark` is a PANE primitive, and since v12.4.0 every panel is
 * its own chart with one pane -- so a pane primitive can only ever be centred
 * on one panel, which is why it sat in panel 1. The card has no chart of its
 * own to hang it from, so the card's own element carries it instead.
 *
 * It shows through because the chart layout background is deliberately
 * transparent (see `chartTheme`): the panels are painted over this, and the
 * mark reads through every one of them and through the axis gutters, which is
 * what "centred on the overall chart" means.
 *
 * The PNG export does NOT get it this way -- `takeScreenshot` captures the
 * chart canvas and knows nothing about the DOM around it -- so `composePanels`
 * draws the same mark into the composed canvas itself. Two paths, one image:
 * `markDataUri` is the single source, so they cannot drift.
 */
export function watermarkStyle(mode: "light" | "dark", theme: Pick<ChartTheme, "watermark">): {
  src: string; opacity: number; padding: number;
} {
  return { src: markDataUri(mode), opacity: theme.watermark.alpha, padding: theme.watermark.padding };
}

/**
 * Attach the mark to the PRICE pane only; volume and study panes stay clean.
 * Called once per chart instance, right after the series exist (a pane is
 * created by its first series). The renderer rebuilds the chart on a theme
 * flip, so the other variant is attached to the new instance and the old
 * one goes with chart.remove() -- there is never a second instance to
 * stack. The returned handle's detach() is still called in the renderer's
 * cleanup, before remove(), so the primitive is released in order.
 */
export function attachWatermark(
  chart: Pick<IChartApi, "panes">,
  mode: "light" | "dark",
  theme: Pick<ChartTheme, "watermark">,
): { detach: () => void } {
  // Pane 0 of the chart it is handed. v12.4.0 gives every panel a chart of
  // its own, each with exactly one pane, so "the price pane" is now "pane 0
  // of panel 1's chart" and the caller decides which chart that is.
  const pane = chart.panes()[0];
  return createImageWatermark(pane, markDataUri(mode), { alpha: theme.watermark.alpha, padding: theme.watermark.padding });
}
