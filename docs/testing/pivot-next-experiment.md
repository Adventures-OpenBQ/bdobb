# Pivot measured assessment and one proposed experiment

Status: **PROPOSED; retain baseline. No optimization selected, implemented, or production-ready.**
Measured source is `594151886b11d44564af923ae7abf6d48d19af04`, runner source SHA
`d3e26d29475d604be81c70dac3dea6589eb6523f43dfa25d40ea4bf8a1c20a62`.
The next experiment below is a provisional design for review, not authorization
to execute it. The approved P4 deliverable is the analysis tool and this proposal.

## Evidence and reproducibility

External evidence root: `/Volumes/Builds/openbq-benchmarks/p3-evidence`.

| Evidence ID | File | SHA256 |
|---|---|---|
| A | audit-59415188.json | e5483bbf35f54453462c5d0ef8de355685738fd2005278284b02d5c264ab5b7b |
| S | summary-59415188.json | ee19f16aab35812c55015713e2bfe75f57f7e566c3b7c3563baab9417ac479f4 |
| T | typescript-59415188/index.json | 9722d784854b41e8c139e7caa730df78dfd7107dbdd8a48fec6b7bc4b36b4d68 |
| R | rust-59415188/index.json | 8fc80e748e7b27a53c024deb31b6c58abf25546ffef2e7da0662008c8cb189bd |
| B | browser-59415188.json | 6a0f36f46e3989818dd64942a1e19c403caa677318559689ddbd72b94be52716 |

A was independently audited against 101 inventory hashes, 26 primary reports,
69 archives/process UUIDs and 176 successful sessions. The P3 final evidence
review accepted bounded advisory evidence only. S is a derived display, never a
replacement for primary samples. Every ranking evidence ID contains S's hash,
record index, primary report path/hash, observation index and (for actions)
trace index/session ID. Original failed, refused and deferred statuses remain.
The frozen observer-invalid `typescript-2be0c872` attempt is excluded.

```sh
node --test scripts/pivot-qualification/rank-profile.node.mjs
node scripts/pivot-qualification/rank-profile.mjs \
  /Volumes/Builds/openbq-benchmarks/p3-evidence/summary-59415188.json \
  ee19f16aab35812c55015713e2bfe75f57f7e566c3b7c3563baab9417ac479f4 \
  > /Volumes/Builds/openbq-benchmarks/p3-evidence/p4-assessments-59415188.json
```

The read-only adapter verifies S and every primary report checksum and semantic
contract, then emits 833 separate action/trace cohorts with 2,881 preserved
samples (these are NOT 2,881 independent processes). `rankProfiles(records)`
returns assessments binding engine, workload, full action, trace position,
temperature, mode, batch, variant, identity/limits, contributions, scoped
counters, uncertainty, memory, candidate and fallback. Same cohort keys with
different work identities are rejected. Different actions/engines/temperatures
never share a rank. Inclusive envelopes are sorted by their own duration,
never summed/subtracted; measured exclusive intervals are accepted only when
disjoint. Failed partial timings remain raw but do not enter successful ranks.
No percentile, speedup, exclusive reducer cost or automatic winner is emitted.

## What the measurements rank

There are 120 clean TS observations: three cases, two independent batches,
five alternating baseline/candidate pairs per batch, cold and warm per child.
Both roles run the SAME SOURCE. Cold and warm perform DIFFERENT WORK; their
ratio is not a speedup. All twelve batch/case/role sample arrays remain in S.
The table shows representative batch 1 baseline medians, n=5, milliseconds;
it does not pool batches, roles or temperatures. Whole-trace stages count
different numbers of operations and are workload burdens, not per-operation
comparisons or percentages of an exclusive whole.

| TS case and trace | Recorded envelope ranking (ms) |
|---|---|
| Certified 98 facts / 110 cells, cold | compute 83.26; registration 2.84; transfer 2.60; parse 2.13 |
| Certified, warm | filterReselection 470.38; compute 52.09; transfer 19.73; chartDelivery 1.57 |
| 60k count, cold | compute 1448.35; registration 245.43; parse 90.87; transfer 15.75 |
| 60k count, warm | filterReselection 14880.25; compute 8497.08; transfer 153.93; chartDelivery 12.53 |
| 60k OHLCV, cold | compute 1595.31; registration 236.11; parse 80.41; transfer 18.82 |
| 60k OHLCV, warm | filterReselection 15475.08; compute 8603.32; transfer 171.91; chartDelivery 14.20 |

`filterReselection` accumulates ten applyModel calls per session: five explicit
empty/clear cycles. Certified covers six company sessions. `compute` sums the
other apply/sort calls. Node transfer/chartDelivery envelopes do not measure
browser rendering or usable view; those remain null. Large reset burden does
not establish an expensive individual reset, nor a cache opportunity.

For action-level orientation, these are separate batch 1 baseline clean warm
action medians, n=5 (apply + read + independent check, not engine-exclusive):

