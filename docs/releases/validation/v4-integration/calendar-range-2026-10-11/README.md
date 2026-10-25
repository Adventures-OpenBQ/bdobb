# v4 Calendar Static range fix 2026-10-11 — receipts (RE-FREEZE)

Branch `claude/v4-18-first-open`, on top of the freeze `ff0f2b6` (`scope-rulings-2026-10-11/`). Found by rendering the Episode 5 Treasury example against a live local stack, which the user approved.

| Commit | What |
|---|---|
| `6c3d89a` | A Static calendar draws a range given as date expressions. Static draws the widget's own `start_date`/`end_date`, and `WidgetCard` handed it the raw card params, so `T-6w` and `T` reached date parsing and the card crashed with "Invalid time value". It now gets the effective params resolved by `wireParams`, the same values the request sends. Failed first (`red-static-range.log`). |
| `8cabb14` | Both Calendar pages (guide and Quick Help) said the view "does not acquire additional history". For a widget declaring `start_date` and `end_date`, the paging modes (Paged, Vertical, Horizontal) set those params to the window you navigate to, refetch and save it; only Static draws the widget's own range. Pinned in `guide.test.ts`. Failed first (`red-calendar-help.log`). |

Every gate is v4's full set plus the revision test and dashsync.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 5818 passed, 7 skipped |
| revision-test | 34 passed |
| build | pass |
| e2e | 219 passed |
| web | pass |
| build-web | pass |
| web-browser | PASS |
| cargo | pass |
| scrub | Failed during the run only on its own unscrubbed logs. After those were scrubbed: scrub-check clean, header-check clean (`scrub-rerun.log`). |
| help | 56 passed |
| cargo-test | 15 passed, 0 failed |
| notices-check | up to date |
| dashsync | 7 passed |
| diff-check | `git diff --check ff0f2b6 HEAD`, excluding receipt logs: exit 0 |

**Frozen.** The freeze is the commit that adds these receipts. Delivery: nothing pushed, no tag moved.
