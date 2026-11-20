# Pivot Test Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native execution, or superpowers:subagent-driven-development if selected. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish reproducible v4 financial and linked-widget correctness gates and an advisory performance qualification program.

**Architecture:** Extend existing goldens, executor contracts, worker and browser fixtures. Keep independent financial references separate from TS/WASM differential checks. Commit small fixtures and tests; checksum large external inputs and reports.

**Tech Stack:** TypeScript/Vitest, Rust 1.98.1, wasm-bindgen 0.2.128, Playwright Chromium/WebKit, existing Tauri app and SEC acquisition/Decimal verification scripts.

**Spec:** `docs/superpowers/specs/2026-11-03-pivot-test-program-design.md` (approved by user).

## Global Constraints

- Target `release/v4`; TS and Rust/WASM production fixes remain in separate PRs; never merge automatically.
- Correctness failures block v4 qualification; performance initially advisory.
- No resource-limit increases or unrelated market-calendar changes.
- Preserve `none`/Clear -> all eligible rows, explicit `[]` -> zero rows; removed nonempty identities retain existing reconciliation.
- Keep credentials, SEC contact email and large generated/vendor data outside Git.
- Bulk SEC analytical stress and certified Statement performance are distinct workloads.
- Every result names source commit, artifact fingerprint, dataset checksum and environment; unrun is never passed.
- Use isolated build targets and sequential performance runs; never reuse uncertain Cargo artifacts.
- Use existing dependencies; no new property-testing framework is required.

## Review Focus

- Missing series after a company switch must not leave an old figure apparently current (Task 4).
- Retrying a late transfer after disposal/remount must not publish into the new generation (Task 5).
- As-of filing selection must not add amended and original facts together (Task 2).
- Changed line labels must invalidate/rebuild the pinned chart allowlist rather than silently omit intended USD data (Task 4).
- Session-only viewer filters must reset on reopen while durable authoring state survives (Task 6).

## Source baseline and file responsibilities

Use the actual PR #25 head containing e858d619 plus its #22/#23 dependencies, or merged release/v4 equivalents. Resolve exact refs at execution start and record them. Never apply patches to the unrelated dirty scopes.rs worktree. Use an isolated workspace and confirm its AGENTS/CodeGraph rules before locating code.

Existing coverage inspected: `src/lib/statementModel/{linePolicy,missingLines,coverage,periodSelectors,rollups,persistence,updates}.test.ts`; `src/lib/tableExecution/{subsetTransfer,persistence,linkedAnalytical}.test.ts`; `src/lib/tableExecution/rust/{session,oracle,providerContract}.test.ts`; `src/lib/tableExecution/remote/consumers.test.ts`; `crates/pivot-core/tests/{session,statement,resources}.rs`; `e2e/{statement-model,statement-contexts,pivot-viewer,dashboard-sync,rust-pivot,rust-pivot-resources}.spec.ts`.

Research inputs live outside Git at `/Volumes/Builds/openbq-benchmarks/sec-fsds-2025q1`. Their `statement-reference`, `statement-mapped-companies` and `statement-linked-proof` folders are evidence to adapt, not tests to copy with hard-coded developer paths.

New shared test interfaces belong in `src/lib/tableExecution/testing/`; browser fixture generation belongs under `e2e/fixtures/sec-statements/`; reports/benchmarks under `scripts/pivot-qualification/`. No production refactoring is planned merely to organize tests.

## Task 1: Coverage inventory and portable reference corpus

**Files:** Create `docs/testing/pivot-qualification-matrix.md`, `src/test/fixtures/sec-statements/{manifest,reference,expected,trace}.json`, and `scripts/pivot-qualification/verify-fixtures.mjs` plus `verify-fixtures.node.mjs` (Node tests explicitly invoked with `node --test`, not Vitest `.test.mjs`).

**Interfaces:** Manifest format 1 lists relative fixture paths, SHA256, source accession/URL, exact report periods, mapping version and numeric policy. `verifyFixtures(root: string): Promise<{files: number; rows: number; expectedCells: number}>` checks local committed files only; no downloads in PR tests. Builder chooses splitting of per-company JSON but preserves this interface.

