// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
import { useState } from "react";
import { moveBefore } from "../../../lib/dragDrop";
import { seriesLabel } from "../../../lib/chart/series";
import type { Series } from "../../../lib/types";

/**
 * Defined where the drag originates, as TAB_REORDER_DRAG_TYPE is in
 * TabBar.tsx. The payload is the chip's series id, nothing else (v12.4.0:
 * the expression was the identity while every chip was a study, and two
 * performance lines can share one).
 *
 * Distinct from every other drag type in the app for the usual reason: a tab
 * or a widget dragged across this strip matches neither the type check below
 * nor any handler here, so it is inert, and a chip dragged out over the rail
 * is inert there.
 */
export const STUDY_REORDER_DRAG_TYPE = "application/x-bdobb-study";

function carriesStudy(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes(STUDY_REORDER_DRAG_TYPE);
}

/**
 * The Candlestick pill's marker (user, 2026-10-01: "use this as the icon in the
 * candlestick series pill"). Every other pill marks itself with a bar in its
 * series colour, but a candlestick has no one colour -- it is up AND down --
 * so its bar painted nothing and the pill had no marker at all. This draws a
 * candle on its side instead: the up colour's wick and half of the body on the
 * left, the down colour's on the right, split on the diagonal.
 *
 * No colour is named here: the halves carry `up`/`down` classes and styles.css
 * paints them with the theme's `--up`/`--down`, the same tokens the candles on
 * the chart are drawn in, so the icon always matches them. Decorative -- the
 * pill's own text already says "Candlestick".
 */
function CandleIcon() {
  return (
    <svg className="chart-candle-icon" viewBox="0 0 22 12" aria-hidden="true">
      <path className="up" d="M5 1.5h12L5 10.5z" fillOpacity={0.35} stroke="none" />
      <path className="down" d="M17 1.5v9H5z" fillOpacity={0.35} stroke="none" />
      <path className="up" d="M0.75 6H5M17 1.5H6.25A1.25 1.25 0 0 0 5 2.75V10.5" fill="none" />
      <path className="down" d="M17 6h4.25M5 10.5h10.75A1.25 1.25 0 0 0 17 9.25V1.5" fill="none" />
    </svg>
  );
}

/**
 * The Volume pill's marker (user, 2026-10-01: "for volume do a vertical green
 * next to a slightly shorter vertical red"). Volume has no one colour either --
 * its bars take the up or down colour of their candle -- so its bar marker was
 * blank for the same reason the Candlestick one was. Two bars standing on a
 * shared baseline, the way volume reads on the chart; same `up`/`down`
 * classes and tokens as CandleIcon.
 */
function VolumeIcon() {
  return (
    <svg className="chart-volume-icon" viewBox="0 0 12 12" aria-hidden="true">
      <rect className="up" x="1.5" y="1" width="3.5" height="10" rx="0.75" />
      <rect className="down" x="7" y="3.5" width="3.5" height="7.5" rx="0.75" />
    </svg>
  );
}

type Props = {
  /** Everything the card draws (v12.4.0), not just its studies. */
  series: Series[];
  /**
   * What the socket reported, keyed by `expr`: the source that ACTUALLY
   * served each series. An instance the socket has not answered on yet is
   * simply absent, and carries no parity mark either way.
   */
  served: Record<string, "local" | "eodhd">;
  /**
   * The CHART's one source (v12.3.1 ruling): the parity marks only mean
   * anything on an EODHD chart -- a Local chart is served locally by
   * definition and carries no mark.
   */
  source: "local" | "eodhd";
  /**
   * Why a series is not on the chart, keyed by series id (v12.4.0): an
   * anchor that resolves to nothing, a `$group:<Name>` naming no group or
   * one of the wrong kind. The same reading a study left off the wire gets
   * -- the chip stays, so the user can edit it, and says what is wrong.
   */
  notes?: Record<string, string>;
  /** A chip's label when it is not the series' own (spec 2026-11-13): "MSFT Candlestick". */
  labels?: Record<string, string>;
  /** Whether chips carry their `P<n>·L/R` prefix: only once the card has more than one panel. */
  showPanels: boolean;
  onReorder: (ids: string[]) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  activePreset: string | null;
};

/**
 * The chip strip under the chart (studies addendum §5.4, §6; v12.4.0's
 * panels and series): one chip per SERIES -- the candles, the volume, a
 * performance line and every study -- in panel order, then series order,
 * which is the order the legend reads in too. The chips drag, with the same
 * HTML5 idiom the tab strip uses; a drag only reorders WITHIN a panel (a
 * chip's panel is a property of the series, changed in the palette, not by
 * dropping it on another panel's chip).
 */
