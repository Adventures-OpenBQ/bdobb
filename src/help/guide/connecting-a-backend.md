---
type: Note
tags: [bdobb, help, getting-started, backends, connections]
---

# Connecting a Backend

BDOBB has no data of its own. It is a client for backends that answer OpenBB Workspace's published `widgets.json` contract; you add one or more by URL, and their widgets become available in the app. A *connection* is one such backend.

Open the rail and click **Connections**.

![The Edit backend dialog](../attachments/connections.png)

## Adding one

**Connect backend**, at the foot of the list, opens the same form **Edit** does, in its own dialog stacked over the list — titled **Connect backend** or **Edit backend**:

- **Name** — required, and what identifies the connection everywhere in the UI. Ids are generated internally; there is no id field.
- **Endpoint URL** — required. The base the app appends `/widgets.json` to.
- **Validate widgets** — **Yes** by default. Yes drops malformed entries out of `widgets.json` and reports them as *skipped*; No takes the payload as it comes.
- Omni widgets that send code (Python, SQL or another language) are sent to the backend like any other request; the backend's server decides which languages run, and its refusal shows in the card.
- **Validate widgets** and **Location** share one row, and **Key** and **Value** share the next row. **Key** and **Value** are the name of the header, query parameter or cookie your credential goes in, and the credential itself, masked; **Location** is **Header** (the default), **Query Parameter** or **Cookie**. Leaving **Key** or **Value** blank clears both; a half-pair is never stored. Choosing **Query Parameter** shows a warning, and it means it: a key in the URL can end up in server logs, browser history, proxies — and, on a failed request, this app's own log (the host and path are logged; the query string is stripped first).
- **Ask for credentials on startup** — hides **Value** and removes any stored value when you save, keeping **Key**. At each launch the app asks for the value; with **Remember me** it is stored again, otherwise it is kept for that run only. Skipping connects without it.

The footer is **Cancel** on its own at the left, and **Test** beside a filled **Add** (or **Update**, when editing) at the right. Test's verdict renders as a panel above the footer: it probes the draft you are currently typing, not the saved record, and saves nothing. It shows *Testing…*, then *Reachable — 275 widgets*, or the backend's own error text, or *Unreachable* if there was none. Editing anything discards the result, and Test does not gate **Add** or **Update**.

Escape closes the dialog first and the Connections list on the next press.

For what goes in the credential fields for each service in the companion stack — the API's optional Basic auth, the reference backend and key-maint — see [[backends-and-connections|Backends and Connections]].

## The list

Backends are grouped under **Active** and **Inactive** headings, each carrying a count badge; active means the app reached it on the last discovery run, and a group with nothing in it is not drawn. Each backend is a card, not a table row: its name, a status pill, an endpoint URL, a widget count, and **Edit**/**Remove** actions.

The widget count on a card reads `Widgets unavailable` for a backend that is not online, `275 widgets` for one that is, `275 widgets, 12 skipped` when validation was on and some manifest entries were malformed, or `Widgets rejected` when the whole payload was the wrong shape.

Every card offers **Edit** and **Remove**. **Remove** asks first: a confirmation names the backend, and only its **Remove** button deletes it.

## The status dot

The dot beside a backend's name is never the only signal; it carries the same word as its label.

- **Green, `Online`** — the last discovery run reached it.
- **Red, `Offline`** — a run was attempted and failed: unreachable, rejected credentials, or a response the app could not read.
- **Grey, `Not checked`** — no run has finished for this backend yet. This is what you see for a moment after every launch.

Cards move between **Active** and **Inactive** live as discovery finishes. That is expected.

Discovery gives each backend's `widgets.json` **ten seconds**, end to end. That deadline exists because discovery asks every backend at once: a host that accepts the connection and then never answers would otherwise hold the whole run open, and every card on *every* backend would sit unresolved waiting for it. With the deadline, the silent backend simply goes **offline** on its own and the others are unaffected.

## The seeded `Local` entry

A fresh install seeds one backend named `Local` at `http://localhost:6900`. It is a starting point, not a working connection: the openbq-docker stack publishes no host port for its API (Tailscale Serve is the only way in — see [[tailscale-networking|Tailscale Networking]]), so on almost every machine that entry sits with a red dot until you edit its URL. The seed only happens when the connections file is absent, so deleting the entry does not bring it back.

## More than one at once

BDOBB is built around several simultaneous backends. A typical stack is two or more connections — the API and key-maint, say — each contributing its own widgets to the same library, and each tracked independently: one going offline shows a retry state only on the cards that depend on it. See [[openbq-docker-stack|The openbq-docker Stack]] for the full set and [[layout-and-navigation|Layout and Navigation]] for how degraded states are shown.

## Where connections are kept

Connections live in `backends.json` in the app's data directory, credentials included, in the clear. The file kept its old name when the UI was renamed, so existing installs were not stranded. **Export…** and **Import…** at the top of the Connections dialog carry them to another machine or an iPad as a `backends.json` file. Export writes the whole list with its credentials, except a value you typed at the startup prompt without **Remember me**, which stays in memory only. Import merges by id: a connection already here is updated, a new one is added, and nothing is removed. **An update replaces the connection with the file's entry, credential included: a file that carries no credential clears the one stored here**, and the same goes for **Ask for credentials on startup**. So do not strip the secret out of an exported file and import it onto a machine that already has the connection, or that connection loses its credential and its cards fail on a backend that requires one. There is one exception: a file that names the same header with no value (one exported where the value was kept in memory only) keeps the value stored here. The auth location and the **Validate widgets** setting are kept when the file omits them. A file of more than 200 connections is refused. See [[app-data-and-settings|App Data and Settings]] for where the file is.

---
*Source: BDOBB v3.0.2 in-app manual, "Connections" and "Getting started"; `BDOBB` `src/lib/dataClient.ts` at `v3.0.1`; `BDOBB` `src/components/dialogs/BackendEditForm.tsx` and `src/lib/omni.ts` at `v3.3.2`.*
*See also: [[backends-and-connections|Backends and Connections]] · [[openbq-docker-stack|The openbq-docker Stack]] · [[importing-dashboards|Importing Dashboards]] · [[troubleshooting-using-bdobb|Using BDOBB]]*

## Open a backend-served app

After connecting, choose **Apps** in the left rail. Search the catalog and choose **Open** beside the app. Duplicate names use **Keep both**, **Replace**, **Skip**, or **Cancel import**. The imported dashboard is saved locally; it is not a live subscription to the backend's app definition. An Apps error does not disable otherwise working widgets.
