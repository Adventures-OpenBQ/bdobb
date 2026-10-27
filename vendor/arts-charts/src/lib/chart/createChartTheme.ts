// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import type { CandlestickStyleOptions, ChartOptions, DeepPartial } from "lightweight-charts";

/**
 * The theme adapter (spec §11): CSS tokens in, lightweight-charts options
 * out. The chart paints on a canvas, so it cannot read `var(--up)` the way
 * the chrome does; this is the one place a token becomes a colour string,
 * read with getComputedStyle at chart creation. The renderer rebuilds the
 * chart on a theme flip (its chartEpoch), so a rebuild is also a re-read --
 * no listener, no second path.
 *
 * Nothing outside this file names a colour. createChartTheme.test.ts greps
 * the other chart files to keep it that way.
 */
export const CHART_TOKENS = [
  "--bg-card", "--bg-panel", "--text", "--text-muted", "--border", "--line-soft",
  "--accent", "--accent-soft", "--up", "--down",
] as const;

export type ChartTokens = Record<(typeof CHART_TOKENS)[number], string>;

/**
 * The study picker's colour swatches (v12.3.1, the layout pack's `.sws`
 * row). A study's colour is DATA -- it is written into the instance and
 * onto the wire, not painted from a token -- so these seven cannot be CSS
 * variables the way the chrome's colours are. They live here because this
 * is the one file allowed to name a colour (see the header above); the
 * picker imports the list rather than spelling a hex of its own. The eighth
 * swatch is the registry's own colour for the picked study, prepended at
 * the call site.
 */
export const STUDY_SWATCHES = [
  "#2563eb", "#da7101", "#0e9f6e", "#e0393e", "#7c5cbf", "#01696f", "#98c379",
] as const;

/** Every chart token as the element's computed style has it; "" when undeclared. */
export function readChartTokens(element: Element = document.documentElement): ChartTokens {
  const style = getComputedStyle(element);
  const out = {} as ChartTokens;
  for (const name of CHART_TOKENS) out[name] = style.getPropertyValue(name).trim();
  return out;
}

const HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

/**
 * Ink that stays legible on `fill`: the axis label's text against its own
 * series colour (lib/chart/axisLabel.ts).
 *
 * Here rather than there because this is the one file allowed to name a
 * colour, and the two it needs are literal black and white -- there is no
 * token for "whatever contrasts with an arbitrary series colour".
 *
 * Rec. 709 luma, and the 0.6 threshold rather than 0.5: the study palette's
 * mid-tone greens and purples read better with white on them than the
 * even split gives.
 */
export function contrastInk(fill: string): string {
  const hex = HEX.exec(fill.trim());
  // Not a hex we can read -- a named colour, an rgba, an empty string -- takes
  // the dark ink, which is legible on every light default the app has.
  if (hex === null) return "#000000";
  const [r, g, b] = [hex[1], hex[2], hex[3]].map((pair) => parseInt(pair, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? "#000000" : "#ffffff";
}

/** `#rrggbb` at an opacity; anything else passes through untouched. */
export function withAlpha(hex: string, alpha: number): string {
  const match = HEX.exec(hex);
  if (match === null) return hex;
  const [r, g, b] = [match[1], match[2], match[3]].map((pair) => parseInt(pair, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export type ChartTheme = {
  /** Options for createChart / applyOptions: layout, grid, crosshair, panes. */
  chart: DeepPartial<ChartOptions>;
  candles: DeepPartial<CandlestickStyleOptions>;
  /**
   * OHLC bars (v12.4.0): black-and-white, in the spec's own words -- the
   * bar, its open tick and its close tick all in the text colour, with no
   * up/down tint at all. Direction is read off the ticks, which is what an
   * OHLC bar is for; a trader who wants colour picks candlesticks.
   */
  bars: string;
  /** Per-bar histogram colours, by the bar's own direction. */
  volume: { up: string; down: string };
  /** Drawings annotate the plot: muted lines, the accent for a selection and the live preview. */
  drawings: { segment: string; level: string; fib: string; gann: string; proposed: string; selected: string; preview: string; avwap: string; study: string };
  watermark: { alpha: number; padding: number };
};


/** The volume bars' opacity: the auction's shape reads without competing with price (§8.3). */
const VOLUME_ALPHA = 0.45;

export function chartTheme(tokens: ChartTokens, mode: "light" | "dark"): ChartTheme {
  const line = tokens["--line-soft"];
  return {
    chart: {
      layout: {
        // Transparent: the card's own --bg-card shows through, so the chart
        // never needs to know what a card is coloured.
        background: { color: "transparent" },
        textColor: tokens["--text-muted"],
        // The library's native pane separators (spec, Pane divider ruling).
        // ponytail: no 14px grip and no double-click reset; a DOM overlay on
        // pane.getHTMLElement() is the upgrade if the hairline is hard to hit.
        panes: { enableResize: true, separatorColor: line, separatorHoverColor: tokens["--accent-soft"] },
      },
      grid: { vertLines: { color: line }, horzLines: { color: line } },
      crosshair: {
        vertLine: { color: tokens["--text-muted"], labelBackgroundColor: tokens["--border"] },
        horzLine: { color: tokens["--text-muted"], labelBackgroundColor: tokens["--border"] },
      },
      timeScale: { borderColor: tokens["--border"] },
      rightPriceScale: { borderColor: tokens["--border"] },
    },
    candles: {
      upColor: tokens["--up"], downColor: tokens["--down"],
      wickUpColor: tokens["--up"], wickDownColor: tokens["--down"],
      // ponytail: the spec's 1.4px up-wick needs a custom series; the library
      // has no wick width. Direction is still colour + the legend's glyph.
      borderVisible: false,
    },
    bars: tokens["--text"],
    volume: { up: withAlpha(tokens["--up"], VOLUME_ALPHA), down: withAlpha(tokens["--down"], VOLUME_ALPHA) },
    drawings: {
      // Hand drawings are annotations: muted, so they sit behind the candles
      // in attention. Fib and gann are the accent so their families of lines
      // read as one figure each; a Rita/EODHD proposal is the down colour
      // until kept, the selection and the drag preview are the accent (the
      // preview translucent so it can never be mistaken for a committed
      // line); an AVWAP is a price and takes the text colour, and a study the
      // server gave no colour of its own takes the muted one.
      // Four tokens cannot separate seven roles, and this palette owns the
      // collisions rather than inventing hues outside the theme: fib and gann
      // share the accent (v12.2 gave them different ones), and a proposed
      // level is the same --down as a falling candle. A selection is marked
      // by width, not colour, for exactly that reason.
      segment: tokens["--text-muted"], level: tokens["--text-muted"],
      fib: tokens["--accent"], gann: tokens["--accent"],
      proposed: tokens["--down"],
      selected: tokens["--accent"], preview: withAlpha(tokens["--accent"], 0.6),
      avwap: tokens["--text"], study: tokens["--text-muted"],
    },
    // Alpha is the whole mark's opacity; dark surfaces want a touch more
    // (addendum §12.4 note 4). Tuned here, never at the call site.
    // 0.11 (user ruling 2026-09-17, with the 3D mark): the shading has to
    // stay legible without competing with the candles; dark a touch more.
    watermark: { alpha: mode === "dark" ? 0.13 : 0.11, padding: 24 },
  };
}
