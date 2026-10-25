// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord } from "./isRecord";

/**
 * A tile's place on a workspace's 12 × 12 grid (spec
 * docs/superpowers/specs/2026-10-01-workspace-arrange-design.md §1). Units
 * are twelfths of the workspace area's width and height, never pixels, so an
 * arrangement rescales with the window in both directions.
 */
export type TileRect = { x: number; y: number; w: number; h: number };

/** A tile and the slot id its dashboard is filed under in `Workspace.slots`. */
export type TilePlacement = TileRect & { slot: string };

/** Columns, and rows: the grid always spans the whole workspace area. */
export const GRID_SIZE = 12;

/** The smallest tile, in grid units each way. */
export const MIN_TILE = 2;

/**
 * The built-in arrangements a workspace can take, each a list of tiles on
 * the 12 × 12 grid (spec 2026-10-01 §1). They are starting points: a
 * workspace arranged by hand carries its own `layout` and keeps `preset` as
 * one of these ids (workspacesFile.ts). The renderer, the validator and the
 * rail's menu all read this table rather than knowing any preset by name, so
 * adding one -- the iPad preset at v7, say -- is one entry here and nothing
 * else in the app.
 */
export const PRESETS = {
  "full-screen": {
    name: "Full Screen",
    tiles: [{ slot: "a", x: 0, y: 0, w: 12, h: 12 }],
  },
  laptop: {
    name: "Laptop",
    tiles: [
      { slot: "a", x: 0, y: 0, w: 6, h: 12 },
      { slot: "b", x: 6, y: 0, w: 6, h: 12 },
    ],
  },
} as const satisfies Record<string, { name: string; tiles: readonly TilePlacement[] }>;

export type PresetId = keyof typeof PRESETS;

/**
 * Used by the file validator, so a workspaces file written by a LATER
 * release — one naming a preset this build has never heard of — is refused
 * whole rather than rendered with no tiles at all.
 */
export function isPresetId(value: unknown): value is PresetId {
  return typeof value === "string" && Object.hasOwn(PRESETS, value);
}

/** A whole-number tile inside the grid and at least MIN_TILE each way. */
function isTileRect(value: unknown): value is TileRect {
  if (!isRecord(value)) return false;
  const { x, y, w, h } = value;
  if (![x, y, w, h].every((n) => Number.isInteger(n))) return false;
  const r = { x, y, w, h } as TileRect;
  return (
    r.x >= 0 &&
    r.y >= 0 &&
    r.w >= MIN_TILE &&
    r.h >= MIN_TILE &&
    r.x + r.w <= GRID_SIZE &&
    r.y + r.h <= GRID_SIZE
  );
}

