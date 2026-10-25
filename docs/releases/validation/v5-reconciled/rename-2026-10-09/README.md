# v5 BDOBB2 → BDOBB rename carry 2026-10-09 — receipts

Branch `codex/clean-v5-reconciled`. The v4 line at `ed0fa4c` (key-tones refresh `621f498`; v4 merge `b49924c` of v3 `b6c0ce7`, the BDOBB2 → BDOBB rename; receipts `ed0fa4c`) was merged as `f7ac8f0` (parents `dc2dd09`, `ed0fa4c`). Coordinator ruling: identifier `com.artcashin.bdobb`, productName `BDOBB`, `migrate.rs` unchanged (its only source stays `com.artcashin.bdobb.clean.v3.repair`).

Conflicts: `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` and `src-tauri/tauri.conf.json` take the rename and keep v5's version `5.0.0`. `src-tauri/src/lib.rs` keeps both setup steps: v5's menu-bar items, then v4's build of the `"create": false` main window after the data migration. After the merge no BDOBB2 reference unique to v5 remained outside `docs/releases`, `docs/superpowers` and `docs/specs`; `migrate.rs` names it on purpose. The help names `com.artcashin.bdobb` and keeps the migration paragraph.

Gates were run by `docs/releases/validation/v3-repair/fixbatch-2026-10-08/run-gates.sh` at HEAD `f7ac8f0` (see `head.txt`), with `BDOBB_BROWSER_PORT=4393 BDOBB_MOCK_PORT=4394`, plus `cargo test --lib` (last row of `gates.tsv`), once each. Every gate exited 0; there were no reruns. Host load was about 190 to 210. `$HOME` is written as `<home>` in the logs.

No assertion was changed on this line.

| Gate | Result | Notes |
|---|---|---|
| typecheck | pass | 10s |
| lint | pass | 7s |
| unit | pass | 330 files passed, 1 skipped; 5945 tests passed, 6 skipped; 322s |
| build | pass | 16s (`vite build`; no app bundle) |
| e2e | pass | 247 passed, 1 skipped; 537s |
| web | pass | 31 pass, 0 fail |
| build-web | pass | 10s |
| web-browser | pass | 35s |
| cargo | pass | `cargo check --locked --offline` |
| scrub | pass | `scrub-check: clean` |
| help | pass | 7 files, 52 tests passed |
| cargo-test | pass | 15 passed, 0 failed |

Not verified: the packaged app (not built or installed), its first-launch migration, and a live Workspace server.

Delivery: nothing pushed, no tag moved.
