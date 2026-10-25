// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { create } from "zustand";
import { pinResolvedBackends } from "../lib/appsJson";
import { BUILTIN_BACKEND_ID, LOCAL_TABLE_ID } from "../lib/builtins";
import {
  deleteDashboard as deleteDashboardFile,
  loadDashboards,
  saveDashboard,
} from "../lib/dashboardsFile";
import { IMPORT_MAX_DASHBOARDS } from "../lib/importLimits";
import { deleteLocalFile } from "../lib/localFiles";
import { logError, logInfo, logOnce } from "../lib/logger";
import { nextGroupName, type ParamEdit } from "../lib/paramGroups";
import { bindableKeys, seedParams } from "../lib/params";
import type {
  CardView,
  Dashboard,
  DashboardCard,
  DashboardTab,
  TableCardState,
  WidgetDef,
} from "../lib/types";
import { useWidgetRegistryStore } from "./widgetRegistryStore";

export type GridLayoutItem = { i: string; x: number; y: number; w: number; h: number };

/** Grid geometry is fixed by these two constants. */
export const GRID_COLS = 40;
export const GRID_ROW_HEIGHT = 20;

type DashboardState = {
  dashboards: Dashboard[];
  /** The ONLY field naming the active dashboard. */
  activeId: string | null;
  /** History, not a second name for the active dashboard. */
  previousId: string | null;
  /**
   * The ONLY field naming the active dashboard's active tab. Not persisted —
   * like activeId, it resets on load/setActive/goToPrevious rather than
   * remembering which tab you were last on, and is reset by removeTab and
   * removeDashboard when the removed tab/dashboard was the active one.
   */
  activeTabId: string | null;
  /**
   * Bumped once per "refresh all". Purely in-memory and deliberately not
   * persisted: it is a signal that says "refetch now", not state worth
   * remembering across a restart. useWidgetData lists it among its fetch
   * effect's dependencies, so a bump reaches every MOUNTED card — i.e. the
   * active tab's — and nothing else.
   */
  refreshEpoch: number;
  /** ⌘R and the tab bar's ↻: one bump, every mounted card refetches. */
  refreshAll: () => void;
  /**
   * The card currently filling the dashboard area, or null. Purely in-memory
   * and deliberately never persisted (the design's Out of scope names both
   * "persisting maximized state" and "maximizing across windows"): it is a
   * way of looking at a dashboard right now, not a property of the dashboard.
   * One id, not a set — one card at a time, per window.
   */
  maximizedCardId: string | null;
  /**
   * Maximize `cardId`, or restore with null. A plain set(): no mutateActive,
   * no write, and therefore no viewer guard — there is nothing to refuse in a
   * window that only reads.
   */
  setMaximized: (cardId: string | null) => void;
  /**
   * True in the "Open in new window" viewer. Purely in-memory, never
   * persisted, and set exactly once by App's bootstrap from `?viewer=<id>`.
   * Dashboard-level writes below refuse outright when it is set, and
   * mutateDashboard applies its change in memory without writing — so no
   * path can write a dashboard from the second window, while the params
   * strip and the view toggle still respond. Settings writes are deliberately
   * NOT guarded. The viewer reads settings once, when it opens, so its theme
   * is the main window's at that moment and does not follow a later change.
   */
  viewer: boolean;
  load: (order?: string[]) => Promise<void>;
  setActive: (id: string) => void;
  goToPrevious: () => void;
  activeDashboard: () => Dashboard | undefined;
  setActiveTab: (tabId: string) => void;
  /** `null` when the viewer window refused it — no other path returns null. */
  addDashboard: (name: string) => Promise<string | null>;
  renameDashboard: (id: string, name: string) => Promise<void>;
  removeDashboard: (id: string) => Promise<void>;
  /** Deep copy with fresh ids throughout, inserted directly after the original. */
  duplicateDashboard: (id: string) => Promise<string | null>;
  /** Appends already-built dashboards (an apps.json import), writing each one. */
  importDashboards: (imported: Dashboard[]) => Promise<void>;
  /**
   * An import's Replace: the dashboard keeps its id, name and rail position,
   * and everything else becomes `imported`'s. Written before set(), like the
   * rest of the dashboard-level CRUD, so a failed write changes nothing.
   */
  replaceDashboardContents: (id: string, imported: Dashboard) => Promise<void>;
  setGroupsDisabled: (id: string, disabled: boolean) => Promise<void>;
  /**
   * The dashboard sync's writes: `upserts` replace by id or are appended,
   * `removals` go through removeDashboard. No revision bump -- these ARE the
   * synced state. Refused in the viewer, where sync never runs.
   */
  applySynced: (upserts: Dashboard[], removals: string[]) => Promise<void>;
  /**
   * Group CRUD, all on the active dashboard. A group is per dashboard and a
   * card param is in at most one group, so join replaces and leave/delete
   * write the group's value back onto the member — the control keeps
   * showing what it showed instead of snapping to a stale stored value.
   * Returns null when the viewer window refused it.
   */
  createGroup: (cardId: string, paramName: string, groupType: string, value: string) => Promise<string | null>;
  joinGroup: (groupId: string, cardId: string, paramName: string) => Promise<void>;
  leaveGroup: (cardId: string, paramName: string) => Promise<void>;
  renameGroup: (groupId: string, name: string) => Promise<void>;
  deleteGroup: (groupId: string) => Promise<void>;
  /** Scoped to the active dashboard via mutateActive — no UI surface touches a non-active dashboard's tabs. */
  addTab: (name: string) => Promise<string | null>;
  renameTab: (tabId: string, name: string) => Promise<void>;
  removeTab: (tabId: string) => Promise<void>;
  /** Scoped to the active dashboard via mutateActive, like the rest of the tab CRUD. */
  reorderTabs: (orderedIds: string[]) => Promise<void>;
  addCard: (
    widget: WidgetDef,
    paramsOverride?: Record<string, string>,
  ) => Promise<string | null>;
  addCardTo: (
    dashboardId: string | null,
    tabId: string | null,
    widget: WidgetDef,
    paramsOverride?: Record<string, string>,
  ) => Promise<string | null>;
  removeCard: (cardId: string) => Promise<void>;
  updateLayouts: (layouts: GridLayoutItem[]) => Promise<void>;
  applyCardParams: (cardId: string, edit: ParamEdit) => Promise<void>;
  /** Purely in-memory — order itself is persisted in settings.json, not per-dashboard. */
  reorderDashboards: (orderedIds: string[]) => void;
  setCardMinimized: (cardId: string, minimized: boolean) => Promise<void>;
  /**
   * One optional card field, set or REMOVED. `null` removes it rather than
   * writing an empty value: `view: undefined` and `table: {}` would still be
   * keys in memory, and on disk an empty object reads back as "the user has
   * state here" on the next load.
   *
   * What a cleared field means, per field. `view`: the manifest has markdown,
   * pdf, html and multi_file_viewer widgets too, and toggling raw off must not
   * persist `view: "table"` onto their cards — the card body already treats
   * "not raw" as "dispatch on widget type". `title`: the card follows the
   * widget's name again, so a rename that is undone follows the manifest
   * rather than freezing today's name onto the card. `table`: what "Reset
   * table" does.
   *
   * `table` is the one field MERGED over what the card already carries, so a
   * sort change cannot wipe a filter; `view` and `title` are scalars and are
   * replaced. Goes through mutateActive like every other card write: one
   * write, and the viewer window applies it in memory and writes nothing.
   */
  patchCardField: <K extends CardField>(
    cardId: string,
    field: K,
    value: CardFieldPatch[K] | null,
  ) => Promise<void>;
};

