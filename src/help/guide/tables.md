---
type: Note
tags: [bdobb, help, widgets, tables, columns, sorting, filtering, pivot, formulas, linked-data]
---

# Tables


A table displays a window of rows while sorting and filtering operate over its loaded input, not just the visible window. Local and linked report tables use a worker for calculation and transfer bounded row blocks for display. This does not promise unlimited file size or out-of-core processing; sample and partial-data warnings still apply.

The body is one scroll box with the header row pinned to the top of it. Changing a sort or a filter jumps you back to the top, deliberately — the old scroll offset would land you in the middle of a different result.

![A table card with its sector column menu open](../attachments/tables.png)

One honest wrinkle: column widths are sized from the rows currently on screen, so on a column of very variable text the widths can shift as you scroll.

## Sorting

Click a column header to sort it, ascending first (`▲`); click again for descending (`▼`). **Shift-click** a second header to add it to the sort; each sorted column then shows its position as a small number beside the arrow. A plain click on the *last* column of a multi-sort just flips that column and keeps the rest; a plain click on any other column replaces the whole multi-sort with a single sort on that column. Right-clicking a header does not sort, and neither does clicking the thin resize handle at its right edge.

**Sorting from the keyboard** is the header menu's first three items — **Sort ascending**, **Sort descending**, and **Clear sort** once there is a sort to clear. A `<th>` is not something the browser lets you activate, so Enter and Space on a focused header open that menu rather than sorting; these items are what make a sort reachable without a pointer. The item matching the column's current direction is disabled. Every sortable header also announces its state, so a screen reader says which column is sorted and which way.

**How values are ordered.** Each column sorts by what it actually holds rather than by whatever the first screenful suggested: numbers compare numerically, text compares without regard to case, and **missing values sort last in both directions** — a blank is not a very small number, and burying nulls at the top of a descending sort helped nobody.

A column whose field name contains a dot — `BRK.B`, `AAPL.US`, a literal `1.5` — reads correctly. Such a name is a name, not a path into a nested object.

## The filter row

The `⌕` **Filter rows** button in the card header shows a second header row with one control per visible column: a *contains* box for text, **min** and **max** for numbers, **From** and **To** for dates (text boxes that start at the column's first and last date; type `YYYY-MM-DD`, or a date expression as a date parameter takes it (`T-1bd`, `T-26w`, `FQ-4` …), which stays an expression — the box keeps showing it, its tooltip names today's day, and every refresh works the day out again — and press Enter or leave the box to apply it; anything else is outlined in red and changes nothing, and the column widens to fit both boxes while the row is open), a dropdown of **any**/**true**/**false** for booleans, and no control at all for anything structural or a column that is null in every row. At the right end of the row, after the last column, sit **Clear**, which clears every filter on the card, and a live count reading `142 of 5000 rows`, on one line.

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

Sorting, filters, column order, hidden columns, widths and pins are all saved per card. A **Strict OpenBB Workspace** save omits it; a **BDOBB Workspace** save carries supported table preferences, and none of it is saved from a viewer window.

## Pivot reports, Page sets and formulas

The **Pivot** button on a backend table opens its pivot panel above the table — **Row Groups**, **Column Groups** and **Data Columns** — and saves the arrangement with the card; a backend table pivots in the app, not in the background table engine. For local and linked tables the button opens a drawer. **Arrange** places categories in Rows, Columns or Page and orders the values in Data Columns. **Categories**, **Measures**, **Pages**, **Formulas**, **Category filters**, **Result filters** edit their definitions. **Saved → Model** shows definitions, warnings and repair; **Saved → Statement template** maps a pinned financial template. Tables without a report model open on the four-list chooser; the first arrangement edit saves a model, or choose **Enable report model** in the Arrange footer. **Pivot on** enables the saved report; turning it off displays source data while retaining the report definition and source constraints. Escape returns an editor to Arrange, then closes the drawer; the close button returns focus to Pivot.

A measure is an independent instance of a source field, with its own aggregation and label. Duplicate Revenue to keep Total and Average together; changing one does not change the other. Arrange controls their placement and order. Only the measures you add appear: a table without a report model opens with Data Columns empty. A new data column, from Move to Data Columns or **Add measure**, starts with no aggregation; its pill reads *Choose aggregation* and its cells stay blank until you choose one. Nothing is summed implicitly. First/Last requires a date category in report mode. **Show grand total** is in the Measures footer.

### One Page category, a complete member set

Pages chooses one category and a set of members. Changing the category creates a draft: explicitly choose members, then **Save page**. It does not transplant the old selection or choose the first member. **Select all** saves the observed eligible members as an explicit set; **None** saves an empty set and therefore produces no matching records. **Delete page** removes the saved Page placement and member restriction. These are different operations: an explicit set does not automatically include a new member acquired later.

The header and panel show set counts, titles and details without using the first member as the entire selection. Saved unavailable members remain visible until you explicitly remove them. Previous/Next Page navigation applies to a singleton selection. The promotion checkbox shows Page first in the Parameters row. When a linked group or viewer session masks the saved Page, the panel identifies its draft as the saved baseline rather than pretending it is the effective result.

