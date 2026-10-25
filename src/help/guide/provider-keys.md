---
type: Note
tags: [bdobb, help, configuration, keys, providers, key-maint]
---

# Provider Keys

**Settings ▸ Provider API Keys** shows which data-vendor credentials the backend you are talking to actually has, and whether each vendor accepts them. It is the app-side face of the stack's **key-maint** service — the transport-tiered key status widget from Ep. 3, part of openbq-docker's Episode 3 overlay — and the only place in the app that touches a credential that is not your own connection's.

![The Provider API Keys panel](../attachments/provider-keys.png)

It is not a widget you add. A `keys` widget is filtered out of the library, and a keys card left on an old dashboard reads *Provider keys moved to Settings.*

## What it reads

The tab is there only when a connected backend runs key-maint — one that serves a `keys` widget. It sits between **Layout** and **Logs** and takes the name the backend gives it in `widgets.json`, **Provider API Keys**; an older stack that serves only the `keys` widget gets the same tab, labelled with that widget's own name, or **Provider API Keys** when it has none. openbq-docker's key-maint also serves the settings entry, so there the tab reads **Provider API Keys**. With no key-maint backend connected there is no tab at all. Each key-maint backend gets a tab of its own and reads only its own keys; when two would read the same, each carries its backend's name, as in *Provider API Keys (NAS)*. The key-maint service is a separate connection from the API: `http://127.0.0.1:8447` on the Docker host, or `https://openbq-keys.<your-tailnet>.ts.net` once the Tailscale Service `svc:openbq-keys` exists. Its auth follows the API's: none while `OPENBB_API_AUTH` is off, the API's own Basic auth when it is on. See [[backends-and-connections|Backends and Connections]].

Opening the tab does a cheap status fetch that reads the backend's own environment and **contacts no vendor**. Once visited, the tab stays loaded for as long as the dialog is open.

## The provider cards

Above the cards, summary tiles — **Available**, **Needs attention**, **Not configured**, **Not checked**, and (only when at least one provider needs no key) **No key required** — count every provider by status; clicking one filters the grid to it, and **All providers (N)** or the same tile again clears the filter. A **Sort** dropdown orders the grid by **Name: A to Z**, **Name: Z to A**, **Available first** or **Needs attention first** — there is no clickable column header, because there is no table.

Each card shows the provider's name, a status label with a leading dot, a **Credential:** line, and a short explanation, then a **Details** button. The status label spells out what was last found: **Available**, **Not configured**, **Not checked**, **Not installed**, **Demo access**, or — grouped under **Needs attention** — a specific reason such as *Rejected*, *Timed out*, *Firewall blocked* or *DNS failed*. Needs attention is **amber, not red**, deliberately: several vendors report a bad key with an HTTP 200 and an error string in the body, so a rejection and an unreachable vendor are genuinely different problems.

**Credential** says what the deployment has configured: **Own key**, **Demo key**, **Not set**, **Unknown**, **Optional**, or **None Required** — plain text on the card now, not its own coloured dot.

**Details** opens a child dialog over Settings with the full connectivity diagnostic (what happened, what to check) for a Needs-attention provider, and the actions below.

## Tiers: what you can see depends on how you connected

key-maint's idea is that the same service shows more the closer you are:

| Tier | How you connect | Sees |
|---|---|---|
| 1 | anything forwarded from outside the tailnet | key status and the demo flag |
| 2 | `https://openbq-keys.<your-tailnet>.ts.net` from a tailnet device, or `http://127.0.0.1:8447` on the Docker host | plus live vendor probes |
| 3 | A unix socket on the host, over an SSH session | plus the key values themselves, and writing a key — never shown in the app |

With Funnel off, nothing reaches key-maint from outside the tailnet, so BDOBB, connected either way above, is a tier-2 caller. Below tier 2 the key service reports no test results, so the dots and the library's provider badges stay uncoloured no matter how often you refresh.

## Probing and testing

**Check all providers**, above the cards, makes a live call to every vendor, server-side, in one request. So does a successful key submit. The app itself also probes once at start-up, so the [[widget-library|Widget Library]]'s provider badges have a colour before you ever open this dialog. If it fails after at least one good load, the last known cards stay on screen under *Refresh failed. Showing the last known key status.*

To test **one** vendor, open its card's **Details** dialog and click **Test** (or **Retest**, once it already has a result). It merges only that provider's result and never fans out.

## Submitting a key

If the backend reports that it is willing to accept writes (tier 3), the Details dialog's footer gains a **Manage key** button, opening a form with a masked **New value** field and **Save**. The value goes in the request body, never in a query string, and is never logged or echoed back. After a successful save the panel re-probes so the card's status updates.

When the backend reports that a restart is required you get: *Saved. The running `openbq-api` container cannot see this change — its environment is fixed when the process starts. Restart it to pick the key up.* A written key reaches the API at its next restart. On failure you get a fixed message and nothing else — *Save failed. The key was not updated.* — because a network error can carry a URL that may itself contain the value you just submitted.

Two details worth knowing: Alpaca appears as two cards but is one provider, and counts as keyed only when both are set; and there is deliberately no raw-JSON view for this panel, because a card can carry a plaintext credential.

---
*Source: BDOBB v5 in-app manual, "Provider keys" and "The widget library"; `openbq-docker` `key-maint/README.md`, `key-maint/app/server.py` and `docker-compose.v3.yml` at `v7.0.0`; Adventures in OpenBQ, Ep. 3.*
*See also: [[widget-library|The Widget Library]] · [[backends-and-connections|Backends and Connections]] · [[openbq-docker-stack|The openbq-docker Stack]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v7.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
