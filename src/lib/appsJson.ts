// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { AppExtensionError, bdobbNamespace, decodeV3AppExtension, decodeV3CardExtension, encodeV3CardExtension, extensionError, unwrapExtension } from "./appsExtensionsV3";
import type { V3AppExtension, V3CardExtension, ExtensionResult } from "./appsExtensionsV3";
import { IMPORT_MAX_BYTES, importRefusal } from "./importLimits";
import { isRecord } from "./isRecord";
import { paramGroupType } from "./paramGroups";
import { seedParams } from "./params";
import { paramString } from "./widgetsJson";
import type { Dashboard, DashboardCard, DashboardTab, ParamGroup, WidgetDef } from "./types";
import type { WidgetIssue } from "./widgetsJson";

/**
 * The backendId an imported card carries when no connected backend serves its
 * widget id. Never a real BackendConfig id (those are crypto.randomUUID()),
 * so it cannot collide; useWidgetRegistryStore.find treats it as "search
 * every backend", which is how such a card comes alive the moment a backend
 * serving its id connects. pinResolvedBackends then makes that resolution
 * permanent on the dashboard's next save.
 */
export const UNRESOLVED_BACKEND_ID = "unresolved";

export type AppChartView = { enabled: boolean; chartType: string };

export type AppLayoutItem = {
  /** The widget id. apps.json identifies a card by the widget it shows. */
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * The names of the groups this card belongs to. THIS is where Workspace
   * puts membership -- the app-level group object carries the definition
   * (paramName, defaultValue) and, in some files, a widgetIds list as well.
   * Reading only widgetIds dropped every group the reference backend
   * publishes, since it publishes none.
   */
  groups?: string[];
  /**
   * bdobb's own field, absent from Workspace's shape: which of THIS card's
   * params a named group binds, written only when it differs from the
   * group's own paramName (a `ticker` control in a `symbol` group). Workspace
   * ignores it; `groups` above still names every membership.
   */
  groupBindings?: Array<{ group: string; paramName: string }>;
  state?: { params: Record<string, string>; chartView: AppChartView; transpose?: true; extensions?: { bdobb: V3CardExtension } };
};

export type AppTab = { id: string; name: string; layout: AppLayoutItem[] };

export type AppGroup = {
  name: string;
  type: "param" | "endpointParam";
  paramName: string;
  defaultValue: string;
  /** bdobb's own field: the compatibility key, written only when it differs from paramName. */
  groupType?: string;
  /** Read when present, never written: see AppLayoutItem.groups. */
  widgetIds?: string[];
};

export type App = {
  extensions?: { bdobb: V3AppExtension };
  name: string;
  description: string;
  img: string;
  img_dark: string;
  img_light: string;
  allowCustomization: boolean;
  tabs: Record<string, AppTab>;
  groups: AppGroup[];
  prompts: unknown[];
};

export type ImportResult = {
  dashboards: Dashboard[];
  /** Cards created, across every dashboard — the notice reports it. */
  cards: number;
  /** Of those, how many carry UNRESOLVED_BACKEND_ID. */
  unresolved: number;
};

export type ImportDecision = "replace" | "keep" | "skip";

export type ImportConflict = {
  /** The file's dashboard, already deduplicated within the file. */
  imported: Dashboard;
  /** Every existing dashboard with exactly this name. More than one: Replace is unavailable. */
  existingIds: string[];
  /** Counts for the first of existingIds. */
  yours: { tabs: number; cards: number };
  incoming: { tabs: number; cards: number };
};

/**
 * The shape importApps insists on: an array of objects, each with a string
 * `name` and an object `tabs`. Empty passes -- importApps accepts an empty
 * file as an empty import rather than an error.
 */
function isAppsShape(value: unknown): value is Array<Record<string, unknown>> {
  return (
    Array.isArray(value) &&
    value.every((app) => isRecord(app) && typeof app.name === "string" && isRecord(app.tabs))
  );
}

/**
 * That same shape as a question rather than a throw, for a file drop that
 * needs the ANSWER before it commits to a path -- a .json that is not an
 * apps.json is a data file, not a failed import. Both read the one shape
 * check, so the sniff cannot drift from what importApps accepts.
 *
 * `[]` is the one thing the two answer differently, deliberately: it is
 * vacuously an apps.json and an equally good empty table, and a file the
 * user dropped on the dashboard is far likelier to be the data. Importing it
 * would write nothing and say so, which reads as a bug; a card of no rows is
 * at least the file they dropped.
 */
export function isAppsJson(value: unknown): value is Array<Record<string, unknown>> {
  return isAppsShape(value) && value.length > 0;
}

