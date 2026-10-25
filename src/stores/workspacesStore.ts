// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { create } from "zustand";
import {
  type Workspace,
  type WorkspaceSlot,
  arrangementOf,
  deleteWorkspace,
  loadWorkspaces,
  makeWorkspace,
  saveWorkspace,
} from "../lib/workspacesFile";
import { type SavedLayout, loadSavedLayouts, removeSavedLayout, writeSavedLayout } from "../lib/layoutsFile";
import { PRESETS, type PresetId, type TilePlacement, type TileRect, placeTiles, reseat } from "../lib/workspacePresets";
import type { MinResolution } from "../lib/screenFit";
import { serialize } from "../lib/serialize";
import { sortByOrder, withOptional } from "../lib/collections";

/**
 * One tile of a workspace being edited: a real slot, or a placeholder for a
 * dashboard that does not exist yet. The dialog's "New dashboard" puts a
 * placeholder in the selected tile, and the DIALOG creates the dashboard on
 * Done -- this store never imports dashboardStore (see the comment in
 * App.tsx above the tab-restore effect), so it could not.
 */
export type DraftSlot =
  | { slot: string; dashboardId: string }
  | { slot: string; newDashboard: true };

/**
 * The working copy the workspace dialog and Arrange mode edit (specs
 * docs/superpowers/specs/2026-09-30-workspace-dialog-design.md §3 and
 * docs/superpowers/specs/2026-10-01-workspace-arrange-design.md §3). It is
 * published here rather than kept inside a component so the real grid can
 * preview it (WorkspaceGrid reads effectiveWorkspace) and the Arrange bar
 * reads the one copy. Nothing in it reaches disk until commitDraft. The
 * dialog and Arrange mode are never open together, so there is one draft.
 *
 * Unlike settingsStore's draft there is no snapshot and no changed-underneath
 * check: nothing can change a workspace while the dialog is up -- viewer
 * windows refuse writes, and this line has no agent -- and while a workspace
 * is arranged the rail is inert and the shortcuts that write workspaces are
 * too. A second writer is the trigger to add one.
 */
export type WorkspaceDraft = {
  /** null = a workspace that does not exist yet. */
  id: string | null;
  name: string;
  preset: PresetId;
  slots: DraftSlot[];
  /** The file's `showTileNames` with its absence already read as true. */
  showTileNames: boolean;
  /**
   * The arrangement being drawn: a copy of the file's `layout`, or null for
   * the preset's own tiles (the file's absence). Arrange mode stages it (spec
   * 2026-10-01 §3); the dialog stages a copy when a saved layout is chosen.
   */
  layout: TilePlacement[] | null;
  /** The file's `minResolution`, null for Any size (spec 2026-10-12 §2). */
  minResolution: MinResolution | null;
  /** The file's `openAtLaunch` with its absence read as false. */
  openAtLaunch: boolean;
};

export type CommitDraftResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * The move rule, in one place: a dashboard sits in at most one tile of a
 * workspace, so assigning it removes it from every other slot -- including
 * slots with no tile showing, which are kept hidden (and re-seated in reading
 * order when the layout changes) and would otherwise resurface it twice. A
 * "New dashboard" placeholder is not a dashboard yet, so several tiles may
 * hold one. Pure; slots are kept sorted by slot id, as assignSlot (which
 * uses this) keeps them on disk.
 */
export function assignDraftSlot(
  slots: DraftSlot[],
  slot: string,
  entry: { dashboardId: string } | { newDashboard: true },
): DraftSlot[] {
  const moving = "dashboardId" in entry ? entry.dashboardId : null;
  const kept = slots.filter(
    (s) => s.slot !== slot && !("dashboardId" in s && s.dashboardId === moving),
  );
  const placed: DraftSlot =
    "dashboardId" in entry ? { slot, dashboardId: entry.dashboardId } : { slot, newDashboard: true };
  return [...kept, placed].sort((a, b) => a.slot.localeCompare(b.slot));
}

/** A draft's real slots, placeholders left out. */
function realSlots(slots: DraftSlot[]): WorkspaceSlot[] {
  return slots.flatMap((s) => ("dashboardId" in s ? [{ slot: s.slot, dashboardId: s.dashboardId }] : []));
}

