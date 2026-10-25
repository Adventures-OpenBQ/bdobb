// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { Folder } from "./foldersFile";
import type { Dashboard } from "./types";

export type FolderNode = {
  folder: Folder;
  children: FolderNode[];
  dashboards: Dashboard[];
};

/** The rail's whole list: top-level folders, then top-level dashboards. */
export type FolderTree = {
  folders: FolderNode[];
  dashboards: Dashboard[];
};

/**
 * Derives the rail's tree. Deliberately takes the already-ordered
 * `dashboards` array rather than a second copy of `settings.dashboardOrder`:
 * useDashboardStore.load() has applied that order already and
 * reorderDashboards keeps it, so re-sorting here would create a second source
 * of truth that could disagree with the Option+1-9 indices — which are
 * positions in this very array.
 *
 * Pure, and total: a folder whose parent is gone, a dashboard placed in a
 * folder that is gone, and a parent cycle all resolve to something renderable
 * rather than to a throw or a hang.
 */
export function buildTree(
  folders: Folder[],
  folderOrder: string[],
  placement: Record<string, string>,
  dashboards: Dashboard[],
): FolderTree {
  const known = new Set(folders.map((f) => f.id));
  const rank = new Map(folderOrder.map((id, i) => [id, i] as const));

  // A folder on a parent cycle (a hand-edited file) reaches no root, so it --
  // and every dashboard placed in it -- would never be drawn. Only the folders
  // ON the cycle are found here: walking up from one either comes back to it
  // or ends (at the top, at a missing parent, or in some other loop).
  const parentOf = new Map(folders.map((f) => [f.id, f.parentId] as const));
  const onCycle = (id: string): boolean => {
    const seen = new Set<string>();
    for (let at = parentOf.get(id); at != null && known.has(at); at = parentOf.get(at)) {
      if (at === id) return true;
      if (seen.has(at)) return false;
      seen.add(at);
    }
    return false;
  };

  const byParent = new Map<string | null, Folder[]>();
  for (const f of folders) {
    // Losing a folder is worse than moving it: one whose parent no longer
    // exists is shown at the top level instead of disappearing, and so is
    // one on a parent cycle.
    const key = f.parentId !== null && known.has(f.parentId) && !onCycle(f.id) ? f.parentId : null;
    const list = byParent.get(key);
    if (list) list.push(f);
    else byParent.set(key, [f]);
  }
  for (const list of byParent.values()) {
    // Unlisted folders sort after every listed one, in their incoming order
    // (Array.prototype.sort is stable, ES2019+).
    list.sort(
      (a, b) =>
        (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  // A Map from Object.entries, never `placement[id]`: an index lookup would
  // answer for inherited Object.prototype keys ("constructor", "toString"),
  // and a dashboard is free to carry any id at all.
  const placed = new Map(Object.entries(placement));
  const dashboardsByFolder = new Map<string | null, Dashboard[]>();
  for (const d of dashboards) {
    const folderId = placed.get(d.id);
    const key = folderId !== undefined && known.has(folderId) ? folderId : null;
    const list = dashboardsByFolder.get(key);
    if (list) list.push(d);
    else dashboardsByFolder.set(key, [d]);
  }

  // Descends only from the roots, so a parent cycle is unreachable rather
  // than infinite (and its folders were moved to the roots above).
  const build = (folder: Folder): FolderNode => ({
    folder,
    children: (byParent.get(folder.id) ?? []).map(build),
    dashboards: dashboardsByFolder.get(folder.id) ?? [],
  });

  return {
    folders: (byParent.get(null) ?? []).map(build),
    dashboards: dashboardsByFolder.get(null) ?? [],
  };
}

/** A dashboard and the folder names above it, outermost first. */
export type RailDashboard = { dashboard: Dashboard; path: string[] };

/**
 * The tree's dashboards in the order the rail draws their rows: every folder
 * depth-first (a folder's subfolders before its own dashboards, mirroring
 * LeftRail's folderRow), then the top-level dashboards. `collapsed` plays no
 * part — this is the order of the rows, not which of them are visible.
 *
 * Each entry carries its folder path, which the Library's On-dashboard filter
 * needs to tell two same-named dashboards apart.
 */
export function railDashboardsWithPath(tree: FolderTree): RailDashboard[] {
  const fromNode = (node: FolderNode, above: string[]): RailDashboard[] => {
    const path = [...above, node.folder.name];
    return [
      ...node.children.flatMap((child) => fromNode(child, path)),
      ...node.dashboards.map((dashboard) => ({ dashboard, path })),
    ];
  };
  return [
    ...tree.folders.flatMap((node) => fromNode(node, [])),
    ...tree.dashboards.map((dashboard) => ({ dashboard, path: [] })),
  ];
}
