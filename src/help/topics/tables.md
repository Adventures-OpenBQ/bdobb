# Tables

A table card draws every row of its payload. There is no paging and no row cap;
only a window of rows is ever really in the page, which is what keeps a
hundred-thousand-row answer usable. Sorting and filtering always work over the
whole set, not the visible window.

The body is one scroll box with the header row pinned to the top of it.
Changing a sort or a filter jumps you back to the top, deliberately — the old
scroll offset would land you in the middle of a different result.

![A table card with its sector column menu open](./shots/tables.png)

One honest wrinkle: column widths are sized from the rows currently on screen,
so on a column of very variable text the widths can shift as you scroll.

## Sorting

Click a column header to sort it, ascending first (`▲`); click again for
descending (`▼`). **Shift-click** a second header to add it to the sort. When
more than one column is sorted, each shows its position as a small number
beside the arrow.

A plain click on the *last* column of a multi-sort just flips that column and
keeps the rest. A plain click on any other column replaces the whole multi-sort
with a single sort on that column.

Right-clicking a header does not sort, and neither does clicking the thin
resize handle at its right edge.

## The filter row

The `⌕` **Filter rows** button in the card header shows a second header row
with one control per visible column:

- text — one box, *contains*, case-insensitive substring
- number — **min** and **max**, inclusive
- date — **From** and **To**, two text boxes that start at the column's first
  and last date. Type a date as `YYYY-MM-DD`; it applies on Enter or when you
  leave the box. Anything else is outlined in red, reads *Use YYYY-MM-DD* and
  changes nothing; an emptied box drops that end. **Clear** puts both back to
  the first and last date. While the filter row is open a date column widens
  to fit both boxes, and returns to its own width when the row closes
- boolean — a dropdown of **any**, **true**, **false**, matched exactly
- anything structural — no control at all, rather than a guessed one

At the right end of the filter row, after the last column, sit **Clear**, which
clears every filter on the card, and a live count reading `142 of 5,000 rows`,
on one line.

The filter *row* is not remembered — reopening the dashboard starts with it
hidden — but the filter *values* are. It is horizontally sticky only, so it
scrolls out of view as you go down.

## Columns: showing, hiding, reordering and pinning

Two ways in.

The `⋯` menu's **Columns ▸** lists every column in its current order as
`☑ Header` or `☐ Header`, each with a `◀` **Pin left** and `▶` **Pin right**
button. Pressing the arrow a column is already pinned to unpins it, so the two
arrows are one three-state toggle.

**Right-clicking a column header** opens a menu at the pointer with
**Pin left**, **Pin right**, **Unpin**, then **Hide**. The item matching the
column's current state is disabled. Escape or a click outside closes it.

**Reorder by dragging a column header onto another header.** A pinned column
can only be dropped among pinned columns and an unpinned one only among
unpinned ones — to move a column across that line, pin or unpin it first. Start
the drag anywhere on the header except the resize handle.

Pinned columns really are sticky: they stay at the edge while the rest scrolls
sideways. Your pin overrides whatever the backend declared, and you may unpin
something the backend pinned.

Resize by dragging the handle at a header's right edge; the width is saved a
moment after you let go.

## Reset table

The `⋯` menu's **Reset table** clears the card's whole saved table state at
once — sorting, filters, column order, hidden columns, widths and your pins —
and the table goes back to the layout the backend described. It does not touch
the `⌕` toggle, the view mode, the parameters, the title or the card's size.

## Clicking a cell to drive other cards

A backend can mark a column so that clicking a cell assigns that value to a
named parameter. Such a cell looks exactly like an ordinary cell until you
hover or focus it, when it gains an accent underline; it is reachable by Tab
and Enter.

Clicking commits through the same path as editing the control in the header.
If the card belongs to a
parameter group for that parameter, the group value moves and every card in the
group refetches; if not, only this card's own parameter changes. A column can
be set up to send a different value than the one it shows — a ticker behind a
company name, for instance — and to force the source table to refetch as well.

Clicking a blank cell does nothing: an empty value must not wipe a shared
parameter.

## What the backend controls

A widget can describe its columns, and when it does the app honours: which
field each column shows, its header text and tooltip, its data type (which
picks the filter control), its starting width and resize bounds, whether it
starts hidden, whether it starts pinned, and how its values are formatted.

Formatting covers integers, percentages (`5.12 %`), normalised values scaled by
a hundred, and years pulled out of ISO dates. A per-column decimal-places
setting overrides **Settings ▸ Widget ▸ Maximum decimal places**. Empty cells
always render as an em dash.

Two cell treatments are honoured: `greenRed`, which colours numbers by sign
(zero is neither), and colour rules, which set a cell's text or background from
conditions like *greater than*, *between* or *contains* — the first matching
rule wins, and colour rules override `greenRed` entirely. There are no link,
badge or sparkline cell renderers; a column asking for one draws a plain cell
rather than an error.

Sorting, filters, column order, hidden columns, widths and pins are all saved
per card. None of it is included in an `apps.json` export, and none of it is
saved from a viewer window.

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v3.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
