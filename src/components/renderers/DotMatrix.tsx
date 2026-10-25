// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { glyph } from "../../lib/dotFont";

const ROWS = 7;
const GAP = 1; // one blank column between characters
const R = 0.42; // dot radius, in cell units (cells are 1x1)

/**
 * Renders a string as an SVG grid of individual dots, one 5x7 glyph per
 * character (see dotFont) -- the clock's digital face as a real dot-matrix
 * panel, not a typeface. Colour comes from `currentColor` (the clock sets it
 * to the phosphor green), so lit dots inherit it and off dots are the same
 * colour dimmed by CSS.
 *
 * Two faces, one renderer: `dots` draws every cell so the whole grid is
 * visible (off cells dim), the way a real matrix panel looks; `solid` draws
 * only the lit cells, so the digits float with no visible grid.
 */
export function DotMatrix({
  text,
  face,
  className,
}: {
  text: string;
  face: "dots" | "solid";
  className?: string;
}) {
  const cells: { x: number; y: number; on: boolean }[] = [];
  let cursor = 0;
  for (const ch of [...text]) {
    const g = glyph(ch);
    const cols = g[0]?.length ?? 0;
    for (let r = 0; r < g.length; r++) {
      for (let c = 0; c < cols; c++) {
        const on = g[r][c];
        if (!on && face === "solid") continue; // solid face omits the off dots
        cells.push({ x: cursor + c, y: r, on });
      }
    }
    cursor += cols + GAP;
  }
  const width = Math.max(0, cursor - GAP); // no trailing gap

  return (
    <svg
      className={className}
      viewBox={`0 0 ${width} ${ROWS}`}
      role="img"
      aria-label={text}
      preserveAspectRatio="xMinYMid meet"
    >
      {cells.map((d, i) => (
        <circle
          key={i}
          className={d.on ? "dot" : "dot dot--off"}
          cx={d.x + 0.5}
          cy={d.y + 0.5}
          r={R}
          fill="currentColor"
        />
      ))}
    </svg>
  );
}
