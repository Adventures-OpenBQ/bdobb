# Open questions (product decisions the rulings don't cover)

Items here are left unfixed on purpose until the user decides. None are open on this line.

## Resolved

- **Live-grid websocket auth (dev 98301b6), checked 2026-10-11.** `buildWidgetWsUrl` applies only query-placed auth. A browser WebSocket cannot send a header, so a header-auth backend gets no credential on the handshake. User ruling: fix only if a clean target actually refuses the socket. The clean live grid targets OpenBB's reference backend, whose `/live_grid_ws` accepts every connection without auth, so nothing is refused and this is not changed. Revisit if a header-auth websocket backend becomes a clean target.
- **D-019 (#32), ruled 2026-10-10.** An export writes a calculation error inline as `"#ERROR: <reason>"`, the same in CSV, JSON and Excel. The v5 assertion change in `statementExecution.test.ts:75` is approved. Home line: v4 for the worker Default view (`src/lib/export.ts`), v5 for the Statement view (`src/lib/statementPresentation.ts`).
- **D-020 (#33), ruled 2026-10-10.** Input filters keep a local draft and save it after a 250 ms pause. They stay editable while a save is pending, and a refused save shows no notice. Landed on v4 in `d7e9fc3` and `62be9df`. The GUI re-test of E05-053 (the slow-typing reorder) is still owed.
- **D-021 (#34 = #29), ruled 2026-10-10.** Group members carry their labels, and the linked-chart hover text changes to labels. Landed on v4 in `8b36ed1`.
