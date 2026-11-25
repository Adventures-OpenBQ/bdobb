# Getting started

BDOBB is a dashboard for market data. You build a page out of *widgets* —
tables, charts, documents, notes — and each widget asks a *backend* you have
connected for its data.

Three things to do first.

## 1. Connect a backend

Open the left rail, click **Connections**, then **Connect backend**. A backend
is any server that answers OpenBB Workspace's `widgets.json` contract; the app
ships with one already listed, named `Local` at `http://localhost:6900`, which
you will usually need to edit to point at wherever your own API actually runs.

Fill in **Name** and **Endpoint URL**, and — if your API needs one — a **Key**
and **Value** pair plus the **Location** the credential goes in (**Header**,
**Query Parameter** or **Cookie**). Press **Test** to probe what you have
typed without saving it. Press **Add** (or **Update**, if you are editing an
existing backend) when it answers.

The dot beside the backend's name is green when the app last reached it, red
when it tried and failed, and grey before it has tried at all.

## 2. Open the widget library

Press `⌘K`, or click **Widget Library** in the rail. Everything every
connected backend serves is listed here, searchable, with filters for
**Backend**, **Category**, **Subcategory**, **Provider**, **Type** and
**On dashboard**.

## 3. Put a widget on the grid

Click a card once to add it to the dashboard you came from — the library stays
open, so you can add several. Double-click a card to add it and go straight
back to the dashboard. Or drag a card onto a dashboard row in the rail to add
it *there*.

![The left rail and a dashboard with three cards](./shots/getting-started.png)

Drag a card by its **title** to move it, and by its bottom-right corner to
resize it. Both are saved as you go.

## Where your data lives

Everything the app remembers is plain JSON on your own disk, in the app's data
directory — on macOS that is
`~/Library/Application Support/com.artcashin.bdobb/`.

- `settings.json` — everything in the Settings dialog, plus the AI Library's
  fields
- `backends.json` — your connections, including any credential you typed
- `folders.json` — the rail's folder tree
- `dashboards/<id>.json` — one file per dashboard
- `workspace.json` and `workspaceSync.json` — your OpenBB Workspace
  connections (never a password or token) and the links between synced
  dashboards
- `logs/bdobb.log` — the app log, plus up to five rotated generations

Writes are atomic: the app writes a temporary file and renames it over the
target, so a crash can never leave you with half a dashboard. If one of these
files is ever unreadable the app renames it to `<name>.corrupt` and carries on
with defaults rather than overwriting it — see **Troubleshooting**.

---

## Documentation terms

Copyright © 2026 SecretoftheUniverse.com LLC. All rights reserved, subject to the exceptions below.

### Scope

These terms apply to original prose, illustrations, and screenshots owned by SecretoftheUniverse.com LLC in `src/help/topics/`, `src/help/guide/`, `src/help/shots/`, `docs/reference-manual/`, and `docs/user-guide.md`, and to their rendered or exported documentation editions, beginning with the revision that introduces these terms. They do not cover the repository's software, executable code examples, configuration examples, third-party material, user content, or material separately identified as having another license. Directory placement alone does not override those exclusions.

### Permitted use

You may read, search, download, and print these materials for personal or internal organizational use to learn, evaluate, install, operate, troubleshoot, and maintain bdobb. You may make reasonable internal copies for those purposes and retain archival copies. Keep the copyright notice and these terms with copies. You may link to the publisher's documentation. Software and executable examples remain usable under their applicable software licenses.

### Restrictions

Except as permitted above, separately authorized in writing by SecretoftheUniverse.com LLC, or allowed by applicable law or an existing license, you may not reproduce, republish, redistribute, sell, sublicense, translate, adapt, or create derivative documentation from the covered materials.

You may not use the covered materials to reverse engineer, reconstruct, or replicate bdobb or another product, or to derive its source code, architecture, algorithms, or implementation details, except to the extent applicable law or an existing license permits that activity. This restriction concerns use of the covered documentation; it does not restrict activities independently authorized under the software's license.

### Software rights and prior permissions

These documentation terms are separate from the software license and add no conditions to software licensed under GNU AGPL-3.0 or any other applicable software license. They do not restrict copying, modification, distribution, network use, or access to Corresponding Source as authorized by that license. If any covered material must accompany the software or form part of its Corresponding Source under an applicable software license, that license governs the material to the extent needed to satisfy those obligations.

These terms do not revoke permissions already granted for any previously licensed version, relicense third-party contributions, or override third-party notices. Third-party material remains subject to its own terms. Nothing here limits fair use, statutory exceptions, or other rights that cannot lawfully be restricted. No exclusive rights are claimed in underlying ideas, facts, systems, or methods as such.

### Additional permission

Obtain written permission from SecretoftheUniverse.com LLC before undertaking a use outside the permissions above. A copyright notice or these published terms alone do not establish that a reader has entered a separate contract; any contractual restrictions requiring agreement must be presented through an appropriate acceptance process.

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v10.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
