# Ownership snapshot

The charts open with Parameters closed. Use the card’s **Show parameters** chevron to choose a source or edit the chart.

Requires BDOBB 9.0.0 or later with the **Ownership snapshot** linked chart. Both files describe a fictional issuer. Each tab starts with an empty source card.

1. Import [the workspace template](../v9-next-ownership-snapshot.apps.json).
2. In **Independent bars**, drop [fictional-measures.json](fictional-measures.json) and link **Ownership measures** to the dropped table with **Choose source**. The receipt identifies the original percentage points or fraction of each independent measure. The issuer's reported percentages can overlap. The example provides different measurement dates, including an unknown date.
3. In **Certified waffle**, drop [fictional-register.json](fictional-register.json) and link **Ownership partition** to that table. The acquired partition declares exclusive and exhaustive buckets of outstanding Class-A shares as of September 30, 2026. The 100 squares show whole-percentage approximations. Open **Ownership snapshot details** to see the source percentages, including the 0.01% bucket that receives zero squares.
4. Hover or tap a bar or square, or use the keyboard to open the details. The card gives the original acquisition time separately from each measure or partition date.

The completed, opted-in EODHD ShareStatistics contract covers US primary common stock insider and institutional percentages. The source table must request `chart_source=true` and select `results`. Use the existing EODHD route or the shared route with `provider=eodhd`. Field dates, share class and basis remain unknown under that contract. Direct free-float evidence and a certified partition require a separately acquired snapshot. An ordinary ShareStatistics response still works as a table. The examples and browser fixtures establish only their own data.

A workspace export with attached files is refused with `MISSING_LOCAL_ASSET`. To export your chart settings, relink the chart to its empty source card, remove the dropped table from the workspace, and save the workspace. On import, drop the separate source file and explicitly choose it again. If the saved issuer is absent, choose the acquired issuer and apply the settings, or attach the intended snapshot.
