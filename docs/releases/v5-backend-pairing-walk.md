# v5 backend pairing walk — 2026-11-28

This record covers one change: `release/v5` now names the openbq-docker commit it was qualified against. It is not a new qualification of v5, and nothing here was re-run except where stated.

## What changed

| Item | Value |
|---|---|
| Pull request | #95, merged 28 November 2026 at 16:31 UTC |
| Merge commit | `ace8e43208f0ecc14e759da6772116f185c07a3c`, a two-parent merge of `0cecf56a94f0` and `036f20999ada` |
| Backend pin before | `d6159690abb552d15d72f1ef17464a94197c261b` |
| Backend pin after | `1c06ace6df99327dd3c04fc68ce794ff02a05f8d`, the openbq-docker `v5.0.0` tag and the tip of its `release/v5` branch |
| Files changed | `package.json`, `web/policy.vendored.json`, `source-offer.json`, `SOURCE_README.md`, `SOURCE-MANIFEST.json` |
| Product source changed | None |

The vendored gateway policy's recorded hash is unchanged, so its bytes are the same. Only the commit it is attributed to moved.

## Why the pin was wrong, and why no requalification follows

The earlier pin was a stale record. The release walk's readiness record for v5 (the release walk's state record) names `0cecf56a94f0` as the client and `1c06ace6df99` as the backend. That client is the commit the pull request was based on, and that backend is the commit it now pins. The pairing recorded here is the one that was qualified.

Because no product source changed, the registered-key, native and inference evidence from that readiness record is retained for this change. It was read for client, backend and scope. It was not re-audited or re-run.

## Checks made for this change

- **CI on the pull request head `036f20999ada`:** all six jobs passed (build, pivot, reference, public-content, scrub, e2e). The build job includes typecheck, lint, the unit tests, the web tests and the build. No CI run exists for the merge commit itself; the workflow does not run on pushes to release branches.
- **Backend identity:** the backend image used below carries a revision label equal to `1c06ace6df99`.
- **Fresh public reader lane, 28 November 2026,** on a local Docker host: a new container and new volumes with demo keys only, provider cache empty before the first request, 998 catalogue entries served. Ten distinct public EIA cases were attempted: 1 returned data (186 rows) and 9 returned the provider's rate-limit message. Quota-limited cases are not passes. No case failed, peak memory was 2.48 GiB, and every resource the run created was removed. This lane reached the backend directly on a private container network; it does not exercise the client or any tunnel route.

## Corresponding source

| Item | Value |
|---|---|
| Source identity | `468321428e7b4f00c11055ec03e7b969a8bce9104f62f65c39dc7928f72296da` |
| Archive | `bdobb-v5.0.0-agpl-468321428e7b-source.tar.gz`, 9,539,707 bytes |
| SHA-256 | `27f0b42e4870f0750c4cf21e5aa756be668e1191ff6871bf17b126fa627f3753` |
| Previous identity | `de991772ee80`, whose release remains published |

Published and verified on 28 November 2026: release `agpl-v5.0.0-468321428e7b` targets `ace8e43208f0`, and an anonymous download of the archive matches the SHA-256 below.

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
