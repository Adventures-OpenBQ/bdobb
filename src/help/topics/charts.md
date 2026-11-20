# Charts

Charts are drawn with Plotly. There are two ways to get one.

A widget whose declared type is `chart` is always a chart. Any other card whose
rows turn out to carry a time column also gains a **Chart** entry in the
header's view dropdown, beside **Table** and **Raw** — decided by the data that actually
arrived, so it can appear only after the first load.

![A price chart drawn from a table payload](./shots/charts.png)

## What a chart widget can return

Either of two shapes.

**A ready-made Plotly figure** — an object with both a `data` array and a
`layout` object, which is what OpenBB's own charting produces. It is drawn
exactly as it arrives, in whatever colours it already carries; the app does not
re-theme a provider's own figure.

**An array of rows.** The app looks for a column whose values are
date-shaped — `YYYY-MM-DD`, optionally with a time after it — by sampling the
first five rows. Column names are irrelevant; only the values decide. That
column becomes the x-axis. Then:

- if `open`, `high`, `low` and `close` are all present and numeric, you get a
  **candlestick** — and if there is a numeric `volume` column too, it is drawn
  as bars on its own axis in the bottom fifth of the plot;
- otherwise you get **one line per numeric column**, each named after its
  column, with a legend.

With no date-shaped column, the x-axis is the one non-numeric column if there
is exactly one — quarters, sectors, tickers — and otherwise the first column.
As long as at least one numeric column is left to go up it, you get **one bar
series per numeric column**.

"Numeric" means every non-null value in those first five rows is a number.
Occasional gaps are fine; a mostly-text column with one stray number does not
qualify. A bare year like `2026` is not date-shaped and will not become an
x-axis.

If none of that applies, the card says *Nothing chartable in this payload.*

The bundled Plotly draws scatter, candlestick, bar, heatmap, pie, indicator,
waterfall, Sankey and box traces. A
ready-made figure asking for anything else says so and names the trace type it
wanted.

## Linked charts

A chart created from a table's card menu draws that table's output. Open **Parameters** with the card’s **Show parameters** chevron. The panel holds **Choose source** and the linked chart or KPI controls. Its basic chart controls include **Chart type** (Columns, Bars or Lines), a **Category**, the
**Measures** to plot and, for columns and bars, **Display** as Grouped or
Stacked. See Tables for what output it receives.

For **Return distribution**, select adjusted daily prices, one symbol and 5–100 bins. Hover a bar for its interval, count and share. **Small multiples** compares up to twelve selected symbols from a shared base of 100. Gaps break both calculations. Both charts require complete or bounded daily history.

**Return summaries** compares up to twelve qualified listings from a documented local daily adjusted-price snapshot. Boxes show R7 quartiles, observed whiskers and outliers. Violin uses Gaussian density smoothing on the same returns and a shared scale. Hover, tap, or open **Return listing details** for original returns, dates and counts. Use **Common inclusive dates** to compare within explicit bounds. After importing a source-free template, drop the snapshot and select it with **Choose source**.

**ETF holdings Pareto** compares individual and cumulative weight of fund assets for up to 50 delivered holdings. Read the delivered weight and provider coverage beneath the controls. **ETF exposure** shows the reported weight of equity exposure for every delivered sector or region. Scroll the plot to reach the last category. Use **Show parameters → Choose source** to change tables, choose the matching exposure mode and category, then **Apply chart settings**.

**Screening bubble** compares dividend yield and five-day price change for one price-data date. Area represents market cap. **Show regression** fits the usable presented rows of the delivered page. Read the sample size, acquisition scope and retrieval time in the card.

**Dividend steps** shows split-adjusted amounts per current share on ex-dates for one instrument and payment currency. A filtered event can interrupt the line. Unknown or clipped coverage prevents drawing.

**Income Sankey** reconciles the anchors of one actual income Statement period using the declared reporting currency and multiplier. Operating and non-operating changes come from adjacent anchors. Hover or tap to see original units. Loss anchors and unknown monetary scale prevent drawing. Use the table to change the acquired data and **Apply chart settings** to change the chart selection. Opt in with `chart_source=true` on EODHD source requests. The live paired routes currently leave dividend coverage and income scale unknown. The fictional example supplies explicit snapshot evidence for both.

**News sentiment calendar** displays the daily mean polarity of one acquired CompanyNews page in UTC. Hover or tap a day for original timestamps and scores. Use **Calendar day details** to inspect any date with the keyboard. Choose the latest acquired 12 months or pin dates within the acquired range. The card shows its query, retrieval scope and delivered and scored article counts. Use `chart_source=true` on the paired EODHD CompanyNews table. A missing receipt or out-of-range pin requires repair.

