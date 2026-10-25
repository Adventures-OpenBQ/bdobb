// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { confirm } from "@tauri-apps/plugin-dialog";
import { useDashboardStore } from "../stores/dashboardStore";
import type { Dashboard } from "./types";

export type DocksOutcome = "replaced" | "kept" | "none" | "editing" | "viewer";

/**
 * The one place an import's locked-widgets conflict is decided (donor
 * 0543d0b5), so the guard cannot drift between callers: runAppsImport, which
 * every apps.json import goes through, is its only caller. The docks are a
 * singleton, so there is no Keep both: an empty docks here is replaced
 * silently, and a populated one asks first. Returns what happened, for the
 * import's notice.
 *
 * importDocks refuses while the Locked Widgets editor is open (the edit is
 * newer) and in the viewer, without saying so; asking first and then
 * reporting "replaced" over that silent no-op was review C3. Both are
 * therefore refused here, before the prompt, with their own outcome.
 */
export async function resolveDocksImport(docks: Dashboard | undefined): Promise<DocksOutcome> {
  if (!docks) return "none";
  const { docks: existing, importDocks, dockEdit, viewer } = useDashboardStore.getState();
  if (viewer) return "viewer";
  if (dockEdit) return "editing";
  if (existing.tabs.some((t) => t.cards.length > 0)) {
    const ok = await confirm("Importing will replace your locked widgets on both edges. This cannot be undone.", {
      title: "Replace locked widgets?",
      kind: "warning",
      okLabel: "Replace",
      cancelLabel: "Keep mine",
    });
    if (!ok) return "kept";
  }
  await importDocks(docks);
  return "replaced";
}

/** The clause the import notice carries for each outcome. */
export function docksNotice(outcome: DocksOutcome): string {
  if (outcome === "replaced") return ", and replaced your locked widgets";
  if (outcome === "kept") return ", and kept your locked widgets";
  if (outcome === "editing") return ", and left your locked widgets alone: the Locked Widgets editor is open";
  if (outcome === "viewer") return ", and left your locked widgets alone: this window is a viewer";
  return "";
}
