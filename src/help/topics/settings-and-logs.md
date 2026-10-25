# Settings and logs

Open the rail and click **Settings**. The tabs down the side are its sections:
**General**, **Widget**, **Layout**, **Locked Widgets** and **Logs** always, and
between Locked Widgets and Logs one section for each settings page a connected
backend offers — **Provider API Keys** when a backend runs key-maint. Service sections are sorted by backend
name, then by their own name. Every change to your preferences previews
immediately, but nothing is written to disk until you click **Done**; **Cancel**
— or closing the dialog any other way, Escape included — discards the pending
changes instead.

The dialog's header also carries **Import…** and **Export…**, which read and
write your preferences and the rail's folder tree as one `bdobb-settings.json`
file. See **Import and export**.

![The Settings dialog, General tab](./shots/settings-and-logs.png)

## General

- **Theme** — **Light**, **Dark** or **System**. System by default,
  so a fresh install follows the computer, and it switches live when macOS
  changes — no restart needed. Theme applies everywhere, including charts the
  app draws itself; a ready-made figure from a provider keeps its own colours.
- **Font size** — **Medium** (the default) or **Large**.
- **Auto-refresh** — **Off** (the default), **1 minute**, **5 minutes**,
  **15 minutes**, **30 minutes** or **60 minutes**. A widget's own declared
  interval wins over this. See **Running and refreshing**.
- **Default widget ticker** — used when you add a widget that takes a symbol.
  It stages on every keystroke; nothing is written until **Done**. Clearing it
  removes the setting.
- **Match dashboard symbol** — *Use the dashboard's symbol when adding a
  widget.* Off by default. When on it wins over the default ticker: a new card copies
  the symbol from the most recently added sibling card on that tab.

## Widget

- **Maximum decimal places** — six choices, 0 to 5, labelled with worked
  examples in your own locale rather than with digits. The default is 2. It is
  a genuine maximum: trailing zeros are trimmed, and it applies to abbreviated
  numbers too. It does not affect a Metric card's headline number, a column
  with its own declared precision, or exports.
- **Minimize button on header** — off by default. See **Widget cards**.
- **Collapse widget controls** — off by default. Hides a
  card's header controls behind a single `⌄`.

## Layout

- **Corner drag handles** — off by default. Off gives one resize handle at the
  bottom right; on gives all four corners and insets the header so the title
  never sits inside one.
- **Quick add toolbar** — on by default. Adds the `+` at the right end of the
  tab strip.
- **Collapsed rail width** — a slider from 24 to 120 pixels, default 48, with a
  live readout. It previews across every window, viewer windows included, the
  moment you let go — not while you drag — but isn't written to disk until
  **Done**.
- **Dashboard widget spacing** — a slider from 1 to 25 pixels, default 10. Same
  preview-then-**Done** rule as the rail width above; it controls only the gap
  between cards, and the grid's outer inset stays put.
- **Option-number shortcuts** — **Dashboards** (the default) or
  **Workspaces**: whether `⌥1`–`⌥9` select dashboards or workspaces, never
  both. The rail's `⌥` badges follow.

## Service sections

A backend can add sections of its own to Settings by advertising them in its
`widgets.json`; none of them is a widget you can add to a dashboard.

- **Provider API Keys** — which data-vendor credentials the stack holds, and
  whether each vendor accepts them. It is there only when a connected backend
  runs key-maint, one tab per such backend. See **Provider keys**.
- **A form section** — the service describes its own fields, and the section
  has its own **Save**, which sends only the fields you changed. The service's
  answer redraws the form, with any message it sends shown beneath it; a value
  it refuses is explained beside its field, and what you typed stays put.
  **Done** and **Cancel** never touch these fields — only **Save** writes them
  — and the footer says so while the section is open. A section you have
  visited keeps its unsaved edits while you switch tabs, but a backend
  rediscovery reloads the form from the service and drops them.
- A section this version cannot draw reads *Needs a newer app version.* or
  *Not supported in this version.* rather than guessing.

If a backend's section disappears while you are on it — the backend removed,
or rediscovered without it — the dialog returns to **General**.

## Locked Widgets

**Locked at Top…** and **Locked at Bottom…** close Settings and open that
band's editor, discarding any preference change you had not saved with
**Done**. Below them, **Export locked widgets…** and **Import locked
widgets…** move both bands as an `apps.json`; export is disabled while nothing
is locked, and import replaces both bands, asking first when yours hold
anything. See **Locked widgets**.

