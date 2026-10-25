# v5 Treasury example and Calendar range fix 2026-10-11 — receipts (RE-FREEZE)

Branch `claude/v5-18-first-open`, on top of the freeze `13c3618`. The user approved rendering the Episode 5 Treasury example in the app against the local stack (127.0.0.1, gitignored test credential).

| Commit | What |
|---|---|
| `87becae` | The results card is a **Static** calendar. In Paged mode it moved its `start_date`/`end_date` to the visible month (2026-08-31..2026-12-06) and saved them as fixed dates, so the "last six weeks" window stopped moving. Upcoming auctions has no range and stays Paged. Failed first (`red-results-card-static.log`). |
| `7e59453` | Real merge of the v4 freeze `71f08dc`: a Static calendar draws a range given as date expressions (it had crashed with "Invalid time value"), and the corrected Calendar help. The only conflicts were in the help and its tests; both sides were kept. |

**Live check (`treasury-calendar-live.png`).** The example was imported with the app's own **Import apps.json…** in browser mode, against the local stack. Upcoming auctions drew October's bill auctions (Oct 14 17-week, Oct 15 8-week). Results drew 30 Aug – 11 Oct 2026 with sizes. One request each:
- `upcoming_auctions?provider=us_treasury`;
- `auction_results?…&start_date=2026-08-30&end_date=2026-10-11`.

There were no errors, and the `T-6w`/`T` chips were kept. The check was a temporary local spec, removed after the run and not committed.

Every gate is v5's full set plus the revision test and dashsync.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 6208 passed, 7 skipped |
| revision-test | 51 passed |
| build | pass |
| e2e | 256 passed |
| web | pass |
| build-web | pass |
| web-browser | PASS |
| cargo | pass |
| scrub | Failed during the run only on its own unscrubbed logs. After those were scrubbed: scrub-check clean, header-check clean (`scrub-rerun.log`). |
| help | 64 passed |
| cargo-test | 15 passed, 0 failed |
| notices-check | up to date |
| dashsync | 7 passed |
| diff-check | `git diff --check 13c3618 HEAD`, excluding receipt logs: exit 0 |

**Frozen.** The freeze is the commit that adds these receipts. Delivery: nothing pushed, no tag moved.
