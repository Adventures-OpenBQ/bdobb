# v5 numberShortcutTarget sync 2026-10-09 — receipts

Branch `codex/clean-v5-reconciled`. `c5be527` adds `numberShortcutTarget` to the synced `NATIVE_KEYS`, so it travels in `extensions.bdobb` with User Settings on a server; `workspaceOrder` stays out because it names this machine's workspace ids (user ruling 2026-10-09). The spec's synced-keys line names it for this line.

Test change (user-approved feature): `mergeUpload`'s bdobb block now has 13 keys, not 12, and asserts `workspaceOrder` is absent; new tests apply a downloaded `numberShortcutTarget` without a note and refuse a value other than `dashboards` or `workspaces`. The tests were written first and failed before the change.

Gates were run by `docs/releases/validation/v3-repair/fixbatch-2026-10-08/run-gates.sh` at HEAD `c5be527` (see `head.txt`), with `BDOBB_BROWSER_PORT=4393 BDOBB_MOCK_PORT=4394`, plus `cargo test --lib` (last row of `gates.tsv`), once each. Every gate exited 0; there were no reruns. Host load was about 115 to 310. `$HOME` is written as `<home>` in the logs.

| Gate | Result | Notes |
|---|---|---|
| typecheck | pass | 18s |
| lint | pass | 12s |
| unit | pass | 330 files passed, 1 skipped; 5949 tests passed, 6 skipped; 398s |
| build | pass | 27s (`vite build`; no app bundle) |
| e2e | pass | 247 passed, 1 skipped; 792s |
| web | pass | 31 pass, 0 fail |
| build-web | pass | 25s |
| web-browser | pass | 24s |
| cargo | pass | `cargo check --locked --offline` |
| scrub | pass | `scrub-check: clean` |
| help | pass | 7 files, 52 tests passed |
| cargo-test | pass | 15 passed, 0 failed |

Not verified: a live Workspace server and the native packaged app.

Delivery: nothing pushed, no tag moved.
