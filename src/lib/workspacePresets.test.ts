// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, test } from "vitest";
import {
  PRESETS,
  type TilePlacement,
  freeSlotId,
  hiddenEntries,
  hiddenNote,
  isArrangement,
  largestFreeRect,
  placeTiles,
  readingOrder,
  reseat,
  slotId,
  swapTarget,
  swapTiles,
  tileLetter,
} from "./workspacePresets";

// Spec 2026-10-01 §1 and §4: arrangements, and the pure helpers every
// reader of one shares.
const tile = (slot: string, x: number, y: number, w: number, h: number): TilePlacement => ({ slot, x, y, w, h });
const entry = (slot: string, dashboardId: string) => ({ slot, dashboardId });
const known =
  (...ids: string[]) =>
  (s: { dashboardId: string }) =>
    ids.includes(s.dashboardId);
const FULL = PRESETS["full-screen"].tiles;
const LAPTOP = PRESETS.laptop.tiles;
/** Three equal columns: more tiles than either preset has. */
const THIRDS = [tile("a", 0, 0, 4, 12), tile("b", 4, 0, 4, 12), tile("c", 8, 0, 4, 12)];

describe("arrangements", () => {
  test("the two presets are arrangements, exactly as the spec's table gives them", () => {
    for (const [id, preset] of Object.entries(PRESETS)) expect(isArrangement(preset.tiles), id).toBe(true);
    expect(FULL).toEqual([tile("a", 0, 0, 12, 12)]);
    expect(LAPTOP).toEqual([tile("a", 0, 0, 6, 12), tile("b", 6, 0, 6, 12)]);
  });

  test("isArrangement refuses each broken rule", () => {
    expect(isArrangement([tile("a", 0, 0, 6, 12), tile("b", 6, 0, 6, 12)])).toBe(true);
    expect(isArrangement([]), "at least one tile").toBe(false);
    expect(isArrangement("a"), "a list").toBe(false);
    expect(isArrangement([tile("a", 0.5, 0, 6, 12)]), "integers").toBe(false);
    expect(isArrangement([tile("a", -1, 0, 6, 12)]), "x ≥ 0").toBe(false);
    expect(isArrangement([tile("a", 0, -1, 6, 6)]), "y ≥ 0").toBe(false);
    expect(isArrangement([tile("a", 7, 0, 6, 12)]), "x + w ≤ 12").toBe(false);
    expect(isArrangement([tile("a", 0, 7, 6, 6)]), "y + h ≤ 12").toBe(false);
    expect(isArrangement([tile("a", 0, 0, 1, 12)]), "at least 2 wide").toBe(false);
    expect(isArrangement([tile("a", 0, 0, 12, 1)]), "at least 2 tall").toBe(false);
    expect(isArrangement([tile("a", 0, 0, 6, 12), tile("a", 6, 0, 6, 12)]), "unique slot ids").toBe(false);
    expect(isArrangement([tile("a", 0, 0, 7, 12), tile("b", 6, 0, 6, 12)]), "no overlap").toBe(false);
    expect(isArrangement([{ x: 0, y: 0, w: 12, h: 12 }]), "a slot id").toBe(false);
  });

  test("readingOrder is top to bottom, then left to right", () => {
    const shuffled = [tile("d", 6, 6, 6, 6), tile("b", 6, 0, 6, 6), tile("c", 0, 6, 6, 6), tile("a", 0, 0, 6, 6)];
    expect(readingOrder(shuffled).map((t) => t.slot)).toEqual(["a", "b", "c", "d"]);
  });

  test("letters run A to Z, then AA, AB …; slot ids are the same in lower case", () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(tileLetter)).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA"]);
    expect(slotId(0)).toBe("a");
    expect(slotId(26)).toBe("aa");
  });

  test("placeTiles gives slot ids a, b, … in reading order", () => {
    expect(placeTiles([{ x: 6, y: 0, w: 6, h: 12 }, { x: 0, y: 0, w: 6, h: 12 }])).toEqual([
      tile("a", 0, 0, 6, 12),
      tile("b", 6, 0, 6, 12),
    ]);
  });
});

describe("reseat", () => {
  test("fewer tiles: the first in reading order is seated, the rest kept hidden under an id the new arrangement does not use", () => {
    expect(reseat(LAPTOP, [entry("a", "d1"), entry("b", "d2")], FULL, known("d1", "d2"))).toEqual([
      entry("a", "d1"),
      entry("b", "d2"),
    ]);
  });

  test("more tiles: dashboards fill tiles in reading order and the rest stay empty", () => {
    expect(reseat(FULL, [entry("a", "d1")], LAPTOP, known("d1"))).toEqual([entry("a", "d1")]);
  });

  test("an empty tile contributes nothing, so a later dashboard moves up", () => {
    expect(reseat(LAPTOP, [entry("b", "d2")], LAPTOP, known("d2"))).toEqual([entry("a", "d2")]);
  });

  test("hidden dashboards come after the shown ones, in the order their entries are stored", () => {
    const slots = [entry("a", "d1"), entry("x", "d3"), entry("b", "d2")];
    expect(reseat(FULL, slots, THIRDS, known("d1", "d2", "d3"))).toEqual([
      entry("a", "d1"),
      entry("b", "d3"),
      entry("c", "d2"),
    ]);
  });

  test("reading order, not slot id, decides who goes first", () => {
    const swapped = [tile("b", 0, 0, 6, 12), tile("a", 6, 0, 6, 12)];
    expect(reseat(swapped, [entry("a", "d1"), entry("b", "d2")], FULL, known("d1", "d2"))).toEqual([
      entry("a", "d2"),
      entry("b", "d1"),
    ]);
  });

  // Supersedes v5.6.0 (spec §4; the plan's ruling R7): the right-hand dashboard
  // comes back in reading order, not to the right-hand tile.
  test("Laptop → Full Screen → Laptop brings B's dashboard back on the left", () => {
    const full = reseat(LAPTOP, [entry("b", "d2")], FULL, known("d2"));
    expect(reseat(FULL, full, LAPTOP, known("d2"))).toEqual([entry("a", "d2")]);
  });

  // A slot naming a deleted dashboard is an empty tile on screen, so it is
  // not seated; it is kept hidden rather than dropped (main's R5).
  test("a deleted dashboard's entry is neither seated nor counted, and is kept hidden", () => {
    expect(reseat(LAPTOP, [entry("a", "gone"), entry("b", "d2")], LAPTOP, known("d2"))).toEqual([
      entry("a", "d2"),
      entry("c", "gone"),
    ]);
  });
});