- [ ] Inventory existing named assertions against spec sections A–G; mark existing/new, tier and required environment. A filename alone is not coverage evidence.
- [ ] Extract only the small 98-fact/110-cell reference corpus, source traces and six explicit mapping records. Avoid self-referential manifest hashing; checksum payloads, not manifest itself.
- [ ] Write `rejects_corrupted_payload_and_unknown_mapping_version`: altered payload fails verification; unchanged corpus yields `{rows:98, expectedCells:110}`. Verify no literal contact email or absolute developer paths.
- [ ] Implement verification with Node built-ins; preserve Decimal strings and original context IDs. Source XML checksums/URLs are provenance, not a requirement to fetch large XML in every CI run.
- [ ] Run `node --test scripts/pivot-qualification/verify-fixtures.node.mjs`; expect all pass. Commit corpus, matrix and verifier as one reviewable change.

## Task 2: Independent financial boundary cases

**Files:** Extend existing Statement tests and `crates/pivot-core/tests/statement.rs`; create `src/lib/statementModel/qualification.test.ts` and small clearly labeled synthetic cases under `src/test/fixtures/sec-statements/edge-cases.json`.

**Interfaces:** Each edge case contains `name`, source/definition, independent expected numeric cells and/or expected error code plus affected source IDs. Never generate expected results from the candidate engine.

- [ ] Map existing tests to missing cases before adding duplicates.
- [ ] Add assertions: `missing_is_not_zero`; `distinct_id_duplicate_is_refused`; `same_source_identity_is_not_double_counted`; `mixed_company_and_currency_refuse`; `annual_quarter_overlap_refuses`; `fifty_three_week_flow_and_stock_endpoints`; `single_period_eps_refuses_rollup`.
- [ ] Add `amendment_asof_chooses_one_filing`: pre-amendment cutoff selects original, later cutoff selects amendment, and neither sums both. This tests fixture selection policy outside the pivot evaluator; no new production acquisition feature is implied.
- [ ] Require exact safe integers; fractional cases state operation-specific tolerance in fixture metadata. Flag values outside conversion policy. Assert formulas distinguish reported from calculated lines and missing dependencies propagate.
- [ ] Run `pnpm exec vitest run src/lib/statementModel`; then `CARGO_TARGET_DIR=<isolated> cargo +1.98.1 test --locked --manifest-path crates/pivot-core/Cargo.toml --test statement`. Record first-run outcomes. Where a bug is exposed, retain its failing test before any fix.
- [ ] Commit tests; put required TS and Rust product fixes on separate branches/PRs with the same evidence IDs.

## Task 3: Seeded action-trace parity

**Files:** Create `src/lib/tableExecution/testing/{actionTrace,wasmExecutor}.ts`, `src/lib/tableExecution/qualificationParity.test.ts`, and `src/test/fixtures/sec-statements/failing-traces/` only when a real failure is minimized.

**Interfaces:** `runTrace(create:()=>Promise<TableExecutor>, fixture:TraceFixture, actions:TraceAction[]):Promise<TraceObservation[]>`; `generateTrace(seed:number, steps:number):TraceAction[]`; `createWasmTestExecutor():Promise<TableExecutor>`. `TraceFixture` holds WidgetDataset, TableDefinition, SelectionSpec. Actions: apply definition, select action, replace source, rows, presented and chartData; generated operations include filter/sort/group/split via apply. Observation retains public cells/errors, identities/order, subsets, completeness and provenance.

- [ ] Reuse `createPureExecutor` from `testContract.ts` and the in-process actual-WASM worker-handler pattern in `rust/providerContract.test.ts`. Match host locale. Dispose every executor.
- [ ] Unit-test trace revision rules: register increments input; every applied model increments model/output. Selection actions return a selection to apply at a newer revision; do not assume `selection()` mutates the immutable snapshot.
- [ ] Run seeds 1–20, 50 actions each in PR coverage. Extended mode runs seeds 1–200 plus an explicitly logged user-provided seed, 200 actions each. Bounds are initial builder choices, not product limits.
- [ ] Assert independent Task 2 outcomes as well as cross-engine equality. Include signed zero, typed member collisions, hidden selections and identities beyond the loaded page. Normalize request IDs only where transport-generated.
- [ ] Implement a replayable JSON trace and deletion-based reducer that preserves the same failure class; verify on a deliberately divergent test adapter, not by corrupting production code.
- [ ] Run `pnpm exec vitest run src/lib/tableExecution/qualificationParity.test.ts`; expect all fixed seeds pass. Commit helper, cases and reproducer mechanism.

