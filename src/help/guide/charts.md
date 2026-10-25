---
type: Note
tags: [bdobb, help, widgets, charts, plotly]
---

# Charts

BDOBB draws its charts as Plotly figures inside a card, which is what every `chart` widget in the OpenBB world produces and what any table with a time column can be turned into. The one exception is the TradingView chart, described below.

There are two ways to get a Plotly chart. A widget whose declared type is `chart` is drawn as a chart, with no detection involved — though **Raw** is still offered in its view dropdown, and choosing it wins. Any *other* card whose rows turn out to carry a time column also gains a **Chart** entry in the header's view dropdown, beside the card's own kind, **Raw** and, on a table, **Transposed** — decided by the data that actually arrived, so it can appear only after the first load.

![A price chart drawn from a table payload](../attachments/charts.png)

## What a chart widget can return

Either of two shapes.

**A ready-made Plotly figure** — an object with both a `data` array and a `layout` object, which is what OpenBB's own charting produces. It is drawn exactly as it arrives, in whatever colours it already carries; the app does not re-theme a provider's own figure.

**An array of rows.** The app looks for a column whose values are date-shaped — `YYYY-MM-DD`, optionally with a time after it — by sampling the first five rows. Column names are irrelevant; only the values decide. That column becomes the x-axis. Then:

- if `open`, `high`, `low` and `close` are all present and numeric, you get a **candlestick** — and if there is a numeric `volume` column too, it is drawn as bars on its own axis in the bottom fifth of the plot;
- otherwise you get **one line per numeric column**, each named after its column, with a legend.

With no date-shaped column, the x-axis is the one non-numeric column if there is exactly one — quarters, sectors, tickers — and otherwise the first column. As long as at least one numeric column is left to go up it, you get **one bar series per numeric column**.

"Numeric" means every non-null value in those first five rows is a number. A mostly-text column with one stray number does not qualify, and a bare year like `2026` is not date-shaped and will not become an x-axis. If none of that applies, the card says *Nothing chartable in this payload.*

The bundled Plotly draws scatter, candlestick, bar and heatmap traces. A ready-made figure asking for anything else says so and names the trace type it wanted.

Two other chart widget types render here as well. A `chart-highcharts` or `chart-vegalite` widget carries a Highcharts or Vega-Lite specification instead of a Plotly figure; the app translates the common cases — line, area, bar, column and scatter — into the same bundled Plotly, so they draw as ordinary chart cards rather than raw JSON. A spec that uses something the translation does not cover falls back to the card's **Raw** view.

The reference backend's **TradingView Chart** (`advanced_charting`) is drawn with TradingView's open-source lightweight-charts library rather than Plotly: daily candles for the widget's default symbol over the last year, with volume bars in the bottom fifth, in the colours the widget declares. It refreshes on the widget's own update interval and follows the light/dark theme. The mouse wheel over it scrolls the card rather than zooming the chart; drag to pan. A **Rendered by TradingView** line under the chart links to the library's page. Drawing tools, indicators, symbol search and resolution — the features of TradingView's full charting library — are not supported.

A **linked chart**, created from a table's card menu or the Widget Library's source dialog, draws that table's output rather than a widget payload. Its controls pick **Chart type** (Columns, Bars or Lines), a **Category**, the **Measures** to plot and, for columns and bars, **Display** as Grouped or Stacked. See [[tables|Tables]] for what output it receives.

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
