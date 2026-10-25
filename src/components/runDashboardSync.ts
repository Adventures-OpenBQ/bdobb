// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { dedupe } from "../lib/appsJson";
import { planDashboardSync, type ServerItem, type SyncAction } from "../lib/dashboardSyncPlan";
import { LOCAL_TABLE_ID } from "../lib/builtins";
import { isRecord } from "../lib/isRecord";
import { logError, logInfo } from "../lib/logger";
import { serialize } from "../lib/serialize";
import type { Dashboard, SyncLink, SyncStore } from "../lib/types";
import {
  canonicalUuid,
  deleteApp,
  fetchOwnedApps,
  fetchOwnedDashboards,
  fetchServerStore,
  postDashboardItems,
  putApp,
  type ServerRecord,
  type ServerStore,
  type WorkspaceResult,
  type WorkspaceSession,
} from "../lib/workspaceAccount";
import { fromWorkspace, toWorkspace } from "../lib/workspaceDashboards";
import { useBackendsStore } from "../stores/backendsStore";
import { useDashboardStore } from "../stores/dashboardStore";
import { useFoldersStore } from "../stores/foldersStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import { toSettingsConnections, useWorkspaceStore } from "../stores/workspaceStore";
import { linkFor, useWorkspaceSyncStore } from "../stores/workspaceSyncStore";
import { decideDashboardConflict, decideDeletedDashboard } from "./dialogs/WorkspaceDialogs";

type Failure = { message: string; expired: boolean };

/**
 * A failed step. A login 401 expires the session (the queue waits for the
 * next sign-in); anything else is the connection's notice. The log gets the
 * connection id and the message, which never carries server text, a
 * credential or dashboard content.
 */
async function report(id: string, failure: Failure): Promise<void> {
  if (failure.expired) useWorkspaceStore.getState().fail(id, failure);
  else useWorkspaceStore.getState().setNotice(id, `Dashboards not synced: ${failure.message}`);
  await logError(`settings server ${id}: dashboards not synced: ${failure.message}`);
}

type Root = { uuid: string; index: string; content: Record<string, unknown>; children: unknown[] };
function rootOf(owned: Record<string, ServerRecord>): Root | undefined {
  for (const [uuid, r] of Object.entries(owned)) {
    const c = r.content;
    if (isRecord(c) && c.isRoot === true && Array.isArray(c.children)) return { uuid, index: typeof c.index === "string" ? c.index : uuid, content: c, children: c.children };
  }
  return undefined;
}

/**
 * POST dashboard items, plus the root folder with a child added or removed.
 * The root is re-read just before, since another device may have added a
 * child since the last sync, and the whole step is serialized per
 * connection: two new dashboards uploading at once would otherwise each
 * write a root holding only their own child. `build` gets the root's index
 * (null when the server has none yet; key mode then creates it).
 */
function postWithRoot(session: WorkspaceSession, build: (parentId: string | null) => Record<string, unknown>, root: { add?: string; remove?: string }): Promise<WorkspaceResult<"ok" | "absent">> {
  return serialize(`workspace:root:${session.connection.id}`, async (): Promise<WorkspaceResult<"ok" | "absent">> => {
    const owned = await fetchOwnedDashboards(session);
    if (!owned.ok) return owned;
    if (owned.value === null) return { ok: true, value: "absent" };
    const found = rootOf(owned.value);
    const items = build(found ? found.index : null);
    if (found && (root.add !== undefined || root.remove !== undefined)) {
      // Root children may be upper-case or undashed on the server; compare canonically.
      const same = (c: unknown, u: string) => typeof c === "string" && canonicalUuid(c) === canonicalUuid(u);
      const children = found.children.filter((c) => root.remove === undefined || !same(c, root.remove));
      if (root.add !== undefined && !children.some((c) => same(c, root.add!))) children.push(root.add);
      items[found.uuid] = { ...found.content, children };
    }
    return postDashboardItems(session, items);
  });
}

/**
 * Send this connection's tombstones (spec: On sign-in, step 1). A success or
 * a 404 clears one; a failure keeps it and stops, so nothing deleted here
 * comes back down. Serialized per connection: the rail and a sign-in may
 * both send.
 */
