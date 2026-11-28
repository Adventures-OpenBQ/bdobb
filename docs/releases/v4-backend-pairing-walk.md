# v4 backend pairing walk — 2026-11-28

This record covers one change: `release/v4` now names the openbq-docker commit it was qualified against. It is not a new qualification of v4, and nothing here was re-run except where stated.

## What changed

| Item | Value |
|---|---|
| Pull request | #94, merged 28 November 2026 at 16:15 UTC |
| Merge commit | `8a15fbe4b2006098458726da36fbb9b013864a20`, a two-parent merge of `c786b37e7ebb` and `50a80d81b9a7` |
| Backend pin before | `fef37add2e044d9eb73408f86ab196105be7fc07` |
| Backend pin after | `b73f8a9e475bbd59235a5e08a5380801eaaa39e7`, the openbq-docker `v4.0.0` tag and the tip of its `release/v4` branch |
| Files changed | `package.json`, `web/policy.vendored.json`, `source-offer.json`, `SOURCE_README.md`, `SOURCE-MANIFEST.json` |
| Product source changed | None |

The vendored gateway policy's recorded hash is unchanged, so its bytes are the same. Only the commit it is attributed to moved.

## Why the pin was wrong, and why no requalification follows

The earlier pin was a stale record. The release walk's readiness record for v4 (24 November 2026) names `c786b37e7ebb` as the client and `b73f8a9e475b` as the backend. That client is the commit the pull request was based on, and that backend is the commit it now pins. The pairing recorded here is the one that was qualified.

Because no product source changed, the registered-key, native and inference evidence from that readiness record is retained for this change. It was read for client, backend and scope. It was not re-audited or re-run.

## Checks made for this change

- **CI on the pull request head `50a80d81b9a7`:** all six jobs passed (build, pivot, reference, public-content, scrub, e2e). The build job includes typecheck, lint, the unit tests, the web tests and the build. No CI run exists for the merge commit itself; the workflow does not run on pushes to release branches.
- **Backend identity:** the backend image used below carries a revision label equal to `b73f8a9e475b`.
- **Fresh public reader lane, 28 November 2026,** on a local Docker host: a new container and new volumes with demo keys only, provider cache empty before the first request, 997 catalogue entries served. Ten distinct public EIA cases were attempted: 1 returned data (186 rows) and 9 returned the provider's rate-limit message. Quota-limited cases are not passes. No case failed, peak memory was 2.70 GiB, and every resource the run created was removed. This lane reached the backend directly on a private container network; it does not exercise the client or any tunnel route.

## Corresponding source

| Item | Value |
|---|---|
| Source identity | `80bb7f1411c89a2bf3692272f7117b023ca3601ee1b4f104a52daf23e38afa14` |
| Archive | `bdobb-v4.0.0-agpl-80bb7f1411c8-source.tar.gz`, 8,134,867 bytes |
| SHA-256 | `8779bf524a02a420910a730f579beab9457b2a62fc23f214f04d696293ac8173` |
| Previous identity | `6ef13d9fe2c5`, whose release remains published |

Published and verified on 28 November 2026: release `agpl-v4.0.0-80bb7f1411c8` targets `8a15fbe4b200`, and an anonymous download of the archive matches the SHA-256 below.

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
