// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { CardLayout } from "./types";

const overlaps = (a: CardLayout, b: CardLayout) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Where a new w×h card goes in a band of `maxRows` rows: the first row-major
 * spot free of every existing card. Nothing fits → the origin; the grid's
 * vertical compaction pushes the others down and the editor is where the
 * user makes room. ponytail: O(rows·cols·cards) scan, a dock holds a handful.
 */
export function firstFreeSpot(cards: readonly CardLayout[], w: number, h: number, cols: number, maxRows: number): CardLayout {
  const cw = Math.max(1, Math.min(cols, w));
  const ch = Math.max(1, Math.min(maxRows, h));
  for (let y = 0; y + ch <= maxRows; y++) {
    for (let x = 0; x + cw <= cols; x++) {
      const spot = { x, y, w: cw, h: ch };
      if (!cards.some((c) => overlaps(spot, c))) return spot;
    }
  }
  return { x: 0, y: 0, w: cw, h: ch };
}
