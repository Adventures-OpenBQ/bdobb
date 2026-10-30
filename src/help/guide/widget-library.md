---
type: Note
tags: [bdobb, help, interface, widget-library, widgets, search]
---

# The Widget Library

The library lists everything every connected backend serves, plus the app's own built-in widgets. It opens four ways: the rail's **Add widget (⌘K)** row, the rail's **Widget Library** row, the green `+` at the right end of the tab strip, or `⌘K` from anywhere that is not a text field. It covers the dashboard but starts at the collapsed rail's right edge, so the rail stays usable behind it. Close it with `✕` or **Escape**.

Opening it puts the caret in the **Search widgets** box, so `⌘K` and then typing does what you meant without a click on the way. Closing it hands focus back to whatever had it before — the rail row or the `+` you came in by — so the keyboard picks up where it left off.

![The widget library with the Type filter set to table](../attachments/widget-library.png)

## Searching and filtering

The **Search widgets** box matches, case-insensitively, against both a widget's name and its description, and combines with the five filters as an AND. Left to right the filters are **Backend**, **Category**, **Subcategory**, **Provider** and **Type**.

All five derive every option from the widgets actually loaded — never hardcoded — so a type like `chart` simply will not appear until a backend serves one. Only **Subcategory** depends on another filter: choosing a Category narrows it to that category's own subcategories. **Provider** matches any one of a multi-source widget's providers; a widget with no provider at all — which is every built-in — appears under **All providers** but under no specific one.

**Backend** lists each connection by its name in Connections, plus **Built-in** for the widgets that ship with the app; a connection that discovered nothing is not listed, and removing the selected one returns the filter to **All backends**. It is not the same as **Provider**: two connections can serve the same provider.

**Reset** clears all five selects and does **not** clear the search box.

## What a card tells you

Under each widget's name: the backend it came from (its Connections name, **Built-in**, or the bare id of a removed connection), then its provider, verbatim, or **Multisource** with the full list as a tooltip, or no badge when it has none. Then its type exactly as the backend declares it — `table`, `markdown`, `pdf`, `html`, `chart`, and so on.

Below the badges is the widget's own description.

When a widget declares an `imgUrl` (an `http` or `https` address), hovering its card or moving keyboard focus to it shows that image under the description. An image that fails to load shows nothing.

At this version a badge row wider than its card — a long provider name beside a long type — does not wrap. It widens the card's layout past the card's edge, the description is laid out at that wider width, and the overhang is clipped, so the badges run off the card and the description looks as if it does not wrap.

## Adding: click, double-click, drag

- **Single click** adds one card, immediately, to the dashboard and tab the library was opened from, and leaves the library open so you can add several. Enter or Space on a focused card does the same.
- **Double-click** adds the widget **once** and then takes you back to that tab, closing the library. The first click of the pair did the adding; the second only means "and take me there".
- **Drag** a card onto a **dashboard row in the rail** to add it to *that* dashboard. Dropping on a different dashboard lands the card on its first tab and switches to it; the library stays open. Cards can only be dropped on rail rows — not on the grid and not on a tab.

New cards land **below everything already on the tab**, whichever way they were added. A widget that takes a `symbol` starts from **Settings ▸ General ▸ Default widget ticker**, or from the most recently added sibling card's symbol when *Match the symbol on the dashboard* is on — see [[card-parameters|Card Parameters]].

## How you know it worked

There is no toast. A widget already on the target tab is drawn shaded, and its accessible name becomes `Add <name> (already on this tab)` — updated live, so a card you just clicked shades immediately without the library closing. A double-click confirms by taking you to the tab. A drag confirms by moving the rail's active-dashboard marker to the row you dropped on.

## Two things you will not find here

Widgets of type `keys` and `settings` are never listed — those surfaces live in the Settings dialog, as **Provider API Keys** and whatever other sections a backend adds, and are not cards you add. Neither are widgets of type `local_table`: those cards are made by dropping a data file on the dashboard, which is what puts a file behind them, so one added from here would have nothing to read. All three types still appear in the **Type** filter, so a manifest entry never vanishes without explanation.

If nothing is listed at all: *No widgets discovered. Add a backend in Connections to populate the library.* If your search and filters match nothing: *Nothing matches your search or filters.*

---
*Source: BDOBB v3.0.1 in-app manual, "The widget library"; `BDOBB` `src/components/WidgetLibrary.tsx` at `v3.0.1`.*
*See also: [[widget-cards|Widget Cards]] · [[built-in-widgets|Built-in Widgets]] · [[provider-keys|Provider Keys]] · [[connecting-a-backend|Connecting a Backend]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v3.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
