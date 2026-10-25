# Tables

<!-- Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

A table displays a window of rows while sorting and filtering operate over its
loaded input, not just the visible window. Local and linked report tables use
a worker and transfer bounded display blocks. This does not promise unlimited
file size or out-of-core processing; sample and partial-data warnings still apply.

The body is one scroll box with the header row pinned to the top of it.
Changing a sort or a filter jumps you back to the top, deliberately — the old
scroll offset would land you in the middle of a different result.

![A table card with its sector column menu open](./shots/tables.png)

One honest wrinkle: column widths are sized from the rows currently on screen,
so on a column of very variable text the widths can shift as you scroll.

## Server tables

**Server snapshot** identifies a managed table. Connect to the configured table
service in Connections, then choose its managed table widget. Upload CSV, TSV,
JSON or Excel in **Server execution**, or bind an allowed backend source. The
**Dropped file execution** selector also sends dropped files to that service.
The saved dashboard keeps a private source reference and your model; reopening
recreates server sessions. Other accounts cannot open your uploaded source.
**Delete server source** permanently removes that source; remove a card alone
when you want to keep the upload for later. Operators control source retention.

Pivot, formulas, filters, selection, charts, linked tables and Statement use the
complete managed snapshot. A server source bound to a statement widget, one
whose **Period** offers FY and FQ in its backend's widgets.json, is relabelled
when the server fetches it, from each company's fiscal year end, the same way a
backend statement card relabels its rows. The server tells a statement widget
itself; nothing is set per widget. With no year end, or when the server cannot
read its backend's widgets.json, the rows stay as the provider sent them and the
card says *Fiscal labels as reported*. Display pages are bounded. Card **Export** includes
all eligible presented rows; selected charts and linked tables honor selection.
An export already started keeps its admitted result while a refresh publishes
another. Interrupted or refused exports fail visibly; they never become a
successful partial download. **Reopen table** recovers an expired session. Use
**Re-upload or rebind source** when its saved source is missing.

**LIVE · paged** identifies a standard OpenBB SSRM provider. Its pages may change
between requests. Sorting, filtering, grouping and aggregation follow the
provider's declared capabilities. Whole-result formulas, selection, charts,
exports and linked tables require a managed source. They are unavailable for
LIVE pages because loaded rows cannot represent the complete result. Warnings
from the backend, such as FINRA's 250,000-record cap, appear as a notice line
under the header, and boolean values display even in a column declared text.

The OpenBQ API's largest datasets open as LIVE · paged tables: FINRA bonds and
bond prices, the FFIEC institution tables, the large EIA series, CFTC swap and
FX forward trades and the rest of the API's tables over about 10 MB. Each page
is fetched, sorted and filtered on the server, with text and number filters
only; grouping and the whole-result features above are not offered. Through
the web preview, the first open of the very largest can time out while the
server prepares it; Reopen shows it once ready.

Resource-limit and busy messages preserve the last delivered result where
possible. Close unused tables and retry Reopen after other work finishes; ask
the operator to review limits for repeated refusals. A browser hard reload can
leave old server sessions until their bounded expiry, temporarily using capacity.

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
  and last date. Type a date as `YYYY-MM-DD`, or a date expression as a date
  parameter takes it (`T-1bd`, `T-26w`, `FQ-4` ...). An expression stays an
  expression: the box keeps showing it, its tooltip names the day it means
  today, and every refresh works the day out again, so `T-1bd` moves on with
  the calendar. A box applies on Enter or when you leave it.
  Anything else is outlined in red, reads *Use YYYY-MM-DD or a date expression
  such as T-1bd* and changes nothing; an emptied box drops that end. **Clear** puts both back to
  the first and last date. While the filter row is open a date column widens
  to fit both boxes, and returns to its own width when the row closes
- boolean — a dropdown of **any**, **true**, **false**, matched exactly
- anything structural — no control at all, rather than a guessed one

