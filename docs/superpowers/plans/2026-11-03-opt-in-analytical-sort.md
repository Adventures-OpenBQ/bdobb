# Opt-in analytical sort reuse implementation plan

> Execute inline using executing-plans. Keep default behavior unchanged.

**Goal:** Add disabled-by-default TypeScript analytical sort reuse with canonical indexes owned by the existing result-store snapshot.
**Architecture:** Optional calculation capture with bounded index entries; private store reorders a cloned snapshot only when guarded dependencies match. Full calculation is the fallback. Explicit structural reservation is not a heap/device guarantee.
**Tech stack:** Existing TypeScript, Vitest, native workers; no Rust or dependencies.
**Spec:** Prior experiment reports in Downloads/openbq-applymodel-profile-2026-11-02/v4-indexed-browser-report.md and v4-indexed-sort-report.md.

## Constraints
- Scope schema1 enabled, complete calculation/input, unique source IDs; no Statements/split-only layouts; default reconciliation only.
- Validate new requests normally; preserve NaN fallthrough/stable ties, selection/export order and canonical diagnostics.
- Default off. Explicit handler option/worker-name opt-in only; no UI setting or supported-device default.
- Register/dispose invalidates the only store. Runtime/model changes or inadequate/unknown reservations use full calculation.
- Never export a mutable owned view. Keep public createResultStore clone isolation; internal builder only consumes private clones.

## Tasks
- [x] RED worker parity/call-count tests for opt-in hit, default-off fallback, dependency changes and source replacement.
- [x] Implement bounded capture, guard/reservation/reordering helpers, shared selection reconciliation, store/worker integration.
- [x] Run focused and full TypeScript suites, typecheck/lint, production build/WASM packaging checks where needed.
- [x] Fresh branch-wide review; fix important findings with tests. Keep release branches and existing PRs untouched.

## Review focus
Input/runtime invalidation, unsupported modes, duplicate IDs; stable ties/NaN/source aliases; diagnostic and selection isolation; unknown graph/limit admission; failure retaining previous publication. Physical device, heap peak and broad enablement remain outside this opt-in change.

## Review and validation ledger
- Reviewer found inherited-property reads in reuse differed from full calculation. Shared display helpers now retain own-property checks; regressions cover sparse prototype-named fields and inherited group cells.
- Focused verification: 33 tests passed; typecheck and lint passed after shared-helper changes. Final full suite: 365 files passed, 2 skipped; 6,641 tests passed, 7 skipped. Packaging: 3 passed. Production build and git diff --check passed (existing large-chunk warnings).
- Actual untransformed worker benchmark completed in Chromium and WebKit: workload parity and nine lifecycle scenarios per browser passed. Raw samples and source snapshot are archived in Downloads/openbq-applymodel-profile-2026-11-02/v4-actual-sort-*. Desktop timings are exploratory due to other active applications. Default remains off; heap/device qualification remains pending.

- Chromium retained-heap probe: 20 fresh-worker trials (five per workload/mode), checkpoints through 100 sorts and worker-side disposal. Bundle matches the timed run. Little opt-in growth between checkpoints 25 and 100; disposal reduced used heap in all trials. Raw memory samples/report archived alongside timings. Peak/RSS/WebKit/device qualification remains pending. Production implementation unchanged during this probe.

## High-cardinality follow-up
- Actual 500/2,000 distinct-group probe found a crossover in Chromium: 2,000-group warm reuse 140.7 ms versus full 130.1 ms. WebKit remained faster but also scaled poorly.
- RED regression: 50 groups caused 1,325 source-member lookups during reuse.
- Store exact calculation-time group sort keys alongside canonical indices. Remove warm source scans; double per-entry structural reservation and capture divisor from 512 to 1,024. No change to default enablement or Rust.
- GREEN: 34 focused tests, 6,642 full tests (7 skipped), typecheck/lint, packaging (3), production build and diff whitespace checks passed. Reviewer found no issues.
- Current-bundle probes passed: ordinary and high-cardinality response parity in both browsers plus nine lifecycle scenarios each; 20 Chromium retained-heap trials through 100 sorts/disposal. At 2,000 groups, warm full→reuse was 121.95→39.35 ms in Chromium and 125→54 ms in WebKit. Current reports/source manifest use the v4-captured-keys prefix; earlier v4-actual-sort reports describe the previous metadata representation.
