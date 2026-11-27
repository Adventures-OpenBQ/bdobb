// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { firstFreeSpot } from "./dockLayout";

describe("firstFreeSpot", () => {
  it("places the first card at the origin and the next beside it", () => {
    expect(firstFreeSpot([], 10, 4, 40, 8)).toEqual({ x: 0, y: 0, w: 10, h: 4 });
    expect(firstFreeSpot([{ x: 0, y: 0, w: 10, h: 4 }], 10, 4, 40, 8)).toEqual({ x: 10, y: 0, w: 10, h: 4 });
  });
  it("drops to the next row when the first is full, and clamps to the reserved rows", () => {
    const row = [{ x: 0, y: 0, w: 40, h: 4 }];
    expect(firstFreeSpot(row, 20, 4, 40, 8)).toEqual({ x: 0, y: 4, w: 20, h: 4 });
    // Too tall for the four rows left: cut to them, not laid over the first card.
    expect(firstFreeSpot(row, 20, 9, 40, 8)).toEqual({ x: 0, y: 4, w: 20, h: 4 });
    expect(firstFreeSpot([], 20, 9, 40, 8)).toEqual({ x: 0, y: 0, w: 20, h: 8 });
    expect(firstFreeSpot([], 50, 2, 40, 8)).toEqual({ x: 0, y: 0, w: 40, h: 2 });
  });
  it("falls back to the origin when nothing fits", () => {
    expect(firstFreeSpot([{ x: 0, y: 0, w: 40, h: 8 }], 10, 4, 40, 8)).toEqual({ x: 0, y: 0, w: 10, h: 4 });
  });
  it("shrinks a card that does not fit to the largest free space, never below the band", () => {
    // A 16-wide card fills the left of a 12-row band; a full-width card takes the 24 columns beside it.
    const left = [{ x: 0, y: 0, w: 16, h: 12 }];
    expect(firstFreeSpot(left, 40, 8, 40, 12)).toEqual({ x: 16, y: 0, w: 24, h: 8 });
    // Free space under a short card: the wider of the two free areas wins, cut to the rows left.
    expect(firstFreeSpot([{ x: 0, y: 0, w: 40, h: 5 }], 40, 8, 40, 8)).toEqual({ x: 0, y: 5, w: 40, h: 3 });
    // Equal areas: the first one in reading order.
    const middle = [{ x: 10, y: 0, w: 20, h: 8 }];
    expect(firstFreeSpot(middle, 40, 8, 40, 8)).toEqual({ x: 0, y: 0, w: 10, h: 8 });
    // The spot is always inside the band and clear of every card.
    for (const cards of [left, middle]) {
      const spot = firstFreeSpot(cards, 40, 24, 40, 12);
      expect(spot.y + spot.h).toBeLessThanOrEqual(12);
      expect(spot.x + spot.w).toBeLessThanOrEqual(40);
    }
  });
});
