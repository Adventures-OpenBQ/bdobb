<!-- Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0. SPDX-License-Identifier: Apache-2.0 -->

# v8.0.0 (pinned cards, News + web relay, locked widgets, pin_card) 2026-10-12 — receipts (FREEZE, cloud half)

Branch `claude/clean-v8`, built on bdobb `main` 427fd918 (v7 re-freeze) with the donor bdobb-v2 through v8.1.2 ported per `docs/releases/v8-assembly.md` and `v8-delta-manifest.tsv`. The card extensions fix is merged from the v7 re-freeze 4a464c9 (v6 3f3cdb8, v5 9cab3b3, v4 618812b). No tag (user ruling: freeze commit, no tag; release/v8 and main untouched).

`run-gates.sh` ran every cloud gate once at `head.txt` (da80d29f) on Linux with the preinstalled Chromium 1194 (scratch config and preload, not committed; WebKit specs left out).

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 421 files passed, 6 skipped; 7447 tests passed, 29 skipped |
| revision-test | 54 passed |
| build | pass (existing chunk-size warning) |
| e2e (Chromium) | 280 passed, 8 skipped (7 dashboard-sync, 1 reference-acceptance, both opt-in) |
| web | 40 pass, 0 fail |
| build-web | pass |
| web-browser | PASS, including the News card over a ticketed gateway socket |
| scrub + header | clean |
| help | 94 passed |
| notices-check | exit 1, environmental: the generator lists `@napi-rs/canvas-linux-x64-gnu`, the committed file (made on the Mac) `-darwin-arm64`; the only diff |
| diff-check | clean |

## Mac half — PROVISIONAL until run

Sent to the Mac release review session; until its receipts land here this freeze is provisional on:
- WebKit e2e (v7's WebKit set incl. `rail-after-dialog.webkit`, plus pin, news, locked).
- Native macOS build, `cargo check` / `cargo test --lib`, `pnpm notices:check`.
- iPad: `pnpm ios:check`, `pnpm ios:sim`; re-take `ipad-light.png` / `ipad-dark.png` (they still show the removed rail row).
- `pnpm test:dashsync` and the docks route against live key-mode and login-mode servers.
- Live openbq-docker `claude/openbq-docker-v8` web profile: gateway preflights, Funnel, the preview against it, and the News card against a live rss-ticker.