## Logs

The **Logs** tab is the only log viewer. It shows the log file's full path — so
you can go find it — and the last hundred lines, oldest first. A line is a UTC
timestamp, a level and a message:
`2026-08-29T09:12:44.108Z ERROR failed to save dashboard 3f2a: permission denied`.

Most of what is written is `ERROR` — the app logs what went wrong. `INFO`
lines are notes: a viewer window refusing an edit it is not allowed to make,
as `INFO viewer window refused renameDashboard`, a parameter type or date
token the app does not support, a frame or a cell click naming a parameter its
widget does not declare, a TradingView chart whose refetch or chart library
failed, and Workspace sync's uploads and deletes.
All but the refusal and the sync lines are written once per session, so a
repeating cause does not fill the file.

The file is read each time you open the **Logs** tab, and **Refresh** re-reads
it. It is a snapshot, not a live tail. **Export logs** saves the lines shown
as `bdobb-logs-<time>.txt`; review them for anything sensitive before sharing. On a fresh install with nothing logged
you get *No log entries yet.*, which is a normal empty state rather than an
error. On disk the log is `logs/bdobb.log` inside the app's data directory,
rotating at 10 MB with up to five generations beside it.

Two things are deliberately never logged: the data a card exports, and the
value of a provider key you submit.

## When a settings file goes wrong

A `settings.json` written by a newer build loads fine; unknown keys pass
through. A field the app recognises with a value it does not — a theme it has
never heard of, an out-of-range decimal-places number — is quietly downgraded
to its default rather than costing you the whole file. A file that will not
parse at all is quarantined; see **Troubleshooting**.

## What is not here

Connections have their own dialog, and they are the one thing **Export…**
does not carry: no file written here holds a backend URL or a credential. See
**Connections**. Dashboards travel separately, as `apps.json`.

## User Settings and Workspace connections

![Workspace connections in Connections](./shots/workspace-account.png)

An OpenBB Workspace account is a connection: in **Connections**, choose **Add Workspace**, give it a name and an HTTPS server address (local development servers may use loopback HTTP), then sign in with your username or email and password. The app does not save your password or session token; **Remember me** keeps only the username. Signing in may replace another Workspace session. Accounts requiring additional verification must complete that in Workspace first.

**General ▸ User Settings** is **Local** (this computer) or **Server**. Server syncs your display settings with a connection you pick from the dropdown, each labelled **key** or **login**; connections that cannot hold settings say why. Choosing one connects to it and, when its settings differ from yours, asks **Use** the server's or **Keep local**. After that every save is uploaded. If a server refuses its key, Settings shows "Key refused by <connection name>; fix the key in Connections." and the choice stays where it was.

On the openbq-docker stack, the API holds settings, dashboards and apps only
with `OPENBB_API_AUTH=true`; its key is then the API's Basic auth.

**Ask for credentials on startup** (on any connection) makes the app ask for its username and password, or its Key and Value, at each launch. Your settings server always connects first.

**Your dashboards and apps sync too**, in both directions, with a server that offers them (one that does not simply keeps settings-only sync). Connecting runs the sync after the settings step:

- A dashboard that changed only on the server is updated here, and one that changed only here is uploaded. A dashboard new on the server appears in the rail, and one you created here is uploaded as a new Workspace dashboard.
- A dashboard changed on both sides asks **Use <server>**, **Keep local** or **Keep both**. Keep both, the default, adds the server's copy under a new name.
- A dashboard deleted on the server is deleted here, unless you changed it since the last sync: then it asks **Delete** or **Keep as local**.
- Dashboards shared with you arrive read-only, marked shared, and are never uploaded.

While connected, a saved dashboard uploads shortly after your edits settle. Deleting a synced dashboard from the rail asks *Delete "X" here and on <server>?* and deletes it on the server too; for a shared dashboard only the local copy goes. Offline or signed out, the local delete happens at once and is sent to the server the next time you connect. Links to server dashboards are kept in `workspaceSync.json` in the app's data folder.

A card's pin (see **Pinned cards**) and a News card's feeds sync with its
dashboard. Your **locked widgets** sync as one hidden record beside your
dashboards, and the side edited last wins without a question; a server that
does not offer that record keeps them on this device. See **Locked widgets**.

Backends, provider keys and dropped files are not synchronized. Live account sign-in has not been qualified in the reference rehearsal.
