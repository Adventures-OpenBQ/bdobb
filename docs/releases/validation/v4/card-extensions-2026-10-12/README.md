# v4 card extensions fix 2026-10-12 — receipts (RE-FREEZE)

Branch `claude/fix-card-extensions-v4`, on top of the freeze `71f08dc` (`../../v4-integration/calendar-range-2026-10-11/`). The user ruled that v4 is fixed too and then merged forward, and approved local re-freezes with no tags.

| Commit | What |
|---|---|
| `0c29373` | `persistedCard` (from `c7f59d1`) whitelisted the card fields it writes and left out `extensions`. Since Workspace sync (`049ff5e`), a card downloaded from a Workspace server lost `extensions.workspace` on its first save. After a restart it had no server widget id, no storage and no unknown sibling keys, and the next sync uploaded a minimal widget record under the card's local id. A dashboard copy (`remapWidgetReferences`) lost it the same way. `extensions` is now written as a detached copy of plain JSON data. Functions, accessors (never invoked), symbols, cycles and non-plain objects are never written. Every other field keeps the whitelist. It is the same fix as v5's `d49801d`, without v5's `statement` field. Failed first (`red-card-extensions.log`: 3 failed, 27 passed). |

**Other paths checked.** `copyCardTo`/`duplicateCard` (`copyOf`) clone the whole card and already kept `extensions`. apps.json import/export never carries card `extensions`, by design. The dashboard-level `extensions` was already persisted.

Every gate is v4's declared set, run on Linux. The browser gates used the preinstalled Chromium 1194 through a local Playwright config and a `NODE_OPTIONS` preload that only set `executablePath`. Neither is committed.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit (2 workers, 120 s) | 5821 passed, 7 skipped |
| revision-test | 34 passed |
| build | pass |
| e2e | First run: 216 passed, 3 failed, 8 skipped. Two of the failures were `pivot-table-frame` (dark, light): the spec launches its own Chromium, and that run had no preload, so it looked for an uninstalled headless shell. The third was `documents.spec.ts:26` (pdf page count still "/ …" after 5 s, under load). The single retry with the preload passed all 3 (`e2e-retry.log`). Total: 219 passed. Skipped: 7 dashboard-sync (opt-in, needs its live server) and 1 reference-acceptance (opt-in, needs the reference backend). |
| web | pass |
| build-web | pass |
| web-browser | First run timed out on the sign-in redirect while the machine was under load. The single retry passed (`web-browser-retry.log`). |
| scrub | scrub-check clean, header-check clean |
| help | 56 passed |
| notices-check | Fails on Linux only: the generator lists `@napi-rs/canvas-linux-x64-gnu` where the committed file, generated on the Mac, lists `@napi-rs/canvas-darwin-arm64`. No dependency changed. Re-check on the Mac. |
| diff-check | `git diff --check 71f08dc HEAD`, excluding receipt logs: exit 0 |

**Needs the Mac or Docker (not run here):** cargo check and cargo test (the Tauri crate needs GTK/WebKitGTK system libraries on Linux), notices-check (platform package name), dashsync (the local key-mode server container), the reference-acceptance e2e (the reference backend), and WebKit specs.

**Frozen.** The freeze is the commit that adds these receipts. Delivery: the fix branch is pushed. release/v4 is not moved and no tag is created or moved.
