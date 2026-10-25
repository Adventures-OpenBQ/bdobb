# Rust Pivot resource and platform acceptance

Rust remains an explicit development/test provider. The production default is
TypeScript. There is **no regular-iPad physical-device performance or memory
acceptance evidence**, and no device-derived operational defaults. Desktop
WebKit, native WKWebView, iPad Simulator and secondary physical iPad Pro functional checks supplement the
physical gate; they do not establish regular-iPad resource ceilings.

## Reproduce

From the repository root, build with the pinned toolchain and measure actual Wasm:

```sh
PATH="$PWD/.pivot-tools/bin:$PATH" pnpm pivot:build
node scripts/benchmark-pivot.mjs --samples 3 --browser
pnpm test:pivot:browser
```

The browser commands start local HTTP/HTTPS test servers and launch installed
Playwright Chromium/WebKit. They do not deploy or access production services.
`--output PATH` selects an alternative measurement file. `--samples 1` is a quick
probe. The full benchmark asserts chart-row, total and exported-row parity against
the TypeScript engine before saving measurements. It does not regenerate the
41 frozen semantic fixtures.

## Measurement contract

`measurements.json` contains platform, toolchain, workload sizes, every timing
observation and the method. Each Node workload has a fresh child process and Wasm
instance. Initialization measures actual module initialization; request conversion
includes existing validation/cloning, tagged-value conversion and JSON encoding.
Wasm dispatch includes Rust parsing, validation, calculation/publication and
response serialization. Response conversion includes decoding and validation.
Five repeated sorting edits per sample reuse the acquired source. Host callbacks
are counted by scalar/raw/recipe/permutation kind, including warm host-cache reuse.
Export measurements pull successive batches; exported rows are independently
compared with the baseline projected rows.

Node's TypeScript calculation timing excludes wire and worker transport. The
measurements therefore make **no comparable end-to-end speedup claim**. Browser
registration includes worker/module startup and conversion; apply/edit/export
measure actual worker round trips and structured-clone transport. Browser runs
report their own versions and user agents and use one run per workload with five
edits. All benchmark resource ceilings are unset; this is an experimental baseline,
not production activation or acceptance of an uncapped engine on iPad. These timings
in `measurements.json` were collected from the implementation committed as
`8dd1b9e`; subsequent JS preclone admission fixes were not remeasured in that
original record. A verbatim copy is retained in `measurements-initial-8dd.json`.

`final-measurements.json` refreshes the seven workloads against the final review
artifact (three Node samples; Chromium/WebKit browser runs). `final-fix-before.json`
and `final-fix-after.json` compare an immutable `7ef3390` Rust build with that
artifact using the same script and matching encoded-workload SHA256 values. The
comparison uses the current host protocol for both artifacts. Distinct-value
grouped 10k Rust dispatch median changed 916.822→39.747 ms (-95.7%); the 500-row,
20-aggregate/20-source-formula case changed 2827.756→107.106 ms (-96.2%). Host
callback counts were unchanged; measured Wasm linear high-water was unchanged or
slightly lower. These quiet serial three-sample observations are not confidence
intervals, TS-versus-Rust comparisons, or physical-device performance acceptance.
The final Wasm SHA256 is
`ca5a13b7d96d06f7840d241b3c8a4c715a2a766a31219b980b29aee2c67acd75`.

Wasm linear memory is measured from actual `memory.buffer.byteLength` after each
call. Its monotonic high-water includes live allocations and reusable/free pages;
it is not live heap or process peak. Node RSS/heap are sampled at stage boundaries
and include the measurement program, TypeScript oracle and conversion objects.
They can miss transient process peaks. Safari/worker process peak memory is
**unavailable**, represented by null; no exact Safari process-memory value is
inferred from Wasm pages, Chromium or Node.

## Opt-in resource API

```ts
createRustExecutor(widgetId, undefined, {
  maxInputBytes: inputReservation,
  maxRows: sourceRows,
  maxPivotColumns: outputColumns,
  maxBatchBytes: rowAndExportWireReservation,
  maxCachedBlockBytes: retainedBlockReservation,
  maxConcurrentTransfers: activePullStreams,
  maxStateBytes: combinedEstimatedStateReservation,
});
```

