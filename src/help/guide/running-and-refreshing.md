---
type: Note
tags: [bdobb, help, interface, refresh, auto-refresh, run-button]
---

# Running and Refreshing

A card fetches when it is first shown, when its question changes, when you ask it to, and — if you have turned it on — on a timer. This page is about the second half of that list.

## Refresh

Every card has a **Refresh** button in its header. It refetches that one card, and it keeps the current data on screen while it does — so a chart's zoom and a table's scroll survive a refresh. The card is cleared to *Loading…* only when the *question* changes, which is to say when a parameter moves. While a manual refresh is in flight the title dims and shows a dot; nothing spins.

A card that failed carries a **Retry** button in its body, and the header keeps its **Refresh** (or **Run**). On a card whose widget could not be resolved at all — its backend gone, or an import naming a widget nothing serves — Retry also re-runs backend discovery, which is the only thing that can rescue it.

## `⌘R` and `↻`

`⌘R` refreshes every card on the tab you are looking at. The `↻` button at the right end of the tab strip does exactly the same thing and is always enabled; on a tab where nothing fetches it is a no-op. `⌘R` is ignored while you are typing in a field; `↻` is a button, so it always fires. Both work in a viewer window. `⌘⇧R` is deliberately left alone so a hard reload still reaches the browser in development builds.

Cards on tabs you are not looking at are not mounted, and are not refreshed.

A **live grid** streams, so for it Refresh, `⌘R` and `↻` mean something narrower: they re-fetch its snapshot, and its socket carries on untouched. The automatic refresh below does not re-fetch a live grid at all. See [[tables|Tables]] (Live grids).

## Automatic refresh

Cron-style refresh schedules are not supported. Use a numeric interval, the app-wide refresh setting, or manual Refresh/Run.


**Settings ▸ General ▸ Auto-refresh** offers **Off**, **1 minute**, **5 minutes**, **15 minutes**, **30 minutes** and **60 minutes**. It is **Off** by default.

A widget may declare its own `refetchInterval`, in milliseconds. When it is a positive number it **wins over your setting** for that widget; a value under one second counts as one second, so a typo cannot poll every millisecond. When it is `false` the widget never auto-refreshes at all, and your app-wide setting does not apply to it either — but **Refresh** and `⌘R` still work on it.

How the timer behaves, which is worth knowing before you blame it:

- It is armed only *after* a request finishes, success or failure, so a fetch slower than the interval can never stack two requests up.
- Nothing is armed while the window is hidden. When you come back, a card whose interval already elapsed fetches at once and the rest arm the remainder.
- Widgets that fetch nothing — framed pages, notes, clocks, the keys panel — are never polled, and neither is a card blocked on an empty required parameter.
- A card naming a backend that no longer exists shows *Backend not configured* and is deliberately never re-armed.

## Run-button widgets

Some widgets declare that they should not run automatically. On those, the header's **Refresh** is replaced by an accent **Run** button.

Such a card fetches **once on load** with its stored parameters — or, for a parameter shared with a group, the group's current value — and after that only when you press **Run**. Changing a parameter, choosing a tab, clicking a cell, even a group value changed from another card — all of them update what the card *will* ask, and none of them issues a request. One exception: a click on a cell whose column declares `forceUpdate` refetches straight away, with the parameters that were last run.

When the live parameters differ from the ones last run, a small accent `•` appears after the card's title, labelled *Parameters changed — press Run*. It goes away when you run.

**Run** adopts the current parameters and fetches. **⌘-click** (or Ctrl-click) on **Run** is a hard refresh of the parameters that were last run — it re-issues the last request without adopting your un-run edits. `refetchInterval`, your app-wide interval, `⌘R` and `↻` all still refresh a run-button card, always with the parameters that were last run, never un-run edits. There is no keyboard shortcut for Run, and no way to turn a run button on or off per card.

---
*Source: BDOBB v3.1.0 in-app manual, "Running and refreshing."; `BDOBB` `src/lib/widgetsJson.ts` at `v3.0.7`; at 10.0.0, `src/components/WidgetCard.tsx` and `src/hooks/useWidgetData.ts`.*
*See also: [[card-parameters|Card Parameters]] · [[dashboard-tabs|Dashboard Tabs]] · [[settings-and-logs|Settings and Logs]] · [[troubleshooting-using-bdobb|Using BDOBB]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v10.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
