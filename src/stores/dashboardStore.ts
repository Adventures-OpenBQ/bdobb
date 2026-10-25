import { validatePivotGroupPlan, type PivotGroupPlan } from '../lib/pivotGroupChange';
import type { PivotGroupProofContext } from '../lib/tableExecution/pivotGroupProof';
import { reservedPivotName } from '../lib/paramGroups';
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { LinkedChartSettings } from "../lib/widgetData/types";
import { canUseLinkedSource } from "../lib/widgetData/sources";
import { remapWidgetReferences } from "../lib/widgetData/persistence";
import { validateTableModel } from "../lib/tableExecution/validation";
import type { TableDefinition, SelectionSpec } from "../lib/tableExecution/types";
import { create } from "zustand";
import { pinResolvedBackends } from "../lib/appsJson";
import { BUILTIN_BACKEND_ID, BUILTIN_WIDGETS, LINKED_TABLE_ID, LINKED_CHART_ID, LOCAL_TABLE_ID } from "../lib/builtins";
import {
  deleteDashboard as deleteDashboardFile,
  loadDashboard,
  loadDashboards,
  saveDashboard,
} from "../lib/dashboardsFile";
import { IMPORT_MAX_DASHBOARDS } from "../lib/importLimits";
import { deleteLocalFile } from "../lib/localFiles";
import { logError, logInfo, logOnce } from "../lib/logger";
import { effectiveParams, nextGroupName, type ParamEdit } from "../lib/paramGroups";
import { fiscalChain } from "../lib/fiscalChain";
import { isFiscalType, parseFyEndMonth, relabel } from "../lib/periods";
import { bindableKeys, seedParams } from "../lib/params";
import { cardSourceIdentity } from "../lib/cardSourceIdentity";
import { withOptional } from "../lib/collections";
import type {
  ParamGroup,
  CardView,
  Dashboard,
  DashboardCard,
  DashboardTab,
  TableCardState,
  WidgetDef,
} from "../lib/types";
import { useWidgetRegistryStore } from "./widgetRegistryStore";

export type TableCommitGuard = {
  expected: Pick<DashboardCard, 'table' | 'tableDefinition' | 'tableSelection'>;
  isCurrent: () => boolean;
  beforePublish: () => void;
};
export type PivotGroupUndo = { readonly token: object };
export type PivotGroupCommitResult = { status: 'saved'; undo: PivotGroupUndo; writes: number } | { status: 'refused' | 'failed'; message: string; writes: number; durableUncertain?: boolean };
export type PivotGroupUndoResult = { status: 'saved'; writes: number } | { status: 'refused' | 'failed'; message: string; writes: number; durableUncertain?: boolean };
export type PivotGroupCommitGuard = {
  proofContext: PivotGroupProofContext;
  expectedTable: DashboardCard['table'];
  isCurrent: () => boolean;
  isSessionCurrent: () => boolean;
  subscribeSession: (listener: () => void) => () => void;
  beforePublish: (dashboard: Dashboard) => void;
};
export type PivotGroupUndoGuard = Pick<PivotGroupCommitGuard, 'isCurrent' | 'beforePublish'> & { dashboardId: string; cardId: string };
type PivotFields = Pick<DashboardCard, 'table' | 'tableDefinition' | 'tableSelection'>;
type PivotPatch = { fields: PivotFields; binding: DashboardCard['bindings']; groups: PivotGroupPlan['groupChanges'] };
type PivotUndoEntry = { dashboardId: string; cardId: string; paramKey: string; before: PivotPatch; after: PivotPatch; groupsDisabled: boolean; groupExpected: { id: string; record: ParamGroup | undefined }[]; source: string; session: () => boolean; release: () => void; createdId?: string };
const pivotEqual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
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
  /**
   * Re-read one dashboard from disk, keeping the current selection. The
   * viewer window's answer to the dashboard-changed event: `load` cannot be
   * reused because it resets activeId to the first dashboard, which in a
   * viewer means jumping off the one dashboard it exists to show.
   */
  syncDashboard: (id: string) => Promise<void>;
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
   * v5.4.0 (spec §5): the dashboard's default exchange from the rail menu;
   * `null` (Default) removes the field. Like setGroupsDisabled it goes
   * through mutateDashboard, so a viewer window applies it in memory only.
   */
  setDashboardExchange: (id: string, exchange: string | null) => Promise<void>;
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
  /**
   * `handBack` is the group's value as the leaving control shows it — for a
   * quarter / fiscal-year group, the December label relabelled under that
   * control's year end. Without it the group's stored value is kept as is.
   */
  leaveGroup: (cardId: string, paramName: string, handBack?: string) => Promise<void>;
  /**
   * v5.4.0 (spec §4.3; ruling 4): unbind params the card's widget marks
   * `groupable: false`. Unlike leaveGroup nothing is handed back — the
   * param keeps the card's own value — and each is named once in the log.
   */
  dropUngroupable: (cardId: string, paramNames: string[]) => Promise<void>;
  renameGroup: (groupId: string, name: string) => Promise<void>;
  deleteGroup: (groupId: string) => Promise<void>;
  /**
   * The dashboard's saved relative presets (spec §4): save appends, or
   * replaces the entry with the same name in place; delete removes by name
   * and drops the field when nothing remains. Both write once through
   * mutateActive, and the viewer window refuses both.
   */
  savePreset: (name: string, expr: string) => Promise<void>;
  deletePreset: (name: string) => Promise<void>;
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
  addLinkedCard: (input: { dashboardId: string; tabId: string; sourceWidgetId: string; presentation: "table" | "chart" }) => Promise<string | null>;
  commitLinkedChartSettings: (dashboardId: string, cardId: string, settings: LinkedChartSettings) => Promise<boolean>;
  replaceLinkedSource: (cardId: string, sourceWidgetId: string) => Promise<boolean>;
  removeCard: (cardId: string) => Promise<void>;
  /**
   * One session-only removal. Bytes remain owned until undo or release.
   * Process exit loses this entry; retained unreferenced bytes may remain on
   * disk. There is no durable undo journal or startup orphan sweep.
   */
  pendingCardRemoval: { dashboardId: string; tabId: string; index: number; card: DashboardCard } | null;
  applyPivotGroupChange: (dashboardId: string, cardId: string, plan: PivotGroupPlan, guard: PivotGroupCommitGuard) => Promise<PivotGroupCommitResult>;
  undoPivotGroupChange: (undo: PivotGroupUndo, guard: PivotGroupUndoGuard) => Promise<PivotGroupUndoResult>;
  commitTableDefinition: (dashboardId: string, cardId: string, definition: TableDefinition, selection: SelectionSpec, guard?: TableCommitGuard) => Promise<boolean>;
  undoCardRemoval: () => Promise<void>;
  dismissCardRemoval: () => Promise<void>;
  /** A copy of the card on its own tab, placed below everything there. Bindings are not copied: a group binding belongs to one card. */
  duplicateCard: (cardId: string) => Promise<string | null>;
  /** The same copy, appended to `tabId` of `dashboardId` (any dashboard, not only the active one). */
  copyCardTo: (cardId: string, dashboardId: string, tabId: string) => Promise<string | null>;
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
  /** Clear only the deleted source, checked inside the serialized dashboard write. */
  clearManagedSource: (cardId: string, backendId: string, sourceId: string) => Promise<void>;
  patchCardField: <K extends CardField>(
    cardId: string,
    field: K,
    value: CardFieldPatch[K] | null,
  ) => Promise<void>;
};

