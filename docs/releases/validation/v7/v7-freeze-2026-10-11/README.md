# v7.0.0 (iPadOS, on the v6 freeze) 2026-10-11 — receipts (FREEZE)

Branch `codex/clean-v7`, created from the v6 sync merge `13cec6a` and merged with the v6 freeze `ee24ca2`. User order 2026-10-11: Episode 7 (v7 iPad) on top of the walked-forward Workspace dashboard sync. User ruling: bdobb main becomes v7 and must contain everything. The ancestry proof is below.

| Commit | What |
|---|---|
| `86a093d` | Cherry-pick of `9a4b05c` (claude/v7-ipad): iPadOS build and simulator tooling ported from bdobb-v2. `scripts/ios.sh`, the Apple icon sync, vendored swift-rs 1.0.8 via `[patch.crates-io]`, the iOS capability, the mobile entry point, `TAURI_DEV_HOST`. |
| `d7dad5f` | Cherry-pick of `ebeebf9`: the touch dialect (`usePointerKind`, tap-to-open and tap-outside-to-close in `useHoverPanel`, long-press context menus), the iPadOS CSS (dvh shell, safe-area insets, overlays below the status bar), the iOS save path, and the example `docs/examples/v7.0.0-touch.apps.json`. |
| `aa52c57` | swift-rs 1.0.8 is third-party (MIT OR Apache-2.0): `scripts/header-exempt.txt` lists `src-tauri/vendor/`, and `THIRD_PARTY_NOTICES.md` is regenerated (swift-rs 1.0.7 → 1.0.8). |
| `446734d` | Gap (a): version 7.0.0 in `package.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`, `src/help/guide/VERSION` and the guide home page. The version tests failed first. |
| `f130166` | Gap (b): the iPad rail background stopped short of the bottom edge. Measured in the iPad simulator with a temporary probe (`rail-bottom-before-probe.png`): the viewport was 1136 pt of 1180 pt and ended 44 pt above the edge, because WKWebView's scroll view adjusted its content inset on top of the page's own `env(safe-area-inset-*)` layout. `cover_screen_edges` (`lib.rs`, iOS only) sets `contentInsetAdjustmentBehavior` to Never. With the same probe (`rail-bottom-after-probe.png`), the viewport now reaches the edge and the rail's background runs to it. `objc2` 0.6 is already in the lockfile. |
| `6a9ab6c` | Merge of the v6 freeze `ee24ca2`. Clean. |
| `20c6fdb` | scrub-check skips the gitignored, generated iOS project under `src-tauri/gen/`, where Xcode records absolute build paths. A `src/gen` folder is still scanned. The test failed first. |
| `94eb0d4` | Gap (c): help topic "BDOBB on iPad" (`src/help/topics/ipad.md`, last in `TOPIC_ORDER`, with light and dark iPad simulator shots), the Version 7.0.0 section on the guide's Example Dashboards page, and a README iPadOS section. The help tests failed first. |
| `bbd07b9` | Gap (d): Connections export/import (`backendsJson`) is recorded in `docs/releases/OPEN-QUESTIONS.md` and not built. The audit session agreed. |

Not in this freeze: #26 (the native hover-rail check) stays open, NOT_RUN natively, at the user's direction, and does not block v7. The Escape key on the two sync conflict dialogs is left as it is.

`run-gates.sh` ran every gate once at `bbd07b9` (see `head.txt`). The gate set is v6's, plus `pnpm test:dashsync`, `pnpm ios:check` and `pnpm ios:sim` on the iPad (10th generation) iOS 17.0 simulator.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 407 files passed, 6 skipped; 7053 tests passed, 29 skipped |
| build | pass |
| e2e | 271 passed |
| web | 31 pass, 0 fail |
| build-web | pass |
| web-browser | PASS |
| cargo | pass |
| scrub | Failed during the run only on its own unscrubbed logs. After those were scrubbed: scrub-check clean, header-check clean (`scrub-rerun.log`). |
| help | 71 passed |
| cargo-test | 15 passed, 0 failed |
| e2e-webkit | The first run found no config: `.superpowers/` is gitignored and absent from the new worktree. With v6's config copied over: 24 passed, 1 failed, `rail.spec.ts:109`. Pre-existing, as in the v6 receipts (`e2e-webkit-rerun.log`). |
| notices-check | up to date |
| dashsync | 6 passed against the local key-mode server |
| ios-check | toolchain complete |
| ios-sim | built, SDK relabelled, installed and launched on the iPad simulator |
| diff-check | `git diff --check ee24ca2 HEAD` exited 2, only on the vendored swift-rs (verbatim third-party trailing whitespace). Excluding `src-tauri/vendor/` and receipt logs: exit 0 (`diff-check-rerun.log`). |

**Frozen.** The freeze is the commit that adds these receipts. Delivery: nothing pushed, no tag moved.