export type ExistingDashboard = Pick<Dashboard, "id" | "name" | "tabs">;

export type AppsImportReady = {
  ok: true;
  dashboards: Dashboard[];
  conflicts: ImportConflict[];
  existingNames: string[];
};

export type AppsImportPlan = { ok: false; refusal: string } | AppsImportReady;

const counts = (d: Pick<Dashboard, "tabs">) => ({
  tabs: d.tabs.length,
  cards: d.tabs.reduce((n, t) => n + t.cards.length, 0),
});

/**
 * The issue id a bad apps.json is reported under. Not a widget id and not
 * ROOT_ISSUE_ID: the widgets.json root issue means "no widget here was
 * usable", which ConnectionsDialog renders as a rejected widget list, and an
 * apps.json problem says nothing at all about the widgets.
 */
export const APPS_ISSUE_ID = "<apps.json>";

/**
 * The serialized size of an already-parsed payload, for the byte ceiling
 * importRefusal applies — and the AUTHORITY on it, because it is the one
 * number that is always true. A response's Content-Length can only tighten
 * this (see parseAppsJson); it can never stand in for it.
 * UTF-16 code units rather than UTF-8 bytes: equal for ASCII, an undercount
 * for anything wider, which on a 10 MB guard rail only makes the ceiling
 * slightly generous and saves a second full copy of the document through
 * TextEncoder.
 */
function serializedSize(value: unknown): number {
  return JSON.stringify(value)?.length ?? 0;
}

/**
 * A backend's apps.json, turned into apps or into one thing to say about it.
 *
 * The reason line NEVER carries any of the payload: this runs on a response
 * from a backend, and the string that would be quoted (a parse error, a
 * {detail} body, a stray field) is the backend's, not ours. It names the
 * backend and what was wrong with the document, and nothing else.
 *
 * `null` is what fetchAppsJson resolves for a backend that serves no
 * apps.json (its 404) or an empty body, and `[]` is an apps.json with no
 * apps in it. Both are "no apps" and neither is worth reporting.
 *
 * `bytes` is the size the response declared, when it declared one. It may
 * only make the ceiling STRICTER: a Content-Length is the size on the WIRE,
 * so a gzipped apps.json declares its compressed length and trusting it in
 * place of the measure would wave a 10 MB document through on a 1 MB header
 * — and a header that is absent, wrong or chunked away enforces nothing at
 * all. The measured size is therefore always the authority, and the header
 * only lets an obviously-oversized response be refused without a word about
 * it being said twice. RssRenderer's MAX_FEED_CHARS documents the same
 * conclusion for the same reason.
 */
export function parseAppsJson(
  raw: unknown,
  backendName: string,
  bytes?: number,
): { apps: App[]; issue?: WidgetIssue } {
  if (raw === null || raw === undefined) return { apps: [] };
  if (Array.isArray(raw) && raw.length === 0) return { apps: [] };

  const issue = (reason: string) => ({ apps: [], issue: { id: APPS_ISSUE_ID, reason } });

  if (!isAppsJson(raw)) return issue(`apps.json from ${backendName} is not a list of apps`);

  // The declared size can only ADD a refusal, never remove one: whatever the
  // header claimed, the measured document still has to fit. See the note on
  // `bytes` above.
  const refusal =
    (bytes !== undefined && bytes > IMPORT_MAX_BYTES ? importRefusal(bytes) : null) ??
    importRefusal(serializedSize(raw), raw.length);
  if (refusal !== null) return issue(`apps.json from ${backendName} was refused: ${refusal}`);

  // isAppsJson guarantees `name` and `tabs` and nothing else; the rest of
  // `App` is whatever the backend sent, exactly as importApps already
  // assumes when it reads one field at a time.
  return { apps: raw as unknown as App[] };
}

/**
 * Either refusal or a batch to decide on: size, parse, build, dashboard
 * count, and which names already exist -- in one pure function, because two
 * entry points make it (the rail's file picker and a file dropped on the
 * dashboard). Both refusals come before any conflict is reported, so an
 * oversize file is refused without a prompt.
 *
 * The file's own duplicates are suffixed against each other only; a name
 * that then matches an existing dashboard exactly (case-sensitive, as dedupe)
 * is a conflict, and the caller asks about it.
 * Throws exactly what importApps and JSON.parse throw.
 */