| Action / trace position | 60k count ms | 60k OHLCV ms |
|---|---:|---:|
| 1m Q / 0 | 1338.77 | 1317.93 |
| 1s Q / 1 | 1468.50 | 1555.72 |
| 1s 24EQ / 2 | 1120.98 | 1089.83 |
| Return 1s Q / 3 | 1504.12 | 1587.13 |
| Identical 1s Q / 4 | 1466.63 | 1581.74 |
| Descending sort / 5 | 1420.39 | 1616.15 |
| Linked reads / 6 | 68.18 | 80.75 |

The columns are different workloads, not a count-to-OHLCV speed ratio. The
complete per-action assessments preserve all six certified company positions,
every cycle, both roles/batches and all missing timings. Explicit-empty and
clear-reset child records have revisions/results but **no individual ms/probe**;
the enclosing empty-clear action has the ten-calculation probe and total time.
Its event order suggests repeated calculations, but IDs do not explicitly bind
each calculation/counter delta to a child revision. That is the selected gap.

### Instrumented TS attribution: exploratory, not clean timing

Three cases passed action/model/result/consumer parity; one pair per case is
exploratory. Example baseline cold 60k OHLCV, trace 0:

| Inclusive event | ms | Recorded parent |
|---|---:|---|
| calculate-view | 1464.427 | none |
| calculate-table | 1337.647 | calculate-view |
| source-evaluation | 354.599 | calculate-table |
| category-preparation | 277.150 | source-evaluation |
| qualification | 89.687 | calculate-table |
| facets (three separate events) | 32.467 / 25.189 / 35.629 | calculate-table |
| compile | 0.552 | calculate-table |

Never add these envelopes or subtract them to invent unnamed exclusive work.
The same action records 60,000 source-input rows (`source-evaluation`), 2,566
aggregate calls (`aggregate`), 15,396 vectors and 15,396 sorts
(`scoped-source-rows`). Count has 2,566 vectors/sorts. Repeated work is plausible,
but counters are not durations and do not demonstrate material reducer/order
cost. Warm OHLCV 1m Q has 278 aggregate calls / 1,668 vectors/sorts; 1s 24EQ has
88 / 528; returning Q has 2,566 / 15,396. These distinct scopes cannot be pooled.
Qualification repeats, but no exclusive request-local facet cost is isolated.
Warm category preparation is visible, not shown to dominate the whole trace.

### Rust and excluded shapes

Rust has **no timing ranking**: three actual registration refusals (certified
and both 60k cases), reason `Input transient state budget exceeded`, plus seven
preflight refusals. Later batches and attribution were not attempted. Paired
preflight labels and deferred references are not additional child attempts.
TS also preflight-refused seven larger cases: 300k count/OHLCV and SEC 100k on
conservative 128×file reservation; SEC 1m/full and full-day ticks on row limit.
These outcomes do not measure 2 GiB use, engine incapacity, or Rust speed. No
TS/WASM compute comparison exists. Bulk SEC is stress, not certified Statements.

### Memory and platform uncertainty

Max clean child high-water RSS: count 3.554 GiB, OHLCV 3.443 GiB; max sampled
unique-PID tree: 3.504 / 3.443 GiB. These describe whole cold+warm children and
must not be summed together or across action records. The tool groups memory
observations by process ID within each assessment; cross-assessment consumers
must also deduplicate process IDs. Unknown WASM/retained-state bytes stay null.
TS preflight is not runtime engine-state enforcement. Current RSS reset-cycle
0→4 deltas vary, including negative values; no forced GC/steady plateau exists.
Leak, cache ownership, and safe added retained-memory budget are unknown.

Observer spool/publication costs are separately recorded, not engine work.
B covers nine passing actions each for 60k count/OHLCV in an actual dedicated TS
Worker, one exploratory headless Chromium/Vite development observation. It does
not qualify browser performance, UI rendering, Rust browser or native behavior.
Node setImmediate responsiveness is not browser input latency.

## Decision and approaches considered

1. **Retain baseline; attribute existing warm empty/clear cycles. Recommended
   provisional choice.** It targets the largest recorded warm burden and fills
   a concrete revision-to-cost gap without retaining engine state.
2. Reducer/scoped-order reuse: not selected. Counts are suggestive but exclusive
   costs and order-preserving benefit are unmeasured; original-order sum and
   stable temporal ties must survive any later design.
3. Preparation/facet caching: not selected. Current envelopes do not justify
   dominance or a safe retained-state budget. PR #21 `385321cc5bc4069e61820eccb5f7e1abbb9fe947`
   was inspected: its request-local period-boundary map caps admission at 256
   keys and returns fresh metadata copies. It is NOT an ancestor of this measured
   source. Duplicating it is not a new experiment. The prior sparse-map prototype
   failed mutable empty-shape behavior; it must not be resurrected by assumption.

A future cache proposal would need separately approved dependency identity,
invalidation, admission/accounting, eviction/disposal and retained ceiling.
No cache or new protocol is proposed here.

## Exactly one proposed experiment: revision-bound empty/clear attribution

**Hypothesis:** the observed warm reset burden can be localized to explicit-empty
versus clear-reset operations and their inclusive calculation stages, consistently
across the current eligible cases, without changing results or engine work. The
outcome may be inconclusive; that means retain baseline, not force a patch.

