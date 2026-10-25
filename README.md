# BDOBB — Adventures in OpenBQ

This repository reconstructs a clean release sequence. Version 3.0.0 provides the reference-build desktop: ordinary tables and charts, documents, grouped controls, Run and numeric refresh, backend Apps discovery, and compatible JSON interchange.

Cron refetch is deferred. Analytical Pivot, workspaces and Statement are not part of v3.

Read the [user guide](docs/user-guide.md) and [v3 reference manual](docs/reference-manual/v3/README.md), also available through the app’s Help menu.

## Run and verify

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test:run
pnpm build
pnpm e2e
```

The local reference backend must be started separately for `pnpm test:reference`; set `OPENBB_REFERENCE_URL` when using a different port. See [source provenance](docs/releases/provenance.md) and [test environment](docs/test-environment.md).

## iPadOS (v7)

From 7.0.0 the same app runs on iPadOS: a touch dialect (tap the rail to open it and tap outside to close it, long-press for every context menu, pinch to zoom), a layout that fills the screen edge to edge inside the safe area, and exports that go through the system picker to Files. The in-app Help topic **BDOBB on iPad** describes it, and `docs/examples/v7.0.0-touch.apps.json` is a dashboard for trying the gestures.

Build it with Xcode 27 and the Rust iOS targets:

```sh
pnpm ios:check                                     # toolchain preflight
pnpm ios:init                                      # generate the Xcode project (gitignored)
pnpm ios:sim "iPad (10th generation)"              # build, install and launch on a simulator
pnpm ios:dev "<device name>"                       # iterate on a device
pnpm ios:build                                     # release .ipa
```

Signing needs `APPLE_DEVELOPMENT_TEAM` in `.env.local` (`pnpm ios:team` prints it). The iOS build vendors `swift-rs` 1.0.8 under `src-tauri/vendor/` for Xcode 27; it keeps its own license and is credited in `THIRD_PARTY_NOTICES.md`.

## News, pinned cards and locked widgets (v8)

8.0.0 adds the **News** built-in (a headline wire from an rss-ticker server), **pinned cards** (Pin widget ▸ on a card's menu), **locked widgets** (Settings ▸ Locked Widgets: bands on every dashboard that sync with a Workspace server) and Rita's `pin_card`; the rail's Add widget row is gone. The web preview relays News through openbq-docker v8's `web` profile. See the in-app Help topics **News**, **Pinned cards** and **Locked widgets**, `docs/examples/v8.0.0-news.apps.json` and `docs/examples/v8.0.0-pinned.apps.json`, and the [release notes](docs/releases/v8.0.0-release-notes.md). 8.0.0 also includes everything in the v7 rebuild (`v7.0.0` 2dff408): Save…, File ▸ Import apps.json…, Connections export/import, Workspaces' minimum resolution, zoom and launch, the Rust Pivot foundation, and backend tables on the table worker (the Pivot drawer and linked tables for non-SSRM backend tables).

## EODHD data and the Episode 9 calendars (v9)

9.0.0 shows **EODHD** data as openbq-docker v9's `openbq-eodhd` extension serves it: the widgets arrive in openbb-api's `widgets.json` with nothing to configure in BDOBB, the key is the stack's `EODHD_API_KEY`, and EODHD's economic and earnings calendars open in the Calendar view with their Source → Release → Statistic tree and Type / Series filters. A column's provider aggregation hint is now kept with the column. See the in-app Help topic **EODHD data**, `docs/examples/v9.0.0-calendars.apps.json`, and the [release notes](docs/releases/v9.0.0-release-notes.md).

## The live grid and the Episode 10 example (v10)

10.0.0 draws a **live grid** as a full table card that streams: the snapshot comes over HTTP, then each row ticks in place over the widget's websocket, merged by its identity column, with the subscription sent as a frame and re-sent over the open socket when the symbols change. OpenBB's reference `/live_grid_ws` (no auth, one row per frame) still works as it has since v3; the stack's live-grid adds logos and 52-week ranges from its `symbol_meta`, drawn by the new `logo`, `rangeBar` and `percentKey` column declarations and column `align`. A header or cookie credential does not ride a browser websocket (V10-P1). The web preview relays live-grid's `/grid` family under openbq-docker v10.0.0's vendored gateway policy, and seeds a Live quotes tab. See the in-app Help topic **Tables**, `docs/examples/v10.0.0-live-grid.apps.json`, and the [release notes](docs/releases/v10.0.0-release-notes.md).

AGPL-3.0-only for the application and first-party source changes. Copyright 2026 SecretoftheUniverse.com LLC. See [licensing and source availability](LICENSING.md). Earlier Apache grants and third-party notices remain in force.

Managed server tables and registered standard SSRM providers are described in the
in-app Tables help and [native deployment guide](deploy/table-service/README.md).
See [SSRM qualification](docs/superpowers/evidence/2026-10-14-table-ssrm/README.md)
for measured limits, exact source pairing and the unqualified Docker image status.

## Documentation copyright and permitted use

Copyright © 2026 SecretoftheUniverse.com LLC. The original reference and help materials identified in [DOCUMENTATION_TERMS.md](DOCUMENTATION_TERMS.md) are licensed separately from the software. Reading and personal or internal operational use are permitted; republication and use to reconstruct a product are restricted, subject to applicable law and existing license rights. The full terms are available offline in Quick Help’s Getting started and the Reference Manual’s home page. These terms do not change AGPL-3.0-only software rights, third-party licenses, or previously granted permissions.