/**
 * The workspace as the grid should draw it right now: the saved one, with
 * the draft laid over it when the draft is FOR it -- the dialog's or Arrange
 * mode's. Placeholders are dropped, so a "New dashboard" tile previews as an
 * empty tile until Done (an accepted limit, spec 2026-09-30 §1 "Live
 * preview"). Answers `saved` itself, the same reference, whenever there is
 * nothing to lay over it -- which is what lets WorkspaceGrid memoise on it.
 */
export function effectiveWorkspace(
  saved: Workspace | undefined,
  draft: WorkspaceDraft | null,
): Workspace | undefined {
  if (saved === undefined || draft === null || draft.id !== saved.id) return saved;
  return overlayDraft(saved, draft, realSlots(draft.slots));
}

/**
 * `base` with the draft's fields laid over it, each the way the file carries
 * it, so a workspace that uses none of the newer options is byte-for-byte
 * what it was before they existed:
 * - `showTileNames`: `false` written, `true` written as absence;
 * - `layout`: see withLayout;
 * - `minResolution` and `openAtLaunch` (spec 2026-10-12 §2): written only
 *   when they say something.
 * Everything else on `base` (activeTabIds, railsOpen) is kept.
 */
export function overlayDraft(base: Workspace, draft: WorkspaceDraft, slots: WorkspaceSlot[]): Workspace {
  let next: Workspace = { ...base, name: draft.name, preset: draft.preset, slots };
  next = withOptional(next, "showTileNames", draft.showTileNames ? undefined : false);
  next = withLayout(next, draft.layout);
  next = withOptional(
    next,
    "minResolution",
    draft.minResolution === null ? undefined : { ...draft.minResolution },
  );
  return withOptional(next, "openAtLaunch", draft.openAtLaunch ? true : undefined);
}

/**
 * `layout` the way the file carries it: written when the workspace has an
 * arrangement of its own, absent when it shows its preset's -- so a
 * workspace that was never arranged is byte-for-byte what it was before
 * arranging existed.
 */
function withLayout(workspace: Workspace, layout: TilePlacement[] | null): Workspace {
  return withOptional(workspace, "layout", layout ?? undefined);
}

/** A saved layout's name as the uniqueness rule compares it: trimmed, case-insensitive (spec 2026-10-01 §6). */
export function layoutNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * The preset whose name `name` is by the same rule, or undefined. A saved
 * layout may not take one: the Layout submenu lists the presets first, and a
 * second "Laptop" below them could not be told apart. Names already on disk
 * are not checked -- loading never renames or drops a layout.
 *
 * "Custom" is refused by the same rule, though no preset has it: it is the
 * dialog strip's last entry for a workspace with an arrangement of its own,
 * and a saved layout under it would put two "Custom" thumbnails in the strip.
 */
export function presetNamed(name: string): { name: string } | undefined {
  return [...Object.values(PRESETS), { name: "Custom" }].find((p) => layoutNameKey(p.name) === layoutNameKey(name));
}

/**
 * The name Save layout as… pre-fills: "Untitled layout", else the first free
 * "Untitled layout N" for N ≥ 2 -- free by the rule above, which
 * naming.ts's nextUntitledName (exact comparison, and "Untitled") cannot say.
 */
export function nextLayoutName(layouts: readonly SavedLayout[]): string {
  const taken = new Set(layouts.map((l) => layoutNameKey(l.name)));
  if (!taken.has("untitled layout")) return "Untitled layout";
  // Terminates: `taken` is finite, so some N is always free.
  for (let n = 2; ; n++) {
    if (!taken.has(`untitled layout ${n}`)) return `Untitled layout ${n}`;
  }
}

/** Saved layouts are listed by name: the dialog's strip and the rail's Layout ▸ both read them in this order. */
const layoutsByName = (layouts: SavedLayout[]) => [...layouts].sort((a, b) => a.name.localeCompare(b.name));

