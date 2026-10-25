# The widget library

The library lists everything every connected backend serves, plus the app's own
built-in widgets. It opens three ways: the rail's **Widget Library** row, the
green `+` at the right end of the tab strip, or `⌘K` from anywhere that is not
a text field. While the Locked Widgets editor is open, the editor's own green
`+` and `⌘K` open it for the band being edited, and what you add lands there;
see **Locked widgets**.

It covers the dashboard but starts at the collapsed rail's right edge, so the
rail stays usable behind it. Close it with `✕` or **Escape**.

![The widget library with the Type filter set to table](./shots/widget-library.png)

## Searching

The **Search widgets** box matches, case-insensitively, against both a widget's
name and its description. It combines with the six filters as an AND.

## The six filters

Left to right: **Backend**, **Category**, **Subcategory**, **Provider**,
**Type**, **On dashboard**. Each starts at **All backends** /
**All categories** / **All subcategories** / **All providers** / **All types** /
**Any**.

The first five derive every option from the widgets actually loaded — never
hardcoded — so a type like `chart` simply will not appear until a backend
serves one. Three
**Type** options do return nothing: `keys`, `settings` and `local_table` are
listed there but are never shown as library cards, because the keys panel lives
in **Settings ▸ Provider API Keys** (the tab takes key-maint's own name: on an
older stack, *Provider API Keys (panel)*), a settings widget is a section of the
Settings dialog, and a local table is made by dropping a file on a dashboard.

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

**On dashboard** is the exception: its options are the dashboards themselves,
in rail order, not anything derived from the widgets on screen — so a dashboard
carrying none of them stays selectable and answers with the no-match state.
Choosing one keeps only the widgets already on that dashboard, on any of its
tabs. Two dashboards sharing a name are told apart by the folder path after the
name — *Macro (Research)* — where there is one to show; the filter follows the
dashboard itself, so renaming it changes nothing. Delete the chosen dashboard
while the library is open and the filter lets go of it rather than silently
hiding everything.

**Reset** clears all six selects. It is disabled while none is set, and it
does **not** clear the search box.

## The badges on a card

Under each widget's name: first the backend it came from, by its name in
Connections, or **Built-in**. A widget whose connection has since been removed
shows that connection's id. Then its provider, verbatim, or **Multisource**
(with the full list as a tooltip) when it has more than one, or no badge at all
when it has none. Then its type, exactly as the backend declares it —
`table`, `markdown`, `pdf`, `html`, `chart`, and so on, lowercase.

The provider badge carries the colour of the same probe the **Provider API Keys**
dots show: **green** the vendor accepted the key, **amber** it rejected the key
or returned an error, **red** it did not respond. A provider nothing has probed
yet — which is all of them until the first results land — stays the plain
outlined badge, and one that needs no key at all is never probed and never
coloured. Hover for the meaning in words. A **Multisource** badge takes the
worst of its providers' colours, because the widget is only as good as its
weakest one, and its tooltip says what each of them answered.

Those probes run once at app start and again whenever **Refresh** or a saved
key in **Settings ▸ Provider API Keys** re-probes — so a key you have just fixed
recolours the library without a restart. A second (viewer) window never
probes. With a **Key Maintenance** connection, the app sends a single request
and the key service tests every provider at once, server-side; without one,
the app tests a few vendors at a time itself, never blocking the window.
On the Key Maintenance path the colours are the results that service reports,
and it only reports them from tier 2 up: below that every badge stays the plain
outlined state no matter how many times you refresh.

Below the badges is the widget's own description, and under that one pill per
dashboard the widget is already on, in rail order — the wider picture the
shading cannot give you, since that only ever speaks about the tab you would be
adding to. Beyond three, the rest collapse into a `+N` pill that names them in
its tooltip. The pill for the dashboard this library adds to is drawn in the
accent colour, so it and the shaded card agree.

## Adding: click, double-click, drag

- **Single click** adds one card, immediately, to the dashboard and tab the
  library was opened from, and leaves the library open so you can add several.
  Enter or Space on a focused card does the same.
- **Double-click** adds the widget **once** and then takes you back to that
  dashboard and tab, closing the library. The first click of the pair is what
  did the adding; the second only means "and take me there". This is the
  "add one and go look at it" gesture.
- **Drag** a card onto a **dashboard row in the rail** to add it to *that*
  dashboard. Dropping on a different dashboard lands the card on the tab that
  dashboard was showing (its first tab if you have not opened it) and switches
  to it; in a workspace the dashboard takes a tile, as a new dashboard does; dropping on the one you are already on lands it on the
  tab you are looking at. The library stays open. Cards can only be dropped on
  rail rows — not on the grid and not on a tab.

**Linked table** and **Linked chart** are the exception: a click opens a
dialog that asks for the source table first, and they cannot be dragged. See
**Linked widgets**.

## How you know it worked

There is no toast. A widget already on the target tab is drawn shaded, and its
accessible name becomes `Add <name> (already on this tab)` — and that updates
live, so a card you just clicked shades immediately without the library
closing. A double-click confirms by taking you to the tab. A drag confirms by
moving the rail's active-dashboard marker to the row you dropped on.

## Three things you will not find here

Widgets of type `keys` are never listed — that surface lives in
**Settings ▸ Provider API Keys** and is not a card you add. Neither are widgets of
type `local_table`: those cards are made by dropping a data file on the
dashboard, which is what puts a file behind them, so one added from here would
have nothing to read. Nor are widgets of type `settings`: each is a section of
the Settings dialog instead. See **Settings and logs**.

If nothing is listed at all: *No widgets discovered. Add a backend in
Connections to populate the library.* If your search and filters match nothing:
*Nothing matches your search or filters.*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v8.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
