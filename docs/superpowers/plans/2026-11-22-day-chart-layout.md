# Day Chart layout implementation plan

Goal: symbol parameter row0; rows/columns/scale row1; compact title/chart gap.
Architecture: existing manifest parameter positioning, CSS grid and axis-aware viewport loading; existing snapshot API unchanged.
Tech stack: React, TypeScript, CSS grid, existing v10 manifest.

- [ ] Add failing tests for rows-only horizontal, columns-only vertical, both-dimension grid, blank defaults, bounds and percent baseline unavailable/zero.
- [ ] Implement pure layout/scale helpers; render grid sizing and axis-aware wheel/navigation/IntersectionObserver fallback; maintain all symbols including overflow beyond specified grid.
- [ ] Update backend manifest params with two nested parameter rows. Both dimensions blank defaults to1row; rows default1, columnsblank. Dimensions1–10; both define visible grid, overflow vertical. Scaleprice default, percent usespreviousclose andzero reference; missing/zerobaseline shows unavailable.
- [ ] Tighten chart/header gap; prevent SVG aspect-ratio letterboxing from adding blank vertical space.
- [ ] Run focused and fullfrontend tests,typecheck/lint; backend manifest validation; real browser bothaxes/grid/scale/persistence.
- [ ] Publish exact corresponding source, deploy backendmanifest andVercel, verify existingdomain.

User steering: Trading days1–5 onrow1, session-calendar ranges withdividers andcompressed overnightgaps; move allsession/source/updateinfo towidgetfooter. Headerquotes reuse live_grid_ws (backendFLUSH_INTERVAL=.25); historyremains15s snapshots, no syntheticbars. Percent scale baseline close beforefirst selectedsession; headerchanges keep latestsessionbasis. Reviewfixes: constrainplot togridrow, convertgridfraction×100, retainquotes forstill-nearby symbols onscroll.

Final steering: previous-close reference lines are segmented per session (Wednesday close forThursday,Thursday close forFriday). Percent values remain cumulative frombeforefirstsession; translate each daily reference ontothat cumulative scale, do notreset eachday tozero.