## Task 4: Actual linked browser interactions

**Files:** Create `e2e/sec-linked-qualification.spec.ts`, `e2e/fixtures/sec-statements/{dashboard,fixtureBuilder}.ts`, `playwright.qualification.config.ts`; repair browser-only event shim alias in `vite.config.ts` if absent, with existing shim tests.

**Interfaces:** `buildSecDashboard():{dashboard:Dashboard; files:Record<string,string>}` reads Task 1 portable fixtures. The fixture contains fact hub -> Statement -> USD-only selected-line table -> chart, plus a raw-fact sibling. Reuse `seedApp`; assert browser `resolveTableEngine()` equals requested engine.

- [ ] Adapt the external research tests to portable imports, no absolute data paths. Test company switch and return, selected-line checkbox clicks, explicit-empty, clear/reset and excluded EPS selection using actual DOM actions and worker output.
- [ ] Add multi-company case: NVDA+GOOG gives 44 raw facts; FY2024 Revenue cell is a mixed-company scope error, not 410940000000. An old chart may remain only with an explicit stale/error indication and matching prior revision; successful empty scope removes old data.
- [ ] Add clear-company case: zero raw facts, no stale numeric chart; reset restores NVDA 30 facts and FY2024 Revenue 60922000000. Account for collapsed sections/virtualization before selecting rows.
- [ ] Change selected series availability and rename a pinned USD label. The fixture builder must regenerate the allowlist from the effective template; assert all intended USD labels are accounted for and EPS is excluded. This is fixture correctness, not general runtime unit validation.
- [ ] Verify sibling source drilldown uses original facts filtered by company, canonical line and exact period, rather than treating aggregate values as raw records.
- [ ] Run Chromium for `VITE_TABLE_ENGINE=typescript` and `rust` sequentially on dedicated ports, with `reuseExistingServer:false`; then WebKit via the new config. Each pass asserts zero unhandled page errors and captures public deliveries plus screenshot on failure.
- [ ] Commit portable tests and necessary browser-harness wiring; keep generic unit-guard features out of scope.

## Task 5: Delayed delivery, disposal and recovery

**Files:** Extend `src/lib/tableExecution/remote/consumers.test.ts`, `src/lib/tableExecution/subsetTransfer.test.ts`, `src/components/renderers/LinkedChartRenderer.test.tsx` and `e2e/rust-pivot-resources.spec.ts`; create `src/lib/tableExecution/testing/deferredTransport.ts` only if existing delay helpers cannot be reused.

**Interfaces:** Test-only `deferResponse(requestId:string):{release():void; reject(error:Error):void}` controls deliveries after real computation; never substitutes a mock financial result.

- [ ] Add `late_A_cannot_replace_completed_B`, `partial_subset_never_commits`, `disposed_generation_cannot_publish`, `new_input_invalidates_open_transfer`, and `missing_series_marks_old_figure_stale`.
- [ ] Delay A, complete B, release A; assert both visible figure and public revision remain B. Dispose/remount using reused widget IDs, then release an old response and assert the new generation is unchanged.
- [ ] Terminate an actual worker and test supported retry/reset; test malformed file, resource refusal and first versus replacement-publication failure. No unmarked stale figure or partial input is accepted.
- [ ] Run the focused Vitest files and the existing resource browser config. Reuse supported fault seams; add a test-only wrapper rather than production delay switches.
- [ ] Commit regression coverage and any narrowly required fixes separately by engine.

## Task 6: Persistence and platform qualification

**Files:** Extend `src/lib/statementModel/persistence.test.ts`, `src/lib/tableExecution/persistence.test.ts`, `e2e/dashboard-sync.spec.ts`; create `e2e/sec-linked-persistence.spec.ts` and `docs/testing/pivot-native-acceptance.md`.

**Interfaces:** Reuse Task 4 fixture; acceptance records identify exact commit, app artifact, OS/device and individual passed/failed/not-run items.

