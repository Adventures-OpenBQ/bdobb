# Workspace dashboard and app sync

Date: 2026-10-10
Status: approved in brainstorming (sections 1–4); written spec awaiting review
Home line: v3 (client and openbq-docker), carried v4 → v5 → v6 → v7

## Why

Signing in to a settings server downloads settings only. Dashboards were meant to come too: the
2026-10-08 Workspace-connection spec put "syncing dashboards" out of scope, and the 2026-10-05 brief
deferred it. This spec closes that gap: BDOBB syncs dashboards and apps with the server in both
directions, including deletes.

## What syncs

| Server store | Download | Upload | Delete |
|---|---|---|---|
| Owned dashboards (`/pro/dash/sync/owned`) | yes | yes, back to the same uuid | both ways |
| Shared dashboards (`/pro/dash/sync/shared`) | yes, read-only, marked shared | never | local copy only |
| Owned apps (`/pro/user-apps/sync`) | yes | yes, back to the same uuid | both ways |

A dashboard created in BDOBB uploads as a new Workspace dashboard and is added to the root folder's
`children`. It is not uploaded as an app.

## Server API (Workspace and key mode)

The client speaks one protocol: the subset of Workspace's own routes below. Workspace serves them
(login mode, `Authorization: Bearer`). openbq-docker's key-mode settings API gains the same routes
(section "Key-mode backend").

- `GET /pro/dash/sync/owned` returns `{owned: {uuid: DashboardReturn}}`.
- `GET /pro/dash/sync/shared` returns `{shared: {...}, entity_shared: {...}}`.
- `POST /pro/dash/sync` with `{items: {uuid: content | "DELETE"}}` returns `{success: true}`.
- `GET /pro/user-apps/sync` returns `{owned: {...}, shared: {...}}`.
- `POST /pro/user-apps/{uuid}` with `content` upserts one app.
- `DELETE /pro/user-apps/{uuid}` deletes one app.

`DashboardReturn` is `{creator, content, created_date, updated_date, created_by, is_shared}`.

Dashboard content is either a folder item (`isFolder`, `isRoot`, `children`) or a dashboard item
whose `data` holds `{name, widgets[], gridLayout: {tabKey: [layoutItem]}, currentTab, groups, …}`.
App content (`UserAppCreate`) has the same `widgets` / `gridLayout` / `groups` / `currentTab`
shape. A server that answers 404 on these routes has no dashboard store: sync stays settings-only,
and that is not an error.

## Mapper (`src/lib/workspaceDashboards.ts`)

One module converts in both directions. It serves both stores.

### Workspace → BDOBB

- Each `gridLayout` key becomes a tab. The tab's name comes from the `navigation_bar` widget's tab
  labels, falling back to the key.
- Each widget other than `navigation_bar` becomes a card:
  - `widgetId` carries across unchanged;
  - params come from `storage.params`, converted by the importer's `toParams` rules: lists are
    comma-joined, numbers and booleans are stringified, anything else is dropped;
  - the layout is the `x, y, w, h` of the grid entry whose `i` equals the widget `id`;
  - `storage.chartView` becomes the card's chart view;
  - the backend is resolved as `importApps` resolves it, and a widget no backend serves becomes an
    unresolved card.
- Cards get fresh local ids. Server ids, `owner` and `created_by` are never used as local identity.

### Round trip

Each card keeps the original widget record under `card.extensions.workspace`, so fields BDOBB does
not model survive a round trip. Upload rebuilds the record from that copy plus the card's current
params, chart view and layout. `navigation_bar` is regenerated from the tab list. A dashboard
downloaded and uploaded unchanged returns content-equivalent.

### BDOBB-only cards

Built-ins such as Note, Clock and Markdown upload as a widget record with BDOBB's `widgetId`, with
the card's state in `extensions.bdobb`. Workspace shows them as unknown widgets. BDOBB restores them
exactly.

## Link records and tombstones (`workspaceSync.json`)

The file sits next to `settings.json` and is never exported. It holds:

- **Links**, one per synced dashboard: `{dashboardId, connectionId, store: "dashboard" | "app",
  uuid, serverUpdatedDate, localRevisionAtSync, shared, dismissed?}` (`dismissed`: a shared dashboard
  deleted locally, never downloaded again). Dashboards gain a local `revision` counter
  that increments on every save.
