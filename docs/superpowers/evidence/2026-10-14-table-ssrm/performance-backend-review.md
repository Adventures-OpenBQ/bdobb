# SSRM backend performance review

Scope: read-only inspection of `/private/tmp/bdobb-table-ssrm-discovery`, HEAD `e6bd7eba44a83b971bcbf313ef0913c8c101b651`, focused on table-service, native worker IPC, native ordering. No product files edited. Evidence README/qualification JSON read. Their 1,205×4 and 2,005×8 observations are local debug runtime qualification, not release performance; million-row capacity and assembled image remain unqualified. This review preserves semantic parity, authentication, cancellation, snapshot pinning and bounded memory.

## Recommended order

1. Make the owned wire decoder consume large JSON fields; this is a measured allocation reduction candidate and applies both to ingestion and every worker registration.
2. Decode commands once within the service, carrying the validated command through queueing. Large Statement definitions currently traverse service decoding three times before worker decoding.
3. Remove per-comparison string copies in NativeOrder using borrowed primitive strings; measured exactly two allocations per ordinary text comparison.
4. Investigate fresh-worker/full-input registration costs on each apply as a larger architectural change. Registration dominates the successful simple raw-table microprobe, but immutable published workers and pinned exports must remain isolated.
5. Address scheduling and catalog contention if concurrent-user measurements show them material. Code establishes the contention; no concurrent latency measurement was run.

## 1. Owned wire payload is cloned immediately before typed deserialization

**Evidence:** `crates/pivot-wire/src/lib.rs:19–25` (`get`), `:58–63` (`into_core_request` borrows the owned request), `:121–124` (registerInput uses get(input)). The same pattern also clones definitions via `:32–34`. `crates/table-service/src/ingest.rs:192–196` invokes this decoder on the Node parser result; `crates/pivot-native-worker/src/worker.rs:68–75` invokes it again for full input registration. `sessions.rs:587–595` encodes the resulting dataset into retained JSON; `:567–568` copies that JSON into the registration envelope for each native candidate.

The full registerInput path is JSON bytes → generic Value tree → deep-cloned input Value tree → typed SourceDataset. The original Value tree stays live while the cloned tree is consumed into typed strings/containers. This adds Θ(number of input JSON nodes + string bytes) allocations/copying, not just one outer Vec copy. It happens on every apply's registration even without a source refresh. Wide cached tables and expanded linked inputs make it expensive; Statement tables also pay before compilation.

**Concrete optimization:** change the decoder to take ownership of request object fields (`remove`/`take`, with complete field and operation validation preserved), or a typed tagged request enum. Preserve unknown-field rejection, protocol/version/session checks, typed WireValue validation, input revision validation and the worker trust boundary. The simple ownership change can improve the current architecture without reusing any worker or trusting parser bytes blindly.

**Probe:** identical generated raw source rows with unique IDs, four columns, registration envelope decoded by current `decode_request`; comparison variant parses the same envelope, takes its `input` Value and deserializes it directly to SourceDataset.

| Rows | Wire bytes | Current allocation/reallocation calls | Take-input calls | Current cumulative allocated bytes | Take-input bytes |
|---|---:|---:|---:|---:|---:|
| 2,000 | 363,462 | 122,130 | 66,074 | 18,330,810 | 10,479,827 |
| 10,000 | 1,819,462 | 610,134 | 330,078 | 93,785,994 | 54,551,011 |
| 20,000 | 3,649,462 | 1,220,136 | 660,080 | 188,628,810 | 110,153,827 |

For 20k rows this illustrates ~46% fewer allocation events and ~42% less cumulative allocation traffic in this decoder comparison. **Not a production implementation/benchmark:** the comparison variant omits envelope field/revision validation and CoreRequest construction; those are small relative to the dataset but prevent claiming this percentage as a validated production improvement. The cost attribution is supported independently by the actual deep clone. Cumulative allocation is not retained bytes, peak bytes or RSS. Allocation counting adds atomic overhead, so decode wall times are not a clean release CPU benchmark. Current/variant single measured decode times were 47.591/42.791ms at2k,273.187/232.293ms at10k,564.423/423.749ms at20k.

