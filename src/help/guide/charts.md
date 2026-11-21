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

The bundled Plotly draws scatter, candlestick, bar, heatmap, pie, indicator, waterfall, Sankey, box and sunburst traces. A ready-made figure asking for anything else says so and names the trace type it wanted.

The bundled Plotly draws scatter, candlestick, bar, heatmap, pie, waterfall and surface traces. A ready-made figure asking for anything else says so and names the trace type it wanted.

Two other chart widget types render here as well. A `chart-highcharts` or `chart-vegalite` widget carries a Highcharts or Vega-Lite specification instead of a Plotly figure; the app translates the common cases — line, area, bar, column and scatter — into the same bundled Plotly, so they draw as ordinary chart cards rather than raw JSON. A spec that uses something the translation does not cover falls back to the card's **Raw** view.

The reference backend's **TradingView Chart** (`advanced_charting`) is drawn with TradingView's open-source lightweight-charts library rather than Plotly: daily candles for the widget's default symbol over the last year when OHLC data is supplied, or a close-price line when only closes are supplied, with optional volume bars in the bottom fifth, in the colours the widget declares. It refreshes on the widget's own update interval and follows the light/dark theme. The mouse wheel over it scrolls the card rather than zooming the chart; drag to pan. A **Rendered by TradingView** line under the chart links to the library's page. Drawing tools, indicators, symbol search and resolution — the features of TradingView's full charting library — are not supported.

Create a **linked chart** from a table’s card menu or the Widget Library’s source dialog. You can chart the presented categories and measures, or choose a financial chart for adjusted prices, observed yields, guarded quarterly estimates or a pinned income statement. Use **Show parameters** to edit chart or linked KPI settings. The controls, source requirements and meaning of blank observations are in [[linked-widgets|Linked Widgets]].

## Daily returns and watchlist panels

Choose **Return distribution**, bind the presented date and adjusted price, choose a symbol, and apply. Select 5–100 bins. Each count represents a finite return between adjacent usable daily prices. A flat price contributes a zero return. A missing or nonpositive price interrupts the sequence. Hover a bar for its bounds, observation count and share of the sample. The last bin includes its upper bound. Constant returns share one centered bin.

Choose **Small multiples** and select up to twelve symbols in panel order. Every series starts at 100 on the first shared positive price date and ends at the earliest last delivered date among those symbols. The panels share date and index scales. Broken lines mark known gaps. Resizing the card wraps panels into one, two or three columns. Both daily charts require documented complete or bounded daily prices and show the acquisition window.

## Return summaries

Choose **Return summaries** to compare observed daily simple returns for up to twelve qualified listings in your selection order. Use a local JSON snapshot with a receipt documenting the daily interval and date bounds, or a linked table descended from that snapshot. Bind its acquired trading date and adjusted-price fields. Ordinary remote price responses cannot verify this recipe.

**Box** is the default. It reports the median, R7 quartiles, and the most extreme observed returns within 1.5 IQR of the quartiles. Every listing needs at least five returns. Open **Return listing details** or hover the plot to read original fractional values, dated outliers and excluded opportunities. **Violin** smooths the same samples with Gaussian KDE within the observed endpoints and uses a shared density scale. If a listing has fewer than twenty returns or its bandwidth is zero or nonfinite, the card shows boxes and explains why.

Choose **Common inclusive dates** to initialize bounds from the selected listings' overlapping acquired histories. Each listing keeps its own observed sessions and both prices in a return must fall inside the bounds. **Apply chart settings** saves the explicit dates after validation. If a later snapshot cannot supply them, repair the dates or choose each listing's own dates. After opening a source-free Workspace template, drop the snapshot as a local table and use **Choose source**. On touch screens, drag to zoom when the plot fits or swipe to scroll when the comparison overflows.

## Ownership snapshot

