// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord } from "./isRecord";
import { loadJsonDir, removeJson, saveJson } from "./jsonStore";
import { type TileRect, isArrangement } from "./workspacePresets";

/** Beside `workspaces`: one file per layout, local to the machine as workspaces are. */
const DIR = "layouts";

const pathFor = (id: string) => `${DIR}/${id}.json`;

/**
 * A saved arrangement (spec
 * docs/superpowers/specs/2026-10-01-workspace-arrange-design.md §6): tiles
 * only -- no slot ids and no dashboards -- so any workspace can take it.
 * Applying one copies its tiles into that workspace's own `layout`; nothing
 * stays linked, so renaming or deleting a saved layout changes no workspace.
 */
export type SavedLayout = { id: string; name: string; tiles: TileRect[] };

export function isSavedLayout(value: unknown): value is SavedLayout {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || typeof value.name !== "string" || !Array.isArray(value.tiles)) return false;
  // The tiles must make an arrangement, by isArrangement's rules -- the one
  // place they are decided. They carry no slot ids, so each is given a
  // throwaway one for the check.
  return isArrangement(
    value.tiles.map((t, n) => (typeof t === "object" && t !== null ? { ...t, slot: String(n) } : t)),
  );
}

/** Every saved layout; an unreadable or invalid file is skipped, the rest kept (loadJsonDir). */
export async function loadSavedLayouts(): Promise<SavedLayout[]> {
  return await loadJsonDir(DIR, isSavedLayout);
}

export async function writeSavedLayout(layout: SavedLayout): Promise<void> {
  await saveJson(pathFor(layout.id), layout);
}

export async function removeSavedLayout(id: string): Promise<void> {
  await removeJson(pathFor(id));
}
