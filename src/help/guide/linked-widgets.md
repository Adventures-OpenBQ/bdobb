---
type: Note
tags: [bdobb, help, widgets, tables, charts, linked]
---

# Linked Widgets

A linked widget is a table or chart that draws from another table on the same dashboard instead of asking a backend. It fetches nothing of its own: when the source table's rows change, the linked card follows.

## Making one

- **From a table card's `⋯` menu** — **Create linked table** or **Create linked chart**. The new card is added at once, below everything on the tab you are looking at, with that card as its source. See [[widget-cards|Widget Cards]].
- **From the widget library** — the built-ins **Linked table** and **Linked chart**. A click opens a small dialog with a **Source table** dropdown; pick a source and press **Create linked table** (or **Create linked chart**). These two cannot be added by double-click or by dragging, because they need a source first. See [[widget-library|The Widget Library]].

The dropdown lists every eligible table on the dashboard, from every tab, as *card title — tab name*. With none it reads *No eligible table sources in this dashboard.*

## What can be a source

A table card on the same dashboard, showing its **Table** view: a dropped data file, a backend table widget, a server-side table, or another linked table. A linked chart is never a source, a card switched to its Chart, Transposed or Raw view is not one, and a choice that would make a loop is refused.

## A linked table

It has its own sorting, filters, columns and **Pivot** drawer, saved with the card, so one source can feed several differently arranged tables. See [[tables|Tables]].

## A linked chart

Use the card’s **Show parameters** chevron to open **Parameters**, where you can choose the source, chart type and settings. Examples open with the panel closed. Closing it keeps the draft and the applied chart.

For Columns, Bars, Lines and Pie, choose a **Category** and one or more **Measures**. Columns and Bars support grouped, stacked and percentage displays. The controls for each financial chart depend on its source.

Chart configuration is part of the card's **Parameters**. Open the title-bar chevron or **⋯ → Parameters** to choose the source, chart type, category, measures and series layout. The panel starts closed and its open state saves with the card. Closing it leaves the chart and its saved configuration intact. Changes save as you make them:

- **Chart type** — **Columns (vertical)** (the default), **Bars (horizontal)**, **Lines**, **Pie**, **Waterfall** or **Surface (3-D)**.
- **Category** — the column along the axis.
- **Measures** — a button showing what is chosen; it opens a checklist of the numeric columns with **All**, **Clear** and **Apply**. The chart redraws once, on Apply, and the measures keep the source table's column order.
- **Display** — **Grouped**, **Stacked** or **100% stacked**; offered for Columns and Bars.
- **Series from** — **Columns** (one series per measure) or **Rows** (one series per row); not offered for Pie, Waterfall or Surface.

Pie draws one measure; with more than one ticked it reads "Pie shows one measure — choose one". Pie and 100% stacked refuse negative values and zero totals with a message instead of drawing; values that are missing are listed under the chart.

Waterfall walks an income statement from revenue to net income, one coloured walk per year, side by side. It needs a Statement income table with period columns; a balance sheet, cash flow or plain table reads *Waterfall needs an income statement table*, and a measure that is not a period reads *Waterfall needs period columns*. Which way a line steps depends on its original section (Income up, Expenses down), wherever you show it; moving a line only changes its position in the walk (*Expenses shown as decreases.*). Profit lines are drawn at their reported value, with an **Other** step before a subtotal the shown lines do not add up to. Discontinued operations are ordinary steps and `calculated_gross_profit` shows as "(calculated)". EBITDA is not part of the walk: while its row is among the rows the table shows, the chart reads *EBITDA isn't part of the walk — untick it*, so untick or filter that row out of the table. Rows with no value for a year are listed under the chart as *Missing: …*. To put gross and operating profit in the walk, move each into the Expenses section right after its costs (see Statement models in Tables). Display and Series from are not offered.

Surface draws a 3-D surface with the category along one axis, the ticked measures along the other and their values as the height — a volatility surface from a table with a row per strike and a column per expiry. When the source's rows carry `pair` and `date` fields it draws one surface for each pair and date, side by side and titled, on one colour scale, whose range covers only the cells the surface actually draws (a value that is not part of any two-by-two block of values is not drawn, so it does not stretch the colour bar); more than six reads "Surface draws at most 6 plots". With one measure ticked it draws that measure as a line across the category for each pair and date instead. It needs at least two rows per plot. Drag to rotate; missing values are gaps in the surface. Picking Surface on a chart with no category or measures chosen fills them in from the source widget's `chartDataType` hints (see [[charts|Charts]]) when it declares any: the first `time` or `category` column as the category, every `series` column as a measure. When the source is a pivot report, **Category** gives way to **Height**, **Space rows by** and **Space columns by**, each listing the report's values. Height is the value drawn, with the report's rows (strikes) along one axis and its split columns (expiries) along the other, and the ticks carry the members' own labels, at most ten to an axis, spread evenly with the first and last always shown (every point is still drawn and shows its own label on hover). At **Default**, rows and columns sit one step apart (strike rows that are numbers sit at their value); choose a value, such as a mean log-moneyness or a mean root-time, to space them by it instead. A row or column with no spacing value is refused with a message naming it, rather than drawn out of place. In a ragged chain an expiry one underlying lacks is dropped from that underlying's surface only, as is any row or column with no Height value; an underlying with no value in any ticked expiry is left out of the chart, and the chart is refused when no underlying remains. An underlying left with values in only one ticked expiry draws as a line across its strikes, in its own titled panel beside the other underlyings' surfaces; the line keeps its own colour and is not on the surfaces' colour scale. The chart draws one surface per outer row group of the report (one per underlying), up to six; choose which with the checklist on that category in the report's **Pivot** drawer. Narrow the strikes by selecting rows in the report, and press **Clear selection** to see them all again. To leave out an expiry, untick it under **Measures**, which lists the expiries of the chosen Height and opens with every one ticked. **All** (and **Clear**) draw every expiry the report offers, including any it gains later, such as a new listing in a chain whose expiries roll; ticking some and pressing **Apply** saves just those. The `pair`/`date` split still applies to tables that are not pivoted.

