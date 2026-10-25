---
type: Note
tags: [bdobb, help, configuration, settings, logs, theme]
---

# Settings and Logs

Open the rail and click **Settings**. The tabs down the side are its sections: **General**, **Widget**, **Layout** and **Logs** always, and between Layout and Logs one section for each settings page a connected backend offers — **Provider API Keys** when a backend runs key-maint. Service sections are sorted by backend name, then by their own name. Every change to your preferences previews immediately, but nothing is written to disk until you click **Done**; **Cancel** — or closing the dialog any other way, Escape included — discards the pending changes instead.

The dialog's header also carries **Export…** and **Import…**, which write and read your preferences and the rail's folder tree as one `bdobb-settings.json` file. Whatever either does, it says so in a line under the header. See [[settings-export-and-import|Settings Export and Import]].

![The Settings dialog, General tab](../attachments/settings-and-logs.png)

## General

- **Theme** — **Light**, **Dark** or **System**. System by default, so a fresh install follows the computer, and it switches live when macOS changes — no restart needed. Theme applies everywhere, including charts the app draws itself; a ready-made figure from a provider keeps its own colours.
- **Font size** — **Medium** (the default) or **Large**.
- **Auto-refresh** — **Off** (the default), **1 minute**, **5 minutes**, **15 minutes**, **30 minutes** or **60 minutes**. A widget's own declared interval wins over this. See [[running-and-refreshing|Running and Refreshing]].
- **Default widget ticker** — used when you add a widget that takes a symbol. It stages on every keystroke; nothing is written until **Done**. Clearing it removes the setting.
- **Match dashboard symbol** — *Use the dashboard's symbol when adding a widget.* A switch, off by default. When on it wins over the default ticker: a new card copies the symbol from the most recently added sibling card on that tab.

## Widget

- **Maximum decimal places** — six choices, 0 to 5, labelled with worked examples in your own locale rather than with digits. The default is 2. It is a genuine maximum: trailing zeros are trimmed, and it applies to abbreviated numbers too. It does not affect a Metric card's headline number, a column with its own declared precision, or exports.
- **Minimize button on header** — off by default. See [[widget-cards|Widget Cards]].
- **Collapse widget controls** — off by default. Hides a card's header controls behind a single `⌄`.

## Layout

- **Corner drag handles** — off by default. Off gives one resize handle at the bottom right; on gives all four corners and insets the header so the title never sits inside one.
- **Quick add toolbar** — on by default. Adds the `+` at the right end of the tab strip.
- **Collapsed rail width** — a slider from 24 to 120 pixels, default 48, with a live readout. It previews across every window, viewer windows included, the moment you let go — not while you drag — but isn't written to disk until **Done**.
- **Dashboard widget spacing** — a slider from 1 to 25 pixels, 10 by default. Same preview-then-**Done** rule as the rail width above; it controls only the gap between cards, and the grid's outer inset stays put.
- **Option-number shortcuts** — **Dashboards** (the default) or **Workspaces**: whether `⌥1`–`⌥9` select dashboards or workspaces, never both. The rail's `⌥` badges follow. See [[workspaces|Workspaces and Saved Layouts]].

## Service sections

A backend can add sections of its own to Settings by advertising them in its `widgets.json`; none of them is a widget you can add to a dashboard.

- **Provider API Keys** — which data-vendor credentials the stack holds, and whether each vendor accepts them. It is there only when a connected backend runs key-maint, one tab per such backend. It has a page of its own: [[provider-keys|Provider Keys]].
- **A form section** — the service describes its own fields, and the section has its own **Save**, which sends only the fields you changed. The service's answer redraws the form, with any message it sends shown beneath it; a value it refuses is explained beside its field, and what you typed stays put. **Done** and **Cancel** never touch these fields — only **Save** writes them — and the footer says so while the section is open. A section you have visited keeps its unsaved edits while you switch tabs, but a backend rediscovery reloads the form from the service and drops them.
- A section this version cannot draw reads *Needs a newer app version.* or *Not supported in this version.* rather than guessing.

If a backend's section disappears while you are on it — the backend removed, or rediscovered without it — the dialog returns to **General**.

## Logs

The **Logs** tab is the only log viewer. It shows the log file's full path — so you can go find it — and the last hundred lines, oldest first. A line is a UTC timestamp, a level and a message: `2026-08-29T09:12:44.108Z ERROR failed to save dashboard 3f2a: permission denied`.

Almost everything written is `ERROR` — the app logs what went wrong, not what went right. A handful of `INFO` lines exist too: a viewer window refusing an edit it is not allowed to make; an unsupported parameter type or date token; a frame or a cell click naming a parameter its widget does not declare; a TradingView chart whose refetch or chart library failed; and each dashboard Workspace sync uploads or deletes. All but the sync lines and the refusal are written once per session, so a repeating cause does not fill the file.

The file is read each time you open the **Logs** tab, and **Refresh** re-reads it. It is a snapshot, not a live tail. **Export logs** saves the lines on screen — only those — to a file of your choosing; review them for anything sensitive before sharing. On a fresh install with nothing logged you get *No log entries yet.*, which is a normal empty state rather than an error. On disk the log is `logs/bdobb.log` inside the app's data directory, rotating at 10 MB with up to five generations beside it.