/** True when two rectangles share a cell. Edges that only touch do not overlap. */
export function overlaps(a: TileRect, b: TileRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * The one decision on what an arrangement is (spec §1), for the file
 * validator, the store and Arrange mode alike: at least one tile; every tile
 * whole-numbered, inside the grid and at least 2 × 2; slot ids unique; no
 * two tiles overlapping.
 */
export function isArrangement(value: unknown): value is TilePlacement[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  if (!value.every((t) => isTileRect(t) && typeof (t as { slot?: unknown }).slot === "string")) return false;
  const tiles = value as TilePlacement[];
  if (new Set(tiles.map((t) => t.slot)).size !== tiles.length) return false;
  return tiles.every((a, i) => tiles.slice(i + 1).every((b) => !overlaps(a, b)));
}

/**
 * Top to bottom, then left to right. The letter a tile shows on an Arrange
 * cover is its place in this order, never its slot id (spec §1). A copy; the
 * input is not sorted.
 */
export function readingOrder<T extends TileRect>(tiles: readonly T[]): T[] {
  return [...tiles].sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * A, B, … Z, then AA, AB, … as a spreadsheet's columns run. An arrangement
 * made in the app has at most 26 tiles (Add tile stops at z); a hand-edited
 * file can hold up to 36, and must still get a letter each.
 */
export function tileLetter(index: number): string {
  const letter = String.fromCharCode(65 + (index % 26));
  return index < 26 ? letter : tileLetter(Math.floor(index / 26) - 1) + letter;
}

/** The slot id for the `index`th tile when ids are handed out in order: a, b, … */
export function slotId(index: number): string {
  return tileLetter(index).toLowerCase();
}

/** Rectangles as tiles, slot ids a, b, … in reading order -- how a saved layout is applied (spec §4). */
export function placeTiles(rects: readonly TileRect[]): TilePlacement[] {
  return readingOrder(rects).map(({ x, y, w, h }, n) => ({ slot: slotId(n), x, y, w, h }));
}

/**
 * The slot entries an arrangement does not show, in the order they are
 * stored, keeping only those `counts` accepts -- a dashboard that exists,
 * for the hidden note and Add tile.
 */
export function hiddenEntries<S extends { slot: string }>(
  tiles: readonly TilePlacement[],
  slots: readonly S[],
  counts: (entry: S) => boolean,
): S[] {
  const shown = new Set(tiles.map((t) => t.slot));
  return slots.filter((s) => !shown.has(s.slot) && counts(s));
}

/** What the Arrange bar says when an arrangement hides dashboards (spec §4). */
export function hiddenNote(count: number): string {
  return `${count} ${count === 1 ? "dashboard" : "dashboards"} not shown in this layout`;
}

/**
 * Applying an arrangement (spec §4). The dashboards shown now, in reading
 * order, then the hidden ones in stored order, are given to the new
 * arrangement's tiles in reading order. An empty tile contributes nothing.
 * Any left over keep an entry under an id the new arrangement does not use,
 * and are hidden.
 *
 * `counts` says which entries are dashboards to seat: one naming a dashboard
 * that no longer exists is an empty tile on screen, so it is not seated --
 * but it is kept, hidden, after the others rather than dropped, for the
 * reason loadWorkspaces gives in workspacesFile.ts: if the dashboards failed
 * to load, every entry would look dangling, and dropping them would persist
 * that loss. Generic over the entry, so v5.7.1's dialog can re-seat its
 * "New dashboard" placeholders through the same rule.
 */
export function reseat<S extends { slot: string }>(
  from: readonly TilePlacement[],
  slots: readonly S[],
  to: readonly TilePlacement[],
  counts: (entry: S) => boolean,
): S[] {
  const shown = readingOrder(from).flatMap((t) => {
    const held = slots.find((s) => s.slot === t.slot);
    return held !== undefined && counts(held) ? [held] : [];
  });
  const queue = [...shown, ...hiddenEntries(from, slots, counts)];
  const seats = readingOrder(to);
  const seated = queue.slice(0, seats.length).map((held, n) => ({ ...held, slot: seats[n].slot }));
  const rest = [...queue.slice(seats.length), ...slots.filter((s) => !counts(s))];
  const used = new Set(to.map((t) => t.slot));
  let n = 0;
  const kept = rest.map((held) => {
    while (used.has(slotId(n))) n++;
    const slot = slotId(n);
    used.add(slot);
    return { ...held, slot };
  });
  return [...seated, ...kept];
}

/**
 * Where Add tile puts a new tile (spec §3): the largest free rectangle at
 * least MIN_TILE each way, or null when there is none. Ties go to the one
 * whose top-left comes first in reading order; at the same top-left, to the
 * shortest of equal area (main's ruling R10).
 */
export function largestFreeRect(tiles: readonly TileRect[]): TileRect | null {
  let best: TileRect | null = null;
  for (let y = 0; y + MIN_TILE <= GRID_SIZE; y++) {
    for (let x = 0; x + MIN_TILE <= GRID_SIZE; x++) {
      for (let h = MIN_TILE; y + h <= GRID_SIZE; h++) {
        for (let w = MIN_TILE; x + w <= GRID_SIZE; w++) {
          const rect = { x, y, w, h };
          // Wider only collides more, so the first collision ends this run of widths.
          if (tiles.some((t) => overlaps(t, rect))) break;
          if (best === null || w * h > best.w * best.h) best = rect;
        }
      }
    }
  }
  return best;
}

/** The first of a–z that no tile and no slot entry uses: an empty new tile's slot id (spec §3). */
export function freeSlotId(
  tiles: readonly { slot: string }[],
  slots: readonly { slot: string }[],
): string | undefined {
  const used = new Set([...tiles, ...slots].map((t) => t.slot));
  return "abcdefghijklmnopqrstuvwxyz".split("").find((id) => !used.has(id));
}

/**
 * Which tile a move swaps with (spec §3 "Swapping"): the one whose rectangle
 * in `tiles` -- the arrangement as it was when the drag began, never the
 * layout the library has pushed about since -- holds the dragged tile's
 * centre at release, in grid units. Strictly inside: a centre exactly on an
 * edge swaps with neither tile (main's ruling R27). Never the dragged tile
 * itself, so a centre still in its own old rectangle is an ordinary move.
 */
export function swapTarget(
  tiles: readonly TilePlacement[],
  dragged: string,
  centre: { x: number; y: number },
): string | null {
  const hit = tiles.find(
    (t) =>
      t.slot !== dragged &&
      t.x < centre.x &&
      centre.x < t.x + t.w &&
      t.y < centre.y &&
      centre.y < t.y + t.h,
  );
  return hit === undefined ? null : hit.slot;
}

/**
 * Two tiles exchange rectangles -- each takes the other's position and size
 * -- and nothing else moves. Always an arrangement when `tiles` is one: the
 * two rectangles were already disjoint from every other tile. Each tile keeps
 * its slot id, so its dashboard goes with it.
 */
export function swapTiles(tiles: readonly TilePlacement[], a: string, b: string): TilePlacement[] {
  const ta = tiles.find((t) => t.slot === a);
  const tb = tiles.find((t) => t.slot === b);
  if (ta === undefined || tb === undefined) return [...tiles];
  return tiles.map((t) =>
    t === ta ? { slot: a, x: tb.x, y: tb.y, w: tb.w, h: tb.h } : t === tb ? { slot: b, x: ta.x, y: ta.y, w: ta.w, h: ta.h } : t,
  );
}
