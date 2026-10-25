// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { decodeV3CardExtension, encodeV3CardExtension, unwrapExtension } from "./appsExtensionsV3";
import { EXTRA_FIELDS, extras } from "./appsExtensionsV4";
import { importApps, toParams } from "./appsJson";
import { LOCAL_TABLE_ID } from "./builtins";
import { isRecord } from "./isRecord";
import type { CardWorkspaceState, Dashboard, DashboardCard, ParamBinding, ParamGroup, SyncStore, WidgetDef } from "./types";

type Rec = Record<string, unknown>;
/** Workspace's tab strip: one widget placed on every tab, regenerated from the tab list, never a card. */
const NAV = "navigation_bar";

const fail = (message: string): never => {
  throw new Error(message);
};
const rec = (value: unknown, what: string): Rec => (isRecord(value) ? value : fail(`Invalid ${what}.`));
const strings = (value: unknown, keys: string[]) => isRecord(value) && keys.every((k) => typeof value[k] === "string");

function parseGroups(value: unknown): ParamGroup[] {
  if (!Array.isArray(value) || !value.every((g) => strings(g, ["id", "name", "paramName", "groupType", "value"]))) fail("Invalid BDOBB groups.");
  return (value as ParamGroup[]).map(({ id, name, paramName, groupType, value: v }) => ({ id, name, paramName, groupType, value: v }));
}

function parseBindings(value: unknown): ParamBinding[] {
  if (!Array.isArray(value) || !value.every((b) => strings(b, ["groupId", "paramName"]))) fail("Invalid BDOBB bindings.");
  return (value as ParamBinding[]).map(({ groupId, paramName }) => ({ groupId, paramName }));
}

/** BDOBB's own card state from a widget record's extensions.bdobb: title, minimized, table, bindings, and a non-chart view. */
function applyNative(card: DashboardCard, widget: Rec): void {
  const ext = isRecord(widget.extensions) && isRecord(widget.extensions.bdobb) ? widget.extensions.bdobb : undefined;
  if (ext === undefined) return;
  const { bindings, ...rest } = ext;
  const native = unwrapExtension(decodeV3CardExtension(rest, "$.widgets[].extensions.bdobb"));
  for (const field of ["title", "minimized", "table"] as const) {
    if (native && Object.hasOwn(native, field)) Object.assign(card, { [field]: native[field] });
  }
  // Workspace's chart toggle is authoritative; a native view applies only while the chart is off.
  if (native?.view && native.view !== "chart" && card.view !== "chart") card.view = native.view;
  if (bindings !== undefined) card.bindings = parseBindings(bindings);
}

/**
 * One server dashboard item's content (store "dashboard") or app content
 * (store "app") as a BDOBB dashboard (spec: Mapper). Cards and the dashboard
 * get fresh local ids; backends resolve, and params convert, exactly as an
 * apps.json import does (importApps). Throws on a shape it cannot read: the
 * caller treats any throw as a failed download and writes nothing.
 */
