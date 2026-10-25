# v5 widgetGap sync carry 2026-10-09 — receipts

Branch `codex/clean-v5-reconciled`. The v4 line at `1fffdd0` (v4 merge `15393ba` of v3 `3b2aa75`: a Workspace settings download ignores unknown `extensions.bdobb.settings` keys with a note instead of refusing; `4da6b9a`: `widgetGap` joins the synced `NATIVE_KEYS`; receipts `1fffdd0`) was merged as `1597f84` (parents `eda4fc7`, `1fffdd0`), with no conflicts. v5's own `numberShortcutTarget` and `workspaceOrder` remain unsynced.

Gates were run by `docs/releases/validation/v3-repair/fixbatch-2026-10-08/run-gates.sh` at HEAD `1597f84` (see `head.txt`), with `BDOBB_BROWSER_PORT=4393 BDOBB_MOCK_PORT=4394`, plus `cargo test --lib` (last row of `gates.tsv`), once each. Every gate exited 0; there were no reruns. Host load was about 90 to 250. `$HOME` is written as `<home>` in the logs.

No assertion was changed on this line.

| Gate | Result | Notes |
|---|---|---|
| typecheck | pass | 13s |
| lint | pass | 9s |
| unit | pass | 330 files passed, 1 skipped; 5947 tests passed, 6 skipped; 159s |
| build | pass | 13s (`vite build`; no app bundle) |
| e2e | pass | 247 passed, 1 skipped; 422s |
| web | pass | 31 pass, 0 fail |
| build-web | pass | 8s |
| web-browser | pass | 8s |
| cargo | pass | `cargo check --locked --offline` |
| scrub | pass | `scrub-check: clean` |
| help | pass | 7 files, 52 tests passed |
| cargo-test | pass | 15 passed, 0 failed |

Not verified: a live Workspace server and the native packaged app.

Delivery: nothing pushed, no tag moved.
