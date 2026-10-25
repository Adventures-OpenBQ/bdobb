# v7 overnight rebuild 2026-10-14 — receipts (FREEZE)

Branch `claude/v7-rebuild-20261013` (PR #49), on top of `release/v7` = `main` `427fd91`, re-cut as `v7.0.0` and `main` by the user's overnight authorisation of 2026-10-13.

## What is in it

- **The held v7 branches:** `claude/fix-card-extensions-v7`, help relaunch, Date expression tab, keysave → openbq-api, Run tooltip hard refresh and apps-sync.
- **The three v7 features from the feature audit:** Connections Export…/Import…, File ▸ Import apps.json…, and the rail notice timeout.
- **The v6.0.0 re-cut.** Through it, v5.0.0 and v4.0.0 reach v7: PR #45, the v4 RC fixes, the 10-12 v3 repair fixes, and PR #44 (ported via v5).
- **`claude/v7-ipad`:** already in v7 (`git cherry` shows both commits applied), so not merged again.

## Integration work

- **`Cargo.toml`:** v3's macOS Save-panel crates sit alongside v7's iOS `objc2` and the vendored swift-rs patch. `Cargo.lock` was updated by cargo (+3 entries).
- **WidgetCard export:** v7's iOS-safe `saveTextFile`/`saveBinaryFile`, now with v3's headerName export labels.
- **ConnectionsDialog:** the reference-service import sits alongside v7's backends import.
- **LeftRail tests:** v7's switchable `isTauri` mock now also mocks `invoke` for the v3 Save… tests. The rail-notice timeout tests fail a Save… instead of the removed Export item.

## Gates

| Gate | Result |
|---|---|
| Local, at the v6 help-fix merge | typecheck, lint, scrub, notices, build, build-web: pass. Unit tests: 7656 passed, 29 skipped. cargo (app, pivot-core, pivot-wasm), pivot-verify, pivot-packaging and the web smoke: pass. e2e: 285 passed. |
| GitHub CI, at `4fdb1c8` | build, e2e, pivot, reference and scrub: success. |
