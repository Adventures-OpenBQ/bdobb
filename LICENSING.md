# BDOBB licensing and source availability

The application and first-party source changes in this release are licensed
under the GNU Affero General Public License, version 3 only
(`AGPL-3.0-only`). The complete license is in LICENSE. No optional Apache
license is offered for new AGPL-only source changes.

## Earlier releases and retained licenses

Earlier Apache-2.0 releases remain available under the permissions already
granted. Historical Git objects and tags are not relicensed or rewritten.
The original Apache text is retained in LICENSES/Apache-2.0.txt.

Third-party packages, vendored swift-rs (where present), interface artwork and the
byte-identical imported policy contracts (where present)
retain their own licenses. Apache notices must accompany Apache material.
Documentation (including imported help and historical specifications), data
and artwork retain their existing licenses; this change does not assert new
ownership of imported content or grant trademark or market-data rights.
See NOTICE, THIRD_PARTY_NOTICES.md and src/assets/icons/LICENSE.md.

## Distribution and hosting

When distributing covered binaries, provide their Corresponding Source in
accordance with AGPL section 6. When operating a modified version supporting
remote network interaction, prominently offer its Corresponding Source to
all remotely interacting users, at no charge, under section 13. These are
obligations to recipients/users, not a requirement to submit changes upstream.
Commercial use is allowed. Independent services and user data do not become
AGPL-covered merely because they communicate with the application.

For every release/deployment, make available the precise source used,
including first-party source, lockfiles, any patched vendored crate, necessary
build/install scripts and relevant dependency source/license obligations.
Include Rust Pivot sources and build instructions where present; a generated
WASM binary or JavaScript glue alone is not its preferred form for changes.
Do not include credentials, private user data or signing secrets. Determine
any applicable Installation Information obligations under section 6.

Before publishing, add and verify a prominent in-app source offer tied to the
actual deployed revision, publish a complete matching source archive beside
each download, and ensure users can access it. A default-branch link or an
inaccessible private repository is insufficient. A source archive should
include BUILDING/SOURCE instructions and any external source needed to meet
the applicable obligations. Make MPL dependency source and modifications
available under MPL as required; do not replace their MPL notices with AGPL.

## Contributions

New first-party code contributions are accepted under AGPL-3.0-only unless
explicitly agreed otherwise. Contributions to separately licensed files retain
those terms. Contributors must have authority to submit their work; use a
Developer Certificate of Origin 1.1 sign-off. A sign-off does not transfer
copyright or authorize unrelated relicensing. Do not alter third-party
notices or add use restrictions, mandatory watermarks, or extra network
publication conditions beyond the license.

## Review status and release boundary

This migration is prepared for review for the v4.0.0 source snapshot. The policy applies from v3.0.0 forward, including all later release lines. Select a NEW first AGPL release tag
after reviewing ownership, source availability, packaging and compatibility.
Do not reuse an existing Apache release tag or describe old Apache releases
as AGPL-only. No AGPL release is designated by this document.
