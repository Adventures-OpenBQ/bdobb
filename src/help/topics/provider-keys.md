# Provider keys

**Settings ▸ Provider API Keys** — the tab takes key-maint's own name for it, so
an older stack shows *Provider API Keys (panel)* — shows which data-provider
credentials the backend you are talking to actually has, and whether each vendor accepts them.

![The Provider API Keys panel](./shots/provider-keys.png)

It is not a widget you add. A `keys` widget is filtered out of the library, and
a keys card left on an old dashboard reads
*Provider keys moved to Settings.*

## What it reads

The tab is there only when a connected backend runs key-maint — one that
serves key-maint's `keys` widget or its `provider_api_keys` table. Every
key-maint serves both; a backend that served only the table would still get the
tab, but it would list no providers (*All providers (0)*), because
the table widget hands the panel its rows without the tier they came in. It sits
between **Layout** and **Logs** and takes the name the backend gives it in
`widgets.json`, **Provider API Keys**. An older stack that does not name the
tab still gets it, labelled with its `keys` widget's own name —
*Provider API Keys (panel)* on an older key-maint — or **Provider API Keys**
when that widget has no name. With no key-maint backend connected there is no
tab at all. Each key-maint backend gets a tab of its own and reads only its own
keys; when two would read the same, each carries its backend's name, as in
*Provider API Keys (NAS)*.

On the openbq-docker stack, key-maint comes with the Episode 3 overlay and is a
connection of its own: `http://127.0.0.1:8447` on the Docker host, or
`https://openbq-keys.<your-tailnet>.ts.net` through its Tailscale Service. Its
auth follows the API's.

Opening the tab does a cheap status fetch that reads the backend's own
environment and **contacts no vendor**. Once visited, the tab stays loaded for
as long as the dialog is open, so leaving and coming back neither re-fetches
nor loses an open edit.

## The provider cards

Above the cards, summary tiles — **Available**, **Needs attention**,
**Not configured**, **Not checked** and, when a provider needs no key,
**No key required** — count every provider by status; clicking one filters the
grid to it, and **All providers (N)** or the same tile again clears the filter.
A **Sort** dropdown orders the grid by name or by status. There is no table and
no clickable column header.

Each card shows the provider's name, a status label with a leading dot, a
**Credential:** line (**Own key**, **Demo key**, **Not set**, **Unknown**,
**Optional** or **None Required**) and a short explanation, then a **Details**
button. Needs attention is **amber, not red**, deliberately: several vendors
report a bad key with an HTTP 200 and an error string in the body, so a
rejection and an unreachable vendor are genuinely different problems.

**Details** opens a child dialog with the full connectivity diagnostic and the
actions below.

## Probing and testing

**Check all**, above the cards, makes a live call to every vendor,
server-side, in one request. So does a successful key submit. The app itself
also probes once at start-up, so the Widget Library's provider badges have a
colour before you ever open this dialog — but only from tier 2 up. Below tier 2
the key service reports no test results, so the start-up probe produces no
colours at all. If a check fails after at least one good load, the last known
cards stay on screen under
*Refresh failed. Showing the last known key status.*

To test **one** vendor, open its card's **Details** dialog and choose **Test**
(**Retest** once it already has a result).
It merges only that provider's result and never fans out.

## Submitting a key

If the backend reports that it is willing to accept writes, the Details
dialog's footer gains a **Manage key** button. It opens a form with a masked
**New value** field and **Save**. The value goes in the request body, never in a
query string, and is never logged or echoed back. After a successful save the
panel re-probes so the card's status updates.

When the backend reports that a restart is required you get:

> Saved. The running `openbq-api` container cannot see this change — its
> environment is fixed when the process starts. Restart it to pick the key up.


On failure you get a fixed message and nothing else — *Save failed. The key was
not updated.* — because a network error can carry a URL that may itself contain
the value you just submitted.

Two details worth knowing: Alpaca appears as two cards but is one provider, and
counts as keyed only when both are set; and there is deliberately no raw-JSON
view for this panel, because a card can carry a plaintext credential.

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v8.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
