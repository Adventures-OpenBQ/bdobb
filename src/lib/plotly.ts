// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// The custom partial bundle. plotly.js in full is roughly 4.7MB minified
// against an app bundle of a few hundred KB; registering only the traces the
// app can actually produce keeps that to a fraction. chartShapes emits exactly
// three trace types, and THIS FILE IS THE ONLY PLACE the list lives — widening
// it later is one edit here.
import Plotly from "plotly.js/lib/core";
import bar from "plotly.js/lib/bar";
import candlestick from "plotly.js/lib/candlestick";
import scatter from "plotly.js/lib/scatter";
import heatmap from "plotly.js/lib/heatmap";
import treemap from "plotly.js/lib/treemap";
import type { Data } from "plotly.js/lib/core";
import type { PlotlyFigure } from "./chartShapes";

const REGISTERED_TRACES = [scatter, candlestick, bar, heatmap, treemap];

Plotly.register(REGISTERED_TRACES);

// Derived from the same array passed to Plotly.register, so this set is
// always a SUBSET of what's actually registered — never a superset. In
// particular, `plotly.js/lib/core` registers `scatter` unconditionally
// (independent of REGISTERED_TRACES), so scatter is drawable whether or not
// it appears here. The invariant callers can rely on is one-directional:
// everything in this set is registered, but not everything registered is in
// this set. A native (already-formed) figure can declare any plotly trace
// type; callers use this set only to refuse one that is CERTAIN not to be
// registered, rather than letting it throw.
export const REGISTERED_TRACE_TYPES: ReadonlySet<string> = new Set(
  REGISTERED_TRACES.map((trace) => trace.name),
);

// Plotly's own click-counting (plotly.js's components/dragelement/index.js)
// requires the WHOLE double-click gesture -- mousedown, mouseup, mousedown,
// mouseup -- to complete within doubleClickDelay, measured from the first
// mousedown, not just mousedown-to-mousedown. The 300ms default is tight for
// a real double-click (as opposed to a scripted one, or one landing while the
// chart is still settling from its own zoom redraw): miss it and "double
// click to reset zoom" doesn't fire at all -- not a partial reset, no
// reaction whatsoever, since numClicks never reaches 2. Doubled for headroom.
const CONFIG = { displayModeBar: false, responsive: true, doubleClickDelay: 600 };

export function renderPlot(node: HTMLElement, figure: PlotlyFigure, uirevision?: string): Promise<void> {
  // Plotly.react keeps the user's zoom/pan only while layout.uirevision is
  // unchanged between calls; a fresh layout without one resets them on every
  // redraw. A figure that already carries its own uirevision (a backend's
  // choice) keeps it. Copied, never assigned: a native figure is the payload
  // object itself.
  const layout =
    uirevision === undefined
      ? figure.layout
      : { ...figure.layout, uirevision: figure.layout.uirevision ?? uirevision };
  // chartShapes deliberately types figure.data as unknown[] (it's the producer
  // of both native and built figures); the real element shape is Plotly's own
  // Data union, asserted here at the one seam where the two types meet.
  return Plotly.react(node, figure.data as Data[], layout, CONFIG) as unknown as Promise<void>;
}

export function purgePlot(node: HTMLElement): void {
  Plotly.purge(node);
}

// `responsive: true` (in CONFIG above) only attaches plotly's own `window`
// resize listener — plotly.js ships no ResizeObserver of its own. Cards are
// resized by react-grid-layout without ever resizing the window, so callers
// must observe the node themselves and call this to make plotly redraw at
// its container's current size.
export function resizePlot(node: HTMLElement): void {
  Plotly.Plots.resize(node);
}