export function fromWorkspace(content: unknown, store: SyncStore, registry: WidgetDef[]): Dashboard {
  const outer = rec(content, "dashboard");
  const body = rec(store === "dashboard" ? outer.data : outer, "dashboard data");
  const name = typeof body.name === "string" ? body.name : fail("Dashboard has no name.");
  const widgets = (Array.isArray(body.widgets) ? body.widgets : fail("Dashboard has no widget list.")).map((w) => rec(w, "widget"));
  const grid = rec(body.gridLayout ?? {}, "grid layout");
  const nav = widgets.find((w) => w.widgetId === NAV);
  const navTabs = nav && isRecord(nav.storage) && Array.isArray(nav.storage.tabs) ? nav.storage.tabs.filter(isRecord) : [];
  // The tab strip's order first, then any grid key it does not list.
  const keys = [...navTabs.map((t) => t.id), ...Object.keys(grid)].filter(
    (k, i, all): k is string => typeof k === "string" && Object.hasOwn(grid, k) && all.indexOf(k) === i,
  );
  const byId = new Map(widgets.map((w) => [w.id, w]));
  const placed = new Set<Rec>();
  const navLayout: Record<string, Rec> = {};
  const tabs: Rec = {};
  const states: Omit<CardWorkspaceState, "params">[][] = [];
  keys.forEach((key, t) => {
    const items = (Array.isArray(grid[key]) ? grid[key] : fail(`Tab ${key} has no layout.`)).map((i) => rec(i, "layout item"));
    const layout: Rec[] = [];
    const tabStates: Omit<CardWorkspaceState, "params">[] = [];
    for (const item of items) {
      const widget = byId.get(item.i);
      if (widget === undefined) continue; // a grid entry naming no widget shows nothing in Workspace either
      placed.add(widget);
      if (widget.widgetId === NAV) {
        navLayout[key] = item;
        continue;
      }
      if (typeof widget.widgetId !== "string") fail("Widget has no widgetId.");
      const storage = isRecord(widget.storage) ? widget.storage : {};
      layout.push({ i: widget.widgetId, x: item.x, y: item.y, w: item.w, h: item.h, state: { params: toParams(storage.params), chartView: storage.chartView } });
      tabStates.push({ widget, layout: item });
    }
    const label = navTabs.find((n) => n.id === key)?.name;
    // Keyed t0, t1, ...: non-numeric keys keep insertion order, so importApps keeps this one.
    tabs[`t${t}`] = { name: typeof label === "string" ? label : key, layout };
    states.push(tabStates);
  });
  const [dashboard] = importApps([{ name, tabs }], registry).dashboards;
  dashboard.tabs.forEach((tab, t) =>
    tab.cards.forEach((card, c) => {
      const state = states[t]?.[c];
      if (state === undefined) return;
      applyNative(card, state.widget);
      // The params as mapped (seeded defaults included), so an untouched card writes nothing back.
      card.extensions = { workspace: { ...state, params: { ...card.params } } };
    }),
  );
  // Resolve persisted parent references only after every placed card has its fresh local identity.
  const refs = new Map(dashboard.tabs.flatMap((tab,t) => tab.cards.map((card,c) => [states[t][c].widget.id, card.id])));
  dashboard.tabs.forEach((tab,t) => tab.cards.forEach((card,c) => {
    const extensions = states[t][c].widget.extensions;
    if (!isRecord(extensions) || extensions.bdobbTable === undefined) return;
    const record = rec(extensions.bdobbTable, 'table state');
    if (record.schemaVersion !== 1 || Object.keys(record).some(k => !['schemaVersion', 'state'].includes(k))) fail('Invalid table state.');
    const {sourceRef, pivot, ...state} = extras(record.state, '$.widgets[].extensions.bdobbTable');
    Object.assign(card, state);
    if (pivot) card.table = {...card.table, pivot};
    if (sourceRef !== undefined) {
      const sourceWidgetId = refs.get(sourceRef);
      if (!sourceWidgetId) return fail('Linked source is outside this dashboard.');
      card.linkedSource = {kind:'widget',sourceWidgetId};
    }
  }));
  const native = isRecord(body.extensions) && isRecord(body.extensions.bdobb) ? body.extensions.bdobb : undefined;
  if (native?.groups !== undefined) dashboard.groups = parseGroups(native.groups);
  if (typeof native?.groupsDisabled === "boolean") dashboard.groupsDisabled = native.groupsDisabled;
  const rest: Rec = { ...body };
  delete rest.widgets;
  delete rest.gridLayout;
  dashboard.extensions = {
    workspace: {
      content: store === "dashboard" ? { ...outer, data: rest } : rest,
      tabKeys: Object.fromEntries(dashboard.tabs.flatMap((tab, t) => (keys[t] === undefined ? [] : [[tab.id, keys[t]]]))),
      ...(nav ? { nav: { widget: nav, layout: navLayout } } : {}),
      orphans: widgets.filter((w) => !placed.has(w)),
    },
  };
  return dashboard;
}

