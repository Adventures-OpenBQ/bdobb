# Private pivot profiling hooks (P2)

This is opt-in attribution infrastructure for the approved 2026-11-03 profile-first design, not a qualification runner or a production optimization. The patches apply to exact file SHA256s at `6bf151d6e44319b3c0035c56d886cd93a168f0a1`; the commit label is provenance, not permission to patch changed files. No production source imports this adapter. Task7's runner must replace/adapt the small `profile-controls.mjs` helper at P3. Real 60k/300k/full-day admission is not established here.

## Build isolation and identity

Run sequentially, with no other builds or measurements:

```sh
PIVOT_WASM_BINDGEN=/path/to/pinned/wasm-bindgen node scripts/pivot-qualification/profiling-build.mjs /external/new-clean-directory --clean
PIVOT_WASM_BINDGEN=/path/to/pinned/wasm-bindgen node scripts/pivot-qualification/profiling-build.mjs /external/new-profile-directory
PIVOT_PROFILE_CLEAN_DIR=/external/new-clean-directory PIVOT_PROFILE_DIR=/external/new-profile-directory PIVOT_PROFILE_OUTPUT_DIR=/external/new-results-directory node --test scripts/pivot-qualification/profile.node.mjs
```

Output directories must not exist and must be outside the checkout. Each build copies the source tree, excludes generated/target directories, checks every patched source checksum, uses an isolated Cargo target and pinned Rust/bindgen versions, and emits clean or private profiling ESM/WASM. Release sources, generated artifacts and build activation are unchanged. Generated artifacts, raw payloads and samples stay outside Git. No new dependency is added; build-time esbuild already exists in this repository.

`identity.json` records source commit, source checksum (core/wire/wasm sources, TS library sources, crate manifests/locks, JS dependency manifest/lock and toolchain pins), emitted JS/TS/WASM checksums and patch/probe checksum. Source identity is checked before and after build. A clean build has no private probe exports. An instrumented artifact labeled clean, or a profile artifact missing its probes, is rejected.

The Rust target is `wasm32-unknown-unknown`: do not use `std::time::Instant`. Only the isolated WASM patch declares a `wasm-bindgen` import of `performance.now()` and private `__pivot_profile_reset`/`__pivot_profile_read` exports. The core receives a plain clock function pointer on reset; RAII guards close coarse stages even on Result early returns. Timers are at stage boundaries, never inside row/comparison loops. Existing host order calls increment a native counter without an additional callback. The TS isolated patch uses the same host monotonic Performance API and try/finally guards. Neither mechanism changes execution request/response fields. Time collection starts only after the harness explicitly resets a private probe.

## Runtime binding

`collectProfile(workload, {engine, buildIdentity, outputDir})` accepts `engine: 'typescript' | 'rust-wasm'`. The workload is a sanitized descriptor with `id`, `inputChecksum`, and `modelHash`. It contains no paths, callbacks or source rows.

`buildIdentity` is a **private runtime binding**, not a workload or report:

- `runID`, full `sourceCommit`, `sourceChecksum`, `patchChecksum`, `instrumented: true`.
- `artifactPath` and `artifactChecksum`: bundled TS ESM or WASM glue ESM. For TS use the build's `typescriptChecksum` as `artifactChecksum`.
- `runnerPath`, `runnerChecksum`: trusted private ESM implementing `runProfileControl(workload, {artifact, observer, wasmPath, supportPath})`.
- For WASM, `wasmPath`/`wasmChecksum` and `supportPath`/`supportChecksum` bind the compiled binary and TS public wire/order adapters. Paths are verified before import and omitted from reports.
- TypeScript bindings reject `supportPath` and `supportChecksum`; support artifacts belong only to the WASM adapter.
- `controlRunIDs` names matching observations in the paired control report. These references are not fabricated clean timings inside an instrumented run.

The recorder is per-run and serialized; `observer.measure` wraps synchronous work. For asynchronous host phases use `begin` and end the returned closure in an awaited try/finally. The runner resolves rows/models privately from its workload ID, initializes the artifact, resets profiling, runs the same public operations, independently checks output, and returns actual `inputChecksum`, `modelHash`, `resultChecksum`. The adapter verifies the first two against the descriptor and persists only checksums, safe stage/counter fields, settings and control links. The temporary helper hashes lossless `pivot-wire-v1` JSON for datasets, `{definition,runtimeParams}`, expected cells and public operation definitions, preserving negative zero, missing and nonfinite values. Output is also hashed as tagged wire. Each control/sample links to an immutable `controlDefinitions` entry with input/model/runner/expected checksums; SEC entries additionally pin both complete reference and expected fixture bytes. Exact public operations, selection cases, read parameters and the observed selection are included without recording financial rows or model bodies. Definitions are checked before and after each observation (outside timing); runner bytes are checked again before writing results. Future Task7 must use its canonical checksum definitions and artifact dependency graph: a hash of the entry runner alone does not attest every transitive imported helper. No report is an authorization to admit a real workload.

`profile-schema.json` describes the structure of format 1. Both it and `run-schema.json` are structural descriptions, not complete measurement-admission validators. Schema validation alone cannot certify evidence: runtime semantic checks, artifact/evidence checksum verification, and cross-record identities remain mandatory. In particular, probe arrays and environment/limits objects in the run schema do not fully constrain their contents. Admission also requires per-phase observer validity; an incomplete observer leaves raw partial values and errors visible but excludes the phase from ranked timings, contributions and candidate availability. A valid earlier phase remains usable after a later engine failure. `validateProbe` additionally enforces stage/counter allowlists, finite intervals, ordered starts, unique event IDs and contained parent intervals. A failed control is a failure, not a plausible profile. Existing output files are never overwritten by collection.

