# Connections

A connection is a backend that answers the OpenBB Workspace `widgets.json`
contract. Everything in the widget library — widgets and apps alike — comes
from one.

Open the rail and click **Connections**.

![The Edit backend dialog](./shots/connections.png)

## The list

Backends are grouped under **Active** and **Inactive** headings, each carrying
a count badge; active means the app reached it on the last discovery run, and
a group with nothing in it is not drawn. Each backend is a card, not a table
row: its name, a status pill, an endpoint URL, a widget count, an app count,
and **Edit**/**Remove** actions.

The widget count on a card reads `Widgets unavailable` for a backend that is
not online, `275 widgets` for one that is, `275 widgets, 12 skipped` when
validation was on and some entries in `widgets.json` were malformed, or
`Widgets rejected` when the whole payload was the wrong shape. The app count
follows the same offline/rejected precedence: `Apps unavailable` when the
backend is not online or its own `apps.json` could not be read, and `3 apps`
(or `0 apps`) otherwise — a reason it could not be read, when there is one,
appears as a note under the card.

Every card offers **Edit** and **Remove**. **Remove** asks first: a
confirmation names the backend, and only its **Remove** button deletes it.

Above the backends, a **Workspace** section lists OpenBB Workspace accounts
with **Add Workspace** — see **Settings and logs**. **Refresh**, beside the
*Your backends* heading, re-runs discovery.

With nothing configured you get *No backends configured. Connect a backend to
populate your widget library.*

## Adding and editing

**Connect backend**, at the foot of the list, opens the same form **Edit** does, in its own dialog
stacked over the list — titled **Connect backend** or **Edit backend**:

- **Name** — required, and what identifies the connection everywhere in the
  UI. Ids are generated internally; there is no id field.
- **Endpoint URL** — required. The base the app appends `/widgets.json` to.
- **Validate widgets** — **Yes** by default. Yes drops malformed entries out of
  `widgets.json` and reports them as skipped; No takes the payload as it
  comes.
- **Validate widgets** and **Location** share a row, and **Key** and
  **Value** the next: **Key** and **Value** are the name of the header, query parameter or cookie your credential goes
  in, and the credential itself, masked; **Location** is **Header** (the
  default), **Query Parameter** or **Cookie**. Leaving **Key** or **Value**
  blank clears both — a half-pair is never stored.

Choosing **Query Parameter** shows a warning, and it means it: a key in the
URL can end up in server logs, browser history and proxies — and, on a failed
request, this app's own log (the host and path are logged; the query string
is stripped first).

The footer is **Cancel** on its own at the left, and **Test** beside a filled
**Add** (or **Update**, when editing) at the right. **Test** probes the draft
you are currently typing, not the saved record, and saves nothing. It shows
*Testing…*, then *Reachable — 275 widgets* or the backend's own error text, or
*Unreachable* if there was none. Editing anything discards the result, and
Test does not gate **Add** or **Update**.

## The status dot

The dot beside a backend's name is never the only signal — it carries the same
word as its label.

- **Green, `Online`** — the last discovery run reached it.
- **Red, `Offline`** — a run was attempted and failed: unreachable, rejected
  credentials, or a response the app could not read.
- **Grey, `Not checked`** — no run has finished for this backend yet. This is
  what you see for a moment after every launch.

Cards move between **Active** and **Inactive** live as discovery finishes.
That is expected.

## On disk

Connections live in `backends.json` in the app's data directory, credentials
included, in the clear. The file kept its old name when the UI was renamed, so
existing installs were not stranded. **Export…** and **Import…** at the top of
the dialog carry them as a `backends.json` file, credentials included (except a
value typed at the startup prompt without Remember me). Import merges by id:
known connections are updated, new ones added, none removed. An update takes
the file's entry, so a file with no credential clears the stored one (unless
it names the same header with no value). They are still
left out of the `bdobb-settings.json` bundle that carries preferences and
folders, so a settings file never holds a credential.

A fresh install seeds one backend named `Local` at `http://localhost:6900`.
That is a starting point, not a promise — if nothing is serving that address
it will simply sit there with a red dot until you edit it. The seed only
happens when the file is absent, so deleting the entry does not bring it
back.
