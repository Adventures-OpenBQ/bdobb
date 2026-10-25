// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { Dashboard, SyncLink, SyncStore } from "./types";

/** One downloaded server dashboard or app, already mapped (all-or-nothing, before any decision). */
export type ServerItem = { store: SyncStore; uuid: string; updated: string; shared: boolean; dashboard: Dashboard };

export type SyncAction =
  | { kind: "take"; link: SyncLink; item: ServerItem }
  | { kind: "upload"; link: SyncLink }
  | { kind: "conflict"; link: SyncLink; item: ServerItem }
  | { kind: "deleteLocal"; link: SyncLink }
  | { kind: "deletedConflict"; link: SyncLink }
  | { kind: "create"; item: ServerItem }
  | { kind: "uploadNew"; dashboardId: string }
  | { kind: "dropLink"; link: SyncLink };

/**
 * The sign-in decision table (spec: Sync rules, step 3) for one connection.
 * Pure: it reads links, local revisions and the mapped server items, and
 * says what to do; runDashboardSync asks and writes. A shared dashboard
 * never counts as changed locally (it is never uploaded). A dismissed link
 * hides its server item for good. A link whose dashboard no longer exists
 * here is dropped, and its server item is then simply new.
 */
export function planDashboardSync(
  connectionId: string,
  links: SyncLink[],
  dashboards: Pick<Dashboard, "id" | "revision">[],
  items: ServerItem[],
): SyncAction[] {
  const key = (store: SyncStore, uuid: string) => `${store}:${uuid}`;
  const byKey = new Map(items.map((i) => [key(i.store, i.uuid), i]));
  const revisions = new Map(dashboards.map((d) => [d.id, d.revision ?? 0]));
  const claimed = new Set<string>();
  const linked = new Set<string>();
  const actions: SyncAction[] = [];
  for (const link of links) {
    if (link.connectionId !== connectionId) continue;
    const k = key(link.store, link.uuid);
    if (link.dismissed) {
      claimed.add(k);
      continue;
    }
    const revision = revisions.get(link.dashboardId);
    if (revision === undefined) {
      actions.push({ kind: "dropLink", link });
      continue;
    }
    claimed.add(k);
    linked.add(link.dashboardId);
    const item = byKey.get(k);
    const localChanged = !link.shared && revision !== link.localRevisionAtSync;
    if (item === undefined) actions.push({ kind: localChanged ? "deletedConflict" : "deleteLocal", link });
    else if (item.updated !== link.serverUpdatedDate) actions.push(localChanged ? { kind: "conflict", link, item } : { kind: "take", link, item });
    else if (localChanged) actions.push({ kind: "upload", link });
  }
  for (const item of items) if (!claimed.has(key(item.store, item.uuid))) actions.push({ kind: "create", item });
  for (const d of dashboards) if (!linked.has(d.id)) actions.push({ kind: "uploadNew", dashboardId: d.id });
  return actions;
}