/** The three optional card fields `patchCardField` sets, and what each takes. */
// v5.4.0: a fourth, `fiscalYearEnd` — the card's FY ends override (spec §1.5).
// v5.5.1: a fifth, `hideTitleParams` — the Parameters popover's title-bar checkbox.
type CardFieldPatch = {
  managedSource: import("../lib/types").ManagedSourceReference;
  view: CardView;
  title: string;
  table: Partial<TableCardState>;
  /** v5.4.0: the FY ends override; `null` (Automatic) deletes it. */
  fiscalYearEnd: number;
  /** v5.5.1: "Display on title bar" unchecked; `null` (checked) deletes it. */
  hideTitleParams: boolean;
  /** v5.5.1: the Parameters panel is docked open; `null` (closed) deletes it. */
  paramsOpen: boolean;
  calendar: Partial<import("../lib/types").CalendarCardState>;
};
type CardField = keyof CardFieldPatch;

/**
 * A dashboard's place in `listed`; an unlisted one ranks past every listed
 * one, and two unlisted ones rank EQUAL, so a stable sort keeps their order.
 */
function rank(id: string, listed: string[]): number {
  const i = listed.indexOf(id);
  return i === -1 ? listed.length : i;
}

function nextY(cards: DashboardCard[]): number {
  return cards.reduce((max, c) => Math.max(max, c.layout.y + c.layout.h), 0);
}

/** The card and where it lives, or null. */
function findCard(
  dashboards: Dashboard[],
  cardId: string,
): { dashboard: Dashboard; tab: DashboardTab; card: DashboardCard } | null {
  for (const dashboard of dashboards)
    for (const tab of dashboard.tabs) {
      const card = tab.cards.find((c) => c.id === cardId);
      if (card) return { dashboard, tab, card };
    }
  return null;
}

/**
 * What a copy carries: everything but identity, position and group bindings,
 * cloned rather than spread through -- a shared nested object (params, table,
 * table definition…) would let an in-place edit to one card corrupt the other.
 */
function copyOf(card: DashboardCard, cards: DashboardCard[]): DashboardCard {
  const { id: _id, bindings: _bindings, layout, ...rest } = card;
  return { ...structuredClone(rest), id: crypto.randomUUID(), layout: { ...layout, x: 0, y: nextY(cards) } };
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
  if(reservedPivotName(paramName))return [];
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
  return withOptional<DashboardCard, "bindings">({ ...card, params }, "bindings", bindings.length > 0 ? bindings : undefined);
}

/**
 * What a member keeps when its group is deleted: the group's value, and for a
 * quarter / fiscal-year param that value relabelled from December under the
 * member's year end, so the period it shows does not move (see leaveGroup).
 *
 * The store has no async map, so the year end comes from the synchronous
 * sources alone (nonEndpointFiscalYearEnd), read off the card's EFFECTIVE
 * params. A member whose year end comes from `fiscalYearEndEndpoint` cannot
 * await that fetch here and falls back to those sources — December when it
 * declares no other — so such a member can still shift on delete.
 *
 * v5.4.0 (spec §1.5): the synchronous sources are now fiscalChain's with no
 * endpoint answers — the card's FY ends override, the param's own fields,
 * the widget's, then December. The built-in per-ticker lookup is async and
 * stays out of the store, so a member whose year end came from it shifts on
 * delete exactly as an endpoint-fed one does.
 */
