// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord } from "./isRecord";
import { loadJsonDir, removeJson, saveJson } from "./jsonStore";
import type { Dashboard, DashboardCard, DashboardTab, ParamBinding, ParamGroup } from "./types";

const DIR = "dashboards";

const pathFor = (id: string) => `${DIR}/${id}.json`;

/**
 * A group as an older file wrote it: groupType arrived at v5.1.0.
 */
type StoredGroup = Omit<ParamGroup, "groupType"> & { groupType?: string };

/**
 * A card as an older file wrote it: `groupIds` was replaced by `bindings`
 * at v5.1.0. Both are optional because either era's file may carry neither.
 */
type StoredCard = Omit<DashboardCard, "bindings"> & {
  bindings?: ParamBinding[];
  groupIds?: string[];
};
type StoredTab = Omit<DashboardTab, "cards"> & { cards: StoredCard[] };

/**
 * What a dashboard looks like on disk: either the current shape (`tabs`), or
 * a file written before tabs existed (a flat `cards` array). `withDefaults`
 * is the only place a legacy file is normalized into the current shape — on
 * read, not on write, so a dashboard written before tabs existed keeps
 * loading correctly and converges to the new shape the next time it's saved.
 * Mirrors the authLocation/validateWidgets pattern in backendsFile.ts.
 */
type StoredDashboard = {
  id: string;
  name: string;
  groups?: StoredGroup[];
  groupsDisabled?: boolean;
  revision?: unknown;
  extensions?: Dashboard["extensions"];
} & ({ cards: StoredCard[] } | { tabs: StoredTab[] });

const isString = (value: unknown): value is string => typeof value === "string";

const arrayOf = (value: unknown, check: (item: unknown) => boolean): boolean =>
  Array.isArray(value) && value.every(check);

const optionalArrayOf = (value: unknown, check: (item: unknown) => boolean): boolean =>
  value === undefined || arrayOf(value, check);

function isStoredGroup(value: unknown): boolean {
  return isRecord(value) && isString(value.id) && isString(value.name)
    && isString(value.paramName) && isString(value.value)
    && (value.groupType === undefined || isString(value.groupType));
}

function isStoredBinding(value: unknown): boolean {
  return isRecord(value) && isString(value.groupId) && isString(value.paramName);
}

function isStoredColumnFilter(filter: unknown): boolean {
  if (!isRecord(filter) || !isString(filter.id) || !Object.hasOwn(filter, "value")) return false;
  const value = filter.value;
  if (isString(value)) return true;
  if (!isRecord(value)) return false;

  const { min, max, from, to } = value;
  if (min !== undefined || max !== undefined) {
    return from === undefined && to === undefined
      && (min === undefined || Number.isFinite(min))
      && (max === undefined || Number.isFinite(max));
  }
  return (from !== undefined || to !== undefined)
    && (from === undefined || isString(from))
    && (to === undefined || isString(to));
}

function isStoredTable(value: unknown): boolean {
  return isRecord(value)
    && optionalArrayOf(value.columnOrder, isString)
    && optionalArrayOf(value.hidden, isString)
    && optionalArrayOf(value.sorting, (sort) =>
      isRecord(sort) && isString(sort.id) && typeof sort.desc === "boolean")
    && optionalArrayOf(value.columnFilters, isStoredColumnFilter);
}

function isStoredCard(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.layout) || !isRecord(value.params)) return false;
  const { x, y, w, h } = value.layout;
  return isString(value.id) && isString(value.widgetId) && isString(value.backendId)
    && Object.values(value.params).every(isString)
    && [x, y, w, h].every(Number.isFinite)
    && (value.title === undefined || isString(value.title))
    && (value.table === undefined || isStoredTable(value.table))
    && optionalArrayOf(value.bindings, isStoredBinding)
    && optionalArrayOf(value.groupIds, isString);
}

