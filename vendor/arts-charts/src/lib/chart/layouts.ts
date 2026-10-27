// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import type { ChartLayout } from "../chartLayoutsFile";
import type { Series } from "../types";
import type { PanelDef } from "./panels";
import { seriesId } from "./series";

/**
 * The pure part of the saved layout library (spec 2026-09-24, D4/D9): a layout
 * snapshotted from a card, a card rebuilt from a layout, and the exact-match
 * test the Layout control reads. Nothing here touches the store, the file or
 * React.
 */

/**
 * A stable JSON of a value with object keys sorted at every level, so equality
 * does not depend on key order -- a card's series built by the palette and a
 * layout's series read off disk can carry the same fields in a different order
 * and must still compare equal. Arrays keep their order (a series list's order
 * is meaningful); only object keys are sorted.
 */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v,
  );
}

/** A series without its per-card identity: everything layoutMatches compares (D9). */
function withoutId({ id: _id, ...rest }: Series): Omit<Series, "id"> {
  return rest;
}

/**
 * A layout snapshotted from a card (D2). Deep copies both arrays -- a shallow
 * reference would let a later card edit reach back into the library, which is
 * the aliasing D4 forbids. Only the arrangement is captured: no symbol,
 * interval, range or session.
 */
export function layoutFromCard(name: string, note: string, panels: PanelDef[], series: Series[]): ChartLayout {
  return {
    name,
    note,
    panels: panels.map((p) => ({ ...p })),
    series: series.map((s) => ({ ...s })),
  };
}

/**
 * A card's panels and series from a layout, with fresh series identifiers
 * (D4): editing the card never edits the library, and applying the same layout
 * twice gives two independent cards that share no identity. The panels are deep
 * copies for the same reason.
 */
export function cardFromLayout(layout: ChartLayout): { panels: PanelDef[]; series: Series[] } {
  return {
    panels: layout.panels.map((p) => ({ ...p })),
    series: layout.series.map((s) => ({ ...s, id: seriesId() })),
  };
}

/**
 * Whether a card's panels and series still equal this layout's exactly (D9),
 * ignoring the series `id` (minted fresh on every apply, D4). This is FULL
 * equality, not the presets' partial `expr|panel|side` signature (D6/D10): a
 * colour, a pen or a panel-geometry edit must drop the name and read Custom, so
 * everything but the id is compared. The name and the note are the layout's
 * metadata, not its arrangement, and take no part.
 */
export function layoutMatches(layout: ChartLayout, panels: PanelDef[], series: Series[]): boolean {
  return (
    canonical(layout.panels) === canonical(panels) &&
    canonical(layout.series.map(withoutId)) === canonical(series.map(withoutId))
  );
}
