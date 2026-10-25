# v4 RC click-test fixes 2026-10-13 — receipts (FREEZE)

Branch `claude/v4-18-first-open`, on top of the RC `74cc3f6`. Two fixes come from the user's click test of that RC. `release/v4` and `v4.0.0` are not moved.

| Commit | What |
|---|---|
| `be66577` | A backend table gets the **Pivot** button, driving its in-thread pivot. |
| `990b6bc` | A pivot leaf row counts itself in Count and Unique count columns, instead of showing the raw value. |
| `cbd42f3` | The worker test that had pinned the old leaf count (`finalReview.test.ts`) now expects 1. |

**Backend Pivot button.** A backend table such as the reference's Fictional Prices (`openbq_demo_prices`) showed its saved pivot ("Pivot on · asset") but had no button to change it. The toggle rendered only for worker producers and linked tables.
- **Constraint:** the user's 2026-10-07 ruling says backend tables must not move onto the client table worker.
- **What already existed:** TableRenderer has an in-thread `PivotPanel`, driven by `pivotOpen`/`onPivotOpen` and saved to `card.table.pivot`, but no card ever opened it.
- **The change:** the new button opens that panel, reads `data-pivot` from the card's saved pivot, and the strip's Edit link opens the panel too. No worker is involved.
- **Exclusions:** transposed tables, non-table views and linked charts stay excluded. Local and linked tables keep their drawer.
- **Tests and help:** three WidgetCard tests; the tables help (topic and guide) now describes both cases.

**Leaf Count.** In the reference "Episode 4 — Pivot examples" app, Mean and Count tab (measures `mean`/`count` on `volume`, grouped by `asset`), the expanded AAA leaves showed 100, 200, 300 in "volume — Count".
- **Fix:** a leaf is one row, so Count and Unique count now read "1", or "0" for a null. That matches the groups: a group of only nulls already reads "0".
- **Other aggregations:** Sum, Mean, Median, Min, Max, First and Last of one value are that value, so leaves keep carrying the raw value (null stays null). This is how leaves have always been treated, and an existing test pins it.
- **Scope:** `pivotTable` builds the leaves for both the in-thread pivot and the worker engine. The worker test that had pinned the raw value is updated (`cbd42f3`).
- **Test:** a new `pivotTable` test uses the reference tab's shape and covers all nine aggregations on a value and on a null. The groups still read AAA 200 / 3 and BBB 50 / 1.

`run-gates.sh` ran every gate once at `cbd42f3` (`head.txt`), on ports 4583/4584. The opt-in dashsync suite ran against the local key-mode container on 127.0.0.1:17400. Its credential comes from the gitignored `.env.dashsync-test.local` and is never printed.

An earlier run at `990b6bc` failed only the two `finalReview` cases, Count and Unique count, both on the pinned leaf expectation above; `cbd42f3` updates that expectation.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 322 files passed, 2 skipped; 5854 tests passed, 7 skipped |
| revision-test | 34 passed |
| build | pass |
| smoke | clean |
| e2e | 227 passed, 8 skipped |
| web | 31 pass, 0 fail |
| build-web | pass |
| web-browser | PASS |
| cargo | pass |
| scrub | Failed during the run only on the run's own unscrubbed logs. Once they were scrubbed, scrub-check and header-check are clean (`scrub-rerun.log`). |
| help | 56 passed |
| cargo-test | 16 passed |
| notices-check | up to date |
| dashsync | 7 passed |
| diff-check | `git diff --check 74cc3f6 HEAD` (receipt logs excluded) exit 0 |

**Frozen.** The freeze is the commit that adds these receipts. Its source equals `cbd42f3`. Delivery: no remote is configured in this repository, so nothing is pushed. `release/v4` and `v4.0.0` are not moved.
