# Workspace Dashboard and App Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signing in to a settings server syncs dashboards and apps both ways, deletes included, against OpenBB Workspace (login mode) and openbq-docker's key-mode settings API (which gains the same routes).

**Architecture:**
- **Backend (openbq-docker `v3/openbq_settings.py`).** The existing Basic-auth middleware gains Workspace's own dashboard routes (`/pro/dash/sync/owned`, `/pro/dash/sync/shared`, `POST /pro/dash/sync`) and app routes (`/pro/user-apps/sync`, `POST`/`DELETE /pro/user-apps/{uuid}`). Storage is per credential, with one dashboards file and one apps file, written atomically under one lock.
- **Client, pure layer.**
  - `workspaceDashboards.ts` maps server content to a `Dashboard` and back. It goes through `importApps` for backend resolution and params, and keeps the server records in `extensions.workspace`, so an untouched dashboard round-trips unchanged.
  - `dashboardSyncPlan.ts` is the decision table, as a pure function.
- **Client, I/O layer.**
  - `workspaceAccount.ts` gains the HTTP calls.
  - `workspaceSyncStore.ts` persists links and tombstones in `workspaceSync.json`.
  - `runDashboardSync.ts` orchestrates the flow: tombstones, then an all-or-nothing download, then decisions, then writes, then uploads. It also owns the debounced auto-upload and the rail delete.
- **Hooks into existing code.**
  - `syncAfterSignIn` runs the dashboard sync after a successful settings step.
  - `dashboardStore` bumps a `revision` on every written edit and gains `applySynced`.
  - `LeftRail`'s delete goes through the sync.

