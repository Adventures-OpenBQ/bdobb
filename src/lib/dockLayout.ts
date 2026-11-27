// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { CardLayout } from "./types";

const overlaps = (a: CardLayout, b: CardLayout) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Where a new w×h card goes in a band of `maxRows` rows: the first row-major
 * spot free of every existing card. If it does not fit at that size, it is
 * shrunk to the largest free rectangle no bigger than w×h (the first in
 * row-major order when two are equal), so it always lands inside the band:
 * the band's grid does not compact, and a card saved below the last row
 * cannot be resized or dragged back in. Only a band with no free cell at all
 * falls back to the origin, where the editor is the place to make room.
 * ponytail: brute-force scan, O(rows²·cols²·cards) at worst; a dock holds a
 * handful of cards on 40×24 cells. A summed-area table if that ever shows.
 */
export function firstFreeSpot(cards: readonly CardLayout[], w: number, h: number, cols: number, maxRows: number): CardLayout {
  const cw = Math.max(1, Math.min(cols, w));
  const ch = Math.max(1, Math.min(maxRows, h));
  const free = (spot: CardLayout) => !cards.some((c) => overlaps(spot, c));
  let best: CardLayout | null = null;
  for (let y = 0; y < maxRows; y++) {
    for (let x = 0; x < cols; x++) {
      const full = { x, y, w: cw, h: ch };
      if (x + cw <= cols && y + ch <= maxRows && free(full)) return full;
      for (let sw = Math.min(cw, cols - x); sw >= 1; sw--) {
        for (let sh = Math.min(ch, maxRows - y); sh >= 1; sh--) {
          // Shorter rectangles at this width are smaller still.
          if (best && sw * sh <= best.w * best.h) break;
          const spot = { x, y, w: sw, h: sh };
          if (free(spot)) {
            best = spot;
            break;
          }
        }
      }
    }
  }
  return best ?? { x: 0, y: 0, w: cw, h: ch };
}
