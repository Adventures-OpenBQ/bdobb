# v6 #41 full-suite re-freeze 2026-10-11 — receipts (RE-FREEZE)

Branch `codex/clean-v6`, on top of the #41 freeze `d919921` (`fix-41-2026-10-11/`). That freeze ran only the #41 gate subset. Its e2e suite carries v4's `pivot-group-durable.spec.ts`, which fails on a durable Pivot Undo because the revision moves. See `docs/releases/validation/v4-integration/fix-41-e2e-2026-10-11/`.

| Commit | What |
|---|---|
| `a88ab4f` | Real merge of the v5 freeze `9519924`, with no conflicts. The spec now requires the revision to move and the content to be restored. |

Every gate is v6's full set (`dashboard-sync-2026-10-11/run-gates.sh`) plus the revision test and dashsync. `run-gates.sh` is the script that was run.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 7047 passed, 29 skipped |
| revision-test | 51 passed |
| build | pass |
| e2e | 271 passed |
| web | pass |
| build-web | pass |
| web-browser | PASS |
| cargo | pass |
| scrub | Failed during the run only on its own unscrubbed logs. After those were scrubbed: scrub-check clean, header-check clean (`scrub-rerun.log`). |
| help | 69 passed |
| cargo-test | 15 passed, 0 failed |
| e2e-webkit | 24 passed, 1 failed: `rail.spec.ts:109`. Pre-existing, as in the earlier v6 receipts: Playwright WebKit on macOS never Tabs onto buttons. |
| notices-check | up to date |
| dashsync | 7 passed (includes "removing a tab reaches the server") |
| diff-check | `git diff --check d919921 HEAD`, excluding receipt logs: exit 0 |

**Frozen.** The freeze is the commit that adds these receipts. Delivery: nothing pushed, no tag moved.