At the right end of the filter row, after the last column, sit **Clear**, which
clears every filter on the card, and a live count reading `142 of 5000 rows`,
on one line. A table computed in the background — a local file, or a card
linked to another card's data — shows only its filtered count, such as
`142 rows`.

The filter *row* is not remembered — reopening the dashboard starts with it
hidden — but the filter *values* are. It is horizontally sticky only, so it
scrolls out of view as you go down.

## Columns: showing, hiding, reordering and pinning

The `⋯` menu's **Columns ▸** lists every column in its current order as
`☑ Header` or `☐ Header`. Toggle an entry to show or hide it. Use the column
header menu to pin or unpin it.

**Right-clicking a column header** opens a menu at the pointer with
**Sort ascending**, **Sort descending** and, once there is a sort,
**Clear sort**, then **Pin left**, **Pin right**, **Unpin**, then **Hide**. The item matching the
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

Some columns send the row to Rita instead: clicking fills the backend's message
template with that row's values and puts it in the Rita box, unsent (see **Rita →
Sending a table row**). These cells need a Rita URL and Context sharing on, and
are plain on an off-limits card, in a single-dashboard window and on grouped or
total rows.

## What the backend controls

A widget can describe its columns, and when it does the app honours: which
field each column shows, its header text and tooltip, its data type (which
picks the filter control), its starting width and resize bounds, whether it
starts hidden, whether it starts pinned, and how its values are formatted.

Formatting covers integers, percentages (`5.12 %`), normalised values scaled by
a hundred, and years pulled out of ISO dates. A per-column decimal-places
setting overrides **Settings ▸ Widget ▸ Maximum decimal places**. Empty cells
always render as an em dash.

Cell treatments honoured: `greenRed`, which colours numbers by sign (zero is
neither); `titleCase`; and colour rules, which set a cell's text or background
from conditions like *greater than*, *between* or *contains* — the first
matching rule wins, and colour rules override `greenRed` entirely. A
`sparkline` column draws an array of numbers or points as an inline line,
area or bar chart, with high/low markers and a hover tooltip. Point values use
the configured `yKey`, or `y` by default. A `hoverCard` column opens a small
card when you point at the cell, and a `showCellChange` column flashes green or
red when its value changes. Any other renderer a column asks for draws a plain
cell rather than an error.

A widget can also declare a starting pivot under `data.table.pivot`: its Row
Groups (`grouping`), Column Groups (`split`), date buckets and aggregation
functions, on unless it says `enabled: false`. The card's table opens pivoted
that way until you change the pivot, which then saves with the card; a
malformed part of the preset is dropped, never the widget.

Sorting, filters, column order, hidden columns, widths and pins are all saved
per card. A **Strict OpenBB Workspace** save omits it; a **BDOBB Workspace** save carries supported table preferences, and none of it is
saved from a viewer window.

## Report models, formulas and live links

**Pivot** on a local, linked or backend table opens the drawer; a backend
table runs on the table engine like a local file. Only a backend table too large
for the engine (over 2,000,000 cells) keeps its own pivot panel (Row Groups,
Column Groups, Data Columns), saved with the card. Arrange places categories
and orders values; Categories, Measures, Pages, Formulas and Result filters edit their definitions. **Saved → Model** shows definitions, warnings and repair; **Saved → Statement template** maps a financial template. A table without a report model opens on the four-list chooser. Its first arrangement edit saves a report model; **Enable report model** is also available in the Arrange footer. **Pivot on** enables the saved report. Turning
it off shows source data while retaining the report definition. **Clear groups**, at the top of the Arrange
panel, turns the pivot off and empties Row Groups and Column Groups; the data columns and their aggregations stay. Categories can use native values or **Y**, **Q**, **FY**, **FQ**.
Calendar years and quarters use the report date. Fiscal categories need an
explicit company and date bindings plus fiscal period fields or company-specific
metadata. Missing context remains an error; the report does not guess a December
year end. Mixed fiscal calendars show a warning:
same-label periods can cover different dates. Inspect the period bounds before
comparing companies. Page selects a complete set of members from one category.
**All** removes the member restriction; **None** selects an empty set. Saved
unavailable members remain visible rather than silently selecting another.
Previous/Next navigation is available for singleton selections.