**Tech Stack:**
- Client: TypeScript, React 19, zustand, Tauri plugins (`plugin-http` via `workspaceAccount`'s `guarded`, `plugin-fs` via `jsonStore`, `plugin-dialog`), vitest with Testing Library, and `src/test/memfs`.
- Backend: Python 3.12, Starlette (openbb-api middleware hook), pytest.

**Spec:** `docs/superpowers/specs/2026-10-10-workspace-dashboard-sync-design.md` (commit `57002a9`, approved). Conventions follow `docs/superpowers/specs/2026-10-08-workspace-connection-design.md` and its plan.

**Paths used below.** Set these in the shell before every command (agent shells do not keep variables between calls):

```bash
C=~/Developer/adventures-in-openbb-articles/openbq-relaunch/bdobb/.worktrees/v3-dashboard-sync
B=~/Developer/adventures-in-openbb-articles/openbq-relaunch/openbq-docker-v3-dashsync
PY=~/Developer/OpenBB/.venv/bin/python   # has starlette, httpx, pytest
```

- `$C` is the client worktree: branch `claude/v3-workspace-dashboard-sync`, cut from `origin/release/v3` (`17abd08`).
- `$B` is the backend worktree: branch `claude/v3-dashboard-sync`, cut from openbq-docker `origin/release/v3` (`b9c81d5`). It already exists. If it is missing, create it with `git -C ~/Developer/adventures-in-openbb-articles/openbq-relaunch/openbq-docker-fixbatch-3.0.1 worktree add "$B" -b claude/v3-dashboard-sync origin/release/v3`. That clone is shared, so never check out a branch in it.

Run `pnpm -C "$C" install --frozen-lockfile` once if `$C/node_modules` is missing.

## Global Constraints

**Repository and git**
- Both branches are local only; never push. Before every commit, `git -C "$C" branch --show-current` must print `claude/v3-workspace-dashboard-sync`, and `git -C "$B" branch --show-current` must print `claude/v3-dashboard-sync`. Always use `git -C`, and never `cd` into another repository's main checkout.
- Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tracked files never contain:
  - a home-directory path; write `~` instead;
  - a real tailnet hostname or address; use `workspace.example` or `backend.example`;
  - a literal `Basic <base64>` credential; build it at run time.
- Gates: `pnpm -C "$C" scrub` and `python3 scripts/check-public.py` (run inside `$B`) must both pass.
- New files carry the two-line Apache-2.0 copyright header the repositories already use.
- This plan builds the v3 home line only. Carrying to v4–v7, the v3.0.0 re-cut, any GHCR push and any NAS deploy are out of scope; NAS deploys happen only when the user asks.
- The user's Workspace password is never handled by an agent. The live Workspace steps in Task 13 are the user's checklist.

**Protocol (spec: Server API)**
- **Routes.** The client speaks exactly these:
  - `GET /pro/dash/sync/owned` returns `{owned: {uuid: DashboardReturn}}`.
  - `GET /pro/dash/sync/shared` returns `{shared, entity_shared}`.
  - `POST /pro/dash/sync` takes `{items: {uuid: content | "DELETE"}}`, applied per item and never as a whole-tree replace.
  - `GET /pro/user-apps/sync` returns `{owned, shared}`, with camelCase dates on each app.
  - `POST /pro/user-apps/{uuid}` takes the app content as its body.
  - `DELETE /pro/user-apps/{uuid}`.
- **404 from the server.**
  - `owned` answering 404 means the server keeps no dashboards: sync stays settings-only, with no error and no notice.
  - `shared` or `apps` answering 404 count as empty.
- **Auth.**
  - Every request goes through `endpoint()` and `requestHeaders()`.
  - In login mode the token goes only as `Authorization: Bearer`.
  - Key mode sends only the connection's own credential; its 401/403 is `KEY_REFUSED`, not an expiry.
  - A login-mode 401 expires the session.
- **Uuids.** Server map keys are compared in one canonical spelling, lowercase and dashed (`canonicalUuid`).

**What is stored**
- `workspaceSync.json` sits at the app-data root, next to `settings.json`, and is never exported. Its shape is `{ "links": SyncLink[], "tombstones": Tombstone[] }`, where:
  - `SyncLink = {dashboardId, connectionId, store: "dashboard" | "app", uuid, serverUpdatedDate, localRevisionAtSync, shared, dismissed?}`;
  - `Tombstone = {connectionId, store, uuid}`.
- `Dashboard.revision?: number` (absent means 0) is bumped by every written user edit and never by a sync write.
- `Dashboard.extensions.workspace` and `DashboardCard.extensions.workspace` hold server state. The apps.json exports never write either.

**Behaviour**
- Dashboards sync only with the settings server (the connection `settings.settingsStorage` names), after its settings step succeeded.
- Shared dashboards are never uploaded.
- Nothing uploads to a session that is expired, not synced, or deciding (`workspaceStore.deciding`).
- The log records names, uuids and HTTP statuses only. It never records passwords, tokens, server text or dashboard content.
- Conflict copy:
  - Changed on both sides: buttons `Use <server>` / `Keep local` / `Keep both`, defaulting to Keep both. Keep both names the server's copy by `dedupe`'s first unused `" (n)"`, per the 2026-10-03 import ruling.
  - Deleted on the server, changed here: buttons `Delete` / `Keep as local`.
  - Rail confirm for a synced dashboard: `Delete "<name>" here and on <server>?`.

**Backend (spec: Key-mode backend)**
- The new routes sit behind the existing Basic-auth gate. With `OPENBB_API_AUTH` off they answer 404.
- Storage is per credential: `STORE/<sha256>.dashboards.json` and `STORE/<sha256>.apps.json`. Writes are atomic (a temp file, then `os.replace`) and serialized by one lock.
- The server sets `updated_date`. The root folder is created on the first write and adopts every dashboard that names no parent.
- A body over 5 MB answers 413. An item that is neither a JSON object nor `"DELETE"`, or a key that is not a uuid, answers 400 and writes nothing.
- `shared` and `entity_shared` are always empty.

## Review Focus

These are the five inputs the spec implies but no spec-listed test exercises, most likely first. Each one has a test in the task that owns the code.

1. **Two new dashboards uploading at once, or another device adding to the root meanwhile.** The root folder's `children` must end up holding every child. Uploads re-read the root just before posting and are serialized per connection. Pinned in Task 10 ("puts every new dashboard into the root…").
2. **A save made while a conflict question is open.** It must still reach the server once the sync finishes, not be swallowed by the `deciding` gate. Pinned in Task 10 ("sends a save made while a question was open…").
3. **Exporting a synced dashboard as a BDOBB-compatible app.** `encodeV3CardExtension` used to refuse any card key outside the v3 profile, so a card carrying `extensions` would have broken Export. Pinned in Task 3 and Task 5.
4. **A server that keys items as hex uuids** (the real dump does). Links, tombstones and root children must match the dashed form, and a second sync must not create duplicates. Pinned in Task 6 (`canonicalUuid`) and Task 10 ("reads a hex-keyed server item…").
5. **A local-table card's `file` param.** It names a file on this device, and the spec puts files out of scope, so it must never be uploaded. Pinned in Task 5 ("never uploads a local table's file").

## Rulings this plan makes (spec gaps; strike any you disagree with)

- **R1, dashboard-level server state.** The spec names only `card.extensions.workspace`. A round trip also needs the item shell (`index`, `parentId`, `templateId`, `currentTab`, …), the tab keys, the `navigation_bar` record with its per-tab grid entries, and unplaced widget records. These go in `Dashboard.extensions.workspace` (`DashboardWorkspaceState`).
- **R2, BDOBB param groups.** The spec is silent on them. Groups and `groupsDisabled` ride in the content's `data.extensions.bdobb`, and card bindings ride in the widget's `extensions.bdobb` beside the v3 card state. Otherwise a server-side edit would wipe local groups.
- **R3, "Keep as local" (deleted on the server, changed here).** The dashboard is unlinked and therefore uploaded as a new dashboard. BDOBB has no local-only state while signed in, because every unlinked dashboard uploads.
- **R4, default for the deleted-conflict question.** It is `Keep as local`, since that loses nothing. The spec names no default there.
- **R5, the date after an upload.** `POST` returns no `updated_date`, so each upload re-reads the store to learn its new date. A third writer between the POST and that GET is missed, which is the same accepted limit as settings.
- **R6, retries.** A failed upload leaves its link unchanged, so the next save of that dashboard or the next sign-in sends it again. There is no timer-based retry; the spec's "retry on the queue" is read as exactly this.
- **R7, the root folder.** The client re-reads the root before every root-changing POST, serialized per connection. The key-mode server creates the root on the first write.
- **R8, widget order.** The order of the `widgets` array carries no meaning, because grid entries join by id. "Content-equivalent" therefore compares `widgets` sorted by id.
- **R9, new dashboards created while signed in.** They upload at the next sign-in, not live. The spec's live rule covers saves of linked dashboards only. Applying the sign-in table's last row live is a one-line change if you want it.
- **R10, the iPad simulator.** The v3 line has no iOS target (`src-tauri/gen` is absent), so Task 13's live checks run on macOS. The iPad-simulator run belongs to the v7 carry.
- **R11, where the backend tests run.** They go in `v3/tests/` and run with pytest from the OpenBB venv. openbq-docker CI runs only `python3 -m unittest discover -s workspace/tests`, and the system `python3` has no starlette.

Not mapped, and added only when wanted:
- Workspace widget `name` → card title.
- `isMinimized` → minimized.
- A shared dashboard's local edits being blocked in the UI. Today they are simply never uploaded and are overwritten by the server.

## File Structure

**Backend (`$B`)**
- Modify `v3/openbq_settings.py`: the dashboard and app routes and their storage helpers.
- Create `v3/tests/test_openbq_settings.py`: pytest for every route.
- Create `scripts/verify-dashboards.py`: the live contract check, a sibling of `verify-settings.py`.

**Client (`$C`)**
- Modify `src/lib/types.ts` to add `CardWorkspaceState`, `DashboardWorkspaceState`, `SyncStore`, `SyncLink`, `Tombstone`, `Dashboard.revision`, `Dashboard.extensions` and `DashboardCard.extensions`.
- Modify `src/lib/dashboardsFile.ts`: read back `revision` and `extensions`.
- Modify `src/stores/dashboardStore.ts`: `nextRevision` on every written edit, and `applySynced`.
- Modify `src/lib/appsExtensionsV3.ts`: allow the `extensions` card key.
- Modify `src/lib/appsJson.ts`: export `toParams` and `dedupe`.
- Create `src/lib/workspaceDashboards.ts`: the mapper (`fromWorkspace`, `toWorkspace`, `NewItem`).
- Create `src/test/workspace-fama-french.json`: the sanitized real Workspace dashboard, root folder and app.
- Modify `src/lib/workspaceAccount.ts`: add `canonicalUuid`, `fetchServerStore`, `fetchOwnedDashboards`, `fetchOwnedApps`, `postDashboardItems`, `putApp` and `deleteApp`.
- Create `src/stores/workspaceSyncStore.ts`: `workspaceSync.json`, plus `linkFor`.
- Create `src/lib/dashboardSyncPlan.ts`: `planDashboardSync`, `ServerItem` and `SyncAction`.
- Modify `src/components/dialogs/WorkspaceDialogs.tsx`: `decideDashboardConflict` and `decideDeletedDashboard`.
- Create `src/components/runDashboardSync.ts`: `syncDashboards`, `uploadDashboard`, `startDashboardAutoUpload`, `UPLOAD_DEBOUNCE_MS`, `deleteTargets` and `deleteSyncedDashboard`.
- Modify `src/components/runWorkspaceSync.ts`: `syncAfterSignIn` then calls `syncDashboards`.
- Modify `src/lib/bootstrap.ts`: load `workspaceSync.json` and start the auto-upload in the main window.
- Modify `src/components/LeftRail.tsx`: the delete goes through the sync, and shared dashboards are marked.
- Tests sit beside each file. New test files are `workspaceDashboards.test.ts`, `workspaceAccount.sync.test.ts`, `workspaceSyncStore.test.ts`, `dashboardSyncPlan.test.ts`, `runDashboardSync.test.ts` and `LeftRail.sync.test.tsx`.

---

# Part A: openbq-docker key-mode backend

### Task 1: Dashboard routes in key mode

**Files:**
- Modify: `$B/v3/openbq_settings.py`
- Create: `$B/v3/tests/test_openbq_settings.py`

**Interfaces:**
- Consumes: the existing `_credential`, `_cors`, `middleware` and `_settings` in `openbq_settings.py`.
- Produces:
  - `GET /pro/dash/sync/owned` returns `{"owned": {uuid: {"creator": true, "content", "created_date", "updated_date", "created_by": <user>, "is_shared": false}}}`.
  - `GET /pro/dash/sync/shared` returns `{"shared": {}, "entity_shared": {}}`.
  - `POST /pro/dash/sync` with `{"items": {uuid: object | "DELETE"}}` returns `{"success": true}`.
  - Module helpers `_now()`, `_uuid(raw)`, `_load(path)`, `_save(path, data)` and `_json_body(request)`, which Task 2 reuses.
  - `MAX_SYNC_BYTES = 5_000_000` and `LOCK`.

- [ ] **Step 1: Write the failing tests.** Create `$B/v3/tests/test_openbq_settings.py`:

```python
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0
"""v3/openbq_settings.py: key-mode dashboard and app routes.

pytest with starlette and httpx; openbb_core is stubbed, so any such Python works:
    ~/Developer/OpenBB/.venv/bin/python -m pytest v3/tests -q
"""
import base64
import importlib
import json
import sys
import types
from pathlib import Path

import pytest
from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import PlainTextResponse
from starlette.routing import Route
from starlette.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

DASH = "aaaaaaaa-0000-4000-8000-000000000002"
OTHER = "aaaaaaaa-0000-4000-8000-000000000009"
APP = "aaaaaaaa-0000-4000-8000-000000000003"


def basic(user, password):
    return {"Authorization": "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()}


AUTH = basic("alice", "synthetic-password")


def dash(name="Example", **extra):
    return {"index": DASH, "isFolder": False, "data": {"name": name, "widgets": [], "gridLayout": {}}, **extra}


@pytest.fixture
def env():
    class Env:
        API_AUTH = True
        API_USERNAME = "alice"
        API_PASSWORD = "synthetic-password"
    return Env


@pytest.fixture
def api(tmp_path, monkeypatch, env):
    core = types.ModuleType("openbb_core.env")
    core.Env = env
    cors = types.SimpleNamespace(allow_origins=["*"])
    service = types.ModuleType("openbb_core.app.service.system_service")
    service.SystemService = lambda: types.SimpleNamespace(
        system_settings=types.SimpleNamespace(api_settings=types.SimpleNamespace(cors=cors)))
    monkeypatch.setitem(sys.modules, "openbb_core.env", core)
    monkeypatch.setitem(sys.modules, "openbb_core.app.service.system_service", service)
    monkeypatch.setenv("OPENBQ_SETTINGS_DIR", str(tmp_path))
    module = importlib.reload(importlib.import_module("openbq_settings"))
    app = Starlette(routes=[Route("/{path:path}", lambda request: PlainTextResponse("not here", 404),
                                  methods=["GET", "POST", "DELETE"])])
    app.add_middleware(BaseHTTPMiddleware, dispatch=module.middleware)
    return TestClient(app), module


def owned(client, auth=AUTH):
    return client.get("/pro/dash/sync/owned", headers=auth).json()


def post(client, items, auth=AUTH):
    return client.post("/pro/dash/sync", json={"items": items}, headers=auth)


DASH_ROUTES = [("GET", "/pro/dash/sync/owned"), ("GET", "/pro/dash/sync/shared"), ("POST", "/pro/dash/sync")]


@pytest.mark.parametrize("method,path", DASH_ROUTES)
def test_dashboard_routes_answer_404_with_api_auth_off(api, env, method, path):
    client, _ = api
    env.API_AUTH = False
    assert client.request(method, path, headers=AUTH).status_code == 404


@pytest.mark.parametrize("method,path", DASH_ROUTES)
def test_dashboard_routes_refuse_a_missing_or_wrong_credential(api, method, path):
    client, _ = api
    assert client.request(method, path).status_code == 401
    assert client.request(method, path, headers=basic("alice", "wrong")).status_code == 401


def test_owned_starts_empty_and_shared_is_always_empty(api):
    client, _ = api
    assert owned(client) == {"owned": {}}
    assert client.get("/pro/dash/sync/shared", headers=AUTH).json() == {"shared": {}, "entity_shared": {}}


def test_first_write_stores_the_item_with_server_dates_and_creates_the_root(api, monkeypatch):
    client, module = api
    monkeypatch.setattr(module, "_now", lambda: "2026-10-11T00:00:01Z")
    assert post(client, {DASH: dash()}).json() == {"success": True}
    items = owned(client)["owned"]
    record = items[DASH]
    assert record["updated_date"] == "2026-10-11T00:00:01Z"
    assert (record["created_by"], record["creator"], record["is_shared"]) == ("alice", True, False)
    assert record["content"]["data"] == dash()["data"]
    root_key, root = next((k, v) for k, v in items.items() if v["content"].get("isRoot"))
    assert root["content"]["children"] == [DASH]
    assert record["content"]["parentId"] == root["content"]["index"] == root_key


def test_a_later_write_keeps_created_date_moves_updated_date_and_keeps_one_root(api, monkeypatch):
    client, module = api
    clock = iter(["2026-10-11T00:00:01Z", "2026-10-11T00:00:02Z"])
    monkeypatch.setattr(module, "_now", lambda: next(clock))
    post(client, {DASH: dash()})
    post(client, {DASH: dash("Renamed")})
    items = owned(client)["owned"]
    assert (items[DASH]["created_date"], items[DASH]["updated_date"]) == ("2026-10-11T00:00:01Z", "2026-10-11T00:00:02Z")
    assert items[DASH]["content"]["data"]["name"] == "Renamed"
    assert sum(1 for v in items.values() if v["content"].get("isRoot")) == 1


def test_delete_removes_one_item_and_leaves_the_rest(api):
    client, _ = api
    post(client, {DASH: dash(), OTHER: dict(dash("Other"), index=OTHER)})
    post(client, {DASH: "DELETE"})
    items = owned(client)["owned"]
    assert DASH not in items and OTHER in items


def test_a_hex_key_is_stored_under_the_dashed_uuid(api):
    client, _ = api
    post(client, {DASH.replace("-", ""): dash()})
    assert DASH in owned(client)["owned"]


@pytest.mark.parametrize("body", [b"not json", b"[]", b'{"items": []}', b'{"items": {"%s": 3}}' % DASH.encode(),
                                  b'{"items": {"not-a-uuid": {}}}'])
def test_a_malformed_body_answers_400_and_writes_nothing(api, body):
    client, _ = api
    post(client, {DASH: dash()})
    before = owned(client)
    assert client.post("/pro/dash/sync", content=body, headers=AUTH).status_code == 400
    assert owned(client) == before


def test_a_body_over_5_mb_answers_413_and_writes_nothing(api):
    client, _ = api
    assert post(client, {DASH: dash(blob="x" * 5_000_001)}).status_code == 413
    assert owned(client) == {"owned": {}}


def test_each_credential_has_its_own_store(api, env):
    client, _ = api
    post(client, {DASH: dash()})
    env.API_PASSWORD = "rotated"
    assert owned(client, basic("alice", "rotated")) == {"owned": {}}


def test_a_failed_write_leaves_the_stored_file_intact(api, monkeypatch, tmp_path):
    client, module = api
    post(client, {DASH: dash("Before")})

    def broken(src, dst):
        raise OSError("disk full")

    monkeypatch.setattr(module.os, "replace", broken)
    with pytest.raises(OSError):
        post(client, {DASH: dash("After")})
    [stored] = tmp_path.glob("*.dashboards.json")
    assert json.loads(stored.read_text())[DASH]["content"]["data"]["name"] == "Before"
```

- [ ] **Step 2: Run them to see them fail**

Run: `B=~/Developer/adventures-in-openbb-articles/openbq-relaunch/openbq-docker-v3-dashsync; PY=~/Developer/OpenBB/.venv/bin/python; "$PY" -m pytest "$B/v3/tests" -q`
Expected: only the three auth-off 404 tests pass, because unknown paths fall through to the stub app's 404. Everything else fails: the 401 tests get that 404, and the storage tests fail decoding it (for example `test_owned_starts_empty_and_shared_is_always_empty`).

- [ ] **Step 3: Implement.** Edit `$B/v3/openbq_settings.py`:

Replace the module docstring's first line, `"""BDOBB key-mode user settings: GET /pro/user and POST /pro/display-settings.`, with:

```python
"""BDOBB key-mode user settings, dashboards and apps.

Settings: GET /pro/user and POST /pro/display-settings. Dashboards and apps: the
subset of OpenBB Workspace's own sync routes BDOBB speaks (GET /pro/dash/sync/owned,
GET /pro/dash/sync/shared, POST /pro/dash/sync, GET /pro/user-apps/sync,
POST and DELETE /pro/user-apps/{uuid}).
```

Keep the rest of the docstring. In the imports, after `import secrets`, add:

```python
import threading
import uuid as uuidlib
from datetime import datetime, timezone
```

Replace `PATHS = {"/pro/user", "/pro/display-settings"}` with:

```python
PATHS = {"/pro/user", "/pro/display-settings", "/pro/dash/sync", "/pro/dash/sync/owned",
         "/pro/dash/sync/shared"}
MAX_SYNC_BYTES = 5_000_000
# ponytail: one process-wide lock around every dashboard/app read-modify-write; per-credential locks if it ever contends.
LOCK = threading.Lock()
```

In `middleware`, change the docstring to `"""Serve the settings, dashboard and app routes; pass every other request (and preflight) through."""`.

In `_settings`, replace the line `path = STORE / f"{hashlib.sha256(credential.encode()).hexdigest()}.json"` with:

```python
    key = hashlib.sha256(credential.encode()).hexdigest()
    user = credential.partition(":")[0]
    route = (request.method, request.url.path)
    if route == ("GET", "/pro/dash/sync/owned"):
        return JSONResponse({"owned": _owned(_load(STORE / f"{key}.dashboards.json"), user)})
    if route == ("GET", "/pro/dash/sync/shared"):
        return JSONResponse({"shared": {}, "entity_shared": {}})
    if route == ("POST", "/pro/dash/sync"):
        return await _post_dashboards(request, STORE / f"{key}.dashboards.json")
    path = STORE / f"{key}.json"
```

Append at the end of the file:

```python
def _now():
    """The server's clock, the only updated_date a client compares."""
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _uuid(raw):
    """A uuid key in one spelling (lowercase, dashed), or None."""
    try:
        return str(uuidlib.UUID(str(raw)))
    except ValueError:
        return None


def _load(path):
    return json.loads(path.read_text()) if path.exists() else {}


def _save(path, data):
    """Write atomically: a temp file, then rename over the old one."""
    STORE.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(data))
    os.replace(tmp, path)


async def _json_body(request):
    """The request body parsed, or (None, a 413/400 response)."""
    body = await request.body()
    if len(body) > MAX_SYNC_BYTES:
        return None, JSONResponse({"detail": "The body exceeds 5 MB."}, status_code=413)
    try:
        return json.loads(body), None
    except ValueError:
        return None, JSONResponse({"detail": "The body must be JSON."}, status_code=400)


def _owned(store, user):
    """Stored dashboards in Workspace's DashboardReturn shape."""
    return {k: {"creator": True, "content": v["content"], "created_date": v["created_date"],
                "updated_date": v["updated_date"], "created_by": user, "is_shared": False}
            for k, v in store.items()}


def _ensure_root(store, now):
    """Create the root folder on the first write, adopting every dashboard that names no parent."""
    if not store or any(v["content"].get("isRoot") for v in store.values()):
        return
    root = str(uuidlib.uuid4())
    children = []
    for v in store.values():
        content = v["content"]
        if not content.get("isFolder") and not content.get("parentId"):
            content["parentId"] = root
            children.append(content.get("index"))
    store[root] = {"content": {"index": root, "name": "root", "isFolder": True, "isRoot": True,
                               "children": [c for c in children if c], "data": {"name": "root"}},
                   "created_date": now, "updated_date": now}


async def _post_dashboards(request, path):
    """POST /pro/dash/sync: {items: {uuid: object | "DELETE"}}, applied per item, never a whole-tree replace."""
    body, error = await _json_body(request)
    if error:
        return error
    items = body.get("items") if isinstance(body, dict) else None
    if not isinstance(items, dict):
        return JSONResponse({"detail": "The body must be {items: {uuid: object or DELETE}}."}, status_code=400)
    clean = {}
    for raw, item in items.items():
        key = _uuid(raw)
        if key is None or not (item == "DELETE" or isinstance(item, dict)):
            return JSONResponse({"detail": "Each item must be a JSON object or DELETE under a uuid."}, status_code=400)
        clean[key] = item
    with LOCK:
        store = _load(path)
        now = _now()
        for key, item in clean.items():
            if item == "DELETE":
                store.pop(key, None)
            else:
                store[key] = {"content": item, "created_date": store.get(key, {}).get("created_date", now),
                              "updated_date": now}
        _ensure_root(store, now)
        _save(path, store)
    return JSONResponse({"success": True})
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `"$PY" -m pytest "$B/v3/tests" -q`
Expected: `19 passed`.

- [ ] **Step 5: Commit**

```bash
git -C "$B" branch --show-current   # claude/v3-dashboard-sync
git -C "$B" add v3/openbq_settings.py v3/tests/test_openbq_settings.py
git -C "$B" commit -m "Serve Workspace dashboard sync routes in key mode

GET /pro/dash/sync/owned and /shared, POST /pro/dash/sync with per-item upsert or
DELETE, behind the API's Basic auth; 404 with auth off. One dashboards file per
credential, atomic writes under one lock, server-set dates, root folder created
on the first write. 413 over 5 MB, 400 for a non-object item.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: App routes in key mode, and the live contract script

**Files:**
- Modify: `$B/v3/openbq_settings.py`
- Modify: `$B/v3/tests/test_openbq_settings.py`
- Create: `$B/scripts/verify-dashboards.py`

**Interfaces:**
- Consumes: from Task 1, `_now`, `_uuid`, `_load`, `_save`, `_json_body`, `LOCK` and the `AUTH` and `api` fixtures.
- Produces:
  - `GET /pro/user-apps/sync` returns `{"owned": {uuid: {"content", "creator": true, "is_shared": false, "createdDate", "updatedDate", "createdBy", "sharedWith": []}}, "shared": {}}`.
  - `POST /pro/user-apps/{uuid}` (body = the app content) returns `{"success": true}`.
  - `DELETE /pro/user-apps/{uuid}` returns `{"success": true}`, or 404 when the app is absent.
  - `scripts/verify-dashboards.py BASE USER PASSWORD`.

- [ ] **Step 1: Write the failing tests.** Append to `$B/v3/tests/test_openbq_settings.py`:

```python

APP_ROUTES = [("GET", "/pro/user-apps/sync"), ("POST", f"/pro/user-apps/{APP}"), ("DELETE", f"/pro/user-apps/{APP}")]


def app_content(name="Example app"):
    return {"name": name, "widgets": [], "groups": [], "gridLayout": {}, "prompts": []}


@pytest.mark.parametrize("method,path", APP_ROUTES)
def test_app_routes_answer_404_with_api_auth_off(api, env, method, path):
    client, _ = api
    env.API_AUTH = False
    assert client.request(method, path, headers=AUTH).status_code == 404


@pytest.mark.parametrize("method,path", APP_ROUTES)
def test_app_routes_refuse_a_missing_credential(api, method, path):
    client, _ = api
    assert client.request(method, path).status_code == 401


def test_an_app_upserts_lists_in_workspace_shape_and_deletes(api, monkeypatch):
    client, module = api
    clock = iter(["2026-10-11T00:00:01Z", "2026-10-11T00:00:02Z"])
    monkeypatch.setattr(module, "_now", lambda: next(clock))
    assert client.get("/pro/user-apps/sync", headers=AUTH).json() == {"owned": {}, "shared": {}}
    assert client.post(f"/pro/user-apps/{APP}", json=app_content(), headers=AUTH).status_code == 200
    assert client.post(f"/pro/user-apps/{APP}", json=app_content("Renamed"), headers=AUTH).status_code == 200
    record = client.get("/pro/user-apps/sync", headers=AUTH).json()["owned"][APP]
    assert record == {"content": app_content("Renamed"), "creator": True, "is_shared": False,
                      "createdDate": "2026-10-11T00:00:01Z", "updatedDate": "2026-10-11T00:00:02Z",
                      "createdBy": "alice", "sharedWith": []}
    assert client.delete(f"/pro/user-apps/{APP}", headers=AUTH).status_code == 200
    assert client.delete(f"/pro/user-apps/{APP}", headers=AUTH).status_code == 404
    assert client.get("/pro/user-apps/sync", headers=AUTH).json()["owned"] == {}


@pytest.mark.parametrize("path,body,status", [(f"/pro/user-apps/{APP}", b"[]", 400), ("/pro/user-apps/not-a-uuid", b"{}", 400),
                                              (f"/pro/user-apps/{APP}", b'{"name": "%s"}' % (b"x" * 5_000_001), 413)])
def test_a_refused_app_write_stores_nothing(api, path, body, status):
    client, _ = api
    assert client.post(path, content=body, headers=AUTH).status_code == status
    assert client.get("/pro/user-apps/sync", headers=AUTH).json()["owned"] == {}


def test_settings_routes_still_work(api):
    client, _ = api
    assert client.post("/pro/display-settings", json={"theme": "dark"}, headers=AUTH).status_code == 200
    assert client.get("/pro/user", headers=AUTH).json() == {"pro_display_settings": {"theme": "dark"}}
```

- [ ] **Step 2: Run them to see them fail**

Run: `"$PY" -m pytest "$B/v3/tests" -q -k app`
Expected: `test_an_app_upserts_lists_in_workspace_shape_and_deletes` and `test_a_refused_app_write_stores_nothing` fail. The 401 tests fail for the POST and DELETE routes, which fall through to the stub's 404.

- [ ] **Step 3: Implement.** In `$B/v3/openbq_settings.py`:

Add `"/pro/user-apps/sync"` to `PATHS`, and add the line `APP_PREFIX = "/pro/user-apps/"` under it:

```python
PATHS = {"/pro/user", "/pro/display-settings", "/pro/dash/sync", "/pro/dash/sync/owned",
         "/pro/dash/sync/shared", "/pro/user-apps/sync"}
APP_PREFIX = "/pro/user-apps/"
```

In `middleware`, replace `if request.url.path not in PATHS or request.method == "OPTIONS" or not Env().API_AUTH:` with:

```python
    path = request.url.path
    if not (path in PATHS or path.startswith(APP_PREFIX)) or request.method == "OPTIONS" or not Env().API_AUTH:
```

In `_settings`, after the `POST /pro/dash/sync` branch, add:

```python
    if route == ("GET", "/pro/user-apps/sync"):
        return JSONResponse({"owned": _owned_apps(_load(STORE / f"{key}.apps.json"), user), "shared": {}})
    if request.url.path.startswith(APP_PREFIX) and request.method in ("POST", "DELETE"):
        return await _app(request, STORE / f"{key}.apps.json", request.url.path[len(APP_PREFIX):])
```

Append at the end of the file:

```python
def _owned_apps(store, user):
    """Stored apps in Workspace's UserAppReturn shape (camelCase dates)."""
    return {k: {"content": v["content"], "creator": True, "is_shared": False, "createdDate": v["created_date"],
                "updatedDate": v["updated_date"], "createdBy": user, "sharedWith": []}
            for k, v in store.items()}


async def _app(request, path, raw):
    """POST upserts one app (the body is its content); DELETE removes it, 404 when absent."""
    key = _uuid(raw)
    if key is None:
        return JSONResponse({"detail": "The app id must be a uuid."}, status_code=400)
    if request.method == "DELETE":
        with LOCK:
            apps = _load(path)
            if apps.pop(key, None) is None:
                return JSONResponse({"detail": "No such app."}, status_code=404)
            _save(path, apps)
        return JSONResponse({"success": True})
    body, error = await _json_body(request)
    if error:
        return error
    if not isinstance(body, dict):
        return JSONResponse({"detail": "The body must be a JSON object."}, status_code=400)
    with LOCK:
        apps = _load(path)
        now = _now()
        apps[key] = {"content": body, "created_date": apps.get(key, {}).get("created_date", now), "updated_date": now}
        _save(path, apps)
    return JSONResponse({"success": True})
```

Create `$B/scripts/verify-dashboards.py` and run `chmod +x "$B/scripts/verify-dashboards.py"`:

```python
#!/usr/bin/env python3
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0
"""Check BDOBB key-mode dashboard and app sync on an OpenBQ API with OPENBB_API_AUTH on.

Usage: verify-dashboards.py BASE_URL USERNAME PASSWORD
Writes one test dashboard and one test app under fresh uuids, then deletes both.
On a credential with no dashboards yet, the first write leaves a root folder behind.
"""
import base64
import json
import sys
import urllib.error
import urllib.request
import uuid

base, user, password = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]


def call(method, path, body=None, auth=(user, password)):
    headers = {'Content-Type': 'application/json'}
    if auth:
        headers['Authorization'] = 'Basic ' + base64.b64encode(f'{auth[0]}:{auth[1]}'.encode()).decode()
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(base + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, None


dash, app = str(uuid.uuid4()), str(uuid.uuid4())
content = {'index': dash, 'isFolder': False, 'data': {'name': 'verify-dashboards', 'widgets': [], 'gridLayout': {}}}
assert call('GET', '/pro/dash/sync/owned', auth=None)[0] == 401, 'missing key must be refused'
status, listed = call('GET', '/pro/dash/sync/owned')
assert status == 200 and isinstance(listed['owned'], dict), 'GET owned must return the map'
assert call('GET', '/pro/dash/sync/shared')[1] == {'shared': {}, 'entity_shared': {}}, 'shared must be empty'
assert call('POST', '/pro/dash/sync', {'items': {dash: content}})[1] == {'success': True}, 'POST must upsert'
stored = call('GET', '/pro/dash/sync/owned')[1]['owned'][dash]
assert stored['content']['data'] == content['data'] and stored['updated_date'], 'item must round-trip with a server date'
assert call('POST', '/pro/dash/sync', {'items': {dash: 3}})[0] == 400, 'a non-object item must be refused'
assert call('POST', '/pro/dash/sync', {'items': {dash: 'DELETE'}})[1] == {'success': True}, 'DELETE must succeed'
assert dash not in call('GET', '/pro/dash/sync/owned')[1]['owned'], 'a deleted item must be gone'
app_content = {'name': 'verify-dashboards', 'widgets': [], 'groups': [], 'gridLayout': {}}
assert call('POST', f'/pro/user-apps/{app}', app_content)[0] == 200, 'an app must upsert'
assert call('GET', '/pro/user-apps/sync')[1]['owned'][app]['content'] == app_content, 'the app must round-trip'
assert call('DELETE', f'/pro/user-apps/{app}')[0] == 200, 'the app must delete'
assert call('DELETE', f'/pro/user-apps/{app}')[0] == 404, 'a deleted app must be gone'
print(json.dumps({'dashboard_checks': 12, 'status': 'passed'}))
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `"$PY" -m pytest "$B/v3/tests" -q && python3 -m py_compile "$B/scripts/verify-dashboards.py"`
Expected: `30 passed`, and no output from `py_compile`. The script runs live in Task 13.

- [ ] **Step 5: Commit**

```bash
git -C "$B" branch --show-current   # claude/v3-dashboard-sync
git -C "$B" add v3/openbq_settings.py v3/tests/test_openbq_settings.py scripts/verify-dashboards.py
git -C "$B" commit -m "Serve Workspace app sync routes in key mode

GET /pro/user-apps/sync in Workspace's UserAppReturn shape, POST and DELETE
/pro/user-apps/{uuid}; same gate, storage rules and limits as dashboards.
scripts/verify-dashboards.py checks the live contract.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

# Part B: BDOBB client

### Task 3: Revision, server-state fields, and the export allowance

**Files:**
- Modify: `$C/src/lib/types.ts` (after `DashboardCard.table`, line ~348; after `Dashboard.groupsDisabled`, line ~385)
- Modify: `$C/src/lib/dashboardsFile.ts` (`StoredDashboard`, `withDefaults`)
- Modify: `$C/src/stores/dashboardStore.ts` (`mutateDashboard`, `renameDashboard`, `replaceDashboardContents`)
- Modify: `$C/src/lib/appsExtensionsV3.ts:145`
- Modify: `$C/src/lib/appsJson.ts` (`toParams`, `dedupe`: add `export`)
- Test: `$C/src/lib/dashboardsFile.test.ts`, `$C/src/stores/dashboardStore.test.ts`, `$C/src/lib/appsExtensionsV3.test.ts`

**Interfaces:**
- Produces, for every later task:
  - The types `CardWorkspaceState`, `DashboardWorkspaceState`, `SyncStore`, `SyncLink` and `Tombstone`, all from `src/lib/types.ts`.
  - The fields `Dashboard.revision?: number`, `Dashboard.extensions?: { workspace?: DashboardWorkspaceState }` and `DashboardCard.extensions?: { workspace?: CardWorkspaceState }`.
  - `export function toParams(value: unknown): Record<string, string>` and `export function dedupe(name: string, taken: Set<string>): string`, both from `appsJson.ts`.
  - The rule that every written user edit bumps `revision` by one.

- [ ] **Step 1: Write the failing tests**

Append to `$C/src/lib/dashboardsFile.test.ts`:

```ts

describe("sync fields", () => {
  it("keeps revision and extensions through a save and load, and reads a non-number revision as absent", async () => {
    const extensions = { workspace: { content: { index: "x" }, tabKeys: { t1: "main" }, orphans: [] } };
    await saveDashboard({ id: "d1", name: "A", tabs: [{ id: "t1", name: "Main", cards: [] }], revision: 3, extensions });
    __seed("dashboards/d2.json", JSON.stringify({ id: "d2", name: "B", tabs: [], revision: "3" }));
    const [a, b] = await loadDashboards();
    expect(a).toMatchObject({ revision: 3, extensions });
    expect(b.revision).toBeUndefined();
  });
});
```

Append to `$C/src/stores/dashboardStore.test.ts`:

```ts

describe("revision", () => {
  const base = (revision?: number): Dashboard => ({ id: "d1", name: "Main", tabs: [{ id: "t1", name: "Main", cards: [{ id: "c1", widgetId: "w", backendId: "b1", params: {}, layout: { x: 0, y: 0, w: 2, h: 2 } }] }], ...(revision === undefined ? {} : { revision }) });
  const stored = () => JSON.parse(__read("dashboards/d1.json") ?? "null") as Dashboard;

  it("counts every written edit, in memory and on disk", async () => {
    useDashboardStore.setState({ dashboards: [base()], activeId: "d1", activeTabId: "t1" });
    await useDashboardStore.getState().renameDashboard("d1", "Renamed");
    await useDashboardStore.getState().setCardMinimized("c1", true);
    expect(useDashboardStore.getState().dashboards[0].revision).toBe(2);
    expect(stored().revision).toBe(2);
  });

  it("continues from the replaced dashboard's revision on an import's Replace", async () => {
    useDashboardStore.setState({ dashboards: [base(4)], activeId: "d1", activeTabId: "t1" });
    await useDashboardStore.getState().replaceDashboardContents("d1", { id: "x", name: "X", tabs: [{ id: "t9", name: "T", cards: [] }] });
    expect(stored().revision).toBe(5);
  });
});
```

In `$C/src/lib/appsExtensionsV3.test.ts`, add `import { encodeV3CardExtension } from "./appsExtensionsV3";` to the imports, then append:

```ts

describe("a synced card", () => {
  it("encodes its BDOBB state although it carries server state in extensions", () => {
    const synced = card({ title: "Mine", extensions: { workspace: { widget: { id: "w1" }, layout: {}, params: {} } } });
    expect(encodeV3CardExtension(synced, "$")).toEqual({ ok: true, value: { schemaVersion: 1, profile: "v3", title: "Mine" } });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm -C "$C" exec vitest run src/lib/dashboardsFile.test.ts src/stores/dashboardStore.test.ts src/lib/appsExtensionsV3.test.ts`
Expected: the new tests fail as assertions, since vitest does not typecheck: `revision` comes back undefined, and the encode answers `UNSUPPORTED_V3_STATE`.

- [ ] **Step 3: Implement**

In `$C/src/lib/types.ts`, add to `DashboardCard` after its `table?: TableCardState;` member:

```ts
  /** Set on a card that came from a dashboard server (workspaceDashboards.ts). Never in apps.json. */
  extensions?: { workspace?: CardWorkspaceState };
```

Directly after the `DashboardCard` type, add:

```ts
/**
 * What an upload needs to rebuild a server card BDOBB does not model: the
 * original widget record, its grid entry, and the params as first mapped
 * (only params that differ from these are written back).
 */
export type CardWorkspaceState = {
  widget: Record<string, unknown>;
  layout: Record<string, unknown>;
  params: Record<string, string>;
};

/**
 * A synced dashboard's server shell: its content minus the widgets and grid
 * (rebuilt from the cards), each local tab's gridLayout key, the tab strip
 * widget with its grid entry per tab, and widget records no grid places.
 */
export type DashboardWorkspaceState = {
  content: Record<string, unknown>;
  tabKeys: Record<string, string>;
  nav?: { widget: Record<string, unknown>; layout: Record<string, Record<string, unknown>> };
  orphans: Record<string, unknown>[];
};

/** Which server store a synced dashboard lives in. */
export type SyncStore = "dashboard" | "app";

/** One synced dashboard on one connection (workspaceSync.json). `dismissed`: a shared dashboard deleted here, never downloaded again. */
export type SyncLink = {
  dashboardId: string;
  connectionId: string;
  store: SyncStore;
  uuid: string;
  serverUpdatedDate: string;
  localRevisionAtSync: number;
  shared: boolean;
  dismissed?: boolean;
};

/** A server delete still to send (workspaceSync.json). */
export type Tombstone = { connectionId: string; store: SyncStore; uuid: string };
```

Add to `Dashboard` after `groupsDisabled?: boolean;`:

```ts
  /** Bumped on every save of a user edit; sync compares it with its link (spec: Link records). Absent means 0. */
  revision?: number;
  /** Set on a dashboard that came from a dashboard server. */
  extensions?: { workspace?: DashboardWorkspaceState };
```

In `$C/src/lib/dashboardsFile.ts`, add to `StoredDashboard`'s object part, after `groupsDisabled?: boolean;`:

```ts
  revision?: unknown;
  extensions?: Dashboard["extensions"];
```

In `withDefaults`'s returned object, after `groupsDisabled: stored.groupsDisabled,`:

```ts
    // A revision that is not a number would concatenate on the next bump; it reads as absent (0).
    revision: typeof stored.revision === "number" ? stored.revision : undefined,
    extensions: stored.extensions,
```

In `$C/src/stores/dashboardStore.ts`, add above `export const useDashboardStore = create<DashboardState>((set, get) => {`:

```ts
/**
 * `next` as the save of a user edit to `prev`: one revision on from prev's
 * (spec: Link records). Sync's own writes (applySynced) do not come through
 * here -- they ARE the synced state.
 */
function nextRevision(next: Dashboard, prev: Dashboard): Dashboard {
  return { ...next, revision: (prev.revision ?? 0) + 1 };
}
```

Then make three one-line changes:
- `mutateDashboard`: `const updated = nextRevision(pinResolvedBackends(fn(current), useWidgetRegistryStore.getState().widgets), current);`
- `renameDashboard`: `const updated = nextRevision({ ...target, name }, target);`
- `replaceDashboardContents`: `const updated: Dashboard = nextRevision({ ...imported, id, name: target.name }, target);`

In `$C/src/lib/appsExtensionsV3.ts:145`, add `"extensions"` to the `allowed` set. Server state is never encoded into the v3 overlay, and `exportApp` builds layout items field by field, so nothing leaks:

```ts
  const allowed = new Set(["id", "widgetId", "backendId", "params", "layout", "title", "view", "minimized", "bindings", "table", "groupIds", "extensions"]);
```

In `$C/src/lib/appsJson.ts`, put `export` in front of `function toParams(` and `function dedupe(`. Their bodies are unchanged.

- [ ] **Step 4: Run the tests to see them pass, plus every suite that writes dashboards**

Run: `pnpm -C "$C" exec vitest run src/lib src/stores src/components && pnpm -C "$C" exec tsc --noEmit -p .`
Expected: everything passes. When this plan was written, no existing test asserted an exact written dashboard, so none needed a `revision` added. If one fails on that, add the expected `revision: N`. Never delete or loosen the assertion.

- [ ] **Step 5: Commit**

```bash
git -C "$C" branch --show-current   # claude/v3-workspace-dashboard-sync
git -C "$C" add src/lib/types.ts src/lib/dashboardsFile.ts src/lib/dashboardsFile.test.ts src/stores/dashboardStore.ts src/stores/dashboardStore.test.ts src/lib/appsExtensionsV3.ts src/lib/appsExtensionsV3.test.ts src/lib/appsJson.ts
git -C "$C" commit -m "feat(v3): dashboard revision counter and server-state fields for sync

Every written edit bumps Dashboard.revision; dashboards and cards may carry
extensions.workspace; the v3 card overlay tolerates it so Export still works.
SyncLink/Tombstone types; toParams and dedupe exported for the mapper and sync.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Mapper, Workspace → BDOBB

**Files:**
- Create: `$C/src/lib/workspaceDashboards.ts`
- Create: `$C/src/test/workspace-fama-french.json`
- Test: `$C/src/lib/workspaceDashboards.test.ts`

**Interfaces:**
- Consumes: `importApps` and `toParams` from `appsJson.ts`; `decodeV3CardExtension` and `unwrapExtension` from `appsExtensionsV3.ts`; and the Task 3 types.
- Produces: `export function fromWorkspace(content: unknown, store: SyncStore, registry: WidgetDef[]): Dashboard`. It throws on unreadable content. Each card it returns carries `extensions.workspace: { widget, layout, params }`, where `params` is the card's params as mapped. The dashboard carries `extensions.workspace: { content, tabKeys, nav?, orphans }`.

- [ ] **Step 1: Add the fixture.** Create `$C/src/test/workspace-fama-french.json` with exactly this content. It is the user's real Workspace dump, sanitized: fixed fake uuids, `backend.example` URLs, "Example User", descriptions shortened and option lists cut to two. It holds the root folder and the Fama-French dashboard (two tabs, `navigation_bar`, three table widgets, nulls and lists in `storage.params`), plus one app built from its first tab.

```json
{"owned":{"aaaaaaaa-0000-4000-8000-000000000001":{"creator":true,"content":{"index":"aaaaaaaa-0000-4000-8000-000000000001","name":"root","isFolder":true,"isRoot":true,"children":["aaaaaaaa-0000-4000-8000-000000000002"],"data":{"name":"root"}},"created_date":"2026-10-06T01:13:34Z","updated_date":"2026-10-06T01:13:34Z","created_by":"Example User","is_shared":false},"aaaaaaaa-0000-4000-8000-000000000002":{"creator":true,"content":{"index":"aaaaaaaa-0000-4000-8000-000000000002","isFolder":false,"created_date":"2026-10-06T01:13:34.238853Z","parentId":"aaaaaaaa-0000-4000-8000-000000000001","data":{"name":"Fama-French Research Data","templateId":"custom-cccccccc-0000-4000-8000-000000000001-fama-french-research-data","type":"template","widgets":[{"id":"bbbbbbbb-0000-4000-8000-000000000001","widgetId":"famafrench_factors_famafrench_obb","type":"table","name":"Factors","showTitle":true,"description":"Factors.","groupId":null,"innerTab":"factors","storage":{"chartView":{"enabled":false,"chartType":"line","chartSettingsOpen":false},"params":{"region":"america","factor":"3_factors","frequency":"monthly","start_date":null,"end_date":null,"provider":"famafrench"},"default":{"line":{"cellRange":{}}},"enableAdvanced":true,"chartType":"line","isPivotMode":false,"openToolPanel":null,"paginationPageSize":100},"external":true,"params":[{"paramName":"region","label":"Region","value":"america","multiple":false,"row":0,"type":"text","show":true,"hidden":false,"options":[{"label":"america","value":"america"},{"label":"north_america","value":"north_america"}],"multiSelect":false},{"paramName":"factor","label":"Factor","value":"3_factors","multiple":false,"row":0,"type":"text","show":true,"hidden":false,"options":[{"label":"5_factors","value":"5_factors"},{"label":"3_factors","value":"3_factors"}],"multiSelect":false},{"paramName":"frequency","label":"Frequency","value":"monthly","multiple":false,"row":0,"type":"text","show":true,"hidden":false,"options":[{"label":"daily","value":"daily"},{"label":"weekly","value":"weekly"}],"multiSelect":false},{"paramName":"start_date","label":"Start Date","value":null,"multiple":false,"row":0,"type":"date","show":true,"hidden":false,"options":[],"multiSelect":false},{"paramName":"end_date","label":"End Date","value":null,"multiple":false,"row":0,"type":"date","show":true,"hidden":false,"options":[],"multiSelect":false},{"paramName":"provider","label":"provider","value":"famafrench","multiple":false,"row":0,"type":"text","show":false,"hidden":false,"options":[],"multiSelect":false}],"staleTime":300000,"refetchInterval":900000,"runButton":false,"exportable":true,"category":"Famafrench","subCategory":"Factors","connectionType":"advanced-backend","endpoint":{"url":"https://backend.example/api/v1/famafrench/factors","method":"GET","headers":{},"query":{}},"data":{"table":{"showAll":true}},"source":["Famafrench"],"sourceId":"cccccccc-0000-4000-8000-000000000001","sourceName":"Example backend","isMinimized":false,"originalH":15,"paramGroups":{}},{"id":"bbbbbbbb-0000-4000-8000-000000000002","widgetId":"famafrench_breakpoints_famafrench_obb","type":"table","name":"Breakpoints","showTitle":true,"description":"Breakpoints.","groupId":null,"innerTab":"factors","storage":{"chartView":{"enabled":false,"chartType":"line","chartSettingsOpen":false},"params":{"breakpoint_type":"me","start_date":null,"end_date":null,"provider":"famafrench"},"default":{"line":{"cellRange":{}}},"enableAdvanced":true,"chartType":"line","isPivotMode":false,"openToolPanel":null,"paginationPageSize":100},"external":true,"params":[{"paramName":"breakpoint_type","label":"Breakpoint Type","value":"me","multiple":false,"row":0,"type":"text","show":true,"hidden":false,"options":[{"label":"me","value":"me"},{"label":"be-me","value":"be-me"}],"multiSelect":false},{"paramName":"start_date","label":"Start Date","value":null,"multiple":false,"row":0,"type":"date","show":true,"hidden":false,"options":[],"multiSelect":false},{"paramName":"end_date","label":"End Date","value":null,"multiple":false,"row":0,"type":"date","show":true,"hidden":false,"options":[],"multiSelect":false},{"paramName":"provider","label":"provider","value":"famafrench","multiple":false,"row":0,"type":"text","show":false,"hidden":false,"options":[],"multiSelect":false}],"staleTime":300000,"refetchInterval":900000,"runButton":false,"exportable":true,"category":"Famafrench","subCategory":"Breakpoints","connectionType":"advanced-backend","endpoint":{"url":"https://backend.example/api/v1/famafrench/breakpoints","method":"GET","headers":{},"query":{}},"data":{"table":{"showAll":true}},"source":["Famafrench"],"sourceId":"cccccccc-0000-4000-8000-000000000001","sourceName":"Example backend","isMinimized":false,"originalH":15,"paramGroups":{}},{"id":"bbbbbbbb-0000-4000-8000-000000000003","widgetId":"famafrench_us_portfolio_returns_famafrench_obb","type":"table","name":"Fama-French US Portfolio Returns","showTitle":true,"description":"Fama-French US Portfolio Returns.","groupId":"","innerTab":"portfolios","storage":{"chartView":{"enabled":false,"chartType":"line","chartSettingsOpen":false},"params":{"portfolio":"portfolios_formed_on_me","measure":"value","frequency":"monthly","start_date":null,"end_date":null,"provider":"famafrench"},"default":{},"enableAdvanced":true},"external":true,"params":[{"paramName":"portfolio","label":"Portfolio","value":"portfolios_formed_on_me","multiple":false,"row":0,"type":"text","show":true,"hidden":false,"options":[],"multiSelect":false},{"paramName":"measure","label":"Measure","value":"value","multiple":false,"row":0,"type":"text","show":true,"hidden":false,"options":[{"label":"value","value":"value"},{"label":"equal","value":"equal"}],"multiSelect":false},{"paramName":"frequency","label":"Frequency","value":"monthly","multiple":false,"row":0,"type":"text","show":true,"hidden":false,"options":[{"label":"monthly","value":"monthly"},{"label":"annual","value":"annual"}],"multiSelect":false},{"paramName":"start_date","label":"Start Date","value":null,"multiple":false,"row":0,"type":"date","show":true,"hidden":false,"options":[],"multiSelect":false},{"paramName":"end_date","label":"End Date","value":null,"multiple":false,"row":0,"type":"date","show":true,"hidden":false,"options":[],"multiSelect":false},{"paramName":"provider","label":"provider","value":"famafrench","multiple":false,"row":0,"type":"text","show":false,"hidden":false,"options":[],"multiSelect":false}],"staleTime":300000,"refetchInterval":900000,"runButton":false,"exportable":true,"category":"Famafrench","subCategory":"US Portfolio Returns","connectionType":"advanced-backend","endpoint":{"url":"https://backend.example/api/v1/famafrench/us_portfolio_returns","method":"GET","headers":{},"query":{}},"data":{"table":{"showAll":true}},"source":["Famafrench"],"sourceId":"cccccccc-0000-4000-8000-000000000001","sourceName":"Example backend","isMinimized":false,"originalH":15,"isNew":true},{"id":"bbbbbbbb-0000-4000-8000-000000000004","widgetId":"navigation_bar","name":"Navigation Bar","showTitle":true,"description":"Navigation Bar.","groupId":"","innerTab":"factors","disableRetrievalForCopilot":true,"storage":{"tabs":[{"id":"factors","name":"Factors"},{"id":"portfolios","name":"Portfolios"}],"params":{}},"external":false,"params":[],"staleTime":300000,"refetchInterval":900000,"runButton":false,"exportable":true,"data":{"table":{}},"isNew":true}],"gridLayout":{"factors":[{"w":40,"h":2,"x":0,"y":0,"i":"bbbbbbbb-0000-4000-8000-000000000004","minW":40,"minH":2,"maxH":2,"moved":false,"static":true},{"w":40,"h":18,"x":0,"y":2,"i":"bbbbbbbb-0000-4000-8000-000000000001","minW":8,"minH":4,"moved":false,"static":false},{"w":40,"h":15,"x":0,"y":20,"i":"bbbbbbbb-0000-4000-8000-000000000002","minW":8,"minH":4,"moved":false,"static":false}],"portfolios":[{"y":0,"x":0,"w":40,"h":2,"minW":40,"maxH":2,"minH":2,"i":"bbbbbbbb-0000-4000-8000-000000000004","static":true},{"w":20,"h":16,"x":0,"y":0,"i":"bbbbbbbb-0000-4000-8000-000000000003","minH":4,"minW":8}]},"groups":[],"currentTab":"factors","numberOfChanges":2,"lastUpdated":1791252790795,"storedFileUUIDs":[]},"updated_date":"2026-10-06T01:14:34.187765Z","isShared":false,"created_by":"Example User"},"created_date":"2026-10-06T01:13:34Z","updated_date":"2026-10-06T01:14:34Z","created_by":"Example User","is_shared":false}},"apps":{"owned":{"aaaaaaaa-0000-4000-8000-000000000003":{"content":{"name":"Fama-French App","description":"","img":"","img_dark":"","img_light":"","prompts":[],"widgets":[{"id":"bbbbbbbb-0000-4000-8000-000000000001","widgetId":"famafrench_factors_famafrench_obb","type":"table","name":"Factors","showTitle":true,"description":"Factors.","groupId":null,"innerTab":"factors","storage":{"chartView":{"enabled":false,"chartType":"line","chartSettingsOpen":false},"params":{"region":"america","factor":"3_factors","frequency":"monthly","start_date":null,"end_date":null,"provider":"famafrench"},"default":{"line":{"cellRange":{}}},"enableAdvanced":true,"chartType":"line","isPivotMode":false,"openToolPanel":null,"paginationPageSize":100},"external":true,"params":[{"paramName":"region","label":"Region","value":"america","multiple":false,"row":0,"type":"text","show":true,"hidden":false,"options":[{"label":"america","value":"america"},{"label":"north_america","value":"north_america"}],"multiSelect":false},{"paramName":"factor","label":"Factor","value":"3_factors","multiple":false,"row":0,"type":"text","show":true,"hidden":false,"options":[{"label":"5_factors","value":"5_factors"},{"label":"3_factors","value":"3_factors"}],"multiSelect":false},{"paramName":"frequency","label":"Frequency","value":"monthly","multiple":false,"row":0,"type":"text","show":true,"hidden":false,"options":[{"label":"daily","value":"daily"},{"label":"weekly","value":"weekly"}],"multiSelect":false},{"paramName":"start_date","label":"Start Date","value":null,"multiple":false,"row":0,"type":"date","show":true,"hidden":false,"options":[],"multiSelect":false},{"paramName":"end_date","label":"End Date","value":null,"multiple":false,"row":0,"type":"date","show":true,"hidden":false,"options":[],"multiSelect":false},{"paramName":"provider","label":"provider","value":"famafrench","multiple":false,"row":0,"type":"text","show":false,"hidden":false,"options":[],"multiSelect":false}],"staleTime":300000,"refetchInterval":900000,"runButton":false,"exportable":true,"category":"Famafrench","subCategory":"Factors","connectionType":"advanced-backend","endpoint":{"url":"https://backend.example/api/v1/famafrench/factors","method":"GET","headers":{},"query":{}},"data":{"table":{"showAll":true}},"source":["Famafrench"],"sourceId":"cccccccc-0000-4000-8000-000000000001","sourceName":"Example backend","isMinimized":false,"originalH":15,"paramGroups":{}},{"id":"bbbbbbbb-0000-4000-8000-000000000002","widgetId":"famafrench_breakpoints_famafrench_obb","type":"table","name":"Breakpoints","showTitle":true,"description":"Breakpoints.","groupId":null,"innerTab":"factors","storage":{"chartView":{"enabled":false,"chartType":"line","chartSettingsOpen":false},"params":{"breakpoint_type":"me","start_date":null,"end_date":null,"provider":"famafrench"},"default":{"line":{"cellRange":{}}},"enableAdvanced":true,"chartType":"line","isPivotMode":false,"openToolPanel":null,"paginationPageSize":100},"external":true,"params":[{"paramName":"breakpoint_type","label":"Breakpoint Type","value":"me","multiple":false,"row":0,"type":"text","show":true,"hidden":false,"options":[{"label":"me","value":"me"},{"label":"be-me","value":"be-me"}],"multiSelect":false},{"paramName":"start_date","label":"Start Date","value":null,"multiple":false,"row":0,"type":"date","show":true,"hidden":false,"options":[],"multiSelect":false},{"paramName":"end_date","label":"End Date","value":null,"multiple":false,"row":0,"type":"date","show":true,"hidden":false,"options":[],"multiSelect":false},{"paramName":"provider","label":"provider","value":"famafrench","multiple":false,"row":0,"type":"text","show":false,"hidden":false,"options":[],"multiSelect":false}],"staleTime":300000,"refetchInterval":900000,"runButton":false,"exportable":true,"category":"Famafrench","subCategory":"Breakpoints","connectionType":"advanced-backend","endpoint":{"url":"https://backend.example/api/v1/famafrench/breakpoints","method":"GET","headers":{},"query":{}},"data":{"table":{"showAll":true}},"source":["Famafrench"],"sourceId":"cccccccc-0000-4000-8000-000000000001","sourceName":"Example backend","isMinimized":false,"originalH":15,"paramGroups":{}}],"groups":[],"gridLayout":{"factors":[{"w":40,"h":18,"x":0,"y":2,"i":"bbbbbbbb-0000-4000-8000-000000000001","minW":8,"minH":4,"moved":false,"static":false},{"w":40,"h":15,"x":0,"y":20,"i":"bbbbbbbb-0000-4000-8000-000000000002","minW":8,"minH":4,"moved":false,"static":false}]},"currentTab":"factors"},"creator":true,"is_shared":false,"createdDate":"2026-10-06T01:20:00Z","updatedDate":"2026-10-06T01:20:00Z","createdBy":"Example User","sharedWith":[]}},"shared":{}}}
```

- [ ] **Step 2: Write the failing tests.** Create `$C/src/lib/workspaceDashboards.test.ts`:

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { UNRESOLVED_BACKEND_ID } from "./appsJson";
import type { SyncStore } from "./types";
import { fromWorkspace } from "./workspaceDashboards";
import { widget } from "../test/fixtures";

type Rec = Record<string, unknown>;
const fixture = JSON.parse(readFileSync(resolve(process.cwd(), "src/test/workspace-fama-french.json"), "utf8"));
const famaFrench = (): Rec => structuredClone(fixture.owned["aaaaaaaa-0000-4000-8000-000000000002"].content);
const app = (): Rec => structuredClone(fixture.apps.owned["aaaaaaaa-0000-4000-8000-000000000003"].content);
const FACTORS = "famafrench_factors_famafrench_obb";
const body = (content: Rec, store: SyncStore = "dashboard") => (store === "dashboard" ? content.data : content) as Rec;
const widgetsOf = (content: Rec, store: SyncStore = "dashboard") => body(content, store).widgets as Rec[];

describe("fromWorkspace", () => {
  it("makes one tab per gridLayout key, named and ordered by the tab strip, and one card per widget", () => {
    const d = fromWorkspace(famaFrench(), "dashboard", []);
    expect(d.name).toBe("Fama-French Research Data");
    expect(d.tabs.map((t) => t.name)).toEqual(["Factors", "Portfolios"]);
    expect(d.tabs.map((t) => t.cards.map((c) => c.widgetId))).toEqual([
      [FACTORS, "famafrench_breakpoints_famafrench_obb"],
      ["famafrench_us_portfolio_returns_famafrench_obb"],
    ]);
  });

  it("takes params from storage.params by the importer's rules, layout from the grid entry, and fresh ids", () => {
    const [first] = fromWorkspace(famaFrench(), "dashboard", []).tabs[0].cards;
    expect(first.params).toEqual({ region: "america", factor: "3_factors", frequency: "monthly", provider: "famafrench" });
    expect(first.layout).toEqual({ x: 0, y: 2, w: 40, h: 18 });
    expect(first.backendId).toBe(UNRESOLVED_BACKEND_ID);
    expect(first.id).not.toMatch(/^bbbbbbbb-/);
    expect(first.extensions?.workspace?.widget.id).toBe("bbbbbbbb-0000-4000-8000-000000000001");
  });

  it("resolves the backend as importApps does", () => {
    const [first] = fromWorkspace(famaFrench(), "dashboard", [widget({ id: FACTORS, backendId: "nas" })]).tabs[0].cards;
    expect(first.backendId).toBe("nas");
  });

  it("turns an enabled storage.chartView into the chart view", () => {
    const content = famaFrench();
    ((widgetsOf(content)[0].storage as Rec).chartView as Rec).enabled = true;
    expect(fromWorkspace(content, "dashboard", []).tabs[0].cards[0].view).toBe("chart");
  });

  it("names a tab by its key when there is no tab strip", () => {
    const content = famaFrench();
    (content.data as Rec).widgets = widgetsOf(content).filter((w) => w.widgetId !== "navigation_bar");
    expect(fromWorkspace(content, "dashboard", []).tabs.map((t) => t.name)).toEqual(["factors", "portfolios"]);
  });

  it("reads an app's content the same way", () => {
    const d = fromWorkspace(app(), "app", []);
    expect(d.name).toBe("Fama-French App");
    expect(d.tabs.map((t) => [t.name, t.cards.length])).toEqual([["factors", 2]]);
  });

  it("restores BDOBB's own card state from extensions.bdobb, and refuses an invalid one", () => {
    const content = famaFrench();
    widgetsOf(content)[0].extensions = { bdobb: { schemaVersion: 1, profile: "v3", title: "Mine", minimized: true } };
    expect(fromWorkspace(content, "dashboard", []).tabs[0].cards[0]).toMatchObject({ title: "Mine", minimized: true });
    widgetsOf(content)[0].extensions = { bdobb: { schemaVersion: 1, profile: "v3", view: "pivot" } };
    expect(() => fromWorkspace(content, "dashboard", [])).toThrow();
  });

  it("throws on content it cannot read", () => {
    expect(() => fromWorkspace({ data: { name: "x" } }, "dashboard", [])).toThrow();
    expect(() => fromWorkspace("nope", "app", [])).toThrow();
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm -C "$C" exec vitest run src/lib/workspaceDashboards.test.ts`
Expected: FAIL with `Failed to resolve import "./workspaceDashboards"`.

- [ ] **Step 4: Implement.** Create `$C/src/lib/workspaceDashboards.ts`:

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

import { decodeV3CardExtension, unwrapExtension } from "./appsExtensionsV3";
import { importApps, toParams } from "./appsJson";
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
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm -C "$C" exec vitest run src/lib/workspaceDashboards.test.ts && pnpm -C "$C" exec eslint src/lib/workspaceDashboards.ts src/lib/workspaceDashboards.test.ts`
Expected: `8 passed`; eslint is silent.

- [ ] **Step 6: Commit**

```bash
git -C "$C" branch --show-current
git -C "$C" add src/lib/workspaceDashboards.ts src/lib/workspaceDashboards.test.ts src/test/workspace-fama-french.json
git -C "$C" commit -m "feat(v3): map Workspace dashboards and apps to BDOBB dashboards

One tab per gridLayout key, named and ordered by the navigation_bar; one card
per widget through importApps (backend resolution, toParams, unresolved
cards); server records kept in extensions.workspace for the round trip.
Fixture: a sanitized real Workspace dashboard, root folder and app.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Mapper, BDOBB → Workspace and the round trips

**Files:**
- Modify: `$C/src/lib/workspaceDashboards.ts`
- Test: `$C/src/lib/workspaceDashboards.test.ts`

**Interfaces:**
- Consumes: from Task 4, `fromWorkspace`; `encodeV3CardExtension` from `appsExtensionsV3.ts`; `LOCAL_TABLE_ID` from `builtins.ts`.
- Produces:
  - `export type NewItem = { index: string; parentId: string | null }`.
  - `export function toWorkspace(dashboard: Dashboard, store: SyncStore, item?: NewItem): Record<string, unknown>`. It returns the content to POST: a dashboard item for `"dashboard"`, or `UserAppCreate` for `"app"`.
  - The round-trip guarantee: `toWorkspace(fromWorkspace(c))` equals `c`, comparing `widgets` sorted by id (R8).

- [ ] **Step 1: Write the failing tests.** In `$C/src/lib/workspaceDashboards.test.ts`, replace the import block with:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { UNRESOLVED_BACKEND_ID, exportCompatibleApp, importApps } from "./appsJson";
import { BUILTIN_WIDGETS, LOCAL_TABLE_ID } from "./builtins";
import type { Dashboard, SyncStore } from "./types";
import { fromWorkspace, toWorkspace } from "./workspaceDashboards";
import { card as makeCard, widget } from "../test/fixtures";
```

Insert these helpers directly above `const widgetsOf`:

```ts
/** The widgets array's order carries nothing (grid entries join by id), so round trips compare it sorted. */
function normalize(content: Rec, store: SyncStore = "dashboard"): Rec {
  const b = body(content, store);
  const sorted = { ...b, widgets: [...(b.widgets as Rec[])].sort((x, y) => String(x.id).localeCompare(String(y.id))) };
  return store === "dashboard" ? { ...content, data: sorted } : sorted;
}
const gridOf = (content: Rec) => body(content).gridLayout as Record<string, Rec[]>;
```

Append:

```ts

describe("toWorkspace round trip", () => {
  it("returns a downloaded dashboard unchanged", () => {
    const content = famaFrench();
    expect(normalize(toWorkspace(fromWorkspace(content, "dashboard", []), "dashboard"))).toEqual(normalize(famaFrench()));
  });

  it("returns it unchanged when the registry seeds params the server never stored", () => {
    const registry = [widget({ id: FACTORS, params: [{ paramName: "region", value: "america" }, { paramName: "extra", value: "x" }] })];
    const d = fromWorkspace(famaFrench(), "dashboard", registry);
    expect(d.tabs[0].cards[0].params.extra).toBe("x");
    expect(normalize(toWorkspace(d, "dashboard"))).toEqual(normalize(famaFrench()));
  });

  it("returns a downloaded app unchanged", () => {
    expect(normalize(toWorkspace(fromWorkspace(app(), "app", []), "app"), "app")).toEqual(normalize(app(), "app"));
  });

  it("writes back an edited param and keeps the server's untouched values", () => {
    const d = fromWorkspace(famaFrench(), "dashboard", []);
    const c = d.tabs[0].cards[0];
    c.params = { ...c.params, region: "europe" };
    const params = (widgetsOf(toWorkspace(d, "dashboard"))[0].storage as Rec).params as Rec;
    expect(params).toMatchObject({ region: "europe", start_date: null, end_date: null });
  });

  it("writes back a moved card's position and keeps its grid extras", () => {
    const d = fromWorkspace(famaFrench(), "dashboard", []);
    d.tabs[0].cards[0].layout = { x: 4, y: 6, w: 20, h: 10 };
    const entry = gridOf(toWorkspace(d, "dashboard")).factors[1];
    expect(entry).toEqual({ i: "bbbbbbbb-0000-4000-8000-000000000001", x: 4, y: 6, w: 20, h: 10, minW: 8, minH: 4, moved: false, static: false });
  });

  it("writes the chart view into storage.chartView, keeping its other fields", () => {
    const d = fromWorkspace(famaFrench(), "dashboard", []);
    d.tabs[0].cards[0].view = "chart";
    expect((widgetsOf(toWorkspace(d, "dashboard"))[0].storage as Rec).chartView).toEqual({ enabled: true, chartType: "line", chartSettingsOpen: false });
  });

  it("regenerates the tab strip from renamed and added tabs, and drops a removed card", () => {
    const d = fromWorkspace(famaFrench(), "dashboard", []);
    d.tabs[0].name = "Factor data";
    d.tabs[1].cards = [];
    d.tabs.push({ id: "t-new", name: "New", cards: [] });
    const out = toWorkspace(d, "dashboard");
    const nav = widgetsOf(out).find((w) => w.widgetId === "navigation_bar") as Rec;
    expect((nav.storage as Rec).tabs).toEqual([{ id: "factors", name: "Factor data" }, { id: "portfolios", name: "Portfolios" }, { id: "t-new", name: "New" }]);
    expect(gridOf(out)["t-new"]).toEqual([expect.objectContaining({ i: nav.id, w: 40, h: 2 })]);
    expect(widgetsOf(out).some((w) => w.widgetId === "famafrench_us_portfolio_returns_famafrench_obb")).toBe(false);
  });

  it("builds a new dashboard item for a BDOBB-made dashboard, with no tab strip for one tab", () => {
    const d: Dashboard = { id: "d1", name: "Mine", tabs: [{ id: "t1", name: "Main", cards: [makeCard({ id: "c1", widgetId: "note", backendId: "builtin", params: { text: "hi" } })] }] };
    const out = toWorkspace(d, "dashboard", { index: "ffffffff-0000-4000-8000-000000000001", parentId: "root-index" });
    expect(out).toMatchObject({ index: "ffffffff-0000-4000-8000-000000000001", isFolder: false, parentId: "root-index", data: { name: "Mine", groups: [], currentTab: "t1" } });
    const [w] = widgetsOf(out);
    expect(w).toMatchObject({ widgetId: "note", innerTab: "t1", storage: { params: { text: "hi" } } });
    expect(gridOf(out).t1).toEqual([{ i: w.id, x: 0, y: 0, w: 20, h: 9 }]);
  });

  it("never uploads a local table's file", () => {
    const d: Dashboard = { id: "d1", name: "Mine", tabs: [{ id: "t1", name: "Main", cards: [makeCard({ widgetId: LOCAL_TABLE_ID, backendId: "builtin", params: { file: "mine.csv", sheet: "1" } })] }] };
    expect((widgetsOf(toWorkspace(d, "dashboard"))[0].storage as Rec).params).toEqual({ sheet: "1" });
  });

  it("gives a second card sharing one server id a fresh id", () => {
    const d = fromWorkspace(famaFrench(), "dashboard", []);
    d.tabs[0].cards.push({ ...d.tabs[0].cards[0], id: "copy" });
    const ids = gridOf(toWorkspace(d, "dashboard")).factors.map((e) => e.i);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps BDOBB built-ins, groups and card state through BDOBB -> Workspace -> BDOBB", () => {
    const file = JSON.parse(readFileSync(resolve(process.cwd(), "docs/examples/v3.1.0-builtins.apps.json"), "utf8"));
    const [source] = importApps(file, BUILTIN_WIDGETS).dashboards;
    const c = source.tabs[0].cards[0];
    Object.assign(c, { title: "Pinned", minimized: true, view: "transposed", table: { sorting: [{ id: "a", desc: true }] } });
    const back = fromWorkspace(toWorkspace(source, "dashboard", { index: "ffffffff-0000-4000-8000-000000000002", parentId: null }), "dashboard", BUILTIN_WIDGETS);
    const shape = (d: Dashboard) => ({
      name: d.name, groups: d.groups, groupsDisabled: d.groupsDisabled,
      tabs: d.tabs.map((t) => ({ name: t.name, cards: t.cards.map((x) => ({ ...x, id: undefined, extensions: undefined })) })),
    });
    expect(shape(back)).toEqual(shape(source));
  });

  it("leaves a synced card exportable as a BDOBB-compatible app", () => {
    expect(exportCompatibleApp(fromWorkspace(famaFrench(), "dashboard", [])).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm -C "$C" exec vitest run src/lib/workspaceDashboards.test.ts`
Expected: FAIL. `toWorkspace` is not exported, so the new tests throw `toWorkspace is not a function`.

- [ ] **Step 3: Implement.** In `$C/src/lib/workspaceDashboards.ts`, widen two imports:

```ts
import { decodeV3CardExtension, encodeV3CardExtension, unwrapExtension } from "./appsExtensionsV3";
import { importApps, toParams } from "./appsJson";
import { LOCAL_TABLE_ID } from "./builtins";
```

Append:

```ts

/** Only what the user changed goes back: untouched keys keep the server's own value (a null, a list). */
function mergeParams(original: Rec, mapped: Record<string, string>, current: Record<string, string>): Rec {
  const out: Rec = { ...original };
  for (const [k, v] of Object.entries(current)) if (!(Object.hasOwn(mapped, k) && mapped[k] === v)) out[k] = v;
  for (const k of Object.keys(mapped)) if (!Object.hasOwn(current, k)) delete out[k];
  return out;
}

/** The card's BDOBB-only state for extensions.bdobb, or undefined when there is none. A chart view travels as storage.chartView instead. */
function nativeOf(card: DashboardCard): Rec | undefined {
  const encoded = unwrapExtension(encodeV3CardExtension(card, "$.card"));
  const native: Rec = encoded ? { ...encoded } : { schemaVersion: 1, profile: "v3" };
  if (native.view === "chart") delete native.view;
  if (card.bindings?.length) native.bindings = card.bindings.map(({ groupId, paramName }) => ({ groupId, paramName }));
  return Object.keys(native).length > 2 ? native : undefined;
}

/** `extensions` with `bdobb` set to `native`, or removed; undefined when nothing is left. */
function withNative(extensions: unknown, native: Rec | undefined): Rec | undefined {
  const out: Rec = isRecord(extensions) ? { ...extensions } : {};
  if (native) out.bdobb = native;
  else delete out.bdobb;
  return Object.keys(out).length > 0 ? out : undefined;
}

function cardRecord(card: DashboardCard, tabKey: string, used: Set<unknown>): { widget: Rec; layout: Rec } {
  const ws = card.extensions?.workspace;
  // A duplicated card carries its source's server id; a second use in one dashboard gets a fresh one.
  const id = ws && typeof ws.widget.id === "string" && !used.has(ws.widget.id) ? ws.widget.id : crypto.randomUUID();
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
  const extensions = withNative(widget.extensions, nativeOf(card));
  if (extensions) widget.extensions = extensions;
  else delete widget.extensions;
  const layout = { ...(ws?.layout ?? {}), i: id, x: card.layout.x, y: card.layout.y, w: card.layout.w, h: card.layout.h };
  return { widget, layout };
}

/** Where a new dashboard item goes: its index (the item's uuid) and the root folder's index. */
export type NewItem = { index: string; parentId: string | null };

/**
 * The dashboard as server content for `store` (spec: Round trip). A card that
 * came from the server is its original widget record with only what changed
 * written back; a BDOBB-made card is a minimal record carrying its own state
 * in extensions.bdobb. `item` places a dashboard item that has no server
 * shell yet (a new dashboard, or one an import replaced).
 */
export function toWorkspace(dashboard: Dashboard, store: SyncStore, item?: NewItem): Rec {
  const ws = dashboard.extensions?.workspace;
  const keyOf = (tabId: string) => ws?.tabKeys[tabId] ?? tabId;
  const widgets: Rec[] = [];
  const gridLayout: Record<string, Rec[]> = {};
  const used = new Set<unknown>();
  for (const tab of dashboard.tabs) {
    const key = keyOf(tab.id);
    gridLayout[key] = [];
    for (const card of tab.cards) {
      const { widget, layout } = cardRecord(card, key, used);
      widgets.push(widget);
      gridLayout[key].push(layout);
    }
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
  const extensions = withNative(body.extensions, Object.keys(native).length > 0 ? native : undefined);
  if (extensions) body.extensions = extensions;
  else delete body.extensions;
  if (store === "app") return body;
  if (shell) return { ...shell, data: body };
  return { index: item?.index ?? crypto.randomUUID(), isFolder: false, parentId: item?.parentId ?? null, data: body };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm -C "$C" exec vitest run src/lib/workspaceDashboards.test.ts && pnpm -C "$C" exec eslint src/lib/workspaceDashboards.ts src/lib/workspaceDashboards.test.ts && pnpm -C "$C" exec tsc --noEmit -p .`
Expected: `20 passed`; eslint and tsc are silent.

- [ ] **Step 5: Commit**

```bash
git -C "$C" branch --show-current
git -C "$C" add src/lib/workspaceDashboards.ts src/lib/workspaceDashboards.test.ts
git -C "$C" commit -m "feat(v3): map BDOBB dashboards back to Workspace content

A server card is its original record with only edited params, layout and chart
view written back; navigation_bar regenerated from the tabs; BDOBB-only cards
and state (built-ins, title, table, groups) ride in extensions.bdobb. Round
trips return Workspace content unchanged and BDOBB built-ins exactly.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Dashboard and app HTTP calls

**Files:**
- Modify: `$C/src/lib/workspaceAccount.ts` (append at the end; uses the private `guarded`, `endpoint`, `requestHeaders`, `responseJson`, `WorkspaceError` and `KEY_REFUSED`)
- Test: `$C/src/lib/workspaceAccount.sync.test.ts`

**Interfaces:**
- Consumes: the existing `WorkspaceSession` and `WorkspaceResult<T>`.
- Produces:
  - Types: `export type ServerRecord = { content: unknown; updated: string }` and `export type ServerStore = { owned; shared; apps: Record<string, ServerRecord> }`.
  - `export function canonicalUuid(raw: string): string`.
  - `export function fetchServerStore(session, signal?): Promise<WorkspaceResult<ServerStore | null>>`, which returns null when `owned` answers 404.
  - `export function fetchOwnedDashboards(session, signal?): Promise<WorkspaceResult<Record<string, ServerRecord> | null>>`.
  - `export function fetchOwnedApps(session, signal?): Promise<WorkspaceResult<Record<string, ServerRecord> | null>>`.
  - `export function postDashboardItems(session, items: Record<string, unknown>, signal?): Promise<WorkspaceResult<"ok" | "absent">>`.
  - `export function putApp(session, uuid: string, content: unknown, signal?): Promise<WorkspaceResult<"ok" | "absent">>`.
  - `export function deleteApp(session, uuid: string, signal?): Promise<WorkspaceResult<"ok" | "absent">>`.

- [ ] **Step 1: Write the failing tests.** Create `$C/src/lib/workspaceAccount.sync.test.ts`. Its `beforeEach` has a block body on purpose: an arrow that returns `mockReset()`'s mock hands vitest a cleanup hook that calls `fetch()` with no arguments.

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetch } from "@tauri-apps/plugin-http";
import { backend } from "../test/fixtures";
import { KEY_REFUSED, canonicalUuid, deleteApp, fetchOwnedDashboards, fetchServerStore, postDashboardItems, putApp, type WorkspaceSession } from "./workspaceAccount";
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

const UUID = "aaaaaaaa-0000-4000-8000-000000000002";
const login: WorkspaceSession = { mode: "login", connection: { id: "ws1", name: "Work", baseUrl: "https://workspace.example/api" }, username: "alice", userId: "11111111-1111-4111-8111-111111111111", token: "synthetic-session", displaySettings: {} };
const keyed = (): WorkspaceSession => {
  const b = backend({ id: "b1", name: "Gateway", baseUrl: "https://gateway.workspace.example", headerName: "X-Key", headerValue: "synthetic-key" });
  return { mode: "key", connection: { id: b.id, name: b.name, baseUrl: b.baseUrl, backend: b }, displaySettings: {} };
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const record = (content: unknown, updated = "2026-10-11T00:00:01Z") => ({ creator: true, content, created_date: updated, updated_date: updated, created_by: "Example User", is_shared: false });
/** Answers by path; anything unlisted is 404. */
function routes(map: Record<string, () => Response>) {
  vi.mocked(fetch).mockImplementation(async (url) => (map[new URL(String(url)).pathname] ?? (() => json({}, 404)))());
}
const calls = () => vi.mocked(fetch).mock.calls.map(([url, init]) => [init?.method ?? "GET", new URL(String(url)).pathname, init?.headers as Record<string, string>] as const);
// A block body: an arrow returning the mock would hand vitest a cleanup hook that calls fetch().
beforeEach(() => {
  vi.mocked(fetch).mockReset();
});

describe("canonicalUuid", () => {
  it("dashes a hex uuid and lowercases either spelling", () => {
    expect(canonicalUuid(UUID.replace(/-/g, "").toUpperCase())).toBe(UUID);
    expect(canonicalUuid(UUID.toUpperCase())).toBe(UUID);
  });
});

describe("fetchServerStore", () => {
  it("reads owned, shared and apps under canonical keys, with the session token as Bearer", async () => {
    routes({
      "/api/pro/dash/sync/owned": () => json({ owned: { [UUID.replace(/-/g, "")]: record({ data: {} }) } }),
      "/api/pro/dash/sync/shared": () => json({ shared: { s1: record({ data: {} }, "d2") }, entity_shared: { s2: record({ data: {} }, "d3") } }),
      "/api/pro/user-apps/sync": () => json({ owned: { a1: { content: { name: "A" }, updatedDate: "d4" } }, shared: {} }),
    });
    const result = await fetchServerStore(login);
    expect(result).toEqual({ ok: true, value: {
      owned: { [UUID]: { content: { data: {} }, updated: "2026-10-11T00:00:01Z" } },
      shared: { s1: { content: { data: {} }, updated: "d2" }, s2: { content: { data: {} }, updated: "d3" } },
      apps: { a1: { content: { name: "A" }, updated: "d4" } },
    } });
    expect(calls().every(([, , headers]) => headers.Authorization === "Bearer synthetic-session")).toBe(true);
  });

  it("is null when owned answers 404, and treats a missing shared or apps route as empty", async () => {
    routes({});
    expect(await fetchServerStore(login)).toEqual({ ok: true, value: null });
    routes({ "/api/pro/dash/sync/owned": () => json({ owned: {} }) });
    expect(await fetchServerStore(login)).toEqual({ ok: true, value: { owned: {}, shared: {}, apps: {} } });
  });

  it("expires a login session on 401 and reports a key-mode 401 as a refused key", async () => {
    routes({ "/api/pro/dash/sync/owned": () => json({}, 401) });
    expect(await fetchServerStore(login)).toMatchObject({ ok: false, expired: true });
    routes({ "/pro/dash/sync/owned": () => json({}, 401) });
    expect(await fetchServerStore(keyed())).toEqual({ ok: false, message: KEY_REFUSED, expired: false });
    expect(calls().at(-1)?.[2]["X-Key"]).toBe("synthetic-key");
  });

  it("refuses a list without dates, and never repeats server text", async () => {
    routes({ "/api/pro/dash/sync/owned": () => json({ owned: { x: { content: {} } } }) });
    expect(await fetchServerStore(login)).toMatchObject({ ok: false, expired: false });
    routes({ "/api/pro/dash/sync/owned": () => json({ detail: "secret-server-text" }, 500) });
    const failed = await fetchServerStore(login);
    expect(failed).toMatchObject({ ok: false, message: expect.stringContaining("HTTP 500") });
    expect(JSON.stringify(failed)).not.toContain("secret-server-text");
  });
});

describe("dashboard and app writes", () => {
  it("posts items to /pro/dash/sync and reports 404 as absent", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ success: true }));
    expect(await postDashboardItems(login, { [UUID]: "DELETE" })).toEqual({ ok: true, value: "ok" });
    expect(calls()[0].slice(0, 2)).toEqual(["POST", "/api/pro/dash/sync"]);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).toEqual({ items: { [UUID]: "DELETE" } });
    vi.mocked(fetch).mockResolvedValueOnce(json({}, 404));
    expect(await postDashboardItems(login, {})).toEqual({ ok: true, value: "absent" });
  });

  it("upserts and deletes one app by uuid", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ success: true })).mockResolvedValueOnce(json({}, 404));
    expect(await putApp(login, UUID, { name: "A" })).toEqual({ ok: true, value: "ok" });
    expect(await deleteApp(login, UUID)).toEqual({ ok: true, value: "absent" });
    expect(calls().map(([m, p]) => [m, p])).toEqual([["POST", `/api/pro/user-apps/${UUID}`], ["DELETE", `/api/pro/user-apps/${UUID}`]]);
  });

  it("reads owned dashboards alone", async () => {
    routes({ "/api/pro/dash/sync/owned": () => json({ owned: { [UUID]: record({ isRoot: true }) } }) });
    expect(await fetchOwnedDashboards(login)).toEqual({ ok: true, value: { [UUID]: { content: { isRoot: true }, updated: "2026-10-11T00:00:01Z" } } });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm -C "$C" exec vitest run src/lib/workspaceAccount.sync.test.ts`
Expected: FAIL. The imports `canonicalUuid`, `fetchServerStore`, … are undefined.

- [ ] **Step 3: Implement.** Append to `$C/src/lib/workspaceAccount.ts`:

```ts

/** One stored dashboard or app: its content and the server's updated date, the only clock sync compares. */
export type ServerRecord = { content: unknown; updated: string };
/** What the dashboard sync downloads. Keys are canonical uuids. */
export type ServerStore = { owned: Record<string, ServerRecord>; shared: Record<string, ServerRecord>; apps: Record<string, ServerRecord> };

/** A server map key in one spelling, lowercase and dashed: Workspace keys come as hex or dashed uuids. */
export function canonicalUuid(raw: string): string {
  const hex = raw.toLowerCase().replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/.test(hex)) return raw.toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * One dashboard-sync request, with the session's credential as the settings
 * upload sends it: login mode's 401 expires the session; key mode's 401/403
 * is a refused key.
 */
async function syncRequest(session: WorkspaceSession, method: string, path: string, signal: AbortSignal, body?: unknown): Promise<Response> {
  const token = session.mode === "login" ? session.token : undefined;
  const response = await fetch(endpoint(session.connection, path), {
    method,
    headers: { ...requestHeaders(session.connection, token), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "omit", redirect: "error", maxRedirections: 0, signal,
  });
  if (session.mode === "key" && (response.status === 401 || response.status === 403)) throw new WorkspaceError(KEY_REFUSED);
  if (response.status === 401) throw new WorkspaceError("The session expired. Sign in again.", true);
  return response;
}

/** GET a sync route: its JSON, or null on 404 (no such store on this server). */
async function getSync(session: WorkspaceSession, path: string, signal: AbortSignal): Promise<Record<string, unknown> | null> {
  const response = await syncRequest(session, "GET", path, signal);
  if (response.status === 404) {
    void response.body?.cancel().catch(() => {});
    return null;
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new WorkspaceError(`The server refused the dashboard list (HTTP ${response.status}).`);
  }
  return responseJson(response);
}

/** A server's `{uuid: record}` map, keyed canonically. A dashboard record dates itself `updated_date`; an app record `updatedDate`. */
function records(map: unknown): Record<string, ServerRecord> {
  if (!isRecord(map)) throw new WorkspaceError("The server returned an invalid dashboard list.");
  const out: Record<string, ServerRecord> = {};
  for (const [key, value] of Object.entries(map)) {
    const updated = isRecord(value) ? (value.updated_date ?? value.updatedDate) : undefined;
    if (!isRecord(value) || typeof updated !== "string") throw new WorkspaceError("The server returned an invalid dashboard list.");
    out[canonicalUuid(key)] = { content: value.content, updated };
  }
  return out;
}

/**
 * The sign-in sync's download: owned dashboards, shared dashboards and owned
 * apps (spec: Sync rules, step 2). `null` when owned answers 404 -- the
 * server keeps no dashboards, and sync stays settings-only. Shared or apps
 * answering 404 count as empty.
 */
export function fetchServerStore(session: WorkspaceSession, signal?: AbortSignal): Promise<WorkspaceResult<ServerStore | null>> {
  return guarded(signal, async (s) => {
    const [owned, shared, apps] = await Promise.all(
      ["/pro/dash/sync/owned", "/pro/dash/sync/shared", "/pro/user-apps/sync"].map((path) => getSync(session, path, s)),
    );
    if (owned === null) return null;
    return {
      owned: records(owned.owned),
      shared: { ...records(shared?.shared ?? {}), ...records(shared?.entity_shared ?? {}) },
      apps: records(apps?.owned ?? {}),
    };
  });
}

/** GET owned dashboards alone (the root folder, a new updated date); null on 404. */
export function fetchOwnedDashboards(session: WorkspaceSession, signal?: AbortSignal): Promise<WorkspaceResult<Record<string, ServerRecord> | null>> {
  return guarded(signal, async (s) => {
    const owned = await getSync(session, "/pro/dash/sync/owned", s);
    return owned === null ? null : records(owned.owned);
  });
}

/** GET owned apps alone (a new updated date); null on 404. */
export function fetchOwnedApps(session: WorkspaceSession, signal?: AbortSignal): Promise<WorkspaceResult<Record<string, ServerRecord> | null>> {
  return guarded(signal, async (s) => {
    const apps = await getSync(session, "/pro/user-apps/sync", s);
    return apps === null ? null : records(apps.owned);
  });
}

/** A write's answer: "absent" is a 404, a server with no such store. */
async function written(response: Response, what: string): Promise<"ok" | "absent"> {
  void response.body?.cancel().catch(() => {});
  if (response.status === 404) return "absent";
  if (!response.ok) throw new WorkspaceError(`The server refused the ${what} (HTTP ${response.status}).`);
  return "ok";
}

/** POST /pro/dash/sync: each item upserted, or deleted by "DELETE" -- per item, never a whole-tree replace. */
export function postDashboardItems(session: WorkspaceSession, items: Record<string, unknown>, signal?: AbortSignal): Promise<WorkspaceResult<"ok" | "absent">> {
  return guarded(signal, async (s) => written(await syncRequest(session, "POST", "/pro/dash/sync", s, { items }), "dashboard upload"));
}

/** POST /pro/user-apps/{uuid}: upsert one app; the body is its content. */
export function putApp(session: WorkspaceSession, uuid: string, content: unknown, signal?: AbortSignal): Promise<WorkspaceResult<"ok" | "absent">> {
  return guarded(signal, async (s) => written(await syncRequest(session, "POST", `/pro/user-apps/${encodeURIComponent(uuid)}`, s, content), "app upload"));
}

/** DELETE /pro/user-apps/{uuid}. "absent" (404) means it is already gone. */
export function deleteApp(session: WorkspaceSession, uuid: string, signal?: AbortSignal): Promise<WorkspaceResult<"ok" | "absent">> {
  return guarded(signal, async (s) => written(await syncRequest(session, "DELETE", `/pro/user-apps/${encodeURIComponent(uuid)}`, s), "app delete"));
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm -C "$C" exec vitest run src/lib/workspaceAccount.sync.test.ts src/lib/workspaceAccount.test.ts && pnpm -C "$C" exec eslint src/lib/workspaceAccount.ts src/lib/workspaceAccount.sync.test.ts`
Expected: everything passes; eslint is silent.

- [ ] **Step 5: Commit**

```bash
git -C "$C" branch --show-current
git -C "$C" add src/lib/workspaceAccount.ts src/lib/workspaceAccount.sync.test.ts
git -C "$C" commit -m "feat(v3): Workspace dashboard and app sync requests

fetchServerStore (owned/shared/apps; null on owned 404), owned-only reads,
POST /pro/dash/sync, POST and DELETE /pro/user-apps/{uuid}; keys canonical;
login 401 expires, key-mode 401 is a refused key; no server text surfaces.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: Link records and tombstones (`workspaceSync.json`)

**Files:**
- Create: `$C/src/stores/workspaceSyncStore.ts`
- Test: `$C/src/stores/workspaceSyncStore.test.ts`

**Interfaces:**
- Consumes: `SyncLink` and `Tombstone` from Task 3; `loadJson`, `saveJson` and `ABSENT` from `jsonStore`; `serialize`.
- Produces:
  - `export type SyncFile = { links: SyncLink[]; tombstones: Tombstone[] }`.
  - `export const useWorkspaceSyncStore` with state `{ links, tombstones, load(): Promise<void>, update(step: (f: SyncFile) => SyncFile): Promise<void> }`.
  - `export function linkFor(links: SyncLink[], connectionId: string, dashboardId: string): SyncLink | undefined`, which ignores dismissed links.

- [ ] **Step 1: Write the failing tests.** Create `$C/src/stores/workspaceSyncStore.test.ts`:

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it } from "vitest";
import { __read, __reset, __seed } from "../test/memfs";
import { __resetJsonStoreForTests } from "../lib/jsonStore";
import { __resetLoggerForTests } from "../lib/logger";
import type { SyncLink } from "../lib/types";
import { linkFor, useWorkspaceSyncStore } from "./workspaceSyncStore";

const link: SyncLink = { dashboardId: "d1", connectionId: "ws1", store: "dashboard", uuid: "u1", serverUpdatedDate: "t1", localRevisionAtSync: 2, shared: false };
beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  useWorkspaceSyncStore.setState({ links: [], tombstones: [] });
});

describe("workspaceSyncStore", () => {
  it("starts empty without a file, and keeps links and tombstones across a restart", async () => {
    await useWorkspaceSyncStore.getState().load();
    expect(useWorkspaceSyncStore.getState().links).toEqual([]);
    await useWorkspaceSyncStore.getState().update((f) => ({ links: [...f.links, link], tombstones: [{ connectionId: "ws1", store: "app", uuid: "u2" }] }));
    expect(JSON.parse(__read("workspaceSync.json") ?? "null")).toEqual({ links: [link], tombstones: [{ connectionId: "ws1", store: "app", uuid: "u2" }] });
    useWorkspaceSyncStore.setState({ links: [], tombstones: [] });
    await useWorkspaceSyncStore.getState().load();
    expect(useWorkspaceSyncStore.getState()).toMatchObject({ links: [link], tombstones: [{ connectionId: "ws1", store: "app", uuid: "u2" }] });
  });

  it("reads an invalid file as empty", async () => {
    __seed("workspaceSync.json", JSON.stringify({ links: [{ dashboardId: 1 }], tombstones: [] }));
    await useWorkspaceSyncStore.getState().load();
    expect(useWorkspaceSyncStore.getState().links).toEqual([]);
  });

  it("does not let two overlapping updates revert each other", async () => {
    await Promise.all([
      useWorkspaceSyncStore.getState().update((f) => ({ ...f, links: [...f.links, link] })),
      useWorkspaceSyncStore.getState().update((f) => ({ ...f, links: [...f.links, { ...link, dashboardId: "d2" }] })),
    ]);
    expect(useWorkspaceSyncStore.getState().links.map((l) => l.dashboardId)).toEqual(["d1", "d2"]);
  });

  it("finds a dashboard's live link on one connection, never a dismissed one", () => {
    const links = [link, { ...link, dashboardId: "d2", dismissed: true }];
    expect(linkFor(links, "ws1", "d1")).toBe(link);
    expect(linkFor(links, "ws1", "d2")).toBeUndefined();
    expect(linkFor(links, "ws2", "d1")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm -C "$C" exec vitest run src/stores/workspaceSyncStore.test.ts`
Expected: FAIL with `Failed to resolve import "./workspaceSyncStore"`.

- [ ] **Step 3: Implement.** Create `$C/src/stores/workspaceSyncStore.ts`:

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

import { create } from "zustand";
import { isRecord } from "../lib/isRecord";
import { ABSENT, loadJson, saveJson } from "../lib/jsonStore";
import { serialize } from "../lib/serialize";
import type { SyncLink, Tombstone } from "../lib/types";

/** Next to settings.json; never exported (spec: Link records and tombstones). */
const PATH = "workspaceSync.json";

export type SyncFile = { links: SyncLink[]; tombstones: Tombstone[] };

const isStore = (v: unknown) => v === "dashboard" || v === "app";
function isLink(l: unknown): l is SyncLink {
  return isRecord(l) && typeof l.dashboardId === "string" && typeof l.connectionId === "string" && isStore(l.store) && typeof l.uuid === "string" &&
    typeof l.serverUpdatedDate === "string" && typeof l.localRevisionAtSync === "number" && typeof l.shared === "boolean" &&
    (l.dismissed === undefined || typeof l.dismissed === "boolean");
}
function isTombstone(t: unknown): t is Tombstone {
  return isRecord(t) && typeof t.connectionId === "string" && isStore(t.store) && typeof t.uuid === "string";
}
function isSyncFile(v: unknown): v is SyncFile {
  return isRecord(v) && Array.isArray(v.links) && v.links.every(isLink) && Array.isArray(v.tombstones) && v.tombstones.every(isTombstone);
}

type SyncState = SyncFile & {
  load: () => Promise<void>;
  /** One serialized read-modify-write of the whole file; `step` sees the state as of its turn, never a stale snapshot. */
  update: (step: (file: SyncFile) => SyncFile) => Promise<void>;
};

export const useWorkspaceSyncStore = create<SyncState>((set, get) => ({
  links: [],
  tombstones: [],
  load: async () => {
    const stored = await loadJson(PATH, isSyncFile);
    // Field by field, so an unknown key in the file is not carried back out by the next write.
    set(stored === ABSENT ? { links: [], tombstones: [] } : {
      links: stored.links.map(({ dashboardId, connectionId, store, uuid, serverUpdatedDate, localRevisionAtSync, shared, dismissed }) =>
        ({ dashboardId, connectionId, store, uuid, serverUpdatedDate, localRevisionAtSync, shared, ...(dismissed ? { dismissed } : {}) })),
      tombstones: stored.tombstones.map(({ connectionId, store, uuid }) => ({ connectionId, store, uuid })),
    });
  },
  update: (step) =>
    serialize("store:workspaceSync", async () => {
      const next = step({ links: get().links, tombstones: get().tombstones });
      await saveJson(PATH, next);
      set(next);
    }),
}));

/** A dashboard's live (not dismissed) link on one connection. */
export function linkFor(links: SyncLink[], connectionId: string, dashboardId: string): SyncLink | undefined {
  return links.find((l) => l.connectionId === connectionId && l.dashboardId === dashboardId && !l.dismissed);
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm -C "$C" exec vitest run src/stores/workspaceSyncStore.test.ts && pnpm -C "$C" exec eslint src/stores/workspaceSyncStore.ts src/stores/workspaceSyncStore.test.ts`
Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
git -C "$C" branch --show-current
git -C "$C" add src/stores/workspaceSyncStore.ts src/stores/workspaceSyncStore.test.ts
git -C "$C" commit -m "feat(v3): workspaceSync.json holds dashboard links and tombstones

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: The decision table (pure)

**Files:**
- Create: `$C/src/lib/dashboardSyncPlan.ts`
- Test: `$C/src/lib/dashboardSyncPlan.test.ts`

**Interfaces:**
- Consumes: `Dashboard`, `SyncLink` and `SyncStore` from Task 3.
- Produces:
  - `export type ServerItem = { store: SyncStore; uuid: string; updated: string; shared: boolean; dashboard: Dashboard }`.
  - `export type SyncAction`, whose `kind` is one of `"take" | "upload" | "conflict" | "deleteLocal" | "deletedConflict" | "create" | "uploadNew" | "dropLink"`.
  - `export function planDashboardSync(connectionId: string, links: SyncLink[], dashboards: Pick<Dashboard, "id" | "revision">[], items: ServerItem[]): SyncAction[]`.

- [ ] **Step 1: Write the failing tests.** Create `$C/src/lib/dashboardSyncPlan.test.ts`. It covers every row of the spec's table, plus shared, dismissed, a stale link and per-connection reading.

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { planDashboardSync, type ServerItem } from "./dashboardSyncPlan";
import type { SyncLink } from "./types";

const link = (over: Partial<SyncLink> = {}): SyncLink => ({ dashboardId: "d1", connectionId: "ws1", store: "dashboard", uuid: "u1", serverUpdatedDate: "t1", localRevisionAtSync: 2, shared: false, ...over });
const item = (over: Partial<ServerItem> = {}): ServerItem => ({ store: "dashboard", uuid: "u1", updated: "t1", shared: false, dashboard: { id: "server", name: "S", tabs: [] }, ...over });
const local = (revision: number) => [{ id: "d1", revision }];
const kinds = (actions: ReturnType<typeof planDashboardSync>) => actions.map((a) => a.kind);

describe("planDashboardSync", () => {
  it.each([
    ["server changed, local unchanged: take server", local(2), [item({ updated: "t2" })], ["take"]],
    ["server unchanged, local changed: upload", local(3), [item()], ["upload"]],
    ["both changed: ask", local(3), [item({ updated: "t2" })], ["conflict"]],
    ["deleted on server, local unchanged: delete local", local(2), [], ["deleteLocal"]],
    ["deleted on server, local changed: ask", local(3), [], ["deletedConflict"]],
    ["neither changed: nothing", local(2), [item()], []],
  ] as const)("%s", (_, dashboards, items, expected) => {
    expect(kinds(planDashboardSync("ws1", [link()], [...dashboards], [...items]))).toEqual(expected);
  });

  it("creates a server item no link names, and uploads a local dashboard no link names", () => {
    const actions = planDashboardSync("ws1", [], [{ id: "d1" }], [item()]);
    expect(actions).toEqual([{ kind: "create", item: item() }, { kind: "uploadNew", dashboardId: "d1" }]);
  });

  it("never counts a shared dashboard as changed locally", () => {
    expect(kinds(planDashboardSync("ws1", [link({ shared: true })], local(9), [item({ shared: true })]))).toEqual([]);
    expect(kinds(planDashboardSync("ws1", [link({ shared: true })], local(9), [item({ shared: true, updated: "t2" })]))).toEqual(["take"]);
    expect(kinds(planDashboardSync("ws1", [link({ shared: true })], local(9), []))).toEqual(["deleteLocal"]);
  });

  it("never downloads a dismissed shared dashboard again", () => {
    expect(planDashboardSync("ws1", [link({ shared: true, dismissed: true })], [], [item({ shared: true })])).toEqual([]);
  });

  it("drops a link whose dashboard is gone here, so its server item is new", () => {
    expect(kinds(planDashboardSync("ws1", [link()], [], [item()]))).toEqual(["dropLink", "create"]);
  });

  it("reads only this connection's links, and tells a dashboard from an app with the same uuid", () => {
    const actions = planDashboardSync("ws1", [link({ connectionId: "ws2" })], local(2), [item({ store: "app" })]);
    expect(kinds(actions)).toEqual(["create", "uploadNew"]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm -C "$C" exec vitest run src/lib/dashboardSyncPlan.test.ts`
Expected: FAIL with `Failed to resolve import "./dashboardSyncPlan"`.

- [ ] **Step 3: Implement.** Create `$C/src/lib/dashboardSyncPlan.ts`:

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

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
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm -C "$C" exec vitest run src/lib/dashboardSyncPlan.test.ts && pnpm -C "$C" exec eslint src/lib/dashboardSyncPlan.ts src/lib/dashboardSyncPlan.test.ts`
Expected: `11 passed`.

- [ ] **Step 5: Commit**

```bash
git -C "$C" branch --show-current
git -C "$C" add src/lib/dashboardSyncPlan.ts src/lib/dashboardSyncPlan.test.ts
git -C "$C" commit -m "feat(v3): dashboard sync decision table as a pure function

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: Conflict dialogs

**Files:**
- Modify: `$C/src/components/dialogs/WorkspaceDialogs.tsx`
- Test: `$C/src/components/dialogs/WorkspaceDialogs.test.tsx`

**Interfaces:**
- Consumes: the file's private `ask` and `useChildDialog`.
- Produces:
  - `export type DashboardConflictChoice = "server" | "local" | "both"`.
  - `export function decideDashboardConflict(server: string, name: string, keepBothName: string): Promise<DashboardConflictChoice>`.
  - `export function decideDeletedDashboard(server: string, name: string): Promise<"delete" | "keep">`.

- [ ] **Step 1: Write the failing tests.** In `$C/src/components/dialogs/WorkspaceDialogs.test.tsx`, add `decideDashboardConflict, decideDeletedDashboard,` to the `./WorkspaceDialogs` import, then append:

```tsx

describe("dashboard sync questions", () => {
  it.each([["Use Work", "server"], ["Keep local", "local"], ["Keep both", "both"]] as const)("a changed-on-both question answers %s", async (button, choice) => {
    const pending = await start(() => decideDashboardConflict("Work", "Macro", "Macro (2)"));
    expect(await screen.findByText('Keep both adds Work\'s copy as "Macro (2)".')).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: button }));
    await expect(pending.answer).resolves.toBe(choice);
  });

  it("focuses Keep both, so Enter takes the default", async () => {
    const pending = await start(() => decideDashboardConflict("Work", "Macro", "Macro (2)"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Keep both" })).toHaveFocus());
    await userEvent.keyboard("{Enter}");
    await expect(pending.answer).resolves.toBe("both");
  });

  it.each([["Delete", "delete"], ["Keep as local", "keep"]] as const)("a deleted-on-server question answers %s, defaulting to Keep as local", async (button, choice) => {
    const pending = await start(() => decideDeletedDashboard("Work", "Macro"));
    expect(await screen.findByRole("dialog", { name: '"Macro" was deleted on Work' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Keep as local" })).toHaveFocus());
    await userEvent.click(screen.getByRole("button", { name: button }));
    await expect(pending.answer).resolves.toBe(choice);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm -C "$C" exec vitest run src/components/dialogs/WorkspaceDialogs.test.tsx`
Expected: FAIL, because `decideDashboardConflict` is not a function.

- [ ] **Step 3: Implement.** In `$C/src/components/dialogs/WorkspaceDialogs.tsx`, change the React import to `import { useEffect, useRef, useState, type ReactNode } from "react";`. Then insert this component directly above the `/** Renders one dialog into its own root until it answers` comment that precedes `ask`. It focuses through a ref in an effect rather than `autoFocus`, which jsx-a11y refuses.

```tsx
/**
 * A dashboard sync question with fixed answers, built like
 * WorkspaceConflictDialog: no ✕ and no Escape, since closing without an
 * answer would decide nothing. `primary` is focused once the dialog opens,
 * so Enter takes the default.
 */
function WorkspaceChoiceDialog<T extends string>({ title, lines, choices, primary, onDecide }: {
  title: string; lines: string[]; choices: { value: T; label: string }[]; primary: T; onDecide: (choice: T) => void;
}) {
  const dialogRef = useChildDialog(() => {});
  const primaryRef = useRef<HTMLButtonElement>(null);
  // After useChildDialog's own effect has opened the dialog.
  useEffect(() => primaryRef.current?.focus(), []);
  return (
    <dialog ref={dialogRef} className="bd-dialog-backdrop" aria-label={title}>
      <div className="bd-dialog bd-dialog--editor">
        <header className="bd-header">
          <div className="bd-heading">
            <h2 className="bd-title">{title}</h2>
          </div>
        </header>
        <div className="bd-body">{lines.map((line) => <p key={line}>{line}</p>)}</div>
        <footer className="bd-footer">
          <p />
          <div className="bd-actions">
            {choices.map((c) => (
              <button key={c.value} ref={c.value === primary ? primaryRef : undefined} type="button" className={c.value === primary ? "bd-button bd-button--primary" : "bd-button"} onClick={() => onDecide(c.value)}>
                {c.label}
              </button>
            ))}
          </div>
        </footer>
      </div>
    </dialog>
  );
}

```

Append at the end of the file:

```tsx

export type DashboardConflictChoice = "server" | "local" | "both";

/** A dashboard changed here and on the server since the last sync (spec: Sync rules). Keep both is the default. */
export function decideDashboardConflict(server: string, name: string, keepBothName: string): Promise<DashboardConflictChoice> {
  return ask<DashboardConflictChoice>((answer) => (
    <WorkspaceChoiceDialog
      title={`"${name}" changed here and on ${server}`}
      lines={[`Keep both adds ${server}'s copy as "${keepBothName}".`]}
      choices={[{ value: "server", label: `Use ${server}` }, { value: "local", label: "Keep local" }, { value: "both", label: "Keep both" }]}
      primary="both"
      onDecide={answer}
    />
  ));
}

/** A dashboard deleted on the server but changed here. Keep as local is the default: it loses nothing. */
export function decideDeletedDashboard(server: string, name: string): Promise<"delete" | "keep"> {
  return ask<"delete" | "keep">((answer) => (
    <WorkspaceChoiceDialog
      title={`"${name}" was deleted on ${server}`}
      lines={["It has changed here since the last sync."]}
      choices={[{ value: "delete", label: "Delete" }, { value: "keep", label: "Keep as local" }]}
      primary="keep"
      onDecide={answer}
    />
  ));
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm -C "$C" exec vitest run src/components/dialogs/WorkspaceDialogs.test.tsx && pnpm -C "$C" exec eslint src/components/dialogs/WorkspaceDialogs.tsx src/components/dialogs/WorkspaceDialogs.test.tsx`
Expected: `16 passed`; eslint is silent.

- [ ] **Step 5: Commit**

```bash
git -C "$C" branch --show-current
git -C "$C" add src/components/dialogs/WorkspaceDialogs.tsx src/components/dialogs/WorkspaceDialogs.test.tsx
git -C "$C" commit -m "feat(v3): dashboard sync conflict questions

Changed on both sides: Use server / Keep local / Keep both (default). Deleted on
the server but changed here: Delete / Keep as local (default).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: The sign-in sync: tombstones, download, decisions, writes, uploads

**Files:**
- Create: `$C/src/components/runDashboardSync.ts`
- Modify: `$C/src/stores/dashboardStore.ts` (adds `applySynced`)
- Modify: `$C/src/components/runWorkspaceSync.ts` (`syncAfterSignIn`)
- Test: `$C/src/components/runDashboardSync.test.ts`, `$C/src/stores/dashboardStore.test.ts`, `$C/src/components/runWorkspaceSync.test.ts`

**Interfaces:**
- Consumes:
  - Task 4/5: `fromWorkspace` and `toWorkspace`.
  - Task 6: `fetchServerStore`, `fetchOwnedDashboards`, `fetchOwnedApps`, `postDashboardItems`, `putApp`, `deleteApp` and the `ServerRecord`/`ServerStore` types.
  - Task 7: `useWorkspaceSyncStore` and `linkFor`.
  - Task 8: `planDashboardSync`, `ServerItem` and `SyncAction`.
  - Task 9: `decideDashboardConflict` and `decideDeletedDashboard`.
  - Task 3: `dedupe`.
  - Existing: `useWorkspaceStore` (`sessions`, `deciding`, `fail`, `setNotice`) and `useFoldersStore.moveDashboard`.
- Produces:
  - `export async function syncDashboards(id: string): Promise<void>`.
  - `export function uploadDashboard(connectionId: string, dashboardId: string): Promise<void>`.
  - The private `postWithRoot`, `sendTombstones` and `report`, which Tasks 11 and 12 reuse in this file.
  - `dashboardStore.applySynced(upserts: Dashboard[], removals: string[]): Promise<void>`.
  - The guarantee that `syncAfterSignIn` calls `syncDashboards(id)` after a successful settings step.

- [ ] **Step 1: Write the failing tests**

Create `$C/src/components/runDashboardSync.test.ts`. Its `fakeServer` is an in-memory Workspace, and every write stamps a later `updated_date`.

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetch } from "@tauri-apps/plugin-http";
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("./dialogs/WorkspaceDialogs", () => ({ decideDashboardConflict: vi.fn(), decideDeletedDashboard: vi.fn() }));
import { __read, __reset } from "../test/memfs";
import { __resetJsonStoreForTests } from "../lib/jsonStore";
import { __resetLoggerForTests } from "../lib/logger";
import { DEFAULT_SETTINGS } from "../lib/settingsFile";
import type { Dashboard, SyncLink } from "../lib/types";
import { useDashboardStore } from "../stores/dashboardStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useWorkspaceSyncStore } from "../stores/workspaceSyncStore";
import { decideDashboardConflict, decideDeletedDashboard } from "./dialogs/WorkspaceDialogs";
import { syncDashboards, uploadDashboard } from "./runDashboardSync";

type Rec = Record<string, unknown>;
const fixture = JSON.parse(readFileSync(resolve(process.cwd(), "src/test/workspace-fama-french.json"), "utf8"));
const ROOT = "aaaaaaaa-0000-4000-8000-000000000001";
const DASH = "aaaaaaaa-0000-4000-8000-000000000002";
const APP = "aaaaaaaa-0000-4000-8000-000000000003";
const conn = { id: "ws1", name: "Work", baseUrl: "https://workspace.example" };
const session = { mode: "login" as const, connection: conn, username: "alice", userId: "11111111-1111-4111-8111-111111111111", token: "synthetic-session", displaySettings: {}, state: "signed-in" as const };
const content = (uuid: string): Rec => structuredClone(fixture.owned[uuid].content);
const local = (id: string, name: string, revision?: number): Dashboard => ({ id, name, tabs: [{ id: `${id}-t`, name: "Main", cards: [] }], ...(revision === undefined ? {} : { revision }) });
const link = (over: Partial<SyncLink> = {}): SyncLink => ({ dashboardId: "d1", connectionId: "ws1", store: "dashboard", uuid: DASH, serverUpdatedDate: "2026-10-11T00:00:00Z", localRevisionAtSync: 2, shared: false, ...over });

/**
 * An in-memory Workspace: GET owned/shared/apps, per-item POST /pro/dash/sync, POST and DELETE
 * /pro/user-apps/{uuid}. Every write stamps a later updated_date. `fail` makes one route answer 500.
 */
function fakeServer(seed: { owned?: Record<string, Rec>; shared?: Record<string, Rec>; apps?: Record<string, Rec> } = {}) {
  let clock = 0;
  const stamp = () => `2026-10-11T00:00:${String(++clock).padStart(2, "0")}Z`;
  const wrap = (c: unknown, updated = "2026-10-11T00:00:00Z") => ({ creator: true, content: c, created_date: "2026-10-01T00:00:00Z", updated_date: updated, created_by: "Example User", is_shared: false });
  const lift = (m: Record<string, Rec> = {}) => Object.fromEntries(Object.entries(m).map(([k, c]) => [k, wrap(c)]));
  const state = { owned: lift(seed.owned), shared: lift(seed.shared), apps: lift(seed.apps), fail: new Set<string>(), requests: [] as string[] };
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    const method = init?.method ?? "GET";
    const path = new URL(String(url)).pathname;
    state.requests.push(`${method} ${path}`);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
    if (state.fail.has(`${method} ${path}`)) return json({ detail: "boom" }, 500);
    if (method === "GET" && path === "/pro/dash/sync/owned") return json({ owned: state.owned });
    if (method === "GET" && path === "/pro/dash/sync/shared") return json({ shared: state.shared, entity_shared: {} });
    if (method === "GET" && path === "/pro/user-apps/sync") {
      return json({ owned: Object.fromEntries(Object.entries(state.apps).map(([k, v]) => [k, { content: v.content, creator: true, is_shared: false, createdDate: v.created_date, updatedDate: v.updated_date, createdBy: "Example User", sharedWith: [] }])), shared: {} });
    }
    if (method === "POST" && path === "/pro/dash/sync") {
      for (const [k, v] of Object.entries(body.items as Rec)) {
        if (v === "DELETE") delete state.owned[k];
        else state.owned[k] = wrap(v, stamp());
      }
      return json({ success: true });
    }
    const app = path.match(/^\/pro\/user-apps\/(.+)$/);
    if (app && method === "POST") {
      state.apps[app[1]] = wrap(body, stamp());
      return json({ success: true });
    }
    if (app && method === "DELETE") {
      if (!state.apps[app[1]]) return json({}, 404);
      delete state.apps[app[1]];
      return json({ success: true });
    }
    return json({ detail: "not found" }, 404);
  });
  return state;
}
const posts = (state: ReturnType<typeof fakeServer>) => state.requests.filter((r) => r.startsWith("POST"));
const dashboards = () => useDashboardStore.getState().dashboards;
const links = () => useWorkspaceSyncStore.getState().links;
const rootChildren = (state: ReturnType<typeof fakeServer>) => (Object.values(state.owned).find((r) => (r.content as Rec).isRoot)?.content as Rec).children as string[];
const serverNames = (state: ReturnType<typeof fakeServer>) => Object.values(state.owned).map((r) => r.content as Rec).filter((c) => !c.isFolder).map((c) => (c.data as Rec).name).sort();

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  vi.mocked(fetch).mockReset();
  vi.mocked(decideDashboardConflict).mockReset();
  vi.mocked(decideDeletedDashboard).mockReset();
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, settingsStorage: "ws1" }, draft: null });
  useWorkspaceStore.setState({ connections: [{ ...conn, serverUrl: conn.baseUrl, askOnStartup: false }], sessions: { ws1: session }, notices: {}, deciding: [] });
  useWorkspaceSyncStore.setState({ links: [], tombstones: [] });
  useWidgetRegistryStore.setState({ widgets: [] });
  useDashboardStore.setState({ dashboards: [local("d1", "Main")], activeId: "d1", activeTabId: "d1-t", viewer: false });
});

describe("syncDashboards: the decision table", () => {
  it("first sync: creates and links the server's dashboards and app, uploads the local one into the root", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH) }, apps: { [APP]: fixture.apps.owned[APP].content } });
    await syncDashboards("ws1");
    expect(dashboards().map((d) => d.name).sort()).toEqual(["Fama-French App", "Fama-French Research Data", "Main"]);
    const famaFrench = dashboards().find((d) => d.name === "Fama-French Research Data")!;
    expect(links()).toEqual(expect.arrayContaining([
      { dashboardId: famaFrench.id, connectionId: "ws1", store: "dashboard", uuid: DASH, serverUpdatedDate: "2026-10-11T00:00:00Z", localRevisionAtSync: 0, shared: false },
      expect.objectContaining({ store: "app", uuid: APP }),
      expect.objectContaining({ dashboardId: "d1", store: "dashboard" }),
    ]));
    const mainUuid = links().find((l) => l.dashboardId === "d1")!.uuid;
    expect(serverNames(server)).toEqual(["Fama-French Research Data", "Main"]);
    expect(rootChildren(server)).toEqual([DASH, mainUuid]);
    expect(JSON.parse(__read("workspaceSync.json") ?? "null").links).toHaveLength(3);
  });

  it("takes the server's copy when only the server changed, keeping the local id", async () => {
    const changed = content(DASH);
    (changed.data as Rec).name = "Renamed on server";
    fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: changed } });
    useWorkspaceSyncStore.setState({ links: [link({ serverUpdatedDate: "older" })] });
    useDashboardStore.setState({ dashboards: [local("d1", "Main", 2)] });
    await syncDashboards("ws1");
    expect(dashboards()).toEqual([expect.objectContaining({ id: "d1", name: "Renamed on server", revision: 2 })]);
    expect(links()).toEqual([link({ serverUpdatedDate: "2026-10-11T00:00:00Z" })]);
  });

  it("uploads when only the local copy changed, back to the same uuid", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH) } });
    useWorkspaceSyncStore.setState({ links: [link()] });
    useDashboardStore.setState({ dashboards: [local("d1", "Edited here", 3)] });
    await syncDashboards("ws1");
    expect(((server.owned[DASH].content as Rec).data as Rec).name).toBe("Edited here");
    expect(links()).toEqual([link({ localRevisionAtSync: 3, serverUpdatedDate: server.owned[DASH].updated_date as string })]);
  });

  it.each([
    ["server", ["Server name"], ["Server name"]],
    ["local", ["Local name"], ["Local name"]],
    ["both", ["Local name", "Server name"], ["Local name", "Server name"]],
  ] as const)("asks when both changed, and %s does what it says", async (choice, localNames, onServer) => {
    const changed = content(DASH);
    (changed.data as Rec).name = "Server name";
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: changed } });
    useWorkspaceSyncStore.setState({ links: [link({ serverUpdatedDate: "older" })] });
    useDashboardStore.setState({ dashboards: [local("d1", "Local name", 3)] });
    vi.mocked(decideDashboardConflict).mockResolvedValueOnce(choice);
    await syncDashboards("ws1");
    expect(decideDashboardConflict).toHaveBeenCalledWith("Work", "Local name", "Server name");
    expect(dashboards().map((d) => d.name).sort()).toEqual(localNames);
    expect(serverNames(server)).toEqual(onServer);
  });

  it("names Keep both's copy by the import ruling's suffix", async () => {
    fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH) } });
    useWorkspaceSyncStore.setState({ links: [link({ serverUpdatedDate: "older" })] });
    useDashboardStore.setState({ dashboards: [local("d1", "Fama-French Research Data", 3)] });
    vi.mocked(decideDashboardConflict).mockResolvedValueOnce("both");
    await syncDashboards("ws1");
    expect(decideDashboardConflict).toHaveBeenCalledWith("Work", "Fama-French Research Data", "Fama-French Research Data (2)");
    expect(dashboards().map((d) => d.name).sort()).toEqual(["Fama-French Research Data", "Fama-French Research Data (2)"]);
  });

  it("deletes the local copy when the server deleted it and it did not change here", async () => {
    fakeServer({ owned: { [ROOT]: content(ROOT) } });
    useWorkspaceSyncStore.setState({ links: [link()] });
    useDashboardStore.setState({ dashboards: [local("d1", "Main", 2), local("d2", "Other")] });
    await syncDashboards("ws1");
    expect(dashboards().map((d) => d.id)).toEqual(["d2"]);
    expect(links().some((l) => l.dashboardId === "d1")).toBe(false);
  });

  it.each([["delete", []], ["keep", ["Main"]]] as const)("asks when the server deleted one that changed here: %s", async (choice, onServer) => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT) } });
    useWorkspaceSyncStore.setState({ links: [link()] });
    useDashboardStore.setState({ dashboards: [local("d1", "Main", 3)] });
    vi.mocked(decideDeletedDashboard).mockResolvedValueOnce(choice);
    await syncDashboards("ws1");
    expect(decideDeletedDashboard).toHaveBeenCalledWith("Work", "Main");
    expect(dashboards().map((d) => d.name)).toEqual(onServer);
    expect(serverNames(server)).toEqual(onServer);
  });

  it("keeps a shared dashboard read-only: downloaded, marked shared, never uploaded", async () => {
    const server = fakeServer({ owned: {}, shared: { [DASH]: content(DASH) } });
    useDashboardStore.setState({ dashboards: [] });
    await syncDashboards("ws1");
    const [shared] = dashboards();
    expect(links()).toEqual([expect.objectContaining({ dashboardId: shared.id, shared: true })]);
    useDashboardStore.setState({ dashboards: [{ ...shared, name: "Edited", revision: 5 }] });
    await syncDashboards("ws1");
    expect(posts(server)).toEqual([]);
  });

  it("reads a hex-keyed server item under its dashed uuid, so the next sync finds its link", async () => {
    fakeServer({ owned: { [ROOT.replace(/-/g, "")]: content(ROOT), [DASH.replace(/-/g, "")]: content(DASH) } });
    useDashboardStore.setState({ dashboards: [] });
    await syncDashboards("ws1");
    await syncDashboards("ws1");
    expect(dashboards()).toHaveLength(1);
    expect(links()).toEqual([expect.objectContaining({ uuid: DASH })]);
  });
});