export function planAppsImport(
  text: string,
  bytes: number,
  registry: WidgetDef[],
  existing: ExistingDashboard[],
): AppsImportPlan {
  const oversize = importRefusal(bytes);
  if (oversize !== null) return { ok: false, refusal: oversize };

  let dashboards: Dashboard[];
  try { ({ dashboards } = importApps(JSON.parse(text), registry)); }
  catch (err) {
    if (err instanceof AppExtensionError) return { ok: false, refusal: err.message };
    throw err;
  }
  // Nothing has been written yet, so a refusal here still imports nothing.
  const overCount = importRefusal(bytes, dashboards.length);
  if (overCount !== null) return { ok: false, refusal: overCount };

  const conflicts = dashboards.flatMap((imported): ImportConflict[] => {
    const owners = existing.filter((d) => d.name === imported.name);
    if (owners.length === 0) return [];
    return [
      {
        imported,
        existingIds: owners.map((d) => d.id),
        yours: counts(owners[0]),
        incoming: counts(imported),
      },
    ];
  });
  return { ok: true, dashboards, conflicts, existingNames: existing.map((d) => d.name) };
}

export type AppliedImport = {
  added: Dashboard[];
  replaced: { id: string; dashboard: Dashboard }[];
  skipped: number;
};

/**
 * The answers, turned into writes. A Keep both is named by dedupe's
 * first-unused rule against the existing names AND every name this import
 * already holds -- the non-conflicting ones first, since they keep theirs.
 */
export function applyImportDecisions(
  plan: AppsImportReady,
  decisions: ImportDecision[],
): AppliedImport {
  const answered = new Map(
    plan.conflicts.map((c, i) => [c.imported.id, { conflict: c, decision: decisions[i] ?? "skip" }]),
  );
  const taken = new Set([
    ...plan.existingNames,
    ...plan.dashboards.filter((d) => !answered.has(d.id)).map((d) => d.name),
  ]);
  const result: AppliedImport = { added: [], replaced: [], skipped: 0 };
  for (const dashboard of plan.dashboards) {
    const entry = answered.get(dashboard.id);
    if (!entry) result.added.push(dashboard);
    else if (entry.decision === "keep") {
      result.added.push({ ...dashboard, name: dedupe(dashboard.name, taken) });
    } else if (entry.decision === "replace") {
      // The dialog disables this; replacing one of two same-named
      // dashboards would be a guess about which one the user meant.
      if (entry.conflict.existingIds.length !== 1) {
        throw new Error("cannot replace an ambiguous name");
      }
      result.replaced.push({ id: entry.conflict.existingIds[0], dashboard });
    } else result.skipped += 1;
  }
  return result;
}

/**
 * What the dialog's Keep both caption shows. Computed by applyImportDecisions
 * itself, so the hint and the result cannot disagree.
 * Throws if a prior decision is "replace" on an ambiguous conflict, which the dialog makes unreachable.
 */
export function keepBothName(plan: AppsImportReady, prior: ImportDecision[], index: number): string {
  const decisions = plan.conflicts.map((_, i) => (i < index ? prior[i] : i === index ? "keep" : "skip"));
  const id = plan.conflicts[index].imported.id;
  const kept = applyImportDecisions(plan, decisions).added.find((d) => d.id === id);
  return kept?.name ?? plan.conflicts[index].imported.name;
}

/**
 * Object.hasOwn, never a bare index: a paramName out of an untrusted file
 * can be "constructor" or "toString", and an index lookup would answer with
 * something off Object.prototype instead of "this card has no value yet".
 */
function ownValue(params: Record<string, string>, key: string): string {
  return Object.hasOwn(params, key) ? params[key] : "";
}

/**
 * `min` is the smallest value the grid can use: 0 for a position, 1 for a
 * size. Below it -- a negative x, a zero or negative w -- is a value the grid
 * cannot draw, so it takes the fallback like a missing one.
 */
function toInt(value: unknown, fallback: number, min = 0): number {
  return typeof value === "number" && Number.isFinite(value) && Math.trunc(value) >= min
    ? Math.trunc(value)
    : fallback;
}

/**
 * A card's params are Record<string, string>. A number or a boolean has an
 * unambiguous string form and the live manifests do send both; anything else
 * (null, an object) has no form a query parameter could carry, so it is
 * dropped rather than stringified into "[object Object]". A list -- how
 * Workspace saves a multi-select -- is comma-joined, as the control writes it.
 */
export function toParams(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    const text = paramString(raw);
    if (text !== undefined) out[key] = text;
  }
  return out;
}

