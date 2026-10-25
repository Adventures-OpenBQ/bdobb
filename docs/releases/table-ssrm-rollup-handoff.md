# table_ssrm roll-up handoff

Published for another process to integrate; no release branch merge or deployment
has been performed. Authoritative repositories are Adventures-OpenBQ/bdobb and
Adventures-OpenBQ/openbq-docker. Both feature branches are `codex/table-ssrm-v10`.

## Release placement

User constraint: integrate before v7 so physical iPad testing exercises SSRM.
Recommendation discussed: execution/large cached-table foundation in v4; generic
Statement presentation integration in v5; physical iPad acceptance in v7.
The receiving process must choose v4/v5 placement and port dependencies deliberately.
This implementation was built on v10 main; do not merge the whole v10 ancestry into
v4. No target release branch, existing tag, or remote main was changed by this task.

## Reviewed inputs and moving main

- bdobb original base: `ba5553d52b7048bd313eb224eac9505c5c3960bf`.
- bdobb reviewed final source/evidence: `1b0c15b27342072e9856132dfa8e5eea1ac759c0`.
- Docker original base: `186034209b38c9774a211d6ccbea581129b6e8fc`.
- Docker reviewed source pin: `41641c684af4db1c6390ea682e5663daff331bfd`.
- Observed current main at publication: bdobb `247f6435b8cf20c180667ea351dcfb406a88ae84`,
  Docker `72834aa6b58c5e2addd36aec0692f028a93fa2be`.
- Subsequent publication handoff commits contain documentation only. Tested product
  code was not rebased onto moving main. Receiving process owns reconciliation and
  final cumulative release qualification.

## Exact paired source and policy

Docker `table-service/source.lock.json` pins bdobb native source
`1382c316d3838355a4366a163e63f280500d7284`, tree
`d7c9a9a11122ea90b72925ca33363563c0dd81d4`. bdobb `package.json` and
`web/policy.vendored.json` pair Docker `41641c684af4db1c6390ea682e5663daff331bfd`.
Canonical policy SHA-256:
`c4d1a2bd75523d75b53a0cb579116ecf4e627210e6c8bd2196eb3deba672fc7a`.
Keep source-lock, source export and canonical/vendored policy in sync when porting;
policy/source publication documentation does not require a circular pin update.
Use Docker's `table-service/prepare-source.mjs` to export the exact committed source.

## Implemented and reviewed

Native Rust table service/contained workers; durable owner-scoped upload/backend
sources; managed table_ssrm pivots/Statement semantics, refresh/reopen, linked
children/charts and pinned full-scope exports; conservative standard OpenBB LIVE
provider; opt-in private Compose service and authenticated web/gateway routing.
Existing local Wasm behavior is preserved. Cancellation, session disposal and export
cleanup now have two independently bounded control slots at each layer, with finite
independent relay rate budgets, so ordinary saturation cannot starve them.

Latest passing checks: JavaScript8171/29 skipped, service72, Node22 web57,
gateway96, actual native Chromium/WebKit4; strict clippy, types, amended lint,
headers, source export, Compose and pairing. One initial unchanged viewer-popup
failure passed isolated16 and final full8171; all attempts are disclosed in evidence.

Evidence and review records:
- [Qualification](../superpowers/evidence/2026-10-14-table-ssrm/README.md)
- [Control fix and commands](../superpowers/evidence/2026-10-14-table-ssrm/control-admission-fix.md)
- [Independent control fix review](../superpowers/evidence/2026-10-14-table-ssrm/control-admission-review.md)
- [Design](../superpowers/specs/2026-10-14-table-ssrm-design.md)
- [Implementation plan](../superpowers/plans/2026-10-14-table-ssrm.md)

## Optimization backlog, not implemented

The user requested performance and deep reviews; only the confirmed control-admission
bug was subsequently fixed. Proposed optimization edits have NOT been implemented.
[Backend review](../superpowers/evidence/2026-10-14-table-ssrm/performance-backend-review.md)
and [frontend review](../superpowers/evidence/2026-10-14-table-ssrm/performance-frontend-review.md)
record allocation probes, repeated service decode, per-comparison string allocation,
chart refetch/double builds, duplicate LIVE first-page fetch, hidden-tab sessions,
input preparation and browser export materialization. Local /private/tmp probe/log
paths in historical reports refer to the originating machine and are not portable
artifacts. Timings are debug/synthetic observations, not production speedup promises.

## Qualification limits

Assembled production image remains UNQUALIFIED: its build hit Docker VM ENOSPC.
Equivalent non-root Linux runtime tests do not qualify final image layers, UID10001,
named-volume initialization or release binaries. Physical iPad, packaged desktops,
real external OAuth and larger production capacities need receiving-process checks.
Do not publish a release or claim large cached-table capacity from admission ceilings.

## Walked (2026-10-15)

This roll-up was walked down to its home lines and carried forward v4 → v10 by real merges, together
with openbq-docker PR #10. By the user's ruling the gateway moved down to openbq-docker v4. The pins
above are the reviewed branch's. Each walked line's pairing commits, merge resolutions and gates are
in `docs/releases/v4-ssrm-walk.md` … `v9-ssrm-walk.md`. `v10-ssrm-walk.md` also classifies every
difference between walked v10 and this branch's reviewed sources.