### Source constraints, qualifying groups and comparisons

Source filters and search first constrain the acquired universe. Category checklists and Page constrain the report. Result filters then qualify groups at their chosen category level; the surviving source records are deduplicated before totals and formulas are evaluated again. A grand-total margin is a ratio of the underlying totals, not an average of displayed margins. Removing Budget with a source filter or checklist makes a Budget comparison unavailable; the engine does not fetch missing records or substitute zero.

Formulas support numeric/string/boolean literals, arithmetic, comparisons, SUM, MEAN, MEDIAN, MIN, MAX, FIRST, LAST, COUNT, UNIQUECOUNT and IF. Source-row formulas operate on individual records; aggregate formulas bind independent measures or explicit aggregations. Use the reference picker to insert stable field, measure, formula and comparison-member references. An ambiguous label with duplicate measures requires the explicit instance; changing a label does not change its identity.

The worker binds comparison members against observed typed identities, including members excluded by source constraints. Its picker pages the observed domain and distinguishes missing, excluded, ambiguous and partial evidence. Binding is not permission to bypass the source filters. Formulas keep visible errors for those cases, division by zero and invalid bindings. Expressions are bounded at 16 KiB UTF-8, 1,024 AST nodes and depth 64 (parser nesting 256); an oversized expression is refused rather than truncated into a different calculation.

### Calendar and fiscal categories

**Y** and **Q** use the chosen report-date field for calendar years and quarters. **FY** and **FQ** are already implemented in this engine; they do not depend on a later provider release. Choose the report-date source, **Company field**, and either company-specific fiscal metadata or explicit **Fiscal year**, **Fiscal quarter**, **Period start** and **Period end** field mappings, with the appropriate bound period kind. Map fields that actually describe the supplied period; quarterly rows alone do not establish annual period bounds.

Missing fiscal context remains an error. The report does not guess a December year end. Same-label fiscal periods can cover different dates for different companies, so nonalignment warnings remain visible. **Saved → Model → Company period bounds** shows the interpretation before you compare companies. Provider enrichment may supply metadata later; it is separate from the client transform itself.

### Confirmed groups and viewer sessions

Promoted Page and category filters can use dashboard parameter groups. Owner **Create**, **Link**, **Unlink**, **Edit shared value** and push actions show a reviewed selection and require confirmation. Linking defaults to taking the group's value. A changed draft needs a refreshed review; source, ownership or relevant target changes can refuse the operation. Full reviewed values are distinct from a bounded header preview. Ambiguous comma transport, unsupported bindings and incomplete evidence are refused visibly, preserving the authored baseline.

A successful change offers an eight-second session **Undo**. It restores only the relevant change and refuses conflicting later edits, changed source authority or new members of a newly created group. It is not a durable history across reload. Ordinary endpoint-backed group members can refetch when a shared value changes; the table root recalculates against its acquired input rather than reacquiring that file just for a report/group edit. See [[card-parameters|Card Parameters]] for ordinary groups.

Viewer choices are session-local and do not save the dashboard or mutate shared groups. **All** removes the member restriction while retaining the saved Page category; **None** is an empty set. **Reset** restores the current linked/saved baseline, including group changes made since the session choice. Reload drops the viewer override. A viewer cannot open owner write confirmations.

### Linked subsets and inspection

Create a linked table or chart from the card menu or the Widget Library's source dialog. The root owns acquisition and calculation; a linked table receives its current public subset and can add its own constraints. A chart uses that output without a second aggregation. With no explicit selection the complete presented output is used; **Select all** includes eligible rows outside the visible window. Selecting a parent and its descendant never contributes overlapping records twice. Folding, scrolling and off-tab sources do not limit the logical output. Hidden private columns stay out of linked output while formulas may still use those full private inputs.

A report with categories only in Columns displays aggregate cells in its pinned grand total. These footer cells are not default linked-table/chart input and are not included in Select all. Add a Row category to publish groups. Legacy split-only pivots have a different eligible logical Total row. See [[charts|Charts]].

**Saved → Model** remains available for malformed imported intent or a disappearing source field. Definitions, warnings, company bounds and linked groups report the worker's actual bounded evidence. **Advanced repair** retains invalid text and failed drafts; a repaired definition must validate against the current source schema before it executes. A row cap or a preview is not proof of complete membership. Acquisition completeness and coverage warnings propagate through links and charts.


---
*Source: BDOBB v3.3.0 in-app manual, "Tables"; `BDOBB` `TableRenderer`, `columnRender`, `SparklineCell` and `dotFont` at `v3.3.0`; `BDOBB` `src/lib/tableColumns.ts` and `src/components/renderers/HoverCardCell.tsx` at `v3.0.5`; `BDOBB` `src/lib/sparkline.ts` at `v3.2.2`.*
*See also: [[widget-cards|Widget Cards]] · [[card-parameters|Card Parameters]] · [[import-and-export|Import and Export]]*

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
badges distinguish local settings from template defaults.
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

*Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0. SPDX-License-Identifier: Apache-2.0*
