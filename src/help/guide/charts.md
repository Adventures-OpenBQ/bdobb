---
type: Note
tags: [bdobb, help, widgets, charts, plotly]
---

# Charts

BDOBB draws its charts as Plotly figures inside a card, which is what every `chart` widget in the OpenBB world produces and what any table with a time column can be turned into. The one exception is the TradingView chart, described below.

There are two ways to get a Plotly chart. A widget whose declared type is `chart` is drawn as a chart, with no detection involved — though **Raw** is still offered in its view dropdown, and choosing it wins. Any *other* card whose rows turn out to carry a time column also gains a **Chart** entry in the header's view dropdown, beside the card's own kind, **Raw** and, on a table, **Transposed** — decided by the data that actually arrived, so it can appear only after the first load.

A table widget can also say how its rows chart. When any of its columns declares a `chartDataType`, the chart takes its x-axis from the first `time` column (or, failing that, the first `category` column) and plots only the `series` columns; `excluded` columns are never plotted, and the **Chart** entry is offered only when there is an axis and at least one series. The widget's `chartView.chartType` picks the drawing — `line`, `area`, `column` (vertical bars), `bar` (horizontal bars) or `scatter`; any other type draws as a line — and `chartView.enabled: true` opens a newly added card on its chart. A card that already saved a view keeps it. A Plotly figure from the backend is still drawn exactly as it arrives.

![A price chart drawn from a table payload](../attachments/charts.png)

## What a chart widget can return

Either of two shapes.

**A ready-made Plotly figure** — an object with both a `data` array and a `layout` object, which is what OpenBB's own charting produces. It is drawn exactly as it arrives, in whatever colours it already carries; the app does not re-theme a provider's own figure.

**An array of rows.** The app looks for a column whose values are date-shaped — `YYYY-MM-DD`, optionally with a time after it — by sampling the first five rows. Column names are irrelevant; only the values decide. That column becomes the x-axis. Then:

- if `open`, `high`, `low` and `close` are all present and numeric, you get a **candlestick** — and if there is a numeric `volume` column too, it is drawn as bars on its own axis in the bottom fifth of the plot;
- otherwise you get **one line per numeric column**, each named after its column, with a legend.

With no date-shaped column, the x-axis is the one non-numeric column if there is exactly one — quarters, sectors, tickers — and otherwise the first column. As long as at least one numeric column is left to go up it, you get **one bar series per numeric column**.

"Numeric" means every non-null value in those first five rows is a number. A mostly-text column with one stray number does not qualify, and a bare year like `2026` is not date-shaped and will not become an x-axis. If none of that applies, the card says *Nothing chartable in this payload.*

The bundled Plotly draws scatter, candlestick, bar, heatmap, pie, indicator, waterfall and Sankey traces. A ready-made figure asking for anything else says so and names the trace type it wanted.

Two other chart widget types render here as well. A `chart-highcharts` or `chart-vegalite` widget carries a Highcharts or Vega-Lite specification instead of a Plotly figure; the app translates the common cases — line, area, bar, column and scatter — into the same bundled Plotly, so they draw as ordinary chart cards rather than raw JSON. A spec that uses something the translation does not cover falls back to the card's **Raw** view.

The reference backend's **TradingView Chart** (`advanced_charting`) is drawn with TradingView's open-source lightweight-charts library rather than Plotly: daily candles for the widget's default symbol over the last year, with volume bars in the bottom fifth, in the colours the widget declares. It refreshes on the widget's own update interval and follows the light/dark theme. The mouse wheel over it scrolls the card rather than zooming the chart; drag to pan. A **Rendered by TradingView** line under the chart links to the library's page. Drawing tools, indicators, symbol search and resolution — the features of TradingView's full charting library — are not supported.

Create a **linked chart** from a table’s card menu or the Widget Library’s source dialog. You can chart the presented categories and measures, or choose a financial chart for adjusted prices, observed yields, guarded quarterly estimates or a pinned income statement. The controls, source requirements and meaning of blank observations are in [[linked-widgets|Linked Widgets]].

## Daily returns and watchlist panels

Choose **Return distribution**, bind the presented date and adjusted price, choose a symbol, and apply. Select 5–100 bins. Each count represents a finite return between adjacent usable daily prices. A flat price contributes a zero return. A missing or nonpositive price interrupts the sequence. Hover a bar for its bounds, observation count and share of the sample. The last bin includes its upper bound. Constant returns share one centered bin.

