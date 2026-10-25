// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { create } from "zustand";
import { isRecord } from "../lib/isRecord";
import { ABSENT, loadJson, saveJson } from "../lib/jsonStore";
import { serialize } from "../lib/serialize";
import type { SyncLink, Tombstone } from "../lib/types";

/** Next to settings.json; never exported (spec: Link records and tombstones). */
const PATH = "workspaceSync.json";

export type SyncFile = { links: SyncLink[]; tombstones: Tombstone[] };

const isStore = (v: unknown) => v === "dashboard" || v === "app";
function isLink(l: unknown): l is SyncLink {
  return isRecord(l) && typeof l.dashboardId === "string" && typeof l.connectionId === "string" && isStore(l.store) && typeof l.uuid === "string" &&
    typeof l.serverUpdatedDate === "string" && typeof l.localRevisionAtSync === "number" && typeof l.shared === "boolean" &&
    (l.dismissed === undefined || typeof l.dismissed === "boolean");
}
function isTombstone(t: unknown): t is Tombstone {
  return isRecord(t) && typeof t.connectionId === "string" && isStore(t.store) && typeof t.uuid === "string";
}
function isSyncFile(v: unknown): v is SyncFile {
  return isRecord(v) && Array.isArray(v.links) && v.links.every(isLink) && Array.isArray(v.tombstones) && v.tombstones.every(isTombstone);
}

type SyncState = SyncFile & {
  /** The file exists but could not be read: links are unknown, so a sync would re-create every server item as a duplicate. */
  unreadable: boolean;
  load: () => Promise<void>;
  /** One serialized read-modify-write of the whole file; `step` sees the state as of its turn, never a stale snapshot. */
  update: (step: (file: SyncFile) => SyncFile) => Promise<void>;
};

export const useWorkspaceSyncStore = create<SyncState>((set, get) => ({
  links: [],
  tombstones: [],
  unreadable: false,
  load: async () => {
    const stored = await loadJson(PATH, isSyncFile).catch((err: unknown) => {
      set({ unreadable: true });
      throw err;
    });
    // Field by field, so an unknown key in the file is not carried back out by the next write.
    set(stored === ABSENT ? { links: [], tombstones: [], unreadable: false } : {
      unreadable: false,
      links: stored.links.map(({ dashboardId, connectionId, store, uuid, serverUpdatedDate, localRevisionAtSync, shared, dismissed }) =>
        ({ dashboardId, connectionId, store, uuid, serverUpdatedDate, localRevisionAtSync, shared, ...(dismissed ? { dismissed } : {}) })),
      tombstones: stored.tombstones.map(({ connectionId, store, uuid }) => ({ connectionId, store, uuid })),
    });
  },
  update: (step) =>
    serialize("store:workspaceSync", async () => {
      const next = step({ links: get().links, tombstones: get().tombstones });
      await saveJson(PATH, next);
      set(next);
    }),
}));

/** A dashboard's live (not dismissed) link on one connection. */
export function linkFor(links: SyncLink[], connectionId: string, dashboardId: string): SyncLink | undefined {
  return links.find((l) => l.connectionId === connectionId && l.dashboardId === dashboardId && !l.dismissed);
}
