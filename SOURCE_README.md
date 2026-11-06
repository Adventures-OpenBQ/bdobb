# Source for BDOBB v11.0.0

Base repository: Adventures-OpenBQ/bdobb
The source identity and preparation commit are recorded in source-offer.json;
SOURCE-MANIFEST.json identifies the complete release tree.
Application licensing: AGPL-3.0-only, with retained third-party and earlier Apache grants.

This source tree includes the revision-specific Help
source link, exact lockfiles, necessary build scripts, original artwork and
vendored source where present. It is NOT the unchanged source of the old
Apache binary. Build any new AGPL binary from this complete edition tree.

## Verify before building

Run `python3 -B verify-source.py` immediately after extraction, before creating
node_modules, Git state or generated build output. SOURCE-MANIFEST.json lists
the exact files and source identity. The external catalogue supplies the SHA-256
of the compressed archive. The original tag and commit have not been moved.

## Matching dependency distributions and license evidence

Also download the shared package archive `dependency-pack-a1b2ab0d108e6dbb7044.tar.gz`.
SHA-256: `64f4103bcdeb91c76a8cf45ab0118c574a8ceef84152de0a8c7eb958b8aa9941`.
Prepared public URL: https://github.com/Adventures-OpenBQ/bdobb/releases/download/agpl-dependencies-a1b2ab0d108e/dependency-pack-a1b2ab0d108e6dbb7044.tar.gz

Release assets are published separately from preparation of this tree. Verify
the assets are accessible and their SHA-256 values match before distribution.
The dependency pack's manifest identifies each package,
original location, lockfile integrity and release coverage. Original npm .tgz
and Cargo .crate distributions are provided separately to avoid duplicating
the same dependency bytes in every application's source archive. Extract those
archives to inspect or reuse their source. MPL-covered published BlockNote
packages contain src/, and the Rust crates contain their source. The pack's
copyleft-source report records source-member checks. Do not replace upstream
licenses with AGPL. Recovered evidence and standard terms are reproduced in
SUPPLEMENTAL_THIRD_PARTY_NOTICES.md and LICENSES/dependency-evidence/.

Also download the rustls security-update supplement:

- File: `rustls-0.23.46.crate`
- SHA-256: `48e13bd8c0e9365c43cfa5c9e8f9ad49d3c8444926c9aac819e0e4dc503c8fdf`
- URL: https://github.com/Adventures-OpenBQ/bdobb/releases/download/agpl-dependencies-rustls-0.23.46-48e13bd8c0e9/rustls-0.23.46.crate

The existing dependency pack retains the older rustls distribution for its
historical releases. This tree's Cargo lockfile selects 0.23.46; the supplement
provides those exact upstream source bytes. All other dependency lockfiles match
the earlier v11 preparation. Keep original license texts and vendored patches.

## Build the application

Use the tool versions in package.json, the Cargo manifests and (where present)
scripts/pivot-toolchain.json. Install the Node and Rust toolchains for your
platform, then run:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm typecheck
```

The normal package-manager install uses the registries specified in the
lockfiles; the separate distribution pack preserves the exact package bytes
and licenses for source access, but is not an already-populated pnpm store.
General-purpose compilers, package managers, OS libraries and platform SDKs
are not bundled as executable tooling. Do not confuse access to source with
proof of an offline build on every OS.

Where Pivot Rust/WASM crates are present, the Vite build checks or rebuilds
the artifact from the included Rust sources. Install the pinned Rust target
and wasm-bindgen version following scripts/pivot-toolchain.json and
scripts/build-pivot-wasm.mjs. Do not reuse a stale WASM build stamp.

For native packaging run `pnpm tauri:build` with the platform's prerequisites.
Signing/notarization and app-store delivery need their own account credentials
and authorization. No signing secrets or user data are in this source tree.

The supplied source offer is version-specific. A modified downstream build
must offer its OWN corresponding source rather than reusing this edition's
link. Regenerate source identity/offer/archive after modifying covered source.

## Release scope

The tree includes the v11 TemporalDB client, retained-result paging, managed-table
integration, startup discovery notices and native rustls security update. The
backend and TemporalDB are separately deployed services with their own sources
and terms. This archive contains no signing secrets, provider credentials or
user portfolio records. A source archive alone does not qualify desktop signing,
notarization or every provider/data workflow.
