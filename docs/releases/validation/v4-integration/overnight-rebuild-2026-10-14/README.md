# v4 overnight rebuild 2026-10-14 — receipts (FREEZE)

Branch `claude/v4-rebuild-20261013` (PR #46), on top of the RC `3f0e677`, re-cut as `v4.0.0` by the user's overnight authorisation of 2026-10-13.

## What is in it

| Source | What |
|---|---|
| PR #45 at `2bf0b98` | Rust Pivot foundation (`crates/pivot-core`, `crates/pivot-wasm`, the Wasm worker and SSRM-ready provider contract). TypeScript stays the default engine; the Rust engine is a development-only override. |
| `claude/fix-card-extensions-v4` | A saved card keeps its server extensions. |
| `claude/v4-help-relaunch` | Help describes the openbq-docker stack. |
| `claude/v4-date-expression-tab` | Date expression tab layout. |
| `claude/v4-keysave-openbq-api` | Key save targets openbq-api. |
| `claude/v4-run-tooltip-hard-refresh` | The Run tooltip names ⌘-click hard refresh. |
| `claude/v4-apps-sync-openbq-docker` | apps-sync writes into openbq-docker. |

## Fixes made while integrating

- `18d0427`: the Rust pivot counts a leaf row (the RC's Count fix `990b6bc` was newer than #45's base). Two all-operators fixtures were regenerated (48 leaf counts, raw → `"1"`). One Rust session test now asserts the counted value.
- `fc78205`: CI fetches the app's crates before `notices:check`.
- `105ca58`: third-party notices leave out per-platform native binaries (`@napi-rs/canvas-<platform>`), so the file is the same on macOS and the Linux runner.
- `6c8a738`: CI installs WebKit for the e2e job's `*-webkit` specs.
- `529578f`: the `node:test` scripts from #45 are kept out of vitest.

## Left out

`claude/v4-backend-table-worker` (backend `table` widgets on the table worker) is **not** in this re-cut. With it, 28 e2e tests failed because the worker table differs visibly from the in-thread table for backend data:
- columns that widgets.json hides by default are shown;
- the filter row says "N rows" where it said "N of M rows";
- a second (totals) table appears;
- 45/45 of the affected specs pass with it switched off.

It waits on its branch for a design decision.

## Gates

| Gate | Result |
|---|---|
| Local, at `105ca58` | typecheck, lint, scrub, notices, build, build-web: pass. Unit tests: 6195 passed, 7 skipped. cargo (app, pivot-core, pivot-wasm): pass. pivot-verify, pivot-packaging and the web smoke: pass. e2e: 227 passed. |
| GitHub CI, at `6c8a738` | build, e2e, pivot, reference and scrub: success. |