describe("syncDashboards: tombstones and failures", () => {
  it("sends tombstones first, removing the item and its root entry", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH) } });
    useWorkspaceSyncStore.setState({ tombstones: [{ connectionId: "ws1", store: "dashboard", uuid: DASH }] });
    useDashboardStore.setState({ dashboards: [] });
    await syncDashboards("ws1");
    expect(server.requests.slice(0, 2)).toEqual(["GET /pro/dash/sync/owned", "POST /pro/dash/sync"]);
    expect(server.owned[DASH]).toBeUndefined();
    expect(rootChildren(server)).toEqual([]);
    expect(useWorkspaceSyncStore.getState().tombstones).toEqual([]);
    expect(dashboards()).toEqual([]);
  });

  it("keeps a tombstone that fails and stops, so nothing deleted comes back down", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH) } });
    server.fail.add("POST /pro/dash/sync");
    useWorkspaceSyncStore.setState({ tombstones: [{ connectionId: "ws1", store: "dashboard", uuid: DASH }] });
    useDashboardStore.setState({ dashboards: [] });
    await syncDashboards("ws1");
    expect(useWorkspaceSyncStore.getState().tombstones).toHaveLength(1);
    expect(dashboards()).toEqual([]);
    expect(server.requests).not.toContain("GET /pro/dash/sync/shared");
    expect(useWorkspaceStore.getState().notices.ws1).toMatch(/^Dashboards not synced: .*HTTP 500/);
  });

  it("clears an app tombstone the server answers 404 for", async () => {
    fakeServer({ owned: { [ROOT]: content(ROOT) } });
    useWorkspaceSyncStore.setState({ tombstones: [{ connectionId: "ws1", store: "app", uuid: APP }] });
    await syncDashboards("ws1");
    expect(useWorkspaceSyncStore.getState().tombstones).toEqual([]);
  });

  it("stays settings-only, silently, when the server keeps no dashboards", async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response("{}", { status: 404 }));
    await syncDashboards("ws1");
    expect(dashboards().map((d) => d.id)).toEqual(["d1"]);
    expect(__read("workspaceSync.json")).toBeUndefined();
    expect(useWorkspaceStore.getState().notices).toEqual({});
  });

  it("writes nothing when one server item cannot be read", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH), [APP]: { isFolder: false, data: { name: "Broken" } } } });
    await syncDashboards("ws1");
    expect(dashboards().map((d) => d.id)).toEqual(["d1"]);
    expect(__read("workspaceSync.json")).toBeUndefined();
    expect(posts(server)).toEqual([]);
    expect(useWorkspaceStore.getState().notices.ws1).toBe("Dashboards not synced: The server's dashboards could not be read; local dashboards are unchanged.");
  });

  it("expires the session on a 401 and writes nothing", async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response("{}", { status: 401 }));
    await syncDashboards("ws1");
    expect(useWorkspaceStore.getState().sessions.ws1.state).toBe("expired");
    expect(dashboards().map((d) => d.id)).toEqual(["d1"]);
  });
});