/** The three optional card fields `patchCardField` sets, and what each takes. */
type CardFieldPatch = {
  view: CardView;
  title: string;
  table: Partial<TableCardState>;
};
type CardField = keyof CardFieldPatch;

function nextY(cards: DashboardCard[]): number {
  return cards.reduce((max, c) => Math.max(max, c.layout.y + c.layout.h), 0);
}

/**
 * Finds which tab holds `cardId` and applies `fn` to it there, leaving every
 * other tab untouched — including its object identity, so a tab with no
 * matching card comes back as the SAME reference, not a new one with
 * identical content. `fn` returning null removes the card.
 */
function updateCardInDashboard(
  d: Dashboard,
  cardId: string,
  fn: (c: DashboardCard) => DashboardCard | null,
): Dashboard {
  return {
    ...d,
    tabs: d.tabs.map((t) => {
      if (!t.cards.some((c) => c.id === cardId)) return t;
      return {
        ...t,
        cards: t.cards.flatMap((c) => {
          if (c.id !== cardId) return [c];
          const next = fn(c);
          return next ? [next] : [];
        }),
      };
    }),
  };
}

/**
 * Every storage key of `card` that binds as `paramName`: the param's own key
 * and, for a form field of that name, `<form>.<field>`. Without the widget
 * (an unresolved import) the bare name is the only key there can be.
 */