- **Drawdown** measures the percentage decline from the highest adjusted close seen in the loaded history for each chosen symbol. The area breaks at a missing price.
- **Yield curve** compares observed dates using normalized rates and maturities in months. A missing tenor leaves a gap. The legend identifies the observation date.
- **Monthly returns** uses the final observed adjusted close in each completed calendar month and the immediately preceding month. A missing month-end price and an incomplete month each explain the blank in their hover text. A zero return displays zero.
- **Correlation** compares consecutive daily adjusted-close returns for up to 25 selected symbols. Lookback counts return-date positions through their common cutoff. Hover over a pair for its overlap count (N) and first and last paired return dates. Insufficient overlap and zero variance leave a blank cell.
- **Estimate range** shows the low, average and high for a reported fiscal quarter. The provider checks whether its trend EPS average is within 10% of the recorded consensus as a matching heuristic. Use the fiscal period end to identify each quarter. A withheld quarter keeps its label and reason. Present the instrument and consistent currency or units when the chart asks for them. The source table gives each quarter’s full provider note.
- **Bullet** compares actual EPS or revenue with available estimates and the previous quarter in the filtered table. A multi-row source must identify one instrument through its presented symbol or acquisition receipt. Each period end must identify one row. Choose **Quarter** for a specific period or the latest. Withheld and missing estimates leave the recorded consensus available as the beat comparison when supplied.
- **Waterfall** uses the pinned income Statement model’s reported period columns and line identities. Expenses decrease the running balance even when you move them to another section. **Other** reconciles the steps shown with the next reported subtotal. Hover for the residual amount.

For the five recipe charts, select the presented fields and choose **Apply chart settings**. History calculations need evidence of a complete or explicitly bounded acquisition. Daily prices require the acquired date bounds, daily interval and identifiable instrument. Ordinary backend results arrays carry unknown acquisition scope. They remain available in the table. Supply a complete snapshot or one with bounded dates to use them for history. A partial, paged, sampled or unknown acquisition shows a refusal. Filtering can also remove continuity evidence. Widening a chart’s lookback uses only data already delivered to its source.


Surface draws a 3-D surface with the category along one axis, the ticked measures along the other and their values as the height — a volatility surface from a table with a row per strike and a column per expiry. When the source's rows carry `pair` and `date` fields it draws one surface for each pair and date, side by side and titled, on one colour scale; more than six reads "Surface draws at most 6 plots". It needs at least two measures and two rows per plot. Drag to rotate; missing values are gaps in the surface.

## Changing or losing the source

In a linked chart or metric, open **Parameters** and select **Choose source**. In a linked table, select **Choose source** from its body or `⋯` menu. Both open the source table dialog. To stop following a source, remove the linked card.

While the source is updating, the card keeps showing *Showing completed data (stale).* If the source is removed or stops being eligible, the card reads *Source unavailable* until you choose another.

**Duplicate** keeps the link. **Copy to ▸** another dashboard drops it, since a link can only name a card on its own dashboard.

A **BDOBB Workspace** save carries the link and the chart settings; a **Strict OpenBB Workspace** save writes the card without them. See [[import-and-export|Import and Export]]. In a viewer window the chart controls, **Choose source** and the two **Create linked** items are not offered.

## Linked groups in a pivot

A Page or category filter promoted from a pivot can be linked to a dashboard parameter group (see [[tables|Tables]]). Such a control carries a **Group** button that opens a *Linked group* panel: the group's name and value, whether a viewer-session choice is overriding it, why the link cannot apply when it cannot (*Grouping is disabled*, *Group is unavailable*, and so on), and the members the table has actually seen, a hundred at a time with **Previous group page** and **Next group page**. Escape or a click outside closes it. **Saved → Model** lists the same panel for every linked pivot group, up to 64.

---
*Source: BDOBB v4.0.0 `src/components/LinkedWidgetDialog.tsx`, `src/components/LinkedGroupInspector.tsx`, `src/components/WidgetCard.tsx`, `src/components/renderers/LinkedChartRenderer.tsx`, `src/lib/widgetData/sources.ts`, `src/lib/tableExecution/eligibility.ts` and `src/stores/dashboardStore.ts`.*
*See also: [[tables|Tables]] · [[charts|Charts]] · [[widget-cards|Widget Cards]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v10.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