**Ownership snapshot** defaults to independent bars for reported insider ownership, institutional ownership and free float. The card shows which measures are available, each measurement date or its unknown status, the share class and the separate UTC retrieval time. Hover, tap or open **Ownership snapshot details** for the original values and units. **Waffle** requires a source that verifies an exclusive and exhaustive partition with a common outstanding-shares denominator. Its 100 cells use 1% visual steps, and the details include buckets that receive zero cells. Use **Choose source** to attach a compatible snapshot and **Apply chart settings** to repair an unavailable issuer or binding.

**ETF sunburst** uses one acquired holdings table with verified weights as fractions of total fund assets. Choose the acquired fund, **Sectors** or **Sectors and holdings**, and **Latest acquired** or an explicit snapshot. A missing pin requires repair. Hover or tap to read the original fund weight and the separate share of delivered holdings. Click a sector or tap it again to drill. Use **Sector view** and **Home** to navigate by keyboard or inspect tiny wedges. Open **ETF holdings details** for exact original weights, including zeros. The opted-in EODHD holdings route supports qualified US ETFs with unknown live report dates and coverage.

**Dual-axis overlay** links one prepared local snapshot for adjusted closing price and reported diluted EPS, or CPI and ten-year Treasury yield. Each series keeps its own dates, gaps and linear y axis. EPS uses report availability with fiscal quarter details. CPI uses measurement month, with release timing where acquired. Hover, tap or open **Overlay observations** for original values and vintages. Both live recipes are unavailable. Use **Choose source** with the matching prepared file to repair missing evidence.

**Estimate revisions** compares pinned consensus EPS or revenue vintages for one exact fiscal target. A **Slope** requires two vintages and a **Time path** at least three. Filter or select one issuer in the source table. **Bump** requires a complete, independently declared issuer universe and positive estimates at the common baseline. Pin the declared baseline and current batches. A missing member reading leaves the entire rank column unavailable. Hover, tap or open **Estimate revision observations** for original values, UTC observation times, changes and unavailable cells. All live revision views are unavailable. Use **Choose source** with verified local recorded history and explicitly repair missing pins.

**Linked metric** presents a single verified KPI observation. Use the source table’s **Card menu → Create linked metric** and select a preset. The default card has no range. A gauge needs explicitly labeled bounds in the acquired units. Use **KPI details** or hover or tap the gauge value to inspect original values, dates and units. A missing pin or source requires an explicit repair. Paired EODHD KeyMetrics and FinancialRatios can verify the reported trailing yield and P/E for US primary common stock. Other presets and acquired comparisons require compatible local snapshots.

## Highcharts, Vega-Lite and TradingView

A `chart-highcharts` or `chart-vegalite` widget carries a Highcharts or
Vega-Lite specification instead. The app translates the common cases — line,
area, bar, column and scatter — into the same bundled Plotly, so they draw as
ordinary chart cards. A specification the translation does not cover shows as
raw JSON.

An `advanced_charting` widget is drawn with TradingView Lightweight Charts
rather than Plotly: daily candles for the widget's default symbol, with volume
bars underneath, a *Rendered by TradingView* credit, and the light/dark theme.
The mouse wheel scrolls the card rather than zooming the chart.

**Market map** uses a verified local snapshot with a completed close-to-close price session. Areas show delivered capitalization in one currency or acquired weights for a named index. Both live modes are unavailable. **Latest acquired** follows the selected snapshot. To keep one session, select its date and apply. If a pin is missing, relink or select an acquired session explicitly. Hover or tap for original values, drill a sector by clicking or tapping it again, and use the breadcrumb or **Home** to reset. **Market map details** lists original areas and return fractions, including tiny tiles.

## Zoom, pan and reset

There is no chart toolbar — the mode bar is off.

- **Zoom** by dragging a rectangle over the plot.
- **Pan** by shift-dragging.
- The **scroll wheel does not zoom**, so scrolling over a chart scrolls the
  card rather than the chart.
- **Double-click anywhere on the plot** resets zoom and pan.

The double-click window is a generous 600 milliseconds, measured from the first
press, because the whole gesture has to finish inside it. Miss it and nothing
happens at all — you never get half a reset.

Refreshing a chart's data reconciles the existing plot in place, so **a refresh
keeps your zoom and pan**. Resizing the card redraws only when the box really
changed size.

Charts the app draws itself follow the light/dark theme. A ready-made figure
from a provider keeps the colours the provider chose.

Candlestick charts deliberately have Plotly's range slider turned off: it would
eat about 15% of the card and pin the y-axis, which would make the y-range
unzoomable and therefore unresettable.

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v9.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