describe("uploads", () => {
  it("puts every new dashboard into the root, even uploading at once and after another device added one", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH) } });
    useWorkspaceSyncStore.setState({ links: [link({ serverUpdatedDate: "older" })] });
    useDashboardStore.setState({ dashboards: [local("d1", "Main", 3), local("d2", "Second"), local("d3", "Third")] });
    // While the question is open, another device adds a dashboard to the root.
    vi.mocked(decideDashboardConflict).mockImplementationOnce(async () => {
      (server.owned[ROOT].content as Rec).children = [DASH, "elsewhere"];
      return "local";
    });
    await syncDashboards("ws1");
    const uuids = ["d2", "d3"].map((id) => links().find((l) => l.dashboardId === id)!.uuid);
    expect(rootChildren(server)).toEqual([DASH, "elsewhere", ...uuids]);
  });

  it("sends a save made while a question was open, once the sync finishes", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH) } });
    useWorkspaceSyncStore.setState({ links: [link({ serverUpdatedDate: "older" }), link({ dashboardId: "d2", uuid: "bbbbbbbb-0000-4000-8000-0000000000aa" })] });
    server.owned["bbbbbbbb-0000-4000-8000-0000000000aa"] = { ...server.owned[DASH], content: { ...content(DASH), index: "bbbbbbbb-0000-4000-8000-0000000000aa" }, updated_date: "2026-10-11T00:00:00Z" };
    useDashboardStore.setState({ dashboards: [local("d1", "Main", 3), local("d2", "Other", 2)] });
    vi.mocked(decideDashboardConflict).mockImplementationOnce(async () => {
      await useDashboardStore.getState().renameDashboard("d2", "Renamed meanwhile");
      return "server";
    });
    await syncDashboards("ws1");
    expect(((server.owned["bbbbbbbb-0000-4000-8000-0000000000aa"].content as Rec).data as Rec).name).toBe("Renamed meanwhile");
  });

  it("uploads an edited app through /pro/user-apps/{uuid}", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT) }, apps: { [APP]: fixture.apps.owned[APP].content } });
    useWorkspaceSyncStore.setState({ links: [link({ store: "app", uuid: APP })] });
    useDashboardStore.setState({ dashboards: [{ ...local("d1", "App edited here", 3) }] });
    await syncDashboards("ws1");
    expect(server.requests).toContain(`POST /pro/user-apps/${APP}`);
    expect((server.apps[APP].content as Rec).name).toBe("App edited here");
  });

  it("sends nothing to an expired session, or while it is deciding", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT) } });
    useWorkspaceStore.setState({ deciding: ["ws1"] });
    await uploadDashboard("ws1", "d1");
    useWorkspaceStore.setState({ deciding: [], sessions: { ws1: { ...session, state: "expired" } } });
    await uploadDashboard("ws1", "d1");
    expect(server.requests).toEqual([]);
  });
});
```

Append to `$C/src/stores/dashboardStore.test.ts`:

```ts