export function StudiesStrip({
  series, served, source, notes = {}, labels = {}, showPanels, onReorder, onEdit, onRemove, activePreset,
}: Props) {
  /** The id being dragged, for the .35 dim; cleared on drop or dragend. */
  const [dragging, setDragging] = useState<string | null>(null);

  // Panel order, then the card's own order within a panel -- the spec's
  // reading order for both the strip and the legend. A stable sort, so two
  // series in one panel keep the order the card has them in.
  const shown = [...series].sort((a, b) => a.panel - b.panel);

  function drop(e: React.DragEvent, target: Series) {
    e.preventDefault();
    setDragging(null);
    const draggedId = e.dataTransfer.getData(STUDY_REORDER_DRAG_TYPE);
    if (!draggedId || draggedId === target.id) return;
    const ids = series.map((s) => s.id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(target.id);
    // A stale payload -- a chip removed while the drag was in flight -- is a
    // silent no-op, as the tab strip's own -1 guard is.
    if (from === -1 || to === -1) return;
    // Within a panel only: a drop on another panel's chip would otherwise
    // reorder the list into an order the strip cannot show (it groups by
    // panel), and would read as "this moved the series to that panel",
    // which it does not.
    if (series[from]?.panel !== target.panel) return;
    onReorder(moveBefore(ids, from, to));
  }

  return (
    <div className="chart-studies" role="list" aria-label="Series">
      <span className="chart-studies-label">Series</span>
      {shown.map((s) => {
        const label = labels[s.id] ?? seriesLabel(s);
        const actual = served[s.expr];
        const note = notes[s.id];
        return (
          // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the chip is a list item that is ALSO the only handle on the editor (see onKeyDown below); ARIA has no role for that, and role="button" would take the chip out of the list the strip announces
          <div
            key={s.id}
            className="chart-chip"
            role="listitem"
            draggable
            data-dragging={dragging === s.id ? "true" : undefined}
            onDragStart={(e) => {
              e.dataTransfer.setData(STUDY_REORDER_DRAG_TYPE, s.id);
              // Without effectAllowed the cursor shows a copy badge.
              e.dataTransfer.effectAllowed = "move";
              setDragging(s.id);
            }}
            onDragEnd={() => setDragging(null)}
            // Without preventDefault the browser fires no drop at all;
            // gating it on the type refuses everything else.
            onDragOver={(e) => { if (carriesStudy(e)) e.preventDefault(); }}
            onDrop={(e) => { if (carriesStudy(e)) drop(e, s); }}
            onDoubleClick={() => onEdit(s.id)}
            // The editor is the only route to an instance's width and
            // colour (the expression grammar carries colour but not the
            // width, and the popover's catalog click takes the defaults),
            // so a double-click-only chip leaves a keyboard user unable to
            // reach either. Enter opens it, Delete removes --
            // the × stays for the mouse. Reorder is still drag-only, the
            // same gap TabBar has.
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- as above: the chip has to take focus to take those keys at all
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter") onEdit(s.id);
              else if (e.key === "Delete" || e.key === "Backspace") onRemove(s.id);
              else return;
              // Backspace on a focused chip must not navigate back, and
              // Enter must not reach the card's own key map.
              e.preventDefault();
            }}
          >
            {s.type === "candlestick" ? <CandleIcon />
              : s.type === "volume" ? <VolumeIcon />
              : <span className="chart-study-dot" style={{ background: s.color }} />}
            {showPanels && <span className="chart-chip-where">P{s.panel}·{s.side === "left" ? "L" : "R"}</span>}
            {label}
            {source === "eodhd" && actual === "eodhd" && (
              <sup className="chart-parity" title="matches EODHD's own value within 2e-4">EODHD</sup>
            )}
            {source === "eodhd" && actual === "local" && (
              <sup className="chart-parity chart-parity-local" title="EODHD could not serve this; computed locally">local</sup>
            )}
            {note === undefined ? null : <span className="chart-chip-note">{note}</span>}
            {/* onDoubleClick stops the bubble: a fast double-press on × would
                otherwise also reach the chip's onDoubleClick and reopen the
                editor for a study this same press just removed. */}
            <button type="button" aria-label={`Remove ${label}`} onClick={() => onRemove(s.id)} onDoubleClick={(e) => e.stopPropagation()}>×</button>
          </div>
        );
      })}
      {/* A bundle is the whole card's SERIES now, studies included (T7
          review, finding 4): "saved study" named the wrong thing. */}
      {activePreset !== null && (
        <span className="chart-studies-note">saved series: &quot;{activePreset}&quot; — recallable on any chart</span>
      )}
    </div>
  );
}