**Validation needed:** malformed/unknown field, tagged values, duplicate fields, nullable optional fields, incorrect revision, oversized input, same typed outputs/error behavior across native/Wasm; before/after release allocation and RSS measurement on narrow/wide inputs, including nested values and Statement data.

## 2. One HTTP command is fully decoded three times within the service

**Actual path:** `sessions.rs:704` (`execute_command → decode_command`), `:735` (`run_session`), `:390` (`run_session → decode_command`), `:736` (`command`), `:751–759` (`command` decodes again). `decode_command` at `:1470–1487` fully calls `into_core_request`, not a tiny envelope-header read. `pivot-wire/src/lib.rs:32–34,67,131–132` clones and validates the full definition. The worker then independently decodes/validates at `worker.rs:68–75`, which is an appropriate process boundary.

**Trigger/effect:** each routine apply, large Statement template, large runtime parameters/provenAbsentIds, definition preview/domain request. Three service definition validations instead of one are Θ(3D) traversal/copying for D model size; two occur before compute-worker admission. Basic short row commands have much less to gain. This is code-derived, not timed.

**Concrete optimization:** introduce a validated-command object containing original wire and CoreRequest and pass it through execute_command/run_session/command; reuse request ID for pending cancellation registration. Retain early control routing and structural validation before job admission, ownership/revision checks at execution/publication, and independent worker validation. Do not replace necessary worker checks with a service-trusted flag.

**Validation needed:** same typed errors and admission behavior for invalid requests, cancel/dispose bypass compute saturation, request-drop fencing, pending cancellation registration, stale revisions, failed/superseded models; benchmark realistic large Statement definitions and many row requests with parse/validation counters.

## 3. Native text comparison allocates two fresh strings for every comparison

**Evidence:** `crates/pivot-native/src/ordering.rs:100–112`, specifically `string_value(a)` and `string_value(b)` at `:112`; `crates/pivot-core/src/ordering.rs:103` clones String/BigIntString in `value_string`; `:142–144` returns owned String. Native `sort_permutation` at `ordering.rs:127–140` invokes this comparator from TimSort.

**Effect:** for ordinary text values each comparison allocates/copies both texts, yielding Θ(comparison count × compared text length) copy traffic and 2×comparison-count allocation events. Random total-order text sorting typically has O(N log N) comparisons; TimSort runs can reduce that. Mixed numeric/text behavior and non-total comparator semantics prohibit blindly changing the sorting algorithm.

**Measured allocation probe:** 100,000 comparisons of `Revenue FY2025 Europe` with `Revenue FY2026 Asia` produced exactly200,000 allocations and4,000,000 cumulative allocated bytes;33.112ms in the instrumented debug-linked probe. This is comparator-only, not end-to-end sort performance. A second capture gave the same counts and32.016ms.

**Concrete optimization:** fast-path borrowed String/BigIntString (or a Cow-returning coercion helper), leaving all existing missing checks, numeric subtraction, ICU collation and recursive error behavior intact. Consider per-sort cached coercions only after that, because caching can change evaluation/error timing and add retained memory. Do not replace mixed-domain comparisons with lexicographic precomputed keys without proving parity.

**Validation needed:** existing ordering golden tests, NaN/infinity/-0, mixed numeric/text/boolean, empty/missing values, ICU numeric collation/accent/case/locales, arrays and records with `toString`; instrument before/after allocations and compare exact permutations, including non-total fixtures.

## 4. Every apply starts a fresh worker and re-registers unchanged full input

**Evidence:** `sessions.rs:944–949` retains the current input Arc; `:960–970` reacquires only on refresh, but `:973` always calls native. `native` at `:563–568` reserves a native result slot, spawns WorkerSession, creates a complete input registration wire and dispatches it before the actual model command at `:974–977`. Initial open also registers a worker at `:633`; the first model apply subsequently builds another worker. Worker registration parses and materializes input; core `session.rs:170–199` additionally computes encoded wire size and validates dataset admission.

**Measured with current existing Linux arm64 debug worker, three runs each:**

