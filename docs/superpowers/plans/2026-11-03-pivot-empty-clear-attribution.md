# Pivot empty/clear attribution implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. **PROPOSED, NOT EXECUTED. Execution requires separate approval.**

**Goal:** Attribute the existing warm empty/clear workload to its recorded child
revisions, retaining the production baseline and every original metric.

**Architecture:** Add bounded child probe slices and action durations in the
existing private performance adapter. Consume cumulative snapshots without
resetting the enclosing probe; preserve enclosing inclusive timings and counters.
Use the current qualification runner/artifact identity/parity/durable observer
contract; do not create a competing benchmark platform.

**Tech Stack:** Existing Node ESM tests, TypeScript trace adapter, existing probes
and JSON v1 qualification reports. No dependencies or production engine edits.

**Spec:** [Measured assessment and proposed design](../../testing/pivot-next-experiment.md).
The choice is provisional; this plan does not imply that a human selected or
approved a new optimization. No engine work is removed.

## Global constraints

- Profile source `594151886b11d44564af923ae7abf6d48d19af04` is the starting evidence;
  freeze a new exact source/artifact identity for approved future collection.
- Fixed limits: 300000 rows, 256 MiB input, 2 GiB state, 10000 columns,
  32 MiB batch, 64 MiB cache, two transfers, 60s work, default Node heap.
- No production optimization, cache, protocol, shared memory, resource increase,
  new dependency, push or merge. Rust's existing refusals remain unavailable.
- Explicit [] means zero rows; none/Clear means all eligible rows. Preserve
  original-order sums, stable temporal ties, nonwinning-row errors and
  full-universe requalification, even when selection is empty.
- Instrumented artifacts supply attribution only. Matched uninstrumented
  production-equivalent artifacts supply timing observations, not assumed gains.
- Keep certified Statements, labeled synthetic controls and bulk stress distinct.
  Pin input/reference/model/actions/environment; retain all outcomes and raw data
  externally. No concurrent builds/benchmarks or alteration of P3 archives.
- Current Rust selection failures and native/server gaps block promotion. No
  integrated-candidate pass transfers to clean release/v4 or a new revision.

## Review focus (each pinned to a task below)

1. Empty succeeds then clear fails: preserve completed empty revision, original
   failure and partial evidence; never fabricate clear success (Task 2).
2. A parent stage crosses a subaction boundary: reject the slice; never invent
   exclusive ownership or subtract inclusive times (Task 1).
3. Counter names coincide across unit/scope: subtract only the exact tuple;
   reject a decrease/reset, preserve zero and absence distinctly (Task 1).
4. Explicit [] or a nonwinning error changes under probes: independent result,
   full-universe error and revision checks must fail parity (Task 2).
5. Repeated process RSS and unknown WASM bytes: no zero substitution or summing
   across actions, and retained cycles remain unchanged (Task 2/3).

## Task 1: Bound a child probe slice without altering the parent

**Files:** Create `scripts/pivot-qualification/profile-slice.mjs` and
`scripts/pivot-qualification/profile-slice.node.mjs`.

**Interfaces:** Consume validated `validateProbe` snapshots (inclusive accounting,
ordered events with IDs/parent IDs, counters keyed by name/unit/scope). Export
`sliceProbe(before, after)` returning the same existing probe shape. No public
application interface. Reject invalid prefixes, duplicate event IDs, changed
completed events, counter decreases and child parents outside the slice.

- [ ] Write tests `slice preserves event IDs and parent`, `cross-boundary parent
  is rejected`, `counter tuple collision stays separate`, `counter reset is
  rejected`, and `empty delta remains empty`. Use literal report-only snapshots:
  before has event 0 [0,2] and counter (aggregate-evaluations,calls,aggregate)=2; after appends
  event 1 [3,8], child 2 [4,6] parent 1, increments that counter to 5 and adds
  (aggregate-evaluations,calls,facets)=4. Expected slice retains IDs 1/2 and deltas 3/4; original
  snapshots remain deeply equal. A new child parent 0 must throw. Counter 1
  after previous 2 must throw. Inclusive 5ms/2ms must remain separate, no total.
- [ ] Run `node --test scripts/pivot-qualification/profile-slice.node.mjs`;
  confirm failure because sliceProbe is missing (then confirm assertions after
  implementation), not because fixtures violate unrelated validation.
- [ ] Implement `sliceProbe` by validating both snapshots, requiring an unchanged
  completed-event prefix, slicing new events and differencing exact counter
  tuples. Validate the returned probe. No stage-duration subtraction or timers.
- [ ] Run the new tests and `node --test scripts/pivot-qualification/profile.node.mjs`;
  require all executed tests to pass; disclose optional artifact skips.
- [ ] Commit only helper/tests: `test(perf): bound revision probe slices`.

## Task 2: Attach child attribution to the existing trace

**Files:** Modify `scripts/pivot-qualification/performance-trace.ts` and
`scripts/pivot-qualification/performance.node.mjs`. Modify
`scripts/pivot-qualification/run-schema.json` only if optional `ms`/`probe`
validation needs tightening; do not change schema version or production protocol.
Add `profile-slice.mjs` to `scripts/pivot-qualification/benchmark.mjs`'s runner
source-identity file list so changed helper bytes invalidate comparisons.