function keysForName(card: DashboardCard, paramName: string): string[] {
  const widget = useWidgetRegistryStore.getState().widgets.find((w) => w.id === card.widgetId);
  if (!widget) return [paramName];
  const keys = [...bindableKeys(widget)].filter(([, name]) => name === paramName).map(([k]) => k);
  return keys.length > 0 ? keys : [paramName];
}

/** The card with `paramName` bound to `groupId`, replacing any binding it had for that name. */
function bind(card: DashboardCard, groupId: string, paramName: string): DashboardCard {
  return { ...card, bindings: [...(card.bindings ?? []).filter((b) => b.paramName !== paramName), { groupId, paramName }] };
}

/** The card with `paramName` unbound and the group's value written onto its keys. */
function unbind(card: DashboardCard, paramName: string, value: string): DashboardCard {
  const bindings = (card.bindings ?? []).filter((b) => b.paramName !== paramName);
  const params = { ...card.params };
  for (const key of keysForName(card, paramName)) params[key] = value;
  const next: DashboardCard = { ...card, params };
  if (bindings.length > 0) next.bindings = bindings;
  else delete next.bindings;
  return next;
}

/**
 * `next` as the save of a user edit to `prev`: one revision on from prev's
 * (spec: Link records). Sync's own writes (applySynced) do not come through
 * here -- they ARE the synced state.
 */
function nextRevision(next: Dashboard, prev: Dashboard): Dashboard {
  return { ...next, revision: (prev.revision ?? 0) + 1 };
}