function sendTombstones(session: WorkspaceSession): Promise<WorkspaceResult<true>> {
  const id = session.connection.id;
  return serialize(`workspace:tombstones:${id}`, async (): Promise<WorkspaceResult<true>> => {
    for (const t of useWorkspaceSyncStore.getState().tombstones.filter((x) => x.connectionId === id)) {
      const uuid = canonicalUuid(t.uuid);
      const sent = t.store === "app" ? await deleteApp(session, uuid) : await postWithRoot(session, () => ({ [uuid]: "DELETE" }), { remove: uuid });
      if (!sent.ok) return sent;
      await useWorkspaceSyncStore.getState().update((f) => ({ ...f, tombstones: f.tombstones.filter((x) => !(x.connectionId === id && x.store === t.store && x.uuid === t.uuid)) }));
      await logInfo(`deleted ${t.store} ${t.uuid} on ${session.connection.name}`);
    }
    return { ok: true, value: true };
  });
}

/** Every server item mapped up front: one that cannot be read throws, and the caller writes nothing. Folders are not dashboards. */
function mapAll(store: ServerStore): ServerItem[] {
  const registry = useWidgetRegistryStore.getState().widgets;
  const items: ServerItem[] = [];
  const add = (map: Record<string, ServerRecord>, kind: SyncStore, shared: boolean) => {
    for (const [uuid, r] of Object.entries(map)) {
      if (kind === "dashboard" && isRecord(r.content) && r.content.isFolder === true) continue;
      items.push({ store: kind, uuid, updated: r.updated, shared, dashboard: fromWorkspace(r.content, kind, registry) });
    }
  };
  add(store.owned, "dashboard", false);
  add(store.shared, "dashboard", true);
  add(store.apps, "app", false);
  return items;
}

/**
 * A local table's file never leaves the device, so the server's copy of that card has none. Where the
 * incoming card is the same widget (its server widget id, or the id BDOBB uploaded it under) as a local
 * table card here, it keeps the local card's file instead of coming up empty.
 */
function carryFiles(current: Dashboard | undefined, incoming: Dashboard): Dashboard {
  const files = new Map<string, string>();
  for (const card of current?.tabs.flatMap((t) => t.cards) ?? []) {
    if (card.widgetId !== LOCAL_TABLE_ID || !card.params.file) continue;
    files.set(card.extensions?.workspace?.widget.id as string ?? card.id, card.params.file);
  }
  if (files.size === 0) return incoming;
  const tabs = incoming.tabs.map((t) => ({
    ...t,
    cards: t.cards.map((c) => {
      const file = c.widgetId === LOCAL_TABLE_ID && !c.params.file ? files.get(c.extensions?.workspace?.widget.id as string) : undefined;
      return file === undefined ? c : { ...c, params: { ...c.params, file } };
    }),
  }));
  return { ...incoming, tabs };
}

const sameItem = (a: SyncLink, b: SyncLink) => a.connectionId === b.connectionId && a.store === b.store && a.uuid === b.uuid;

/**
 * Ask what needs asking, then write: dashboards first, links after. Uploads
 * ("upload", "uploadNew", Keep local, Keep both's local copy, Keep as local)
 * are not sent here -- uploadPending sends every dashboard whose revision
 * moved or that has no link, once these writes are in.
 */