/** Only what the user changed goes back: untouched keys keep the server's own value (a null, a list). */
function mergeParams(original: Rec, mapped: Record<string, string>, current: Record<string, string>): Rec {
  const out: Rec = { ...original };
  for (const [k, v] of Object.entries(current)) if (!(Object.hasOwn(mapped, k) && mapped[k] === v)) out[k] = v;
  for (const k of Object.keys(mapped)) if (!Object.hasOwn(current, k)) delete out[k];
  return out;
}

/** The card's BDOBB-only state for extensions.bdobb, or undefined when there is none. A chart view travels as storage.chartView instead. */
function nativeOf(card: DashboardCard): Rec | undefined {
  const clean = { ...card };
  for (const field of EXTRA_FIELDS) delete clean[field];
  delete clean.linkedSource;
  // A calendar view and a pivot travel in extensions.bdobbTable (see toWorkspace), as exportV4 carries them.
  if (clean.view === "calendar") delete clean.view;
  if (clean.table?.pivot) { clean.table = { ...clean.table }; delete clean.table.pivot; }
  const encoded = unwrapExtension(encodeV3CardExtension(clean, "$.card"));
  const native: Rec = encoded ? { ...encoded } : { schemaVersion: 1, profile: "v3" };
  if (native.view === "chart") delete native.view;
  if (card.bindings?.length) native.bindings = card.bindings.map(({ groupId, paramName }) => ({ groupId, paramName }));
  return Object.keys(native).length > 2 ? native : undefined;
}

/** Sets `target.extensions[key]` (default `bdobb`) to `native`, or removes it; drops `extensions` when nothing is left. */
function withNative(target: Rec, native: Rec | undefined, key = "bdobb"): void {
  const out: Rec = isRecord(target.extensions) ? { ...target.extensions } : {};
  if (native) out[key] = native;
  else delete out[key];
  if (Object.keys(out).length > 0) target.extensions = out;
  else delete target.extensions;
}

function cardRecord(card: DashboardCard, tabKey: string, used: Set<unknown>): { widget: Rec; layout: Rec } {
  const ws = card.extensions?.workspace;
  // A server card keeps its server id; a BDOBB-made card brings its own, so the next download can match it back
  // to this card. A second use of one id in a dashboard (a duplicated card) gets a fresh one.
  const wanted = ws && typeof ws.widget.id === "string" ? ws.widget.id : card.id;
  const id = used.has(wanted) ? crypto.randomUUID() : wanted;
  used.add(id);
  // A local table's file is on this device only; it never leaves it.
  const params = { ...card.params };
  if (card.widgetId === LOCAL_TABLE_ID) delete params.file;
  const storage: Rec = ws && isRecord(ws.widget.storage) ? { ...ws.widget.storage } : {};
  storage.params = mergeParams(isRecord(storage.params) ? storage.params : {}, ws?.params ?? {}, params);
  const charted = card.view === "chart";
  const chartView = isRecord(storage.chartView) ? storage.chartView : undefined;
  if (charted !== (chartView?.enabled === true)) storage.chartView = { chartType: "line", ...chartView, enabled: charted };
  const widget: Rec = ws
    ? { ...ws.widget, id, ...("innerTab" in ws.widget ? { innerTab: tabKey } : {}), storage }
    : { id, widgetId: card.widgetId, name: card.title ?? card.widgetId, innerTab: tabKey, storage, params: [] };
  withNative(widget, nativeOf(card));
  const layout = { ...(ws?.layout ?? {}), i: id, x: card.layout.x, y: card.layout.y, w: card.layout.w, h: card.layout.h };
  return { widget, layout };
}

/** Where a new dashboard item goes: its index (the item's uuid) and the root folder's index. */
export type NewItem = { index: string; parentId: string | null };