export function exportApp(dashboard: Dashboard): App {
  // Membership travels by NAME on the layout entry, so two groups sharing a
  // name inside one app would be ambiguous on the way back in.
  const groupName = new Map<string, string>();
  const usedNames = new Set<string>();
  for (const group of dashboard.groups ?? []) {
    let name = group.name;
    for (let n = 2; usedNames.has(name); n += 1) name = `${group.name} (${n})`;
    usedNames.add(name);
    groupName.set(group.id, name);
  }
  // Built once per dashboard, not once per card.
  const groupById = new Map((dashboard.groups ?? []).map((g) => [g.id, g]));

  const tabs: Record<string, AppTab> = {};
  for (const tab of dashboard.tabs) {
    tabs[tab.id] = {
      id: tab.id,
      name: tab.name,
      layout: tab.cards.map((card) => {
        const charted = card.view === "chart";
        const transposed = card.view === "transposed";
        const item: AppLayoutItem = {
          i: card.widgetId,
          x: card.layout.x,
          y: card.layout.y,
          w: card.layout.w,
          h: card.layout.h,
        };
        const names: string[] = [];
        const bindings: Array<{ group: string; paramName: string }> = [];
        for (const b of card.bindings ?? []) {
          const group = groupById.get(b.groupId);
          const name = group && groupName.get(group.id);
          if (!group || !name) continue;
          names.push(name);
          if (b.paramName !== group.paramName) bindings.push({ group: name, paramName: b.paramName });
        }
        if (names.length > 0) item.groups = names;
        if (bindings.length > 0) item.groupBindings = bindings;
        // Omitted when there is nothing to say: no params, not charted, not
        // transposed. `transpose` is bdobb's own field — Workspace ignores it
        // and it is never a backend param — so it is written only when true,
        // keeping every other export byte-identical to the documented shape.
        if (Object.keys(card.params).length > 0 || charted || transposed) {
          item.state = {
            params: { ...card.params },
            chartView: { enabled: charted, chartType: "line" },
            ...(transposed ? { transpose: true as const } : {}),
          };
        }
        return item;
      }),
    };
  }

  return {
    name: dashboard.name,
    description: "",
    img: "",
    img_dark: "",
    img_light: "",
    allowCustomization: true,
    tabs,
    // Always "param": bdobb's ParamGroup carries no endpoint distinction, and
    // importApps treats both documented types identically anyway.
    groups: (dashboard.groups ?? []).map((group) => ({
      name: groupName.get(group.id) ?? group.name,
      type: "param" as const,
      paramName: group.paramName,
      defaultValue: group.value,
      ...(group.groupType !== group.paramName ? { groupType: group.groupType } : {}),
    })),
    prompts: [],
  };
}

/** A portable projection with per-instance overlays, never local card IDs. */
export function exportCompatibleApp(dashboard: Dashboard): ExtensionResult<App> {
  try {
    const allGroups = dashboard.groups ?? [];
    const groupsById = new Map(allGroups.map((group) => [group.id, group]));
    if (groupsById.size !== allGroups.length) extensionError("$.groups", "Duplicate group identity.");
    for (const group of allGroups) {
      if (typeof group.name !== "string" || typeof group.paramName !== "string" || group.paramName === "" || typeof group.value !== "string" || (group.groupType !== undefined && (typeof group.groupType !== "string" || group.groupType === ""))) extensionError("$.groups", "Invalid group definition.");
    }
    const normalized: Dashboard = {
      ...dashboard,
      groups: allGroups.map((g) => ({ ...g, groupType: g.groupType ?? g.paramName })),
      tabs: dashboard.tabs.map((tab, ti) => ({
        ...tab,
        cards: tab.cards.map((card, ci) => {
          const path = `$.tabs[${ti}].cards[${ci}]`;
          const legacy = (card as DashboardCard & { groupIds?: unknown }).groupIds;
          let bindings = card.bindings;
          if (legacy !== undefined) {
            if (bindings !== undefined || !Array.isArray(legacy) || legacy.some((id) => typeof id !== "string")) extensionError(path, "Ambiguous legacy group membership.");
            bindings = legacy.map((id) => {
              const group = groupsById.get(id);
              if (!group) extensionError(path, "Missing group reference.");
              return { groupId: group.id, paramName: group.paramName };
            });
          }
          const params = new Set<string>();
          const groupIds = new Set<string>();
          for (const binding of bindings ?? []) {
            if (!groupsById.has(binding.groupId) || params.has(binding.paramName) || groupIds.has(binding.groupId)) extensionError(path, "Missing or ambiguous group binding.");
            params.add(binding.paramName);
            groupIds.add(binding.groupId);
          }
          if (card.widgetId === "local_table" && Object.hasOwn(card.params, "file")) extensionError(path, "Local assets require a repository archive.", "MISSING_LOCAL_ASSET");
          if (Object.values(card.params).some((v) => typeof v !== "string")) extensionError(path, "Parameters must be strings.");
          const { x, y, w, h } = card.layout;
          if (![x, y, w, h].every(Number.isSafeInteger) || x < 0 || y < 0 || w <= 0 || h <= 0) extensionError(path, "Invalid card geometry.");
          return { ...card, bindings };
        }),
      })),
    };
    if (new Set(normalized.tabs.map((t) => t.id)).size !== normalized.tabs.length) extensionError("$.tabs", "Duplicate tab identity.");
    if (normalized.tabs.some((t) => ["__proto__", "constructor", "prototype"].includes(t.id))) extensionError("$.tabs", "Unsafe tab identity.");
    const app = exportApp(normalized);
    // Prevent live discovery from re-inferring a different compatibility key.
    app.groups.forEach((group, i) => { group.groupType = normalized.groups![i].groupType; });
    const groupNames = Object.fromEntries(app.groups.flatMap((g, i) => g.name === allGroups[i].name ? [] : [[g.name, allGroups[i].name]]));
    app.extensions = { bdobb: {
      schemaVersion: 1, profile: "v3", tabOrder: normalized.tabs.map((t) => t.id),
      ...(dashboard.groupsDisabled !== undefined ? { groupsDisabled: dashboard.groupsDisabled } : {}),
      ...(Object.keys(groupNames).length > 0 ? { groupNames } : {}),
    } };
    unwrapExtension(decodeV3AppExtension(app.extensions.bdobb, "$.extensions.bdobb"));
    for (const tab of normalized.tabs) for (const [index, card] of tab.cards.entries()) {
      const overlay = unwrapExtension(encodeV3CardExtension(card, `$.tabs.${tab.id}.layout[${index}].state.extensions.bdobb`));
      if (!overlay) continue;
      const item = app.tabs[tab.id].layout[index];
      item.state ??= { params: { ...card.params }, chartView: { enabled: card.view === "chart", chartType: "line" } };
      item.state.extensions = { bdobb: overlay };
    }
    return { ok: true, value: app };
  } catch (err) {
    if (err instanceof AppExtensionError) return { ok: false, issue: err.issue };
    throw err;
  }
}

