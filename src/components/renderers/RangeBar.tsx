// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { RangePalette } from "../../lib/tableColumns";

/**
 * The gradient each palette paints across the track.
 *
 * The two differ deliberately: a row carries a day range and a 52-week range
 * side by side, and at a glance two identically coloured bars read as one
 * repeated column. Red-yellow-green for the 52-week band, blue-white-orange
 * for the day.
 */
const PALETTES: Record<RangePalette, string> = {
  week52: "rgba(239,83,80,0.55) 0%, rgba(255,193,7,0.55) 50%, rgba(38,166,154,0.55) 100%",
  day: "rgba(66,133,244,0.55) 0%, rgba(200,200,200,0.35) 50%, rgba(255,152,0,0.60) 100%",
};

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * One row's range bar: a gradient track with the current value marked on it.
 *
 * Drawn in CSS rather than with a charting library, which is what makes it
 * cheap enough to put sixty of on screen under a 4Hz tick flush. There is no
 * redraw gate here and none is needed: a tick changes one inline `left`
 * percentage, and the browser composites that without React touching anything
 * else in the cell. The ends are NOT labelled here -- they are their own
 * columns beside this one, so the numbers line up down the grid and sort.
 */
export function RangeBar({
  low,
  high,
  value,
  palette = "week52",
}: {
  low: unknown;
  high: unknown;
  value: unknown;
  palette?: RangePalette;
}) {
  const lo = num(low);
  const hi = num(high);
  const at = num(value);
  // A zero-width range would divide by zero, and a bar whose ends are equal
  // is not a shorter bar -- it is an undrawable one.
  if (lo === null || hi === null || at === null || hi <= lo) return null;

  // Clamped, not dropped: a price that has printed outside a stale 52-week
  // band still belongs at the end of the bar rather than off it.
  const fraction = Math.max(0, Math.min(1, (at - lo) / (hi - lo)));

  return (
    <span className="cell-range">
      <span className="cell-range-track" style={{ background: `linear-gradient(90deg,${PALETTES[palette]})` }} />
      {/* The track is inset 4px each side, so the marker is placed against
          the TRACK's width, not the cell's -- otherwise f=0 and f=1 sit a few
          pixels outside the ends they are meant to mark. */}
      <span
        className="cell-range-marker"
        style={{ left: `calc(4px + (100% - 8px) * ${fraction})` }}
      />
    </span>
  );
}