async function apply(session: WorkspaceSession, actions: SyncAction[]): Promise<Set<string>> {
  const id = session.connection.id;
  const server = session.connection.name;
  const local = useDashboardStore.getState().dashboards;
  const names = new Set(local.map((d) => d.name));
  const upserts: Dashboard[] = [];
  const removals: string[] = [];
  const added: SyncLink[] = [];
  const dropped: SyncLink[] = [];
  // Writes that overwrite or delete a local dashboard are held until the questions are answered, then dropped
  // if that dashboard was saved meanwhile (revision moved off the snapshot's): its link stays, so the next sync asks.
  const guarded: { id: string; rev: number | undefined; upsert?: Dashboard; add?: SyncLink; remove?: boolean; drop?: SyncLink }[] = [];
  const revOf = (list: Dashboard[], id: string) => { const d = list.find((x) => x.id === id); return d && (d.revision ?? 0); };
  const linkTo = (item: ServerItem, dashboard: Dashboard): SyncLink => ({
    dashboardId: dashboard.id, connectionId: id, store: item.store, uuid: item.uuid,
    serverUpdatedDate: item.updated, localRevisionAtSync: dashboard.revision ?? 0, shared: item.shared,
  });
  const take = (link: SyncLink, item: ServerItem) => {
    const current = local.find((d) => d.id === link.dashboardId);
    const next: Dashboard = { ...carryFiles(current, item.dashboard), id: link.dashboardId, revision: current?.revision };
    guarded.push({ id: link.dashboardId, rev: revOf(local, link.dashboardId), upsert: next, add: linkTo(item, next) });
  };
  const nameOf = (link: SyncLink) => local.find((d) => d.id === link.dashboardId)?.name ?? link.uuid;
  for (const action of actions) {
    if (action.kind === "take") take(action.link, action.item);
    else if (action.kind === "create") {
      names.add(action.item.dashboard.name);
      upserts.push(action.item.dashboard);
      added.push(linkTo(action.item, action.item.dashboard));
    } else if (action.kind === "deleteLocal") {
      guarded.push({ id: action.link.dashboardId, rev: revOf(local, action.link.dashboardId), remove: true, drop: action.link });
    } else if (action.kind === "dropLink") dropped.push(action.link);
    else if (action.kind === "conflict") {
      // The 2026-10-03 import ruling: Keep both suffixes the incoming copy, first unused " (n)".
      const keepBoth = dedupe(action.item.dashboard.name, new Set(names));
      const choice = await decideDashboardConflict(server, nameOf(action.link), keepBoth);
      if (choice === "server") take(action.link, action.item);
      else if (choice === "both") {
        const copy = { ...action.item.dashboard, name: dedupe(action.item.dashboard.name, names) };
        upserts.push(copy);
        // The server item now belongs to the copy; the local one goes up as new. One revision below the copy's,
        // so uploadPending sends the copy's new name back to its own uuid and the server's names match ours.
        added.push({ ...linkTo(action.item, copy), localRevisionAtSync: (copy.revision ?? 0) - 1 });
      }
    } else if (action.kind === "deletedConflict") {
      if ((await decideDeletedDashboard(server, nameOf(action.link))) === "delete") guarded.push({ id: action.link.dashboardId, rev: revOf(local, action.link.dashboardId), remove: true, drop: action.link });
      else dropped.push(action.link); // Keep as local: unlinked, so it goes up as a new dashboard
    }
  }
  const now = useDashboardStore.getState().dashboards;
  const skipped = new Set<string>();
  for (const g of guarded) {
    if (revOf(now, g.id) !== g.rev) { skipped.add(g.id); continue; }
    if (g.upsert) upserts.push(g.upsert);
    if (g.add) added.push(g.add);
    if (g.remove) removals.push(g.id);
    if (g.drop) dropped.push(g.drop);
  }
  await useDashboardStore.getState().applySynced(upserts, removals);
  for (const removed of removals) await useFoldersStore.getState().moveDashboard(removed, null);
  await useWorkspaceSyncStore.getState().update((f) => ({
    ...f,
    links: [...f.links.filter((l) => !dropped.some((d) => sameItem(d, l) && d.dashboardId === l.dashboardId) && !added.some((a) => sameItem(a, l))), ...added],
  }));
  return skipped;
}

/**
 * The connections whose whole dashboard sync finished. Nothing uploads to a connection whose sync
 * failed or was skipped: a POST could overwrite a server version never compared, or pass a pending
 * tombstone. Keyed by id, not session object: the store rewrites sessions[id] on routine events
 * (settings uploads, failures). Cleared at the start of each sync and whenever the session ends.
 */
const syncedConnections = new Set<string>();
/** Bumped each time a connection's signed-in session ends, so a run can tell a sign-out/sign-in happened under it. */
const sessionEnds = new Map<string, number>();
const endsOf = (id: string) => sessionEnds.get(id) ?? 0;
useWorkspaceStore.subscribe((s, prev) => {
  for (const id of Object.keys(prev.sessions)) if (prev.sessions[id]?.state === "signed-in" && s.sessions[id]?.state !== "signed-in") sessionEnds.set(id, endsOf(id) + 1);
  for (const id of syncedConnections) if (s.sessions[id]?.state !== "signed-in") syncedConnections.delete(id);
});

/**
 * Upload one dashboard (spec: Sync rules step 4; While signed in): an
 * update of its linked item, or a new dashboard item when it has no link.
 * Serialized per dashboard. Nothing goes to a session that is not signed
 * in, not synced or is deciding, nor for a shared dashboard, nor when the revision has
 * not moved. A failed upload leaves the link alone, so the next save or
 * sign-in sends it again. POST returns no date, so the item's new
 * updated_date is read back.
 */