Link a table with acquired ownership evidence, then choose **Ownership snapshot**. The default **Independent bars** view uses separate insider, institutional and free-float measures for one qualified issuer. Bind the acquired fields, then select **Apply chart settings**. Observed zero, unavailable data and a cleared binding have distinct labels or markers. Open **Ownership snapshot details** to read each source value, unit, basis and measurement date. The card reports the share class and UTC retrieval time. A refresh uses the latest compatible snapshot acquired by the source table.

The opted-in EODHD ShareStatistics route can verify insider and institutional percentages for US primary common stock. Use `chart_source=true` on the table, selecting `results`, and include `provider=eodhd` on the shared route. Field dates, share class and basis can remain unknown. Direct free float and the data for **Waffle** require separate acquired evidence. Waffle uses 100 squares for an exclusive, exhaustive partition with a common outstanding-shares denominator, one class and one measurement date. Its details give exact bucket values, including buckets with zero cells, and the chart reports any admitted rounding discrepancy.

After importing the source-free example, drop the separate file and use **Choose source**. If the saved issuer is unavailable, attach the intended source or explicitly select the newly acquired issuer and apply. Saving a workspace with an attached file reports `MISSING_LOCAL_ASSET`. For a portable settings file, relink to an empty source card, remove the dropped table and save. Reattach the file after import.

## ETF sunburst

Create a linked chart from an acquired ETF holdings table and choose **ETF sunburst**. Bind the original holding, sector and fractional fund-weight fields. Choose **Sectors** or **Sectors and holdings**, then select **Apply chart settings**. **Latest acquired** follows the holdings source. To keep one observation, choose its report date or acquisition vintage explicitly. If that pin disappears, reattach its snapshot or choose an available snapshot and apply.

Click a sector to drill. On a touch screen, tap once to inspect a wedge and tap it again to drill. Use **Sector view** and **Home** to browse with the keyboard or reach a subpixel wedge. Hover, tap or open **ETF holdings details** to read the original fund weight and the separate share of delivered holdings. Zero weights stay in the details. Unclassified holdings stay in **Sector unavailable**. The card reports the visible weight and the acquired coverage. Filtering discloses omitted holdings and leaves excluded weight unknown.

The opted-in EODHD holdings endpoint uses `chart_source=true`, a qualified US ETF symbol and the `results` selection. Its acquisition vintage dates the fetch. The live report date, completeness and missing weight remain unknown. Report-dated or complete snapshots require compatible acquired holdings evidence. Use a documented local holdings snapshot to try those choices.

For a portable Workspace, relink to an empty local table and remove the dropped file card before saving. An attached file triggers `MISSING_LOCAL_ASSET`. After import, drop the original holdings file and choose it as the source.

## Dual-axis overlay

Drop one prepared local JSON snapshot into the workspace, then use **Choose source** to link that table to a linked chart. Choose **Dual-axis overlay** and select **Adjusted closing price and reported diluted EPS** or **CPI and ten-year Treasury yield**. Apply after the source and its field bindings pass the chart check. If the chart reports missing evidence or unavailable fields, link the matching prepared file or restore the physical fields in the table.

Adjusted close uses the exchange session date and reflects splits and dividends. Diluted fiscal-quarter EPS appears as markers at the acquired release date or time. Hover or tap to read the fiscal period, session timing when known, and the original value. A date-only release gives no ordering against the same day's close. The restatement and vintage disclosures apply to the current acquisition. They do not establish what was known at an earlier date.

CPI uses the measurement month for the monthly, seasonally adjusted all-items US city average CPI-U, series CUSR0000SA0, with the 1982–84 index base. DGS10 is the independent daily nominal ten-year US Treasury constant-maturity yield. The plot formats its fraction as a percent. A release date appears where acquired. Missing or filtered observations remain gaps.

Open **Overlay observations** for original values, units and dates. Zoom when the plot fits or swipe to reach the axes when it overflows. Each y axis scales independently, so apparent movement together depends on the chosen ranges. Both live recipes are unavailable. The examples use synthetic prepared files to demonstrate the local workflow.

An attached local file triggers `MISSING_LOCAL_ASSET` when saving a portable Workspace. Relink the chart to an empty local table, remove the dropped file card and export. After import, drop the matching file and use **Choose source** to attach it.

