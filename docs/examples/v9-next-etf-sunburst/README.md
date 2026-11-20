# ETF sunburst example

The charts open with Parameters closed. Use the card’s **Show parameters** chevron to choose a source or edit the chart.

1. Import [the Workspace template](../v9-next-etf-sunburst.apps.json).
2. Drop [fictional-holdings.json](fictional-holdings.json) into the dashboard.
3. On **ETF composition**, use **Choose source** and select the dropped local table.

The file contains four fictional holdings for `CANOPY.US`. The published snapshot in the example totals 35% of fund assets and has partial coverage. Hover or tap a wedge for its original fund weight and its separate share of delivered holdings. Open **ETF holdings details** to inspect Cedar’s 0.000001 fraction and Willow’s zero weight. Use **Sector view** or tap a sector twice to drill. Use **Home** to return to the overview. Missing classification appears as **Sector unavailable**.

**Latest acquired** follows the observation from the source table. To pin the report date, choose **As of 2026-09-30** in **Snapshot** and apply. Refresh reads the selected source. If a pin is unavailable, reattach that snapshot or choose a different acquired observation. Saving an attached local file triggers `MISSING_LOCAL_ASSET`. For a source-free export, relink to **ETF snapshot source** and remove the dropped file card. After import, drop the original file and relink the chart.

The paired EODHD holdings endpoint accepts `chart_source=true` for a qualified US ETF with the `results` selection. It can verify original delivered holding weights and the acquisition vintage. Live report dates, portfolio completeness, rounding allowance and missing fund weight remain unknown. Complete, verified residual, report-dated or historical comparisons require separate acquired evidence. The fictional example is for local use.