type WorkspacesState = {
  workspaces: Workspace[];
  /** null is single-dashboard mode — the app as it was before workspaces. */
  activeWorkspaceId: string | null;
  previousWorkspaceId: string | null;
  /**
   * The slot the mouse last entered, for the active workspace. Purely
   * in-memory and deliberately never persisted — same reasoning as
   * dashboardStore's `maximizedCardId`: it is a way of looking at a
   * workspace right now, not a property of the workspace. It exists
   * alongside the dashboard-id focus (`dashboardStore.activeId`) rather than
   * replacing it, because an EMPTY tile has no dashboard for that to name —
   * without a slot-shaped focus of its own, a rail click had nothing to
   * target in an empty tile and silently re-targeted whichever tile a
   * dashboard was already focused in.
   */
  focusedSlot: string | null;
  setFocusedSlot: (slot: string | null) => void;

  /**
   * The working copy the workspace dialog or Arrange mode is editing, or
   * null while neither is open. In-memory only, like focusedSlot. The dialog
   * begins it on mount and discards it on unmount -- unless it has just
   * handed the workspace to Arrange mode -- so a draft never outlives either.
   */
  draft: WorkspaceDraft | null;
  /**
   * `beginDraft(null, newName)` starts a new workspace on Full Screen with no
   * slots and names shown; `newName` is read only then. `beginDraft(id)`
   * copies that saved workspace, and does nothing for an id it does not know.
   */
  beginDraft: (id: string | null, newName?: string) => void;
  /** Merges into the open draft; a no-op when none is open. Never writes. */
  stageDraft: (
    patch: Partial<
      Pick<WorkspaceDraft, "name" | "preset" | "slots" | "showTileNames" | "layout" | "minResolution" | "openAtLaunch">
    >,
  ) => void;
  discardDraft: () => void;
  /**
   * Writes the draft once, through the same queue as every other mutation,
   * and clears it -- if it is still the open one; a draft begun since is left
   * alone. A failure keeps the draft so Done can be pressed again.
   */
  commitDraft: () => Promise<CommitDraftResult>;
  /**
   * The workspace being arranged, or null. In memory only, like the draft it
   * goes with: this says the draft is Arrange mode's.
   */
  arrangingId: string | null;
  /** Makes `id` the active workspace, begins its draft and turns Arrange mode on; nothing for an unknown id. */
  startArranging: (id: string) => void;
  /** Turns Arrange mode off and drops the draft: Cancel and Escape, and Done after a commit that succeeded. */
  endArranging: () => void;

  /** Saved layouts, by name. Local to the machine, as workspaces are. */
  layouts: SavedLayout[];
  loadLayouts: () => Promise<void>;
  /**
   * Saves `tiles` -- slot ids dropped -- under `name`, trimmed. A layout
   * already under that name by layoutNameKey is REPLACED, keeping its id and
   * taking the new spelling: the caller asks before calling. Rejects a blank
   * name, a preset's name (presetNamed), and a failed write, writing nothing
   * to memory.
   */
  saveLayout: (name: string, tiles: readonly TileRect[]) => Promise<void>;
  /** False, writing nothing, for a blank name, a preset's name, or one another layout already has. */
  renameLayout: (id: string, name: string) => Promise<boolean>;
  /** Changes no workspace: a layout that was applied was copied (spec §6). */
  deleteLayout: (id: string) => Promise<void>;
  /**
   * Copies a saved layout's tiles into the workspace's `layout`, slot ids a,
   * b, … in reading order, and re-seats its dashboards; `preset` is left as
   * it was (spec §4). Nothing for a layout id it does not know. `known` as
   * for applyPreset.
   */
  applySavedLayout: (id: string, layoutId: string, known: ReadonlySet<string>) => Promise<void>;

  load: (order?: string[]) => Promise<void>;
  renameWorkspace: (id: string, name: string) => Promise<void>;
  removeWorkspace: (id: string) => Promise<void>;
  duplicateWorkspace: (id: string) => Promise<string | null>;
  /**
   * Marks `id` as a launch candidate or clears it (spec 2026-10-12 §8). Any
   * number may be marked: the launch rule chooses among them. Nothing for
   * an unknown id, or when nothing would change.
   */
  setOpenAtLaunch: (id: string, on: boolean) => Promise<void>;
  /**
   * Gives the workspace a preset's arrangement and re-seats its dashboards
   * into it in reading order (spec 2026-10-01 §4): `preset` is set and any
   * `layout` of its own is removed. `known` is every dashboard id that
   * exists -- the caller's to supply, since this store never imports
   * dashboardStore -- so a slot naming a deleted dashboard is not seated.
   */
  applyPreset: (id: string, preset: PresetId, known: ReadonlySet<string>) => Promise<void>;
  assignSlot: (id: string, slot: string, dashboardId: string) => Promise<void>;
  clearSlot: (id: string, slot: string) => Promise<void>;
  setRailsOpen: (id: string, left: boolean) => Promise<void>;
  setWorkspaceTab: (id: string, dashboardId: string, tabId: string) => Promise<void>;
  setActiveWorkspace: (id: string | null) => void;
  goToPreviousWorkspace: () => void;
  activeWorkspace: () => Workspace | undefined;
};

