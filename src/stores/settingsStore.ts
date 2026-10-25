// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { create } from "zustand";
import { DEFAULT_SETTINGS, clampWidgetGap, loadSettings, saveSettings } from "../lib/settingsFile";
import { serialize } from "../lib/serialize";
import type { Settings } from "../lib/types";
import { useWorkspaceStore } from "./workspaceStore";

export type CommitResult =
  | { ok: true }
  | { ok: false; conflicts: (keyof Settings)[] }
  | { ok: false; error: string };

type SettingsState = {
  settings: Settings;
  load: () => Promise<void>;
  save: (patch: Partial<Settings>) => Promise<void>;
  // A dialog's in-progress edits, staged over `settings` but never written
  // to disk until commitDraft: `snapshot` is what `settings` was when the
  // draft opened (the base a conflict is measured against), `patch` is
  // every field the dialog has changed so far.
  draft: { snapshot: Settings; patch: Partial<Settings> } | null;
  beginDraft: () => void;
  stageDraft: (patch: Partial<Settings>) => void;
  discardDraft: () => void;
  commitDraft: (options?: { replace?: boolean }) => Promise<CommitResult>;
};

/**
 * What a live preview (theme, font size, rail width, widget gap) should
 * actually render: the committed settings with any open draft's changes
 * laid over them, so a dialog's unsaved edits are visible immediately
 * without touching disk.
 */
export function selectEffective(state: SettingsState): Settings {
  return { ...state.settings, ...(state.draft?.patch ?? {}) };
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  draft: null,
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
      const next = { ...get().settings, ...patch };
      // The slider can only ever produce an in-range integer (a range input
      // sanitizes itself), but save() is a plain store action any caller can
      // reach. Clamping here means an out-of-range, fractional or non-finite
      // gap never reaches the disk -- so what is written back is what the
      // loader would read, and the running grid never renders a gap a
      // restart would silently change. clampWidgetGap is the same helper
      // settingsFile's load-time normalizer uses, so both paths agree.
      const merged = {
        ...next,
        widgetGap: clampWidgetGap(next.widgetGap),
      };
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
  beginDraft: () => set({ draft: { snapshot: get().settings, patch: {} } }),
  stageDraft: (patch) =>
    set((state) => ({
      draft: state.draft === null ? null : { ...state.draft, patch: { ...state.draft.patch, ...patch } },
    })),
  discardDraft: () => set({ draft: null }),
  // Identical across every line this ports to: it diffs the staged patch
  // against the draft's own snapshot (not the live settings) to find what
  // actually changed, checks that nothing else committed a conflicting
  // change to those SAME fields since the draft opened, and then reuses the
  // line's existing save() -- so save()'s own clamping (widgetGap here)
  // still applies to whatever the draft commits.
  commitDraft: async (options) => {
    const draft = get().draft;
    if (draft === null) return { ok: true };
    const dirtyKeys = (Object.keys(draft.patch) as (keyof Settings)[]).filter(
      (k) => draft.patch[k] !== draft.snapshot[k],
    );
    if (dirtyKeys.length === 0) {
      set({ draft: null });
      return { ok: true };
    }
    if (options?.replace !== true) {
      const current = get().settings;
      const conflicts = dirtyKeys.filter((k) => current[k] !== draft.snapshot[k]);
      if (conflicts.length > 0) return { ok: false, conflicts };
    }
    const dirtyPatch = Object.fromEntries(dirtyKeys.map((k) => [k, draft.patch[k]])) as Partial<Settings>;
    try {
      await get().save(dirtyPatch);
      set({ draft: null });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
}));
