// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isPlotlyFigure, rowFigure, rowsOf, type PlotlyFigure } from "../../lib/chartShapes";
import type { ColumnSpec } from "../../lib/types";
import { logError } from "../../lib/logger";
import { followPlotYAxisTicks, purgePlot, REGISTERED_TRACE_TYPES, renderPlot, resizePlot, type AxisTickFormatter } from "../../lib/plotly";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";

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

export type DrawingSurface = { width: number; height: number };

export function readDrawingSurface(surface: Element): DrawingSurface {
  const box = surface.getBoundingClientRect();
  return { width: box.width || surface.clientWidth, height: box.height || surface.clientHeight };
}

// The installed Sankey trace follows mouse movements and clears hover on click.
function inspectSankeyTaps(plot: HTMLDivElement) {
  const targetFor = (event: TouchEvent) => event.target instanceof Element
    ? event.target.closest('.sankey-node, .sankey-link') : null;
  let start: { target: Element; touch: Touch; time: number } | undefined;
  let hovered: Element | undefined;
  const moved = (touch: Touch | undefined) => !start || !touch || touch.identifier !== start.touch.identifier
    || Math.hypot(touch.clientX - start.touch.clientX, touch.clientY - start.touch.clientY) > 8;
  function begin(event: TouchEvent) {
    const target = targetFor(event);
    start = target && event.touches.length === 1 ? { target, touch: event.touches[0], time: event.timeStamp } : undefined;
    // D3 installs a scroll-blocking touch drag even on fixed nodes.
    if (target?.classList.contains('sankey-node')) event.stopPropagation();
  }
  function move(event: TouchEvent) {
    if (event.touches.length !== 1 || moved(event.touches[0])) start = undefined;
  }
  function clear() { start = undefined; }
  function end(event: TouchEvent) {
    const target = targetFor(event);
    const touch = event.changedTouches[0];
    const tap = start && start.target === target && !event.touches.length && !moved(touch)
      && event.timeStamp - start.time < 500;
    clear();
    if (!tap || !target || !event.cancelable) return;
    event.preventDefault();
    const mouse = { bubbles: true, clientX: touch.clientX, clientY: touch.clientY };
    if (hovered && hovered !== target) hovered.dispatchEvent(new MouseEvent('mouseout', mouse));
    target.dispatchEvent(new MouseEvent('mouseover', mouse));
    target.dispatchEvent(new MouseEvent('mousemove', mouse));
    hovered = target;
  }
  plot.addEventListener('touchstart', begin, { capture: true, passive: true });
  plot.addEventListener('touchmove', move, { passive: true });
  plot.addEventListener('touchcancel', clear);
  plot.addEventListener('touchend', end, { passive: false });
  return () => {
    plot.removeEventListener('touchstart', begin, true);
    plot.removeEventListener('touchmove', move);
    plot.removeEventListener('touchcancel', clear);
    plot.removeEventListener('touchend', end);
  };
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
  scrollHeight,
  touchScroll = false,
  inspectSankeyOnTouch = false,
  onPlotWidthChange,
  onViewportWidthChange,
  minPlotWidth,
  onDrawingSurfaceChange,
  formatYAxisTicks,
}: {
  data: unknown;
  uirevision?: string;
  scrollHeight?: number;
  touchScroll?: boolean | 'overflow';
  inspectSankeyOnTouch?: boolean;
  /** Explicitly sized figures rebuild their layout at the measured width. */
  onPlotWidthChange?: (width: number) => void;
  /** Measure a retained scrolling viewport, even when no figure can be drawn. */
  onViewportWidthChange?: (width: number) => void;
  minPlotWidth?: number;
  /** Measure the actual drawing surface after minimum dimensions and scrollbar gutters. */
  onDrawingSurfaceChange?: (size: DrawingSurface) => void;
  formatYAxisTicks?: AxisTickFormatter;
  /** The widget's columnsDefs, for their chartDataType. */
  columns?: ColumnSpec[];
  /** The widget's chartView.chartType. */
  chartType?: string;
}) {
  const node = useRef<HTMLDivElement | null>(null);
  const resolvedTheme = useResolvedTheme();
  const figure = useMemo(
    () => figureFor(data, resolvedTheme, columns, chartType),
    [data, resolvedTheme, columns, chartType],
  );
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
    const stopInspecting = inspectSankeyOnTouch ? inspectSankeyTaps(el) : undefined;
    let last = { w: 0, h: 0 };
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      // Rounded: sub-pixel jitter from a redraw is not a resize.
      const w = Math.round(box.width);
      const h = Math.round(box.height);
      if (w === last.w && h === last.h) return;
      if (onPlotWidthChange) {
        if (w > 0 && w !== last.w) onPlotWidthChange(w);
      } else resizePlot(el);
      last = { w, h };
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      stopInspecting?.();
      if (node.current === el) node.current = null;
      // React can immediately reattach the same node, including during a draw.
      queueMicrotask(() => { if (node.current !== el) purgePlot(el); });
    };
  }, [inspectSankeyOnTouch, onPlotWidthChange]);

  // Reconciles the existing plot in place via Plotly.react (renderPlot)
  // rather than purging and redrawing on every new `data`/`drawable`
  // identity — that would tear the plot down on every refresh, discarding
  // the user's zoom/pan and defeating the point of Plotly.react. The plot is
  // only ever purged in attachNode's cleanup above, when the node itself
  // goes away (i.e. on unmount).
  const scrolling = scrollHeight !== undefined;
  const coarsePointer = useMediaQuery(scrolling && touchScroll ? "(pointer: coarse)" : null) === true;
  const measureOverflow = coarsePointer && touchScroll === 'overflow';
  const [overflows, setOverflows] = useState(false);
  const coarseScroll = coarsePointer && (touchScroll === true || overflows);
  const draw = useMemo(() => ({
    figure: coarseScroll && drawable ? { ...drawable, layout: { ...drawable.layout, dragmode: false } } : drawable,
    id: Symbol(), uirevision, scrolling,
  }), [drawable, uirevision, scrolling, coarseScroll]);
  const [failure, setFailure] = useState<{ id: symbol; message: string }>();
  const hasPlot = Boolean(drawable && failure?.id !== draw.id);
  const measured = Boolean(onViewportWidthChange || onDrawingSurfaceChange);
  const observeViewport = useCallback((viewport: HTMLDivElement | null) => {
    if (!viewport || (!measureOverflow && !onViewportWidthChange && !onDrawingSurfaceChange)) return;
    const surface = viewport.firstElementChild;
    let previousWidth = 0;
    let previousHeight = 0;
    const measure = () => {
      if (measureOverflow) {
        // An old Plotly SVG can still overflow while the CSS surface is
        // shrinking. Its DOM overflow may settle without another resize event.
        const requiredHeight = (onDrawingSurfaceChange ? surface?.clientHeight : scrollHeight) ?? 0;
        const requiredWidth = onDrawingSurfaceChange ? surface?.clientWidth ?? 0 : viewport.clientWidth;
        setOverflows(hasPlot && (requiredHeight > viewport.clientHeight || requiredWidth > viewport.clientWidth));
      }
      if (viewport.clientWidth > 0) onViewportWidthChange?.(viewport.clientWidth);
      if (surface && onDrawingSurfaceChange) {
        const { width, height } = readDrawingSurface(surface);
        if (width > 0 && height > 0 && (width !== previousWidth || height !== previousHeight)) {
          previousWidth = width;
          previousHeight = height;
          onDrawingSurfaceChange({ width, height });
        }
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    // Plot height changes when the watchlist reflows, even if its viewport stays the same size.
    if (surface && (hasPlot || onDrawingSurfaceChange)) observer.observe(surface);
    return () => observer.disconnect();
  }, [hasPlot, measureOverflow, onDrawingSurfaceChange, onViewportWidthChange, scrollHeight]);
  useEffect(() => {
    const el = node.current;
    const figure = draw.figure;
    if (!el || !figure) return;
    let active = true;
    let stopFollowingTicks: (() => void) | undefined;
    const axis = formatYAxisTicks
      ? figure.layout.yaxis as { range?: number[]; tickvals?: number[]; ticktext?: string[] } | undefined
      : undefined;
    const failDraw = (error: unknown) => {
      if (!active || node.current !== el || !el.isConnected) return;
      active = false;
      stopFollowingTicks?.();
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 400);
      void logError(`chart render failed: ${message}`);
      setFailure({ id: draw.id, message });
    };
    const render = async () => {
      try {
        // Measured worker figures can be redrawn both for viewport changes and
        // touch mode. Plotly mutates nested ranges during gestures and react.
        const chart = onDrawingSurfaceChange ? { ...figure, layout: structuredClone(figure.layout) } : figure;
        await renderPlot(el, chart, draw.uirevision);
        if (active && node.current === el && formatYAxisTicks && axis?.range && axis.tickvals && axis.ticktext) {
          const initial = { range: axis.range, tickvals: axis.tickvals, ticktext: axis.ticktext };
          stopFollowingTicks = followPlotYAxisTicks(el, formatYAxisTicks, initial, failDraw);
          if (!active) stopFollowingTicks();
        }
      } catch (error) { failDraw(error); }
    };
    void render();
    return () => { active = false; stopFollowingTicks?.(); };
  }, [draw, formatYAxisTicks, onDrawingSurfaceChange]);

  const problem = failure?.id === draw.id ? <p role="alert">Chart could not be drawn. {failure.message}</p>
    : !figure ? (measured ? null : <p className="empty-state">Nothing chartable in this payload.</p>)
      : unregisteredType !== null ? <p className="empty-state">
        This chart needs a trace type this build does not include: {unregisteredType}.
      </p> : null;
  const surfaceStyle = scrolling ? { height: scrollHeight, minWidth: minPlotWidth } : undefined;
  const plot = hasPlot
    ? <div className="chart-plot" ref={attachNode} data-testid="chart-plot" style={surfaceStyle}/>
    : onDrawingSurfaceChange ? <div className="chart-plot chart-surface-placeholder" aria-hidden="true" style={surfaceStyle}/>
    : problem;
  if (!scrolling || (!measured && !hasPlot)) return plot;
  const viewportClass = 'chart-scroll-viewport' + (measured ? ' chart-scroll-viewport--measured' : '')
    + (measureOverflow && overflows ? ' chart-scroll-viewport--touch-scroll' : '')
    + (minPlotWidth ? ' chart-scroll-viewport--wide' : '');
  // Plotly handles a tap on touchend. A second synthetic mouse sequence clears its hover label.
  return <>{onDrawingSurfaceChange && problem}<div className={viewportClass} ref={observeViewport}
    onTouchEnd={coarseScroll && !inspectSankeyOnTouch ? event => event.preventDefault() : undefined}>{plot}</div></>;
}
