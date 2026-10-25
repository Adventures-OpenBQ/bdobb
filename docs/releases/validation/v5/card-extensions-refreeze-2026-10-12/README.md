# v5 card extensions fix and v4 merge 2026-10-12 — receipts (RE-FREEZE)

Branch `claude/fix-card-extensions-v5`, on top of the freeze `0594494`. The user ruled that v4 is fixed too and then merged forward, and approved local re-freezes with no tags. The fix's failing-first receipt and its first gate run are in `../card-extensions-2026-10-12/`.

| Commit | What |
|---|---|
| `d49801d` | A saved card keeps its server `extensions` (widget id, storage, unknown sibling keys) as plain JSON data, so after a restart the next sync uploads the server's own widget record. Functions and accessors are never written. Failed first. |
| `d7a5073` | That fix's first gate receipts (not a freeze). |
| `0190a3c` | Real merge of the v4 freeze `618812b` (the same fix on v4). The only conflict was `persistedCard`'s field list: v4's side lacks v5's `statement`, so v5's side is kept. The source equals `d49801d`, and v4's tests and receipts come in unchanged. |

Every gate is v5's declared set, run on Linux. The browser gates used the preinstalled Chromium 1194 through a local Playwright config and a `NODE_OPTIONS` preload that only set `executablePath`. Neither is committed.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit (2 workers, 120 s) | 6211 passed, 7 skipped |
| revision-test | 51 passed |
| build | pass |
| e2e | 254 passed, 8 skipped. Skipped: 7 dashboard-sync (opt-in, needs its live server) and 1 reference-acceptance (opt-in, needs the reference backend). The WebKit spec (`rail-after-dialog.webkit.spec.ts`) was left out: there is no WebKit here. |
| web | pass |
| build-web | pass |
| web-browser | First run timed out waiting for the Ticker box while another session's browser server was loading the machine. The single retry passed (`web-browser-retry.log`). |
| scrub | scrub-check clean, header-check clean |
| help | 64 passed |
| notices-check | Fails on Linux only: the generator lists `@napi-rs/canvas-linux-x64-gnu` where the committed file, generated on the Mac, lists `@napi-rs/canvas-darwin-arm64`. No dependency changed. Re-check on the Mac. |
| diff-check | `git diff --check 0594494 HEAD`, excluding receipt logs: exit 0 |

**Needs the Mac or Docker (not run here):** cargo check and cargo test (the Tauri crate needs GTK/WebKitGTK system libraries on Linux), notices-check (platform package name), dashsync (the local key-mode server container), the reference-acceptance e2e (the reference backend), and the WebKit spec.

**Frozen.** The freeze is the commit that adds these receipts. Delivery: the fix branch is pushed. release/v5 is not moved and no tag is created or moved.