## Estimate revisions

Drop a verified local JSON history of independently recorded consensus estimates, then use **Choose source** to link that table to a linked chart. Choose **Estimate revisions**, the acquired consensus EPS or revenue metric and the exact fiscal target. **Slope** uses two pinned vintages. **Time path** uses at least three. Filter or select one issuer in the source table. Apply after the selected bindings and pins pass the chart check.

The fiscal target dates identify the reporting period. The separately labeled UTC observation times and batch IDs identify when consensus was recorded. Each position represents one recorded vintage at equal spacing. A restatement recorded in a later batch appears at that later observation time. Hover or tap, or open **Estimate revision observations** for original values, signed absolute changes and eligible percentage changes. A zero or negative reference estimate gives an unavailable percentage. Missing, omitted and errored cells leave gaps.

**Bump** requires a verified complete and stable issuer universe and a positive estimate for every member in one common baseline batch. Pin the exact declared baseline and current vintage IDs. Each eligible column ranks percentage change from the same baseline with tied competition ranks. A missing eligible reading leaves its entire rank column unavailable, including at the current vintage. Other eligible columns retain their ranks.

All live revision views remain unavailable. The live analyst estimates route reports fiscal targets and relative changes without independent observation vintages. The chart uses the recorded history already attached to the source table.

For a portable Workspace, relink to an empty local table and remove the dropped file card before saving. An attached file triggers `MISSING_LOCAL_ASSET`. Drop and relink the recorded file after import. Reacquire a missing saved pin or explicitly replace it with an available vintage.

## Market map

Drop a prepared local JSON market snapshot and use **Choose source** to attach it to a linked chart. Choose **Market map** and check the five physical fields for listing, sector, area, price change fraction and completed session. Keep the acquired universe column in the table. **Delivered-sample capitalization** uses absolute capitalization in one verified listing currency. **Named index weights** is enabled by a compatible source with verified membership and weights valid for the completed price session. A live screener or index-history table cannot establish either source contract. Both live modes are unavailable.

**Latest acquired** follows the compatible session in the selected snapshot. To keep one session, select its acquired date and apply. If a refresh or import cannot supply that pin, reacquire the matching snapshot or explicitly select the newly acquired session. The chart shows the completed close-to-close date range separately from capitalization retrieval or index membership and weight dates.

Click a sector to drill. On a touch screen, tap a tile to inspect it and tap the sector again to drill. Use the breadcrumb or **Home** to return to the root, or choose **Sector view** with the keyboard. **Market map details** lists original qualified listings, areas and return fractions, including tiny tiles. Gray-blue indicates an unavailable return and beige indicates exactly zero. The symmetric return legend is fixed across drills and depends on the visible sample. Filtered index weights retain their original fractions and the root reports delivered components.

An attached file triggers `MISSING_LOCAL_ASSET` when saving a portable Workspace. Relink to an empty local table and remove the dropped file card before exporting. After import, drop the compatible prepared file again and relink. The Workspace preserves your area basis, universe, session choice and five field bindings.

## Linked metric

From a source table’s **Card menu**, choose **Create linked metric**, then select a KPI preset and its original numeric field. **Follow latest acquired** uses the newest eligible vintage. To keep one observation, choose it explicitly. If that pin disappears, reacquire it or choose another available observation. Apply saves the question after checking the source.

The **Card** view shows the original value in the acquired units. The **Gauge** view requires finite minimum and maximum values and a range label. The range and optional user target are assumptions in the acquired units. For a fractional yield, enter 0.01 for 1%. An out-of-range value remains visible on the card beside an alert. Choose a reference observation only when the source verifies the same metric, class, units and basis. EPS and revenue comparisons also require the same actual reporting period.

Open **KPI details** with the keyboard or by tapping it to inspect exact values, references, dates, units and scope. Hover or tap the value annotation on a gauge for its original value and bounds. Swipe a narrow gauge to see its full scale. The card shows the measurement date or its unknown status, plus the observation vintage and separate retrieval time.

