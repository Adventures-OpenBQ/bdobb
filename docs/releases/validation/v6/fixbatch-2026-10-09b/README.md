# v6 fix batch 2026-10-09b — receipts

Branch `codex/clean-v6`. Gates ran at HEAD `25cde14` (see `head.txt`): merge `5f81217` of v5 at exactly `f5e09a9`, `96a5af1` (D-017), `c9d36e0` (ledger), `25cde14` (review follow-up). The ledger is in `docs/releases/v6-assembly.md` ("Fix batch 2026-10-09b").

Host load was very high throughout: 1-minute averages from about 105 to 330 on 10 cores (`gates.tsv`, `uptime-before.txt`, `e2e-webkit.uptime`). `run-gates.sh` was run once with `BDOBB_BROWSER_PORT=4593 BDOBB_MOCK_PORT=4594`, followed by `cargo test --lib` (the last row of `gates.tsv`). `$HOME` is written as `<home>` in the logs.

| Gate | Result | Notes |
|---|---|---|
| typecheck | exit=0 | |
| lint | exit=0 | |
| unit | exit=1, **composite pass** | 390 files passed / 1 failed / 5 skipped; 6808 tests passed / 1 failed / 28 skipped. The failure is `LocalTableRenderer.execution.test.tsx` "keyboard Show formula transfers focus…" (could not find the button, under load 257). This batch does not touch that file or the table code. A rerun of that one file at the same HEAD passed 39/39 (`unit-rerun-LocalTableRenderer.execution.log`, load about 326). That rerun is composite evidence, not a clean single run. |
| build | exit=0 | |
| e2e (Chromium, full suite) | exit=0 | 262 passed / 1 skipped. Includes rita, rita-arrange, layout, rail, drop, smoke, rita-edit-bar, rita-no-url |
| web | exit=0 | |
| build-web | exit=0 | |
| web-browser | exit=0 | |
| cargo | exit=0 | `cargo check --locked --offline` |
| scrub | exit=0 | |
| help | exit=0 | 7 files, 65 tests |
| cargo-test | exit=0 | `--lib`: 15 passed (includes `migrate.rs`) |
| e2e (WebKit, 8 specs) | exit=1 | `e2e-webkit.log`: 22 passed / 1 failed. The failure is `rail.spec.ts:109` (keyboard focus inside the rail expands it), PRE-EXISTING: it also failed in fix batch 2026-10-09 and at base `131e4fe`. Not fixed. Temporary gitignored config `.superpowers/playwright.webkit.config.ts`, ports 4595/4596 |

Native QA bundle (`bundle.txt`, `qa-build.log`): `pnpm tauri build --config .superpowers/qa-v6-overlay.json --bundles app` at `25cde14`. The result is `BDOBB Clean v6.app`, identifier `com.artcashin.bdobb.clean.v6`, version 6.0.0, ad-hoc signed. The overlay needed no change after the rename. Not installed or launched.
- Main binary (`Contents/MacOS/bdobb`) SHA-256: `e05c55cd271d03491069700e16fc1fe8e36be790fd1f8a683a4ca643c0643839`.
- Bundle tree SHA-256: `5867b49dd666afb9b9122a3946184c64b47e46008575e407d8fae3f3512fcaad`. This is the SHA-256 of the sorted list of per-file SHA-256 values, with paths relative to the `.app`.
- The D-017 tool description is in the built `dist/assets/index-Cpft_Q6r.js`.
- Before the first launch, read the `migrate.rs` hazard in the ledger: this bundle would move the existing `com.artcashin.bdobb.clean.v6` data folder aside.

Not verified: a live Rita turn using `add_widget` with `params`, a live Workspace server, and the packaged app at runtime.

Delivery: nothing pushed, no tag made or moved.
