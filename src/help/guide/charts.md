---
type: Note
tags: [bdobb, help, widgets, charts, plotly]
---

# Charts

BDOBB draws its charts as Plotly figures inside a card, which is what every `chart` widget in the OpenBB world produces and what any table with a time column can be turned into. The exceptions are the TradingView chart and the Live Chart, described below.

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

The bundled Plotly draws scatter, candlestick, bar, heatmap and treemap traces — the treemap for live-grid's **S&P 500 Sector Map** (`sector_map`). A ready-made figure asking for anything else says so and names the trace type it wanted.

Two other chart widget types render here as well. A `chart-highcharts` or `chart-vegalite` widget carries a Highcharts or Vega-Lite specification instead of a Plotly figure; the app translates the common cases — line, area, bar, column and scatter — into the same bundled Plotly, so they draw as ordinary chart cards rather than raw JSON. A spec that uses something the translation does not cover falls back to the card's **Raw** view.

The reference backend's **TradingView Chart** (`advanced_charting`) is drawn with TradingView's open-source lightweight-charts library rather than Plotly: daily candles for the widget's default symbol over the last year, with volume bars in the bottom fifth, in the colours the widget declares. It refreshes on the widget's own update interval and follows the light/dark theme. The mouse wheel over it scrolls the card rather than zooming the chart; drag to pan. A **Rendered by TradingView** line under the chart links to the library's page. Drawing tools, indicators, symbol search and resolution — the features of TradingView's full charting library — are not supported.

When the backend advertises the chart stream capability, **Live Chart** receives an atomic candle snapshot and then full candle replacements. Late trades can revise an older candle, including a closed candle; volume is the server's replacement total. The chart keeps at most 2,000 candles and resumes from its fully applied checkpoint after reconnecting. If the retained history cannot cover a gap, the server requests a fresh snapshot. Quiet-market status changes can close candles without inventing trades. **Refresh** requests a new snapshot. The chart still uses lightweight-charts, with the same theme, volume pane and credit. It currently charts candles for the first selected symbol; raw tick display is not offered.

The live-grid service's **Live Chart** (`live_chart`, Episode 10) without that capability is drawn the same way: candles and volume, the same theme and the same **Rendered by TradingView** line. It first fetches the widget's `/series` for its symbol at its interval, then listens on the live grid's socket, with the same ticket, reconnects and subscription. Each update for the symbol moves the newest bar's high, low and close, or opens a new bar once the interval has passed. Volume grows by how much the stream's own volume count for the symbol has risen since the previous update (on a live-grid too old to send that count, the symbol's day volume, and failing that the last trade's size), so the first update after the chart loads, or after its socket reconnects, adds none. A socket that reconnects also fetches the bars again, so the bars it missed are filled in. An update older than the newest bar is ignored, and one stamped more than a minute ahead of your clock is placed at now. When the server sends each update's full time (`updated_ts`, which the paired live-grid does), a replayed update, such as Friday's last trade shown on a Sunday, belongs to its own time and never opens a new bar. An older live-grid sends the time of day only, and a replayed update from an earlier day is read as today's. If the interval is missing or is not one the chart reads, the card shows the fetched bars with a note and does not open the socket. The card charts one symbol: if the symbol parameter names several, it charts the first and says so above the chart. Changing the symbol or the interval starts the chart again, and **Refresh** re-fetches the bars. Its refresh control turns stale while the socket is down, as a live grid's does. A backend whose widget declares no socket shows the fetched bars only.
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
*Source: BDOBB v3.3.0 in-app manual, "Charts"; `BDOBB` `widgetsJson`, `src/lib/plotly.ts`, `src/lib/highcharts.ts`, `src/lib/vegaLite.ts` and `src/components/renderers/ChartRenderer.tsx` at `v3.3.0`; `src/components/renderers/LiveChartRenderer.tsx` and `src/lib/liveChart.ts` on the v10 line; `BDOBB` `src/lib/chartShapes.ts` at `v3.0.6`.*
*See also: [[tables|Tables]] · [[widget-cards|Widget Cards]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v10.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.


## Day Chart watchlist

**Day Chart** (`day_chart`) shows compact intraday lines. The symbol list and its standard parameter-group binding stay on parameter row 0. The bottom status bar holds **Rows**, **Columns**, **Scale**, **Trading days** and **Selected symbol**, aligned to the right. Entries retain their order and duplicates; data acquisition is shared. Clear the symbol parameter or group to clear the widget. Up to 50 entries are supported.

Set only Rows for horizontal scrolling, or only Columns for vertical scrolling. Set both for a fitted grid; additional symbols continue below it. Leave both blank for the default single horizontal row. Each dimension accepts 1–10. Bind **Selected symbol** to a separate symbol parameter group, then bind a detailed Live Chart’s Symbol to that group. Clicking a tile (or focusing it and pressing Enter/Space) publishes its single symbol; the Day Chart watchlist stays intact. The input list and selection output must use different groups. Use the trackpad, touch, mouse wheel or footer arrows to scroll.

Trading days selects 1–5 exchange sessions, skipping weekends and holidays. A vertical line separates sessions and overnight gaps are compressed. Hover a chart for a crosshair and the nearest real bar’s exchange-local date/time, price and cumulative percent change. Focus the chart and use Left/Right, Home/End or Escape for the same inspection without a mouse. Price/% change switches the plotted scale; percent change is measured from the close before the first displayed session. The dashed previous-close reference is split by session: each segment uses the close before its own day, translated onto the cumulative scale in percent mode. Without that baseline, the percent chart says it is unavailable.

Visible and nearby histories refresh every 15 seconds after the previous request completes. Lines come from backend session bars; quote updates do not invent chart points. Top-right prices and daily changes use the same live-grid WebSocket, which coalesces changed prices every 250ms; when no newer quote has arrived, the latest historical bar is shown. The bottom status bar shows session dates, market status, EODHD source, quote connection/last-price time, and history cadence. Connected means the socket is open, not that a trade arrived. On weekends the chart shows the latest completed sessions.

The provider supports US equities and crypto such as BTC-USD. Crypto joins completed-day EODHD history with actual recorded ticks for today, labelled **EODHD + recorded ticks**, without inventing missing points. It uses continuous UTC calendar days, including weekends; each day’s reference is the prior UTC daily close. US equities retain the exchange trading calendar. Unsupported symbols and unavailable sessions show a per-tile message; other tiles keep working. Missing company logos fall back to initials. Logos use the authenticated backend relay. Symbols and group bindings save and export with the dashboard, including the Version 10 Live Grid example's Day Chart card.

When a detailed Live Chart advertises completed-session history, a closed US market shows the latest completed regular-session EODHD OHLCV candles, with the date and historical source labelled in its status line. Open sessions and crypto keep the accepted-data stream. Explicit start/end ranges keep their requested stream view. Closed-session history requires a one-minute or longer interval.

BTC-USD Day Chart fills missing completed minutes with cached Coinbase candles, labelled **Coinbase backfill** in the status bar. Existing EODHD history and recorded ticks take priority. Coinbase is a separate trading venue, so small price differences are possible. Backfill candles never enter the accepted tick tape.

The detailed Live Chart also loads BTC-USD’s current UTC day from that backfilled history at one-minute and longer intervals, then overlays accepted live candle updates. Backfill and stream cursors remain separate; the footer identifies the sources and any partial history.
