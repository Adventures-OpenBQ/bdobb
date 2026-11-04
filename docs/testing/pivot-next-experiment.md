# Pivot measured assessment and one proposed experiment

Status: **Bounded attribution completed; retain baseline. No optimization selected, implemented, or production-ready.**
Measured source is `594151886b11d44564af923ae7abf6d48d19af04`, runner source SHA
`d3e26d29475d604be81c70dac3dea6589eb6523f43dfa25d40ea4bf8a1c20a62`.
The P3/P4 assessment below is historical. The attribution experiment was later
separately approved; its revision-bound Task 3 outcome is recorded at the end.
That approval authorizes attribution only, not a production optimization.

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

## Current qualification context (2026-11-04)

The older gate snapshot above remains historical and must not be read as the
current CI result. Retained `pivot-delivery-verification/ci-after-merged25.json`
records all five checks green after #25 merged: PR #27 at
`e946f9deda14c9c9ef3cb59089d4f5df25b54407`, run 41781308021; PR #28 at
`6d1bf8a126ef91ff79f9425374aad8aa9862ed4f`, run 41781316014. These are recorded
receipts for those exact commits, not newly queried status or qualification of
Task 3's `0bab8495` runner/artifacts. The historical clean-base Rust failures
are not transferred forward as current failures; exact-revision Rust correctness
remains a required gate for any eventual engine patch.

`native-current-execution.md` and `native-current-review.md` accept partial native
qualification of `e946f9d` only. Scoped restart/value propagation, selected
keyboard actions, failure diagnostics and restoration passed. Actual native UI
CSV import/drop, complete in-app Statement/Inspect repair navigation, native
archive roundtrip, worker failure/recovery/termination and stale delivery fencing,
exact source/child/delivered revision chain, measured narrow viewport, touch and
other native OS/device coverage remain unqualified. Real-server sync remains
blocked by the absent authorized disposable fixture. Copied fixture acquisition
is not UI import, and external restoration is not successful in-app repair.

**Overall release qualification remains BLOCKED.** Native/server gaps, exact
revision correctness and matched clean benefit must be closed for a separately
approved optimization. No current or historical CI/native receipt transfers to
the attribution experiment as full release acceptance.

## Task 3 outcome: ownership attributed; baseline retained

Approved collection completed at `0bab849583b5ebf070ee398eec7dcfc6f63cccdc` in
`/Volumes/Builds/openbq-benchmarks/empty-clear-evidence-0bab8495`. Both clean
batches passed all five alternating baseline/candidate pairs for all three cases.
All three subsequent exploratory profile pairs passed exact action/model/result
and consumer parity. Fresh controls passed 35/35 with no skips. No collection
failure, retry, refused-case attempt, engine change or optimization occurred.

The audit checks nine checksum-bound v1 reports, 66 distinct processes and 66
complete journal publications; 132 cold/warm observations carry 176 warm sessions,
1,760 timed reset children and 880 retained-cycle rows. Each certified process has
six separate company sessions; ticks have one. All 1,680 instrumented child events
exactly cover their enclosing probes without duplicate ownership, changed IDs,
timestamps or parents. Name/unit/scope counter deltas cover each original parent.
Eight unavailable polls remain unavailable with null RSS; no missing value is zero.

**Hypothesis outcome:** empty versus clear stage ownership is attributable in the
observed controls and repeats across all five cycles and both profile roles for
each of eight separate case/company groups. Each child has 11 inclusive events
for certified Statements or nine for ticks. Event structure (comparing parent
positions, while retaining original IDs) and scoped counter values repeat. Both
empty and Clear still evaluate the source: count and OHLCV each record 60,000
source-input rows and 2,566 aggregate calls per child; scoped vectors/sorts are
2,566 for count and 15,396 for OHLCV. These counts are not exclusive durations.

The clean child distributions below are cycle 0 only, milliseconds median
[min, max], n=5 per separate batch/role. Certified rows show NVDA only. The full
480 child cohorts, every company and cycle, all samples and original action/stage/
responsiveness envelopes are retained in `child-medians.md`,
`child-stage-statistics.json`, `assessments.json` and the primary reports.

