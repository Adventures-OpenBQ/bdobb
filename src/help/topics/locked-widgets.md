# Locked widgets

A **locked** widget belongs to the app, not to a dashboard: it sits in a band
along the top or the bottom of the window on every dashboard, every tab and
every workspace, with its own data, until you take it out. A News wire that is
always along the bottom, whatever you are looking at, is the case it was made
for. A **pinned** card is the per-tab version; see **Pinned cards**.

![A News card locked along the bottom, under an ordinary dashboard](./shots/locked-widgets.png)

## Defining them

Locked widgets are not reached from a card's menu. Open **Settings ▸ Locked
Widgets**: it shows **Locked at Top** and **Locked at Bottom**, each with a
line saying what is in that band now, and a button that opens the band's
editor — **Locked at Top…** or **Locked at Bottom…**.

Pressing one closes Settings and opens the editor. A band is an edit of its
own, apart from Settings' pending preferences, so any preference change you
had not saved with **Done** is discarded on the way.

The editor is a panel over the dashboard whose canvas is the band exactly as
it will appear: as wide as the dashboard area and as tall as the rows the band
reserves. Its header holds the green **+** that adds a widget — `⌘K` adds to
the band too — a rows stepper (**Shorter** and **Taller**, from 2 to 24 rows;
a new install reserves 6 at the top and 8 at the bottom), **Cancel** and
**OK**. On a short window a band that would push the dashboard off screen
scrolls instead, and **Taller** stops where the dashboard would run out of room. On the canvas the cards have their full controls: move, resize,
Parameters, groups, Rename, Close, and a News card's feed manager. A band is a
small grid, so two locked widgets can share one, side by side or stacked.

**OK** keeps the band and returns you to the dashboard. **Cancel**, or
**Escape**, puts back exactly what the band held when the editor opened —
every add, remove, move, resize, parameter and feed change since — and returns
you to **Settings ▸ Locked Widgets**. Escape goes to whatever is innermost
first: an open menu closes and a maximized card restores before the editor
cancels.

## Outside the editor

A locked widget is fully live — scroll it, switch its tabs, double-click a
story, sort a table, zoom a chart, Refresh, Maximize, Export — but nothing
that would change it is offered: no Rename, Parameters, Configure feeds,
Duplicate, Copy to, Pin widget or Close. To change it, go back to Settings ▸
Locked Widgets. A viewer window shows the bands, read-only.

The bands are mounted once, outside the dashboard switch, so changing
dashboards or tabs never reloads a locked card: a News wire stays connected
and a chart keeps its zoom. The one exception is a date: a locked card follows
the exchange of the dashboard you are viewing, so a card whose dates depend on
that exchange refetches when you switch to a dashboard on another one. The top band sits above the dashboard's tab bar
and the bottom band below the dashboard; a dashboard's own pinned cards sit
inside them. An empty band takes no space. The bands' rows come off the
dashboard area whatever the window size, so two tall bands suit a large
monitor.

## Where they live and how they travel

The two bands are one hidden dashboard, `dashboards/docks.json`, so it never
appears in the rail, the dashboard order or the `⌥` shortcuts, and no single
dashboard's export carries it.

**They sync.** With a Workspace connection that offers the dashboard sync, the
bands are one hidden record on the server — on openbq-docker,
`/pro/dash/sync/system/docks` — and your devices share one set: whichever side
was edited last wins, with no question asked. Openbq-docker's own Workspace web
app does not list it. A server without that route keeps the bands on this
device and says nothing.

**They export.** **Export locked widgets…**, under Settings ▸ Locked Widgets,
writes both bands to `Locked widgets.apps.json`; it is disabled while nothing
is locked. **Export all dashboards…**, on the rail's *MY DASHBOARDS* menu,
writes every dashboard and the bands to one file. Either way the bands ride
BDOBB's v8 extension, so the file opens in BDOBB 8.0.0 or later and never as
an ordinary dashboard.

**Importing replaces them.** There is one set of bands, so an import cannot
merge. **Import locked widgets…**, the rail's **Import apps.json…**,
**File ▸ Import apps.json…** and a dropped file all run the same check: empty bands are filled silently; bands
that hold something ask first — *Importing will replace your locked widgets on
both edges. This cannot be undone.* — with **Replace** and **Keep mine**. The
dashboards in the same file import either way. For that reason the example
dashboards never carry locked widgets: share a band as its own file, on
purpose.

A `bdobb-settings.json` carries none of this. The Apps catalogue's **Open**
does not either: a served app marked as locked widgets is left out and the
rest of the app opens.

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v9.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
