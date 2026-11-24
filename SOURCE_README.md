# Corresponding Source for the v3.0.0 AGPL edition

Base repository: Adventures-OpenBQ/bdobb
Exact base revision and source identity: source-offer.json and SOURCE-MANIFEST.json.
Application licensing: AGPL-3.0-only, with retained third-party and earlier Apache grants.

This source tree includes the AGPL edition, revision-specific Help
source link, exact lockfiles, necessary build scripts, original artwork and
vendored source where present. It is NOT the unchanged source of the old
Apache binary. Build any new AGPL binary from this complete edition tree.

## Verify before building

Run `python3 -B verify-source.py` immediately after extraction, before creating
node_modules, Git state or generated build output. SOURCE-MANIFEST.json lists
the exact files and source identity. The external catalogue supplies the SHA-256
of the compressed archive. The source identity excludes only the two generated manifest/offer files;
the manifest checks all other archived bytes and file modes. Historical source
offers remain available under their own revision-specific release tags.

## Matching dependency distributions and license evidence

Also download the shared package archive `dependency-pack-a1b2ab0d108e6dbb7044.tar.gz`.
SHA-256: `64f4103bcdeb91c76a8cf45ab0118c574a8ceef84152de0a8c7eb958b8aa9941`.
Public dependency archive: https://github.com/Adventures-OpenBQ/bdobb/releases/download/agpl-dependencies-a1b2ab0d108e/dependency-pack-a1b2ab0d108e6dbb7044.tar.gz

The shared dependency archive is published separately. Verify its checksum
before use. The application's Help source URL identifies this particular
source revision; release qualification verifies that exact archive link.
The dependency manifest identifies each package,
original location, lockfile integrity and release coverage. Original npm .tgz
and Cargo .crate distributions are provided separately to avoid duplicating
the same dependency bytes in every application's source archive. Extract those
archives to inspect or reuse their source. MPL-covered published BlockNote
packages contain src/, and the Rust crates contain their source. The pack's
copyleft-source report records source-member checks. Do not replace upstream
licenses with AGPL. Recovered evidence and standard terms are reproduced in
SUPPLEMENTAL_THIRD_PARTY_NOTICES.md and LICENSES/dependency-evidence/.

## Current-lock supplement (required)

This revision additionally requires `dependency-supplement-e386090b3420933f229b.tar.gz`.
SHA-256: `3cc05062fa8ba94e005d5038400f4bf2a0193461a11a93c01b70276c8e3eec69`.
Public archive: https://github.com/Adventures-OpenBQ/bdobb/releases/download/agpl-dependencies-e386090b3420/dependency-supplement-e386090b3420933f229b.tar.gz

The base pack preserves 1,383 of this revision's exact distributions; the
supplement supplies the other 169, including updated Tauri and development
packages. Together their manifests cover all 1,552 current pinned npm/Cargo
distributions, including optional and platform-specific entries. Match the
coverage lockfile hashes to this source tree. Both archives retain original
package distributions and their notices; application/local path-package source
remains in this application archive. This does not claim that every published
JavaScript distribution contains upstream preferred source or bundle OS SDKs.

The native TLS patch updates also require the supplemental archive
`dependency-pack-native-tls-1121714ec7b0c0b0e2ce.tar.gz`.
SHA-256: `877fb7e2f9b54c6c879f3a9c2e6c756ae07d5bac53c435a8b9d308a8a06f93c6`.
Its prepared public URL is
https://github.com/Adventures-OpenBQ/bdobb/releases/download/agpl-dependencies-native-tls-1121714ec7b0/dependency-pack-native-tls-1121714ec7b0c0b0e2ce.tar.gz
The link is a prepared publication target until the archive is uploaded.
NATIVE-TLS-DEPENDENCY-SOURCES.json identifies this separate archive;
NATIVE-TLS-DEPENDENCY-COVERAGE.json binds its four complete upstream Cargo
distributions and licence evidence to this edition's native lockfile.
Use both dependency archives. The shared archive remains unchanged.

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

Documentation copyright patch v3.0.0, based on published source commit 540cd0bcaa1a2821de4659460f707a6e038a7539. The software remains AGPL-3.0-only; DOCUMENTATION_TERMS.md preserves existing permissions and Corresponding Source rights.
