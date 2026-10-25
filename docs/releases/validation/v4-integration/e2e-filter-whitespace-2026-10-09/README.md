# v4 #11 + #25 2026-10-09 — receipts

Branch `codex/clean-v4-integration`, on top of `1f788b8`:
- `03b2cdd` fixes #11. The "no source acquisition" checks in statement-model and table-execution filter on `MOCK_URL` and skip discovery (`isDiscoveryRequest` in e2e/fixtures.ts). Before: 6 failures at mock port 4684 with the live filter. After: 18/18.
- `e5cacc0` merges `refs/integration/v3-eof-2026-10-09` = v3 `c944889` (#25: no blank line at the end of workspaceAccount.ts).
- `9f29205` is the #25 `.gitattributes`: `docs/releases/validation/** -whitespace`. Receipts are verbatim tool output. `git diff --check d333753 HEAD` exits 0.

`run-gates.sh` ran every gate once at HEAD `9f29205` (see `head.txt`), with e2e ports 4683/4684, followed by `cargo test --lib`. Every gate exited 0; there were no reruns. Absolute paths in the logs are replaced with `<worktree>` / `<scratch>` / `~`.

| Gate | Result | Notes |
|---|---|---|
| typecheck | pass | 35s |
| lint | pass | 64s |
| unit | pass | 312 files passed, 1 skipped; 5627 tests passed, 6 skipped |
| build | pass | 17s |
| e2e | pass | 216 passed, 1 skipped; 495s |
| web | pass | 31 pass, 0 fail |
| build-web | pass | 39s |
| web-browser | pass | `PASS: HTTPS login form, ... no external requests.` |
| cargo | pass | `cargo check --locked --offline -j 2` finished |
| scrub | pass | `scrub-check: clean` |
| help | pass | 6 files, 51 tests passed |
| cargo-test | pass | 15 passed, 0 failed |

Delivery: nothing pushed, no tag moved.
