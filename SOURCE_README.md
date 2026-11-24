# Source for the v6.0.0 AGPL edition

Base repository: Adventures-OpenBQ/bdobb
Application licensing: AGPL-3.0-only, with retained third-party and earlier Apache grants.

This source tree includes the AGPL edition, revision-specific Help
source link, exact lockfiles, necessary build scripts, original artwork and
vendored source where present. It is NOT the unchanged source of the old
Apache binary. Build any new AGPL binary from this complete edition tree.

## Verify before building

Run `python3 -B verify-source.py` immediately after extraction, before creating
node_modules, Git state or generated build output. SOURCE-MANIFEST.json lists
the exact files and source identity. The external catalogue supplies the SHA-256
of the compressed archive. The release tag is updated only after qualification. Historical source offers and receipts are retained.

## Matching dependency distributions and license evidence

Also download the shared package archive `dependency-pack-a1b2ab0d108e6dbb7044.tar.gz`.
SHA-256: `64f4103bcdeb91c76a8cf45ab0118c574a8ceef84152de0a8c7eb958b8aa9941`.
Published public URL: https://github.com/Adventures-OpenBQ/bdobb/releases/download/agpl-dependencies-a1b2ab0d108e/dependency-pack-a1b2ab0d108e6dbb7044.tar.gz

Also download the published supplement `dependency-supplement-8ee464578a28d424dd26.tar.gz`.
SHA-256: `f91d0b7e758f23883cf63777288ba488baca4558adf2d2ede23c2061465f3831`.
URL: https://github.com/Adventures-OpenBQ/bdobb/releases/download/agpl-dependencies-8ee464578a28/dependency-supplement-8ee464578a28d424dd26.tar.gz

The original base archive and the current-lock supplement are required.
DEPENDENCY-SOURCES.json, including additionalPacks, is their authoritative exact
archive and manifest inventory. Also obtain the native TLS source supplement
identified below by NATIVE-TLS-DEPENDENCY-SOURCES.json. The primary
DEPENDENCY-COVERAGE.json retains the base assembly's lockfile and package
inventory, including development, optional and platform-specific entries.
The separate native TLS coverage binds this edition's four patched entries. The release walk verifies selected original npm
.tgz and Cargo .crate bytes against both archive hashes and lockfile integrities.
Local/path packages are supplied by this application source archive.

Original package notices and licenses remain in their distributions. MPL-covered
published BlockNote packages include src/, and Rust crates include their source.
The base pack's source-member and license-evidence reports retain their scope;
this is not a blanket preferred-source claim for every generated JS asset.
Recovered evidence and standard terms are reproduced in
SUPPLEMENTAL_THIRD_PARTY_NOTICES.md and LICENSES/dependency-evidence/.

## Native TLS dependency source supplement (required)

The native TLS patch updates also require the published supplemental archive
`dependency-pack-native-tls-1121714ec7b0c0b0e2ce.tar.gz`.
SHA-256: `877fb7e2f9b54c6c879f3a9c2e6c756ae07d5bac53c435a8b9d308a8a06f93c6`.
Public archive: https://github.com/Adventures-OpenBQ/bdobb/releases/download/agpl-dependencies-native-tls-1121714ec7b0/dependency-pack-native-tls-1121714ec7b0c0b0e2ce.tar.gz
NATIVE-TLS-DEPENDENCY-SOURCES.json identifies this separate archive;
NATIVE-TLS-DEPENDENCY-COVERAGE.json binds its four complete upstream Cargo
source distributions and licence evidence to this edition's native lockfile.
Obtain the original base archive and both supplements. Their source access does
not establish an offline build on every OS or bundle executable platform SDKs.

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

## Paired calendar walkup

Client PR #69: 53c9c33924cecdd8b5673641770cacd51ef1e26a
Provider PR #16: f9e3908155601108df957cf55e61b8c5b4e4f501
Exact paired provider commit: 45e3b41a31b2903db3a56c31fc7b289d6fda1892

The catalogue contains all 71 calendars. Coverage/disagreement limits in docs/calendars/release-v4-evidence.md remain applicable. These sources supersede earlier archive offers for this changed edition; historical source offers remain available.

Documentation copyright patch v6.0.0, based on published source commit da6f6be42803976932ce9d4395950db6d8e00ec9. The software remains AGPL-3.0-only; DOCUMENTATION_TERMS.md preserves existing permissions and Corresponding Source rights.
