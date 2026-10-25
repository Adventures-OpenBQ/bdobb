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
    expect(firstFreeSpot(row, 20, 9, 40, 8)).toEqual({ x: 0, y: 0, w: 20, h: 8 });
    expect(firstFreeSpot([], 50, 2, 40, 8)).toEqual({ x: 0, y: 0, w: 40, h: 2 });
  });
  it("falls back to the origin when nothing fits", () => {
    expect(firstFreeSpot([{ x: 0, y: 0, w: 40, h: 8 }], 10, 4, 40, 8)).toEqual({ x: 0, y: 0, w: 10, h: 4 });
  });
});