**Eligible shapes:** unchanged real certified 98/110 and 60k count/OHLCV, exact
P3 data/model/reference/action identities and five reset cycles. Preserve all ten
ladder outcomes; do not retry known refusals or substitute smaller cases. Rust
remains unavailable on this profile. No broadening to bulk/full-day claims.

**Design:** in private `performance-trace.ts`, attach optional `ms` and a probe
slice to each existing explicit-empty/clear-reset record, bounded by the same
operation's start/end. Subaction `ms` covers apply/read/check, as existing apply
action time does; existing stage totals retain their narrower definitions.
Read cumulative probe snapshots at boundaries without resetting the enclosing
empty-clear probe. Slice newly completed events, retain IDs/parents, and subtract
only cumulative counters with identical name/unit/scope keys (never times).
Require every emitted child event to have a parent in that slice or no parent;
reject cross-boundary/open events rather than inventing ownership. Keep the
original enclosing probe, action time, stages, checks, retained samples and
outcomes. Child and parent timings overlap and are never added.

**Proposed files:** private `performance-trace.ts`, new
`profile-slice.mjs` / `profile-slice.node.mjs`, existing `performance.node.mjs`,
`run-schema.json` only if existing optional trace fields need stricter validation,
`benchmark.mjs` runner source-identity list, and the runbook/findings. No production source or worker protocol change.

**Removed work:** none. This is an attribution experiment, not an optimization.
**Retention/invalidation:** snapshots live only for the current action; disposal
at action completion/failure. No cross-request cache, dependency reuse or new
engine state. New probe slices increase observer bytes; record that overhead.
A changed source/artifact/data/model/actions/environment invalidates comparison.
**Failure/fallback:** keep partial completed records and original failure/refusal;
mark attribution unavailable on malformed boundaries, never relabel as engine
failure/success. No retries of refused work. If correctness or accounting fails,
reject the experiment and keep the baseline plus unmodified archived evidence.

**Correctness:** prove exact explicit [] versus none/Clear behavior, five cycles,
revision/session identity and clean/profile consumer parity. Keep source-order
sums, stable temporal ties, nonwinning-row errors and full-universe requalification
with original reference checks; do not optimize away the empty computation.
Tests must cover failed second half preserving the first half, overlapping parent
probe, counter scope collision and unknown retained memory. The concrete
[proposed plan](../superpowers/plans/2026-11-03-pivot-empty-clear-attribution.md)
specifies test-first steps and the five risk cases.

**Acceptance:** no benefit target is invented. First require exact outputs and
complete nonoverlapping child-event ownership within the enclosing probe; then
report whether the attribution repeats across cases/cycles. After separate
approval, use the existing runner, pinned sources, production-equivalent clean
artifacts and matched uninstrumented two-batch/five alternating-pair observations
for feasible cases. Preserve all samples, both calibration roles, original stage
and action metrics, RSS/retained/observer data and refusals. Pair any instrumented
attribution with clean parity controls; never put its timings in clean summaries.
Report medians/ranges per action/batch and observer overhead, no arbitrary p95 or
manufactured gain. If variability/overhead prevents interpretation, record that
and retain baseline. Limits stay 300k rows, 256 MiB input, 2 GiB state, 10k columns,
32 MiB batch, 64 MiB cache, two transfers, 60s work and default Node heap.

## Integration and qualification gates

Read actual TEST final-review/final-fix/task-6 reports in
`/Volumes/Builds/openbq-benchmarks/pivot-test-program-work/.superpowers/sdd/2026-11-03-pivot-test-program`:
integrated Rust candidate evidence includes 6,709 unit passes / 7 skips, 219
extended, 16 linked-browser and 20 persistence-browser passes. Those passes
cannot transfer to clean release/v4 or the next exact revision.

Read delivery-checks, packaging-review and collector-backport-review under
`/Volumes/Builds/openbq-benchmarks/pivot-delivery-verification`. Draft
[PR #27](https://github.com/Adventures-OpenBQ/bdobb/pull/27) targets clean release/v4,
excludes Rust production, and depends on unmerged #25/prerequisites. The controller
context snapshot `current-qualification-gates.json` identifies head
`a98d77d19dd94ad725ab08f8e3cdd6a6f77259d9`, completed run 41764477359:
pivot/reference/scrub passed; build failed fixed parity; e2e failed Rust linked
empty selection. Current 53 Node contracts/lint/typecheck/fresh build/smoke pass;
known clean-base parity is 34 pass / four selection failures. This snapshot is
context, NOT an automated per-requirement release attestation.

Native worker recovery, successful import/export, exact revision-chain evidence,
remaining device/input acceptance and actual server sync remain missing. Partial
native restart/visible-value propagation is not full qualification. **Promotion
is blocked and release qualification INCOMPLETE.** A profiling recommendation
neither resolves those failures nor authorizes integration. Any eventual engine
patch requires exact-revision full correctness, browser/native/device gates and
repeatable matched clean benefit before promotion. No merge/push is part of P4.
