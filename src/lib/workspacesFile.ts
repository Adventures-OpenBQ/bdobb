// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord } from "./isRecord";
import { loadJsonDir, removeJson, saveJson } from "./jsonStore";
import { isMinResolution, type MinResolution } from "./screenFit";
import { PRESETS, type PresetId, type TilePlacement, isArrangement, isPresetId } from "./workspacePresets";

const DIR = "workspaces";

const pathFor = (id: string) => `${DIR}/${id}.json`;

/** Which dashboard sits in which tile (slot id) of the workspace's arrangement. */
export type WorkspaceSlot = {
  /** A tile's slot id in the workspace's arrangement — "a", "b", … */
  slot: string;
  dashboardId: string;
};

/**
 * One saved arrangement of dashboards.
 *
 * A slot holds a REFERENCE, never a copy: that is what lets the same
 * dashboard sit in several workspaces with no sync logic at all, since every
 * copy is the one dashboard file.
 *
 * Slots for tiles the arrangement does not have are kept, not pruned: they
 * are the dashboards a smaller arrangement hides, and applying a bigger one
 * seats them again (reseat, in workspacePresets.ts).
 */
export type Workspace = {
  id: string;
  name: string;
  preset: PresetId;
  slots: WorkspaceSlot[];
  /** dashboardId -> tabId, so reopening a workspace restores each tile's tab. */
  activeTabIds?: Record<string, string>;
  /**
   * Only `left`. Rita — the right rail — does not exist on this line, and a
   * flag nothing reads is worth nothing; the validator below tolerates a
   * `right` key arriving from a later release.
   */
  railsOpen?: { left: boolean };
  /**
   * Whether each filled tile draws its title line -- the dashboard's name and
   * the clear ✕ above the dashboard's own tab bar. Absent means shown, so
   * every file written before the option existed looks as it always did, and
   * a build that predates the key ignores it and shows the names. Only
   * `false` is ever written: the store writes `true` as absence
   * (workspacesStore's overlayDraft).
   */
  showTileNames?: boolean;
  /**
   * The workspace's own arrangement, once it has been arranged by hand or
   * given a saved layout (spec
   * docs/superpowers/specs/2026-10-01-workspace-arrange-design.md §2).
   * Absent means PRESETS[preset].tiles, so every file written before
   * arranging existed reads as it always did and nothing is migrated; a build
   * that predates the key (v5.6.0's validator ignores keys it does not know)
   * shows the preset. `preset` stays one of the built-in ids either way. Read
   * through arrangementOf, never directly.
   */
  layout?: TilePlacement[];
  /**
   * The smallest screen this workspace is laid out for, in logical pixels
   * (spec docs/superpowers/specs/2026-10-12-resolution-default-workspace-design.md
   * §2). Absent means Any size. On a smaller screen the workspace still
   * opens: WorkspaceGrid lays it out at this size and zooms it to fit (§4).
   */
  minResolution?: MinResolution;
  /**
   * A candidate for the launch choice (spec 2026-10-12 §5): of the marked
   * workspaces that fit the launch screen, the largest minimum opens. Only
   * `true` is ever written; absent means not marked.
   */
  openAtLaunch?: true;
};

function isSlot(value: unknown): value is WorkspaceSlot {
  return isRecord(value) && typeof value.slot === "string" && typeof value.dashboardId === "string";
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false;
  // Object.values, not for..in: own enumerable keys only, so nothing
  // inherited from Object.prototype is validated or carried. Same discipline
  // as foldersFile's `placement` check.
  return Object.values(value).every((x) => typeof x === "string");
}

export function isWorkspace(value: unknown): value is Workspace {
  if (!isRecord(value)) return false;
  const v = value;
  if (typeof v.id !== "string" || typeof v.name !== "string") return false;
  if (!isPresetId(v.preset)) return false;
  if (!Array.isArray(v.slots) || !v.slots.every(isSlot)) return false;
  // One entry per slot id, as isArrangement allows one tile per id: a second
  // is never shown, and reseat would drop it on the next save.
  if (new Set(v.slots.map((s) => s.slot)).size !== v.slots.length) return false;
  // Mirrored dashboards would repeat card DOM identities and tab/maximize ownership.
  if (new Set(v.slots.map((s) => s.dashboardId)).size !== v.slots.length) return false;
  if (v.activeTabIds !== undefined && !isStringRecord(v.activeTabIds)) return false;
  if (v.railsOpen !== undefined && !(isRecord(v.railsOpen) && typeof v.railsOpen.left === "boolean")) return false;
  // Optional, but a boolean when present: anything else is a file this build
  // cannot be sure it reads the way its writer meant, so it is refused whole.
  if (v.showTileNames !== undefined && typeof v.showTileNames !== "boolean") return false;
  // Optional, but an arrangement when present (isArrangement, the one
  // decision on that): anything else is refused whole, like every other
  // malformed field here.
  if (v.layout !== undefined && !isArrangement(v.layout)) return false;
  // Both optional. A malformed one refuses the workspace whole, like every
  // other field here; the first revision's `defaultFor` is just an unknown key.
  if (v.minResolution !== undefined && !isMinResolution(v.minResolution)) return false;
  if (v.openAtLaunch !== undefined && v.openAtLaunch !== true) return false;
  return true;
}

/**
 * The tiles a workspace -- or Arrange mode's draft laid over one -- shows:
 * its own `layout`, or its preset's. The one place the absence is resolved
 * (spec §2). A draft's `layout` is null rather than absent, so both are
 * accepted.
 */
export function arrangementOf(w: {
  preset: PresetId;
  layout?: readonly TilePlacement[] | null;
}): readonly TilePlacement[] {
  return w.layout ?? PRESETS[w.preset].tiles;
}

/** A new workspace starts on the one-tile preset with nothing in it. */
export function makeWorkspace(name: string): Workspace {
  return { id: crypto.randomUUID(), name, preset: "full-screen", slots: [] };
}

/**
 * Every workspace file in the directory. Unlike `loadDashboards` this seeds
 * nothing on an empty directory: no workspaces is a legitimate resting state,
 * and it is exactly what a user who never opens one has.
 *
 * A slot naming a dashboard that no longer exists is NOT dropped here. The
 * renderer treats an unknown id as an empty slot (WorkspaceTile), which
 * satisfies "a dangling id never crashes" without the failure mode dropping
 * would add: if loadDashboards failed while this succeeded, every slot would
 * look dangling and the next save would persist that loss.
 */
export async function loadWorkspaces(): Promise<Workspace[]> {
  return await loadJsonDir(DIR, isWorkspace);
}

export async function saveWorkspace(workspace: Workspace): Promise<void> {
  await saveJson(pathFor(workspace.id), workspace);
}

export async function deleteWorkspace(id: string): Promise<void> {
  await removeJson(pathFor(id));
}
