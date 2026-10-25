<!-- Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0. SPDX-License-Identifier: Apache-2.0 -->

# v9.0.0 (EODHD migration: aggregation hints, Calendars example, EODHD help) 2026-10-12 — receipts (FREEZE, cloud half)

Branch `claude/clean-v9`, built on the v8.0.0 FREEZE de951a1d with the donor bdobb-v2 v8.1.2..v9.6.3 ported per `docs/releases/v9-assembly.md` and `v9-delta-manifest.tsv`. Server half: openbq-docker `claude/openbq-docker-v9` (openbb-eodhd port, examples sync 69c907e). Local only: no tag, no push, release/v9 and main untouched.

`run-gates.sh` ran every cloud gate once at `head.txt` (b80688e1) on Linux with the preinstalled Chromium 1194 (scratch config and preload, not committed; WebKit specs left out). EODHD_API_KEY was absent: 0 live EODHD calls, live checks NOT_RUN.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 7463 passed, 29 skipped (PivotParamRow.viewer intermittent did not occur) |
| revision-test | 54 passed |
| build | pass |
| e2e (Chromium) | 280 passed, 8 skipped (opt-in dashboard-sync and reference acceptance) |
| web | pass, 0 fail |
| build-web | pass |
| web-browser | PASS, including the News card over a ticketed gateway socket |
| scrub + header | clean |
| help | 98 passed |
| notices-check | exit 1, environmental: `cargo metadata --offline` finds no `tauri` in this container's empty crates.io cache (v8's failure was the linux/darwin canvas package). Mac-pending; it also checks the hand-edited Cargo.lock bdobb entry |
| diff-check | clean |

## Mac half — PROVISIONAL until run

- WebKit e2e, native macOS build, `cargo check` / `cargo test --lib`, `pnpm notices:check` (Cargo.lock 9.0.0 entry was edited by hand).
- iPad `pnpm ios:check` / `ios:sim`; `pnpm test:dashsync`.
- openbq-docker v9: `Dockerfile.v3` build with the EODHD SDK and `v9/eodhd/verify.py`, the five SDK-dependent `test_client.py` tests, the live stack, EODHD app and Calendars example rendering against a keyed backend.
- The v8 Mac half (session_01Xc8AQfNVJ9yoAgAJ5m48Ay) is still outstanding beneath this freeze.
