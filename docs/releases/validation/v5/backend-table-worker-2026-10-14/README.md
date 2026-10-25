# v5 backend tables on the table worker 2026-10-14 — receipts (FREEZE)

Re-cut of `v5.0.0`, approved by the user ("place it when v7 passes"). The base is `release/v5` `53d0eb0`.

**What it adds.** Non-SSRM backend `table` widgets now run on the client table worker, so they get what local-file tables have: the Pivot drawer, linked tables and charts, and the selection column. SSRM types are untouched, and payloads over WORKER_MAX_CELLS stay on the in-thread pivot.

**Parity with the in-thread backend table:**
- widgets.json `hide: true` columns stay hidden;
- the filter row reads "N of M rows" on flat worker tables, local files included (user ruling);
- the totals footer shows only with Pivot on or when a total has a value (user ruling);
- the export filename keeps the card's query;
- declared columns keep their inferred dtype;
- the date filter From/To fields are prefilled;
- Reset columns unpins on every worker table;
- row checkboxes are named "Select row N".

The four commits are the same series as on v4: 6d52b62, 1e1a36d, 4168f29 and e7baf6b, re-applied to each line.

**Gate.** The full 16-step gate passed on `49b2613`: typecheck, lint, scrub, notices, pivot verify/packaging/test, unit, test:web, build:web, web smoke, build, cargo check and test, full e2e, and a clean tree. Before the series, 28 e2e tests failed on this change; now none do. The user click-tested backend tables (the Pivot drawer, cell-click group links, export, the date filter, and pin + Reset columns).
