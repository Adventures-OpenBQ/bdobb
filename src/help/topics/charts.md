# Charts

Charts are drawn with Plotly. There are two ways to get one.

A widget whose declared type is `chart` is always a chart. Any other card whose
rows turn out to carry a time column also gains a **Chart** segment in its view
toggle, beside **Table** and **Raw** — decided by the data that actually
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

The bundled Plotly draws scatter, candlestick and bar traces. A ready-made
figure asking for anything else says so and names the trace type it wanted.

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