/**
 * The dashboard as server content for `store` (spec: Round trip). A card that
 * came from the server is its original widget record with only what changed
 * written back; a BDOBB-made card is a minimal record carrying its own state
 * in extensions.bdobb. `item` places a dashboard item that is new on the
 * server (a new dashboard, one an import replaced, or one whose link was
 * dropped): its index and parentId win over any server shell's.
 */
export function toWorkspace(dashboard: Dashboard, store: SyncStore, item?: NewItem): Rec {
  const ws = dashboard.extensions?.workspace;
  const keyOf = (tabId: string) => ws?.tabKeys[tabId] ?? tabId;
  const widgets: Rec[] = [];
  const gridLayout: Record<string, Rec[]> = {};
  const used = new Set<unknown>();
  const references = new Map<string, string>();
  const records: Array<{card: DashboardCard; widget: Rec}> = [];
  for (const tab of dashboard.tabs) {
    const key = keyOf(tab.id);
    gridLayout[key] = [];
    for (const card of tab.cards) {
      const { widget, layout } = cardRecord(card, key, used);
      references.set(card.id, widget.id as string);
      records.push({card,widget});
      widgets.push(widget);
      gridLayout[key].push(layout);
    }
  }
  for (const {card,widget} of records) {
    const state: Rec = {};
    for (const field of EXTRA_FIELDS) if (card[field] !== undefined) state[field] = card[field];
    if (card.view === "calendar") state.view = "calendar";
    if (card.table?.pivot) state.pivot = card.table.pivot;
    if (card.linkedSource) {
      const ref = references.get(card.linkedSource.sourceWidgetId);
      if (!ref) fail('Linked source is outside this dashboard.');
      state.sourceRef = ref;
    }
    const encoded = Object.keys(state).length ? {schemaVersion:1,state:extras(state, '$.card.table')} : undefined;
    withNative(widget, encoded, 'bdobbTable');
  }
  const keys = Object.keys(gridLayout);
  if (ws?.nav || keys.length > 1) {
    const base = ws?.nav?.widget ?? { id: crypto.randomUUID(), widgetId: NAV, name: "Navigation Bar", showTitle: true, params: [], storage: { params: {} } };
    const storage = isRecord(base.storage) ? base.storage : {};
    const nav: Rec = {
      ...base,
      innerTab: typeof base.innerTab === "string" && keys.includes(base.innerTab) ? base.innerTab : keys[0],
      storage: { ...storage, tabs: dashboard.tabs.map((t) => ({ id: keyOf(t.id), name: t.name })) },
    };
    widgets.push(nav);
    for (const key of keys) {
      gridLayout[key].unshift({ ...(ws?.nav?.layout[key] ?? { w: 40, h: 2, x: 0, y: 0, minW: 40, minH: 2, maxH: 2, static: true }), i: nav.id });
    }
  }
  const shell = ws?.content;
  const base: Rec = shell ? { ...(store === "dashboard" ? rec(shell.data, "dashboard data") : shell) } : { groups: [] };
  const body: Rec = { ...base, name: dashboard.name, widgets: [...widgets, ...(ws?.orphans ?? [])], gridLayout };
  if (!shell || (typeof base.currentTab === "string" && !keys.includes(base.currentTab))) body.currentTab = keys[0];
  const native: Rec = {};
  if (dashboard.groups?.length) native.groups = dashboard.groups.map(({ id, name, paramName, groupType, value }) => ({ id, name, paramName, groupType, value }));
  if (dashboard.groupsDisabled !== undefined) native.groupsDisabled = dashboard.groupsDisabled;
  withNative(body, Object.keys(native).length > 0 ? native : undefined);
  if (store === "app") return body;
  // A new item's place wins over a stale shell's (an unlinked dashboard keeps its old shell); the shell's other fields stay valid.
  if (shell) return { ...shell, ...(item ? { index: item.index, parentId: item.parentId } : {}), data: body };
  return { index: item?.index ?? crypto.randomUUID(), isFolder: false, parentId: item?.parentId ?? null, data: body };
}