An opted-in EODHD KeyMetrics or FinancialRatios table can verify issuer-reported trailing dividend yield and trailing P/E for US primary common stock. Use `chart_source=true` and the `results` selector. The shared routes also need `provider=eodhd`. Other presets and acquired comparisons require a compatible prepared local snapshot. A source-free workspace keeps the saved question. Drop the matching file after import and use **Choose source** to attach it.

## ETF concentration and exposure

**ETF holdings Pareto** ranks delivered constituents by reported weight of fund assets. The bars show individual weights and the line accumulates the displayed holdings on the same scale. The chart shows at most 50 and separately reports the count and weight of all distinct holdings delivered to it. Transport scope and provider holdings coverage appear separately. Filtering the source changes the rows in the calculation.

**ETF exposure** draws a stem and dot for each reported sector or geographic category, including zero weights. Hover a dot for its percentage of equity exposure. Scroll inside a long list to reach every category. The source must establish one fund, the matching exposure kind and the weight basis. To switch from sectors to regions, use **Show parameters → Choose source**, select the corresponding **Exposure mode**, check its category field and apply.

## Screening, dividends and income flows

These linked charts answer one question from one table’s presentation and its acquired source evidence. Set the source table’s parameters and filters, then use **Apply chart settings** to commit the chart’s field bindings and selection. Use **Show parameters → Choose source** when the question needs a different table. For EODHD, the source request must opt in with `chart_source=true`.

**Screening bubble** plots fractional dividend yield against fractional five-day price change. Bubble area represents market cap in one verified listing currency, up to 48 px diameter. Choose **Latest** or one presented **Price date**. **Show regression** fits an unweighted line with an intercept to the usable delivered listings for that date when there are at least three points and both variables vary. The card reports its acquired sort, filters, offset, limit, retrieval time and sample counts. Yield and market cap can have a different measurement date from the price-data date. An older date selects a cohort from this delivery. Universe coverage and random sampling are unverified. Conflicting acquired listings or denominations can prevent drawing even if a table filter hides them.

**Dividend steps** uses one qualified instrument, an inclusive verified acquisition window and one payment currency. Hover an ex-date marker to read its split-adjusted amount per current share. Historical levels can restate after splits. A known invalid or filtered event interrupts the line, which ends at the last usable historical event. Unknown or clipped coverage prevents drawing. The paired live EODHD dividend route currently reports unknown coverage. The example’s explicit snapshot verifies its event interval.

**Income Sankey** uses one actual FY or FQ period from a typed income **Statement** table. It requires full-record evidence, statement reporting currency and an explicitly verified monetary multiplier. Hover to read original values in the declared source units. Income bridges reconcile their adjacent anchors. In particular, operating and non-operating changes are derived differences. Cost of revenue and income tax expense appear as independent components when the source supports them. A loss in an anchor, nonpositive revenue or unknown monetary scale prevents drawing. The paired live EODHD income route currently reports unknown scale. The example snapshot declares its multiplier. Scroll the fixed diagram or tap a band or node on a touch screen.

**News sentiment calendar** groups one qualified instrument's delivered CompanyNews articles by UTC day. Each scored cell is the unweighted mean of the presented article polarities on a fixed −1 to +1 scale. A zero is neutral. Hover or tap to distinguish a day with unscored articles from a gap, or open **Calendar day details** for the original publication times, scores and counts. The card shows the query bounds, page, retrieval time and active presentation scope. **Latest acquired 12 months** uses the source table's acquired dates. Use **Pinned dates** and **Apply chart settings** to narrow that window. If a saved pin is outside a newly acquired window, repair the bounds or choose the latest acquired window.

The paired EODHD CompanyNews source needs a qualified symbol, `chart_source=true`, and a widget that selects `results`. The shared `/api/v1/news/company` route also requires `provider=eodhd`. Change query dates or page parameters on the source table. Chart changes reuse that acquisition. When the route, receipt or article data cannot verify the sample, the chart shows the repair needed.

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