| Case | Batch | Role | Explicit empty ms | Clear ms |
|---|---:|---|---|---|
| certified-98-110 | 1 | baseline | 12.15 [11.74, 13.27] | 12.45 [12.34, 12.95] |
| certified-98-110 | 1 | candidate | 12.30 [11.94, 12.76] | 12.63 [12.16, 13.25] |
| 60k count | 1 | baseline | 1405.17 [1355.74, 1459.96] | 1421.84 [1386.70, 1435.01] |
| 60k count | 1 | candidate | 1428.23 [1288.52, 1450.70] | 1412.81 [1351.95, 1551.53] |
| 60k ohlcv | 1 | baseline | 1573.29 [1523.25, 1625.11] | 1632.42 [1603.09, 1667.02] |
| 60k ohlcv | 1 | candidate | 1565.84 [1537.99, 1695.08] | 1726.14 [1652.68, 1762.70] |
| certified-98-110 | 2 | baseline | 12.69 [12.25, 14.10] | 13.61 [12.43, 14.63] |
| certified-98-110 | 2 | candidate | 12.76 [12.46, 12.99] | 12.72 [12.16, 13.20] |
| 60k count | 2 | baseline | 1485.78 [1364.92, 3092.02] | 1595.32 [1385.16, 2330.06] |
| 60k count | 2 | candidate | 1948.87 [1362.08, 2071.44] | 1888.25 [1403.87, 2257.56] |
| 60k ohlcv | 2 | baseline | 2167.77 [1537.46, 2704.50] | 2312.03 [1590.30, 2433.35] |
| 60k ohlcv | 2 | candidate | 2032.08 [1796.53, 2402.08] | 2335.04 [2102.71, 2858.90] |

Batch 2 tick timings vary substantially and differ from batch 1; neither batch
is pooled away. These observations do not establish a repeatable timing-based choice of empty
versus Clear as an optimization target. Ownership repetition is supported; stable instrumental
duration across independent batches was not tested because attribution has only
one exploratory pair per case. Keep the baseline. No removed work, speedup,
exclusive reducer/facet cost, cache benefit or Rust/TS ratio is established.

Each instrumented session adds 20 boundary snapshots: 320 total in these controls.
The derived serialized-size estimate across those cumulative snapshots is
1,593,053 bytes, not a live allocation or retained-memory measurement. Added child
ms/probe fields account for approximately 166,118–166,928 serialized journal bytes
per certified profile process, 25,174–25,176 for count, and 25,204–25,246 for OHLCV.
These fields occur in both durable phase and observation records. Snapshot clone/
slice CPU time is not independently timed and remains unavailable. Original outer
timing includes that work; do not subtract overlapping envelopes to invent it.

Profile archive publication durations were 1206.81/1245.04 ms (certified,
baseline/candidate), 104.08/1102.78 ms (count), and 490.97/2812.13 ms (OHLCV).
`observer-memory-statistics.json` retains every clean/profile batch/role's archive
bytes, write/flush/archive timing, sampler overhead and memory samples;
`audit.json` retains raw observer metadata and unavailable polls. Observer time is
not engine time and cannot be isolated causally by comparing these samples.

Deduplicated maximum clean process high-water RSS was 183,058,432 bytes certified,
3,162,963,968 count and 3,707,125,760 OHLCV. Separate sampled unique-PID tree maxima
were 182,829,056 / 3,152,805,888 / 3,707,125,760 bytes. These are whole-process
metrics, never summed with each other or attributed to a child. Unknown WASM and
retained-state size remain null; retained rows have no forced GC or plateau claim.

The existing `rank-profile.mjs` consumed a checksum-bound derived summary and
validated all primary v1 reports, yielding 768 separate assessments with 2,816
preserved samples, not independent processes. The immutable inventory and task
report bind the detailed files. A later optimization still needs a new design,
approval, exact-revision correctness and matched clean benefit; the native/server
and other qualification gates above remain blocking.

Task 3's frozen `inventory.json` SHA256 is
`95a486c8f40851b86c7ef7188e70b120a925d5c7189f82aa5f3cc6850dfe0f34`;
it binds 136 evidence files. `audit.json` passed all report/archive, ownership,
parity and memory checks; the existing ranking adapter validated all nine v1
reports. Final source/input/artifact checks passed after collection. The evidence
files are read-only; future analysis or collection must use new output paths.
