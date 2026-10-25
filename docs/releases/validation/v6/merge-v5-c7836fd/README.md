# v6 merge of v5 `c7836fd`: receipts

Branch `codex/clean-v6`. The gates ran at HEAD `16ca0f8` (see `head.txt`). That commit merges `codex/clean-v5-reconciled` at exactly `c7836fd` (v4 `8e91662`: #11 and #25) onto `b0cf254`. The ledger entry is in `docs/releases/v6-assembly.md` ("Merge v5 c7836fd").

Host load (1-minute average) was about 90 to 160 (`uptime-before.txt`, `gates.tsv`, `e2e-webkit.uptime`, `qa-build.uptime`). `run-gates.sh` ran once with `BDOBB_BROWSER_PORT=4611 BDOBB_MOCK_PORT=4612`, then `cargo test --lib` (the last row of `gates.tsv`). Every gate ran once and none was rerun, so none of this is composite evidence. `$HOME` is written as `<home>` in the logs. The only "tailnet" in `unit.log` is the name of a test (`McpServersTab > does not warn for a tailnet name`), not a host name.

| Gate | Result | Notes |
|---|---|---|
| typecheck | exit=0 | |
| lint | exit=0 | |
| unit | exit=0 | Files: 394 passed, 5 skipped. Tests: 6833 passed, 28 skipped. Took 370s |
| build | exit=0 | |
| e2e (Chromium, full suite) | exit=0 | 263 passed, 1 skipped. Includes `table-execution` and `statement-model` with the #11 filter, and the 8 Rita/rail specs |
| web | exit=0 | |
| build-web | exit=0 | |
| web-browser | exit=0 | |
| cargo | exit=0 | `cargo check --locked --offline` |
| scrub | exit=0 | `scrub-check: clean` |
| help | exit=0 | 7 files, 65 tests |
| cargo-test | exit=0 | `--lib`: 15 passed |
| e2e (WebKit, 8 specs) | exit=1 | 22 passed, 1 failed. The failure is `rail.spec.ts:109`, which is pre-existing and not fixed. Ports 4611/4612 |

Native QA bundle (`bundle.txt`, `qa-build.log`):
- Rebuilt because one non-test source file changed: `src/lib/workspaceAccount.ts`, where #25 removes a trailing blank line.
- Built at `16ca0f8`: `BDOBB Clean v6.app`, identifier `com.artcashin.bdobb.clean.v6`, version 6.0.0, ad-hoc signed. It was not installed or launched.
- Main binary SHA-256: `97c6bc282f775f1581b0e21bcdd08cd7b6f1ee2aba6b39ddc0ac8692a0f8be77`.
- Bundle tree SHA-256: `4fd087aa82c3c3d0dede90d1af413cd9db4fa4aab64501624aa640768b7221a7`.
- This hash differs from the `5fad2155…` build at `482d0e9`. The receipts do not show whether that comes from the whitespace change or from the build not being reproducible.
- The `migrate.rs` first-launch hazard still applies.

No live or integration gates were run, and nothing contacted OPENBQ_API or the NAS.

Delivery: nothing pushed, no tag made or moved.