Two things are deliberately never logged: the data a card exports, and the value of a provider key you submit.

## When a settings file goes wrong

A `settings.json` written by a newer build loads fine; unknown keys pass through. A field the app recognises with a value it does not — a theme it has never heard of, an out-of-range decimal-places number — is quietly downgraded to its default rather than costing you the whole file. A file that will not parse at all is quarantined; see [[app-data-and-settings|App Data and Settings]].

## What is not here

Connections have their own dialog, and they are the one thing **Export…** does not carry: no file written here holds a backend URL or a credential. Dashboards travel separately, as `apps.json`.

---
*Source: BDOBB v5 in-app manual, "Settings and logs" and "Import and export"; `openbq-docker` `credentials.env.example`, `docker-compose.v3.yml` and `v3/openbq_settings.py` at `v5.0.0`.*
*See also: [[settings-export-and-import|Settings Export and Import]] · [[app-data-and-settings|App Data and Settings]] · [[provider-keys|Provider Keys]]*

## User Settings and Workspace connections

![Workspace connections in Connections](../attachments/workspace-account.png)

### Adding a Workspace connection

An OpenBB Workspace account is a connection. In **Connections**, choose **Add Workspace**, give it a name and its HTTPS server address (loopback HTTP is accepted for a development server), and choose **Save**; the sign-in dialog then asks for your username or email and password. You can add several.

**Remember me** keeps the username for next time; nothing ever stores the password or the session token. Signing in can replace another OpenBB Workspace session, and an account requiring additional verification must finish it in Workspace first.

Each card shows Signed in, Signed out, Session expired or Not synced, with Sign in or Sign out, Edit and Remove. A connection signed in by key reads Connected by key. The connection holding your settings is badged **Holds settings**. Data backend cards show **Settings API: key**, **login**, **key refused** or **no**.

### Ask for credentials on startup

Workspace connections and data backends both offer **Ask for credentials on startup**.

- **What the app asks at launch.** At each launch, one prompt walks the flagged connections, Workspace connections first:
  - A Workspace connection asks for your username, password and Remember me.
  - A data backend asks for its Key, its Value and Remember me. The Key is stored; the Value is stored only with Remember me, and is otherwise kept for this run only.
- **Skipping a step.** **Skip** leaves a Workspace connection signed out. A skipped backend connects without its credential.
- **Your settings server.** It is not part of this walk; it always connects first (see User Settings).

### User Settings

**Settings ▸ General ▸ User Settings** chooses where settings live.
- **Local** keeps them on this computer.
- **Server** also syncs your display settings with a server you choose from the dropdown.

**What the dropdown shows.** It lists your connections with how each connects:
- **key**: the connection's own key and value authorise it.
- **login**: you sign in with a username and password.
- **key refused**: the server rejected the key you sent.

Connections that cannot hold settings are listed with the reason:
- **No settings API**.
- **Needs HTTPS**: a backend that does not use HTTPS.
- **Credential uses the Authorization header**: a login server whose backend credential occupies the header the session needs.

**Choosing a server** connects to it. When its settings differ from yours, you choose **Use** the server's or **Keep local**. After that, every save is uploaded.

**At launch,** the app always connects to your settings server first, whether or not it is flagged:
- A key server connects without asking.
- A login server asks you to sign in, with your username filled in when it was remembered.
- If its backend asks for credentials on startup, you are first asked for its key and value.
- Cancel keeps your local settings for that run.

**A refused key.** When a server refuses its key, Settings shows "Key refused by <connection name>; fix the key in Connections." and the choice stays where it was. A server you were already connected to by key shows **Not synced: key refused** on its card. Fix the key in Connections.

**HTTP Basic as the key.** A server may use HTTP Basic as its key: the backend credential header is `Authorization` and its value is `Basic ...`, as with openbq-docker. A Basic challenge (a 401 with a Basic `WWW-Authenticate` header) after a credential was sent means the key was refused, shown as **Settings API: key refused**; without such a challenge a 401 means the server uses login.

**On openbq-docker.** The API offers a settings API, with dashboard and app sync, when `OPENBB_API_AUTH=true` is set in the stack's `credentials.env`; the connection's key is then that Basic auth. With auth off, the API is listed as **No settings API**. See [[openbq-docker-stack|The openbq-docker Stack]].

Removing the server connection returns storage to Local.

**Dashboards and apps.** A server that offers them also syncs your dashboards and apps, in both directions, each time you connect. Changes on one side only are taken over; new dashboards on either side are created on the other. A dashboard changed on both sides asks **Use <server>**, **Keep local** or **Keep both** (the default, which keeps the server's copy under a new name). A dashboard deleted on the server but changed here asks **Delete** or **Keep as local**. Shared dashboards arrive read-only and are never uploaded. While connected, saves upload once your edits settle. Deleting a synced dashboard from the rail asks *Delete "X" here and on <server>?*; offline, the local delete happens at once and reaches the server on the next connect. The links live in `workspaceSync.json`.

Backends, provider keys and dropped files are not synchronized. Live account sign-in remains unqualified in the reference rehearsal.
