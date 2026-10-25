# Dependency evidence resolution

78 of 78 reviewed package/version entries resolved. 0 unresolved.

Scope: 75 missing-root-file entries from dependencies.csv, historical swift-rs 1.0.7 and canvas-darwin-arm64 0.1.100, and vendored swift-rs 1.0.8. Exact manifest declarations are distinguished from recovered full grant text. All original author/copyright notices are preserved in evidence rather than inferred. Standard texts come from pinned SPDX license-list-data v3.26.0 and are explicitly labeled.

Requires Python 3.11+ (tomllib). Reproduce: run `python3 resolve.py` then `python3 finalize.py` from this directory (network access required). The initial resolver obtains exact npm version metadata and Rust crate VCS revisions, then fetches root/ancestor license files at those revisions. The finalizer preserves exact published manifests, README files and notices and supplies explicitly declared standard terms.

This is license evidence, not the complete corresponding source. Preserve original pinned npm tarballs, Cargo .crate archives and local vendored sources, with their lockfiles and build scripts, for each release graph. `published_tarball` in resolution.json records known exact source URLs and integrity/hash information; repository revision identifies matching upstream source. Do not replace exact sources with current main.
