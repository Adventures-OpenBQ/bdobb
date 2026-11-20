# BDOBB — Adventures in OpenBQ

This is the version 4.0.0 release: the reference-build desktop plus analytical Pivot, managed server tables, linked charts, waterfall charts and Statement editing. It retains documents, grouped controls, backend Apps discovery and compatible JSON interchange.

Cron refetch is deferred.

Read the [user guide](docs/user-guide.md) and [v3 reference manual](docs/reference-manual/v3/README.md), also available through the app’s Help menu.

## Run and verify

The Pivot Wasm module is generated from the included Rust source; it is not checked into the repository or source archive. Install the pinned toolchain once, then generate it before running TypeScript checks. Native desktop builds also require the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
rustup toolchain install 1.98.1
rustup target add --toolchain 1.98.1 wasm32-unknown-unknown
cargo +1.98.1 install wasm-bindgen-cli --version 0.2.128 --locked --root .pivot-tools
pnpm install --frozen-lockfile
pnpm pivot:build
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

AGPL-3.0-only for the application and first-party source changes. Copyright 2026 SecretoftheUniverse.com LLC. See [licensing and source availability](LICENSING.md). Earlier Apache grants and third-party notices remain in force.

Managed server tables and registered standard SSRM providers are described in the
in-app Tables help and [native deployment guide](deploy/table-service/README.md).

## Documentation copyright and permitted use

Copyright © 2026 SecretoftheUniverse.com LLC. The original reference and help materials identified in [DOCUMENTATION_TERMS.md](DOCUMENTATION_TERMS.md) are licensed separately from the software. Reading and personal or internal operational use are permitted; republication and use to reconstruct a product are restricted, subject to applicable law and existing license rights. The full terms are available offline in Quick Help’s Getting started and the Reference Manual’s home page. These terms do not change AGPL-3.0-only software rights, third-party licenses, or previously granted permissions.
