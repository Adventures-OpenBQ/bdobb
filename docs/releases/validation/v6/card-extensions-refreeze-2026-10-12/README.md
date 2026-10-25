# v6 card extensions merges 2026-10-12 — receipts (RE-FREEZE)

Branch `claude/fix-card-extensions-v6`, on top of the freeze `e0c0a0c`. The user ruled that v4 is fixed too and then merged forward, and approved local re-freezes with no tags. The first merge's gate run is in `../card-extensions-2026-10-12/`.

| Commit | What |
|---|---|
| `6a63fa5` | Real merge of the v5 fix branch `d7a5073`, a clean merge. A saved card keeps its server `extensions` (widget id, storage, unknown sibling keys), so after a restart the next sync uploads the server's own widget record. |
| `7ee1127` | That merge's first gate receipts (not a freeze). |
| `22bbee1` | Real merge of the v5 freeze `9cab3b3`, which carries the v4 freeze `618812b` (the same fix on v4), a clean merge. The source is unchanged, since v6 already had v5's fix. |

Every gate is v6's declared set, run on Linux. The browser gates used the preinstalled Chromium 1194 through a local Playwright config and a `NODE_OPTIONS` preload that only set `executablePath`. Neither is committed.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit (2 workers, 120 s) | 7100 passed, 29 skipped |
| revision-test | 51 passed |
| build | pass |
| e2e | First run: 270 passed, 1 failed, 8 skipped. The failure was `final-panels.spec.ts` › coarse-mobile-cramped › "member pager and footer remain reachable…", a 30 s timeout waiting for the Saved tab panel under load. The single retry passed in 11 s (`e2e-retry.log`). Total: 271 passed. Skipped: 7 dashboard-sync (opt-in, needs its live server) and 1 reference-acceptance (opt-in, needs the reference backend). The WebKit spec was left out of the Chromium run. |
| web | pass |
| build-web | pass |
| web-browser | PASS |
| scrub | scrub-check clean, header-check clean |
| help | 77 passed |
| notices-check | Fails on Linux only: the generator lists `@napi-rs/canvas-linux-x64-gnu` where the committed file, generated on the Mac, lists `@napi-rs/canvas-darwin-arm64`. No dependency changed. Re-check on the Mac. |
| diff-check | `git diff --check e0c0a0c HEAD`, excluding receipt logs: exit 0 |

**Needs the Mac or Docker (not run here):** cargo check and cargo test (the Tauri crate needs GTK/WebKitGTK system libraries on Linux), e2e-webkit (no WebKit here), notices-check (platform package name), dashsync (the local key-mode server container), and the reference-acceptance e2e (the reference backend).

**Frozen.** The freeze is the commit that adds these receipts. Delivery: the fix branch is pushed. release/v6 is not moved and no tag is created or moved.