**Interfaces:** Consume `sliceProbe(before, after)`. Existing `TraceRecord` already
has optional `ms`/`probe`; add them to each existing explicit-empty/clear-reset
record. Subaction ms spans apply/read/check; existing timed stage boundaries,
outer action clock/probe, result checksums and retained rows remain unchanged.
Capture before/after cumulative probe snapshots only when instrumented, release
references after each child. Original outer snapshot retains all events/counters.

- [ ] Extend existing actual-handler synthetic control with test
  `empty clear children bind timing and probe to their own revisions`: five
  cycles yield ten child records, same session, strictly advancing revisions,
  nonnegative finite ms; explicit-empty results are independently empty; clears
  match the independent reference. Every child probe event belongs to its outer
  probe with identical ID/time/parent, child event sets are disjoint, and the
  outer probe remains unchanged. Clean children have ms but no probe.
- [ ] Add `failed clear retains successful empty`, using a test-local TableExecutor
  wrapper passed to performanceTrace, delegating to the real TS executor except
  for one rejected clear (no production debug seam): failure on clear must
  retain the preceding emitted empty record and original failure, emit no clear
  success, and mark attribution incomplete/unavailable. Add literal probe-slice
  boundary failure at the adapter and assert no invented successful attribution.
- [ ] Extend real clean/profile parity controls with independent nonwinning-row
  error/full-universe checks and exact source-order sum/temporal-tie fixtures;
  assert [] versus none before/after reset. Keep existing consumer hashes and
  schema validation. Assert five original retained rows per session, null WASM
  remains null, and process high-water is not attributed to a child action.
- [ ] Run focused tests with the existing verified artifact directories; confirm
  new child ms/probe assertions fail on the old adapter. Keep any existing
  engine failure explicit; do not repair production as part of this plan.
- [ ] Implement snapshots/timers at the two existing apply/read/check boundaries.
  Do not reset the probe between children. On accounting failure preserve raw
  parent evidence and report unavailable attribution rather than engine failure;
  use the existing coordinator failure handling to stop further collection.
- [ ] Run `node --test scripts/pivot-qualification/profile-slice.node.mjs
  scripts/pivot-qualification/performance.node.mjs
  scripts/pivot-qualification/rank-profile.node.mjs` with recorded artifact env,
  full lint and the runbook's strict worker/trace TypeScript check. Require
  clean/profile exact output/consumer parity and no omitted expected tests.
- [ ] Commit private adapter/tests/identity changes: `feat(perf): bind empty clear attribution to revisions`.

## Task 3: Matched collection and a decision without promotion

**Files:** Update `docs/testing/pivot-performance-runbook.md` and
`docs/testing/pivot-next-experiment.md`. Evidence/manifests live under a new
immutable external directory, never overwrite P3. Existing runner and
`rank-profile.mjs` consume existing v1 reports; no second run schema.

**Interfaces:** Consume Task 2's revision-bound records and current fixed P3
manifest/data/reference/action identities. Produce a checksummed inventory,
separate engine/action/batch assessments and an explicit hypothesis outcome.

- [ ] Review exact source/artifact/dependency checks, tests and current qualification
  gates before collection. Record unchanged baseline engine bytes. If clean and
  instrumented controls fail, stop without a performance claim.
- [ ] Freeze the new manifest and source identity using the existing runbook;
  run the same feasible certified/count/OHLCV cases sequentially, two independent
  batches of five alternating same-source clean baseline/candidate pairs, same
  cold/warm work. Preserve known ladder refusals as prior outcomes, not retries.
  Run matched attribution controls only after their clean trace completes.
- [ ] Audit checksum-bound reports/archives and exact result/model/consumer parity.
  Assert ten child records per session, event ownership coverage, scoped counter
  deltas and original enclosing metrics. Deduplicate RSS by process UUID, retain
  all unavailable polls, null memory and retained-cycle rows. Report additional
  snapshot/observer bytes and timing; never call them removed engine work.
- [ ] Report per-child/cycle medians and ranges separately for each batch/role;
  compare only exact work and uninstrumented artifacts. Keep original cumulative
  filterReselection, compute, acquisition, transfer, chartDelivery, responsiveness
  and all raw samples. Instrumented timings remain exploratory attribution.
  No arbitrary p95, threshold, cold/warm ratio, cross-engine ratio or benefit claim.
- [ ] Conclude whether empty versus clear stage ownership is now attributable
  and repeats, or evidence is inconclusive. Either result retains the production
  baseline. A later specific optimization needs a new design and approval, plus
  exact-revision full correctness and matched clean benefit; this task does not
  authorize one. Native/server and clean-base Rust gates remain blocking.
- [ ] Commit only reviewed runbook/findings: `docs(perf): report revision-bound reset attribution`.

## Self-review and handoff

Spec coverage: measured gap and unchanged work are Task 2; accounting/scopes are
Task 1; parity/memory/failure cases are Task 2; two-batch controls, all outcomes,
limits and pending gates are Task 3. All five review risks have named assertions.
The only new helper signature is defined once and consumed unchanged. No cache
lifecycle/protocol design is needed because neither is proposed. No execution,
collection, optimization or release approval is implied by this plan.
