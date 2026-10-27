// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createChartEx } from "lightweight-charts";
import type {
  IChartApi, IHorzScaleBehavior, ISeriesApi, SeriesType, Time, UTCTimestamp,
} from "lightweight-charts";
import type { ChartTheme } from "../../../lib/chart/createChartTheme";
import { encodePanels, panelRect, type PanelDef } from "../../../lib/chart/panels";
import { axisPlans, labelFormatter, newLabelSearch, stepLabelSearch, type LabelSearch } from "../../../lib/chart/axisAlign";
import { watermarkStyle } from "../../../lib/chart/watermark";
import {
  applyYLinks, clampRange, syncCrosshair, syncTimeScales, type Range, type Side,
} from "../../../lib/chart/panelSync";

/**
 * The panel host (v12.4.0, spec: panels and series). A card's chart is no
 * longer ONE lightweight-charts instance with stacked panes: it is one
 * instance per panel, each absolutely positioned by percentages of the card
 * body, sharing a time axis and a crosshair through `panelSync`. This
 * component owns exactly that -- the divs, the instances, the sync, the
 * `xs`/`xe` sub-windows and the `ymin`/`ymax` links. It draws no series of
 * its own: the renderer receives the live handles through `onReady` and
 * attaches everything a card shows to them.
 */

const SIDES: Side[] = ["left", "right"];

/** Which of a panel's two price scales carry a series. */
export type PanelSides = { left: boolean; right: boolean };

/** What a panel gets when the caller named no sides for it: the right axis alone. */
const RIGHT_ONLY: PanelSides = { left: false, right: true };

/**
 * `usedSides` padded to the panels it describes. The two arrays come from
 * the same render and should always agree, but a caller whose series list
 * and panel text disagree for one commit must get a documented answer
 * rather than a missing axis from a `??` buried at each read: a panel
 * nobody described carries the right scale, the one every chart has.
 */
export function normaliseSides(usedSides: PanelSides[], count: number): PanelSides[] {
  return Array.from({ length: count }, (_unused, i) => usedSides[i] ?? RIGHT_ONLY);
}

/** What the renderer gets for each panel, in panel order. */
export type PanelApi = {
  /** 1-based, as `P<n>` and a series' `panel` field count. */
  index: number;
  chart: IChartApi;
  def: PanelDef;
  /** The series this panel hangs the mirrored crosshair on; `null` removes it. */
  setCrosshairSeries: (series: ISeriesApi<SeriesType> | null) => void;
  /**
   * This panel's pixel rect inside the card body, read off the LIVE DOM.
   *
   * Read rather than recomputed from `PanelDef` + the measured body: the div
   * is the thing actually on screen, so a rect taken from it cannot disagree
   * with what the user is looking at, and it needs neither the body size nor
   * the current defs plumbed through a closure that would go stale.
   *
   * Null before layout, and null in jsdom -- `getBoundingClientRect` is all
   * zeroes there, which `composeLayout` discards anyway.
   */
  rect: () => { x: number; y: number; w: number; h: number } | null;
  /** Re-apply this panel's `xs`/`xe` sub-window -- call it once the bars are in. */
  applyWindow: () => void;
  /**
   * Re-impose EVERY panel's `ymin`/`ymax` link, reading each referenced
   * panel's price scale as it stands. The host runs this itself after every
   * shared range change; the renderer calls it after a pass that changed
   * what a scale would autoscale to (a `setData`, a series added or
   * removed). Idempotent and host-wide: calling it on one handle is calling
   * it for the card.
   */
  applyLinks: () => void;
};

export type PanelHostProps = {
  panels: PanelDef[];
  /** Per panel, in panel order: which price scales any series actually uses. */
  usedSides: PanelSides[];
  theme: ChartTheme;
  /** The theme's mode, which is what a flip changes: every chart is rebuilt on it. */
  mode: "light" | "dark";
  /** The shared local-time tick weighting; called once per chart. */
  timeScaleBehavior: () => IHorzScaleBehavior<Time>;
  /** `scaleOrder(panels).order`: a panel absent from it autoscales (it is on a cycle, or downstream of one). */
  order: number[];
  /** The loaded window, the fallback for an `xs`/`xe` that resolves to nothing. */
  window: { start: number | null; end: number | null };
  /** An `xs`/`xe` date expression to unix seconds, or null when it names nothing. */
  resolve: (expr: string) => number | null;
  onReady: (apis: PanelApi[]) => void;
  onDispose: () => void;
  children?: never;
};