These values are explicitly supplied by a development/test caller; this document
recommends no operational value. Limits are integers from zero through 2^32−1.
Zero is an enabled zero budget. Unknown/nonenumerable/inherited fields, serializers, accessors, negatives, fractional
and overflowing values refuse. Options are captured in the worker configuration
before acquisition and survive worker replacement. An oversized/malformed worker
configuration fails initialization. A custom worker factory must configure its
own worker; passing a separate limits object alongside it explicitly refuses
rather than silently ignoring that object.

- `maxInputBytes`: conservative host conversion/input-wire reservation and native
  encoded source admission. Input graph preflight includes nested values and
  metadata. It can refuse before the encoded request would reach the byte ceiling.
- `maxRows`: admitted source row count, including reacquisition candidates.
- `maxPivotColumns`: complete output and chart schema width before publication;
  it can narrow, but cannot widen, the existing 500-pivot-column semantic limit.
- `maxBatchBytes`: encoded row-block and pulled export-batch reservation, including
  first-batch columns/provenance/freshness and every response's completeness,
  diagnostics, warnings and correlation envelope. It is a conservative reservation,
  not an exact byte-identical threshold at every transport layer. Schema/ready,
  chart and authoring responses retain their existing protocol bounds; a combined
  state budget is needed to budget their workspace.
- `maxCachedBlockBytes`: conservative retained/transient bytes per UI row block,
  including metadata. The existing UI still retains at most 12 blocks and bounds
  pending reads; the state reservation accounts 12 delivered plus 12 in-flight
  blocks. It does not introduce a promise that cache eviction recovers OS memory.
- `maxConcurrentTransfers`: active pull streams, with cancel/final/disposal release.
  The immutable protocol ceiling of 32 is still enforced. Failed export batches
  do not advance a sequence or leak a first-batch transfer slot.
- `maxStateBytes`: conservative combined structural/workspace reservation described
  below. There is no certified allocator/process-memory/OOM ceiling.

The former experimental `inputBytes`, `cacheBytes`, `exportBytes` options remain
accepted: stricter input aliases win, `cacheBytes` now counts the entire retained
calculated view, and `exportBytes` retains its projected export-row wire check.
The core `Session::resource_usage()` / Wasm `resource_usage(handle)` API returns
only byte/count estimates, not source values or identifiers.

## Conservative accounting and restricted state profile

Native accounting recursively traverses every owned field of the source,
`StoredView`, calculated analytical view, compiler/AST/graph/symbols, evaluated and
categorized rows, eligible/universe pools, memberships, dependencies/errors,
retained formula metadata/scopes, fiscal/context slices, groups, identities,
selection/hierarchy, totals/facets, schema, metadata and transfers. Exhaustive
struct/enum destructuring causes new fields/variants to require accounting changes.
String/Vec actual capacities and boxed inline sizes are charged. Each allocation
has a 32-byte allowance. BTree map/set entries conservatively charge a sparse
whole node: 16 inline key/value slots plus 256 bytes of header/pointer allowance,
then nested owned storage. These allowances require calibration; they are not
allocator introspection or a proof of a process-memory ceiling.

Preflight occurs before source cloning/registration mutation or expensive model
preparation. It retains the old source/publication/transfers while reserving the
candidate. Workspace growth is checked as
`(source + model + request storage) × (N + 1) × width × hierarchy depth ×
(categories + formulas + 1) × 18 stage slots`. Split width reserves at least 501
slots, including the group label above the immutable semantic cap. Stage slots
cover evaluated/categorized/eligible/source and result duplicates, filtering,
projection, sorting/permutation decoding, formula/metadata/memo scratch and
unfiltered chart-schema preparation. The final review adds two slots (16→18, a
12.5% increase in the workspace term) for preparation-local exact-scope aggregate
results/owned scope keys and scope-error/index scratch. The scope/output/formula
factors bound these temporaries before allocation; they are released after
preparation and are not reported as retained state. No resource cap is disabled.
The more conservative reservation can refuse a candidate close to a caller
chosen cap. Overflow refuses explicitly.

