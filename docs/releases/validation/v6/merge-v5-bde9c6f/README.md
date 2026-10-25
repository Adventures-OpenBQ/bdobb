# v6 merge of v5 `bde9c6f`: receipts

Branch `codex/clean-v6`. The gates ran at HEAD `482d0e9` (see `head.txt`). That commit merges `codex/clean-v5-reconciled` at exactly `bde9c6f` (the SHA, not the branch) onto `9cf34a5`. The ledger entry is in `docs/releases/v6-assembly.md` ("Merge v5 bde9c6f").

Host load was high throughout. 1-minute averages ran from about 150 to 280, and the 15-minute average was about 450 at the start (`uptime-before.txt`, `gates.tsv`, `e2e-webkit.uptime`, `qa-build.uptime`). `run-gates.sh` ran once with `BDOBB_BROWSER_PORT=4611 BDOBB_MOCK_PORT=4612`, then `cargo test --lib` (the last row of `gates.tsv`). Every gate ran once and none was rerun, so none of this is composite evidence. `$HOME` is written as `<home>` in the logs.

| Gate | Result | Notes |
|---|---|---|
| typecheck | exit=0 | |
| lint | exit=0 | |
| unit | exit=0 | Files: 394 passed, 5 skipped. Tests: 6833 passed, 28 skipped. Took 246s |
| build | exit=0 | |
| e2e (Chromium, full suite) | exit=0 | 263 passed, 1 skipped. Includes rita, rita-arrange, layout, rail, drop, smoke, rita-edit-bar and rita-no-url |
| web | exit=0 | |
| build-web | exit=0 | |
| web-browser | exit=0 | |
| cargo | exit=0 | `cargo check --locked --offline` |
| scrub | exit=0 | `scrub-check: clean` |
| help | exit=0 | 7 files, 65 tests |
| cargo-test | exit=0 | `--lib`: 15 passed |
| e2e (WebKit, 8 specs) | exit=1 | 22 passed, 1 failed (`e2e-webkit.log`). The failure is `rail.spec.ts:109` (keyboard focus inside the rail expands it). It is pre-existing: it also failed in fix batches 2026-10-09 and 2026-10-09b. Not fixed. Uses the gitignored config `.superpowers/playwright.webkit.config.ts` on ports 4611/4612 |

Native QA bundle (`bundle.txt`, `qa-build.log`):
- Built at `482d0e9` with `pnpm tauri build --config .superpowers/qa-v6-overlay.json --bundles app`.
- Produced `BDOBB Clean v6.app`: identifier `com.artcashin.bdobb.clean.v6`, version 6.0.0, ad-hoc signed. It was not installed or launched.
- Main binary (`Contents/MacOS/bdobb`) SHA-256: `5fad2155e47621a5a0d28db4f4d2d966d05094913cb5443480ed0439fd56e86e`.
- Bundle tree SHA-256: `1eedf95f5b119c289b698aa02a4bc4b7f9182a6b5df6b4de8aa9f17d2c1b776f`. This is the SHA-256 of the sorted list of per-file SHA-256 values, with paths relative to the `.app`.
- The `migrate.rs` first-launch hazard recorded in fix batch 2026-10-09b still applies.

No live or integration gates were run, and nothing contacted OPENBQ_API or the NAS. Not verified:
- the Statement-view worker-producer export (no test covers it; v5 flagged the same gap);
- the packaged app at runtime.

Delivery: nothing pushed, no tag made or moved.
