# Market map examples

The charts open with Parameters closed. Use the card’s **Show parameters** chevron to choose a source or edit the chart.

1. Import the [Workspace template](../v9-next-market-map.apps.json).
2. On **Delivered capitalization**, drop the [fictional capitalization snapshot](fictional-capitalization.json). On **Named index**, drop the [fictional index snapshot](fictional-index.json). Use **Choose source** on each chart to attach the matching dropped table.
3. Hover or tap a tile to see the original values. Click or tap a sector again to drill. Use **Sector view** and **Home** to navigate with the keyboard. Open **Market map details** to read every original listing, area and return in the current view.

The capitalization snapshot contains two USD amounts in a fictional delivered sample. The index snapshot contains original fractions 0.6 and 0.4 for the complete fictional index `EXAMPLE.INDX`. Its membership and weights are dated November 12, 2026, with explicit validity for the November 13 price session. Both snapshots use the same completed close-to-close price session. One listing is unchanged and one has an unavailable return and sector.

The chart follows the acquired session by default. The named-index example pins November 13. If a newly acquired snapshot lacks a pin, explicitly choose the available session or reacquire the matching snapshot. Filtering may limit index coverage. The root reports delivered components in that case and keeps their original fractions.

Both live modes are unavailable. Capitalization requires verified common-denomination cap and completed-session returns in one prepared acquisition. Named-index mode also requires authoritative component weights and coverage with explicit validity for that price session. The fictional local files demonstrate the preparation contract.

An attached file triggers `MISSING_LOCAL_ASSET` on Workspace export. To save the chart settings, relink to the empty local placeholder and remove the file-backed source card before exporting. Drop the matching file and relink after import.
