---
type: Note
tags: [bdobb, help, widgets, pinned, locked, bands, docks, sync]
---

# Locked and Pinned Widgets

Two ways to take a card out of the grid and keep it in view. A **pinned** card belongs to one tab: it leaves the grid for a band at the top or bottom edge of that tab and stays put while the rest of the tab scrolls. A **locked** widget belongs to the app: it sits in a band at the top or bottom of the window on **every dashboard, every tab and every workspace**, with its own data, until you take it out. A news wire that is always along the bottom, whatever dashboard is up, is the case both were made for.

![A News card locked along the bottom, under an ordinary dashboard](../attachments/locked-widgets.png)

## Pinning a card to its tab

The card's `⋯` menu holds **Pin widget ▸** with **Pin to top**, **Pin to bottom** and **Unpin**; the edge the card already has is greyed out. (On a News card the same menu opens from the chevron at the top of its strip.) A pinned card leaves the grid for a full-width band at that edge of the dashboard area and stays in view while the rest of the tab scrolls. The band runs edge to edge, outside the part of the dashboard that scrolls: a top band sits directly under the tab bar, and a bottom band sits at the bottom of the area however short the tab is.

![A card pinned to the top of a tab and another to the bottom](../attachments/pinned-cards.png)

The band starts as tall as the card was in the grid, **up to 40% of the dashboard area** — or of its tile, in a workspace — so a tall card cannot push the grid and the other band off screen; two bands at the cap still leave the grid a fifth. A card taller than that is shown at the cap and its body scrolls inside the band. Two corner grips sit on its inner edge — the bottom corners of a top band, the top corners of a bottom band; drag one to make the band taller or shorter, a whole row at a time, never below two rows and never past the cap. The outer edge is the dashboard's own edge and does not move. The height you drag to is the card's own grid height, and the cap only limits what the band shows, so **Unpin** puts the card back where it was at its full size — the size you dragged it to, or, if you never dragged, the size it had before it was pinned. A **maximized** pinned card is not held to the cap. Under a coarse pointer — a finger on the iPad — the grips are larger.

**One card per edge, per tab.** Pinning a second card to an edge that is taken swaps: the first goes back to its old place in the grid.

A pinned card is otherwise a card like any other: Refresh, Parameters, Rename, Export and Maximize work as in the grid. A maximized card covers the bands too and **Escape** puts it back; the grips hide while it is maximized. A locked Rita pane narrows the bands with the dashboard. In a workspace each tile's dashboard keeps its own bands inside its tile, and a maximized pinned card there fills only its tile. A viewer window shows pinned cards but offers no **Pin widget ▸** and no grips.

**What carries a pin.** It is saved with the dashboard. The dashboard sync with a Workspace server carries it to your other devices in a record of its own beside the card, which a BDOBB 7 install on the same account syncs past without reading, so that install keeps the dashboard and simply does not show the pin. **Save…** in the **BDOBB Workspace** format writes it in BDOBB's v8 extension, so such a file opens in BDOBB 8.0.0 or later; **Save…** in the **Strict OpenBB Workspace** format writes no pin, and Workspace has no field for one. **Duplicate** and **Copy to ▸** never copy the pin — the copy lands in the grid.

Rita can do it for you: her `pin_card` tool pins a card on the active dashboard to `top` or `bottom`, or unpins it with `none`, and the change is one step on her Undo bar. See [[rita-ai-agent-setup|Setting Up the Rita AI Agent]].

## Locking a widget to the app

Locked widgets are **not** reachable from a card's menu. The only way in is **Settings ▸ Locked Widgets**, which shows **Locked at Top** and **Locked at Bottom**, each with a line saying what is there now, and a button for each band: **Locked at Top…** and **Locked at Bottom…**.

Pressing one closes Settings and opens that band's **editor**. Settings is a pending-changes dialog — nothing it holds reaches disk until you press **Done** — and a band editor is a separate edit, so opening one **discards any preference changes you had pending** in Settings. What you had already saved with Done is untouched.

The editor is a panel over the dashboard with a canvas exactly as wide as the dashboard area and as tall as the rows the band reserves — what you lay out on the canvas is what the band will show, and the line under its header says so. The header holds the green **+** that adds a widget (`⌘K` works too, and adds to this band), a **rows** stepper — **Shorter** and **Taller**, between 2 and 24 rows; a new install reserves 6 rows at the top and 8 at the bottom — **Cancel** and **OK**. On a short window, such as an iPad's, a band that would push the dashboard off screen shows fewer rows and scrolls, and **Taller** stops where the dashboard would run out of room. Reopen the editor later and the canvas shows the widgets laid out, live with data.

On the canvas the widgets have their full controls: drag a title to move, drag a corner to resize, Parameters, groups, Rename, Close, and for a News card its feed manager. A band is a small dashboard grid, not a single row, so two locked widgets can share one, side by side or stacked, within the rows the band reserves; the stepper is how you make room. A locked card never offers **Pin widget ▸**.

**OK** keeps the band and returns you to the dashboard. **Cancel** — or **Escape**, once nothing nearer wants it: an open menu closes first and a maximized card restores first — puts back exactly what was there when you opened the editor and returns you to **Settings ▸ Locked Widgets**. Every add, remove, move, resize, row change, parameter and feed change in between is undone, whichever of them were already saved.