- **Tombstones**, one per pending server delete: `{connectionId, store, uuid}`.

## Sync rules

### On sign-in (after the settings step)

1. Send the tombstones. A successful send, or a 404, clears the tombstone. A failure keeps it and
   stops the sync, so that nothing deleted comes back down.
2. Fetch owned dashboards, shared dashboards and apps, then map them all. If any fetch or mapping
   fails, nothing is written (all-or-nothing). The reason shows on the connection.
3. Decide each item:

   | Server since last sync | Local since last sync | Action |
   |---|---|---|
   | changed | unchanged | take server |
   | unchanged | changed | upload |
   | changed | changed | ask: Use server / Keep local / Keep both (default; suffix per the 2026-10-03 import ruling) |
   | deleted | unchanged | delete local |
   | deleted | changed | ask: Delete / Keep as local (unlink) |
   | new on server | — | create local and link |
   | — | new local, unlinked | upload as new dashboard |

4. Write the local results, then queue the uploads.

### While signed in

- A save of a linked, non-shared dashboard queues an upload after a short debounce. The queue is
  serialized per item, as the settings upload queue (`queueUpload`) is.
- Nothing uploads to a session that is expired, not synced, or still deciding conflicts.

### Delete from the rail

- The confirm dialog for a linked dashboard reads: "Delete 'X' here and on <server>?"
- A dashboard is deleted with `POST /pro/dash/sync` `{items: {uuid: "DELETE"}}`, together with the
  root folder's `children` minus that uuid. An app is deleted with `DELETE /pro/user-apps/{uuid}`.
- Signed out or offline, the local delete happens at once and a tombstone is written.
- A shared dashboard's delete removes only the local copy. The link is marked dismissed, so the next
  sync does not download it again.

## Errors

- A download is all-or-nothing, and local state is untouched on failure.
- Uploads retry on the queue. A 401 marks the session expired, and the queue waits for the next
  sign-in.
- The log records names, uuids and HTTP statuses only: no passwords, tokens or dashboard content.

## Key-mode backend (openbq-docker `v3/openbq_settings.py`)

- The same middleware serves the routes above, behind the existing Basic-auth gate. With API auth
  off, the routes answer 404, as `/pro/user` does today.
- Storage is per credential, next to the settings object: one dashboards file and one apps file.
  Writes are atomic (temp file then rename) and serialized by one lock. The server sets
  `updated_date`. The root folder is created on the first write.
- A body over 5 MB answers 413. An item that is not a JSON object answers 400.
- `shared` and `entity_shared` are always empty, since key mode has no sharing.

## Testing

- **Mapper.** Round-trip fixtures from a real, sanitized Workspace dashboard (Fama-French: two tabs,
  `navigation_bar`, table widgets with option params) and an app. Workspace → BDOBB → Workspace must
  change nothing except edited values. BDOBB built-ins (the v7.0.0 touch example) must survive
  BDOBB → Workspace → BDOBB.
- **Sync.** Unit tests cover every row of the decision table, tombstones (sent first, and surviving
  a restart), shared read-only, the 404 settings-only fallback and all-or-nothing failure. Fetch is
  mocked, as in the existing workspace tests.
- **Backend.** pytest covers each route, isolation between credentials, DELETE, atomic writes, 413
  and 400, and 404 when auth is off.
- **Live.**
  - openbq-docker key mode in a local container with auth on.
  - The NAS Workspace (`https://openbq-workspace.YOUR-TAILNET.ts.net/api`), with the user signing
    in. Check that a Workspace-made dashboard appears in BDOBB, that a BDOBB edit appears in
    Workspace, and that a rail delete removes it from Workspace. Run on macOS and the iPad
    simulator.

## Release sequence

1. Plan.
2. Build on `release/v3`: client and openbq-docker v3.
3. Test.
4. Re-cut v3.0.0 on both repos, including GHCR.
5. Carry and test v4 → v5 → v6 → v7, re-cutting each shipped line. v6's tag stays gated on its own
   open issues (#39, #40).
6. NAS deploys happen only on request.

The v7.0.0 touch sample reaches admin@openbb.co's profile through the feature itself: the user signs
in from BDOBB with the example imported, and BDOBB uploads it.

## Out of scope

- Sharing management (share, unshare, permissions), versions (`/pro/dash/{uuid}/versions`) and
  folders other than the root.
- Backends, provider keys and files (`stored_file`).
