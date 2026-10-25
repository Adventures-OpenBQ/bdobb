<!-- Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0. SPDX-License-Identifier: Apache-2.0 -->

# v8.0.0 with the v7 rebuild merged 2026-10-14 — receipts (RE-FREEZE, cloud half)

Branch `claude/clean-v8`: the v8.0.0 freeze de951a1d with the v7 overnight rebuild merged in (0ff3b8bd, "Merge v7 rebuild ba935b5 into v8"; `main` = `release/v7` = `v7.0.0` = ba935b53, merge base 4a464c9e) and the merge's docs and re-shot (cf4e6e65). Conflicts, interaction fixes and REVIEW notes are in `docs/releases/v8-assembly.md`, "Merge of the v7 rebuild (ba935b5)". `origin/main` is an ancestor of this branch, so `main` can fast-forward to it. No tag, no push (release/v8 and main untouched).

`run-gates.sh` is the v8 freeze script plus the v7 rebuild's gates that run on Linux (smoke, the build's 6 GB heap, `pivot:test`, `pivot:verify`, `test:pivot:packaging`, and the Pivot browser specs on Chromium), with the diff check from the merge base. It ran once at `head.txt` (cf4e6e65) on Linux with the preinstalled Chromium 1194 (scratch Playwright configs and preload, not committed; WebKit specs and the Pivot WebKit project left out), Rust 1.98.1 with `wasm32-unknown-unknown` and wasm-bindgen 0.2.128 as `scripts/pivot-toolchain.json` pins them.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 437 files passed, 6 skipped; 7946 tests passed, 29 skipped (`PivotParamRow.viewer.test.tsx` passed in the run; its intermittent did not recur) |
| revision-test | 54 passed |
| build | pass (6 GB heap, as CI; existing chunk-size warning) |
| smoke | clean, React mounted, no console errors |
| e2e (Chromium) | 286 passed, 8 skipped (7 dashboard-sync, 1 reference-acceptance, both opt-in), 0 failed — `e2e.log`, the rerun below |
| web | 42 pass, 0 fail (v8's 40 plus v7's 2) |
| build-web | pass |
| web-browser | PASS, including the News card over a ticketed gateway socket |
| scrub + header | clean |
| help | 94 passed |
| notices-check | pass (`up to date`; v7's 105ca581 leaves the per-platform canvas binary out, so the Linux run now matches) |
| pivot-test | `pivot-core` and `pivot-wasm` crates (Rust 1.98.1) and `wireCodec.test.ts` (17): all pass |
| pivot-verify | pass (the built Wasm matches its stamp) |
| pivot-packaging | pass |
| pivot-browser | 8 passed (`pivot-chromium`; `pivot-webkit` left for the Mac) |
| diff-check | clean (`git diff --check 4a464c9e HEAD`) |

**The first e2e run** (`e2e-run1.log`, `gates.tsv` line `e2e`, exit 1): 286 passed, 8 skipped, 14 failed, all from the scratch Playwright config, not the code. The config replaced the repository config's `testIgnore` instead of extending it, so v7's 8 `rust-pivot*.spec.ts` cases (which belong to `playwright.pivot.config.ts` and its own HTTPS fixture server, and passed there as `pivot-browser`) ran without their server; and its WebKit pattern matched only `*.webkit.spec.ts`, so v7's 6 `date-filter-webkit.spec.ts` cases (`test.use({ browserName: "webkit" })`) launched WebKit, which this machine does not have. The scratch config was corrected to keep the base ignores and leave out `*-webkit.spec.ts` too, and the full e2e ran again (`gates.tsv` line `e2e-rerun`, exit 0).

Not run here: `cargo check` / `cargo test --lib` for the Tauri crate (needs GTK/WebKitGTK on Linux) and `pnpm test:dashsync` (needs the local key-mode server container).

## Mac half — PROVISIONAL until run

As for the 2026-10-12 freeze, plus the v7 rebuild's WebKit parts:
- WebKit e2e: v7's WebKit set incl. `rail-after-dialog.webkit` and `date-filter-webkit`, plus pin, news, locked; `pnpm test:pivot:browser` with its `pivot-webkit` project.
- Native macOS build, `cargo check` / `cargo test --lib` (the Save panel's Format pop-up, `save_workspace_panel`, and File ▸ Import apps.json… in the menu bar).
- iPad: `pnpm ios:check`, `pnpm ios:sim`; re-take `ipad-light.png` / `ipad-dark.png` (they still show the removed rail row).
- `pnpm test:dashsync` and the docks route against live key-mode and login-mode servers.
- Live openbq-docker `claude/openbq-docker-v8` web profile: gateway preflights, Funnel, the preview against it, and the News card against a live rss-ticker; then `EPISODE=8 pnpm apps:sync` into that branch for the two 8.0.0 examples.