/** Check the fields normalization and rendering depend on before accepting a file. */
function isStoredDashboard(value: unknown): value is StoredDashboard {
  if (!isRecord(value) || !isString(value.id) || !isString(value.name)) return false;
  if (!optionalArrayOf(value.groups, isStoredGroup)) return false;
  if ("tabs" in value) {
    return arrayOf(value.tabs, (tab) =>
      isRecord(tab) && isString(tab.id) && isString(tab.name) && arrayOf(tab.cards, isStoredCard));
  }
  return arrayOf(value.cards, isStoredCard);
}

/** A group written before groupType existed is keyed by its own paramName. */
function withGroupType(groups: StoredGroup[] | undefined): ParamGroup[] | undefined {
  return groups?.map((g) => ({ ...g, groupType: g.groupType ?? g.paramName }));
}

/**
 * `groupIds` named a group and meant "bound on that group's own paramName";
 * a binding says the same thing explicitly. An id naming no group on the
 * dashboard is dropped here rather than carried: groupsForCard used to
 * filter such ids on every read, and a dangling binding would only ever be
 * filtered the same way.
 */
function withBindings(card: StoredCard, groups: ParamGroup[]): DashboardCard {
  const { groupIds, ...rest } = card;
  if (!groupIds) return rest;
  const bindings = [...(rest.bindings ?? [])];
  for (const id of groupIds) {
    const group = groups.find((g) => g.id === id);
    if (group && !bindings.some((b) => b.paramName === group.paramName)) {
      bindings.push({ groupId: id, paramName: group.paramName });
    }
  }
  return bindings.length > 0 ? { ...rest, bindings } : rest;
}

function withDefaults(stored: StoredDashboard): Dashboard {
  // Every field is named explicitly rather than spread, which is why a new
  // one has to be added here too: without this line groupsDisabled would be
  // written correctly and then silently dropped on the very next read.
  const groups = withGroupType(stored.groups);
  const cards = (list: StoredCard[]) => list.map((c) => withBindings(c, groups ?? []));
  const tabs =
    "tabs" in stored
      ? stored.tabs.map((t) => ({ ...t, cards: cards(t.cards) }))
      : [{ id: crypto.randomUUID(), name: "Main", cards: cards(stored.cards) }];
  return {
    id: stored.id,
    name: stored.name,
    tabs,
    groups,
    groupsDisabled: stored.groupsDisabled,
    // A revision that is not a number would concatenate on the next bump; it reads as absent (0).
    revision: typeof stored.revision === "number" ? stored.revision : undefined,
    extensions: stored.extensions,
  };
}

export function makeDefaultDashboard(): Dashboard {
  return {
    id: crypto.randomUUID(),
    name: "Main",
    tabs: [{ id: crypto.randomUUID(), name: "Main", cards: [] }],
  };
}

/**
 * Seeding is check-then-act, and the write lands under a fresh
 * `crypto.randomUUID()`. Two overlapping callers therefore both read an empty
 * directory and both seed, leaving two dashboards named "Main" at different
 * paths. App.tsx bootstraps in an effect and React.StrictMode double-mounts in
 * dev, so that overlap is the normal case, not a rare race. Sharing one
 * in-flight load collapses them onto a single result.
 */
let inFlight: Promise<Dashboard[]> | null = null;

export async function loadDashboards(): Promise<Dashboard[]> {
  inFlight ??= readOrSeed();
  try {
    return await inFlight;
  } finally {
    // Cleared so a later load — after a dashboard is added or deleted — reads
    // the directory again instead of replaying this result.
    inFlight = null;
  }
}

async function readOrSeed(): Promise<Dashboard[]> {
  const loaded = await loadJsonDir(DIR, isStoredDashboard);
  if (loaded.length === 0) {
    const seeded = makeDefaultDashboard();
    await saveJson(pathFor(seeded.id), seeded);
    return [seeded];
  }
  return loaded.map(withDefaults).sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveDashboard(dashboard: Dashboard): Promise<void> {
  await saveJson(pathFor(dashboard.id), dashboard);
}

export async function deleteDashboard(id: string): Promise<void> {
  await removeJson(pathFor(id));
}