| Rows×columns | Median spawn/INIT | Median registerInput RPC | Median applyModel RPC | Apply status |
|---|---:|---:|---:|---|
| 2,000×4 |23.586ms|120.121ms|21.113ms|all three viewReady|
| 10,000×4 |23.341ms|493.559ms|not a successful performance result|all refused|
| 20,000×4 |32.245ms|1,001.619ms|not a successful performance result|all refused|

At2k rows the sum of phase medians is164.82ms and143.707ms is startup+registration; this demonstrates the importance of input preparation for this particular trivial raw model. It is not a measured request percentile or a predicted saving for complex Statement computation. The10k diagnostic was captured explicitly: RESOURCE_LIMIT, `Retained result state budget exceeded`. No larger-table capacity claim follows. Worker spawn includes INIT and hard-limit setup; register timer includes pipe transfer, decoding, validation and encoded-size accounting. It does not isolate those internals.

**Concrete design direction:** first take the low-risk decode improvement above. Then evaluate a bounded private candidate initialized from an immutable input representation (or safely prepared worker candidates), so successive models avoid reparsing/recopying identical input. Keep source identity/revision/locale in the reuse key and charge all retained candidates/immutable input memory. A mapped immutable validated representation would require a versioned contract and fresh admission checks. A prewarmed empty worker only addresses startup (~24ms here), not the larger registration phase. The model candidate must remain killable without killing a published result.

**Critical constraint:** fresh workers currently provide transactional publication, hard cancellation containment, and old result retention for pinned exports. Never optimize by applying in-place to `published.native` or sharing its mutable view/transfers with a new candidate. A cancelled or failed apply must leave the prior result usable; pinned presented exports must finish against their original revision. Any worker pool requires bounded size, clean state/isolation, independent terminal cancellation and the existing process hard limit.

**Validation needed:** success/failure/supersession/cancellation with concurrent rows and exports; parent refresh/disposal during derivation; foreign owners and locale separation; hard memory exhaustion and cleanup; phase timing in a release build on successful raw/pivot/Statement workloads.

## 5. Native-worker lock waiters consume globally scarce compute permits

**Evidence:** `sessions.rs:446–458` obtains a global compute semaphore permit before entering the blocking closure. Read path acquires `published.native.lock()` later at `:837`; export path at `:1366`; derive acquires it per batch at `sessions/derivation.rs:153`. The sample profile has2 compute workers. One long operation on sessionA plus one additional operation blocked on A's native mutex can occupy both permits and delay otherwise independent sessionB. Cancellation checks are after the lock; the worker RPC deadline bounds the holder but waiting jobs still retain admission reservations until actually finishing.

**Concrete optimization:** consider per-published-worker bounded async scheduling before obtaining a compute permit, or an actor that retains one serialized RPC stream and requests global compute admission only when the worker can dispatch. Keep total admitted jobs/memory reservations, request deadlines including queue time, cancellation registration and snapshot pinning. A fast latest-batch retry path may also avoid waiting for native: today `export_batch` acquires native before inspecting `s.last` at `:1372–1374`; any change must preserve lock ordering and close/cancel checks.

This is a concurrency inference, not a measured latency claim. Benchmark two-session mixed chart/rows/export/derive workload with per-stage queue time, mutex time, active RPCs and admission; add a delayed-worker test proving independent-session progress and cancellation cleanup. Lower priority than measured data-copy costs until concurrent production-like traces exist.

## 6. Catalog access rescans metadata under a service-wide mutex

**Evidence:** `sources.rs:263,280` lock `self.gate` for reads/acquisitions; `namespace` at `:331–343` unconditionally runs `prune`; `prune` at `:491–516` lists all principal records and reads/validates each one. Each `record` at `:385–428` opens/parses metadata and recomputes its fingerprint. Create upload locks at `:161` and holds the gate through reading/writing/hashing payload and fsync/publication; find/admit add further complete metadata scans at `:345–370`.

**Trigger/effect:** many retained source/idempotency records, concurrent users opening/refreshing/uploading; direct acquisition is Θ(principal record count) metadata operations before reading its requested record, and another principal's fsync can block it. This is not on ordinary row fetches and is bounded by configured catalog quotas; don't present it as the main large-row CPU bottleneck.

