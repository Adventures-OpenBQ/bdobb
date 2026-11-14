# Linked widgets

A linked widget is a table or chart that draws from another table on the
same dashboard instead of asking a backend. It fetches nothing of its own:
when the source table's rows change, the linked card follows.

## Making one

- From a table card's `⋯` menu: **Create linked table** or **Create linked
  chart**. The new card is added at once, below everything on the tab you are
  looking at, with this card as its source.
- From the widget library: the built-ins **Linked table** and **Linked
  chart**. A click opens a small dialog with a **Source table** dropdown;
  pick a source and press **Create linked table** (or **Create linked
  chart**). These two cannot be added by double-click or by dragging, because
  they need a source first.

The dropdown lists every eligible table on the dashboard, from every tab, as
*card title — tab name*. With none it reads *No eligible table sources in
this dashboard.*

## What can be a source

A table card on the same dashboard, showing its **Table** view: a dropped data
file, a backend table widget, a server snapshot (managed table), or another
linked table. A linked chart is never a source, nor is a LIVE · paged table or
a card switched to its Chart, Transposed or Raw view, and a choice that would
make a loop is refused. The two **Create linked** items appear only on a card
that can be a source. A backend table over 2,000,000 cells offers neither
item, and a card linked to one reports *This table is too large for the table
engine*.

## A linked table

It has its own sorting, filters, columns and **Pivot** drawer, saved with the
card, so one source can feed several differently arranged tables. See
**Tables**.

## A linked chart

Its controls sit above the plot and save as you change them:

- **Chart type** — **Columns (vertical)** (the default), **Bars
  (horizontal)** or **Lines**.
- **Category** — the column along the axis.
- **Measures** — a checkbox for each numeric column.
- **Display** — **Grouped** or **Stacked**; not offered for Lines.

Until a category and at least one measure are chosen it reads *Choose chart
fields: select a category and numeric measures.* When a chosen field
disappears from the source it reads *Field … is unavailable. Repair chart
fields.* When the source's current scope is successfully empty, for example
after a filter leaves no rows, the chart clears its previous figure and reads
*No selected series match the current filter.* Partial or sample source data
keeps its coverage warnings under the chart.

## Changing or losing the source

**Choose source** — in the `⋯` menu of a linked card, and as a button in its
body — opens the same dialog to point it at another table. There is no
unlink: to stop following a source, remove the card.

While the source is updating, the card keeps showing its last completed result
and reads *Showing completed data (stale).* A linked chart also reads
*Updating chart — showing completed data (stale).* If the source is removed or
stops being eligible, the card reads *Source unavailable* until you choose
another.

**Duplicate** keeps the link. **Copy to ▸** another dashboard drops it, since
a link can only name a card on its own dashboard.

A **BDOBB Workspace** save carries the link and the chart settings; a
**Strict OpenBB Workspace** save writes the card without them. In a viewer
window the chart controls, **Choose source** and the two **Create linked**
items are not offered.

## Linked groups in a pivot

A Page or category filter promoted from a pivot can be linked to a dashboard
parameter group (see **Tables**). Such a control carries a **Group** button
that opens a *Linked group* panel: the group's name and value, whether a
viewer-session choice is overriding it, why the link cannot apply when it
cannot (*Grouping is disabled*, *Group is unavailable*, and so on), and the
members the table has actually seen, a hundred at a time with **Previous
group page** and **Next group page**. Escape or a click outside closes it.
**Saved → Model** lists the same panel for every linked pivot group, up to 64.

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v5.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