Additional reservations cover source/reset ownership, structured-clone and
UTF16/wire conversion copies, 24 UI block slots, the combined 4,096-entry Rust
scalar/raw cache and the host's scalar plus recipe caches (up to 8,192 entries).
Old and candidate model-derived keys are charged. Host caches also enforce an
explicit combined byte reservation. Native full retained accounting is repeated
before committing the candidate; this post-check is not a substitute for preflight
and cannot turn an underestimated transient allocation into an OOM guarantee.

The JS facade partitions an opt-in combined state budget: floor(half) for native
retained/candidate/host-conversion workspace and floor(half) for all queued/in-flight
raw request graphs **plus their validated request copies**, reserved before the
validator clones the raw request. Raw descriptor traversal stops at the available
reservation, avoids a complete key/descriptor array, and never executes getters.
Sparse array slots are charged even when they contain holes. Valid dispose/cancel
requests retain only their canonical small control envelope so they remain usable
under a zero data budget. Invalid correlations are not echoed. The extra host structural check uses the native half already
reserved for those conversion/source/model/cache objects. It does not create a
second available full budget. JS capacities and allocator sizes are unavailable;
its structural reservation charges UTF16 strings, worst encoded escapes,
conversion copies and property/container allowances. Direct native sessions use
all of their supplied state budget because they own no JS request queue.

**Bounded state profiles explicitly refuse Statement intents, any MEMBER AST,
chained identity-witness contexts, and worker `importFile` parsing before preparing them.** Their dynamic
context/expansion bound is not established here. Compressed file parsing in the
existing acquisition adapter has no established workspace bound; bounded state
sessions require a validated Dataset through `registerInput`. Other resource caps alone and
uncapped experimental sessions continue to execute these operations, including file imports, with existing
semantic parity. Ordinary source/aggregate arithmetic and table fiscal categories
remain eligible for state reservation. Conservative fanout allowances can refuse
a workload whose actual filtered result would fit; authors can use a separately
measured budget or the explicitly uncapped development baseline. No cap is silently
turned off after a refusal.

**BigInt has no established bounded pre-conversion magnitude estimate in JS.**
`maxStateBytes` therefore refuses BigInt anywhere in the admitted request graph;
`maxInputBytes` and the `inputBytes` alias refuse BigInt in an acquired Dataset,
including source cells and metadata, before cloning or decimal/tagged/JSON
conversion. These explicit byte-profile refusals preserve committed state.
Row/width/transfer count caps alone and uncapped Rust retain supported BigInt wire
parity; native batch/cache accounting still charges the actual encoded BigInt string.
The internal JS estimator marks its byte bound unavailable rather than pretending
that a BigInt is a fixed-size scalar. No unavailable estimate is serialized as a
measurement or diagnostic value.

Accumulating complete chart/export/linked results in a caller-owned array/file
buffer is outside session ownership. Streaming consumers must bound their own
retention and cancel when finished. This session budget does not cover unrelated
widgets, browser/app assets, rendering, OS overhead or simultaneous process load.

## Refusal, lifecycle and compatibility

Predictable resource refusals are explicit recoverable `RESOURCE_LIMIT`
diagnostics through the native core, Wasm decoder, shared response validator and
worker facade. A failed reacquisition/model retains the committed source/model;
failed candidate revisions remain unreadable. A trap/loading/worker failure uses
`RustRuntimeFailure` / the worker-loss/reset path. Cancellation invalidates obsolete
work; synchronous Wasm cannot service cancellation until yielding, so a hard edit
interruption can replace the worker and restore committed state. Browser process
or OS eviction is not promised to emit a recoverable Rust diagnostic.

The existing React renderer, UI and CSS remain in place. Supported Unicode scalar
strings preserve identities; unpaired UTF16 surrogates refuse without normalization.
Unknown/malformed serialized AST kinds refuse the whole candidate; prior successful
publication is retained on unchanged input. This is the accepted corrupt-AST
compatibility boundary, not silent calculation fallback. Compound FY quarter
evidence that requires JavaScript object-reference identity also refuses; the
first tagged-tree wire does not preserve aliases. Structural/value/error,
missing/null, ID/order/count and sum comparison remains exact. Finite mean/derived
ratio arithmetic uses `abs(a-b) <= max(1e-12, 1e-12*max(abs(a),abs(b)))`; no blanket
floating-point or sum tolerance is accepted.

