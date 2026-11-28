# v8 backend pairing walk — 2026-11-28

This record covers one change: `release/v8` now names the openbq-docker commit it was qualified against. It is not a new qualification of v8, and nothing here was re-run except where stated.

## What changed

| Item | Value |
|---|---|
| Pull request | #98, merged 28 November 2026 at 16:31 UTC |
| Merge commit | `42aad7c67f710c800ea6ac3b40a51c95a18f6b8f`, a two-parent merge of `c0f80570b4c8` and `50c021c9e1fb` |
| Backend pin before | `d6146e8924858a932be61d060a75e13c1264d650` |
| Backend pin after | `e25b03f4e68ff8fba554046a34e0e918a10553c7`, the openbq-docker `v8.0.0` tag and the tip of its `release/v8` branch |
| Files changed | `package.json`, `web/policy.vendored.json`, `source-offer.json`, `SOURCE_README.md`, `SOURCE-MANIFEST.json` |
| Product source changed | None |

The vendored gateway policy's recorded hash is unchanged, so its bytes are the same. Only the commit it is attributed to moved.

## Why the pin was wrong, and why no requalification follows

The earlier pin was a stale record. The release walk's readiness record for v8 (25 November 2026) names `c0f80570b4c8` as the client and `e25b03f4e68f` as the backend. That client is the commit the pull request was based on, and that backend is the commit it now pins. The pairing recorded here is the one that was qualified.

Because no product source changed, the registered-key, native and inference evidence from that readiness record is retained for this change. It was read for client, backend and scope. It was not re-audited or re-run.

## Checks made for this change

- **CI on the pull request head `50c021c9e1fb`:** all six jobs passed (build, pivot, reference, public-content, scrub, e2e). The build job includes typecheck, lint, the unit tests, the web tests and the build. No CI run exists for the merge commit itself; the workflow does not run on pushes to release branches.
- **Backend identity:** the backend image used below carries a revision label equal to `e25b03f4e68f`.
- **Fresh public reader lane, 28 November 2026,** on a local Docker host: a new container and new volumes with demo keys only, provider cache empty before the first request, 998 catalogue entries served. Ten distinct public EIA cases were attempted: 1 returned data (186 rows) and 9 returned the provider's rate-limit message. Quota-limited cases are not passes. No case failed, peak memory was 2.48 GiB, and every resource the run created was removed. This lane reached the backend directly on a private container network; it does not exercise the client or any tunnel route.

## Corresponding source

| Item | Value |
|---|---|
| Source identity | `3bd2786e7f5946020fe2d14dee04a74a6abc3abd7fa33b1fe4073a99bd625989` |
| Archive | `bdobb-v8.0.0-agpl-3bd2786e7f59-source.tar.gz`, 18,948,007 bytes |
| SHA-256 | `870fcd57da46a0752bd05df9b60d3618c73a743b3c65fc7b70df05ae0b3b77c5` |
| Previous identity | `e23042da4143`, whose release remains published |

Published and verified on 28 November 2026: release `agpl-v8.0.0-3bd2786e7f59` targets `42aad7c67f71`, and an anonymous download of the archive matches the SHA-256 below.

- The archive passes its own `verify-source.py` and its identity equals `source-offer.json` on the merge commit.
- It was built independently on two machines to identical bytes.
- The same build method reproduces the previously published v4 archive byte for byte.
- It differs from the previously published source only in the five files listed above.
- No actual-value privacy scan was run on the new archive. The basis for publishing without one is that the changed files hold only commit hashes, source identities and archive names.

## Not done

- No installer was rebuilt from the merge commit. Published installers carry the previous source identity and are unaffected.
- No registered-key, native, device or inference test was re-run.
- The nine quota-limited public cases were not retried.

## Note for whoever merges this record

`SOURCE-MANIFEST.json` lists every file under `docs/`. Adding this file changes the branch's tree, so after merging, the branch tip will no longer match its bound source identity until the source offer is re-bound and a new source release is published. The published release above stays valid for the commit it targets.