function deleteHandBack(dashboard: Dashboard, card: DashboardCard, paramName: string, value: string): string {
  const widget = useWidgetRegistryStore.getState().widgets.find((w) => w.id === card.widgetId);
  const param = widget?.params.find((p) => p.paramName === paramName);
  if (!widget || !param || !isFiscalType(param.type)) return value;
  const values = effectiveParams(card, dashboard.groups, widget, dashboard.groupsDisabled ?? false);
  const step = fiscalChain(param, widget, values, { override: parseFyEndMonth(card.fiscalYearEnd) });
  return relabel(value, 12, "month" in step ? step.month : 12);
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
  // Serialize only destructive lifecycle operations and explicit durable commits.
  // Their snapshots must include the preceding committed deletion/restoration.
  let lifecycleTail: Promise<unknown> = Promise.resolve();
  function lifecycle<T>(work: () => Promise<T>): Promise<T> {
    const result = lifecycleTail.then(work);
    lifecycleTail = result.catch(() => undefined);
    return result;
  }
  async function releaseRemoval(): Promise<void> {
    const entry = get().pendingCardRemoval;
    if (!entry || get().viewer) return;
    set({ pendingCardRemoval: null });
    await deleteDiscardedFiles([entry.card]);
  }

  /**
   * Dashboards whose file removeDashboard is deleting right now. The delete
   * is awaited before the dashboard leaves memory (persist-before-set), so a
   * card change in that window still finds it, and its save -- queued behind
   * the delete on the same path -- would write the file straight back.
   * mutateDashboard skips the write for an id in here.
   */
  const removing = new Set<string>();

  /**
   * The ONLY two ways this store writes a dashboard file (bdobb#41;
   * dashboardRevision.test.ts counts the calls). An edit to existing content
   * goes through saveEdit, which writes it one revision on from `prev`, so the
   * sync uploads it; a write that is not such an edit -- a new dashboard, an
   * import, the sync's own state -- goes through saveAsIs.
   */
  async function saveEdit(next: Dashboard, prev: Dashboard): Promise<Dashboard> {
    const updated = nextRevision(next, prev);
    await saveDashboard(updated);
    return updated;
  }
  async function saveAsIs(dashboard: Dashboard): Promise<void> {
    await saveDashboard(dashboard);
  }
  /** After an edit's durable write, carry its revision into memory, never backwards. */
  const keepRevision = (d: Dashboard, saved: Dashboard): Dashboard => ({ ...d, revision: Math.max(d.revision ?? 0, saved.revision ?? 0) });

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
    const edited = pinResolvedBackends(fn(current), useWidgetRegistryStore.getState().widgets);
    // Memory first (optimistic); saveEdit writes the same revision.
    const updated = nextRevision(edited, current);
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
    // Keep the optimistic UI change above. A destructive operation may still
    // be saving; only its committed state can be used by the next file write.
    // `latest` already carries this edit's revision (nextRevision, set above),
    // so it is written as it stands (bdobb#41).
    await lifecycleTail;
    const latest = get().dashboards.find(d => d.id === updated.id);
    if (latest && !removing.has(updated.id)) await saveAsIs(latest);
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

  const pivotUndos = new WeakMap<object, PivotUndoEntry>();
  let latestPivotUndo: object | undefined;
  const pivotCard = (d: Dashboard, id: string) => d.tabs.flatMap(t => t.cards).find(c => c.id === id);
  const pivotFields = (c: DashboardCard): PivotFields => ({ table: c.table, tableDefinition: c.tableDefinition, tableSelection: c.tableSelection });
  const pivotBinding = (c: DashboardCard, key: string) => (c.bindings ?? []).filter(b => b.paramName === key);
  const patchPivot = (d: Dashboard, id: string, key: string, patch: PivotPatch): Dashboard => {
    const withCard = updateCardInDashboard(d, id, c => ({ ...c, ...structuredClone(patch.fields), bindings: [...(c.bindings ?? []).filter(b => b.paramName !== key), ...structuredClone(patch.binding ?? [])] }));
    if (!patch.groups.length) return withCard;
    const groups = [...(withCard.groups ?? [])];
    for (const change of patch.groups) {
      const index = groups.findIndex(g => g.id === change.id);
      if (change.after) { if (index < 0) groups.push(structuredClone(change.after)); else groups[index] = structuredClone(change.after); }
      else if (index >= 0) groups.splice(index, 1);
    }
    return { ...withCard, groups };
  };
  // Three combined candidate writes bound unrelated optimistic churn. Correction
  // is separately bounded; failure never claims the old durable intent restored.
  const runPivotWrite = async (id: string, cardId: string, key: string, patch: PivotPatch, current: () => boolean, publish: (dashboard: Dashboard) => void): Promise<PivotGroupUndoResult> => {
    let writes = 0, savedCandidate = false;
    const restore = async (): Promise<PivotGroupUndoResult> => {
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const latest = get().dashboards.find(d => d.id === id);
          if (!latest || removing.has(id)) return { status: 'refused', message: 'Dashboard is no longer available.', writes };
          const snapshot = structuredClone(latest); writes++; await saveAsIs(snapshot);
          if (pivotEqual(snapshot, get().dashboards.find(d => d.id === id))) return { status: 'refused', message: 'Group intent changed while saving; no change published.', writes };
        }
        return { status: 'failed', message: 'Concurrent edits prevented durable restoration; saved state is uncertain.', writes, durableUncertain: true };
      } catch { return { status: 'failed', message: 'Could not restore current durable intent; saved state is uncertain.', writes, durableUncertain: true }; }
    };
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!current()) return writes ? restore() : { status: 'refused', message: 'Group intent is stale or unavailable.', writes };
        const latest = get().dashboards.find(d => d.id === id)!;
        const before = structuredClone(latest), candidate = patchPivot(latest, cardId, key, patch);
        writes++; const saved = await saveEdit(candidate, latest); savedCandidate = true;
        if (!current()) return restore();
        if (!pivotEqual(before, get().dashboards.find(d => d.id === id))) continue;
        publish(saved);
        set(state => ({ dashboards: state.dashboards.map(d => d.id === id ? keepRevision(patchPivot(d, cardId, key, patch), saved) : d) }));
        return { status: 'saved', writes };
      }
      return restore();
    } catch {
      if (savedCandidate) { const restored = await restore(); return restored.status === 'failed' ? restored : { status: 'failed', message: 'Could not save group change; current durable intent restored.', writes }; }
      return { status: 'failed', message: 'Could not save group change.', writes };
    }
  };

  const mutateActive = (fn: (d: Dashboard) => Dashboard) => mutateDashboard(get().activeId, fn);

  /**
   * The state of a dashboard switch. maximizedCardId names a card on the
   * dashboard being left, so it clears rather than dangles.
   */
  const switchTo = (id: string, target: Dashboard | undefined) => ({
    activeId: id,
    previousId: get().activeId,
    activeTabId: target?.tabs[0]?.id ?? null,
    maximizedCardId: null,
  });

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
    const isStoredFileCard = (c: DashboardCard) =>
      c.backendId === BUILTIN_BACKEND_ID && c.widgetId === LOCAL_TABLE_ID && !!c.params.file;
    const stillNamed = (file: string) =>
      get().pendingCardRemoval?.card.params.file === file ||
      get().dashboards.flatMap((d) => d.tabs.flatMap((t) => t.cards)).some((c) => isStoredFileCard(c) && c.params.file === file);
    // Keyed by file so two discarded cards naming one file delete it once;
    // the value is the first card holding it, which is all the log needs.
    const byFile = new Map<string, string>();
    for (const c of discarded) {
      if (isStoredFileCard(c) && !byFile.has(c.params.file)) byFile.set(c.params.file, c.id);
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
    pendingCardRemoval: null,
    viewer: false,

    load: async (order) => {
      const dashboards = await loadDashboards();
      // loadDashboards() already returns dashboards sorted alphabetically by
      // name, which is exactly the fallback this needs for any dashboard not
      // named in `order`: an unlisted dashboard ranks past every listed one,
      // and two unlisted ones rank EQUAL, so Array.prototype.sort's ES2019+
      // stability leaves them in their existing (alphabetical) relative order
      // with no tiebreak logic here.
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

    syncDashboard: async (id) => {
      let fresh: Dashboard | null;
      try {
        fresh = await loadDashboard(id);
      } catch (err) {
        // An unreadable file says nothing about the dashboard, so the version
        // this window holds stays on screen; App does not await this call.
        await logError(`failed to sync dashboard ${id}: ${err}`);
        return;
      }
      const { dashboards, activeTabId } = get();
      // Deleted on the other side: drop it and leave the selection alone --
      // App already renders an empty state for an activeId that is gone, and
      // inventing a different dashboard to show would be worse than nothing.
      if (!fresh) {
        set({ dashboards: dashboards.filter((d) => d.id !== id) });
        return;
      }
      // A tab can vanish with the change that arrived, so the held tab id is
      // only kept while it still names a tab on the dashboard just read.
      const keepsTab = fresh.tabs.some((t) => t.id === activeTabId);
      set({
        dashboards: dashboards.some((d) => d.id === id)
          ? dashboards.map((d) => (d.id === id ? fresh : d))
          : [...dashboards, fresh],
        ...(id === get().activeId && !keepsTab ? { activeTabId: fresh.tabs[0]?.id ?? null } : {}),
      });
    },

    setActive: (id) => {
      // Re-selecting the SAME dashboard is not a switch, so it keeps the
      // maximized card.
      if (id === get().activeId) return;
      set(switchTo(id, get().dashboards.find((d) => d.id === id)));
    },

    /** Option+0: swap back to wherever you came from. */
    goToPrevious: () => {
      const { previousId, dashboards } = get();
      const target = dashboards.find((d) => d.id === previousId);
      // The guard means a no-op swap never reaches the switch.
      if (!previousId || !target) return;
      set(switchTo(previousId, target));
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

    refreshAll: () => set({ refreshEpoch: get().refreshEpoch + 1 }),

    setMaximized: (cardId) => set({ maximizedCardId: cardId }),

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
      await saveAsIs(dashboard);
      set({ dashboards: [...get().dashboards, dashboard] });
      return dashboard.id;
    },

    renameDashboard: async (id, name) => lifecycle(async () => {
      if (refuse("renameDashboard")) return;
      const target = get().dashboards.find((d) => d.id === id);
      if (!target || removing.has(id)) return;
      const updated = await saveEdit({ ...target, name }, target);
      // Reconcile the scalar name (and the sync revision) into the latest
      // owner, preserving card edits published optimistically while the
      // durable rename was in flight.
      set({ dashboards: get().dashboards.map((d) => (d.id === id ? { ...d, name, revision: updated.revision } : d)) });
    }),

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

      const cardIdMap = new Map(source.tabs.flatMap(t => t.cards).map(c => [c.id, crypto.randomUUID()]));
      const groupIdMap = new Map((source.groups ?? []).map((g) => [g.id, crypto.randomUUID()]));
      const copy: Dashboard = {
        id: crypto.randomUUID(),
        name: `${source.name} copy`,
        groupsDisabled: source.groupsDisabled,
        exchange: source.exchange,
        tabs: source.tabs.map((t) => ({
          id: crypto.randomUUID(),
          name: t.name,
          cards: t.cards.map((c) => ({
            ...remapWidgetReferences(c, cardIdMap),
            params: { ...c.params },
            layout: { ...c.layout },
            bindings: c.bindings?.map((b) => ({
              ...b,
              groupId: groupIdMap.get(b.groupId) ?? b.groupId,
            })),
          })),
        })),
        groups: source.groups?.map((g) => ({ ...g, id: groupIdMap.get(g.id) ?? g.id })),
        presets: source.presets?.map((p) => ({ ...p })),
      };

      await saveAsIs(copy);
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
      set({ dashboards: next, ...switchTo(copy.id, copy) });
      return copy.id;
    },

    applySynced: async (upserts, removals) => {
      if (refuse("applySynced")) return;
      const before = new Map(get().dashboards.map((d) => [d.id, d]));
      for (const d of upserts) await saveAsIs(d);
      // A local edit that landed during these writes wins: its save queued
      // behind the synced one, so publishing the synced copy would leave memory
      // reverted and disk ahead. The next sync reconciles it.
      const fresh = upserts.filter((u) => get().dashboards.find((d) => d.id === u.id) === before.get(u.id));
      const byId = new Map(fresh.map((d) => [d.id, d]));
      const { dashboards, activeId } = get();
      const active = activeId === null ? undefined : byId.get(activeId);
      set({
        dashboards: [...dashboards.map((d) => byId.get(d.id) ?? d), ...fresh.filter((u) => !dashboards.some((d) => d.id === u.id))],
        // A replaced active dashboard has new tab and card ids, as after an import's Replace.
        ...(active ? { activeTabId: active.tabs[0]?.id ?? null, maximizedCardId: null } : {}),
      });
      for (const id of removals) await get().removeDashboard(id);
    },
    setGroupsDisabled: async (id, disabled) => {
      await mutateDashboard(id, (d) => ({ ...d, groupsDisabled: disabled }));
    },

    setDashboardExchange: async (id, exchange) => {
      await mutateDashboard(id, (d) => withOptional(d, "exchange", exchange || undefined));
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

    leaveGroup: async (cardId, paramName, handBack) => {
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
          //
          // A September member of a quarter group holding `2026-Q3` shows
          // FY2026-Q4; handed back verbatim it would keep `2026-Q3`, which
          // under September is Apr–Jun — a silent one-quarter shift. GroupLink
          // has the year-end map, so it passes the relabelled value in.
          return unbind(
            c,
            paramName,
            group ? (handBack ?? group.value) : (c.params[keysForName(c, paramName)[0]] ?? ""),
          );
        }),
      );
    },

    dropUngroupable: async (cardId, paramNames) => {
      if (refuse("dropUngroupable")) return;
      await mutateActive((d) =>
        updateCardInDashboard(d, cardId, (c) => {
          const bindings = (c.bindings ?? []).filter((b) => !paramNames.includes(b.paramName));
          return withOptional(c, "bindings", bindings.length > 0 ? bindings : undefined);
        }),
      );
      for (const name of paramNames) {
        void logOnce(`ungroupable:${cardId}:${name}`, `card ${cardId}: ${name} is not groupable; removed from its group`);
      }
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
                .reduce((acc, b) => unbind(acc, b.paramName, deleteHandBack(d, c, b.paramName, group.value)), c),
            ),
          })),
        };
      });
    },

    savePreset: async (name, expr) => {
      if (refuse("savePreset")) return;
      await mutateActive((d) => {
        const presets = d.presets ?? [];
        const at = presets.findIndex((p) => p.name === name);
        return {
          ...d,
          presets: at === -1 ? [...presets, { name, expr }] : presets.map((p, i) => (i === at ? { name, expr } : p)),
        };
      });
    },

    deletePreset: async (name) => {
      if (refuse("deletePreset")) return;
      await mutateActive((d) => {
        const presets = (d.presets ?? []).filter((p) => p.name !== name);
        return withOptional(d, "presets", presets.length > 0 ? presets : undefined);
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
          await saveAsIs(dashboard);
          saved.push(dashboard);
        }
      } finally {
        const first = saved[0];
        if (first) {
          set({ dashboards: [...get().dashboards, ...saved], ...switchTo(first.id, first) });
        }
      }
    },

    replaceDashboardContents: async (id, imported) => lifecycle(async () => {
      if (refuse("replaceDashboardContents") || removing.has(id)) return;
      const target = get().dashboards.find((d) => d.id === id);
      if (!target) return;
      // The server shell stays (template, type, its index): this is still the same server item.
      const updated = await saveEdit({ ...imported, id, name: target.name, extensions: target.extensions }, target);
      // The old tab and card ids are gone, so the active dashboard reopens on
      // its new first tab and nothing stays maximized.
      const { dashboards, activeId } = get();
      set({
        dashboards: dashboards.map((d) => (d.id === id ? updated : d)),
        ...(activeId === id
          ? { activeTabId: updated.tabs[0]?.id ?? null, maximizedCardId: null }
          : {}),
      });
      if (get().pendingCardRemoval?.dashboardId === id) await releaseRemoval();
      await deleteDiscardedFiles(target.tabs.flatMap((t) => t.cards));
    }),

    removeDashboard: async (id) => lifecycle(async () => {
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
      if (get().pendingCardRemoval?.dashboardId === id) await releaseRemoval();
      await deleteDiscardedFiles(discarded);
    }),

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

    /** A tab releases its file owners only after its removal is durable. */
    removeTab: async (tabId) => {
      const dashboardId = get().activeId;
      return lifecycle(async () => {
        if (refuse("removeTab")) return;
        const target = get().dashboards.find(d => d.id === dashboardId);
        const tab = target?.tabs.find(t => t.id === tabId);
        if (!target || !tab || removing.has(target.id)) return;
        const saved = await saveEdit({ ...target, tabs: target.tabs.filter(t => t.id !== tabId) }, target);
        // Keep unrelated optimistic edits, and account for every card removed
        // from this tab, including changes published during the durable write.
        const latest = get().dashboards.find(d => d.id === dashboardId);
        const discarded = [...tab.cards, ...(latest?.tabs.find(t => t.id === tabId)?.cards ?? [])];
        set(state => {
          const dashboards = state.dashboards.map(d => d.id === dashboardId ? keepRevision({ ...d, tabs: d.tabs.filter(t => t.id !== tabId) }, saved) : d);
          const activeTabId = state.activeId === dashboardId && state.activeTabId === tabId
            ? dashboards.find(d => d.id === dashboardId)?.tabs[0]?.id ?? null : state.activeTabId;
          return { dashboards, activeTabId };
        });
        if (get().pendingCardRemoval?.tabId === tabId && get().pendingCardRemoval?.dashboardId === dashboardId) await releaseRemoval();
        await deleteDiscardedFiles(discarded);
      });
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

    addLinkedCard: async ({ dashboardId, tabId, sourceWidgetId, presentation }) => lifecycle(async () => {
      if (refuse("addLinkedCard")) return null;
      const dashboard = get().dashboards.find(d => d.id === dashboardId);
      const tab = dashboard?.tabs.find(t => t.id === tabId);
      const id = crypto.randomUUID();
      if (!dashboard || !tab || removing.has(dashboardId) || !canUseLinkedSource(dashboard, id, sourceWidgetId)) return null;
      const widgetId = presentation === 'chart' ? LINKED_CHART_ID : LINKED_TABLE_ID;
      const widget = BUILTIN_WIDGETS.find(w => w.id === widgetId)!;
      const card: DashboardCard = {
        id, widgetId, backendId: BUILTIN_BACKEND_ID, params: {},
        layout: { x: 0, y: nextY(tab.cards), w: widget.gridData.w, h: widget.gridData.h },
        linkedSource: { kind: 'widget', sourceWidgetId },
        ...(presentation === 'chart' ? { linkedChart: { type: 'column' as const, measures: [], display: 'grouped' as const } } : { tableDefinition: { table: {}, search: '' }, tableSelection: { kind: 'none' as const } }),
      };
      const commit = (d: Dashboard): Dashboard => ({ ...d, tabs: d.tabs.map(t => t.id === tabId ? { ...t, cards: [...t.cards, card] } : t) });
      const saved = await saveEdit(commit(dashboard), dashboard);
      set(state => ({ dashboards: state.dashboards.map(d => d.id === dashboardId ? keepRevision(commit(d), saved) : d) }));
      return id;
    }),

    commitLinkedChartSettings: async (dashboardId, cardId, settings) => {
      const captured = structuredClone(settings);
      return lifecycle(async () => {
        if (refuse("commitLinkedChartSettings")) return false;
        const dashboard = get().dashboards.find(d => d.id === dashboardId);
        const card = dashboard?.tabs.flatMap(t => t.cards).find(c => c.id === cardId);
        if (!dashboard || removing.has(dashboardId) || !card?.linkedSource || !card.linkedChart) return false;
        const commit = (d: Dashboard) => updateCardInDashboard(d, cardId, c => ({ ...c, linkedChart: captured }));
        const saved = await saveEdit(commit(dashboard), dashboard);
        set(state => ({ dashboards: state.dashboards.map(d => d.id === dashboardId ? keepRevision(commit(d), saved) : d) }));
        return true;
      });
    },

    replaceLinkedSource: async (cardId, sourceWidgetId) => {
      // Capture ownership before waiting for the lifecycle queue.
      const dashboardId = get().dashboards.find(d => d.tabs.some(t => t.cards.some(c => c.id === cardId)))?.id;
      return lifecycle(async () => {
        if (refuse("replaceLinkedSource")) return false;
        const dashboard = get().dashboards.find(d => d.id === dashboardId);
        const card = dashboard?.tabs.flatMap(t => t.cards).find(c => c.id === cardId);
        if (!dashboard || removing.has(dashboard.id) || !card?.linkedSource || !canUseLinkedSource(dashboard, cardId, sourceWidgetId)) return false;
        const commit = (d: Dashboard) => updateCardInDashboard(d, cardId, c => ({ ...c, linkedSource: { kind: 'widget', sourceWidgetId } }));
        const saved = await saveEdit(commit(dashboard), dashboard);
        set(state => ({ dashboards: state.dashboards.map(d => d.id === dashboard.id ? keepRevision(commit(d), saved) : d) }));
        return true;
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

    copyCardTo: async (cardId, dashboardId, tabId) => {
      const found = findCard(get().dashboards, cardId);
      const target = get()
        .dashboards.find((d) => d.id === dashboardId)
        ?.tabs.find((t) => t.id === tabId);
      if (!found || !target) return null;
      let newId: string | null = null;
      const updated = await mutateDashboard(dashboardId, (d) => ({
        ...d,
        tabs: d.tabs.map((t) => {
          if (t.id !== tabId) return t;
          const copy = copyOf(found.card, t.cards);
          // A link names a card on its own dashboard; elsewhere it would be a
          // foreign reference that blocks every table there.
          if (found.dashboard.id !== dashboardId) { delete copy.linkedSource; delete copy.linkedChart; }
          newId = copy.id;
          return { ...t, cards: [...t.cards, copy] };
        }),
      }));
      return updated ? newId : null;
    },

    duplicateCard: async (cardId) => {
      const found = findCard(get().dashboards, cardId);
      if (!found) return null;
      return get().copyCardTo(cardId, found.dashboard.id, found.tab.id);
    },

    /**
     * Card and position are the same object, so removal cannot leave an
     * orphaned layout entry, and the remaining cards are copied unchanged.
     */
    removeCard: async (cardId) => {
      const dashboardId = get().activeId;
      return lifecycle(async () => {
        if (refuse("removeCard")) return;
        const dashboard = get().dashboards.find(d => d.id === dashboardId);
        const tab = dashboard?.tabs.find(t => t.cards.some(c => c.id === cardId));
        const index = tab?.cards.findIndex(c => c.id === cardId) ?? -1;
        if (!dashboard || !tab || index < 0) return;
        const card = structuredClone(tab.cards[index]);
        // Unlike unrelated optimistic edits, removal must be durable before Undo appears.
        const updated = updateCardInDashboard(dashboard, cardId, () => null);
        const saved = await saveEdit(updated, dashboard);
        const previous = get().pendingCardRemoval;
        set(state => ({
          dashboards: state.dashboards.map(d => d.id === dashboard.id ? keepRevision(updateCardInDashboard(d, cardId, () => null), saved) : d),
          pendingCardRemoval: state.dashboards.some(d => d.id === dashboard.id && d.tabs.some(t => t.id === tab.id))
            ? { dashboardId: dashboard.id, tabId: tab.id, index, card } : null,
          maximizedCardId: state.maximizedCardId === cardId ? null : state.maximizedCardId,
        }));
        await deleteDiscardedFiles([...(previous ? [previous.card] : []), card]);
      });
    },

    applyPivotGroupChange: async (dashboardId, cardId, plan, guard) => lifecycle(async () => {
      if (refuse('applyPivotGroupChange') || plan.dashboardId !== dashboardId || plan.widgetId !== cardId || !validatePivotGroupPlan(plan, guard.proofContext)) return { status: 'refused', message: 'Current owner worker plan is required.', writes: 0 };
      validateTableModel(plan.definition, plan.selection);
      const d = get().dashboards.find(d => d.id === dashboardId), c = d && pivotCard(d, cardId);
      if (!d || !c) return { status: 'refused', message: 'Table unavailable.', writes: 0 };
      const before: PivotPatch = { fields: structuredClone(pivotFields(c)), binding: structuredClone(pivotBinding(c, plan.paramKey)), groups: plan.groupChanges.map(g => ({ id: g.id, before: g.after, after: g.before })) };
      const after: PivotPatch = { fields: { table: structuredClone(plan.table), tableDefinition: structuredClone(plan.definition), tableSelection: structuredClone(plan.selection) }, binding: structuredClone(plan.bindings.filter(b => b.paramName === plan.paramKey)), groups: plan.groupChanges };
      const source = cardSourceIdentity(c) as string, disabled = !!d.groupsDisabled;
      const expected = [...new Map([...plan.groupChanges.map(g => [g.id, { id: g.id, record: g.before }] as const), ...(plan.expected.group ? [[plan.expected.group.id, { id: plan.expected.group.id, record: plan.expected.group }] as const] : [])]).values()];
      const createdId = plan.kind === 'create' ? plan.groupChanges[0]?.id : undefined;
      const current = () => {
        const latest = get().dashboards.find(d => d.id === dashboardId), card = latest && pivotCard(latest, cardId);
        return !!latest && !!card && !get().viewer && !removing.has(dashboardId) && guard.isCurrent() && validatePivotGroupPlan(plan, guard.proofContext) && cardSourceIdentity(card) === source && source === plan.expected.sourceIdentity && pivotEqual({ ...(card.tableDefinition ?? { search: '' }), table: card.table ?? card.tableDefinition?.table ?? {} }, plan.expected.definition) && pivotEqual(card.tableSelection ?? { kind: 'none' }, plan.expected.selection) && !!latest.groupsDisabled === disabled && pivotEqual(card.table, guard.expectedTable) && pivotEqual(card.tableDefinition, before.fields.tableDefinition) && pivotEqual(card.tableSelection, before.fields.tableSelection) && pivotEqual(pivotBinding(card, plan.paramKey), before.binding) && expected.every(g => pivotEqual((latest.groups ?? []).filter(x => x.id === g.id), g.record ? [g.record] : [])) && (!createdId || !latest.tabs.some(t => t.cards.some(c => c.bindings?.some(b => b.groupId === createdId))));
      };
      const result = await runPivotWrite(dashboardId, cardId, plan.paramKey, after, current, dashboard => guard.beforePublish(dashboard));
      if (result.status !== 'saved') return result;
      const token = {};
      if (latestPivotUndo) { pivotUndos.get(latestPivotUndo)?.release(); pivotUndos.delete(latestPivotUndo); }
      latestPivotUndo = token;
      let alive = true, release: () => void = () => undefined;
      const checkSession = () => { if (!guard.isSessionCurrent()) { alive = false; release(); } };
      release = guard.subscribeSession(checkSession); checkSession();
      pivotUndos.set(token, { dashboardId, cardId, paramKey: plan.paramKey, before, after, source, groupsDisabled: disabled, groupExpected: expected.map(g => ({ id: g.id, record: plan.groupChanges.find(x => x.id === g.id)?.after ?? g.record })), session: () => alive && guard.isSessionCurrent(), release, createdId });
      return { ...result, undo: { token } };
    }),

    undoPivotGroupChange: async (undo, guard) => lifecycle(async () => {
      const entry = pivotUndos.get(undo.token);
      if (!entry || entry.dashboardId !== guard.dashboardId || entry.cardId !== guard.cardId || latestPivotUndo !== undo.token || refuse('undoPivotGroupChange')) return { status: 'refused', message: 'Undo is no longer available.', writes: 0 };
      const current = () => {
        const d = get().dashboards.find(d => d.id === entry.dashboardId), c = d && pivotCard(d, entry.cardId);
        return !!d && !!c && !get().viewer && !removing.has(d.id) && entry.session() && guard.isCurrent() && cardSourceIdentity(c) === entry.source && !!d.groupsDisabled === entry.groupsDisabled && pivotEqual(pivotFields(c), entry.after.fields) && pivotEqual(pivotBinding(c, entry.paramKey), entry.after.binding) && entry.groupExpected.every(g => pivotEqual((d.groups ?? []).filter(x => x.id === g.id), g.record ? [g.record] : [])) && (!entry.createdId || !d.tabs.some(t => t.cards.some(card => card.bindings?.some(b => b.groupId === entry.createdId && (card.id !== entry.cardId || b.paramName !== entry.paramKey)))));
      };
      const result = await runPivotWrite(entry.dashboardId, entry.cardId, entry.paramKey, entry.before, current, dashboard => guard.beforePublish(dashboard));
      if (result.status === 'saved') { entry.release(); pivotUndos.delete(undo.token); latestPivotUndo = undefined; }
      return result;
    }),

    commitTableDefinition: async (dashboardId, cardId, definition, selection, guard) => lifecycle(async () => {
      if (refuse("commitTableDefinition")) return false;
      validateTableModel(definition, selection);
      const dashboard = get().dashboards.find(d => d.id === dashboardId);
      const card = dashboard?.tabs.flatMap(t => t.cards).find(c => c.id === cardId);
      if (!dashboard || removing.has(dashboardId) || !card) return false;
      if (guard && (!guard.isCurrent() || (['table', 'tableDefinition', 'tableSelection'] as const).some(key => JSON.stringify(card[key]) !== JSON.stringify(guard.expected[key])))) return false;
      const model = structuredClone(definition), chosen = structuredClone(selection);
      const commit = (d: Dashboard) => updateCardInDashboard(d, cardId, c => ({ ...c, table: model.table, tableDefinition: model, tableSelection: chosen }));
      const saved = await saveEdit(commit(dashboard), dashboard);
      if (guard && !guard.isCurrent()) {
        // A refresh/deletion can invalidate work while the serialized write is
        // in flight. Restore current durable intent before the next queued edit.
        const current = get().dashboards.find(d => d.id === dashboardId);
        if (current) await saveAsIs(current);
        return false;
      }
      guard?.beforePublish();
      set(state => ({ dashboards: state.dashboards.map(d => d.id === dashboardId ? keepRevision(commit(d), saved) : d) }));
      return true;
    }),

    dismissCardRemoval: async () => lifecycle(async () => {
      if (refuse("dismissCardRemoval")) return;
      await releaseRemoval();
    }),

    undoCardRemoval: async () => lifecycle(async () => {
      if (refuse("undoCardRemoval")) return;
      const entry = get().pendingCardRemoval;
      if (!entry) return;
      const dashboard = get().dashboards.find(d => d.id === entry.dashboardId);
      if (!dashboard?.tabs.some(t => t.id === entry.tabId)) {
        await releaseRemoval();
        return;
      }
      const restore = (d: Dashboard): Dashboard => ({ ...d, tabs: d.tabs.map(t => {
        if (t.id !== entry.tabId || t.cards.some(c => c.id === entry.card.id)) return t;
        const cards = [...t.cards]; cards.splice(Math.min(entry.index, cards.length), 0, entry.card);
        return { ...t, cards };
      }) });
      const saved = await saveEdit(restore(dashboard), dashboard);
      if (get().pendingCardRemoval !== entry) return;
      set(state => ({ dashboards: state.dashboards.map(d => d.id === entry.dashboardId ? keepRevision(restore(d), saved) : d), pendingCardRemoval: null }));
    }),

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

    clearManagedSource: async (cardId, backendId, sourceId) => {
      await mutateActive(d => updateCardInDashboard(d, cardId, card => {
        if(card.backendId!==backendId || card.managedSource?.sourceId!==sourceId)return card;
        const next={...card};delete next.managedSource;return next;
      }));
    },

    patchCardField: async (cardId, field, value) => {
      await mutateActive((d) =>
        updateCardInDashboard(d, cardId, (c) => {
          const next = { ...c };
          // Deleted, not assigned undefined: JSON.stringify would drop the key
          // anyway, but in memory the difference is observable and `"title" in
          // card` is what the rest of the app asks.
          if (value === null) {
            delete next[field];
            // A worker table mirrors `table` into its definition; a reset clears both,
            // or the definition's copy (pins, order, widths) would come straight back.
            if (field === "table" && next.tableDefinition) next.tableDefinition = { ...next.tableDefinition, table: {} };
          } else if (field === "table") next.table = { ...c.table, ...(value as Partial<TableCardState>) };
          else if (field === "calendar") next.calendar = { ...c.calendar, ...(value as Partial<import("../lib/types").CalendarCardState>) };
          else Object.assign(next, { [field]: value });
          return next;
        }),
      );
    },

    reorderDashboards: (orderedIds) =>
      set({ dashboards: [...get().dashboards].sort((a, b) => rank(a.id, orderedIds) - rank(b.id, orderedIds)) }),
  };
});
