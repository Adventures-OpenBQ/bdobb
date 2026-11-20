# Return summaries

Requires BDOBB 9.0.0 or later with the Return summaries chart. The two listings and their adjusted prices are synthetic.

1. Import [the example Workspace](../v9-next-return-box-violin.apps.json).
2. Drop [fixture-adjusted-prices.json](fixture-adjusted-prices.json) onto the Returns dashboard as a local table.
3. In **Return summaries**, choose **Choose source** and select the dropped table. The template starts with an empty source card so you can attach your own snapshot after import.
4. Open **Return listing details** to check original fractional returns, observed whiskers, dated outliers and excluded opportunities. Select **Violin** and apply to compare Gaussian density on one shared scale.
5. Select **Common inclusive dates** to start with the overlap of the selected acquired histories. Adjust the bounds and apply to pin those dates. Each return uses two observed prices inside the bounds.

The local JSON file supplies the acquired daily interval and date window in its receipt. Ordinary remote price responses, a table with only matching column names and partial histories cannot establish this source contract.

Workspace JSON contains the chart question, including the listing order, view and explicit dates. The existing Workspace exporter refuses dashboards with attached local files. To save a source-free template, choose the empty **Daily price snapshot** card as the source, remove the attached file card, and use **Save… → BDOBB Workspace**. On a fresh import, drop the original or replacement file and explicitly choose it. If a pinned window is unavailable, change the dates or switch to each listing’s own dates and apply.