describe("applySynced", () => {
  it("replaces by id without a revision bump, appends new ones, reopens a replaced active dashboard, and removes", async () => {
    const d = (id: string, tab: string, revision?: number): Dashboard => ({ id, name: id, tabs: [{ id: tab, name: "Main", cards: [] }], ...(revision === undefined ? {} : { revision }) });
    useDashboardStore.setState({ dashboards: [d("d1", "t1", 4), d("d2", "t2")], activeId: "d1", activeTabId: "t1" });
    await useDashboardStore.getState().applySynced([d("d1", "t9", 4), d("d3", "t3")], ["d2"]);
    expect(useDashboardStore.getState().dashboards.map((x) => [x.id, x.revision, x.tabs[0].id])).toEqual([["d1", 4, "t9"], ["d3", undefined, "t3"]]);
    expect(useDashboardStore.getState().activeTabId).toBe("t9");
    expect(JSON.parse(__read("dashboards/d1.json") ?? "null").revision).toBe(4);
    expect(__read("dashboards/d2.json")).toBeUndefined();
  });

  it("is refused in the viewer", async () => {
    useDashboardStore.setState({ dashboards: [], viewer: true });
    await useDashboardStore.getState().applySynced([{ id: "d1", name: "d1", tabs: [] }], []);
    expect(useDashboardStore.getState().dashboards).toEqual([]);
  });
});
```

In `$C/src/components/runWorkspaceSync.test.ts`:
- Add this under the existing `vi.mock("./dialogs/WorkspaceDialogs", …)` line:

```ts
// The dashboard half has its own suite (runDashboardSync.test.ts); here it only has to be called at the right time.
vi.mock("./runDashboardSync", () => ({ syncDashboards: vi.fn() }));
```

- Add `import { syncDashboards } from "./runDashboardSync";` after the `./runWorkspaceSync` import.
- Add `vi.mocked(syncDashboards).mockReset();` in `beforeEach` after `vi.mocked(decideWorkspaceConflict).mockReset();`.
- Add this as the first test inside `describe("syncAfterSignIn", …)`:

```ts
  it("syncs dashboards after a successful settings step, and not after a refused one", async () => {
    expect(await syncAfterSignIn("ws1")).toBe(true);
    expect(syncDashboards).toHaveBeenCalledWith("ws1");
    vi.mocked(syncDashboards).mockClear();
    useWorkspaceStore.setState({ sessions: { ws1: entry({ theme: "purple" }) } });
    expect(await syncAfterSignIn("ws1")).toBe(false);
    expect(syncDashboards).not.toHaveBeenCalled();
  });