export function uploadDashboard(connectionId: string, dashboardId: string): Promise<void> {
  return serialize(`workspace:dash:${connectionId}:${dashboardId}`, async () => {
    const ws = useWorkspaceStore.getState();
    const session = ws.sessions[connectionId];
    if (session === undefined || session.state !== "signed-in" || ws.deciding.includes(connectionId) || !syncedConnections.has(connectionId)) return;
    const dashboard = useDashboardStore.getState().dashboards.find((d) => d.id === dashboardId);
    if (dashboard === undefined) return;
    const link = linkFor(useWorkspaceSyncStore.getState().links, connectionId, dashboardId);
    const revision = dashboard.revision ?? 0;
    // Shared on ANY connection means read-only everywhere: a copy downloaded from there must never go up here.
    if (useWorkspaceSyncStore.getState().links.some((l) => l.dashboardId === dashboardId && l.shared)) return;
    if (link !== undefined && revision === link.localRevisionAtSync) return;
    const store: SyncStore = link?.store ?? "dashboard";
    const uuid = link ? canonicalUuid(link.uuid) : crypto.randomUUID();
    // A linked item with its shell keeps the shell's own place (it may sit in a sub-folder); anything else is placed here.
    const sent = store === "app"
      ? await putApp(session, uuid, toWorkspace(dashboard, "app"))
      : await postWithRoot(session, (parentId) => ({ [uuid]: toWorkspace(dashboard, "dashboard", link && dashboard.extensions?.workspace ? undefined : { index: uuid, parentId }) }), link ? {} : { add: uuid });
    // Signed out meanwhile: the gate is gone with the session, so a failure is not reported to it.
    if (!sent.ok) return syncedConnections.has(connectionId) ? report(connectionId, sent) : undefined;
    if (sent.value === "absent") return logInfo(`${session.connection.name} keeps no ${store}s; ${dashboard.name} stays local`);
    // The item is on the server now, so the link is written whatever happened since (else the next sign-in
    // creates a duplicate). Only the read-back needs a live session; without it the date is "", which differs
    // from the item's real date, so the next sync re-reads the item rather than trusting a stale one.
    const listed = !syncedConnections.has(connectionId) ? undefined : store === "app" ? await fetchOwnedApps(session) : await fetchOwnedDashboards(session);
    const serverUpdatedDate = (listed?.ok && listed.value?.[uuid]?.updated) || "";
    const next: SyncLink = { dashboardId, connectionId, store, uuid, serverUpdatedDate, localRevisionAtSync: revision, shared: false };
    await useWorkspaceSyncStore.getState().update((f) => ({ ...f, links: [...f.links.filter((l) => !(sameItem(l, next) || (l.connectionId === connectionId && l.dashboardId === dashboardId && !l.dismissed))), next] }));
    await logInfo(`uploaded ${store} ${dashboard.name} (${uuid}) to ${session.connection.name}`);
  });
}

/** Every dashboard that needs sending after a sync: uploadDashboard itself skips the unchanged and the shared. */
function uploadPending(id: string, skip: Set<string>): Promise<unknown> {
  return Promise.all(useDashboardStore.getState().dashboards.filter((d) => !skip.has(d.id)).map((d) => uploadDashboard(id, d.id)));
}

/**
 * The dashboard half of the sign-in sync (spec: On sign-in), run once the
 * settings step has succeeded: tombstones first, then one all-or-nothing
 * download, then the decisions, then the local writes, then the uploads.
 * `deciding` holds the connection for the whole run, so no save uploads
 * underneath a question; whatever was saved meanwhile goes up with the rest
 * at the end. A server that keeps no dashboards leaves sync settings-only,
 * which is not an error.
 */
export function syncDashboards(id: string): Promise<void> {
  // One run per connection at a time: connectServer re-runs the sign-in sync for a live session, and two runs
  // would plan against the same links, create twice, and let the first one's finish reopen the gate mid-second.
  return serialize(`workspace:sync:${id}`, () => runSync(id));
}

async function runSync(id: string): Promise<void> {
  const session = useWorkspaceStore.getState().sessions[id];
  if (session === undefined || session.state !== "signed-in") return;
  const ends = endsOf(id);
  if (useWorkspaceSyncStore.getState().unreadable) return report(id, { message: "The sync link records could not be read, so local and server dashboards are left as they are.", expired: false });
  useWorkspaceStore.setState((s) => ({ deciding: [...s.deciding, id] }));
  syncedConnections.delete(id);
  let skipped: Set<string> | undefined;
  try {
    const sent = await sendTombstones(session);
    if (!sent.ok) return await report(id, sent);
    const fetched = await fetchServerStore(session);
    if (!fetched.ok) return await report(id, fetched);
    if (fetched.value === null) return;
    let items: ServerItem[];
    try {
      items = mapAll(fetched.value);
    } catch {
      return await report(id, { message: "The server's dashboards could not be read; local dashboards are unchanged.", expired: false });
    }
    // A rail delete since the fetch left a tombstone for an item the fetch still shows: it is not new, it is going.
    const pending = useWorkspaceSyncStore.getState().tombstones.filter((t) => t.connectionId === id).map((t) => `${t.store}:${canonicalUuid(t.uuid)}`);
    items = items.filter((i) => !pending.includes(`${i.store}:${canonicalUuid(i.uuid)}`));
    try {
      skipped = await apply(session, planDashboardSync(id, useWorkspaceSyncStore.getState().links, useDashboardStore.getState().dashboards, items));
    } catch {
      // The local write or the links write failed. Without the links, the next sign-in would re-create the server's
      // items here; say so now, and leave the gate shut so nothing uploads over a version never compared.
      return await report(id, { message: "The sync could not be saved on this device; it will be tried again at the next sign-in.", expired: false });
    }
    // A sign-out (and sign-in) during the run made this a different session: its gate is not ours to open.
    if (useWorkspaceStore.getState().sessions[id]?.state !== "signed-in" || endsOf(id) !== ends) return;
    syncedConnections.add(id);
  } finally {
    useWorkspaceStore.setState((s) => ({ deciding: s.deciding.filter((x) => x !== id) }));
  }
  // A dashboard saved during a question was left for the next sync to ask about; it does not upload over the server's version now.
  if (skipped) await uploadPending(id, skipped);
}

