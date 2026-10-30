// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useMemo, useRef } from "react";
import { isPlotlyFigure, rowFigure, rowsOf, type PlotlyFigure } from "../../lib/chartShapes";
import type { ColumnSpec } from "../../lib/types";
import { logError } from "../../lib/logger";
import { purgePlot, REGISTERED_TRACE_TYPES, renderPlot, resizePlot } from "../../lib/plotly";
import { useSettingsStore } from "../../stores/settingsStore";

// A native openbb-charting figure is drawn exactly as it arrives, whatever
// colours it already carries -- re-theming a provider's own figure is out of
// scope. Only a figure this app builds itself, from raw rows, takes the
// current theme.
function figureFor(
  data: unknown,
  theme: "dark" | "light",
  columns?: ColumnSpec[],
  chartType?: string,
): PlotlyFigure | null {
  if (isPlotlyFigure(data)) return data;
  const rows = rowsOf(data);
  if (rows === null) return null;
  return rowFigure(rows, columns, chartType, theme);
}

// Plotly's own default when a trace omits `type` is "scatter" — which is
// registered — so an untyped trace is treated as scatter here rather than as
// missing or unrecognized.
function traceType(trace: unknown): string {
  if (typeof trace === "object" && trace !== null && "type" in trace) {
    const type = (trace as { type?: unknown }).type;
    if (typeof type === "string") return type;
  }
  return "scatter";
}

/** The first trace type this partial bundle never registered, if any. */
function unregisteredTraceType(figure: PlotlyFigure): string | null {
  return figure.data.map((t) => traceType(t)).find((t) => !REGISTERED_TRACE_TYPES.has(t)) ?? null;
}

/**
 * `uirevision` names the question this chart answers — the card's params.
 * While it holds, Plotly.react keeps the user's zoom/pan across a refetch or a
 * theme flip; a new value (new params) resets the view. Absent, the chart
 * keeps one revision for as long as it is mounted.
 */
export function ChartRenderer({
  data,
  uirevision = "chart",
  columns,
  chartType,
}: {
  data: unknown;
  uirevision?: string;
  /** The widget's columnsDefs, for their chartDataType. */
  columns?: ColumnSpec[];
  /** The widget's chartView.chartType. */
  chartType?: string;
}) {
  const node = useRef<HTMLDivElement | null>(null);
  const theme = useSettingsStore((s) => s.settings.theme);
  const figure = useMemo(() => figureFor(data, theme, columns, chartType), [data, theme, columns, chartType]);
  const unregisteredType = useMemo(
    () => (figure ? unregisteredTraceType(figure) : null),
    [figure],
  );
  const drawable = figure && unregisteredType === null ? figure : null;

  // A ref callback, not a plain object ref, because node.current is only
  // backed by a real element while `drawable` is truthy — the render below
  // swaps the div for a <p> otherwise — so tying resize/purge setup to a
  // mount-only effect could miss the node if it first appears on a later
  // render. This callback fires whenever the actual DOM node this div is
  // mounted on is attached or detached, whichever render that happens on.
  //
  // react-grid-layout resizes this element without ever resizing the
  // window, which is the only event plotly's own `responsive: true` listens
  // for; without observing it directly, a chart would keep its old pixel
  // size until the OS window itself was resized.
  //
  // Plotly attaches its own DOM and listeners to the node; without the purge
  // in this cleanup, it keeps them after React drops the element.
  // Only resize when the box ACTUALLY changed. ResizeObserver also fires when
  // plotly redraws its own SVG inside this node -- including on a click -- and
  // Plotly.Plots.resize relayouts, which rebuilds the drag layer. Plotly
  // detects a double-click by counting two clicks within a delay on the SAME
  // drag layer, so an unconditional resize between the two clicks discards the
  // count and "double-click to reset zoom" silently stops working.
  const attachNode = useCallback((el: HTMLDivElement | null) => {
    node.current = el;
    if (!el) return;
    let last = { w: 0, h: 0 };
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      // Rounded: sub-pixel jitter from a redraw is not a resize.
      const w = Math.round(box.width);
      const h = Math.round(box.height);
      if (w === last.w && h === last.h) return;
      last = { w, h };
      resizePlot(el);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      purgePlot(el);
    };
  }, []);

  // Reconciles the existing plot in place via Plotly.react (renderPlot)
  // rather than purging and redrawing on every new `data`/`drawable`
  // identity — that would tear the plot down on every refresh, discarding
  // the user's zoom/pan and defeating the point of Plotly.react. The plot is
  // only ever purged in attachNode's cleanup above, when the node itself
  // goes away (i.e. on unmount).
  useEffect(() => {
    const el = node.current;
    if (!el || !drawable) return;
    renderPlot(el, drawable, uirevision).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      void logError(`chart render failed: ${message}`);
    });
  }, [drawable, uirevision]);

  if (!figure) return <p className="empty-state">Nothing chartable in this payload.</p>;
  if (unregisteredType !== null) {
    return (
      <p className="empty-state">
        This chart needs a trace type this build does not include: {unregisteredType}.
      </p>
    );
  }
  return <div className="chart-plot" ref={attachNode} data-testid="chart-plot" />;
}
