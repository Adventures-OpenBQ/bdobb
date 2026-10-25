<!-- Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0. SPDX-License-Identifier: Apache-2.0 -->

# v10.0.0 (live grid, /symbol_meta, /grid relay, kdb crash recovery and S3 tier on the server) 2026-10-12 — receipts (FREEZE, cloud half)

Branch `claude/clean-v10`, built on the local v9.0.0 FREEZE 62d1aae with the donor bdobb-v2 v9.6.3..v10.0.2 ported per `docs/releases/v10-assembly.md` and `v10-delta-manifest.tsv`. Server half: openbq-docker `claude/openbq-docker-v10` f18c459 (live-grid sidecar, kdb tier with always-on crash recovery, RustFS S3 tier, gateway /grid family; vendored policy pinned at ebd1622). Local only: no tag, no push, release/v10 and main untouched.

`run-gates.sh` ran every cloud gate once at `head.txt` (d96a3560) on Linux with the preinstalled Chromium 1194 (scratch config and preload, not committed; WebKit specs left out). EODHD_API_KEY was absent: 0 live EODHD calls.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 7515 passed, 29 skipped, 1 failed: `PivotParamRow.viewer.test.tsx` "viewer Page offers explicit All and empty…", the known intermittent. Rerun alone once per the ruling: 16/16 passed (`pivot-rerun.log`) |
| revision-test | 54 passed |
| build | pass |
| e2e (Chromium) | 282 passed, 8 skipped (opt-in dashboard-sync and reference acceptance); includes the new live-grid spec |
| web | 50 pass, 0 fail |
| build-web | pass |
| web-browser | PASS, including the Live quotes tab over single-use grid tickets |
| scrub + header | clean |
| help | 104 passed |
| notices-check | exit 1, environmental (no offline cargo registry; `tauri` unresolvable), as at v9. Mac-pending |
| diff-check | clean |

## Mac half — PROVISIONAL until run

- WebKit e2e, native macOS build, `cargo check` / `cargo test --lib`, `pnpm notices:check` (Cargo.lock 10.0.0 entry hand-edited), iPad, dashsync.
- openbq-docker v10 `live` and `web` profiles on Docker with the licensed kdb-x image: the crash-recovery drill (SIGKILL kdb mid-session, restart, tick count not lower; same for live-grid; whole profile), RustFS init, the eod-dump flush and the lake read-back, the two-writer delta-rs conditional-put race (must fail 412; RustFS put-if-absent stays PROVISIONAL until then), the gateway /grid socket from the preview, and the gateway preflight against an API with no standard routers. Full steps: openbq-docker `docs/v10/live-grid-kdb-port.md`.
- The v9 and v8 Mac halves are still outstanding beneath this freeze.