describe("hidden dashboards", () => {
  test("hiddenEntries is every counted entry the arrangement does not show, in stored order", () => {
    const slots = [entry("a", "d1"), entry("c", "gone"), entry("b", "d2")];
    expect(hiddenEntries(FULL, slots, known("d1", "d2"))).toEqual([entry("b", "d2")]);
  });

  test("hiddenNote counts, with the singular for one", () => {
    expect(hiddenNote(1)).toBe("1 dashboard not shown in this layout");
    expect(hiddenNote(3)).toBe("3 dashboards not shown in this layout");
  });
});

describe("free space", () => {
  test("a full grid has no room", () => {
    expect(largestFreeRect(LAPTOP)).toBeNull();
  });

  test("an empty grid is all room", () => {
    expect(largestFreeRect([])).toEqual({ x: 0, y: 0, w: 12, h: 12 });
  });

  test("one hole: the whole of it", () => {
    expect(largestFreeRect([tile("a", 0, 0, 4, 12), tile("b", 6, 0, 6, 12)])).toEqual({ x: 4, y: 0, w: 2, h: 12 });
  });

  test("a hole narrower than 2 is no room", () => {
    expect(largestFreeRect([tile("a", 0, 0, 5, 12), tile("b", 6, 0, 6, 12)])).toBeNull();
  });

  test("ties go to the one first in reading order", () => {
    const tiles = [tile("a", 0, 0, 2, 12), tile("b", 4, 0, 4, 12), tile("c", 10, 0, 2, 12)];
    expect(largestFreeRect(tiles)).toEqual({ x: 2, y: 0, w: 2, h: 12 });
  });

  test("freeSlotId is the first of a–z no tile and no slot entry uses", () => {
    expect(freeSlotId(LAPTOP, [entry("c", "d3")])).toBe("d");
    const all = "abcdefghijklmnopqrstuvwxyz".split("").map((s) => entry(s, "x"));
    expect(freeSlotId(LAPTOP, all)).toBeUndefined();
  });
});

// Spec 2026-10-01 §3 "Swapping": a move that ends with the dragged tile's
// centre inside another tile's rectangle -- as it was when the drag began --
// exchanges the two tiles' rectangles.
describe("swapping", () => {
  // a 0–4 wide, a free column 4–6, b 6–12.
  const GAPPED = [tile("a", 0, 0, 4, 12), tile("b", 6, 0, 6, 12)];
  // a tall on the left, b and c stacked on the right: two sizes to swap.
  const MIXED = [tile("a", 0, 0, 4, 12), tile("b", 4, 0, 8, 6), tile("c", 4, 6, 8, 6)];

  test("a centre inside another tile names that tile", () => {
    expect(swapTarget(LAPTOP, "a", { x: 9, y: 6 })).toBe("b");
  });

  test("a centre in free space names none", () => {
    expect(swapTarget(GAPPED, "a", { x: 5, y: 6 })).toBeNull();
  });

  test("a centre still inside the dragged tile's own old rectangle names none", () => {
    expect(swapTarget(LAPTOP, "a", { x: 4, y: 6 })).toBeNull();
  });

  // Main's R27: inside is strictly inside, so a centre exactly on an edge --
  // shared by two tiles, or between a tile and free space -- swaps with
  // neither.
  test("a centre exactly on an edge names none", () => {
    expect(swapTarget(LAPTOP, "a", { x: 6, y: 6 })).toBeNull();
    expect(swapTarget(GAPPED, "a", { x: 6, y: 6 })).toBeNull();
    expect(swapTarget(LAPTOP, "a", { x: 9, y: 12 })).toBeNull();
  });

  test("a centre off the grid names none", () => {
    expect(swapTarget(LAPTOP, "a", { x: 13, y: 6 })).toBeNull();
  });

  test("swapTiles exchanges position and size, moves nothing else, and leaves an arrangement", () => {
    const swapped = swapTiles(MIXED, "a", "b");
    expect(swapped.find((t) => t.slot === "a")).toEqual(tile("a", 4, 0, 8, 6));
    expect(swapped.find((t) => t.slot === "b")).toEqual(tile("b", 0, 0, 4, 12));
    // Every other tile is the same object.
    expect(swapped.find((t) => t.slot === "c")).toBe(MIXED[2]);
    // The same cells are covered as before, by the same two rectangles.
    expect(isArrangement(swapped)).toBe(true);
  });
});