- [ ] Test save/reload/export-import of definitions, mappings, links, chart fields and durable authoring selections; preserve errors/provenance without private evaluator state.
- [ ] Test `viewer_session_filter_resets_on_reopen` independently of `authoring_selection_survives_reload`; verify files actually persisted, not just in-memory snapshots.
- [ ] Test missing/replaced local file, template version change and unavailable chart fields; assert explicit repair state.
- [ ] Run desktop Chromium/WebKit, 390px viewport, coarse-pointer and keyboard checks. Prove offscreen selected rows still reach the linked child.
- [ ] Execute native macOS Tauri checklist: import, worker recovery, restart, cross-window parameter propagation and appropriate viewer persistence. Other platforms remain not run until tested; manual steps require evidence, not automatic success.
- [ ] Commit tests/checklist and attach external device evidence.

## Task 7: Advisory scale runner and reporting

**Files:** Create `scripts/pivot-qualification/{benchmark.mjs,report.mjs,report.node.mjs,run-schema.json}` and `docs/testing/pivot-performance.md`.

**Interfaces:** `node scripts/pivot-qualification/benchmark.mjs --manifest <external-json> --engine typescript|rust --workload bulk|statement --output <external-dir>`. Output schema version 1 contains commit/artifact/dataset/environment identity, workload, stage timings, peak RSS, WASM buffer bytes where applicable, all observations and status `passed|failed|not-run|unsupported`. Timeouts/refusals are separate outcome details, not numeric timing successes.

- [ ] Unit-test report rejection of missing commit/checksum, stage mismatches and attempts to label a refused run successful. `node --test scripts/pivot-qualification/report.node.mjs` must pass outside Vitest/jsdom.
- [ ] Adapt existing SEC import and tick harnesses without embedded contacts or developer paths. Produce bulk manifests for 100k/1m/3658551 and independent certified Statement manifests; record representative-hash versus prefix sampling. Larger synthetic Statement data must be distinctly labeled and financially valid.
- [ ] Record parse/acquisition, registration/encoding, compute, filter/reselection, transfer, chart delivery/rendering and total usable-view timing. Browser runs measure interaction delays and process-tree memory with platform-supported samplers; annotate sampler interval and distinguish RSS peak from WASM linear-buffer size.
- [ ] Run five alternating baseline/candidate observations where feasible, cold and warm separately. No concurrent builds/benchmarks. Save all samples, median/range, refusals/timeouts and limitations. Repeated filter/reset cycles inspect post-warm-up retained growth without assuming WASM memory shrinks.
- [ ] Validate independent numerical outcomes appropriate to each workload; do not sum mixed SEC concepts/currencies as financial truth. Execute at documented limits and report unsupported scales without raising them.
- [ ] Commit runner/report schema and commands; keep input data and large results external. Performance remains advisory regardless of relative speed.

## Task 8: CI tiers and release evidence

**Files:** Modify `.github/workflows/ci.yml`; create `.github/workflows/pivot-qualification.yml`, `scripts/pivot-qualification/release-report.mjs` and `docs/testing/pivot-release-qualification.md`.

**Interfaces:** Release report consumes Task 7 schema plus coverage-matrix requirement IDs. Output gives each required correctness item one of passed/failed/not-run/unsupported and an overall qualification decision; advisory performance cannot mask missing correctness evidence.

- [ ] Add small fixture verification/fixed parity/linked smoke to existing PR checks without removing current coverage or downloading SEC data. Explicitly invoke standalone Node suites; avoid the earlier Vitest `.test.mjs` collection problem.
- [ ] Extended workflow starts with workflow_dispatch and a scheduled bounded suite; explicit expensive data/device runs remain separate. Pin candidate ref and upload failing seeds/traces with retention. Schedule cadence/resource budgets are builder choices recorded in the workflow.
- [ ] Add report assertions: failed correctness blocks; missing required native evidence blocks qualification; environment failure is incomplete; performance slowdown alone is advisory; documented unsupported negative-capability cases pass only their refusal assertions.
- [ ] Run workflow validation, relevant commands and dry-run aggregation with missing/failing evidence. Do not claim native tests passed from a Linux CI job.
- [ ] Commit tier wiring and release checklist. Publish TS/test-infrastructure and Rust fixes separately targeting release/v4; request review and report CI before any merge decision.

## Self-review

Spec A -> Task 2; B -> Task 3; C -> Tasks 4–5; D -> Task 6; E -> Task 5; F -> Task 7; G -> Task 6; tiers/evidence -> Tasks 1/8. All five Review Focus items have explicit tests. Shared interfaces use existing TableExecutor and validated subset-transfer semantics. The existing explicit-empty fix belongs to PR #25, not a second copy. No implementation has started under this plan.
