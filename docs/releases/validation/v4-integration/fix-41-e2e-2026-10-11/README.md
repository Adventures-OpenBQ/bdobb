# v4 #41 full-suite re-freeze 2026-10-11 — receipts (RE-FREEZE)

Branch `claude/v4-18-first-open`, on top of the #41 freeze `f7158b9` (`fix-41-2026-10-11/`). That freeze ran only the #41 gate subset, so the full e2e suite was not run. Run in full, three e2e tests failed.

| Commit | What |
|---|---|
| `3ca8ecb` | `e2e/pivot-group-durable.spec.ts` compared the dashboard file restored by a durable Pivot Undo with the seed, byte for byte. Since #41 an Undo is an edit and moves the revision. The tests now require a revision above the seed's and the same content otherwise. On `f7158b9` all 3 failed, each differing only by `"revision": 4` (`red-pivot-group-durable.log`). |

Every gate is v4's full set (`dashboard-sync-2026-10-11/run-gates.sh`) plus the revision test and dashsync. `run-gates.sh` is the script that was run.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 5813 passed, 7 skipped |
| revision-test | 34 passed |
| build | pass |
| e2e | 219 passed |
| web | pass |
| build-web | pass |
| web-browser | PASS |
| cargo | pass |
| scrub | Failed during the run only on its own unscrubbed logs. After those were scrubbed: scrub-check clean, header-check clean (`scrub-rerun.log`). |
| help | 54 passed |
| cargo-test | 15 passed, 0 failed |
| notices-check | up to date |
| dashsync | 7 passed (includes "removing a tab reaches the server") |
| diff-check | `git diff --check f7158b9 HEAD`, excluding receipt logs: exit 0 |

**Frozen.** The freeze is the commit that adds these receipts. Delivery: nothing pushed, no tag moved.
