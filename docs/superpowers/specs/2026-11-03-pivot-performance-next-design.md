# Profile-led pivot performance follow-on design

Date: 2026-11-03
Status: Design approved by user on 2026-11-03.
Target: BDOBB release/v4, TypeScript and Rust/WASM separately.

## Intent and approach

Find the remaining costs in realistic cold and repeated interactive workloads, then optimize the measured bottleneck without changing financial, filtering, selection or publication semantics. User selected profile first rather than starting with fused OHLCV reducers or reusable preparation. The test program continues independently; its relevant correctness results are prerequisites to integrating performance changes, not a reason to postpone read-only profiling.

Alternatives considered: reducer-first may reduce repeated aggregate scans/sorts but their share of total cost is unmeasured; preparation-cache-first may speed repeated interactions but adds invalidation/retained-memory risk before its benefit is known. Profile-led work separates acquisition, transport and calculation costs and allows the outcome 'retain baseline' if no safe candidate pays off.

## Starting evidence and exclusions

PR #25 already includes borrowed ordinary Rust sources, sparse no-source-formula state and explicit-empty-selection correctness. Its dependencies #22/#23 share and compact category members. Do not repeat those proposals or compare against an obsolete pre-change baseline. Pin the actual candidate stack and record source/artifact checksums; use merged equivalents if available without merging them ourselves.

Earlier exact-exchange-Q OHLCV measurements showed preparation improvements at 60k/300k rows. They are direct Node/WASM session measurements excluding browser workers and rendering. They are evidence for those patches, not current full-day or device acceptance. The TS sparse-state experiment broke mutable-empty-map expectations and is not an approved optimization. Binary input/columnar transport remains deferred; no new wire protocol, shared memory, vendor dependency, raised resource limit or general bar-rollup feature is part of this design.

## Workloads

Use the real 2026-10-30 NVDA tick acquisition, preserving source identities, original temporal order, exchange venue and independent every-bar OHLCV/count references. Run exact venue selection, not substring search. The primary ladder is 60k and 300k mixed-venue rows, then the acquired full day where current admission permits. Count-only and full OHLCV are paired to separate bookkeeping from reducer cost.

Define cold input registration/apply separately from warm same-session interactions: 1-second -> 1-minute -> 1-second grouping, Q -> another observed exact venue -> Q selection, repeated identical apply, sort change, and a linked-table/chart consumer. Do not substitute prefiltered input for runtime filtering without labeling it as a different workload. Keep normal selection, inspection, facets, export and errors enabled.

The SEC corpus contributes a small certified Statement control (98 facts/110 independent numeric cells) and bulk analytical/import stress at the test program's sizes. Bulk financial facts are not a certified large Statement. Larger synthetic Statement workloads must be labeled synthetic and obey company/unit/period invariants. Statement controls protect semantics, not a claim that Statement is the tick bottleneck.

## Measurements and attribution

Use the qualification runner/report schema once available rather than creating a competing permanent benchmark system. A temporary spike adapter may record the same fields before that task lands; replace it on integration.

Measure acquisition/parse, host encoding, native registration/decode, model validation/compilation, source evaluation, category derivation, qualification/runtime resolution, facets, groups/scopes, aggregate inputs and reduction/order work, output projection, linked transfer, chart-data delivery and rendering. Validate the actual call boundaries before assigning a cost; distinguish inclusive from exclusive timing, and do not add overlapping durations as if independent.

Collect low-cost work counters: row visits, input materializations, comparison/sort counts, host order crossings, cache hits/misses/evictions and bytes retained where the implementation exposes defensible estimates. These counters supplement time and must not be presented as byte-accurate RSS. Record peak process-tree RSS with sampler interval, WASM linear-buffer size, post-warm-up retained trend and event-loop/input responsiveness.