**Concrete optimization:** per-principal gates plus bounded scheduled/prune-on-write expiry work and a bounded/recoverable idempotency index; keep fd-based access, owner namespaces, content integrity checks, crash recovery, tombstone retention semantics, exact quota accounting and atomic publication. Verify delete/acquire races, crash at rename/fsync, idempotency retry conflict/expiry, and namespace cross-owner isolation. Benchmark maximum configured record count with concurrent independent principals. No timing claim here.

## Derivation/ingestion observations below the above priorities

Derived children at `sessions/derivation.rs:151–224` traverse batches over IPC, decode each response into Value, accumulate all rows in one dataset, convert to typed SourceDataset, encode complete input JSON, then publish_input registers a new worker. `std::mem::take(chunk)` at:197 and extending at:217 move rows, so this is not repeatedly cloning the complete accumulated dataset per batch and is not O(N²). The all-rows source is needed by the current independent child-session contract. A future typed bounded batch decoder/writer could avoid generic Value construction and an intermediate whole dataset, but must still validate complete metadata/lineage, limits and exact parent revision before child publication; process-cancellation fences and cursor cleanup remain mandatory.

Ingestion at `ingest.rs:168–176` reads/checks the full upload, base64-encodes it and serializes a request; `:248–250` then copies this request into a frame. Header+payload segmented writing (as native worker driver already does at `driver.rs:223–224`) can remove one request-sized copy. Reusing a warm parser across requests is a separate containment/lifecycle design and should not be assumed safe. Preserve one-shot failure cleanup, backend authentication, input hashing and bounded stderr/output/deadlines. These are constant-factor secondary costs relative to the measured full Value clone and registration.

Native worker driver currently writes header/payload separately and converts owned Vec<u8> to String without a byte copy (`driver.rs:193–201,223–224`). Do not claim an extra payload copy there. Framing allocates a bounded payload buffer and zero-initializes it at `protocol.rs:120–127`; no recommendation to remove validation or introduce unsafe uninitialized memory is warranted without profiles.

## Reproduction and limitations

Probe sources: `/private/tmp/bdobb-worker-linux-root/tmp/ssrm-perf-probe/Cargo.toml` and `src/main.rs`. Results: `/private/tmp/ssrm-perf-probe-results.txt`; one10k diagnostic rerun: `/private/tmp/ssrm-perf-probe-refusal.txt`. Main source was restored to2k/10k/20k with3 repetitions after the diagnostic-only run; it now additionally prints first refusal details. Command:

```sh
/private/tmp/run-native-worker-linux.sh cargo run --offline --manifest-path /tmp/ssrm-perf-probe/Cargo.toml
```

The wrapper uses existing task-owned host-backed Linux runtime and cached dependencies, no downloads or image build. Probe compilation and files are in/private/tmp; repository mounted read-only. It links actual current path dependencies and uses existing `/target/debug/pivot-native-worker`. Worker binary SHA256 `48fe5ccea97696a21d58e6a1a683ccd555473a7fc706426041a500b57e7b67fc`. Relevant core/wire/native/worker source has no changes between qualification source c390d3b1 and reviewed HEAD. Fixture source is existing raw fixture, repeated first row with unique row IDs;4 columns. Probe enforces512MiB worker hard memory and8MiB frame/input cap,64MiB cache/block caps; other ResourceLimits defaults remain. It exercises WorkerSession API directly, not authenticated HTTP/gateway/UI, and isn't a full service configuration capacity test.

Allocation counter wraps System with atomic counters for alloc/realloc; numbers mean total allocation requests/cumulative requested bytes during measured stage, not peak. The worker process does not inherit this custom allocator, so worker phase measurements have only parent-side counter overhead. Only three successful2k runs and a single decode comparison per size were collected; timing noise and debug overhead preclude production speedup forecasts. No release build, broad test sweep, Docker image build, live vendor fetch or external service mutation occurred. Worker wall times should be reproduced under the actual release image before selecting larger architecture work.
