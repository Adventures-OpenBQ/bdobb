# v7 card extensions merges 2026-10-12 — receipts (RE-FREEZE)

Branch `claude/fix-card-extensions-v7`, on top of the freeze `427fd91`. The user ruled that v4 is fixed too and then merged forward, and approved local re-freezes with no tags. The first merge's gate run, with its unit flake and retry, is in `../card-extensions-2026-10-12/`.

| Commit | What |
|---|---|
| `ea64ec1` | Real merge of the v6 fix branch `7ee1127`, a clean merge. A saved card keeps its server `extensions` (widget id, storage, unknown sibling keys), so after a restart the next sync uploads the server's own widget record. |
| `3e40d45` | That merge's first gate receipts (not a freeze). |
| `67c781a` | Real merge of the v6 freeze `3f3cdb8`, which carries the v5 freeze `9cab3b3` and the v4 freeze `618812b`, a clean merge. The source is unchanged, since v7 already had the fix. |

Every gate is v7's declared set, run on Linux. The browser gates used the preinstalled Chromium 1194 through a local Playwright config and a `NODE_OPTIONS` preload that only set `executablePath`. Neither is committed.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit (2 workers, 120 s) | 7160 passed, 29 skipped |
| revision-test | 51 passed |
| build | pass |
| e2e | 271 passed, 8 skipped. Skipped: 7 dashboard-sync (opt-in, needs its live server) and 1 reference-acceptance (opt-in, needs the reference backend). The WebKit spec was left out of the Chromium run. |
| web | pass |
| build-web | pass |
| web-browser | PASS |
| scrub | scrub-check clean, header-check clean |
| help | 82 passed |
| notices-check | Fails on Linux only: the generator lists `@napi-rs/canvas-linux-x64-gnu` where the committed file, generated on the Mac, lists `@napi-rs/canvas-darwin-arm64`. No dependency changed. Re-check on the Mac. |
| diff-check | `git diff --check 427fd91 HEAD`, excluding receipt logs: exit 0 |

**Needs the Mac or Docker (not run here):** cargo check and cargo test (the Tauri crate needs GTK/WebKitGTK system libraries on Linux), e2e-webkit (no WebKit here), ios-check and ios-sim (Xcode), notices-check (platform package name), dashsync (the local key-mode server container), and the reference-acceptance e2e (the reference backend).

**Frozen.** The freeze is the commit that adds these receipts. Delivery: the fix branch is pushed. release/v7 is not moved and no tag is created or moved.