## Acceptance evidence and remaining physical gate

| Requirement | Executable evidence |
| --- | --- |
| Wire values, definitions, formula/scoping/Statement parity, source totals, identities and authoring | Locked core suites and unchanged 41 frozen traces in actual built Chromium/WebKit workers |
| Source/rows/width/state/refused candidate atomicity; hidden/compound/capacity metadata accounting | `crates/pivot-core/tests/resources.rs` |
| Export envelope/sequence/slot release and bounded blocks | Native resource tests; actual worker resource probe; existing 1,001-row export trace |
| Host Unicode cache bytes, queue partition, zero/odd and malformed configuration; recoverable code | `src/lib/tableExecution/rust/resources.test.ts` and existing runtime/worker suites |
| Rapid edit, stale generation and committed-state restoration | Existing runtime tests and actual replacement browser probe |
| Root/nested/private packaging, CSP/MIME/unshared memory, no TypeScript evaluator in worker graph | `pnpm test:pivot:browser`, packaging and private-web suites |
| Actual Tauri custom protocol/WKWebView worker/Wasm | Current Task 12 native probe: configured resource refusal, old-publication retention, transfer slot release, hard replacement/restoration, unshared memory and disposal; normal-app dashboard UI remains a separate gate |
| Workload timing/conversion/edits/collation/export/memory method | `measurements.json` and runnable benchmark |
| iPad Simulator Safari worker semantics/export/disposal | Task 12 simulator evidence: immutable Task 11 `6a0c128` snapshot, A16/iOS 26.5 twice and iPad 10/iOS 17 once, all 41 traces each (123 total); new resource variant and UI/touch/background checks unverified |
| Regular iPad physical limits/background/resume/touch acceptance | **Pending**; simulator and desktop evidence do not replace it |

For the primary supported regular midrange iPad, record the physical model,
RAM/storage, iPadOS build, Safari version, power/thermal conditions, available
storage, exact commit/artifact hash, dataset definitions/size and test repetitions.
Use an iPad Pro only as a secondary run. Serve the actual release artifact over an
accessible HTTPS origin with its approved Wasm CSP/MIME policy. Run imports,
grouping/splits, source and MEMBER formulas, fiscal totals, filtering, rapid edits,
selection, charts/exports and touch navigation with the existing UI/CSS. Record
background, home-screen navigation, resume, tab switching, interruption/replacement and pending-request
settlement; include OS/app eviction observations without assuming an error callback.

Run the same workload definitions and an increasing rows/width/compound/fanout
matrix under realistic simultaneous app load. Record interactive latency, complete
output correctness, refusal boundaries and observed memory method. Mark Safari
process peak unavailable unless a device tool actually measures it. Derive and
review admission/cache/state/transfer defaults with a safety margin from this
physical evidence, rerun tiny-limit/whole-branch checks and independently review
before changing the production default. Until then activation remains blocked.

## Programmatic source identity boundary

The first tagged-tree wire representation cannot preserve shared top-level
`row.values` object identity. Acquisition refuses two rows referencing the same
values object with recoverable `INVALID_REQUEST`, after existing admission and
plain-data checks but before wire conversion. This protects the legacy implicit
measure path's object-key identity behavior and applies uniformly to all model
modes. The prior source/model/publication remains available after refusal.
Programmatic callers must clone the top-level values object per row; equal-valued
distinct objects and ordinary nested aliases remain supported (subject to the
existing FY-quarter object-identity exception). JSON/file datasets are unaffected.

The three final measurement records and secondary physical/native snapshot runs
precede this JS-only acquisition guard. Their exact Wasm hash remains current;
the measured Rust dispatch implementation is unchanged. They do not measure the
additional WeakSet input traversal or claim a post-guard physical JS snapshot.