## Outside the editor

A locked widget is fully live — scroll it, switch its tabs, double-click a story, sort a table, zoom a chart, Refresh, Maximize, Export — but nothing that would *change* it is offered: no Rename, Parameters, Configure feeds…, Import feeds…, Duplicate, Copy to, Pin widget, linked-card items or Close. To change a locked widget, go back to Settings ▸ Locked Widgets. Locked widgets show in a viewer window too, read-only.

The bands are mounted **once, outside the dashboard switch**, so changing dashboards, tabs or workspaces never reloads a locked card: a News wire stays connected, its history is not fetched again, and a chart keeps its zoom. The one exception is a date: a locked card has no dashboard of its own, so it follows the exchange of the dashboard you are viewing (see [[card-parameters|Card Parameters]]), and a card whose dates depend on that exchange refetches when you switch to a dashboard on another one.

## How they stack

The top locked band sits above the dashboard, tab bar included, and the bottom locked band below it; a dashboard's own pinned cards sit inside, so on the same edge the locked band is outermost. An empty band takes no space at all. The bands take their rows off the dashboard area whatever the window size, so on a small screen two tall bands leave little room: they are a feature for a large monitor.

## Where they live, and how they travel

The two bands are stored as one hidden dashboard, `dashboards/docks.json`, so every piece of card machinery — parameters, groups, rename, a News card's feed list — works on a locked card with no second code path. Being hidden keeps it out of the rail, out of the dashboard order, off the `⌥` shortcuts and out of any one dashboard's own `apps.json` export. See [[app-data-and-settings|App Data and Settings]].

**They sync.** With a Workspace connection that runs the dashboard sync — in key mode or in login mode — the bands go to the server as **one hidden record per account**, on openbq-docker at `/pro/dash/sync/system/docks`, which the stack's own Workspace web app does not list. There is no merge and no question: each copy carries the time of its last edit, and the newer side wins. After a sync, and shortly after an edit to the bands ends, the app compares the two; a newer server copy replaces the local bands, a newer local copy is uploaded, and if another device got there first the app takes the server's copy instead. A server without that route keeps the bands on this device and says nothing; a record written by a later version that this one cannot read is left alone and the local bands kept. The bands are the same in every local workspace.

**They export.** **Settings ▸ Locked Widgets ▸ Export locked widgets…** writes the bands alone, as `Locked widgets.apps.json`; **Export all dashboards…** on the rail's *MY DASHBOARDS* menu writes them alongside every dashboard. Either way they are one extra app carried in BDOBB's v8 extension and marked as the bands, so an import fills the bands rather than adding a dashboard, and the file opens in BDOBB 8.0.0 or later. **Export locked widgets…** is disabled while nothing is locked, and **Export all dashboards…** leaves the bands out when both are empty, because empty bands are not worth carrying.

**Importing replaces them.** There is one set of bands, and therefore no merge: empty bands are filled silently, and bands that already hold something ask first — *Importing will replace your locked widgets on both edges. This cannot be undone.*, with **Replace** and **Keep mine**. The import's notice ends *, and replaced your locked widgets* or *, and kept your locked widgets*; the dashboards in the same file are imported either way. While the Locked Widgets editor is open an import leaves the bands alone, without asking, and its notice ends *, and left your locked widgets alone: the Locked Widgets editor is open*. **Import locked widgets…**, the rail's **Import apps.json…**, **File ▸ Import apps.json…** in the desktop menu bar and a dropped file all run that same check. On the way in a band height outside 2–24 is brought back inside it, a band keyed to anything but the top or bottom edge is not carried, and a second marked app is ignored — the first wins.

That guard is also why **no shared example dashboard carries locked widgets**: importing one would offer to replace yours. To share a band, export it on purpose and hand over that file.

Two routes do not carry the bands. A `bdobb-settings.json` holds your preferences and the rail's folder tree and nothing else. And the **Apps** catalogue's **Open** builds dashboards only: a served app marked as locked widgets is left out there, and the rest of the app opens. See [[import-and-export|Import and Export]].

---
*Source: the in-app "Pinned cards" and "Locked widgets" topics; `src/components/DashboardGrid.tsx` (the pinned bands), `src/components/DockBand.tsx`, `src/lib/dockLayout.ts`, `src/lib/dashboardsFile.ts` (the hidden `docks` dashboard), `src/stores/dashboardStore.ts`, `src/components/dialogs/SettingsDialog.tsx`, `src/lib/appsExtensionsV8.ts`, `src/lib/docksImport.ts`, `src/lib/docksSync.ts` and `src/lib/agent/localTools.ts` (`pin_card`) at 8.0.0; openbq-docker `docs/v8/news-relay-and-hidden-dashboards.md`. Ported from the bdobb-v2 v8.1.2 guide page of the same name and checked against this line's code.*
*See also: [[news-widget|The News Widget]] · [[settings-and-logs|Settings and Logs]] · [[widget-cards|Widget Cards]] · [[layout-and-navigation|Layout and Navigation]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v10.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
