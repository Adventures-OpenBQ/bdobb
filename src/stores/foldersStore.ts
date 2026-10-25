// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { create } from "zustand";
import { loadFolders, saveFolders, type Folder, type FoldersFile } from "../lib/foldersFile";
import { serialize } from "../lib/serialize";

type FoldersState = FoldersFile & {
  load: () => Promise<void>;
  addFolder: (name: string, parentId: string | null) => Promise<string>;
  renameFolder: (id: string, name: string) => Promise<void>;
  /** Its dashboards and its subfolders move to its parent. Nothing is deleted with it. */
  deleteFolder: (id: string) => Promise<void>;
  moveDashboard: (dashboardId: string, folderId: string | null) => Promise<void>;
  toggleCollapsed: (id: string) => Promise<void>;
  replaceAll: (next: FoldersFile) => Promise<void>;
};

export const useFoldersStore = create<FoldersState>((set, get) => {
  // Chains every mutating action, mirroring settingsStore and backendsStore:
  // each action's read-mutate-write step runs only after every previously
  // queued step has both written to disk and published via set(). Without
  // this, two un-awaited mutations (e.g. a drop handler firing addFolder then
  // moveDashboard) would both call snapshot() from the same stale state, and
  // the second commit would silently revert the first -- on disk and in
  // memory both.
  const enqueue = <T,>(step: () => Promise<T>) => serialize("store:folders", step);

  /** The four persisted fields, without the actions. */
  const snapshot = (): FoldersFile => {
    const { folders, folderOrder, placement, collapsed } = get();
    return { folders, folderOrder, placement, collapsed };
  };

  /**
   * Persist first, then publish. Mirrors the dialog-driven CRUD in
   * dashboardStore: the write is invisible to the user, and this keeps memory
   * from diverging from disk on a failed write with no rollback bookkeeping.
   */
  async function commit(next: FoldersFile): Promise<void> {
    await saveFolders(next);
    set(next);
  }

  return {
    folders: [],
    folderOrder: [],
    placement: {},
    collapsed: [],

    // Queued behind the same chain as every mutation: an un-awaited load
    // racing a mutation (e.g. a boot-time load and an early addFolder) would
    // otherwise let whichever set() lands second silently revert the other.
    load: () => enqueue(async () => { set(await loadFolders()); }),

    addFolder: (name, parentId) =>
      enqueue(async () => {
        const folder: Folder = { id: crypto.randomUUID(), name, parentId };
        const s = snapshot();
        await commit({
          ...s,
          folders: [...s.folders, folder],
          folderOrder: [...s.folderOrder, folder.id],
        });
        return folder.id;
      }),

    renameFolder: (id, name) =>
      enqueue(async () => {
        const s = snapshot();
        // An unknown id writes nothing at all, rather than persisting an
        // unchanged file.
        if (!s.folders.some((f) => f.id === id)) return;
        await commit({ ...s, folders: s.folders.map((f) => (f.id === id ? { ...f, name } : f)) });
      }),

    deleteFolder: (id) =>
      enqueue(async () => {
        const s = snapshot();
        const target = s.folders.find((f) => f.id === id);
        if (!target) return;
        const parentId = target.parentId;
        await commit({
          folders: s.folders
            .filter((f) => f.id !== id)
            .map((f) => (f.parentId === id ? { ...f, parentId } : f)),
          folderOrder: s.folderOrder.filter((fid) => fid !== id),
          // A dashboard in the deleted folder moves to its parent — and at the
          // top level that is the ABSENCE of a key, never a null one, because
          // buildTree reads "absent" as top level.
          placement: Object.fromEntries(
            Object.entries(s.placement).flatMap(([dashboardId, folderId]): Array<[string, string]> => {
              if (folderId !== id) return [[dashboardId, folderId]];
              return parentId === null ? [] : [[dashboardId, parentId]];
            }),
          ),
          collapsed: s.collapsed.filter((fid) => fid !== id),
        });
      }),

    moveDashboard: (dashboardId, folderId) =>
      enqueue(async () => {
        const s = snapshot();
        if (folderId !== null && !s.folders.some((f) => f.id === folderId)) return;
        const placement = { ...s.placement };
        if (folderId === null) delete placement[dashboardId];
        else placement[dashboardId] = folderId;
        await commit({ ...s, placement });
      }),

    toggleCollapsed: (id) =>
      enqueue(async () => {
        const s = snapshot();
        await commit({
          ...s,
          collapsed: s.collapsed.includes(id)
            ? s.collapsed.filter((fid) => fid !== id)
            : [...s.collapsed, id],
        });
      }),

    /**
     * The whole file at once, for an imported bundle. A tree is a tree: a
     * per-folder merge would have to invent a rule for two folders sharing an
     * id and a different parent, and the design says an imported tree
     * replaces rather than blends.
     */
    replaceAll: (next: FoldersFile) => enqueue(() => commit(next)),
  };
});