Instrumentation is internal and opt-in in an isolated profiling build. It must not add fields to the public execution protocol or product UI, alter evaluator results or emit source financial records/contact details into logs. Prefer test-only stage observers/private profiling hooks at established boundaries, selected during build/harness setup. Record instrumentation configuration. Use instrumented runs to locate costs; all claimed speedups and final correctness runs use uninstrumented production-equivalent artifacts. Measure observer overhead against the same uninstrumented workload and report it.

Run sequentially with pinned toolchains, locale, hardware and source data; no builds or other benchmarks concurrently. Alternate baseline/candidate order, use fresh processes for cold runs and retain session identity for warm runs. Start with five observations per feasible workload and repeat an independent batch for any proposed winner. Save all observations and median/range; five samples do not justify a reliable p95 claim. Document timeouts/refusals separately and do not raise limits to complete a measurement.

## Candidate selection and experiment contract

Rank stages by end-to-end contribution, repeated work, memory cost and affected interactions. Select exactly one experiment at a time using the following routes only when its profile supports it:

- Repeated aggregate input/ordering dominates: guarded same-scope direct-field reducer fusion or reused temporal order. Preserve source-ordinal ties, original-order sums, signed zero, null/nonfinite/mixed values, error evidence from nonwinning rows and metadata. Expressions, unsupported shapes and Statement keep the baseline path until independently justified.
- Repeated qualification/facets dominates: request-local reuse of source matches and target-category counting. Omit only the requested facet's own checklist; preserve order, coercion failures, exclusions, partial-result boundaries and diagnostics. No global facet cache by default.
- Warm preparation dominates: bounded immutable source/category preparation reuse. Before implementation specify the exact input/schema/source-formula/fiscal/category-recipe identity, dependency invalidation table, byte accounting/admission, eviction and cancellation/disposal behavior. Requalify the full universe after filter/venue changes; never reuse old aggregate bars as raw input. Materially new cache architecture needs its own detailed design review.
- Transport or rendering dominates: report that result rather than forcing an engine optimization. Investigate existing batching/projection/consumer behavior within the current protocol; binary transport requires a separately approved design.

Apply each route to TS and WASM independently. 'No corresponding TS benefit' or 'guarded Rust-only win' is an acceptable result. Do not remove immutable worker/validation snapshots simply because a clone appears in a profile.

Each experiment records hypothesis, eligible shapes, exact fallback trigger, changed files, expected removed work, invalidation/failure semantics, tests and before/after measurements. Reject candidates whose apparent speed gain results from skipped diagnostics/facets, changed float order, fewer rows or omitted work. If baseline variability explains the gain, repeat or reject; no arbitrary percentage target is a correctness gate.

## Integration and acceptance

Promotion requires independent financial and tick references, relevant seeded parity/action traces, exact exchange/filter/facet semantics, explicit-empty/clear behavior, stable IDs/lineage/inspection/export, failure isolation and actual browser-worker verification of touched interactions. Correctness is blocking; timing remains advisory but a performance patch must demonstrate a repeatable, attributable benefit to justify its complexity.

No candidate may silently expand resources, leave unbounded retained state, or make a cold path materially worse without an explicit documented tradeoff for review. Quantify cold/warm and memory tradeoffs, including post-warm-up repeated-interaction behavior. A cache is not a win merely because its second query is fast while retained memory grows.

Publish recommended production changes as separate TS versus Rust/WASM PRs targeting release/v4. Keep profiling infrastructure and generated benchmark data out of product flows. Do not merge or push a shared branch without existing authorization; no automatic changes to release branches.

## Deliverables and builder choices

Deliver a baseline stage/counter report for each engine, ranked bottlenecks, reproducible action/workload manifests, one-at-a-time experiment results including rejected options, retained-memory evidence and recommended integration patches with coverage links. Every report names exact source/artifact/data/environment identities and explicitly lists missing full-day/native/device evidence.

The builder chooses profiling hook placement after source inspection, sampling intervals, feasible run ceilings and report visualization, recording those choices. The root controller selects the next experiment from evidence, not from an assumed common bottleneck. No production optimization has been selected or implemented under this design yet.
