// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
import { confirm } from "../../../host/dialog";
import { Fragment, useId, type ReactNode } from "react";

/** "panning" keeps its v12.2 name; the rail calls it Crosshair. */
export type ChartTool = "panning" | "anchor" | "segment" | "ray" | "fib" | "gann" | "level" | "measure";

/**
 * The rail's icons (layout pack, 2026-09-17): 16px line drawings on a 16-unit
 * grid, every stroke `currentColor` so the button's own state -- rest, hover,
 * pressed, disabled -- colours the glyph with it and no hex ever reaches a
 * component. `.chart-icon` in styles.css carries the size and the 1.5 stroke;
 * `w` is the pack's own weight for the icons it drew heavier or lighter
 * (segment and ray at 1.6, fib and gann at 1.4) -- inline, because a
 * presentation attribute would lose to the class rule.
 */
function Icon({ children, w }: { children: ReactNode; w?: number }) {
  return <svg className="chart-icon" viewBox="0 0 16 16" aria-hidden="true" style={w === undefined ? undefined : { strokeWidth: w }}>{children}</svg>;
}

/**
 * The rail's tools in order (spec §7.1), each with the gesture hint the
 * v12.2 toolbar carried (they document how the tool is used) and its key.
 */
const TOOLS: { tool: ChartTool; icon: ReactNode; title: string }[] = [
  { tool: "panning", icon: <Icon><path d="M8 1v5M8 10v5M1 8h5M10 8h5" /><circle cx="8" cy="8" r="1.6" /></Icon>, title: "Crosshair — C. Drag to pan and scale; shift-drag the price axis to slide it, alt-drag it to scale volume (alt-double-click resets); click a drawing, then Delete/Backspace to remove it" },
  { tool: "segment", icon: <Icon w={1.6}><path d="M3 13L13 3" /><circle cx="3" cy="13" r="1.4" fill="currentColor" stroke="none" /><circle cx="13" cy="3" r="1.4" fill="currentColor" stroke="none" /></Icon>, title: "Segment — S. Drag to draw a closed line" },
  { tool: "ray", icon: <Icon w={1.6}><path d="M3 12L14 4.5" strokeDasharray="2.5 2.5" /><circle cx="3" cy="12" r="1.4" fill="currentColor" stroke="none" /></Icon>, title: "Ray — R. Drag to fix a slope; the ray rides out to the live edge" },
  { tool: "fib", icon: <Icon w={1.4}><path d="M2 3h12M2 6.5h12M2 10h12M2 13.5h12" /><path d="M4 3v10.5" opacity=".45" /></Icon>, title: "Fib retracement — F. Drag from the swing start to the swing end" },
  { tool: "gann", icon: <Icon w={1.4}><path d="M3 13L14 2M3 13L14 6M3 13L14 10" /><circle cx="3" cy="13" r="1.3" fill="currentColor" stroke="none" /></Icon>, title: "Gann fan — G. One click on a swing point fans 30/45/60°" },
  { tool: "anchor", icon: <Icon><path d="M8 2v8" /><circle cx="8" cy="2.6" r="1.3" /><path d="M4.5 7.5c0 3 1.6 4.6 3.5 4.6s3.5-1.6 3.5-4.6M3.2 6.6l1.3 1.4 1.4-1.3M12.8 6.6l-1.3 1.4-1.4-1.3" /></Icon>, title: "VWAP anchor — V. Click to anchor an AVWAP at that time; stays armed" },
  // The pack has no level tool; a plain horizontal line is its own drawing.
  { tool: "level", icon: <Icon><path d="M2 8h12" /><circle cx="4" cy="8" r="1.3" fill="currentColor" stroke="none" /></Icon>, title: "Level — L. One click drops a support/resistance line" },
];

/** Clear asks only past this many drawings (spec §7.2). */
const CONFIRM_ABOVE = 3;

/**
 * Clear's confirm gate (spec §7.2), shared by the rail's own button and the
 * renderer's Delete/Backspace path so the keyboard shortcut cannot wipe a
 * chart the button would have asked about first.
 */
export async function confirmClear(drawingCount: number): Promise<boolean> {
  if (drawingCount > CONFIRM_ABOVE) {
    return confirm(`Clear all ${drawingCount} drawings on this chart?`, { title: "Clear drawings", kind: "warning", okLabel: "Clear", cancelLabel: "Cancel" });
  }
  return true;
}

/**
 * Why a tool is off. Only one reason exists today (v12.3.1): the anchored
 * VWAP's running totals come out of the kdb tick plane, so an EODHD chart
 * has nothing to extend a line from.
 */
const DISABLED_REASON = "needs the kdb tick plane";