## Actual owners and accounting

All event times are inclusive, in host `performance.now()` milliseconds. Events are ordered by start, with explicit IDs/parents. Children overlap parents and must not be added as independent exclusive costs. `exclusiveTotal` rejects any overlapping input. Host envelope timing and engine events are separate arrays. Observer overhead and uninstrumented timings are never used as a speedup claim.

| Stage | TypeScript owner | Native owner / overlap |
| --- | --- | --- |
| Calculate envelope | `tableExecution/engine.ts:calculateView`; analytical work in `calculateTable` | `analytical.rs:calculate_view`; does not include registration/wire |
| Model validation/compile | `tableModel/calculate.ts:compileAnalyticalModel` | `formulas/mod.rs:compile_with_fiscal`; Statement compilation/enrichment precedes this, still inside envelope |
| Source evaluation | `formulaEvaluation.ts:evaluateSourceFormulas` | `formulas/source.rs:evaluate_source` |
| Category preparation | `categories.ts:deriveCategories`, nested in source evaluation | `categories.rs:derive_categories`, nested in `eligible_pool` |
| Runtime/source qualification | `calculateTable` resolves runtime then calls `facets.ts:eligiblePool` (only the latter has its own event) | `scopes.rs:eligible_pool`; includes category derivation, runtime group resolution, qualification and some facets |
| Facets | `facets.ts:categoryFacets`; includes own-checklist exclusion/qualification | `scopes.rs:facets`; member counting only, nested qualification/preparation owners differ from TS |
| Groups/scopes | `calculateTable` result-filter partitions, `calculateScope`, totals, projection | `analytical.rs:calculate_view`, `totals.rs:ScopeResults`, `hierarchy.rs:visit`; overlaps aggregate evaluation |
| Aggregate inputs/order/reduction | `formulaEvaluation.ts:scopedSourceRows`, `evaluateAggregateFormulas`, aggregateInput/reducer | `scopes.rs:rows_in`, `formulas/aggregate.rs:evaluate_aggregate`, `pivot.rs:aggregate_indices`; boundary counts only |
| Output projection | `calculateTable` inline projection plus engine selection reconciliation; included in envelope | `analytical/projection.rs:project`; includes scope/aggregate calculation and hierarchy work, **not exclusive projection** |
| Transport/rendering | Not included; Task7 harness owns encode/decode, workers, transfer, chart delivery and paint | Native public control timing includes wire/host adapter work; engine stages do not |

Aggregate work occurs repeatedly inside projection, totals and result-filter evaluation. This initial adapter intentionally does not put host timers on every aggregate/scope/row. Fine-grained aggregate-exclusive timing, complete groups/scopes timing, TS runtime-resolution time and native Statement compile/enrichment time are unavailable separately; use envelopes and counts, and extend coarse boundaries or sampling before ranking those as distinct costs. This limitation must remain visible in P3 profiles.

## Counters and missing measurements

| Name | Unit/scope | Exact meaning |
| --- | --- | --- |
| `source-input-rows` | rows / source-evaluation | Sum of input slice lengths at evaluator entry; not total internal visits |
| `facet-row-visits` | rows / facets | Native facet outer-loop rows; excludes inner category visits |
| `scope-row-materializations` | vectors / rows-in or scoped-source-rows | One per scope-row vector construction call, including empty results; not allocated bytes |
| `scope-orderings` | sorts / rows-in or scoped-source-rows | Existing scope ordinal sorts; native fallback without index does not sort |
| `aggregate-evaluations` | calls / aggregate | Scope aggregate evaluator entries, not number of reducers |
| `host-order-crossings` | calls / host-order | Existing native HostOrder callback calls; includes cached/native bypass behavior naturally |

Missing counters mean **unknown**, not zero. Complete comparisons, all input materializations, retained bytes, cache hits/misses/evictions and total row visits are unavailable. Neither the scoped source WeakMap nor the native ordering caches are instrumented per lookup. No byte-accurate RSS, process-tree peak, allocator retention, UI responsiveness, or browser sampling is claimed. Those belong to the eventual qualification harness; use native/browser profilers when stage envelopes are insufficient.

## Small controls and overhead

The optional Node control test checks six SEC companies (98 facts/110 independent expected cells) and a clearly labeled four-row synthetic tick case. The tick case has exact `Q` versus `24EQ`, stable equal-time first/last ties and hand-calculated OHLCV/count totals. It is not the real market workload or a granularity benchmark. Both clean/profile TS, glue and WASM byte hashes, role flags, source/patch identities and matching toolchain metadata are verified before either artifact is imported. Every same-engine clean/profile public result is compared exactly: ready metadata, row/group IDs/order, cell errors, totals, facets, selection and presented batches/provenance. None and explicit-empty selection are both exercised. The SEC portable fixture intentionally supplies its own local source provenance wrapper.

Five alternating-order observations per engine/control preserve every sample in `controls.json`. Facet-name discovery occurs before observations. Timing covers the complete small public operation sequence with prepared in-memory input, in one warmed process; no reliable p95, cold startup, resource-admission or device claim follows. Report clean/profile median and range alongside the raw sample IDs. Profiling perturbs allocation and work, and tiny timings may be dominated by warm-up/GC noise. Run winner experiments only on clean artifacts.
