# v4 key-tones fix + BDOBB rename carry 2026-10-09 — receipts

Branch `codex/clean-v4-integration`, on top of `3ef75a3`:
- `621f498` is the v4 fix for provider-key tones. A key-maint backend discovered after startup (flagged Ask for credentials on startup, or added in Connections) now refreshes provider keys once more. A viewer window does not watch.
- `b49924c` merges `refs/integration/v3-rename-bdobb-2026-10-09` = v3 `b6c0ce7`, the rename from BDOBB2 to BDOBB that takes over `com.artcashin.bdobb`. Coordinator's ruling: same identifier and productName as v3, and `migrate.rs` unchanged. Conflicts: this line's version 4.0.0 and its own index.html comments kept, with the new names.

`run-gates.sh` ran every gate once at HEAD `b49924c` (see `head.txt`), with e2e ports 4683/4684, followed by `cargo test --lib`. Every gate exited 0; there were no reruns, so there is no composite evidence. Host load average per gate is in `gates.tsv` (unit 337/407/372, e2e 180/297/332). Absolute paths in the logs are replaced with `<worktree>` / `<scratch>` / `~`. The app was not built or installed.

| Gate | Result | Notes |
|---|---|---|
| typecheck | pass | 10s |
| lint | pass | 7s |
| unit | pass | 309 files passed, 1 skipped; 5605 tests passed, 6 skipped; 155s |
| build | pass | 13s |
| e2e | pass | 215 passed, 1 skipped; 366s |
| web | pass | 31 pass, 0 fail |
| build-web | pass | 9s |
| web-browser | pass | `PASS: HTTPS login form, ... no external requests.` |
| cargo | pass | `cargo check --locked --offline -j 2` finished; 76s |
| scrub | pass | `scrub-check: clean` |
| help | pass | 6 files, 51 tests passed |
| cargo-test | pass | `cargo test --lib`: 15 passed, 0 failed (includes the 4 migrate.rs tests) |

Delivery: nothing pushed, no tag moved.
