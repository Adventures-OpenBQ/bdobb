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

AGPL-3.0-only for the application and first-party source changes. Copyright 2026 SecretoftheUniverse.com LLC. See [licensing and source availability](LICENSING.md). Earlier Apache grants and third-party notices remain in force.

Managed server tables and registered standard SSRM providers are described in the
in-app Tables help and [native deployment guide](deploy/table-service/README.md).