Source filters first remove records from the input universe. Category
checklists and Page constrain the report. Result filters qualify groups once
at their configured category level; surviving records are deduplicated, then
totals and formulas are evaluated again. A grand-total margin is the ratio of
those underlying totals, rather than the average of displayed margins. Removing
Budget with a source filter or checklist makes a Budget comparison unavailable;
it does not fetch missing records or treat them as zero.

Formulas support numeric/string/boolean literals, arithmetic, comparisons,
SUM, MEAN, MEDIAN, MIN, MAX, FIRST, LAST, COUNT, UNIQUECOUNT and IF. Use the
reference picker to insert bracketed fields, measures, formulas and comparison
members. Source-row formulas operate on individual records; aggregate formulas
need bound measure instances or explicit aggregations. Expressions are bounded
at 16 KiB UTF-8, 1,024 AST nodes and depth 64 (parser nesting 256). Invalid,
ambiguous, excluded and missing references remain visible errors.

Comparison members are bound by the worker against observed typed identities,
including members excluded by source constraints. The picker pages the observed
domain and distinguishes excluded, unavailable and ambiguous members. Binding
a reference does not fetch missing source records or change those constraints.
Worker errors stay errors rather than becoming zero.

Promoted Page and category filters can link to dashboard parameter groups. Owner
Create, Link, Unlink and Edit shared value actions show a complete reviewed
selection and require confirmation before saving. Linking defaults to pulling
the group value. A successful change offers bounded session Undo; Undo refuses
conflicting later edits and is not retained after reload. Viewer choices are
session-local: All, None and selected members override the linked baseline;
Reset restores the current baseline without saving dashboard changes. Shared
comma transport refuses ambiguous or unrepresentable values instead of guessing.
See **Card parameters** for ordinary parameter behavior.

Only the measures you add appear in Data Columns; a table without a report
model opens with none. A new data column starts with no aggregation: its pill
reads *Choose aggregation* and its cells stay blank until you choose one.
Each duplicate measure is its own stable instance with its own aggregation and
label. A field-name alias binds only when exactly one measure instance matches;
with duplicates, choose the explicit instance. Renaming a label does not change
its identity. First/Last in report mode needs a date category.

Create a linked table or chart from a table's card menu or Widget Library source dialog.
The source table owns acquisition and calculation. A linked table receives the
complete presented output and can add its own model; a chart uses only table
output, without a second aggregation. With no explicit selection the complete
presented output is used. Select all includes eligible rows outside the visible
block. Selecting a parent and descendant never contributes overlapping values
twice. Scrolling and folding do not limit linked output, and off-tab sources
remain available.

Deleting a source makes dependents show a missing-source notice; Undo restores
the source identity and retained file. Links are dashboard-local. Duplicate
rows and keyless files use local identities, which cannot guarantee that an
edited or reordered external file represents the same records. Imported sample
or partial data retains its coverage warnings through links and charts.

### Column-only report totals

A report model with categories only in Columns displays aggregate cells in its pinned grand total. These footer cells are excluded from default linked-table and chart input and from Select all. A linked widget therefore receives no rows from a column-only report, even when its footer shows values. Add a Row category to publish report groups. Legacy split-only pivots differ: their logical Total row remains eligible for linked widgets and selection.

Report column Hide and reorder change presentation and linked output while formulas continue to use the full private source inputs. Inspect model remains available when an imported report is malformed or a linked field disappears. Advanced repair retains your draft when a save fails or you close inspection. Saving requires current source schema and a valid model; invalid intent never executes.

## Statement models

