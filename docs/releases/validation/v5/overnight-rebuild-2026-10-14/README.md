# v5 overnight rebuild 2026-10-14 — receipts (FREEZE)

Branch `claude/v5-rebuild-20261013` (PR #47), on top of `release/v5` `0594494`, re-cut as `v5.0.0` by the user's overnight authorisation of 2026-10-13.

## What is in it

- **The v4.0.0 re-cut (`4c56150`).** It brings PR #45, the v4 RC click-test fixes and the 10-12 v3 repair fixes into v5 for the first time.
- **The held v5 branches:** `claude/fix-card-extensions-v5`, help relaunch, Date expression tab, keysave → openbq-api, Run tooltip hard refresh and apps-sync.
- **PR #44, ported from v7:** Workspaces gets a minimum resolution, uniform zoom, a launch choice and the Workspaces dialog. Three adjustments:
  - `isStringRecord` stays local to `workspacesFile.ts`;
  - one rail test no longer passes v6's `onOpenAI`;
  - the temporary `zoom-qual` workflow is not carried.

## Integration work

- **Rust Statement metadata.** The Rust pivot carries v5's Statement presentation metadata (`4a944c9`). The 12 Statement fixtures were regenerated, each gaining only `provenance.metadata.statementPresentation`, and one Rust test was added.
- **Rail menu.** v3's single **Save…** with its Format pop-up sits alongside v5's workspace rail rows. The signature is now `railMenuItems(target, folders, on, layouts, workspace, formatInSavePanel)`, and `save_workspace_panel` joins v5's invoke handler.
- **Help pages.** The Statement view and Workspaces pages now name the Save… formats (`dcb1b83`). The RC's "BDOBB Workspace save" wording is carried into v5's relaunch pages.
- **CI.** The app build gets a 6 GB Node heap, because `vite build` ran out of memory on the runner (`f93fff5`).

## Gates

| Gate | Result |
|---|---|
| Local, at `49d200c` | typecheck, lint, scrub, notices, build, build-web: pass. Unit tests: 6688 passed, 7 skipped. cargo (app, pivot-core, pivot-wasm), pivot-verify, pivot-packaging and the web smoke: pass. e2e: 267 passed, 1 failed. |
| The one e2e failure | `workspaces.spec.ts:97` is a hover-timing flake under full-suite load: 3/3 alone, then 62/62 twice for `workspaces` + `workspace-resolution`. |
| GitHub CI, at `f93fff5` | build, e2e, pivot, reference and scrub: success. |