export const useDashboardStore = create<DashboardState>((set, get) => {
  /**
   * Dashboards whose file removeDashboard is deleting right now. The delete
   * is awaited before the dashboard leaves memory (persist-before-set), so a
   * card change in that window still finds it, and its save -- queued behind
   * the delete on the same path -- would write the file straight back.
   * mutateDashboard skips the write for an id in here.
   */
  const removing = new Set<string>();

  /**
   * Applies a change to one dashboard and writes it exactly once.
   * Optimistic (set() before the write lands) unlike the dashboard-level CRUD
   * below: this path backs drag-release layout updates, and waiting on the
   * disk write first would hold the grid in its pre-drop position until the
   * write completed, showing as a visible snap-back.
   */
  async function mutateDashboard(
    id: string | null,
    fn: (d: Dashboard) => Dashboard,
  ): Promise<Dashboard | undefined> {
    const { dashboards, viewer } = get();
    const current = dashboards.find((d) => d.id === id);
    if (!current) return undefined;

    // Every card-affecting save is also where an imported card that has since
    // found its backend gets that backendId written onto it (spec §5). No-op
    // for a dashboard with no unresolved card, which is nearly all of them.
    const updated = nextRevision(pinResolvedBackends(fn(current), useWidgetRegistryStore.getState().widgets), current);
    set({ dashboards: dashboards.map((d) => (d.id === updated.id ? updated : d)) });
    // The viewer window applies the change in memory — a param Apply and the
    // view toggle both have to respond there — but never writes it. Both
    // halves of the design are satisfied: "Params ... work" and "no path can
    // write a dashboard from the second window".
    if (viewer) {
      // logOnce keyed on the dashboard, and not awaited: this path is hit by
      // every param Apply and view toggle in the viewer, so a line per call
      // would both grow the log without bound and put a disk write in front
      // of a change that has already been applied to memory above.
      void logOnce(
        `viewer-no-write:${updated.id}`,
        `viewer window did not persist a change to dashboard ${updated.id}`,
      );
      return updated;
    }
    // ponytail: if the delete then FAILS, this change stays in memory only;
    // re-save on a failed delete if that ever matters.
    if (removing.has(updated.id)) return updated;
    await saveDashboard(updated);
    return updated;
  }

  /**
   * The dashboard-level guard. A refusal is logged with the action's name so
   * a silent no-op is never a mystery when triaging the log.
   */
  function refuse(action: string): boolean {
    if (!get().viewer) return false;
    // INFO, not ERROR: refusing is what the viewer is supposed to do. Every
    // refusal is logged (unlike the no-write notice above) because each one
    // answers a distinct "why did my click do nothing?".
    void logInfo(`viewer window refused ${action}`);
    return true;
  }

  const mutateActive = (fn: (d: Dashboard) => Dashboard) => mutateDashboard(get().activeId, fn);

  /**
   * The stored-file half of a removal, and the only one there is: a
   * local-table card owns the copy the drop stored, and nothing else will
   * ever delete it. removeCard, removeTab and removeDashboard all end here
   * with the cards they discarded, so no path can strand a file.
   *
   * Call it AFTER the mutation: what survives is read back from the store.
   * duplicateDashboard copies params.file, so one stored file can be named
   * by cards on several dashboards, and deleting it while any of them still
   * points at it would break that card -- the whole store, every dashboard
   * and every tab, is scanned first.
   */
  async function deleteDiscardedFiles(discarded: DashboardCard[]): Promise<void> {
    // The viewer window writes nothing, so it must not delete either -- the
    // cards are gone from ITS memory only, and the main window's still read
    // those files.
    if (get().viewer) return;
    const stillNamed = (file: string) =>
      get().dashboards.some((d) =>
        d.tabs.some((t) =>
          t.cards.some(
            (c) =>
              c.backendId === BUILTIN_BACKEND_ID &&
              c.widgetId === LOCAL_TABLE_ID &&
              c.params.file === file,
          ),
        ),
      );
    // Keyed by file so two discarded cards naming one file delete it once;
    // the value is the first card holding it, which is all the log needs.
    const byFile = new Map<string, string>();
    for (const c of discarded) {
      const file = c.params.file;
      if (c.backendId !== BUILTIN_BACKEND_ID || c.widgetId !== LOCAL_TABLE_ID || !file) continue;
      if (!byFile.has(file)) byFile.set(file, c.id);
    }
    for (const [file, cardId] of byFile) {
      if (stillNamed(file)) continue;
      // The cards are already gone from memory and from disk; a failed delete
      // leaves a stray file, which is not worth failing the removal over.
      // The card id only: the stored name is the user's own file.
      await deleteLocalFile(file).catch((err) =>
        logError(`failed to delete the stored file for card ${cardId}: ${err}`),
      );
    }
  }

  return {
    dashboards: [],
    activeId: null,
    previousId: null,
    activeTabId: null,
    maximizedCardId: null,
    viewer: false,

    load: async (order) => {
      const dashboards = await loadDashboards();
      // loadDashboards() already returns dashboards sorted alphabetically by
      // name, which is exactly the fallback this needs for any dashboard not
      // named in `order`: an unlisted dashboard ranks past every listed one,
      // and two unlisted ones rank EQUAL, so Array.prototype.sort's ES2019+
      // stability leaves them in their existing (alphabetical) relative order
      // with no tiebreak logic here.
      const rank = (id: string, listed: string[]) => {
        const i = listed.indexOf(id);
        return i === -1 ? listed.length : i;
      };
      const sorted = order
        ? [...dashboards].sort((a, b) => rank(a.id, order) - rank(b.id, order))
        : dashboards;
      const first = sorted[0];
      set({
        dashboards: sorted,
        activeId: first?.id ?? null,
        previousId: null,
        activeTabId: first?.tabs[0]?.id ?? null,
      });
    },

    setActive: (id) => {
      const { activeId, dashboards } = get();
      if (id === activeId) return;
      const target = dashboards.find((d) => d.id === id);
      // maximizedCardId names a card on the dashboard being left, so it is
      // cleared here rather than left to dangle: the early return above means
      // re-selecting the SAME dashboard is not a switch and keeps it.
      set({
        activeId: id,
        previousId: activeId,
        activeTabId: target?.tabs[0]?.id ?? null,
        maximizedCardId: null,
      });
    },

    /** Option+0: swap back to wherever you came from. */
    goToPrevious: () => {
      const { activeId, previousId, dashboards } = get();
      if (!previousId || !dashboards.some((d) => d.id === previousId)) return;
      const target = dashboards.find((d) => d.id === previousId);
      // Clears maximizedCardId for the same reason setActive does: this is a
      // dashboard switch, and the maximized card is on the one being left.
      // The guard above means a no-op swap never reaches here.
      set({
        activeId: previousId,
        previousId: activeId,
        activeTabId: target?.tabs[0]?.id ?? null,
        maximizedCardId: null,
      });
    },

    activeDashboard: () => {
      const { dashboards, activeId } = get();
      return dashboards.find((d) => d.id === activeId);
    },

    setActiveTab: (tabId) => {
      // Same early return as setActive, for the same reason: re-selecting the
      // tab you are already on is not a switch, so it must not clear the
      // maximized card. Clicking the active tab's label is an ordinary way to
      // reach the tab strip, and without this it silently un-maximized.
      if (tabId === get().activeTabId) return;
      // Same reason as setActive: the maximized card is on the tab being left.
      set({ activeTabId: tabId, maximizedCardId: null });
    },

    refreshEpoch: 0,

    refreshAll: () => {
      set({ refreshEpoch: get().refreshEpoch + 1 });
    },

    setMaximized: (cardId) => {
      set({ maximizedCardId: cardId });
    },

    // Dialog-driven CRUD below persists before set(): the write is invisible
    // to the user anyway, and this keeps memory from ever diverging from disk
    // on a failed write (no rollback bookkeeping needed).

    addDashboard: async (name) => {
      if (refuse("addDashboard")) return null;
      const dashboard: Dashboard = {
        id: crypto.randomUUID(),
        name,
        tabs: [{ id: crypto.randomUUID(), name: "Main", cards: [] }],
      };
      await saveDashboard(dashboard);
      set({ dashboards: [...get().dashboards, dashboard] });
      return dashboard.id;
    },

    renameDashboard: async (id, name) => {
      if (refuse("renameDashboard")) return;
      const target = get().dashboards.find((d) => d.id === id);
      if (!target) return;
      const updated = nextRevision({ ...target, name }, target);
      await saveDashboard(updated);
      set({ dashboards: get().dashboards.map((d) => (d.id === id ? updated : d)) });
    },

    /**
     * Every id is regenerated. The group remap is what keeps a copied card's
     * bindings pointing at the COPY's groups: without it, editing a group on
     * the copy would move the original's cards too.
     *
     * Folder placement and settings.dashboardOrder are the caller's job (the
     * rail does both) — this store knows about neither.
     */
    duplicateDashboard: async (id) => {
      if (refuse("duplicateDashboard")) return null;
      const source = get().dashboards.find((d) => d.id === id);
      if (!source) return null;

      const groupIdMap = new Map((source.groups ?? []).map((g) => [g.id, crypto.randomUUID()]));
      const copy: Dashboard = {
        id: crypto.randomUUID(),
        name: `${source.name} copy`,
        groupsDisabled: source.groupsDisabled,
        tabs: source.tabs.map((t) => ({
          id: crypto.randomUUID(),
          name: t.name,
          cards: t.cards.map((c) => ({
            ...c,
            id: crypto.randomUUID(),
            params: { ...c.params },
            layout: { ...c.layout },
            bindings: c.bindings?.map((b) => ({
              ...b,
              groupId: groupIdMap.get(b.groupId) ?? b.groupId,
            })),
          })),
        })),
        groups: source.groups?.map((g) => ({ ...g, id: groupIdMap.get(g.id) ?? g.id })),
      };

      await saveDashboard(copy);
      // `source` was read before this await, so the array it came from is a
      // stale snapshot: anything that resolved while the write was in flight
      // — a param Apply, a rename — is already in the store, and splicing
      // that snapshot back would silently revert it. Position is recomputed
      // from a fresh read instead. A concurrent delete of the original leaves
      // nothing to insert after, so the copy goes to the end.
      const current = get().dashboards;
      const at = current.findIndex((d) => d.id === id);
      const next = [...current];
      next.splice(at < 0 ? current.length : at + 1, 0, copy);
      set({
        dashboards: next,
        activeId: copy.id,
        previousId: get().activeId,
        activeTabId: copy.tabs[0]?.id ?? null,
        // A switch, so the maximized card (on the one being left) clears, as
        // setActive's does.
        maximizedCardId: null,
      });
      return copy.id;
    },

    applySynced: async (upserts, removals) => {
      if (refuse("applySynced")) return;
      for (const d of upserts) await saveDashboard(d);
      const byId = new Map(upserts.map((d) => [d.id, d]));
      const { dashboards, activeId } = get();
      const active = activeId === null ? undefined : byId.get(activeId);
      set({
        dashboards: [...dashboards.map((d) => byId.get(d.id) ?? d), ...upserts.filter((u) => !dashboards.some((d) => d.id === u.id))],
        // A replaced active dashboard has new tab and card ids, as after an import's Replace.
        ...(active ? { activeTabId: active.tabs[0]?.id ?? null, maximizedCardId: null } : {}),
      });
      for (const id of removals) await get().removeDashboard(id);
    },
    setGroupsDisabled: async (id, disabled) => {
      await mutateDashboard(id, (d) => ({ ...d, groupsDisabled: disabled }));
    },

    createGroup: async (cardId, paramName, groupType, value) => {
      if (refuse("createGroup")) return null;
      const id = crypto.randomUUID();
      const updated = await mutateActive((d) => {
        const group = { id, name: nextGroupName(d.groups), paramName, groupType, value };
        const withCard = updateCardInDashboard(d, cardId, (c) => bind(c, id, paramName));
        return { ...withCard, groups: [...(d.groups ?? []), group] };
      });
      return updated ? id : null;
    },

    joinGroup: async (groupId, cardId, paramName) => {
      if (refuse("joinGroup")) return;
      await mutateActive((d) => {
        if (!d.groups?.some((g) => g.id === groupId)) return d;
        return updateCardInDashboard(d, cardId, (c) => bind(c, groupId, paramName));
      });
    },

    leaveGroup: async (cardId, paramName) => {
      if (refuse("leaveGroup")) return;
      await mutateActive((d) =>
        updateCardInDashboard(d, cardId, (c) => {
          const binding = c.bindings?.find((b) => b.paramName === paramName);
          const group = d.groups?.find((g) => g.id === binding?.groupId);
          if (!binding) return c;
          // A binding whose group is already gone has no value to hand back;
          // the card's own stored value is what it has been showing — read
          // off its STORAGE key, which for a form field is `<form>.<field>`
          // and not the bare param name.
          return unbind(c, paramName, group?.value ?? c.params[keysForName(c, paramName)[0]] ?? "");
        }),
      );
    },

    renameGroup: async (groupId, name) => {
      if (refuse("renameGroup")) return;
      await mutateActive((d) => ({
        ...d,
        groups: d.groups?.map((g) => (g.id === groupId ? { ...g, name } : g)),
      }));
    },

    deleteGroup: async (groupId) => {
      if (refuse("deleteGroup")) return;
      await mutateActive((d) => {
        const group = d.groups?.find((g) => g.id === groupId);
        if (!group) return d;
        return {
          ...d,
          groups: d.groups!.filter((g) => g.id !== groupId),
          tabs: d.tabs.map((t) => ({
            ...t,
            cards: t.cards.map((c) =>
              // EVERY binding to the group, not just the first: one left
              // behind would dangle at a group that no longer exists, and
              // its control would silently go back to the card's own stale
              // value instead of the one the group was holding.
              (c.bindings ?? [])
                .filter((b) => b.groupId === groupId)
                .reduce((acc, b) => unbind(acc, b.paramName, group.value), c),
            ),
          })),
        };
      });
    },

    /**
     * The dashboards are built by importApps, which is pure — this is only
     * the persist-and-publish half. It lives in the store rather than in the
     * rail so the viewer guard and the persist-before-set ordering apply to
     * an import exactly as they do to every other creation.
     */
    importDashboards: async (imported) => {
      if (refuse("importDashboards")) return;
      // Defence in depth behind the rail's own check, which is the one that
      // shows the user a notice. This refuses the same cap for any future
      // caller, so a new entry point cannot bypass it. Counts only: an
      // imported dashboard carries every param value its author typed.
      if (imported.length > IMPORT_MAX_DASHBOARDS) {
        await logError(
          `refused an import of ${imported.length} dashboards; the limit is ${IMPORT_MAX_DASHBOARDS}`,
        );
        return;
      }
      // Persist-before-set still holds per dashboard, but a write failing at
      // k of n must not strand 1..k-1: they are on disk, so they are published
      // to memory too (the finally), and the failure still rejects to the
      // caller. Without this a retry imported them a second time.
      const saved: Dashboard[] = [];
      try {
        for (const dashboard of imported) {
          await saveDashboard(dashboard);
          saved.push(dashboard);
        }
      } finally {
        const first = saved[0];
        if (first) {
          set({
            dashboards: [...get().dashboards, ...saved],
            activeId: first.id,
            previousId: get().activeId,
            activeTabId: first.tabs[0]?.id ?? null,
            maximizedCardId: null,
          });
        }
      }
    },

    replaceDashboardContents: async (id, imported) => {
      if (refuse("replaceDashboardContents")) return;
      const target = get().dashboards.find((d) => d.id === id);
      if (!target) return;
      // The server shell stays (template, type, its index): this is still the same server item.
      const updated: Dashboard = nextRevision({ ...imported, id, name: target.name, extensions: target.extensions }, target);
      await saveDashboard(updated);
      // The old tab and card ids are gone, so the active dashboard reopens on
      // its new first tab and nothing stays maximized.
      const { dashboards, activeId } = get();
      set({
        dashboards: dashboards.map((d) => (d.id === id ? updated : d)),
        ...(activeId === id
          ? { activeTabId: updated.tabs[0]?.id ?? null, maximizedCardId: null }
          : {}),
      });
      await deleteDiscardedFiles(target.tabs.flatMap((t) => t.cards));
    },

    removeDashboard: async (id) => {
      if (refuse("removeDashboard")) return;
      removing.add(id);
      try {
        await deleteDashboardFile(id);
      } catch (err) {
        removing.delete(id);
        throw err;
      }
      const { dashboards, activeId, activeTabId } = get();
      const discarded = dashboards.find((d) => d.id === id)?.tabs.flatMap((t) => t.cards) ?? [];
      const remaining = dashboards.filter((d) => d.id !== id);
      const wasActive = activeId === id;
      const nextActiveId = wasActive ? (remaining[0]?.id ?? null) : activeId;
      set({
        dashboards: remaining,
        activeId: nextActiveId,
        activeTabId: wasActive
          ? (remaining.find((d) => d.id === nextActiveId)?.tabs[0]?.id ?? null)
          : activeTabId,
        // Its maximized card went with it.
        maximizedCardId: wasActive ? null : get().maximizedCardId,
      });
      // Out of memory now, so mutateDashboard finds nothing to write.
      removing.delete(id);
      await deleteDiscardedFiles(discarded);
    },

    addTab: async (name) => {
      const tab: DashboardTab = { id: crypto.randomUUID(), name, cards: [] };
      const updated = await mutateActive((d) => ({ ...d, tabs: [...d.tabs, tab] }));
      if (updated && get().activeTabId === null) {
        set({ activeTabId: tab.id });
      }
      return updated ? tab.id : null;
    },

    renameTab: async (tabId, name) => {
      await mutateActive((d) => ({
        ...d,
        tabs: d.tabs.map((t) => (t.id === tabId ? { ...t, name } : t)),
      }));
    },

    /** Mirrors removeDashboard's own activeId-on-removal precedent, one level down. */
    removeTab: async (tabId) => {
      const wasActive = get().activeTabId === tabId;
      // Read BEFORE the mutation drops the tab: its cards go with it.
      const discarded =
        get()
          .dashboards.find((d) => d.id === get().activeId)
          ?.tabs.find((t) => t.id === tabId)?.cards ?? [];
      const updated = await mutateActive((d) => ({
        ...d,
        tabs: d.tabs.filter((t) => t.id !== tabId),
      }));
      if (updated && wasActive) {
        set({ activeTabId: updated.tabs[0]?.id ?? null });
      }
      await deleteDiscardedFiles(discarded);
    },

    /**
     * The given order IS the new order: ids that name no tab are dropped, and
     * TabBar always passes the full list.
     *
     * Nothing re-points activeTabId: reordering does not change which tab is
     * showing, unlike removeTab above. And this is mutateActive rather than a
     * bare set() because tab order IS the tabs array inside the dashboard
     * file -- so a drop is one write, and the viewer window applies it in
     * memory and persists nothing.
     */
    reorderTabs: async (orderedIds) => {
      await mutateActive((d) => {
        const byId = new Map(d.tabs.map((t) => [t.id, t]));
        return {
          ...d,
          tabs: orderedIds
            .map((id) => byId.get(id))
            .filter((t): t is DashboardTab => t !== undefined),
        };
      });
    },

    addCardTo: async (dashboardId, tabId, widget, paramsOverride) => {
      const dashboard = get().dashboards.find((d) => d.id === dashboardId);
      const tab = dashboard?.tabs.find((t) => t.id === tabId);
      if (!tab) return null;

      const cardId = crypto.randomUUID();
      const updated = await mutateDashboard(dashboardId, (d) => ({
        ...d,
        tabs: d.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                cards: [
                  ...t.cards,
                  {
                    id: cardId,
                    widgetId: widget.id,
                    backendId: widget.backendId,
                    params: { ...seedParams(widget), ...paramsOverride },
                    layout: {
                      x: 0,
                      y: nextY(t.cards),
                      w: widget.gridData.w,
                      h: widget.gridData.h,
                    },
                  },
                ],
              }
            : t,
        ),
      }));
      return updated ? cardId : null;
    },

    // Delegates so the persist ordering lives in exactly one place; two copies
    // of it would eventually diverge.
    addCard: async (widget, paramsOverride) =>
      get().addCardTo(get().activeId, get().activeTabId, widget, paramsOverride),

    /**
     * Card and position are the same object, so removal cannot leave an
     * orphaned layout entry, and the remaining cards are copied unchanged.
     */
    removeCard: async (cardId) => {
      // Read BEFORE the mutation removes it: deleteDiscardedFiles needs the
      // card the removal discarded, and by then it is gone.
      const card = get()
        .dashboards.find((d) => d.id === get().activeId)
        ?.tabs.flatMap((t) => t.cards)
        .find((c) => c.id === cardId);
      await mutateActive((d) => updateCardInDashboard(d, cardId, () => null));
      await deleteDiscardedFiles(card ? [card] : []);
    },

    /** Exactly one batched write per layout change, never one per moved item. */
    updateLayouts: async (layouts) => {
      const byId = new Map(layouts.map((l) => [l.i, l]));
      await mutateActive((d) => ({
        ...d,
        tabs: d.tabs.map((t) => ({
          ...t,
          cards: t.cards.map((c) => {
            const l = byId.get(c.id);
            return l ? { ...c, layout: { x: l.x, y: l.y, w: l.w, h: l.h } } : c;
          }),
        })),
      }));
    },

    /**
     * Both halves of an Apply land in one mutation so the dashboard is written
     * exactly once. Two store calls would persist it twice and, on the group
     * half, refetch every member card a second time.
     *
     * `groups` keeps its existing array reference unless a groupEdit actually
     * matches a group on this dashboard: WidgetCard memoises effective params
     * on that reference, so rebuilding it unconditionally (as Array.map
     * always does) would refetch every other card on the dashboard.
     *
     * When cardId names no card on this dashboard AND no groupEdit matches an
     * existing group, there is nothing to apply at all — skip the mutation
     * (and the write) entirely rather than persisting a no-op dashboard.
     * A call can still legitimately name an unknown cardId while carrying
     * groupEdits for groups that DO exist (e.g. a stale/removed card whose
     * group survives it), so that case must still apply and write.
     */
    applyCardParams: async (cardId, edit) => {
      const active = get().dashboards.find((d) => d.id === get().activeId);
      if (!active) return;
      const cardExists = active.tabs.some((t) => t.cards.some((c) => c.id === cardId));
      const groupsChanged =
        active.groups?.some((g) => edit.groupEdits.some((e) => e.groupId === g.id)) ?? false;
      if (!cardExists && !groupsChanged) return;

      await mutateActive((d) => {
        const withParams = updateCardInDashboard(d, cardId, (c) => ({
          ...c,
          params: edit.cardParams,
        }));
        return {
          ...withParams,
          groups: groupsChanged
            ? withParams.groups?.map((g) => {
                const change = edit.groupEdits.find((e) => e.groupId === g.id);
                return change ? { ...g, value: change.value } : g;
              })
            : withParams.groups,
        };
      });
    },

    setCardMinimized: async (cardId, minimized) => {
      await mutateActive((d) => updateCardInDashboard(d, cardId, (c) => ({ ...c, minimized })));
    },

    patchCardField: async (cardId, field, value) => {
      await mutateActive((d) =>
        updateCardInDashboard(d, cardId, (c) => {
          const next = { ...c };
          // Deleted, not assigned undefined: JSON.stringify would drop the key
          // anyway, but in memory the difference is observable and `"title" in
          // card` is what the rest of the app asks.
          if (value === null) delete next[field];
          else if (field === "table") next.table = { ...c.table, ...(value as Partial<TableCardState>) };
          else Object.assign(next, { [field]: value });
          return next;
        }),
      );
    },

    reorderDashboards: (orderedIds) => {
      const byId = new Map(get().dashboards.map((d) => [d.id, d]));
      const listed = orderedIds
        .map((id) => byId.get(id))
        .filter((d): d is Dashboard => d !== undefined);
      const listedIds = new Set(orderedIds);
      const unlisted = get().dashboards.filter((d) => !listedIds.has(d.id));
      set({ dashboards: [...listed, ...unlisted] });
    },
  };
});
