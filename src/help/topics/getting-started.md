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

Press `⌘K`, or click **Add widget (⌘K)** in the rail. Everything every
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

- `settings.json` — everything in the Settings dialog
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
