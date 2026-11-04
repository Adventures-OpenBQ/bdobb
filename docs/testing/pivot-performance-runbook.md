# Advisory matched performance collection

This private adapter extends the qualification runner and its v1 reports. It does
not qualify native release or choose an optimization. Run one matrix at a time;
record unrelated background load and do not interrupt other users' work.

Use default Node heap, no NODE_OPTIONS, and the fixed Task7 experimental limits.
The Rust production handler remains the admission boundary. TS preflight is not
matching runtime enforcement. A 2 GiB state policy is not measured 2 GiB usage.

## Delivery and historical evidence

This profiling-only delivery targets `release/v4` and depends on qualification
[PR #27](https://github.com/Adventures-OpenBQ/bdobb/pull/27) at `a98d77d` and
[PR #25](https://github.com/Adventures-OpenBQ/bdobb/pull/25) with its prerequisites
or reviewed merged equivalents. The original profiling checkout includes an
unmerged Rust stack; that ancestry is excluded from this delivery. Private hook
patches retain their original exact source applicability and may reject this
clean delivery source. Do not weaken those checks or treat historical instrumented
artifacts as newly qualified delivery artifacts.

Existing measurements identify their original source and immutable external
evidence. They are historical advisory observations, not results for this delivery
revision. No production optimization or speedup is claimed. The proposed
empty/Clear attribution experiment remains unexecuted and requires separate scope
approval. Release qualification remains incomplete.

## External manifest

Keep data, references, artifacts, journals and reports outside Git. Each workload
is the existing Task7 manifest with `reference.independent: true` and an actions
file `{ "version": "performance-trace/1", "actions": [...] }`. Obtain the exact
array from `performanceActions(kind)` in `run-performance-matrix.mjs`; unknown or
omitted actions reject. Tick model is `tickModel({granularity:'1s',venue:'Q',
countOnly:false})` (or countOnly true). Bind original raw-trade reference bytes
and explicit `tick-bucket-index/1` policy; never infer minute conversion from
engine output. The model file and every transition model/action are pinned.
Certified Statements use independent Decimal expected values; bulk references
are structural only and cannot certify financial aggregates.

The matrix JSON contains:

```json
{
  "version": 1,
  "batches": 2,
  "samples": 5,
  "sampleIntervalMs": 250,
  "backgroundWork": "Describe known unrelated work and machine conditions",
  "cases": [{ "path": "workload.json", "sha256": "64 hex characters" }],
  "cleanArtifact": { "path": "clean/identity.json", "sha256": "64 hex characters" },
  "profileArtifact": { "path": "profile/identity.json", "sha256": "64 hex characters" }
}
```

Paths resolve relative to the external matrix. Artifact entries are optional;
omitting both uses the current clean checkout artifact. Private artifact use
verifies current production source bytes against the isolated source tree,
pinned transformations/probe, toolchain and all emitted artifact hashes before
building the actual handler bundle. No direct calculateView adapter is used.
Supplemental profile reports are attribution only; clean timings remain primary.

```sh
node scripts/pivot-qualification/run-performance-matrix.mjs \
  --manifest /external/matrix.json --engine typescript --output /external/new-ts-run
node scripts/pivot-qualification/run-performance-matrix.mjs \
  --manifest /external/matrix.json --engine rust --output /external/new-rust-run
```

The output directory must be new. `index.json` references checksum-bound v1
qualification reports. Each feasible batch records five fresh-process baseline
and candidate observations (same-source calibration), each with cold first apply
and remaining warm actions in the same executor/session. Two batches are separate
invocations of fresh subprocesses. No speed comparison between unequal work.
Failure/refusal/timeout stops the case; later batches and attribution are explicitly
not-run. Do not keep retrying or substitute 15k for planned 60k/300k/full-day work.

Tick traces apply second → minute → second, exact Q → 24EQ → Q, identical apply,
descending sort, table/chart/selection/facets/inspection/export/error reads, and
five empty/Clear cycles. Every returned bar is independently checked. Explicit
empty selection is zero rows; Clear restores all eligible rows. Actions carry
session IDs and input/model/output revisions; completed action records are queued in order to an asynchronous local spool.
They are accepted only after durable flush and checked archive publication. Warm failures do not erase earlier
journaled work. Stage envelopes overlap and must not be added as exclusive costs.

## Interpreting measurements

Report medians, min/max and all samples; fewer than five observations are
exploratory. Profile artifacts cannot supply speedup claims. Before attribution,
compare the same action/model/result and consumer checksums against clean runs.
Private stage/counter identities come from P2's pinned probes; scopes/reducers and
projection overlap, and cache hits/misses/evictions remain unavailable.

Child `memory.peakRssBytes` is resourceUsage high-water RSS. `process.samples`
contains ps per-PID RSS and its unique descendant-PID sum, with elapsed and
collection time. `sampledTreePeakBytes` is the maximum sampled sum. Never add it
to high-water RSS, or sum duplicated cold/warm copies of the same process record.
Threads are not separately summed. ps runs in the coordinator, outside the child
tree; its wall duration is disclosed, but scheduling interference remains possible.
Sampling can miss brief peaks. Retained RSS/heap/WASM values after each reset are
post-warm-up observations without forced GC, not proof of a leak or cache size.

Responsiveness is Node setImmediate callback latency scheduled before each action,
not browser input latency. Browser touched-interaction verification must separately
exercise the same transitions/reads in actual browser workers and record environment,
source/artifacts and outcomes. Node/native/browser conclusions remain separate;
without browser evidence, rendering and usable-view conclusions are not-run.

## Validation

```sh
node --test scripts/pivot-qualification/*.node.mjs
PIVOT_PROFILE_CLEAN_DIR=/external/clean PIVOT_PROFILE_DIR=/external/profile \
  node --test scripts/pivot-qualification/performance.node.mjs
```

The real-handler control checks fresh processes, same warm session, transitions,
revision growth, independent oracle corruption, invalid action rejection, private
artifact refusal and clean/profile consumer parity. Preserve complete external
outputs and SHA256 checksums along with commands and limitations in the task report.

Action wall-time envelopes and Node callback latency include independent correctness
checks and consumer validation. Use the separately measured compute/transfer stages
for their stated scopes; do not interpret total action latency as pure engine cost.
Statement table ancestor headers may differ from flattened exports; only actual
group headers are accepted without an exported counterpart. Exported, chart and
presented certified cells are independently validated; clean/profile table/consumer
checksums provide the additional parity control.

A later failed clean batch invalidates earlier success for attribution. Parity
rejection is saved as a failed, unaccepted index record with both immutable report
references before an error is surfaced; a numerical qualification pass alone does
not mean attribution was accepted. A ps snapshot without the root PID is explicitly
unavailable with a reason and null RSS. The sampled peak stays null until a valid
root-containing snapshot exists.

The private source tree must have exactly the checkout's source filenames and
verified expected bytes. Bare package imports from copied sources resolve from the
checkout, so an unexpected private or ancestor node_modules cannot replace them.
The verified boundary is source/lock/toolchain identity plus the actual emitted
bundle/probe/glue/WASM hashes. This does not certify a hermetic or independently
attested installation of every package in the checkout's dependency tree.


The collector keeps work and observation completion separate. The child work
limit remains 60 seconds; terminal done/exit disarms the work timeout. Any lingering
post-done process is bounded within the original deadline and reported separately.
Journal write/sync operations use the OS temporary spool asynchronously, preserving
all completed observations even when later work fails. The spool is retained and
its location recorded for recovery. Publication reserves a new external path,
flushes locally, verifies the expected journal hash, writes/syncs externally, and
checks the archived bytes. No output is accepted before these steps succeed.

Observer metadata records expected/spool/archive SHA256, storage paths, queue bytes,
write/flush/archive time, sampler polls/skips and errors. Publication taking longer
than the configured work-budget duration is observer-incomplete, not a work timeout.
A failed archive leaves the recoverable spool and completed observations intact.
Observer-incomplete stops later observations/batches/attribution until investigated.
The ps sampler allows one in-flight command (2-second bound), skips overlapping
polls, and cancels at terminal work. Late/cancelled samples stay unavailable;
no valid root snapshot is reported as incomplete sampling, never zero RSS.
