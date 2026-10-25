---
type: Note
tags: [bdobb, help, configuration, keys, providers, key-maint]
---

# Provider Keys

**Settings ▸ Provider API Keys** shows which data-vendor credentials the backend you are talking to actually has, and whether each vendor accepts them. It is the app-side face of the stack's **key-maint** service — the transport-tiered key status widget from Ep. 3 — and the only place in the app that touches a credential that is not your own connection's.

![The Provider API Keys panel](../attachments/provider-keys.png)

It is not a widget you add. A `keys` widget is filtered out of the library, and a keys card left on an old dashboard reads *Provider keys moved to Settings.*

## What it reads

The tab is there only when a connected backend runs key-maint — one that serves a `keys` widget. It sits between **Layout** and **Logs** and takes the name the backend gives it in `widgets.json`, **Provider API Keys**; an older stack that serves only the `keys` widget gets the same tab, labelled with that widget's own name, or **Provider API Keys** when it has none. With no key-maint backend connected there is no tab at all. Each key-maint backend gets a tab of its own and reads only its own keys; when two would read the same, each carries its backend's name, as in *Provider API Keys (NAS)*. The key-maint service is a separate connection from the OpenBB API, on its own port or Tailscale Service name, with the same Basic auth; see [[backends-and-connections|Backends and Connections]].

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
| 2 | The service's tailnet address, from a tailnet device | key status, the demo flag, and live vendor probes |
| 3 | A unix socket on the host, over an SSH session | plus the key values themselves — never shown in the app |

(A tier 1, over a public funnel, was deliberately retired.) BDOBB is always a tier-2 caller. Below tier 2 the key service reports no test results, so every dot stays grey, *not probed*, no matter how often you refresh — which is the expected state for a service published any other way.

## Probing and testing

**Check all**, above the cards, makes a live call to every vendor, server-side, in one request. So does a successful key submit, and nothing else does: the app runs no probe of its own at start-up. If it fails after at least one good load, the last known cards stay on screen under *Refresh failed. Showing the last known key status.*

To test **one** vendor, open its card's **Details** dialog and click **Test** (or **Retest**, once it already has a result). It merges only that provider's result and never fans out.

## Submitting a key

If the backend reports that it is willing to accept writes (tier 3), the Details dialog's footer gains a **Manage key** button, opening a form with a masked **New value** field and **Save**. The value goes in the request body, never in a query string, and is never logged or echoed back. After a successful save the panel re-probes so the card's status updates.

When the backend reports that a restart is required you get: *Saved. The running `openbb-api` container cannot see this change — its environment is fixed when the process starts. Restart it to pick the key up.* On failure you get a fixed message and nothing else — *Save failed. The key was not updated.* — because a network error can carry a URL that may itself contain the value you just submitted.

Two details worth knowing: Alpaca appears as two cards but is one provider, and counts as keyed only when both are set; and there is deliberately no raw-JSON view for this panel, because a card can carry a plaintext credential.

---
*Source: BDOBB v3.0.1 in-app manual, "Provider keys" and "The widget library"; `openbb-docker` `key-maint/README.md`; Adventures in OpenBB, Ep. 3 — "I Asked for Electron and Got Talked Out of It."*
*See also: [[widget-library|The Widget Library]] · [[backends-and-connections|Backends and Connections]] · [[openbb-docker-stack|The openbb-docker Stack]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v3.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
