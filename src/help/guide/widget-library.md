---
type: Note
tags: [bdobb, help, interface, widget-library, widgets, search]
---

# The Widget Library

The library lists everything every connected backend serves, plus the app's own built-in widgets. It opens four ways: the rail's **Add widget (⌘K)** row, the rail's **Widget Library** row, the green `+` at the right end of the tab strip, or `⌘K` from anywhere that is not a text field. It covers the dashboard but starts at the collapsed rail's right edge, so the rail stays usable behind it. Close it with `✕` or **Escape**.

Opening it moves the keyboard with it: the **Search widgets** box takes focus, so `⌘K` followed by typing goes straight into the search rather than to the dashboard behind, and Tab walks the library rather than the grid underneath. Closing it puts focus back on whatever opened it.

![The widget library with the Type filter set to table](../attachments/widget-library.png)

## Searching and filtering

The **Search widgets** box matches, case-insensitively, against both a widget's name and its description, and combines with the six filters as an AND. Left to right the filters are **Backend**, **Category**, **Subcategory**, **Provider**, **Type** and **On dashboard**.

The first five derive every option from the widgets actually loaded — never hardcoded — so a type like `chart` simply will not appear until a backend serves one. Only **Subcategory** depends on another filter: choosing a Category narrows it to that category's own subcategories. **Provider** matches any one of a multi-source widget's providers; a widget with no provider at all — which is every built-in — appears under **All providers** but under no specific one.

**On dashboard** is the exception: its options are your dashboards themselves, in rail order. Choosing one keeps only the widgets already on that dashboard, on any of its tabs; two dashboards sharing a name are told apart by the folder path after the name.

**Backend** lists each connection by its name in Connections, plus **Built-in** for the widgets that ship with the app; a connection that discovered nothing is not listed, and removing the selected one returns the filter to **All backends**. It is not the same as **Provider**: two connections can serve the same provider.

**Reset** clears all six selects and does **not** clear the search box.

## What a card tells you

Under each widget's name: the backend it came from (its Connections name, **Built-in**, or the bare id of a removed connection), then its provider, verbatim, or **Multisource** with the full list as a tooltip, or no badge when it has none. Then its type exactly as the backend declares it — `table`, `markdown`, `pdf`, `html`, `chart`, and so on.

**The provider badge is coloured by the same probe the Provider API Keys dots show:** green, the vendor accepted the key; amber, it rejected the key or returned an error; red, it did not respond. A provider nothing has probed yet stays the plain outlined badge, and one that needs no key is never probed and never coloured. Hover for the meaning in words. A **Multisource** badge takes the worst of its providers' colours, because the widget is only as good as its weakest one. That Settings tab takes key-maint's own name for it: **Provider API Keys** from a key-maint that also serves the settings widget, as openbq-docker's does; *Provider API Keys (panel)* from an older key-maint that serves only the `keys` widget.

Those probes run once at app start and again whenever **Refresh** or a saved key in **Settings ▸ Provider API Keys** re-probes — so a key you have just fixed recolours the library without a restart. With a Key Maintenance connection the key service tests every provider at once, server-side, and only reports results from tier 2 up; without one the app tests a few vendors at a time itself. See [[provider-keys|Provider Keys]].

Below the badges is the widget's description, and under that one pill per dashboard the widget is already on, in rail order; beyond three, the rest collapse into a `+N` pill that names them in its tooltip. The pill for the dashboard this library adds to is drawn in the accent colour.

At this version a badge row wider than its card — a long provider name beside a long type — does not wrap. It widens the card's layout past the card's edge, the description is laid out at that wider width, and the overhang is clipped, so the badges run off the card and the description looks as if it does not wrap.

## Adding: click, double-click, drag

- **Single click** adds one card, immediately, to the dashboard and tab the library was opened from, and leaves the library open so you can add several. Enter or Space on a focused card does the same.
- **Double-click** adds the widget **once** and then takes you back to that tab, closing the library. The first click of the pair did the adding; the second only means "and take me there".
- **Drag** a card onto a **dashboard row in the rail** to add it to *that* dashboard. Dropping on a different dashboard lands the card on the tab that dashboard was showing (its first tab if you have not opened it) and switches to it; in a workspace the dashboard takes a tile, as a new dashboard does; the library stays open. Cards can only be dropped on rail rows — not on the grid and not on a tab.

New cards land **below everything already on the tab**, whichever way they were added. A widget that takes a `symbol` starts from **Settings ▸ General ▸ Default widget ticker**, or from the most recently added sibling card's symbol when *Match dashboard symbol* is on — see [[card-parameters|Card Parameters]].

## How you know it worked

There is no toast. A widget already on the target tab is drawn shaded, and its accessible name becomes `Add <name> (already on this tab)` — updated live, so a card you just clicked shades immediately without the library closing. A double-click confirms by taking you to the tab. A drag confirms by moving the rail's active-dashboard marker to the row you dropped on.

## Three things you will not find here

Widgets of type `keys` are never listed — that surface lives in **Settings ▸ Provider API Keys** and is not a card you add. Neither are widgets of type `local_table`: those cards are made by dropping a data file on the dashboard, which is what puts a file behind them, so one added from here would have nothing to read. Nor are widgets of type `settings`: each is a section of the Settings dialog instead — see [[settings-and-logs|Settings and Logs]]. All three types still appear in the **Type** filter, so a manifest entry never vanishes without explanation.

If nothing is listed at all: *No widgets discovered. Add a backend in Connections to populate the library.* If your search and filters match nothing: *Nothing matches your search or filters.*

---
*See also: [[widget-cards|Widget Cards]] · [[built-in-widgets|Built-in Widgets]] · [[provider-keys|Provider Keys]] · [[connecting-a-backend|Connecting a Backend]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v6.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
