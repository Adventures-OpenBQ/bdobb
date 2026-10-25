# The widget library

The library lists everything every connected backend serves, plus the app's own
built-in widgets. It opens four ways: the rail's **Add widget (⌘K)** row, the
rail's **Widget Library** row, the `+` at the right end of the tab strip, or
`⌘K` from anywhere that is not a text field.

It covers the dashboard but starts at the collapsed rail's right edge, so the
rail stays usable behind it. Close it with `✕` or **Escape**.

![The widget library with the Type filter set to table](./shots/widget-library.png)

## Searching

The **Search widgets** box matches, case-insensitively, against both a widget's
name and its description. It combines with the five filters as an AND.

## The five filters

Left to right: **Backend**, **Category**, **Subcategory**, **Provider**,
**Type**. Each starts at **All backends** / **All categories** /
**All subcategories** / **All providers** / **All types**.

Every option is derived from the widgets actually loaded — never hardcoded — so
no option can ever return nothing, and a type like `chart` simply will not
appear until a backend serves one.

Only **Subcategory** depends on another filter: choosing a Category narrows it
to that category's own subcategories, and if your current subcategory would be
stranded it resets to **All subcategories** in the same move. Backend,
Category, Provider and Type always list everything, so choosing one never makes another's
options vanish underneath you.

**Backend** lists your connections by their name in Connections, plus
**Built-in** for the widgets that ship with the app, and keeps only the widgets
that connection discovered. A connection that discovered nothing is not listed.
If you remove the selected connection, the filter goes back to
**All backends**. **Provider** is the data source a widget names, which is not
the same thing: two connections can both serve FMP widgets.

**Provider** matches any one of a multi-source widget's providers. A widget
with no provider at all — which is every built-in — appears under
**All providers** but under no specific provider.

**Reset** clears all five selects. It is disabled while none is set, and it
does **not** clear the search box.

## The badges on a card

Under each widget's name: first the backend it came from, by its name in
Connections, or **Built-in**. A widget whose connection has since been removed
shows that connection's id. Then its provider, verbatim, or **Multisource**
(with the full list as a tooltip) when it has more than one, or no badge at all
when it has none. Then its type, exactly as the backend declares it —
`table`, `markdown`, `pdf`, `html`, `chart`, and so on, lowercase.

Below the badges is the widget's own description.

## Adding: click, double-click, drag

- **Single click** adds one card to the dashboard and tab the library was
  opened from, and leaves the library open so you can add several. Enter or
  Space on a focused card does the same.
- **Double-click** adds the widget once, takes you back to that dashboard and
  tab, and closes the library. This is the "add one and go look at it"
  gesture.
- **Drag** a card onto a **dashboard row in the rail** to add it to *that*
  dashboard. Dropping on a different dashboard lands the card on its first tab
  and switches to it; dropping on the one you are already on lands it on the
  tab you are looking at. The library stays open. Cards can only be dropped on
  rail rows — not on the grid and not on a tab.

A single click is scheduled a quarter of a second later, so a double-click can
cancel it. Escape inside that window cancels every pending add.

## How you know it worked

There is no toast. A widget already on the target tab is drawn shaded, and its
accessible name becomes `Add <name> (already on this tab)` — and that updates
live, so a card you just clicked shades immediately without the library
closing. A double-click confirms by taking you to the tab. A drag confirms by
moving the rail's active-dashboard marker to the row you dropped on.

## Two things you will not find here

Widgets of type `keys` and `settings` are never listed — those surfaces live
in the Settings dialog, as **Provider API Keys** and whatever other sections a
backend adds, and are not cards you add.

If nothing is listed at all: *No widgets discovered. Add a backend in
Connections to populate the library.* If your search and filters match nothing:
*Nothing matches your search or filters.*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v3.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
