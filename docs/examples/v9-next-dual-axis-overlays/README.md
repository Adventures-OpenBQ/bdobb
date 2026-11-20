# Dual-axis overlay examples

1. Import [the Workspace template](../v9-next-dual-axis-overlays.apps.json).
2. In **Price and EPS**, drop [fictional-price-eps.json](fictional-price-eps.json) and use **Choose source** on the chart to link the dropped table.
3. In **CPI and Treasury yield**, repeat the process with [fictional-cpi-ten-year.json](fictional-cpi-ten-year.json).

The synthetic equity file uses the fictional listing `CANOPY.US`. Adjusted close uses a regular-session date. The EPS marker keeps the release time to microsecond precision, its fiscal quarter, the acquired after-market timing and the current restatement disclosure. The synthetic macro file uses monthly CPI-U CUSR0000SA0 on its 1982–84 index base and independent DGS10 yield observations. One CPI release date is known and one is unavailable. The explicit gap in yields stays a gap.

Hover or tap an observation for its original value and unit. Open **Overlay observations** to read the two input vintages and see the original observations in text. The y axes scale independently, so visual alignment depends on both ranges. The files demonstrate the prepared acquisition contract with invented observations. Both live routes are unavailable because the existing data routes cannot verify and prepare the required pair and availability facts.

An attached file triggers `MISSING_LOCAL_ASSET` on portable export. Relink to **Prepared overlay source**, remove the dropped file table and save the Workspace. Drop and relink the matching file after import. The chart remains unavailable until a compatible source has been acquired.
