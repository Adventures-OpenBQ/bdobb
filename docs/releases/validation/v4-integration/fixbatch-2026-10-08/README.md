# v4 fix batch 2026-10-08 — receipts

Branch `codex/clean-v4-integration`. The fix-batch v3 line was merged as `b56a869` (parent 2 `8defb03`); the D-007 fix is `7f80c2b` (child of `b56a869`). Gates were run by `run-gates.sh` at HEAD `7f80c2b` (see `head.txt`), once each. Every gate exited 0; no reruns, so no composite evidence. Host load average (1/5/15 min) per gate is in `gates.tsv` (e.g. unit 95/191/281, e2e 80/140/245, web-browser 33/73/178).

USER-APPROVED ASSERTION CHANGE: appsJson.cleanV4.test.ts pivot-v1 test now asserts `table.pivot` (D-007; see v4-integration.md).

| Gate | Result | Notes |
|---|---|---|
| typecheck | pass | 9s |
| lint | pass | 7s |
| unit | pass | 306 files passed, 1 skipped; 5418 tests passed, 6 skipped; 142s |
| build | pass | 11s |
| e2e | pass | 215 passed, 1 skipped; 338s |
| web | pass | 31 pass, 0 fail; 1s |
| build-web | pass | 8s |
| web-browser | pass | `PASS: HTTPS login form, ... no external requests.`; 5s (lapsed-session step passed first time) |
| cargo | pass | `cargo check --locked --offline -j 2` finished; 6s |
| scrub | pass | `scrub-check: clean`; 2s |
| help | pass | 6 files, 51 tests passed; 3s |

Delivery: nothing pushed, no tag moved.
