# v5 fix batch 2026-10-08 — receipts

Branch `codex/clean-v5-reconciled`, base `89889791`. HEAD at gate time: see `head.txt` (`9694c27`).
Changes: merge commit `2c91517` (`codex/clean-v4-integration` at `1a97fcf`: v3 D-005/D-008/D-002, v4 D-007 with its user-approved `appsJson.cleanV4.test.ts` assertion change), then `9694c27` (Window > Keep Sidebar Open, home v5). No assertion changed on this line.

| Gate | Result | Notes |
|---|---|---|
| typecheck | exit 0, 9s | |
| lint | exit 0, 7s | |
| unit | exit 0, 158s | 327 files passed, 1 skipped; 5758 tests passed, 6 skipped |
| build | exit 0, 12s | |
| e2e | exit 0, 389s | 247 passed, 0 failed, 1 skipped |
| web | exit 0, 1s | 31 pass, 0 fail |
| build-web | exit 0, 9s | |
| web-browser | exit 0, 4s | PASS on first run; no lapsed-session flake |
| cargo | exit 0, 2s | `cargo check --locked --offline` |
| scrub | exit 0, 2s | scrub-check clean |
| help | exit 0, 3s | 7 files, 52 tests |

All 11 gates exited 0 on the first run. No reruns, so no composite evidence.

Host load (1/5/15 min, from `gates.tsv`): 46.71/56.12/132.40 at start, 33.60/34.40/83.22 around the web gates, 48.46/37.78/83.30 at the last gate.

Merge `2c91517` (parents `89889791`, `1a97fcf`): clean, no conflict markers. `merge-evidence.log` is reconstructed from git after the fact; the original merge stdout was not captured, and the clean result is from the Task 7 report.

Delivery: local commits only; nothing pushed, no tag moved.
