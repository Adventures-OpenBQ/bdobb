# Live price views

Requires BDOBB 10.0.0 or later and a paired qualified EODHD backend. Connect the
backend that serves the generated EODHD equity historical mirror widget, then
import [the example workspace](../v10-live-price-views.apps.json) and open
**AAPL and MCD price views**.

The source table requests `AAPL.US,MCD.US` from
`/api/v1/eodhd/equity/price/historical` with `interval=1d` and `chart_source=true`,
from October 12 through November 19, 2026, inclusive. The generated widget
selects `results` through `data.dataKey`. The table's **Refresh** button reacquires
this fixed historical window. The backend connection supplies credentials and
acquisition evidence.

- **Observed return distribution** starts with AAPL.US in 12 bins. Known price
  gaps break adjacent pairs. **Observed quote-to-quote returns; exchange-session
  completeness unknown.**
- **Observed drawdown** shows both listings. The observed peak carries across
  known gaps, where the line and shading break. **Drawdown uses observed
  adjusted prices in the loaded history; exchange-session completeness and
  peaks during missing observations are unknown.**
- **Observed price comparison** shows both listings in selection order. Each
  starts at 100 on the earliest shared date with a positive adjusted price.
  The panels end on the last date within every selected listing's delivered
  history. **Indexed observed adjusted prices; exchange-session completeness
  unknown.**

The cards open with Parameters closed. Choose **Show parameters** to change
the listing, bins, selection, or selection order, then choose **Apply chart
settings**. The charts use the existing table acquisition for these changes.
Use **Filter rows** on the table to explore the same history with selected
observations excluded.

Saving the workspace keeps the chart settings and source request. Importing it
on a connected page reacquires the data.