Choose **Small multiples** and select up to twelve symbols in panel order. Every series starts at 100 on the first shared positive price date and ends at the earliest last delivered date among those symbols. The panels share date and index scales. Broken lines mark known gaps. Resizing the card wraps panels into one, two or three columns. Both daily charts require documented complete or bounded daily prices and show the acquisition window.

## ETF concentration and exposure

**ETF holdings Pareto** ranks delivered constituents by reported weight of fund assets. The bars show individual weights and the line accumulates the displayed holdings on the same scale. The chart shows at most 50 and separately reports the count and weight of all distinct holdings delivered to it. Transport scope and provider holdings coverage appear separately. Filtering the source changes the rows in the calculation.

**ETF exposure** draws a stem and dot for each reported sector or geographic category, including zero weights. Hover a dot for its percentage of equity exposure. Scroll inside a long list to reach every category. The source must establish one fund, the matching exposure kind and the weight basis. To switch from sectors to regions, use **Card menu → Choose source**, select the corresponding **Exposure mode**, check its category field and apply.

## Screening, dividends and income flows

These linked charts answer one question from one table’s presentation and its acquired source evidence. Set the source table’s parameters and filters, then use **Apply chart settings** to commit the chart’s field bindings and selection. Use **Card menu → Choose source** when the question needs a different table. For EODHD, the source request must opt in with `chart_source=true`.

**Screening bubble** plots fractional dividend yield against fractional five-day price change. Bubble area represents market cap in one verified listing currency, up to 48 px diameter. Choose **Latest** or one presented **Price date**. **Show regression** fits an unweighted line with an intercept to the usable delivered listings for that date when there are at least three points and both variables vary. The card reports its acquired sort, filters, offset, limit, retrieval time and sample counts. Yield and market cap can have a different measurement date from the price-data date. An older date selects a cohort from this delivery. Universe coverage and random sampling are unverified. Conflicting acquired listings or denominations can prevent drawing even if a table filter hides them.

**Dividend steps** uses one qualified instrument, an inclusive verified acquisition window and one payment currency. Hover an ex-date marker to read its split-adjusted amount per current share. Historical levels can restate after splits. A known invalid or filtered event interrupts the line, which ends at the last usable historical event. Unknown or clipped coverage prevents drawing. The paired live EODHD dividend route currently reports unknown coverage. The example’s explicit snapshot verifies its event interval.

**Income Sankey** uses one actual FY or FQ period from a typed income **Statement** table. It requires full-record evidence, statement reporting currency and an explicitly verified monetary multiplier. Hover to read original values in the declared source units. Income bridges reconcile their adjacent anchors. In particular, operating and non-operating changes are derived differences. Cost of revenue and income tax expense appear as independent components when the source supports them. A loss in an anchor, nonpositive revenue or unknown monetary scale prevents drawing. The paired live EODHD income route currently reports unknown scale. The example snapshot declares its multiplier. Scroll the fixed diagram or tap a band or node on a touch screen.

## Zoom, pan and reset

There is no chart toolbar — the mode bar is off.

- **Zoom** by dragging a rectangle over the plot.
- **Pan** by shift-dragging — Plotly's own default.
- The **scroll wheel does not zoom**, so scrolling over a chart scrolls the card rather than the chart.
- **Double-click anywhere on the plot** resets zoom and pan. The double-click window is a generous 600 milliseconds, measured from the first press; miss it and nothing happens at all — you never get half a reset.

Refreshing a chart's data reconciles the existing plot in place, so **a refresh keeps your zoom and pan** — an auto-refresh, a card **Refresh** and `⌘R` all leave the view where you put it, and so does flipping the theme. What *does* reset the view is changing the question: apply a different symbol, or any other parameter, and the chart opens at its full extent, because a view framed around one series' range is rarely the right frame for another's. A backend that supplies its own view-preserving key in a ready-made figure keeps it.

Resizing the card redraws only when the box really changed size.

Charts the app draws itself follow the light/dark theme. A ready-made figure from a provider keeps the colours the provider chose. Candlestick charts deliberately have Plotly's range slider turned off: it would eat about 15% of the plot area and pin the y-axis, which would make the y-range unzoomable and therefore unresettable.

---
*Source: BDOBB v3.3.0 in-app manual, "Charts"; `BDOBB` `widgetsJson`, `src/lib/plotly.ts`, `src/lib/highcharts.ts`, `src/lib/vegaLite.ts` and `src/components/renderers/ChartRenderer.tsx` at `v3.3.0`; `BDOBB` `src/lib/chartShapes.ts` at `v3.0.6`.*
*See also: [[tables|Tables]] · [[widget-cards|Widget Cards]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v9.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