/** "Macro", then "Macro (2)", "Macro (3)" — first unused, not highest + 1. */
export function dedupe(name: string, taken: Set<string>): string {
  let candidate = name;
  for (let n = 2; taken.has(candidate); n++) candidate = `${name} (${n})`;
  taken.add(candidate);
  return candidate;
}

/**
 * `takenNames` is the names already in use — the caller's existing dashboards.
 * Deduping only within the file would let a second import of the same file
 * leave two dashboards sharing one name, and the rail has nothing but the
 * name to tell them apart.
 */
export function importApps(
  json: unknown,
  registry: WidgetDef[],
  takenNames: string[] = [],
): ImportResult {
  if (!isAppsShape(json)) throw new Error("not an apps.json file");
  const apps = json;
  // Validate all namespaces before allocating cards or planning any writes.
  for (const [index, app] of apps.entries()) {
    const path = `$[${index}]`;
    const ext = unwrapExtension(decodeV3AppExtension(bdobbNamespace(app, path), `${path}.extensions.bdobb`));
    const tabs = app.tabs as Record<string, unknown>;
    if (ext && (new Set(ext.tabOrder).size !== Object.keys(tabs).length || ext.tabOrder.length !== Object.keys(tabs).length || ext.tabOrder.some((k) => !Object.hasOwn(tabs, k)))) extensionError(path, "tabOrder must list each tab once.");
    const enhanced = ext !== undefined || Object.values(tabs).some((tab) => isRecord(tab) && Array.isArray(tab.layout) && tab.layout.some((item) => isRecord(item) && isRecord(item.state) && isRecord(item.state.extensions) && Object.hasOwn(item.state.extensions, "bdobb")));
    const groupNames = Array.isArray(app.groups) ? app.groups.filter(isRecord).map((g) => g.name) : [];
    if (enhanced) {
      if (app.groups !== undefined && !Array.isArray(app.groups)) extensionError(`${path}.groups`, "Groups must be an array.");
      const seen = new Set<string>();
      for (const raw of Array.isArray(app.groups) ? app.groups : []) {
        if (!isRecord(raw) || typeof raw.name !== "string" || typeof raw.paramName !== "string" || raw.paramName === "" || typeof raw.defaultValue !== "string" || (raw.type !== "param" && raw.type !== "endpointParam") || (raw.groupType !== undefined && (typeof raw.groupType !== "string" || raw.groupType === ""))) extensionError(`${path}.groups`, "Invalid enhanced group definition.");
        if (seen.has(raw.name)) extensionError(`${path}.groups`, "Duplicate exported group name.");
        seen.add(raw.name);
        if (raw.widgetIds !== undefined && (!Array.isArray(raw.widgetIds) || raw.widgetIds.some((id) => typeof id !== "string"))) extensionError(`${path}.groups`, "Invalid group widget membership.");
      }
    }
    if (ext?.groupNames && Object.keys(ext.groupNames).some((k) => !groupNames.includes(k))) extensionError(path, "Unknown group name mapping.");
    for (const [key, rawTab] of Object.entries(tabs)) {
      if (!isRecord(rawTab)) { if (ext) extensionError(path, "Invalid enhanced tab."); continue; }
      if (!Array.isArray(rawTab.layout)) { if (ext) extensionError(path, "Invalid enhanced layout."); continue; }
      for (const [i, item] of rawTab.layout.entries()) {
        const itemPath = `${path}.tabs.${key}.layout[${i}]`;
        if (!isRecord(item)) { if (ext) extensionError(itemPath, "Invalid layout item."); continue; }
        if (bdobbNamespace(item, itemPath) !== undefined) {
          extensionError(itemPath, "Layout-level BDOBB overlays are unsupported in v3.", "UNSUPPORTED_EXTENSION");
        }
        const state = isRecord(item.state) ? item.state : {};
        // Archived exports from the earlier bdobb line mark a Pivot card this
        // way; importing it as a plain table would silently drop the analysis.
        if (isRecord(state.pivotView) && state.pivotView.enabled === true) {
          extensionError(itemPath, "Archived Pivot state is unsupported in v3.", "UNSUPPORTED_EXTENSION");
        }
        const cardExt = unwrapExtension(decodeV3CardExtension(bdobbNamespace(state, itemPath), `${itemPath}.state.extensions.bdobb`));
        if (cardExt?.view) {
          const chart = isRecord(state.chartView) && state.chartView.enabled === true;
          const transpose = state.transpose === true;
          if (chart !== (cardExt.view === "chart") || transpose !== (cardExt.view === "transposed")) extensionError(itemPath, "Native view conflicts with standard projection.", "VIEW_CONFLICT");
        }
        if ((ext || cardExt) && item.i === "local_table" && isRecord(state.params) && Object.hasOwn(state.params, "file")) extensionError(itemPath, "Local assets require a repository archive.", "MISSING_LOCAL_ASSET");
        if (enhanced || cardExt) {
          const members = item.groups;
          if (members !== undefined && (!Array.isArray(members) || members.some((g) => typeof g !== "string" || !groupNames.includes(g)) || new Set(members).size !== members.length)) extensionError(itemPath, "Invalid group membership.");
          if (item.groupBindings !== undefined) {
            if (!Array.isArray(item.groupBindings)) extensionError(itemPath, "Group bindings must be an array.");
            const seenGroups = new Set<string>();
            const seenParams = new Set<string>();
            for (const binding of item.groupBindings) {
              if (!isRecord(binding) || typeof binding.group !== "string" || typeof binding.paramName !== "string" || binding.paramName === "" || !Array.isArray(members) || !members.includes(binding.group) || seenGroups.has(binding.group) || seenParams.has(binding.paramName)) extensionError(itemPath, "Invalid or ambiguous group binding.");
              seenGroups.add(binding.group);
              seenParams.add(binding.paramName);
            }
          }
          const effectiveParams = new Set<string>();
          for (const group of Array.isArray(app.groups) ? app.groups : []) {
            if (!isRecord(group)) continue;
            const belongs = (Array.isArray(members) && members.includes(group.name)) || (Array.isArray(group.widgetIds) && group.widgetIds.includes(item.i));
            if (!belongs) continue;
            const explicit = Array.isArray(item.groupBindings) ? item.groupBindings.find((b) => isRecord(b) && b.group === group.name) : undefined;
            const paramName = isRecord(explicit) ? explicit.paramName as string : group.paramName as string;
            if (effectiveParams.has(paramName)) extensionError(itemPath, "Groups compete for the same parameter.");
            effectiveParams.add(paramName);
          }
          if (![item.x, item.y, item.w, item.h].every((n) => typeof n === "number" && Number.isSafeInteger(n)) || (item.x as number) < 0 || (item.y as number) < 0 || (item.w as number) <= 0 || (item.h as number) <= 0) extensionError(itemPath, "Invalid enhanced geometry.");
          if (state.params !== undefined && (!isRecord(state.params) || Object.values(state.params).some((v) => typeof v !== "string"))) extensionError(itemPath, "Parameters must be string values.");
        }
        if ((ext || cardExt) && typeof item.i !== "string") extensionError(itemPath, "Widget id must be string.");
      }
    }
  }
  // One lookup table instead of a registry scan per card. The FIRST widget
  // serving an id wins, as registry.find did: two backends can serve the same
  // id, and a Map built straight from the array would keep the last.
  const servedById = new Map<string, WidgetDef>();
  for (const w of registry) if (!servedById.has(w.id)) servedById.set(w.id, w);

  const dashboards: Dashboard[] = [];
  const taken = new Set<string>(takenNames);
  let cards = 0;
  let unresolved = 0;

  for (const app of json) {
    const appExt = unwrapExtension(decodeV3AppExtension(bdobbNamespace(app, "$"), "$.extensions.bdobb"));

    const tabs: DashboardTab[] = [];
    /** Every card of THIS app, so a group can reach members across its tabs. */
    const appCards: DashboardCard[] = [];
    /** Group NAMES each card's own layout entry claimed, by card. */
    const claimedGroups = new Map<DashboardCard, string[]>();
    /** Per card, the param a named group binds when it is not the group's own — from groupBindings. */
    const claimedBindings = new Map<DashboardCard, Map<string, string>>();

    // Object.entries preserves insertion order for non-integer-like keys, and
    // a tab id is a uuid — so tabs land in file order.
    const rawTabs = app.tabs as Record<string, unknown>;
    const orderedTabs = appExt ? appExt.tabOrder.map((key) => [key, rawTabs[key]] as const) : Object.entries(rawTabs);
    for (const [key, rawTab] of orderedTabs) {
      if (!isRecord(rawTab)) continue;
      const layout = Array.isArray(rawTab.layout) ? rawTab.layout : [];
      const tabCards: DashboardCard[] = [];

      for (const rawItem of layout) {
        if (!isRecord(rawItem)) continue;
        const widgetId = rawItem.i;
        if (typeof widgetId !== "string") continue;

        const state = isRecord(rawItem.state) ? rawItem.state : undefined;
        const chartView = state && isRecord(state.chartView) ? state.chartView : undefined;
        const served = servedById.get(widgetId);
        if (!served) unresolved += 1;

        const card: DashboardCard = {
          id: crypto.randomUUID(),
          widgetId,
          backendId: served?.backendId ?? UNRESOLVED_BACKEND_ID,
          params: toParams(state?.params),
          layout: {
            x: toInt(rawItem.x, 0),
            y: toInt(rawItem.y, 0),
            // A layout entry that omits its size gets the size the widget
            // itself asks for, exactly as a card added from the library
            // does; 20x9 is only for a card nothing serves, where there is
            // no gridData to ask.
            w: toInt(rawItem.w, served?.gridData.w ?? 20, 1),
            h: toInt(rawItem.h, served?.gridData.h ?? 9, 1),
          },
        };
        // Workspace's own field is authoritative when both are set.
        if (chartView?.enabled === true) card.view = "chart";
        else if (state?.transpose === true) card.view = "transposed";

        const native = unwrapExtension(decodeV3CardExtension(bdobbNamespace(state ?? {}, "$"), "$.state.extensions.bdobb"));
        if (native) {
          for (const field of ["title", "view", "minimized", "table"] as const) {
            if (Object.hasOwn(native, field)) Object.assign(card, { [field]: native[field] });
          }
        }

        if (Array.isArray(rawItem.groups)) {
          claimedGroups.set(
            card,
            rawItem.groups.filter((g): g is string => typeof g === "string"),
          );
        }

        if (Array.isArray(rawItem.groupBindings)) {
          const byGroup = new Map<string, string>();
          for (const raw of rawItem.groupBindings) {
            if (isRecord(raw) && typeof raw.group === "string" && typeof raw.paramName === "string") {
              byGroup.set(raw.group, raw.paramName);
            }
          }
          if (byGroup.size > 0) claimedBindings.set(card, byGroup);
        }

        tabCards.push(card);
        appCards.push(card);
        cards += 1;
      }

      tabs.push({
        id: crypto.randomUUID(),
        name: typeof rawTab.name === "string" ? rawTab.name : key,
        cards: tabCards,
      });
    }

    // A dashboard with no tab has nowhere to put a card and no tab strip to
    // add one from, so an empty import still gets somewhere to work.
    if (tabs.length === 0) tabs.push({ id: crypto.randomUUID(), name: "Main", cards: [] });

    const dashboard: Dashboard = {
      id: crypto.randomUUID(),
      name: dedupe(app.name as string, taken),
      tabs,
    };

    const groups: ParamGroup[] = [];
    for (const rawGroup of Array.isArray(app.groups) ? app.groups : []) {
      if (!isRecord(rawGroup)) continue;
      const paramName = typeof rawGroup.paramName === "string" ? rawGroup.paramName : "";
      if (paramName === "") continue;
      const name = typeof rawGroup.name === "string" ? rawGroup.name : paramName;
      const widgetIds = Array.isArray(rawGroup.widgetIds)
        ? rawGroup.widgetIds.filter((x): x is string => typeof x === "string")
        : [];
      // The union of both sources: the entry's own claim (what Workspace
      // writes) and widgetIds (what some hand-written files carry).
      const members = appCards.filter(
        (card) =>
          widgetIds.includes(card.widgetId) || (claimedGroups.get(card) ?? []).includes(name),
      );
      // A group nothing belongs to would show as a control that binds
      // nothing, so it is not created at all.
      if (members.length === 0 && !appExt) continue;

      // "param" and "endpointParam" alike: bdobb's ParamGroup has no such
      // distinction, and both bind one paramName to one value.
      const defaultValue = typeof rawGroup.defaultValue === "string" ? rawGroup.defaultValue : "";
      /** The param this member binds: its own claim, else the group's name. */
      const boundName = (card: DashboardCard) =>
        claimedBindings.get(card)?.get(name) ?? paramName;
      /**
       * The file's groupType wins; otherwise the type the first resolvable
       * member's control infers — an imported `selected_date` group must be
       * `date`, or its own control could never have joined it; otherwise the
       * name, as every pre-5.1.0 group was keyed.
       */
      let groupType = typeof rawGroup.groupType === "string" && rawGroup.groupType !== "" ? rawGroup.groupType : undefined;
      if (!groupType) {
        for (const card of members) {
          const served = servedById.get(card.widgetId);
          const declared = served?.params.find((p) => p.paramName === boundName(card));
          if (declared) {
            groupType = paramGroupType(declared);
            break;
          }
        }
      }
      const group: ParamGroup = {
        id: crypto.randomUUID(),
        name,
        paramName,
        groupType: groupType ?? paramName,
        value: defaultValue,
      };
      groups.push(group);

      for (const card of members) {
        const bound = boundName(card);
        card.bindings = [
          ...(card.bindings ?? []).filter((b) => b.paramName !== bound),
          { groupId: group.id, paramName: bound },
        ];
        // Seeded only where the value could actually be sent: a widget that
        // never declared the param would carry a stored value no request
        // includes — groupedParamNames (paramGroups.ts) filters exactly that
        // case out of the live binding too. An unresolved card has no widget
        // to ask yet, so it keeps the default and has it honoured once a
        // backend serving its id connects.
        const served = servedById.get(card.widgetId);
        const declares = !served || served.params.some((p) => p.paramName === bound);
        // The group's default seeds a member that has no value of its own; a
        // member that arrived with one keeps it.
        if (declares && ownValue(card.params, bound) === "" && !(appExt && Object.hasOwn(card.params, bound))) {
          card.params[bound] = defaultValue;
        }
      }
    }
    if (appExt?.groupNames) for (const group of groups) {
      if (Object.hasOwn(appExt.groupNames, group.name)) group.name = appExt.groupNames[group.name];
    }
    if (appExt?.groupsDisabled !== undefined) dashboard.groupsDisabled = appExt.groupsDisabled;
    if (groups.length > 0) dashboard.groups = groups;

    // Last, so the order of precedence is the file's own value, then a
    // group's default, then the widget's: a card added from the library opens
    // with the widget's declared defaults, and an imported card that left a
    // param out otherwise sent its request without it.
    for (const card of appCards) {
      const served = servedById.get(card.widgetId);
      if (served) card.params = { ...seedParams(served), ...card.params };
    }

    dashboards.push(dashboard);
  }

  return { dashboards, cards, unresolved };
}

/**
 * Rewrites UNRESOLVED_BACKEND_ID onto whichever backend now serves the card's
 * widget — the same "first backend serving the id" rule
 * useWidgetRegistryStore.find applies, made permanent. Without it, a card
 * that two backends both serve resolves to whichever one happens to be first
 * in the registry this session, and can silently move to the other one after
 * a restart.
 *
 * Returns `dashboard` itself when there is nothing to pin. That identity
 * matters: this runs on every save, layout drag-release included, and a fresh
 * object would re-render every card on the tab for no change.
 */
export function pinResolvedBackends(dashboard: Dashboard, registry: WidgetDef[]): Dashboard {
  const resolve = (card: DashboardCard): DashboardCard => {
    if (card.backendId !== UNRESOLVED_BACKEND_ID) return card;
    const served = registry.find((w) => w.id === card.widgetId);
    return served ? { ...card, backendId: served.backendId } : card;
  };

  let changed = false;
  const tabs = dashboard.tabs.map((tab) => {
    const cards = tab.cards.map(resolve);
    if (cards.every((card, i) => card === tab.cards[i])) return tab;
    changed = true;
    return { ...tab, cards };
  });
  return changed ? { ...dashboard, tabs } : dashboard;
}
