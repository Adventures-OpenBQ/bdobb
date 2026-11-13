# Pivot Performance Profiling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task; the user selected subagent execution. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce attributable cold/warm TS and WASM profiles and an evidence-based next optimization brief.

**Architecture:** Reuse the qualification program's portable references and benchmark/report runner. Add opt-in private profiling adapters and supplemental profile files without changing the production wire protocol. Rank measured costs and select one guarded experiment; write its concrete implementation plan from the actual profile rather than guessing its algorithm now.

**Tech Stack:** Existing TypeScript/Node, pinned Rust 1.98.1 and wasm-bindgen 0.2.128, Chromium/WebKit worker harnesses; no new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-11-03-pivot-performance-next-design.md` (approved by user).

## Global Constraints

- Target release/v4 with #25 e858d619 and prerequisites or exact merged equivalents; no automatic merges/pushes.
- TypeScript and Rust/WASM changes remain independently attributable and in separate production PRs.
- Correctness blocks promotion; performance begins advisory. A patch still needs repeatable attributable benefit to justify added complexity.
- Reuse qualification runner/report schema; no competing permanent benchmark platform.
- No binary protocol change, shared memory, resource-limit increases, new vendor dependency or general aggregate-bar rollup.
- Explicit [] means zero rows; none/Clear means all eligible rows. Preserve filtering/facet/error order and identities.
- Profile instrumented artifacts only for attribution; claim speedups only from uninstrumented production-equivalent artifacts.
- Distinguish bulk SEC analytical stress, certified real Statements and labeled synthetic Statements.
- No concurrent builds/benchmarks; pin source/artifact/data/environment and preserve all samples.
- Keep raw vendor data, contact email, large logs and generated artifacts outside Git.

## Review Focus

- Instrumented and clean builds must not be confused when reporting gains (Tasks 2–3).
- Repeated identity-equivalent apply must not accidentally reuse an old session in a claimed cold run (Task 3).
- Error/diagnostic omission must not be counted as reduced work (Tasks 2–4).
- Runtime venue filtering must remain distinct from loading a prefiltered dataset (Tasks 1/3).
- Warm-cache retention must not be misreported as total memory reduction (Tasks 3–4).

## Scope and dependencies

This plan is the measurement/selection portion of the approved follow-on design. The selected production optimization gets its own concrete plan after profiles exist, because the algorithm and files cannot responsibly be specified before choosing the bottleneck. A reusable-cache architecture requires its own detailed design review under the approved design.

Testing continues in its own isolated checkout. Tasks 1–2 here may prepare manifests/profiling adapters independently; Task 3 performance runs wait for qualification Task 7's runner/report interface and for relevant correctness coverage. Do not modify that runner concurrently with its implementer. Initial implementation baseline is resolved and recorded at execution start; prototype source changes and profiling features stay in a dedicated branch/build directory.

Existing candidate evidence: source evaluation/category derivation and qualification are repeated from `calculateTable` / `analytical::calculate_view`; facet qualification repeats per category; aggregate input and first/last ordering can repeat within a scope. These are hypotheses, not ranked bottlenecks.

## Task 1: (P1) Freeze matched workload/action manifests

**Files:** Create `scripts/pivot-qualification/performance-workloads.mjs`, `performance-workloads.node.mjs`, and `docs/testing/pivot-performance-workloads.md`. Small committed manifest templates may live under `src/test/fixtures/pivot-performance/`; real paths/checksums are supplied by external run manifests.

**Interfaces:** `resolvePerformanceWorkloads({tickManifest,secManifest,baselineCommit,candidateCommit}):Promise<PerformanceWorkload[]>`; each workload has ID, input checksum, real/synthetic classification, sampled row count/policy, model hash, exact venue key, granularity, measures, independent reference checksum and ordered actions. Actions distinguish new process/register/apply versus same-session apply/filter/sort/linked reads. Return JSON-serializable descriptors, never raw financial rows.

- [ ] Read existing tick acquisition/reference manifests and qualification corpus; pin available exact source commits. Record dependency equivalence if release/v4 contains merged changes.
- [ ] Write tests rejecting absent checksums, a substring venue filter described as exact, raw versus prefiltered mode ambiguity and certified-Statement labeling of bulk facts. Tests must assert semantic invalidation, not just mirror field assignment.
- [ ] Define cold count-only/full-OHLCV at 60k and 300k; full-day conditional on admission; warm second->minute->second, Q->another observed venue->Q, identical apply, sort and linked chart. Derive the alternative venue from actual observed data and record it.
- [ ] Add small certified SEC Statement control and bulk-workload descriptors using qualification Task 7 sizes; keep synthetic controls explicitly labeled. Never fabricate a full-size certified real Statement.
- [ ] Run `node --test scripts/pivot-qualification/performance-workloads.node.mjs`; validate descriptors against independent source manifests. Commit templates/resolver/docs only, no large data.

## Task 2: (P2) Private stage/counter profiling adapters

**Files:** Create `scripts/pivot-qualification/profile-schema.json`, `profile.mjs`, `profile.node.mjs`, `profiling-build.mjs` and `docs/testing/pivot-profiling-hooks.md`. Where private source hooks are necessary, keep patches under `scripts/pivot-qualification/profiling-patches/` with the exact source commit applicability; do not silently patch arbitrary revisions. Product execution requests/responses are unchanged.

**Interfaces:** `collectProfile(workload, {engine,buildIdentity,outputDir}):Promise<ProfileRecord>`; `ProfileRecord` format1 links qualification runID, source/artifact/model/input checksums, instrumentation settings, overhead/control runIDs, ordered stage events, work counters and accounting definitions. Stage events `{name,startMs,endMs,parentId?}` distinguish inclusive/exclusive accounting. Counter records name their unit and scope; absence is unknown, not zero.

- [ ] Map stage boundaries in actual pinned sources: compile, source evaluation, category preparation, runtime/source qualification, facets, groups/scopes, aggregate input/order/reduction, output projection. Record owners and overlap in profiling-hooks.md; transport and rendering remain separately timed by the qualification harness.
- [ ] Test overlapping stages cannot be reported as a simple exclusive total; unknown counters remain unknown. Reject an instrumented artifact labeled clean or a hook patch applied to an unmatched source checksum.
- [ ] Implement built-in Node/browser marks and sampling where sufficient. For otherwise invisible native stages, use a private profiling build with isolated source patches or a gated internal feature; any extra probe export exists only in the profiling artifact and never in public execution protocol. Record patch/build fingerprints.
- [ ] Collect row visits, materializations, ordering/comparison and host-crossing counts, and cache counters only at defensible boundaries. Avoid per-row timers and row-value logging. If a useful counter needs invasive changes, document it unavailable instead of pretending accuracy.
- [ ] Run the small independent tick/Statement controls through clean and profiled builds; compare public results/errors/identity/selection/facets/lineage and measure instrumentation overhead. Run `node --test scripts/pivot-qualification/profile.node.mjs` and the existing contract tests covering adapters.
- [ ] Commit profiling-only infrastructure; no production optimization or hidden default profiling activation.

## Task 3: (P3) Matched cold/warm collection

**Files:** Extend the qualification Task 7 runner through an explicit adapter seam after its commit is available; create `scripts/pivot-qualification/run-performance-matrix.mjs`, `docs/testing/pivot-performance-runbook.md`. Reuse its run-schema and report implementation.

**Interfaces:** CLI `node scripts/pivot-qualification/run-performance-matrix.mjs --manifest <external-json> --engine typescript|rust --output <external-dir>`. Each record references an existing qualification run plus optional supplemental P2 profile; no duplicate incompatible result format. Process orchestration and sampler code reuse Task 7 interfaces.

- [ ] Confirm Task 7 committed interface, supported admission limits and environment. If it differs from P1/P2 assumptions, record an adapter decision before modifying either plan's code.
- [ ] Test cold runs always create a fresh process/session; warm traces retain session identity while recording each input/model/output revision. Reject benchmark results with mismatched input checksums or omitted independent correctness validation.
- [ ] Run isolated TS and WASM cold baselines at 60k/300k count-only/full OHLCV. Attempt full-day only within current limits; preserve refusals/timeouts as outcomes. No TS-versus-WASM speed claim from different rows/measures or different filtering modes.
- [ ] Run same-session action sequences from P1 with stage attribution, including Q-other-Q qualification, sort and linked transfers. Verify every returned bar against the independent raw-trade reference and certified Statement cells against Decimal references.
- [ ] Collect process-tree RSS with sampler interval, WASM buffer size, responsiveness and post-warm-up retained trend across repeated filter/reset cycles. Report per-process and process-tree meanings; do not add already-inclusive RSS samples twice.
- [ ] Use five observations per feasible case and a second independent batch before proposing an experiment. Record fewer observations as exploratory; publish medians/range and all samples, not an unsupported p95.
- [ ] Verify browser-worker profile conclusions on the same touched interactions; distinguish Node, browser and native evidence. Commit runbook/adapter; save measurements externally with checksums.

## Task 4: (P4) Bottleneck ranking and one next experiment brief

**Files:** Create `scripts/pivot-qualification/rank-profile.mjs`, `rank-profile.node.mjs`, and `docs/testing/pivot-next-experiment.md` from actual measured evidence. The concrete optimization plan is a subsequent deliverable under `docs/superpowers/plans/`, not speculative product code in this task.

**Interfaces:** `rankProfiles(records):BottleneckAssessment[]`; an assessment names engine, workload/action, measured contribution/counters, uncertainty, retained-memory tradeoff, candidate route, necessary guard/fallback and evidence IDs. A candidate may be rejected or unavailable; no forced winner.

- [ ] Test rankings refuse to compare different work, distinguish inclusive versus exclusive contributions, retain failed/refused outcomes and avoid attributing unknown memory as zero. A synthetic report-only fixture can exercise these accounting rules without faking engine gains.
- [ ] Produce separate engine/action rankings. Consider reducers only if repeated aggregation/order materially contributes; request-local facets only if qualification repeats; bounded preparation only if warm preparation dominates. If transport/rendering dominates, report that rather than forcing an engine patch.
- [ ] Write exactly one proposed experiment brief: hypothesis, eligible shapes, fallback, proposed files, removed work, correctness tests, failure/invalidation behavior and matched uninstrumented acceptance runs. Preserve original-order sums, stable temporal ties, nonwinning-row errors and full-universe requalification.
- [ ] For a cache route, explicitly specify dependency identity, invalidation, admission/accounting, eviction/disposal and retained-state ceiling in a separate design for approval. For a new protocol route, stop at the recommendation and request separately scoped design.
- [ ] Read qualification correctness evidence before recommending integration. Record unmet gates as pending; do not call a profile recommendation production-ready.
- [ ] Run `node --test scripts/pivot-qualification/rank-profile.node.mjs`; independently review the measured assessment and produce the concrete next optimization plan. Commit analysis tools and small findings document; keep large traces external.

## Acceptance and handoff

Completion means the measured evidence is attributable, relevant controls pass, uncertainty/refusals are explicit, and the next experiment is justified—or 'retain baseline' is justified. It does not mean an optimization has shipped. Relevant v4 correctness gates still apply to the subsequent experiment and final production-equivalent browser/device acceptance.

Self-review: design workload/measurement sections -> P1–P3; candidate selection/integration -> P4 and subsequent measured experiment plan; all five review-focus risks have explicit tests. No production changes or qualification-runner ownership conflicts are authorized by this document.
