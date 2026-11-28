# v7 backend pairing walk — 2026-11-28

This record covers one change: `release/v7` now names the openbq-docker commit it was qualified against. It is not a new qualification of v7, and nothing here was re-run except where stated.

## What changed

| Item | Value |
|---|---|
| Pull request | #97, merged 28 November 2026 at 16:31 UTC |
| Merge commit | `7b2806d19c3ae5709fef9897d80bc194b5a9c5b4`, a two-parent merge of `56b3bbf7e88f` and `c6cb76378f9c` |
| Backend pin before | `52f246360b25c793727e97d4654d36fe467dc952` |
| Backend pin after | `cff3f27d586e06b3992e66676f7473188bfbba43`, the openbq-docker `v7.0.0` tag and the tip of its `release/v7` branch |
| Files changed | `package.json`, `web/policy.vendored.json`, `source-offer.json`, `SOURCE_README.md`, `SOURCE-MANIFEST.json` |
| Product source changed | None |

The vendored gateway policy's recorded hash is unchanged, so its bytes are the same. Only the commit it is attributed to moved.

## Why the pin was wrong, and why no requalification follows

The earlier pin was a stale record. The release walk's readiness record for v7 (25 November 2026) names `56b3bbf7e88f` as the client and `cff3f27d586e` as the backend. That client is the commit the pull request was based on, and that backend is the commit it now pins. The pairing recorded here is the one that was qualified.

Because no product source changed, the registered-key, native and inference evidence from that readiness record is retained for this change. It was read for client, backend and scope. It was not re-audited or re-run.

## Checks made for this change

- **CI on the pull request head `c6cb76378f9c`:** all six jobs passed (build, pivot, reference, public-content, scrub, e2e). The build job includes typecheck, lint, the unit tests, the web tests and the build. No CI run exists for the merge commit itself; the workflow does not run on pushes to release branches.
- **Backend identity:** the backend image used below carries a revision label equal to `cff3f27d586e`.
- **Fresh public reader lane, 28 November 2026,** on a local Docker host: a new container and new volumes with demo keys only, provider cache empty before the first request, 998 catalogue entries served. Ten distinct public EIA cases were attempted: 1 returned data (186 rows) and 9 returned the provider's rate-limit message. Quota-limited cases are not passes. No case failed, peak memory was 2.52 GiB, and every resource the run created was removed. This lane reached the backend directly on a private container network; it does not exercise the client or any tunnel route.

## Corresponding source

| Item | Value |
|---|---|
| Source identity | `5d04bb5656db0f67c11e433c819d79d3a9bb2468b1b09501379a27c947619be5` |
| Archive | `bdobb-v7.0.0-agpl-5d04bb5656db-source.tar.gz`, 17,955,860 bytes |
| SHA-256 | `325ab4afbb1c5ed85768c053d738dfc9ebd45e3d0c445e672b6cc7cd9f1aa188` |
| Previous identity | `4ba2fd2e1ff9`, whose release remains published |

Published and verified on 28 November 2026: release `agpl-v7.0.0-5d04bb5656db` targets `7b2806d19c3a`, and an anonymous download of the archive matches the SHA-256 below.

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
