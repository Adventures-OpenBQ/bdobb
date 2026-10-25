# Running and refreshing

## Refresh

Every card has a **Refresh** button in its header. It refetches that one card,
and it keeps the current data on screen while it does — so a chart's zoom and a
table's scroll survive a refresh. The card is cleared to *Loading…* only when
the *question* changes, which is to say when a parameter moves.

While a manual refresh is in flight the title dims and shows a dot. Nothing
spins and nothing animates.

A card that failed shows its own **Retry** instead; on a card whose widget could
not be resolved at all, Retry also re-runs backend discovery, which is the only
thing that can rescue it.

## `⌘R` and `↻`

`⌘R` refreshes every card on the tab you are looking at. The `↻` button at the
right end of the tab strip does exactly the same thing, and is always enabled —
on a tab where nothing fetches it is simply a no-op.

Both are ignored while you are typing in a field. `⌘R` works in a viewer window
too. `⌘⇧R` is deliberately left alone, so a hard reload still reaches the
browser in development builds.

Cards on tabs you are not looking at are not mounted, and are not refreshed.

## Automatic refresh

Cron-style refresh schedules are not supported. Use a numeric interval, the app-wide refresh setting, or manual Refresh/Run.


**Settings ▸ General ▸ Auto-refresh** offers **Off**, **1 minute**,
**5 minutes**, **15 minutes**, **30 minutes** and **60 minutes**. It is **Off**
by default.

A widget may declare its own `refetchInterval`, in milliseconds. When it is a
positive number it **wins over your setting** for that widget; a value under
one second counts as one second, so a typo cannot poll every millisecond. When
it is `refetchInterval: false` the widget never auto-refreshes at all, and your
app-wide setting does not apply to it either — but **Refresh** and `⌘R` still
work on it.

How the timer behaves, which is worth knowing before you blame it:

- It is armed only *after* a request finishes, success or failure, so a fetch
  slower than the interval can never stack two requests up.
- Nothing is armed while the window is hidden. When you come back, a card whose
  interval already elapsed fetches at once and the rest arm the remainder.
- Widgets that fetch nothing — framed pages, notes, clocks, the keys panel —
  are never polled, and neither is a card blocked on an empty required
  parameter.
- A card naming a backend that no longer exists shows *Backend not configured*
  and is deliberately never re-armed.

## Run-button widgets

Some widgets declare that they should not run automatically. On those, the
header's **Refresh** is replaced by an accent **Run** button, and there is no
Refresh beside it.

![A run-button card showing its stale marker](./shots/running-and-refreshing.png)

Such a card fetches **once on load** with its stored parameters — or, for a
parameter that is shared with a group, the group's current value — and after
that only when you press **Run**. Changing a parameter, choosing a tab, clicking a
cell, even a group value changed from another card — all of them update what
the card *will* ask, and none of them issues a request.

When the live parameters differ from the ones that were last run, a small
accent `•` appears after the card's title, labelled
*Parameters changed — press Run*. It goes away when you run.

**Run** adopts the current parameters and fetches. Pressing Run with nothing
changed just re-issues the same request. **⌘-click** (or Ctrl-click) on **Run**
is a hard refresh of the parameters that were last run — it re-issues the last
request without adopting your un-run edits, whether or not the card is stale.

`refetchInterval`, your app-wide interval, `⌘R` and `↻` all still refresh a
run-button card. They always use the parameters that were last run, never
un-run edits. There is no keyboard shortcut for Run, and no way to turn a run
button on or off per card.

[shot-pending]: #19

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v6.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
