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

For Columns, Bars, Lines and Pie, choose a **Category** and one or more **Measures**. Columns and Bars support grouped, stacked and percentage displays. The controls for each financial chart depend on its source.

- **Drawdown** measures the percentage decline from the highest adjusted close seen in the loaded history for each chosen symbol. The area breaks at a missing price.
- **Yield curve** compares observed dates using normalized rates and maturities in months. A missing tenor leaves a gap. The legend identifies the observation date.
- **Monthly returns** uses the final observed adjusted close in each completed calendar month and the immediately preceding month. A missing month-end price and an incomplete month each explain the blank in their hover text. A zero return displays zero.
- **Correlation** compares consecutive daily adjusted-close returns for up to 25 selected symbols. Lookback counts return-date positions through their common cutoff. Hover over a pair for its overlap count (N) and first and last paired return dates. Insufficient overlap and zero variance leave a blank cell.
- **Estimate range** shows the low, average and high for a reported fiscal quarter. The provider checks whether its trend EPS average is within 10% of the recorded consensus as a matching heuristic. Use the fiscal period end to identify each quarter. A withheld quarter keeps its label and reason. Present the instrument and consistent currency or units when the chart asks for them. The source table gives each quarter’s full provider note.
- **Bullet** compares actual EPS or revenue with available estimates and the previous quarter in the filtered table. A multi-row source must identify one instrument through its presented symbol or acquisition receipt. Each period end must identify one row. Choose **Quarter** for a specific period or the latest. Withheld and missing estimates leave the recorded consensus available as the beat comparison when supplied.
- **Waterfall** uses the pinned income Statement model’s reported period columns and line identities. Expenses decrease the running balance even when you move them to another section. **Other** reconciles the steps shown with the next reported subtotal. Hover for the residual amount.

For the five recipe charts, select the presented fields and choose **Apply chart settings**. History calculations need evidence of a complete or explicitly bounded acquisition. Daily prices require the acquired date bounds, daily interval and identifiable instrument. Ordinary backend results arrays carry unknown acquisition scope. They remain available in the table. Supply a complete snapshot or one with bounded dates to use them for history. A partial, paged, sampled or unknown acquisition shows a refusal. Filtering can also remove continuity evidence. Widening a chart’s lookback uses only data already delivered to its source.

## Changing or losing the source

**Choose source** — in the `⋯` menu of a linked card, and as a button in its body — opens the same dialog to point it at another table. There is no unlink: to stop following a source, remove the card.

While the source is updating, the card keeps showing *Showing completed data (stale).* If the source is removed or stops being eligible, the card reads *Source unavailable* until you choose another.

**Duplicate** keeps the link. **Copy to ▸** another dashboard drops it, since a link can only name a card on its own dashboard.

A **BDOBB Workspace** save carries the link and the chart settings; a **Strict OpenBB Workspace** save writes the card without them. See [[import-and-export|Import and Export]]. In a viewer window the chart controls, **Choose source** and the two **Create linked** items are not offered.

## Linked groups in a pivot

A Page or category filter promoted from a pivot can be linked to a dashboard parameter group (see [[tables|Tables]]). Such a control carries a **Group** button that opens a *Linked group* panel: the group's name and value, whether a viewer-session choice is overriding it, why the link cannot apply when it cannot (*Grouping is disabled*, *Group is unavailable*, and so on), and the members the table has actually seen, a hundred at a time with **Previous group page** and **Next group page**. Escape or a click outside closes it. **Saved → Model** lists the same panel for every linked pivot group, up to 64.

---
*Source: BDOBB v4.0.0 `src/components/LinkedWidgetDialog.tsx`, `src/components/LinkedGroupInspector.tsx`, `src/components/WidgetCard.tsx`, `src/components/renderers/LinkedChartRenderer.tsx`, `src/lib/widgetData/sources.ts`, `src/lib/tableExecution/eligibility.ts` and `src/stores/dashboardStore.ts`.*
*See also: [[tables|Tables]] · [[charts|Charts]] · [[widget-cards|Widget Cards]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v9.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
