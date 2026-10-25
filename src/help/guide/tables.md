---
type: Note
tags: [bdobb, help, widgets, tables, columns, sorting, filtering]
---

# Tables

A table card draws every row of its payload. There is no paging and no row cap; only a window of rows is ever really in the page, which is what keeps a hundred-thousand-row answer usable. Sorting and filtering always work over the whole set, not the visible window.

The body is one scroll box with the header row pinned to the top of it. Changing a sort or a filter jumps you back to the top, deliberately — the old scroll offset would land you in the middle of a different result.

![A table card with its sector column menu open](../attachments/tables.png)

One honest wrinkle: column widths are sized from the rows currently on screen, so on a column of very variable text the widths can shift as you scroll.

## Sorting

Click a column header to sort it, ascending first (`▲`); click again for descending (`▼`). **Shift-click** a second header to add it to the sort; each sorted column then shows its position as a small number beside the arrow. A plain click on the *last* column of a multi-sort just flips that column and keeps the rest; a plain click on any other column replaces the whole multi-sort with a single sort on that column. Right-clicking a header does not sort, and neither does clicking the thin resize handle at its right edge.

**Sorting from the keyboard** is the header menu's first three items — **Sort ascending**, **Sort descending**, and **Clear sort** once there is a sort to clear. A `<th>` is not something the browser lets you activate, so Enter and Space on a focused header open that menu rather than sorting; these items are what make a sort reachable without a pointer. The item matching the column's current direction is disabled. Every sortable header also announces its state, so a screen reader says which column is sorted and which way.

**How values are ordered.** Each column sorts by what it actually holds rather than by whatever the first screenful suggested: numbers compare numerically, text compares without regard to case, and **missing values sort last in both directions** — a blank is not a very small number, and burying nulls at the top of a descending sort helped nobody.

A column whose field name contains a dot — `BRK.B`, `AAPL.US`, a literal `1.5` — reads correctly. Such a name is a name, not a path into a nested object.

## The filter row

The `⌕` **Filter rows** button in the card header shows a second header row with one control per visible column: a *contains* box for text, **min** and **max** for numbers, **From** and **To** for dates (text boxes that start at the column's first and last date; type `YYYY-MM-DD` and press Enter or leave the box to apply it, anything else is outlined in red as *Use YYYY-MM-DD* and changes nothing, and the column widens to fit both boxes while the row is open), a dropdown of **any**/**true**/**false** for booleans, and no control at all for anything structural or a column that is null in every row. At the right end of the row, after the last column, sit **Clear**, which clears every filter on the card, and a live count reading `142 of 5000 rows`, on one line.

The filter *row* is not remembered — reopening the dashboard starts with it hidden — but the filter *values* are.

## Columns: showing, hiding, reordering and pinning

**Showing and hiding** is the `⋯` menu's **Columns ▸**, which lists every column in its current order as `☑ Header` or `☐ Header`.

**Pinning lives in exactly one place: the column header's own menu.** Right-click a header — or Tab to it and press **Enter**, **Space**, the Context-Menu key or **Shift+F10** — and you get the sort items above, then, after a rule, **Pin left**, **Pin right**, **Unpin**, then, after a second rule, **Hide**. The item matching the column's current state is disabled. Pinned columns really are sticky: they stay at the edge while the rest scrolls sideways. Your pin overrides whatever the backend declared.

**Reorder by dragging a column header onto another header.** A pinned column can only be dropped among pinned columns and an unpinned one only among unpinned ones — to move a column across that line, pin or unpin it first. Resize by dragging the handle at a header's right edge; the width is saved a moment after you let go.

## The transposed view

A table card offers a **Transposed** entry in the header's view dropdown. It turns the table on its side: the **first column's values become the column headers**, each remaining column becomes a row, and a leading **`Field`** column names the original column. A header that repeats an earlier one gets ` (2)`, ` (3)` appended so no two collide.

What you get is a static grid — none of the toolkit applies, because it describes columns that are no longer on screen: no sorting, filtering, pinning, resizing, reordering or column menu while you are in it. Your saved table state is untouched and comes back when you leave. Export follows the view: from the transposed view, **CSV**, **JSON** and **Excel** all write the transposed rows. A payload with nothing to turn on its side shows *Nothing to transpose: the table needs at least one row and two columns.*

## Reset table

The `⋯` menu's **Reset table** clears the card's whole saved table state at once — sorting, filters, column order, hidden columns, widths and your pins — and the table goes back to the layout the backend described. It does not touch the `⌕` toggle, the view mode, the parameters, the title or the card's size.

## Clicking a cell to drive other cards

A backend can mark a column so that clicking a cell assigns that value to a named parameter. Such a cell looks exactly like an ordinary cell until you hover or focus it, when it gains an accent underline; it is reachable by Tab and Enter. Clicking commits through the same path as editing the control in the card's header: if the card belongs to a parameter group for that parameter, the group value moves and every card in the group refetches; if not, only this card's own parameter changes. A column can be set up to send a different value than the one it shows — a ticker behind a company name — and to force the source table to refetch as well. Clicking a blank cell does nothing: an empty value must not wipe a shared parameter.

## What the backend controls

A widget can describe its columns, and when it does the app honours: which field each column shows, its header text and tooltip, its data type (which picks the filter control), its starting width and resize bounds, whether it starts hidden or pinned, and how its values are formatted.

Formatting covers integers, percentages, normalised values, years pulled out of ISO dates, and `none`. A per-column decimal-places setting overrides **Settings ▸ Widget ▸ Maximum decimal places** — except on an integer column, where zero decimals is what `int` means. A null or absent cell renders as an em dash.

One formatting rule is the app's own: a text value that starts with a `YYYY-MM-DD` date, in a column whose name contains `date`, `time`, `timestamp` or `period`, is cut to that date. At this version that applies even to a full timestamp, so a column of intraday times can read as the same day on every row; the card's **Raw** view shows the full value.

Cell treatments honoured: `greenRed`, which colours numbers by sign (zero is neither); `titleCase`; and colour rules, which set a cell's text or background from conditions like *greater than*, *between* or *contains* — the first matching rule wins, and colour rules override `greenRed` entirely. `cellOnClick` is honoured too, as a click target rather than an appearance — see above.

`columnColor` is read and then ignored; a column asking for it draws a plain cell rather than an error. A `sparkline` column draws its array as an inline sparkline — an array of numbers, or of points whose value is read from the key the column's options name as `yKey` (`y` when they name none) — a line, area or bar chart inside the cell, with the high and low points marked and a hover tooltip. A `showCellChange` column flashes a cell green or red the moment its value changes, which is how the live grid shows movement as it streams.

A `hoverCard` column holds an object in each cell. The cell shows the one field the column names. Pointing at the cell, or focusing it, opens a small card filled in from the column's markdown template. When the column is also a click target, a click sends the value the cell shows.

Sorting, filters, column order, hidden columns, widths and pins are all saved per card. None of it is included in an `apps.json` export, and none of it is saved from a viewer window.

---
*Source: BDOBB v3.3.0 in-app manual, "Tables"; `BDOBB` `TableRenderer`, `columnRender`, `SparklineCell` and `dotFont` at `v3.3.0`; `BDOBB` `src/lib/tableColumns.ts` and `src/components/renderers/HoverCardCell.tsx` at `v3.0.5`; `BDOBB` `src/lib/sparkline.ts` at `v3.2.2`.*
*See also: [[widget-cards|Widget Cards]] · [[card-parameters|Card Parameters]] · [[import-and-export|Import and Export]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v3.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
