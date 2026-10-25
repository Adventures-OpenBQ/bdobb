# v5 #41 full-suite re-freeze 2026-10-11 — receipts (RE-FREEZE)

Branch `claude/v5-18-first-open`, on top of the #41 freeze `5b031db` (`fix-41-2026-10-11/`). That freeze ran only the #41 gate subset. Its e2e suite carries v4's `pivot-group-durable.spec.ts`, which fails on a durable Pivot Undo because the revision moves. See `docs/releases/validation/v4-integration/fix-41-e2e-2026-10-11/`.

| Commit | What |
|---|---|
| `7701339` | Real merge of the v4 freeze `42cf50e`, with no conflicts. The spec now requires the revision to move and the content to be restored. |

Every gate is v5's full set (`v5-reconciled/dashboard-sync-2026-10-11/run-gates.sh`) plus the revision test and dashsync. `run-gates.sh` is the script that was run.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 6187 passed, 7 skipped |
| revision-test | 51 passed |
| build | pass |
| e2e | 256 passed |
| web | pass |
| build-web | pass |
| web-browser | PASS |
| cargo | pass |
| scrub | Failed during the run only on its own unscrubbed logs. After those were scrubbed: scrub-check clean, header-check clean (`scrub-rerun.log`). |
| help | 56 passed |
| cargo-test | 15 passed, 0 failed |
| notices-check | up to date |
| dashsync | 7 passed (includes "removing a tab reaches the server") |
| diff-check | `git diff --check 5b031db HEAD`, excluding receipt logs: exit 0 |

**Frozen.** The freeze is the commit that adds these receipts. Delivery: nothing pushed, no tag moved.
