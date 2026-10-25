// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { create } from "zustand";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../lib/settingsFile";
import { serialize } from "../lib/serialize";
import type { Settings } from "../lib/types";
import { useWorkspaceStore } from "./workspaceStore";

/**
 * commitDraft's result. `conflicts` names the keys where the committed
 * settings moved out from under the draft's snapshot between beginDraft and
 * commitDraft (another writer landed first); `error` is a save() failure
 * (e.g. disk I/O) unrelated to conflicts. Both leave the draft in place so
 * the caller can retry or ask the user.
 */
export type CommitResult =
  | { ok: true }
  | { ok: false; conflicts: (keyof Settings)[] }
  | { ok: false; error: string };

type SettingsState = {
  settings: Settings;
  load: () => Promise<void>;
  save: (patch: Partial<Settings>) => Promise<void>;
  /**
   * A settings dialog's in-progress edit: `snapshot` is what `settings` was
   * when editing began, `patch` is everything the dialog has staged since.
   * Live preview reads `selectEffective` (settings + patch); nothing commits
   * to disk until commitDraft.
   */
  draft: { snapshot: Settings; patch: Partial<Settings> } | null;
  beginDraft: () => void;
  stageDraft: (patch: Partial<Settings>) => void;
  discardDraft: () => void;
  commitDraft: (options?: { replace?: boolean }) => Promise<CommitResult>;
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  // On the same chain as save(), as backendsStore's load is: unchained, a
  // load overlapping a save could read the file before the save's write and
  // publish that stale read over the save's set(). Nothing calls load() after
  // bootstrap today; this keeps that true by construction rather than by luck.
  load: () =>
    serialize("store:settings", async () => {
      set({ settings: await loadSettings() });
    }),
  // Chains every save() call so an overlapping call's read-merge-write cycle
  // always starts from the PREVIOUS call's already-applied state, not a
  // stale snapshot taken before that call landed -- otherwise two saves
  // racing (e.g. a blur-triggered save and a click-triggered save) silently
  // drop whichever patch loses the race, on disk and in memory both.
  save: (patch) =>
    serialize("store:settings", async () => {
      const merged = { ...get().settings, ...patch };
      await saveSettings(merged);
      set({ settings: merged });
      // Storage on a connection mirrors every successful save; commitDraft
      // lands here too, so this is the one hook point. Only to the connection
      // holding settings, and only while it has a live session: signed out or
      // expired, settings stay local until Sign in. Fired, never awaited: a
      // slow or offline server must not hold the settings chain, and the
      // upload reports its own failure on that connection's session state.
      const holder = merged.settingsStorage;
      const session = holder === undefined ? undefined : useWorkspaceStore.getState().sessions[holder];
      if (holder !== undefined && session !== undefined && session.state !== "expired") {
        void useWorkspaceStore.getState().queueUpload(holder, merged).catch(() => {});
      }
    }),
  draft: null,
  beginDraft: () => {
    set({ draft: { snapshot: get().settings, patch: {} } });
  },
  // Merges into the existing draft's patch. Requires beginDraft() to have
  // been called first -- there is no patch to merge into otherwise. The
  // non-null assertion is deliberate: a caller that stages before beginning
  // a draft has a bug, and this throws immediately at the call site instead
  // of silently fabricating a draft that would hide it.
  stageDraft: (patch) => {
    const draft = get().draft!;
    set({ draft: { snapshot: draft.snapshot, patch: { ...draft.patch, ...patch } } });
  },
  discardDraft: () => {
    set({ draft: null });
  },
  commitDraft: async (options) => {
    const draft = get().draft;
    if (draft === null) return { ok: true };
    const dirtyKeys = (Object.keys(draft.patch) as (keyof Settings)[]).filter(
      (k) => draft.patch[k] !== draft.snapshot[k],
    );
    if (dirtyKeys.length === 0) { set({ draft: null }); return { ok: true }; }
    if (options?.replace !== true) {
      const current = get().settings;
      const conflicts = dirtyKeys.filter((k) => current[k] !== draft.snapshot[k]);
      if (conflicts.length > 0) return { ok: false, conflicts };
    }
    const dirtyPatch = Object.fromEntries(dirtyKeys.map((k) => [k, draft.patch[k]])) as Partial<Settings>;
    try { await get().save(dirtyPatch); set({ draft: null }); return { ok: true }; }
    catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
  },
}));

/** The settings a preview reader should show: committed settings with any in-progress draft patch layered on top. */
export function selectEffective(state: SettingsState): Settings {
  return { ...state.settings, ...(state.draft?.patch ?? {}) };
}