Open **Pivot → Saved → Statement template** on a table without a report model.
Choose Income statement, Balance sheet, or Cash flow statement. Each bundled
snapshot is version **1.0.0**. Map the current source fields explicitly: company,
fact period kind, fiscal evidence, optional currency/unit, and monetary lines.
Wide sources map fields to line items; long sources bind item/value fields and
use the displayed stable line IDs as item values. Unmapped optional lines stay
absent; missing facts are never replaced by zero.

Select FY or FQ to match the source fact kind. Mixed kinds are refused; quarterly
facts do not implicitly become annual facts. Monetary periods require authoritative
fiscal bounds or source metadata. Flows require the complete requested contiguous
period coverage. Stocks use the requested latest authoritative endpoint. Ratios
and other derived lines use bound formulas; missing inputs, duplicate facts,
overlapping periods and mixed company/currency/unit contexts remain errors.
Use **Load company members** to select a Company Page, or **All companies** to
retain all members. All does not authorize combining incompatible monetary contexts.

**Calculate preview** runs the local candidate in the existing worker against the
current source. The preview shows at most 100 calculated rows and the full result
count; it is a sample, not the entire report. Wide expansion costs grow with
source rows multiplied by mapped fields; the existing 500-column pivot limit and bounded formula/definition validation
still apply. The 100-row preview limit bounds delivery, not worker calculation
cost; large expansions can still be expensive. Preview never changes the active model. **Apply Statement model**
activates only after a successful guarded durable save. Cancellation, stale source
changes and failed saves retain the draft and last valid result.

Labels, section/line ordering, visibility and bound formula definitions are local
overrides. Each section has a **Visible** control; hidden sections mark child lines
as **Hidden by section**, retaining their individual visibility choices. Origin
badges distinguish local settings from template defaults. Labels you type in the Statement panel are limited to 4096 characters.
Resetting overrides preserves source mappings and Page selections. Renaming or
reordering does not rebind a formula. Formula overrides keep their stable formula
ID and explicit AST references.

The embedded snapshot is pinned and read-only. There is no newer bundled release
currently. **Explicit template update** accepts a supplied validated snapshot for
preview. The **Before / After** comparison retains changed labels, defaults,
formulas, policies, formats, mappings and order while you edit the candidate.
Removed or changed references require explicit conflict repair and a new
calculated preview before application. Opening a dashboard never upgrades it.
Invalid or unknown saved definitions remain inert and inspectable under
**Saved → Model → Advanced repair**; repair uses the current source schema. Read-only
viewers cannot save Statement edits. Existing viewer exploration stays session-only.

Statement cell formats follow an explicit formula format, then the template line
format, then a consistent source format for mapped lines. A Statement `percent`
format displays a ratio such as `0.4` as `40 %`; imported source format hints
retain their own semantics. Raw numeric values and per-cell formats travel to
linked tables and charts; formatting does not change chart values.

XLS/XLSX source hints recognize simple integer, decimal and percentage number
formats under unique text headers. Custom workbook formats and ambiguous headers
remain unformatted; currency symbols are not inferred or converted.

Statement calculations require compatible company, currency and unit contexts across the facts actually used by a formula. Mixed contexts produce a cell error; they are never silently added or subtracted. Unrelated lines do not invalidate a formula. When fiscal evidence comes from source metadata, switching FY/FQ preserves that metadata binding. Explicit period fields still require the corresponding fiscal year, quarter and start/end bounds.

## Rita and tables

Rita can inspect and arrange **CSV/XLS, managed server and linked tables** through the same
table model as the Pivot drawer. She reads a table with `describe_table` and
applies one all-or-nothing arrangement with `arrange_table`; one Undo reverts
it (see **Rita**). Backend tables are arranged the same way. Only a
standard LIVE table answers `server-execution-pending`, because its paging
runs on the server; choose a managed server source for full
analytical scope. A backend table too large for the table engine answers
`runtime-not-ready` with the reason. The
table's tab must be open, or she is asked to open it. Analytical and linked
tables are read-only to Rita in viewer mode, except the viewer controls the
table already exposes, which she can change for that session only.