export const useWorkspacesStore = create<WorkspacesState>((set, get) => {
  // One chain for every mutation, exactly as foldersStore does it: two
  // un-awaited writes (a drop handler assigning a slot while a menu renames)
  // would otherwise both read the same stale workspace and the later commit
  // would silently revert the earlier one, on disk and in memory both.
  const enqueue = <T,>(step: () => Promise<T>) => serialize("store:workspaces", step);

  /**
   * Persist first, then publish — the same order foldersStore's `commit`
   * uses, so a failed write cannot leave memory claiming something the disk
   * does not have.
   */
  async function commit(next: Workspace): Promise<void> {
    await saveWorkspace(next);
    set({ workspaces: get().workspaces.map((w) => (w.id === next.id ? next : w)) });
  }

  /** Applies `fn` to one workspace, or does nothing at all for an unknown id. */
  function mutate(id: string, fn: (w: Workspace) => Workspace): Promise<void> {
    return enqueue(async () => {
      const current = get().workspaces.find((w) => w.id === id);
      if (!current) return;
      await commit(fn(current));
    });
  }

  return {
    workspaces: [],
    activeWorkspaceId: null,
    previousWorkspaceId: null,
    focusedSlot: null,
    setFocusedSlot: (slot) => set({ focusedSlot: slot }),

    draft: null,

    beginDraft: (id, newName) => {
      if (id === null) {
        set({
          draft: {
            id: null,
            name: newName ?? "",
            preset: "full-screen",
            slots: [],
            showTileNames: true,
            layout: null,
            minResolution: null,
            openAtLaunch: false,
          },
        });
        return;
      }
      const saved = get().workspaces.find((w) => w.id === id);
      if (!saved) return;
      set({
        draft: {
          id,
          name: saved.name,
          preset: saved.preset,
          // A copy: staging must never be able to reach the saved workspace.
          slots: [...saved.slots],
          showTileNames: saved.showTileNames !== false,
          // A copy too, for the same reason as the slots.
          layout: saved.layout === undefined ? null : [...saved.layout],
          minResolution: saved.minResolution === undefined ? null : { ...saved.minResolution },
          openAtLaunch: saved.openAtLaunch === true,
        },
      });
    },

    // Defensive no-op: Arrange mode always begins a draft before a gesture
    // can fire, and the workspace dialog renders nothing that stages until
    // its draft exists (a Create cancelled mid-flight stops before staging,
    // WorkspaceDialog's `alive`), so staging with none open is a bug, not a
    // path to support -- but crashing the render is worse.
    stageDraft: (patch) => {
      const draft = get().draft;
      if (draft === null) return;
      set({ draft: { ...draft, ...patch } });
    },

    discardDraft: () => set({ draft: null }),

    commitDraft: () => {
      // Captured when called, not when the queue reaches it: a draft begun
      // since -- Escape and Arrange… again, or Cancel and reopen the dialog,
      // while a write is in flight or while this waits behind another task --
      // is a different draft, and must be neither the one written nor the
      // one cleared. Identity is the whole check.
      const draft = get().draft;
      return enqueue<CommitDraftResult>(async () => {
        if (draft === null) return { ok: false, error: "No workspace is being edited." };
        // The dialog turns every placeholder into a real dashboard (or drops
        // one in a hidden tile) before it commits. One still here means that
        // did not happen, and writing the workspace without it would silently
        // drop a tile the user filled.
        const slots = realSlots(draft.slots);
        if (slots.length !== draft.slots.length) {
          return { ok: false, error: "A new dashboard in this workspace has not been created yet." };
        }
        // Trimmed, as InlineRename trims a rail rename: the dialog refuses an
        // all-space name, so this only ever strips padding.
        const name = draft.name.trim();
        try {
          const creating = draft.id === null;
          const base = creating ? makeWorkspace(name) : get().workspaces.find((w) => w.id === draft.id);
          if (!base) return { ok: false, error: "This workspace no longer exists." };
          // Spread over the SAVED workspace, so activeTabIds and railsOpen --
          // which neither the dialog nor Arrange mode shows -- survive.
          const next = overlayDraft(base, { ...draft, name }, slots);
          await saveWorkspace(next);
          // Workspaces and draft in one set(): the grid never sees the new
          // workspace with the draft still laid over it, or the reverse.
          set({
            workspaces: creating ? [...get().workspaces, next] : get().workspaces.map((w) => (w.id === next.id ? next : w)),
            ...(get().draft === draft ? { draft: null } : {}),
          });
          return { ok: true, id: next.id };
        } catch (err) {
          // Persist first, then publish, as commit() above does: a failed
          // write has changed nothing in memory, and the draft is KEPT so the
          // user's edits are still on screen for a retry.
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      });
    },

    arrangingId: null,

    startArranging: (id) => {
      if (!get().workspaces.some((w) => w.id === id)) return;
      get().setActiveWorkspace(id);
      get().beginDraft(id);
      set({ arrangingId: id });
    },

    endArranging: () => set({ draft: null, arrangingId: null }),

    layouts: [],

    loadLayouts: () =>
      enqueue(async () => {
        set({ layouts: layoutsByName(await loadSavedLayouts()) });
      }),

    // Through the same queue as every workspace write (spec §6): persist
    // first, then publish, as commit() does.
    saveLayout: (name, tiles) =>
      enqueue(async () => {
        const trimmed = name.trim();
        if (trimmed === "") throw new Error("A layout needs a name.");
        const builtIn = presetNamed(trimmed);
        if (builtIn !== undefined) throw new Error(`"${builtIn.name}" is a built-in layout. Choose another name.`);
        const existing = get().layouts.find((l) => layoutNameKey(l.name) === layoutNameKey(trimmed));
        const layout: SavedLayout = {
          id: existing?.id ?? crypto.randomUUID(),
          name: trimmed,
          tiles: tiles.map(({ x, y, w, h }) => ({ x, y, w, h })),
        };
        await writeSavedLayout(layout);
        set({ layouts: layoutsByName([...get().layouts.filter((l) => l.id !== layout.id), layout]) });
      }),

    renameLayout: (id, name) =>
      enqueue(async () => {
        const trimmed = name.trim();
        const current = get().layouts.find((l) => l.id === id);
        if (current === undefined || trimmed === "" || presetNamed(trimmed) !== undefined) return false;
        if (get().layouts.some((l) => l.id !== id && layoutNameKey(l.name) === layoutNameKey(trimmed))) return false;
        const next = { ...current, name: trimmed };
        await writeSavedLayout(next);
        set({ layouts: layoutsByName(get().layouts.map((l) => (l.id === id ? next : l))) });
        return true;
      }),

    deleteLayout: (id) =>
      enqueue(async () => {
        await removeSavedLayout(id);
        set({ layouts: get().layouts.filter((l) => l.id !== id) });
      }),

    applySavedLayout: (id, layoutId, known) => {
      const saved = get().layouts.find((l) => l.id === layoutId);
      if (saved === undefined) return Promise.resolve();
      const tiles = placeTiles(saved.tiles);
      return mutate(id, (w) =>
        withLayout(
          { ...w, slots: reseat(arrangementOf(w), w.slots, tiles, (s) => known.has(s.dashboardId)) },
          tiles,
        ),
      );
    },

    load: (order) =>
      enqueue(async () => {
        const loaded = await loadWorkspaces();
        // Alphabetical is the fallback rank for anything the order does not
        // name, so sorting by name FIRST means unlisted workspaces land in a
        // sensible order behind the listed ones. Same shape as
        // dashboardStore.load.
        const byName = [...loaded].sort((a, b) => a.name.localeCompare(b.name));
        set({ workspaces: order ? sortByOrder(byName, order) : byName });
      }),

    renameWorkspace: (id, name) => mutate(id, (w) => ({ ...w, name })),

    removeWorkspace: (id) =>
      enqueue(async () => {
        await deleteWorkspace(id);
        const wasActive = get().activeWorkspaceId === id;
        set({
          workspaces: get().workspaces.filter((w) => w.id !== id),
          // Deleting the workspace you are in drops you back to
          // single-dashboard mode rather than guessing a different one.
          // Its focused slot goes with it, as setActiveWorkspace drops one.
          ...(wasActive ? { activeWorkspaceId: null, focusedSlot: null } : {}),
          // Never leave the previous id naming something that is gone.
          ...(get().previousWorkspaceId === id ? { previousWorkspaceId: null } : {}),
          // Nor a draft or Arrange mode for it: commitDraft would only answer
          // that it no longer exists.
          ...(get().draft?.id === id ? { draft: null } : {}),
          ...(get().arrangingId === id ? { arrangingId: null } : {}),
        });
      }),

    duplicateWorkspace: (id) =>
      enqueue(async () => {
        const current = get().workspaces.find((w) => w.id === id);
        if (!current) return null;
        // The slots are copied as REFERENCES: the copy shows the same
        // dashboards, it does not duplicate them.
        // The minimum is copied; the launch mark is not, so a copy never
        // silently becomes a launch candidate (spec 2026-10-12 §2).
        const { openAtLaunch: _openAtLaunch, ...rest } = current;
        const copy: Workspace = { ...rest, id: crypto.randomUUID(), name: `${current.name} copy` };
        await saveWorkspace(copy);
        set({ workspaces: [...get().workspaces, copy] });
        return copy.id;
      }),

    setOpenAtLaunch: (id, on) =>
      enqueue(async () => {
        const target = get().workspaces.find((w) => w.id === id);
        if (!target || (target.openAtLaunch === true) === on) return;
        await commit(withOptional(target, "openAtLaunch", on ? true : undefined));
      }),

    applyPreset: (id, preset, known) =>
      mutate(id, (w) =>
        withLayout(
          {
            ...w,
            preset,
            slots: reseat(arrangementOf(w), w.slots, PRESETS[preset].tiles, (s) => known.has(s.dashboardId)),
          },
          null,
        ),
      ),

    // A dashboard sits in at most one tile of a workspace, so assigning it
    // removes it from every other slot -- including slots with no tile
    // showing, which are kept hidden and would otherwise resurface it twice.
    // Two tiles of one dashboard would mirror its tab and maximize and repeat
    // its cards' DOM ids.
    assignSlot: (id, slot, dashboardId) =>
      mutate(id, (w) => ({ ...w, slots: assignDraftSlot(w.slots, slot, { dashboardId }) as WorkspaceSlot[] })),

    clearSlot: (id, slot) =>
      mutate(id, (w) => ({ ...w, slots: w.slots.filter((s) => s.slot !== slot) })),

    setRailsOpen: (id, left) => mutate(id, (w) => ({ ...w, railsOpen: { left } })),

    setWorkspaceTab: (id, dashboardId, tabId) =>
      mutate(id, (w) => ({ ...w, activeTabIds: { ...w.activeTabIds, [dashboardId]: tabId } })),

    setActiveWorkspace: (id) => {
      const { activeWorkspaceId } = get();
      // Re-selecting the one you are on is not a switch, so it must not
      // overwrite where you came from. Same early return as
      // dashboardStore.setActive, for the same reason.
      if (id === activeWorkspaceId) return;
      // A slot id means nothing outside the workspace it came from — carrying
      // it into a different one (or into single-dashboard mode) could aim a
      // later rail click at a slot the new workspace's preset doesn't even
      // have, which is exactly the stale-slot case assignSlot's caller guards
      // against.
      set({ activeWorkspaceId: id, previousWorkspaceId: activeWorkspaceId, focusedSlot: null });
    },

    goToPreviousWorkspace: () => {
      const { previousWorkspaceId, workspaces } = get();
      if (!previousWorkspaceId || !workspaces.some((w) => w.id === previousWorkspaceId)) return;
      get().setActiveWorkspace(previousWorkspaceId);
    },

    activeWorkspace: () => {
      const { workspaces, activeWorkspaceId } = get();
      return workspaces.find((w) => w.id === activeWorkspaceId);
    },
  };
});