/** How long a burst of saves settles before its one upload. */
export const UPLOAD_DEBOUNCE_MS = 1500;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * While signed in, a save of a linked, non-shared dashboard uploads after a
 * short debounce (spec: While signed in). Every written edit bumps
 * `revision`, so a moved revision is the trigger. Only the settings server
 * syncs dashboards. uploadDashboard refuses an expired, not-synced or
 * deciding session; whatever it refused goes at the next sign-in. Main
 * window only. Returns the unsubscribe.
 */
export function startDashboardAutoUpload(): () => void {
  const unsubscribe = useDashboardStore.subscribe((state, prev) => {
    const id = useSettingsStore.getState().settings.settingsStorage;
    if (id === undefined || useWorkspaceStore.getState().sessions[id] === undefined) return;
    const before = new Map(prev.dashboards.map((d) => [d.id, d.revision]));
    for (const d of state.dashboards) {
      if (d.revision === before.get(d.id)) continue;
      const link = linkFor(useWorkspaceSyncStore.getState().links, id, d.id);
      if (link === undefined || link.shared) continue;
      clearTimeout(timers.get(d.id));
      timers.set(d.id, setTimeout(() => {
        timers.delete(d.id);
        void uploadDashboard(id, d.id);
      }, UPLOAD_DEBOUNCE_MS));
    }
  });
  return () => {
    unsubscribe();
    timers.forEach((timer) => clearTimeout(timer));
    timers.clear();
  };
}

/** The servers a rail delete of this dashboard also deletes it from: its live, non-shared links' connections, by name. */
export function deleteTargets(dashboardId: string): string[] {
  const list = toSettingsConnections(useWorkspaceStore.getState().connections, useBackendsStore.getState().backends);
  return useWorkspaceSyncStore.getState().links
    .filter((l) => l.dashboardId === dashboardId && !l.shared && !l.dismissed)
    .map((l) => list.find((c) => c.id === l.connectionId)?.name ?? l.connectionId);
}

/**
 * The rail's delete (spec: Delete from the rail). Each non-shared link
 * becomes a canonical tombstone BEFORE the local delete, so a crash between
 * the two can only delete on the server later, never lose the delete; a
 * shared link is kept as dismissed, so the next sync does not download it
 * again. Then the local delete, at once. Then each connection that is
 * signed in AND finished its dashboard sync is sent its tombstones now (the
 * same gate as uploads); the rest go first at the next sign-in sync.
 */
export async function deleteSyncedDashboard(dashboardId: string): Promise<void> {
  const live = useWorkspaceSyncStore.getState().links.filter((l) => l.dashboardId === dashboardId && !l.dismissed);
  if (live.length > 0) {
    await useWorkspaceSyncStore.getState().update((f) => ({
      links: f.links.flatMap((l) => (l.dashboardId !== dashboardId || l.dismissed ? [l] : l.shared ? [{ ...l, dismissed: true }] : [])),
      tombstones: [...f.tombstones, ...live.filter((l) => !l.shared).map(({ connectionId, store, uuid }) => ({ connectionId, store, uuid: canonicalUuid(uuid) }))],
    }));
  }
  await useDashboardStore.getState().removeDashboard(dashboardId);
  for (const id of new Set(live.filter((l) => !l.shared).map((l) => l.connectionId))) {
    const ws = useWorkspaceStore.getState();
    const session = ws.sessions[id];
    if (session?.state !== "signed-in" || ws.deciding.includes(id) || !syncedConnections.has(id)) continue;
    const sent = await sendTombstones(session);
    if (!sent.ok) await report(id, sent);
  }
}
