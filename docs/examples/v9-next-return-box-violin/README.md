# Return summaries

The charts open with Parameters closed. Use the card’s **Show parameters** chevron to choose a source or edit the chart.

Requires BDOBB 9.0.0 or later with the Return summaries chart.

## Live AAPL and MCD

Connect a paired OpenBB backend that serves the EODHD equity historical mirror widget, then import [the example Workspace](../v9-next-return-box-violin.apps.json) and open **AAPL and MCD observed returns**. The source table uses `/api/v1/eodhd/equity/price/historical`, selects `results`, and requests `AAPL.US,MCD.US` at `1d` with `chart_source=true` from October 12 through November 19, 2026, inclusive.

In the captured public responses each listing delivered 29 positive adjusted closes and produced 28 return pairs. **Observed quote-to-quote returns; exchange-session completeness unknown.** A pair may span multiple exchange sessions when the provider did not deliver an intervening observation. Open **Return listing details** for counts, original values and excluded opportunities. Choose **Violin** and apply to view the same samples as densities.

The paired connection supplies the data and acquisition evidence. Saving the Workspace retains the question. Importing it on a connected page makes the source table request the dates again.

## Local snapshot

The **Returns** tab uses two synthetic listings and their adjusted prices.

1. Import [the example Workspace](../v9-next-return-box-violin.apps.json).
2. Drop [fixture-adjusted-prices.json](fixture-adjusted-prices.json) onto the Returns dashboard as a local table.
3. In **Return summaries**, choose **Choose source** and select the dropped table. The template starts with an empty source card so you can attach your own snapshot after import.
4. Open **Return listing details** to check original fractional returns, observed whiskers, dated outliers and excluded opportunities. Select **Violin** and apply to compare Gaussian density on one shared scale.
5. Select **Common inclusive dates** to start with the overlap of the selected acquired histories. Adjust the bounds and apply to pin those dates. Each return uses two observed prices inside the bounds.

The local JSON file supplies the acquired daily interval and date window in its receipt.

Workspace JSON contains the chart question, including the listing order, view and explicit dates. The existing Workspace exporter refuses dashboards with attached local files. To save a source-free template, choose the empty **Daily price snapshot** card as the source, remove the attached file card, and use **Save… → BDOBB Workspace**. On a fresh import, drop the original or replacement file and explicitly choose it. If a pinned window is unavailable, change the dates or switch to each listing’s own dates and apply.