```

Without that module mock, the existing "asking nothing and calling nothing" tests would see the dashboard GETs. The mock keeps them as they are; do not loosen them.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm -C "$C" exec vitest run src/components/runDashboardSync.test.ts src/stores/dashboardStore.test.ts src/components/runWorkspaceSync.test.ts`
Expected: FAIL. `./runDashboardSync` cannot be resolved, and `applySynced` is not a function.

- [ ] **Step 3: Implement `applySynced`.** In `$C/src/stores/dashboardStore.ts`:

Add this to `DashboardState`, after `setGroupsDisabled`:

```ts
  /**
   * The dashboard sync's writes: `upserts` replace by id or are appended,
   * `removals` go through removeDashboard. No revision bump -- these ARE the
   * synced state. Refused in the viewer, where sync never runs.
   */
  applySynced: (upserts: Dashboard[], removals: string[]) => Promise<void>;
```

Add this to the store, directly before `setGroupsDisabled: async (id, disabled) => {`:

```ts
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
```

- [ ] **Step 4: Implement the engine.** Create `$C/src/components/runDashboardSync.ts`:

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

import { dedupe } from "../lib/appsJson";
import { planDashboardSync, type ServerItem, type SyncAction } from "../lib/dashboardSyncPlan";
import { isRecord } from "../lib/isRecord";
import { logError, logInfo } from "../lib/logger";
import { serialize } from "../lib/serialize";
import type { Dashboard, SyncLink, SyncStore } from "../lib/types";
import {
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
import { useDashboardStore } from "../stores/dashboardStore";
import { useFoldersStore } from "../stores/foldersStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
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
      const children = found.children.filter((c) => c !== root.remove);
      if (root.add !== undefined && !children.includes(root.add)) children.push(root.add);
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
      const sent = t.store === "app" ? await deleteApp(session, t.uuid) : await postWithRoot(session, () => ({ [t.uuid]: "DELETE" }), { remove: t.uuid });
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

const sameItem = (a: SyncLink, b: SyncLink) => a.connectionId === b.connectionId && a.store === b.store && a.uuid === b.uuid;

/**
 * Ask what needs asking, then write: dashboards first, links after. Uploads
 * ("upload", "uploadNew", Keep local, Keep both's local copy, Keep as local)
 * are not sent here -- uploadPending sends every dashboard whose revision
 * moved or that has no link, once these writes are in.
 */
async function apply(session: WorkspaceSession, actions: SyncAction[]): Promise<void> {
  const id = session.connection.id;
  const server = session.connection.name;
  const local = useDashboardStore.getState().dashboards;
  const names = new Set(local.map((d) => d.name));
  const upserts: Dashboard[] = [];
  const removals: string[] = [];
  const added: SyncLink[] = [];
  const dropped: SyncLink[] = [];
  const linkTo = (item: ServerItem, dashboard: Dashboard): SyncLink => ({
    dashboardId: dashboard.id, connectionId: id, store: item.store, uuid: item.uuid,
    serverUpdatedDate: item.updated, localRevisionAtSync: dashboard.revision ?? 0, shared: item.shared,
  });
  const take = (link: SyncLink, item: ServerItem) => {
    const current = local.find((d) => d.id === link.dashboardId);
    const next: Dashboard = { ...item.dashboard, id: link.dashboardId, revision: current?.revision };
    upserts.push(next);
    added.push(linkTo(item, next));
  };
  const nameOf = (link: SyncLink) => local.find((d) => d.id === link.dashboardId)?.name ?? link.uuid;
  for (const action of actions) {
    if (action.kind === "take") take(action.link, action.item);
    else if (action.kind === "create") {
      names.add(action.item.dashboard.name);
      upserts.push(action.item.dashboard);
      added.push(linkTo(action.item, action.item.dashboard));
    } else if (action.kind === "deleteLocal") {
      removals.push(action.link.dashboardId);
      dropped.push(action.link);
    } else if (action.kind === "dropLink") dropped.push(action.link);
    else if (action.kind === "conflict") {
      // The 2026-10-03 import ruling: Keep both suffixes the incoming copy, first unused " (n)".
      const keepBoth = dedupe(action.item.dashboard.name, new Set(names));
      const choice = await decideDashboardConflict(server, nameOf(action.link), keepBoth);
      if (choice === "server") take(action.link, action.item);
      else if (choice === "both") {
        const copy = { ...action.item.dashboard, name: dedupe(action.item.dashboard.name, names) };
        upserts.push(copy);
        added.push(linkTo(action.item, copy)); // the server item now belongs to the copy; the local one goes up as new
      }
    } else if (action.kind === "deletedConflict") {
      if ((await decideDeletedDashboard(server, nameOf(action.link))) === "delete") removals.push(action.link.dashboardId);
      dropped.push(action.link); // Keep as local: unlinked, so it goes up as a new dashboard
    }
  }
  await useDashboardStore.getState().applySynced(upserts, removals);
  for (const removed of removals) await useFoldersStore.getState().moveDashboard(removed, null);
  await useWorkspaceSyncStore.getState().update((f) => ({
    ...f,
    links: [...f.links.filter((l) => !dropped.some((d) => sameItem(d, l) && d.dashboardId === l.dashboardId) && !added.some((a) => sameItem(a, l))), ...added],
  }));
}

/**
 * Upload one dashboard (spec: Sync rules step 4; While signed in): an
 * update of its linked item, or a new dashboard item when it has no link.
 * Serialized per dashboard. Nothing goes to a session that is not signed
 * in or is deciding, nor for a shared dashboard, nor when the revision has
 * not moved. A failed upload leaves the link alone, so the next save or
 * sign-in sends it again. POST returns no date, so the item's new
 * updated_date is read back.
 */
export function uploadDashboard(connectionId: string, dashboardId: string): Promise<void> {
  return serialize(`workspace:dash:${connectionId}:${dashboardId}`, async () => {
    const ws = useWorkspaceStore.getState();
    const session = ws.sessions[connectionId];
    if (session === undefined || session.state !== "signed-in" || ws.deciding.includes(connectionId)) return;
    const dashboard = useDashboardStore.getState().dashboards.find((d) => d.id === dashboardId);
    if (dashboard === undefined) return;
    const link = linkFor(useWorkspaceSyncStore.getState().links, connectionId, dashboardId);
    const revision = dashboard.revision ?? 0;
    if (link?.shared || (link !== undefined && revision === link.localRevisionAtSync)) return;
    const store: SyncStore = link?.store ?? "dashboard";
    const uuid = link?.uuid ?? crypto.randomUUID();
    const sent = store === "app"
      ? await putApp(session, uuid, toWorkspace(dashboard, "app"))
      : await postWithRoot(session, (parentId) => ({ [uuid]: toWorkspace(dashboard, "dashboard", { index: uuid, parentId }) }), link ? {} : { add: uuid });
    // Signed out, or connected again, meanwhile: this result belongs to a session that is gone.
    if (useWorkspaceStore.getState().sessions[connectionId] !== session) return;
    if (!sent.ok) return report(connectionId, sent);
    if (sent.value === "absent") return logInfo(`${session.connection.name} keeps no ${store}s; ${dashboard.name} stays local`);
    const listed = store === "app" ? await fetchOwnedApps(session) : await fetchOwnedDashboards(session);
    const serverUpdatedDate = (listed.ok && listed.value?.[uuid]?.updated) || "";
    const next: SyncLink = { dashboardId, connectionId, store, uuid, serverUpdatedDate, localRevisionAtSync: revision, shared: false };
    await useWorkspaceSyncStore.getState().update((f) => ({ ...f, links: [...f.links.filter((l) => !(sameItem(l, next) || (l.connectionId === connectionId && l.dashboardId === dashboardId && !l.dismissed))), next] }));
    await logInfo(`uploaded ${store} ${dashboard.name} (${uuid}) to ${session.connection.name}`);
  });
}

/** Every dashboard that needs sending after a sync: uploadDashboard itself skips the unchanged and the shared. */
function uploadPending(id: string): Promise<unknown> {
  return Promise.all(useDashboardStore.getState().dashboards.map((d) => uploadDashboard(id, d.id)));
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
export async function syncDashboards(id: string): Promise<void> {
  const session = useWorkspaceStore.getState().sessions[id];
  if (session === undefined || session.state !== "signed-in") return;
  useWorkspaceStore.setState((s) => ({ deciding: [...s.deciding, id] }));
  let synced = false;
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
    await apply(session, planDashboardSync(id, useWorkspaceSyncStore.getState().links, useDashboardStore.getState().dashboards, items));
    synced = true;
  } finally {
    useWorkspaceStore.setState((s) => ({ deciding: s.deciding.filter((x) => x !== id) }));
  }
  if (synced) await uploadPending(id);
}
```

- [ ] **Step 5: Hook it into the sign-in sync.** In `$C/src/components/runWorkspaceSync.ts`, add `import { syncDashboards } from "./runDashboardSync";` after the `WorkspaceDialogs` import. Then split `syncAfterSignIn`: its current body becomes the private `syncSettings`, unchanged, and the exported function wraps it. The doc comment above stays on `syncAfterSignIn`.

```ts
export async function syncAfterSignIn(id: string, alsoSave: Partial<Settings> = {}): Promise<boolean> {
  const synced = await syncSettings(id, alsoSave);
  // Dashboards follow a successful settings step (spec: On sign-in); their own failures show on the connection.
  if (synced) await syncDashboards(id);
  return synced;
}

async function syncSettings(id: string, alsoSave: Partial<Settings>): Promise<boolean> {
  const session = useWorkspaceStore.getState().sessions[id];
  // … the rest of the former syncAfterSignIn body, unchanged …
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `pnpm -C "$C" exec vitest run src/components/runDashboardSync.test.ts src/stores/dashboardStore.test.ts src/components/runWorkspaceSync.test.ts && pnpm -C "$C" exec tsc --noEmit -p . && pnpm -C "$C" exec eslint src/components/runDashboardSync.ts src/components/runDashboardSync.test.ts src/components/runWorkspaceSync.ts src/components/runWorkspaceSync.test.ts src/stores/dashboardStore.ts`
Expected: everything passes, including 22 tests in `runDashboardSync.test.ts`. To confirm Review Focus 1 bites, replace `serialize(\`workspace:root:…\`, async …)` in `postWithRoot` with a bare async IIFE: "puts every new dashboard into the root…" must then fail. Put it back afterwards.

- [ ] **Step 7: Commit**

```bash
git -C "$C" branch --show-current
git -C "$C" add src/components/runDashboardSync.ts src/components/runDashboardSync.test.ts src/stores/dashboardStore.ts src/stores/dashboardStore.test.ts src/components/runWorkspaceSync.ts src/components/runWorkspaceSync.test.ts
git -C "$C" commit -m "feat(v3): sync dashboards and apps on sign-in

After the settings step: tombstones first (a failure keeps them and stops),
one all-or-nothing download of owned/shared/apps, the decision table with its
two questions, local writes, then uploads -- new dashboards join the root
folder, re-read and serialized per connection. 404 stays settings-only; a
login 401 expires the session; other failures show on the connection.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: Debounced upload while signed in

**Files:**
- Modify: `$C/src/components/runDashboardSync.ts`
- Modify: `$C/src/lib/bootstrap.ts`
- Test: `$C/src/components/runDashboardSync.test.ts`

**Interfaces:**
- Consumes: from Task 10, `uploadDashboard`; `linkFor`; `useSettingsStore` (`settings.settingsStorage`); `useDashboardStore.subscribe`.
- Produces: `export const UPLOAD_DEBOUNCE_MS = 1500` and `export function startDashboardAutoUpload(): () => void`. bootstrap calls it in the main window only and loads `workspaceSync.json`.

- [ ] **Step 1: Write the failing tests.** In `$C/src/components/runDashboardSync.test.ts`, change the module import to `import { startDashboardAutoUpload, syncDashboards, UPLOAD_DEBOUNCE_MS, uploadDashboard } from "./runDashboardSync";`, then append:

```ts

describe("startDashboardAutoUpload", () => {
  it("uploads a linked dashboard once, after a burst of saves settles", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH) } });
    useWorkspaceSyncStore.setState({ links: [link()] });
    useDashboardStore.setState({ dashboards: [local("d1", "Main", 2)] });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const stop = startDashboardAutoUpload();
    try {
      await useDashboardStore.getState().renameDashboard("d1", "One");
      await useDashboardStore.getState().renameDashboard("d1", "Two");
      await vi.advanceTimersByTimeAsync(UPLOAD_DEBOUNCE_MS - 1);
      expect(posts(server)).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
    } finally {
      vi.useRealTimers();
      stop();
    }
    await vi.waitFor(() => expect(((server.owned[DASH].content as Rec).data as Rec).name).toBe("Two"));
    expect(posts(server)).toEqual(["POST /pro/dash/sync"]);
  });

  it.each([
    ["an unlinked dashboard", () => {}],
    ["a shared dashboard", () => useWorkspaceSyncStore.setState({ links: [link({ shared: true })] })],
    ["a dashboard when settings are local", () => {
      useWorkspaceSyncStore.setState({ links: [link()] });
      useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
    }],
  ])("never uploads %s", async (_, arrange) => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH) } });
    useDashboardStore.setState({ dashboards: [local("d1", "Main", 2)] });
    arrange();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const stop = startDashboardAutoUpload();
    try {
      await useDashboardStore.getState().renameDashboard("d1", "Renamed");
      await vi.advanceTimersByTimeAsync(UPLOAD_DEBOUNCE_MS);
    } finally {
      vi.useRealTimers();
      stop();
    }
    expect(server.requests).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm -C "$C" exec vitest run src/components/runDashboardSync.test.ts`
Expected: FAIL, because `startDashboardAutoUpload` is not a function.

- [ ] **Step 3: Implement.** In `$C/src/components/runDashboardSync.ts`, add `import { useSettingsStore } from "../stores/settingsStore";` after the `foldersStore` import, then append:

```ts

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
  return useDashboardStore.subscribe((state, prev) => {
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
}
```

In `$C/src/lib/bootstrap.ts`:
- Add `import { startDashboardAutoUpload } from "../components/runDashboardSync";` after the `runWorkspaceSync` import.
- Add `import { useWorkspaceSyncStore } from "../stores/workspaceSyncStore";` after the `workspaceStore` import.
- Add this as the last entry of the `Promise.all([...])` that loads `workspace.json`:

```ts
      // workspaceSync.json: dashboard links and pending server deletes.
      useWorkspaceSyncStore
        .getState()
        .load()
        .catch((err: unknown) => logError(`failed to load workspaceSync.json: ${err}`)),
```

- Directly above `if (viewerId === null) void runStartupPrompt()…`, add:

```ts
    if (viewerId === null) startDashboardAutoUpload();
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm -C "$C" exec vitest run src/components/runDashboardSync.test.ts src/lib/bootstrap.test.ts && pnpm -C "$C" exec eslint src/components/runDashboardSync.ts src/lib/bootstrap.ts`
Expected: everything passes, including 26 tests in `runDashboardSync.test.ts`.

- [ ] **Step 5: Commit**

```bash
git -C "$C" branch --show-current
git -C "$C" add src/components/runDashboardSync.ts src/components/runDashboardSync.test.ts src/lib/bootstrap.ts
git -C "$C" commit -m "feat(v3): upload a synced dashboard after its saves settle

A moved revision on a linked, non-shared dashboard queues one upload after
1.5 s; nothing goes to an expired, not-synced or deciding session. Main window
only; workspaceSync.json loads at launch.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 12: Delete from the rail, and the shared marker

**Files:**
- Modify: `$C/src/components/runDashboardSync.ts`
- Modify: `$C/src/components/LeftRail.tsx` (imports; the `removeDashboard` selector at line ~119; `removeDashboardConfirm` at line ~243; the dashboard row label at line ~592)
- Test: `$C/src/components/runDashboardSync.test.ts`, `$C/src/components/LeftRail.sync.test.tsx`

**Interfaces:**
- Consumes: from Task 10, `sendTombstones` and `report`; `toSettingsConnections` from `workspaceStore`; `useBackendsStore`.
- Produces: `export function deleteTargets(dashboardId: string): string[]` and `export async function deleteSyncedDashboard(dashboardId: string): Promise<void>`. The rail uses both.

- [ ] **Step 1: Write the failing tests.** In `$C/src/components/runDashboardSync.test.ts`, change the module import to `import { deleteSyncedDashboard, startDashboardAutoUpload, syncDashboards, UPLOAD_DEBOUNCE_MS, uploadDashboard } from "./runDashboardSync";`, then append:

```ts

describe("deleteSyncedDashboard", () => {
  it("signed in: deletes here, then on the server with its root entry, and clears the tombstone", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH) } });
    useWorkspaceSyncStore.setState({ links: [link()] });
    await deleteSyncedDashboard("d1");
    expect(dashboards()).toEqual([]);
    expect(server.owned[DASH]).toBeUndefined();
    expect(rootChildren(server)).toEqual([]);
    expect(useWorkspaceSyncStore.getState()).toMatchObject({ links: [], tombstones: [] });
  });

  it("signed out: deletes here at once and leaves a tombstone on disk for the next sign-in", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH) } });
    useWorkspaceStore.setState({ sessions: {} });
    useWorkspaceSyncStore.setState({ links: [link()] });
    await deleteSyncedDashboard("d1");
    expect(dashboards()).toEqual([]);
    expect(server.requests).toEqual([]);
    expect(JSON.parse(__read("workspaceSync.json") ?? "null")).toEqual({ links: [], tombstones: [{ connectionId: "ws1", store: "dashboard", uuid: DASH }] });
  });

  it("shared: deletes only the local copy and dismisses the link", async () => {
    const server = fakeServer({ owned: {}, shared: { [DASH]: content(DASH) } });
    useWorkspaceSyncStore.setState({ links: [link({ shared: true })] });
    await deleteSyncedDashboard("d1");
    expect(server.requests).toEqual([]);
    expect(useWorkspaceSyncStore.getState()).toMatchObject({ links: [link({ shared: true, dismissed: true })], tombstones: [] });
    await syncDashboards("ws1");
    expect(dashboards()).toEqual([]);
  });
});
```

Create `$C/src/components/LeftRail.sync.test.tsx`. It is a separate file because `LeftRail.test.tsx`'s existing delete tests must keep running the real store unmocked.

```tsx
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: vi.fn(), save: vi.fn(), open: vi.fn() }));
import { confirm } from "@tauri-apps/plugin-dialog";
import { __reset } from "../test/memfs";
import { __resetJsonStoreForTests } from "../lib/jsonStore";
import { __resetLoggerForTests } from "../lib/logger";
import { DEFAULT_SETTINGS } from "../lib/settingsFile";
import type { SyncLink } from "../lib/types";
import { useDashboardStore } from "../stores/dashboardStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useWorkspaceSyncStore } from "../stores/workspaceSyncStore";
import { LeftRail } from "./LeftRail";

const link = (over: Partial<SyncLink> = {}): SyncLink => ({ dashboardId: "d1", connectionId: "ws1", store: "dashboard", uuid: "aaaaaaaa-0000-4000-8000-000000000002", serverUpdatedDate: "t", localRevisionAtSync: 0, shared: false, ...over });
const rail = () => render(<LeftRail onOpenLibrary={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  vi.mocked(confirm).mockReset();
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
  useWorkspaceStore.setState({ connections: [{ id: "ws1", name: "Work", serverUrl: "https://workspace.example", askOnStartup: false }], sessions: {}, deciding: [] });
  useDashboardStore.setState({ dashboards: [{ id: "d1", name: "Main", tabs: [{ id: "t1", name: "Main", cards: [] }] }, { id: "d2", name: "Second", tabs: [] }], activeId: "d1", activeTabId: "t1", viewer: false });
  useWorkspaceSyncStore.setState({ links: [], tombstones: [] });
});

describe("LeftRail and dashboard sync", () => {
  it("names the server in a synced dashboard's delete confirm, and deletes through the sync", async () => {
    useWorkspaceSyncStore.setState({ links: [link()] });
    vi.mocked(confirm).mockResolvedValue(true);
    rail();
    fireEvent.contextMenu(screen.getByRole("button", { name: /Main/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(useDashboardStore.getState().dashboards.map((d) => d.id)).toEqual(["d2"]));
    expect(confirm).toHaveBeenCalledWith('Delete "Main" here and on Work?', expect.objectContaining({ title: "Delete dashboard" }));
    expect(useWorkspaceSyncStore.getState().tombstones).toEqual([{ connectionId: "ws1", store: "dashboard", uuid: link().uuid }]);
  });

  it("marks a shared dashboard, and confirms its delete as a local one", async () => {
    useWorkspaceSyncStore.setState({ links: [link({ shared: true })] });
    vi.mocked(confirm).mockResolvedValue(false);
    rail();
    expect(screen.getByText("Main · shared")).toBeInTheDocument();
    fireEvent.contextMenu(screen.getByRole("button", { name: /Main/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith('Delete dashboard "Main"?', expect.anything()));
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm -C "$C" exec vitest run src/components/runDashboardSync.test.ts src/components/LeftRail.sync.test.tsx`
Expected: FAIL. `deleteSyncedDashboard` is not a function, and the confirm text is still `Delete dashboard "Main"?`.

- [ ] **Step 3: Implement the delete.** In `$C/src/components/runDashboardSync.ts`:
- Add `import { useBackendsStore } from "../stores/backendsStore";` before the `dashboardStore` import.
- Change the workspaceStore import to `import { toSettingsConnections, useWorkspaceStore } from "../stores/workspaceStore";`.
- Append:

```ts

/** The servers a rail delete of this dashboard also deletes it from: its live, non-shared links' connections, by name. */
export function deleteTargets(dashboardId: string): string[] {
  const list = toSettingsConnections(useWorkspaceStore.getState().connections, useBackendsStore.getState().backends);
  return useWorkspaceSyncStore.getState().links
    .filter((l) => l.dashboardId === dashboardId && !l.shared && !l.dismissed)
    .map((l) => list.find((c) => c.id === l.connectionId)?.name ?? l.connectionId);
}

/**
 * The rail's delete (spec: Delete from the rail). Each non-shared link
 * becomes a tombstone BEFORE the local delete, so a crash between the two
 * can only delete on the server later, never lose the delete; a shared link
 * is kept as dismissed, so the next sync does not download it again. Then
 * the local delete, at once. Then each signed-in connection is sent its
 * tombstones now; the rest go at the next sign-in.
 */
export async function deleteSyncedDashboard(dashboardId: string): Promise<void> {
  const live = useWorkspaceSyncStore.getState().links.filter((l) => l.dashboardId === dashboardId && !l.dismissed);
  if (live.length > 0) {
    await useWorkspaceSyncStore.getState().update((f) => ({
      links: f.links.flatMap((l) => (l.dashboardId !== dashboardId || l.dismissed ? [l] : l.shared ? [{ ...l, dismissed: true }] : [])),
      tombstones: [...f.tombstones, ...live.filter((l) => !l.shared).map(({ connectionId, store, uuid }) => ({ connectionId, store, uuid }))],
    }));
  }
  await useDashboardStore.getState().removeDashboard(dashboardId);
  for (const id of new Set(live.filter((l) => !l.shared).map((l) => l.connectionId))) {
    const ws = useWorkspaceStore.getState();
    const session = ws.sessions[id];
    if (session?.state !== "signed-in" || ws.deciding.includes(id)) continue;
    const sent = await sendTombstones(session);
    if (!sent.ok) await report(id, sent);
  }
}
```

- [ ] **Step 4: Wire the rail.** In `$C/src/components/LeftRail.tsx`:
- Add `import { useWorkspaceSyncStore } from "../stores/workspaceSyncStore";` after the `widgetRegistryStore` import.
- Add `import { deleteSyncedDashboard, deleteTargets } from "./runDashboardSync";` after the `runAppsImport` import.
- Replace the line `const removeDashboard = useDashboardStore((s) => s.removeDashboard);` with:

```tsx
  // Shared dashboards are read-only copies of someone else's: the rail marks them.
  const syncLinks = useWorkspaceSyncStore((s) => s.links);
  const sharedIds = new Set(syncLinks.filter((l) => l.shared && !l.dismissed).map((l) => l.dashboardId));
```

- In `removeDashboardConfirm`, replace the `confirmDelete(` call's first argument and the `await removeDashboard(id);` line, so that it reads:

```tsx
  async function removeDashboardConfirm(id: string, name: string) {
    setMenuAt(null);
    // A synced dashboard says where else it goes (spec: Delete from the rail).
    const servers = deleteTargets(id);
    const message = servers.length > 0 ? `Delete "${name}" here and on ${servers.join(" and ")}?` : `Delete dashboard "${name}"?`;
    await confirmDelete(message, "Delete dashboard", `remove dashboard ${id}`, async () => {
      await deleteSyncedDashboard(id);
      // Its folder placement goes with it, or folders.json keeps the id for
      // good. Placing at the top level is exactly "no entry".
      await moveDashboard(id, null);
    });
  }
```

- In the dashboard row, replace `<span className="rail-item-label">{d.name}</span>` with:

```tsx
        <span className="rail-item-label">{sharedIds.has(d.id) ? `${d.name} · shared` : d.name}</span>
```

`deleteSyncedDashboard` calls `useDashboardStore.getState().removeDashboard`, so `LeftRail.test.tsx`'s test that swaps in a rejecting `removeDashboard` still sees its rejection logged.

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm -C "$C" exec vitest run src/components/runDashboardSync.test.ts src/components/LeftRail.sync.test.tsx src/components/LeftRail.test.tsx && pnpm -C "$C" exec tsc --noEmit -p . && pnpm -C "$C" exec eslint src/components/runDashboardSync.ts src/components/LeftRail.tsx src/components/LeftRail.sync.test.tsx`
Expected: everything passes (29 + 2 + 96 tests); tsc and eslint are silent.

- [ ] **Step 6: Commit**

```bash
git -C "$C" branch --show-current
git -C "$C" add src/components/runDashboardSync.ts src/components/runDashboardSync.test.ts src/components/LeftRail.tsx src/components/LeftRail.sync.test.tsx
git -C "$C" commit -m "feat(v3): a rail delete also deletes the dashboard on its server

The confirm names the server; a tombstone is written before the local delete
and sent at once when signed in, otherwise at the next sign-in. A shared
dashboard's delete is local and dismisses it for good; the rail marks shared
dashboards.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

# Part C: Verification

### Task 13: Full suites, the local key-mode container, and the user's Workspace checklist

**Files:** none changed, unless a step finds a defect. In that case fix it under superpowers:systematic-debugging, with its own failing test and commit, then rerun this task.

- [ ] **Step 1: Client gates.** Check the host load with `uptime` first. A load far above the core count makes the unit suite time out; wait, or rerun the timed-out files alone.

```bash
C=~/Developer/adventures-in-openbb-articles/openbq-relaunch/bdobb/.worktrees/v3-dashboard-sync
pnpm -C "$C" exec vitest run
pnpm -C "$C" exec tsc --noEmit -p .
pnpm -C "$C" lint
pnpm -C "$C" scrub
```

Expected:
- vitest: every file passes. When this plan was written, the scratch build reached 157 passed and 1 skipped file, with 3185 tests passing.
- tsc and lint: silent.
- scrub: reports clean.

- [ ] **Step 2: Backend gates**

```bash
B=~/Developer/adventures-in-openbb-articles/openbq-relaunch/openbq-docker-v3-dashsync
PY=~/Developer/OpenBB/.venv/bin/python
"$PY" -m pytest "$B/v3/tests" -q
(cd "$B" && python3 scripts/check-public.py)
```

Expected: `30 passed`, and check-public exits 0.

- [ ] **Step 3: Key mode, live, in a local container with auth on.** Generate a throwaway test credential. It is never committed and never pasted into chat.

```bash
B=~/Developer/adventures-in-openbb-articles/openbq-relaunch/openbq-docker-v3-dashsync
docker build -f "$B/Dockerfile.v3" -t openbq-local:3.0.0-dashsync "$B"
PW=$(openssl rand -hex 16)
docker run -d --name openbq-dashsync -p 127.0.0.1:6901:6900 \
  -e OPENBB_API_AUTH=true -e OPENBB_API_USERNAME=bdobb -e OPENBB_API_PASSWORD="$PW" \
  -e OPENBQ_SETTINGS_DIR=/tmp/bdobb-settings openbq-local:3.0.0-dashsync
until curl -fsS -o /dev/null -w '%{http_code}' -u "bdobb:$PW" http://127.0.0.1:6901/pro/user | grep -q 200; do sleep 5; done
python3 "$B/scripts/verify-settings.py" http://127.0.0.1:6901 bdobb "$PW"
python3 "$B/scripts/verify-dashboards.py" http://127.0.0.1:6901 bdobb "$PW"
curl -s -o /dev/null -w '%{http_code}\n' -u "bdobb:$PW" http://127.0.0.1:6901/pro/dash/sync/owned   # 200
```

Expected: `{"settings_checks": 8, "status": "passed"}` and `{"dashboard_checks": 12, "status": "passed"}`.

Then run BDOBB against it. Start `pnpm -C "$C" dev`. If you drive it by computer use, the backend is on loopback and the credential is a test value, which is allowed for the user's own application. Then:

1. Connections → add a data backend. Address `http://localhost:6901`, Key `Authorization`, Value `Basic <base64 of bdobb:$PW>`; compute the value with `printf 'bdobb:%s' "$PW" | base64`.
2. Settings → General → User Settings → Server → pick that backend. The settings step runs, then the dashboard sync.
3. Check that every local dashboard is now on the server:

```bash
curl -s -u "bdobb:$PW" http://127.0.0.1:6901/pro/dash/sync/owned | python3 -c 'import json,sys; o=json.load(sys.stdin)["owned"]; print(sorted(v["content"].get("data",{}).get("name","<folder>") for v in o.values()))'
```

4. Rename a dashboard in BDOBB, wait 2 s, and rerun the curl: the new name shows.
5. POST a dashboard from outside (copy the `content` block from `verify-dashboards.py`, with a fresh uuid and name "From the server"). Quit and relaunch BDOBB, so the launch sequence connects and syncs: "From the server" appears in the rail.
6. Rail → Delete "From the server". The confirm reads `Delete "From the server" here and on <backend name>?`. Confirm, then rerun the curl: it is gone.
7. Stop the container (`docker stop openbq-dashsync`), delete a synced dashboard in BDOBB, and check that `workspaceSync.json` in the app-data directory lists its tombstone. Start the container, relaunch BDOBB, and check with curl that the dashboard is gone on the server.

Finally, `docker rm -f openbq-dashsync` and `unset PW`.

- [ ] **Step 4: Workspace login mode. This is the USER's checklist; an agent never types the Workspace password.** Hand the user this list, run on macOS. The iPad-simulator run belongs to the v7 carry (R10).

1. In BDOBB, add a Workspace connection for the NAS Workspace (the spec's "Live" address), set User Settings → Server to it, and sign in.
2. A dashboard made in Workspace appears in BDOBB's rail with its tabs, cards and params.
3. Edit that dashboard in BDOBB (change a param, move a card) and reload Workspace: the edit shows there.
4. Delete it from BDOBB's rail. The confirm names the Workspace connection; after confirming, it is gone in Workspace too.
5. Import the v3 built-ins example (`docs/examples/v3.1.0-builtins.apps.json`) while signed out, then sign in. It uploads, and Workspace lists it; its built-in cards show as unknown widgets there.
6. Report anything that differs. Workspace may strip unknown keys (`extensions.bdobb`) on its own saves; if so, note which ones.

- [ ] **Step 5: Final report.** Record the commit list for both branches, the test counts, and the results of Steps 3–4. Do not push.

---

**Not in this plan:** carrying the change to v4 → v5 → v6 → v7, re-testing each line (the iPad simulator on v7), and re-cutting v3.0.0 and each shipped line, GHCR included. The spec's release sequence covers these, and v6's tag stays gated on #39 and #40. NAS deploys happen only when the user asks.
