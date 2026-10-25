// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { persistedCard } from "./widgetData/persistence";
import { loadJsonDir, removeJson, saveJson } from "./jsonStore";
import { parseExchange } from "./calendar";
import { notifyDashboardChanged } from "./dashboardSync";
import { ABSENT, loadJson } from "./jsonStore";
import { isRecord } from "./isRecord";
import { parsePresets } from "./presets";
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
  presets?: unknown;
  exchange?: unknown;
  revision?: unknown;
  extensions?: Dashboard["extensions"];
} & ({ cards: StoredCard[] } | { tabs: StoredTab[] });

/**
 * `name` is shape-checked because loading sorts on it with localeCompare.
 * Each tab is checked too: a null tab, or one without a `cards` array, would
 * pass an array-only check and then throw wherever a tab's cards are read,
 * taking every dashboard down with it instead of quarantining this one file.
 */
function isStoredDashboard(value: unknown): value is StoredDashboard {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") return false;
  if ("tabs" in value) {
    return Array.isArray(value.tabs) && value.tabs.every((t: unknown) => isRecord(t) && Array.isArray(t.cards));
  }
  return Array.isArray(value.cards);
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
    // Lenient, as the group shape is: a malformed entry is dropped, never the file.
    presets: parsePresets(stored.presets),
    // Lenient like presets: a catalogue calendar, or another name kept for repair (2026-10-24).
    exchange: parseExchange(stored.exchange),
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

/**
 * One dashboard's own file, for the viewer's sync -- never the directory.
 * loadDashboards would hand a change that arrives mid-read the in-flight
 * result from BEFORE it, and when the directory is empty it seeds a "Main",
 * which a viewer must never write. A missing (or quarantined) file is null:
 * the dashboard is gone, and nothing is created in its place.
 */
export async function loadDashboard(id: string): Promise<Dashboard | null> {
  const stored = await loadJson(pathFor(id), isStoredDashboard);
  return stored === ABSENT ? null : withDefaults(stored);
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

/**
 * Both writers announce themselves, and they do it HERE rather than in the
 * store: every path that persists a dashboard -- a param Apply, a rename, an
 * import, a duplicate -- already funnels through these two functions, so one
 * announcement each covers all of them and no future writer can forget.
 *
 * The viewer window never writes, so it never emits; nothing echoes.
 */
export async function saveDashboard(dashboard: Dashboard): Promise<void> {
  await saveJson(pathFor(dashboard.id), { ...dashboard, tabs: dashboard.tabs.map(t => ({ ...t, cards: t.cards.map(persistedCard) })) });
  await notifyDashboardChanged(dashboard.id);
}

export async function deleteDashboard(id: string): Promise<void> {
  await removeJson(pathFor(id));
  await notifyDashboardChanged(id);
}
