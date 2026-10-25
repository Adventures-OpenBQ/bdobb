// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { glyph } from "./dotFont";

describe("glyph", () => {
  it("returns a 7-row, 5-column grid for every digit with at least one lit cell", () => {
    for (const ch of "0123456789") {
      const g = glyph(ch);
      expect(g).toHaveLength(7);
      for (const row of g) expect(row).toHaveLength(5);
      expect(g.flat().filter(Boolean).length).toBeGreaterThan(0);
    }
  });

  it("renders the colon as a narrow 1-column, 7-row grid", () => {
    const colon = glyph(":");
    expect(colon).toHaveLength(7);
    for (const row of colon) expect(row).toHaveLength(1);
    expect(colon.map((r) => r[0])).toEqual([false, false, true, false, true, false, false]);
  });

  it("pins the shape of the digit 1 (bottom serif)", () => {
    expect(glyph("1")[6]).toEqual([false, true, true, true, false]);
  });

  it("returns a blank 5-wide grid for an unknown char", () => {
    const g = glyph("Z");
    expect(g).toHaveLength(7);
    expect(g[0]).toHaveLength(5);
    expect(g.flat().some(Boolean)).toBe(false);
  });
});