/** The card-wide mark; see `watermarkStyle`. */
function ChartWatermark({ mode, theme }: { mode: "light" | "dark"; theme: ChartTheme }) {
  const { src, opacity, padding } = watermarkStyle(mode, theme);
  return <img className="chart-watermark" src={src} alt="" aria-hidden="true" style={{ opacity, padding }} />;
}

export function PanelHost(props: PanelHostProps) {
  const { panels, usedSides, theme, mode } = props;
  // Every prop the effects below read at CALL time rather than at effect
  // time -- the window, the resolver, the theme, the callbacks. Charts are
  // expensive to rebuild, so only the panel text and the theme mode may
  // trigger one; a new `resolve` identity must not. Written during render,
  // as NoteRenderer's does.
  const latest = useRef(props);
  latest.current = props;

  const root = useRef<HTMLDivElement | null>(null);
  const elements = useRef<(HTMLDivElement | null)[]>([]);
  const charts = useRef<IChartApi[]>([]);
  const [body, setBody] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  // React attaches a ref before it runs the effects of the same commit, so
  // the creation effect below normally finds every panel div waiting for
  // it. `awaiting` is the case where it does not: the effect gives up, and
  // must be brought BACK when the divs arrive -- it has already fired
  // `onDispose`, and a renderer left with no charts and no `onReady` would
  // never draw again. `mounted` is what brings it back.
  const awaiting = useRef(false);
  const [mounted, setMounted] = useState(0);
  const count = panels.length;
  // One stable callback per panel, remade only when the panel COUNT changes:
  // an inline arrow is a new ref on every render, and React would detach and
  // re-attach (and so re-arm this) each time.
  const attach = useMemo(
    () => Array.from({ length: count }, (_unused, i) => (node: HTMLDivElement | null) => {
      elements.current[i] = node;
      if (node !== null && awaiting.current) { awaiting.current = false; setMounted((n) => n + 1); }
    }),
    [count],
  );

  // The panels' canonical text: the charts are rebuilt when the GEOMETRY
  // changes, not when the renderer happens to hand over a new array.
  /** `queueAlign`, reachable from the build closure below (declared after it). */
  const queueAlignRef = useRef<() => void>(() => {});
  const key = useMemo(() => encodePanels(panels), [panels]);
  const sides = useMemo(() => normaliseSides(usedSides, count), [usedSides, count]);
  const sidesKey = useMemo(
    () => sides.map((s) => `${s.left ? "L" : ""}${s.right ? "R" : ""}`).join("|"),
    [sides],
  );

  // One chart per panel, plus everything whose lifetime is exactly this set
  // of charts: the sides a y-link currently holds, the crosshair series and
  // the sub-window bounds. All locals, so nothing can outlive the instances
  // it describes.
  useEffect(() => {
    const { panels: defs, theme: born, timeScaleBehavior, onReady } = latest.current;
    const nodes = defs.map((_def, i) => elements.current[i]);
    if (nodes.some((node) => node === null || node === undefined)) { awaiting.current = true; return; }
    // The TradingView credit does not ride on the canvas any more: it reads in
    // the card's status line as "Rendered by TradingView", linking to the
    // Lightweight Charts page. The licence asks for a link on the page
    // available to users and names `attributionLogo` as one way to satisfy
    // that, not the only one -- so the credit is still there, it just no
    // longer floats over panel 1's bars. StatusBar.tsx owns it now, and
    // src/lib/chart/attribution.test.ts is what keeps it honest.
    const created = nodes.map((node) => createChartEx(
      node as HTMLDivElement,
      timeScaleBehavior(),
      // minBarSpacing (v12.4.11): the library will not draw a bar narrower than
      // this, and its default of 0.5px caps a 1,200px card at ~2,400 bars --
      // so the 1m chip loaded a month of 5m bars (~4,000 with extended hours)
      // and showed the last nineteen days of it. Small enough for a month of
      // 1m bars (~20,000); the library draws sub-pixel bars as a solid band.
      { ...born.chart, timeScale: { ...born.chart.timeScale, minBarSpacing: 0.01 },
        layout: { ...born.chart.layout, attributionLogo: false } },
    ) as IChartApi);
    charts.current = created;

    const crosshairSeries: (ISeriesApi<SeriesType> | null)[] = defs.map(() => null);
    // `${panel}:${side}` for every scale a link currently holds. A held
    // scale has its autoscale OFF (setVisibleRange turns it off), so this
    // is also the list of scales to hand back when a link goes away.
    const held = new Set<string>();

    /** The sides this panel actually carries a series on, in `SIDES` order. */
    const sidesOf = (i: number): Side[] => {
      const used = normaliseSides(latest.current.usedSides, latest.current.panels.length)[i] ?? RIGHT_ONLY;
      return SIDES.filter((side) => used[side]);
    };

    /**
     * The ONE scale a link reads and writes: a `P<n>` names no side, so it
     * is the panel's right scale -- and a panel that only carries series on
     * the left, its left. The other side is left autoscaling (T5 fix round 1
     * re-review): writing the resolved range to both sides of a panel
     * carrying price right and volume left squashed the volume onto the
     * price's numbers.
     */
    const linkSide = (i: number): Side | null => [...sidesOf(i)].reverse()[0] ?? null;

    /**
     * A panel's y-range as its chart reports it: the library unions every
     * series on the scale for us, which is what a `P<n>` reference means by
     * "panel n's min and max". A scale with nothing on it reports nothing.
     */
    const rangeOf = (i: number): Range | null => {
      const chart = created[i];
      const side = linkSide(i);
      if (chart === undefined || side === null) return null;
      const range = chart.priceScale(side).getVisibleRange();
      return range === null ? null : { minValue: range.from, maxValue: range.to };
    };

    const applyLinks = (): void => {
      // Whatever brought us here (new bars, a zoom, a pan) can have changed a label's width.
      queueAlignRef.current();
      const { panels: current, order } = latest.current;
      // Every held scale goes back to autoscale FIRST, before anything is
      // read: a held scale reports the range it was forced to, so a panel
      // that borrows one edge and keeps its own on the other would freeze
      // at the first value it ever took. Releasing also IS the answer for a
      // link that has gone away (an edited `panels`, or a reference whose
      // panel has no range yet).
      // ponytail: the release is only as fresh as the library's own
      // invalidation -- a scale nothing has invalidated since (no new bars,
      // no zoom) reports its last range whatever its autoScale says. Every
      // caller of this runs on exactly such a change, so the case is
      // theoretical; a truly current read would need a recalculate the
      // library does not expose.
      for (const slot of held) {
        const [n, side] = slot.split(":");
        created[Number(n) - 1]?.priceScale(side as Side).applyOptions({ autoScale: true });
      }
      held.clear();
      const own = new Map<number, Range | null>(current.map((_def, i) => [i + 1, rangeOf(i)]));
      const next = applyYLinks(current, order, own);
      current.forEach((_def, i) => {
        // A panel missing from `applyYLinks` is one `order` left out -- on a
        // reference cycle or downstream of one -- and autoscales, which the
        // release above already left it doing.
        const range = next.get(i + 1) ?? null;
        const chart = created[i];
        const side = linkSide(i);
        if (range === null || chart === undefined || side === null) return;
        chart.priceScale(side).setVisibleRange({ from: range.minValue, to: range.maxValue });
        held.add(`${i + 1}:${side}`);
      });
    };

    // An `xs`/`xe` that resolves to nothing falls back to the loaded
    // window's edge, and a side left unset stays unbounded. `P<n>` (user
    // ruling 2026-09-24) takes panel n's own expression, followed through a
    // chain; a panel on the chain with none of its own contributes the edge
    // it is actually showing, which is the loaded window's. A loop yields
    // nothing, so the panel stays unbounded rather than pinned to a guess.
    const edgeOf = (key: "xs" | "xe", value: PanelDef[typeof key], seen: Set<number>): number | null => {
      const { resolve, window, panels } = latest.current;
      const fallback = key === "xs" ? window.start : window.end;
      if (value === undefined) return fallback;
      if (typeof value === "string") return resolve(value) ?? fallback;
      if (seen.has(value.ref)) return null;
      seen.add(value.ref);
      const target = panels[value.ref - 1];
      return target === undefined ? null : edgeOf(key, target[key], seen);
    };
    const boundsOf = (def: PanelDef): { from: number | null; to: number | null } => ({
      from: def.xs === undefined ? null : edgeOf("xs", def.xs, new Set()),
      to: def.xe === undefined ? null : edgeOf("xe", def.xe, new Set()),
    });

    const applyWindow = (i: number): void => {
      const def = latest.current.panels[i];
      const chart = created[i];
      if (def === undefined || chart === undefined) return;
      const { from, to } = boundsOf(def);
      if (from === null && to === null) return;
      const visible = chart.timeScale().getVisibleRange();
      const start = from ?? (visible === null ? null : Number(visible.from));
      const end = to ?? (visible === null ? null : Number(visible.to));
      if (start === null || end === null || start >= end) return;
      chart.timeScale().setVisibleRange({ from: start as UTCTimestamp, to: end as UTCTimestamp });
    };

    // Run after every mirrored range change, inside syncTimeScales' guard:
    // a sub-windowed panel pulls itself back into its subset, and that
    // correction is not mirrored back out to the panels showing it all.
    const clampAll = (): void => {
      created.forEach((chart, i) => {
        const def = latest.current.panels[i];
        if (def === undefined) return;
        const { from, to } = boundsOf(def);
        if (from === null && to === null) return;
        const visible = chart.timeScale().getVisibleRange();
        if (visible === null) return;
        const next = clampRange({ from: Number(visible.from), to: Number(visible.to) }, { from, to });
        if (next !== null) chart.timeScale().setVisibleRange({ from: next.from as UTCTimestamp, to: next.to as UTCTimestamp });
      });
    };

    // The links after the clamp, and both inside the mirror's guard: a
    // scroll or a zoom is exactly what changes what a scale autoscales to,
    // so it is also when a borrowed range goes out of date.
    const unsyncTime = syncTimeScales(created, () => { clampAll(); applyLinks(); });
    const unsyncCrosshair = syncCrosshair(created, (i) => crosshairSeries[i] ?? null);

    onReady(created.map((chart, i) => ({
      index: i + 1,
      chart,
      def: defs[i],
      setCrosshairSeries: (series: ISeriesApi<SeriesType> | null) => { crosshairSeries[i] = series; },
      rect: () => {
        const panel = elements.current[i];
        const host = root.current;
        if (panel === null || panel === undefined || host === null) return null;
        const mine = panel.getBoundingClientRect();
        const body = host.getBoundingClientRect();
        return { x: mine.left - body.left, y: mine.top - body.top, w: mine.width, h: mine.height };
      },
      applyWindow: () => { applyWindow(i); },
      applyLinks,
    })));
    // Once for the charts as built: a card whose panels are already linked
    // must not wait for the first scroll.
    applyLinks();

    return () => {
      // BEFORE the charts go: the renderer detaches its primitives (the
      // watermark, the band fills) in here, and
      // detachPrimitive against a removed chart throws. Read through the
      // ref like every other prop, so a renderer that hands over a fresh
      // closure each render still gets the current one.
      latest.current.onDispose();
      unsyncTime();
      unsyncCrosshair();
      for (const chart of created) chart.remove();
      charts.current = [];
    };
  }, [key, mode, mounted]);

  // A theme edit that is NOT a mode flip -- an accent, the grid, a font --
  // rebuilds nothing, so this is what carries it onto the live charts. The
  // adapter memoises its output, so this runs when the theme actually
  // changed.
  useEffect(() => {
    for (const chart of charts.current) chart.applyOptions(theme.chart);
  }, [theme]);

  // The card body's pixel size, which is all `panelRect` needs. jsdom (and
  // any browser predating it) defines no ResizeObserver, so the first
  // measure stands alone.
  useEffect(() => {
    const element = root.current;
    if (element === null) return;
    // A size that is not a finite number is no measurement at all: it made
    // `panelRect` return NaN and React refuse the panel's `top` (the
    // branch-end round, finding 11). Skipping the frame keeps the last good
    // layout until a real one arrives.
    const measure = (w: number, h: number): void => {
      if (!Number.isFinite(w) || !Number.isFinite(h)) return;
      setBody((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    const rect = element.getBoundingClientRect();
    measure(rect.width, rect.height);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box !== undefined) measure(box.width, box.height);
    });
    observer.observe(element);
    return () => { observer.disconnect(); };
  }, []);

  // Each chart fills its own div, which the render below has already
  // positioned; a re-measure moves the divs and resizes the charts in one
  // commit.
  useEffect(() => {
    charts.current.forEach((chart, i) => {
      const def = latest.current.panels[i];
      if (def === undefined) return;
      const rect = panelRect(def, body.w, body.h);
      // The SAME BARS stay on screen across a resize (user, 2026-09-27:
      // "bringing back the toolbar obscured part of the chart and did not
      // redraw"). The library keeps its bar SPACING when the plot narrows, so
      // a narrower plot simply holds fewer bars and the leftmost ones fall out
      // of view -- which is what showing the 48px rail did to the chart beside
      // it. Nothing put them back: the card's range is imposed by the
      // renderer's seed effect and by a range change, and a container resize
      // is neither.
      //
      // The LOGICAL range is the right thing to carry over, not the card's
      // range: it is in bar indices, so restoring it restores exactly the bars
      // that were showing -- including a pan or zoom the user made by hand,
      // which re-imposing the card's range would have thrown away on every
      // dashboard resize.
      //
      // Null when the chart holds no bars yet, and the time scale of an empty
      // chart is not a thing to touch -- setVisibleRange on one throws "Value
      // is null" (v12.3 defect, chart-range-chips). Skipped, and the seed
      // effect sets the view when the bars arrive.
      // Only on a WIDTH change from a width the chart actually had. Restoring
      // a range the chart already has still notifies the library's
      // subscribers, so the mount pass would broadcast one through the panel
      // mirror for nothing -- and the first measure is 0 -> W, where there
      // were no bars on screen to preserve in the first place. Height is not
      // carried: a shorter plot holds the same bars.
      const carry = widthBefore.current !== null && widthBefore.current > 0 && widthBefore.current !== body.w;
      const before = carry ? chart.timeScale().getVisibleLogicalRange() : null;
      chart.resize(rect.w, rect.h);
      if (before !== null) chart.timeScale().setVisibleLogicalRange(before);
    });
    widthBefore.current = body.w;
    // A resize re-lays the price scale's ticks, which can change a label's width.
    queueAlignRef.current();
  }, [body, key, mode]);

  // The axes. Which sides a panel shows, and how wide, is decided for the STACK it is in,
  // not for the panel alone (axisPlans): panels on one x axis must take the same pixels
  // off each side, or their time ticks cannot line up -- the owner's requirement.
  // `xmargin` says whether this panel carries the time axis at all.
  // ponytail: `xmargin` is read as visible/not, not as a height -- the
  // library has no setter for the time axis' height. The panel div is
  // `panelRect` tall and the axis takes its own height out of it; a real
  // height needs either a custom axis or the library growing one.
  //
  // `alignAxes` is the same plan with the widths the library ACTUALLY gave each axis fed
  // back in: `minimumWidth` is a floor, and an axis whose labels need more grows past it
  // on its own panel only. Those widths exist only once the library has painted, so the
  // pass is queued two frames out, and re-queued by everything that can change a label's
  // width: this effect, a resize, and every `applyLinks` (new bars, a zoom, a pan).
  /** The width the charts were last sized to; null until the first measure. */
  const widthBefore = useRef<number | null>(null);
  /** Per chart, the search for the finest price labels that fit its margin (axisAlign stepLabelSearch). */
  const labelSearches = useRef<LabelSearch[]>([]);
  /** Per chart, the label level the chart is actually SHOWING (undefined: unknown, so it is set before measuring). */
  const labelApplied = useRef<(number | undefined)[]>([]);
  /** Per chart, the order of magnitude its labels were fitted at: a new one re-opens the search. */
  const labelScale = useRef<number[]>([]);
  const alignAxes = useCallback((measure: boolean): void => {
    const { panels: current, usedSides: used } = latest.current;
    // Fresh charts, or a new margin: every panel starts again from the exact labels.
    if (!measure) { labelSearches.current = current.map(() => newLabelSearch()); labelScale.current = []; labelApplied.current = []; }
    let refit = false;
    const measured = charts.current.map((chart, i) => {
      const def = current[i];
      if (!measure || def === undefined || def.ymargin <= 0) return { left: 0, right: 0 };
      // FIT THE LABELS TO THE MARGIN (the owner's choice, 2026-09-21): the axis is the
      // pixels it was given and the text adapts. The library is the judge of what a label
      // takes -- a level is applied, painted, and its reported width read back here two
      // frames later -- and the search keeps the finest level that fits (axisAlign).
      const widths = { left: chart.priceScale("left").width(), right: chart.priceScale("right").width() };
      const range = chart.priceScale("right").getVisibleRange() ?? chart.priceScale("left").getVisibleRange();
      // Prices an order of magnitude away need different labels: fit again from the top.
      const scale = range === null ? 0 : Math.floor(Math.log10(Math.max(Math.abs(range.from), Math.abs(range.to), 1)));
      let search = labelSearches.current[i] ?? newLabelSearch();
      if (labelScale.current[i] !== scale) { search = newLabelSearch(); labelScale.current[i] = scale; }
      const apply = (level: number): void => {
        chart.applyOptions({ localization: { priceFormatter: labelFormatter(level, range) } });
        labelApplied.current[i] = level;
        refit = true; // what it takes is only known once it has been painted
      };
      // The chart is not showing the level under test yet: show it, measure next pass.
      if (labelApplied.current[i] !== search.level) {
        labelSearches.current[i] = search;
        apply(search.level);
        return { left: 0, right: 0 };
      }
      // `range` too: a level whose labels would read the same at every tick on THIS
      // range is skipped, so a symbol quoted near 1 keeps its decimals.
      const after = stepLabelSearch(search, Math.max(widths.left, widths.right), def.ymargin, range);
      labelSearches.current[i] = after;
      if (after.level !== search.level) apply(after.level);
      // Only an axis no labels could bring within its margin is reported: the library has
      // no maximum width, so the rest of its stack is widened to it and the ticks line up.
      return after.settled && after.overflow > 0
        ? { left: widths.left > def.ymargin ? widths.left : 0, right: widths.right > def.ymargin ? widths.right : 0 }
        : { left: 0, right: 0 };
    });
    const plans = axisPlans(current, normaliseSides(used, current.length), measured);
    charts.current.forEach((chart, i) => {
      const plan = plans[i];
      if (plan === undefined) return;
      for (const side of SIDES) {
        // Only a change is applied: applyOptions invalidates the pane, and this runs often.
        if (measure && (!plan[side].visible || chart.priceScale(side).width() === plan[side].minimumWidth)) continue;
        chart.priceScale(side).applyOptions(plan[side]);
      }
    });
    if (refit) queueAlignRef.current();
  }, []);
  const alignQueued = useRef(false);
  const queueAlign = useCallback((): void => {
    if (alignQueued.current) return;
    alignQueued.current = true;
    requestAnimationFrame(() => requestAnimationFrame(() => { alignQueued.current = false; alignAxes(true); }));
  }, [alignAxes]);
  queueAlignRef.current = queueAlign;
  useEffect(() => {
    alignAxes(false);
    charts.current.forEach((chart, i) => {
      const def = latest.current.panels[i];
      if (def !== undefined) chart.timeScale().applyOptions({ visible: def.xmargin > 0 });
    });
    queueAlign();
  }, [key, mode, sidesKey, alignAxes, queueAlign]);

  return (
    <div className="chart-panels" ref={root} style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* The mark, centred on the WHOLE card (owner, 2026-09-27), behind every
          panel. It used to be a pane primitive on panel 1's chart, which is
          the only place a pane primitive can be since each panel became its
          own chart. It reads through because the chart layout background is
          transparent by design. aria-hidden and pointer-events: none -- it is
          decoration, and the charts above it own every gesture. */}
      <ChartWatermark mode={mode} theme={theme} />
      {panels.map((def, i) => {
        const rect = panelRect(def, body.w, body.h);
        return (
          <div
            // Panels have no identity beyond their position, and any change
            // to the text rebuilds every chart anyway.
            key={i}
            role="presentation"
            data-panel={i + 1}
            ref={attach[i]}
            style={{ position: "absolute", left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
          />
        );
      })}
    </div>
  );
}