export function ToolRail({
  tool, onSelect, magnet, onMagnet, canUndo, onUndo, canRedo, onRedo, onClear, drawingCount, hasRita, hideRita, onToggleRita,
  disabled = [],
}: {
  tool: ChartTool; onSelect: (tool: ChartTool) => void;
  magnet: boolean; onMagnet: () => void;
  canUndo: boolean; onUndo: () => void; canRedo: boolean; onRedo: () => void;
  onClear: () => void; drawingCount: number;
  hasRita: boolean; hideRita: boolean; onToggleRita: () => void;
  /** Tools this chart cannot serve; the renderer's key map skips them too. */
  disabled?: ChartTool[];
}) {
  const clear = async () => {
    if (await confirmClear(drawingCount)) onClear();
  };
  /**
   * The hint is `data-tip` (drawn by `[data-tip]` in styles.css, at once, on
   * hover or keyboard focus) and, for assistive tech, an `aria-describedby`
   * span -- the same pair ADJ uses in ChartControls. It used to be `title`,
   * which the browser shows only after the pointer has rested about a second
   * and which the OS draws small and pale (owner, 2026-09-27: "never did the
   * tooltips over the chart tools icons" -- they were there, and hard to
   * notice). `title` cannot stay beside the drawn hint: the browser would
   * show both.
   */
  const tip = useId();
  const hint = (key: string, text: string) => ({
    props: { "data-tip": text, "aria-describedby": `${tip}-${key}` },
    node: <span id={`${tip}-${key}`} className="chart-sr-only">{text}</span>,
  });
  const button = (entry: { tool: ChartTool; icon: ReactNode; title: string }) => {
    const off = disabled.includes(entry.tool);
    const h = hint(entry.tool, off ? `${entry.title} — ${DISABLED_REASON}` : entry.title);
    // The reason is APPENDED, so the aria-label (everything before the first
    // " — ") stays the tool's name and the hint arrives with the tooltip.
    //
    // `aria-disabled`, not the `disabled` attribute: a native `disabled`
    // button drops out of the tab order (and out of some screen readers'
    // reach entirely), which would make the reason in `title` -- the
    // element's accessible description, per HTML-AAM, once nothing else
    // claims that role -- unreachable without a mouse. Staying focusable
    // keeps that description reachable; the click is still a no-op.
    // The span sits BESIDE the button, as ADJ's does: inside, it would join
    // the accessible name of any button that has no aria-label, and it would
    // be content in a box that is meant to hold one icon.
    return (
      <Fragment key={entry.tool}>
        <button
          type="button" aria-disabled={off || undefined}
          aria-pressed={tool === entry.tool} aria-label={entry.title.split(" — ")[0]}
          {...h.props}
          onClick={() => { if (!off) onSelect(entry.tool); }}
        >
          {entry.icon}
        </button>
        {h.node}
      </Fragment>
    );
  };
  return (
    <div className="chart-rail" role="toolbar" aria-label="Chart tools" aria-orientation="vertical">
      {TOOLS.map(button)}
      <div className="chart-rail-sep" />
      {button({ tool: "measure", icon: <Icon><rect x="1.5" y="5.5" width="13" height="5" rx="1" /><path d="M4.5 5.5v2M7 5.5v2.8M9.5 5.5v2M12 5.5v2.8" /></Icon>, title: "Measure — M. Drag a rectangle to read Δprice, bars and duration; the next click dismisses it" })}
      <button type="button" aria-pressed={magnet} aria-label="Magnet" {...hint("magnet", "Magnet — ⌘M. Drawing endpoints snap to the nearest bar's open, high, low or close").props} onClick={onMagnet}>
        <Icon><path d="M4 2v5.5a4 4 0 008 0V2" /><path d="M4 2h2.5M9.5 2H12" /></Icon>
      </button>{hint("magnet", "Magnet — ⌘M. Drawing endpoints snap to the nearest bar's open, high, low or close").node}
      <div className="chart-rail-spacer" />
      {/* Rita's proposed levels, shown or hidden; Keep and Discard stay below either way. */}
      <button type="button" aria-pressed={hasRita && !hideRita} aria-label="Rita levels" disabled={!hasRita} {...hint("rita", "Show or hide Rita's proposed levels on the chart").props} onClick={onToggleRita}>
        <Icon><path d="M8 1.8L14.2 8 8 14.2 1.8 8z" /></Icon>
      </button>{hint("rita", "Show or hide Rita's proposed levels on the chart").node}
      <button type="button" aria-label="Undo" {...hint("undo", "Undo — ⌘Z. Take back the newest drawing, level or anchor").props} disabled={!canUndo} onClick={onUndo}>
        <Icon><path d="M3 6h6a4 4 0 010 8H6" /><path d="M5.5 3.5L3 6l2.5 2.5" /></Icon>
      </button>{hint("undo", "Undo — ⌘Z. Take back the newest drawing, level or anchor").node}
      {/* Undo's path mirrored about x = 8, which is what "redo" looks like. */}
      <button type="button" aria-label="Redo" {...hint("redo", "Redo — ⇧⌘Z. Put back what undo took").props} disabled={!canRedo} onClick={onRedo}>
        <Icon><path d="M13 6H7a4 4 0 000 8h3" /><path d="M10.5 3.5L13 6l-2.5 2.5" /></Icon>
      </button>{hint("redo", "Redo — ⇧⌘Z. Put back what undo took").node}
      <button type="button" aria-label="Clear drawings" {...hint("clear", "Clear drawings — ⌫. Forget every drawing, level and anchor on this card").props} onClick={() => void clear()}>
        <Icon><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M6.8 7v3.5M9.2 7v3.5" /></Icon>
      </button>{hint("clear", "Clear drawings — ⌫. Forget every drawing, level and anchor on this card").node}
    </div>
  );
}
