# Rust Pivot Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace local analytical table execution with a portable Rust/Wasm engine while preserving v4 behavior and defining an SSRM-ready provider contract.

**Architecture:** A framework-independent Rust crate owns analytical semantics and result sessions. A single-threaded Wasm worker integrates with the existing TypeScript TableExecutor; the existing React renderer stays in place. Future SSRM providers consume the same versioned definition and result contract, with separate remote acquisition.

**Tech Stack:** Rust, serde, wasm-bindgen, TypeScript, Vite, Vitest, Playwright; existing Tauri 2 shell. No DuckDB dependency. Keep the new portable crate separate from src-tauri so Wasm does not depend on native platform packages.

**Spec:** ../specs/2026-10-13-rust-pivot-foundation-design.md

## Global Constraints

- Baseline is Adventures-OpenBQ/bdobb at 74cc3f6c4c718cd76044722b954a7bc0761c8866; the local documentation commits sit above it.
- Run that core as WebAssembly in a Web Worker for Tauri desktop, browser builds and iPad Safari.
- Require no Wasm threads or SharedArrayBuffer for baseline operation.
- Preserve saved definitions through an adapter; users must not recreate tables.
- The first wire version supports Unicode scalar strings and explicitly refuses unpaired UTF-16 surrogates at input/authoring boundaries without normalization. Formerly accepted JavaScript edge inputs are a deliberate documented compatibility limitation; unrestricted JavaScript string parity is not claimed. Task 8 must enforce codec/worker input preflight.
- Unsupported operations must never silently fall back to calculation over loaded row blocks.
- Totals re-evaluate operations against relevant source identities.
- Production backend/SSRM providers, SQL translation, DuckDB acceleration, native desktop transport and Rust DOM rendering are subsequent work.
- Desktop WebKit automation supplements but does not replace iPad device testing.
- Start from v4 and preserve the contract as later versions evolve; iPad engine support is not deferred to v7. Do not claim compatibility with uninspected future release code.
- Follow repository license/header and notices checks; generated Wasm is ignored and built reproducibly, not committed.

## Review Focus

- Mixed value types and absent versus null values must round-trip without changing identities (Task 2).
- Locale text sorting, identical dates and duplicate source IDs must retain deterministic baseline behavior (Tasks 1 and 3).
- A failed new model must not publish a partial schema or corrupt the active result revision (Task 7).
- Worker failure or iPad background/resume must not leave pending requests or obsolete selections attached to a replacement session (Tasks 8 and 12).
- A paged provider with an unsupported operation or expired snapshot must refuse explicitly, rather than compute a plausible result from fetched pages (Task 9).

## File map and dependency boundaries

Create `crates/pivot-core/` with its own Cargo.toml/Cargo.lock; modules contract, validation, ordering, pivot, formulas, categories, fiscal, scopes, analytical, statement, session, inspection, authoring and witness. Each owns its corresponding baseline semantic module; split large modules into submodules rather than reproduce a monolith. Its tests consume versioned portable fixtures.

Create `crates/pivot-wasm/` with a path dependency on pivot-core and a separate locked manifest. Its lib.rs only converts wire values, calls core functions and exports the session bridge. Keep wasm-bindgen CLI and crate versions equal; record toolchain/CLI pins in `scripts/pivot-toolchain.json` during Task 2 after compiling the smoke fixture. Both manifests use edition 2021, matching the baseline; no root Cargo workspace or changes to src-tauri dependencies are required.

Create `src/lib/tableExecution/rust/` for wireCodec.ts, providerContract.ts, runtime.ts, rust.worker.ts and providerFactory.ts. Existing workerClient.ts retains correlation, restoration and backpressure behavior. Existing table.worker.ts remains the explicit TypeScript rollback path. Do not silently select it after Rust failure.

Create test fixtures at `src/test/fixtures/rust-pivot/`, baseline generation/comparison utilities under `src/lib/tableExecution/rust/`, a Node fixture exporter in `scripts/export-pivot-fixtures.mjs`, and build tooling in `scripts/build-pivot-wasm.mjs`. Add a dedicated browser harness at `e2e/fixtures/rust-pivot-harness.tsx`.

## Common task cycle

Every task below follows the listed red/implementation/green steps and ends with a scoped commit. Before execution, use using-git-worktrees to obtain an attached managed worktree based on the approved candidate/documentation commits; do not implement inside this temporary review clone. Copy the reviewed spec and plan into that worktree if necessary. Check applicable AGENTS.md and CodeGraph presence before code exploration.

Numeric comparison policy: exact structural/value comparison by default. For finite mean and derived floating-point arithmetic use `abs(a-b) <= max(1e-12, 1e-12 * max(abs(a),abs(b)))`; errors, missing/null, counts, member keys, IDs and order remain exact. Preserve accumulation order for sums initially and require exact sums; do not excuse different semantics with a blanket tolerance. Add cancellation-heavy and near-zero tests before approving any additional tolerance.

### Task 1: Capture the baseline semantic oracle

**Files:** Create rust/oracle.ts, rust/oracle.test.ts, scripts/export-pivot-fixtures.mjs and src/test/fixtures/rust-pivot/*.json; modify tableExecution/testContract.ts only to expose reusable cases. Read existing tableModel, statementModel and execution fixture/test suites.

**Interfaces:** `captureBaseline(c: OracleCase): OracleResult`; `compareOracle(actual: OracleResult, expected: OracleResult): Difference[]`. OracleCase contains dataset, definition, selection, runtime parameters, locale and an ordered operation trace. OracleResult includes output metadata, rows, totals, selections, facets, inspection, preview, authoring and linked/export results, stripping only request IDs and transport timing.

- [ ] Write tests `page_size_invariant`, `ratio_total_uses_source_scope`, `typed_blank_roundtrip`, `same_date_tie_is_stable`, `duplicate_identity_matches_baseline` and `member_errors_remain_distinct`; assert reversed block delivery for sizes 1, 2 and 50 gives identical logical results and total ratio differs from a sum of displayed ratios.
- [ ] Run `pnpm exec vitest run src/lib/tableExecution/rust/oracle.test.ts`; confirm new oracle assertions fail before the utilities exist.
- [ ] Implement capture/comparison and export reviewed expected results using the baseline evaluator. Include legacy Pivot, analytical models, Pivot off, fiscal/Statement evidence, linked definitions, Page/runtime groups, all aggregation operators and authoring traces. Store extended values using the Task 2 portable wire shape. Never regenerate fixtures automatically during parity tests.
- [ ] Run the oracle tests and existing `contractFixtures.test.ts`; review each fixture's semantic expectation rather than accepting generated output blindly. Commit `test: capture Pivot migration oracle`.

### Task 2: Define portable values and boot a locked Wasm artifact

**Files:** Create both Rust manifests/locks, pivot-core/src/{lib,contract,validation}.rs, pivot-wasm/src/lib.rs, pivot-core/tests/wire.rs, rust/{wireCodec,wireCodec.test}.ts, scripts/{build-pivot-wasm.mjs,pivot-toolchain.json}; modify .gitignore, package.json and notices inputs.

**Interfaces:** `WireValue` uses explicit tags for missing, null, bool, string, f64 and bigint-string, recursively including arrays/records. Omission remains omission; tagged missing is not null. `encodeWire(value: unknown): WireValue` and `decodeWire(value: WireValue): unknown` reject accessors and unsupported objects before conversion. `validate_definition(raw: &WireDefinition) -> Result<ValidatedDefinition, Diagnostic>`; protocol version starts at 1, analytical saved schema stays at its existing version.

- [ ] Write round-trip tests asserting undefined is distinct from null, bigint `9007199254740993n` survives exactly, `__proto__` is an ordinary field, arrays retain missing entries, and accepted nonfinite values retain baseline rejection semantics when used in arithmetic. Assert getters are never invoked and unknown versions refuse.
- [ ] Run new Vitest wire tests and `cargo test --manifest-path crates/pivot-core/Cargo.toml --test wire`; confirm failure before implementation.
- [ ] Implement wire codec, typed definitions, diagnostics and Rust validation; do not use untyped JSON as the evaluator's internal model. Implement Wasm `protocol_version() -> u32` returning 1. Select installed stable Rust and compatible released wasm-bindgen pins, record exact versions, and build with `wasm32-unknown-unknown` and wasm-bindgen `--target web`. Generated output goes to ignored `src/lib/tableExecution/rust/generated/`.
- [ ] Run both wire suites, locked Cargo tests and `pnpm pivot:build`; assert the emitted module initializes and reports version 1. Commit `feat: add portable Pivot contract and Wasm build`.

### Task 3: Port ordering and legacy Pivot

**Files:** Create pivot-core/src/{ordering,pivot}.rs and tests/legacy_pivot.rs; add rust/orderingBridge.ts and orderingBridge.test.ts. Baseline references: pivotTable.ts, pivotKeys.ts, pivotConfig.ts, periodicity.ts and tableFiltering.ts.

**Interfaces:** `pivot(input: &PivotInput, order: &dyn ValueOrder) -> Result<Option<PivotResult>, Diagnostic>`; `ValueOrder::compare(&self, a: &WireValue, b: &WireValue) -> Ordering`. `LocaleOrderBridge` supplies the baseline Intl.Collator semantics inside the worker without evaluating formulas in JS. Locale is explicitly captured when the session is opened; a future native adapter must implement equivalent ordering or refuse that capability.

- [ ] Add oracle-driven tests for every aggregation, blanks, dates, same-date ties, string-normalized distinct count, typed group paths, date buckets, totals and split-only results. Assert 500 Pivot columns is accepted and 501 refused, matching MAX_PIVOT_COLUMNS. Add numeric locale ordering test `item2` before `item10` and baseline accented-text ties.
- [ ] Run `cargo test --manifest-path crates/pivot-core/Cargo.toml --test legacy_pivot` and the new ordering bridge tests; confirm failure.
- [ ] Port missing-value, stable ordering and grouping semantics, retaining original ordinals for ties. Batch collation work or cache comparisons to bound JS/Wasm crossing costs; measure it in Task 12. Preserve output IDs and metadata exactly.
- [ ] Run legacy oracle parity and pivotTable/pivotKeys/pivotConfig baseline tests; commit `feat: port legacy Pivot semantics to Rust`.

### Task 4: Port formula compilation and source evaluation

**Files:** Create pivot-core/src/formulas/{mod,syntax,binding,graph,source}.rs and tests/formulas.rs. Reference tableModel/formulaSyntax, formulaBinding, formulaGraph and formulaEvaluation.

**Interfaces:** `compile(model: &ValidatedDefinition, columns: &[Column]) -> CompiledModel`; `evaluate_source(rows: &[DatasetRow], model: &CompiledModel) -> EvaluatedRows`; `bind_formula(model: &CompiledModel, draft: &FormulaDraft, bindings: &[ScopedBinding]) -> FormulaBindResult`.

- [ ] Write tests asserting cycles/ambiguous references and blocked dependencies match oracle diagnostics; `1/0` reports division-by-zero; blanks/text in arithmetic report invalid-type; IF evaluates only its selected branch and requires a boolean. Port parser byte/node/depth/nesting limits from existing validation without widening them.
- [ ] Run `cargo test --manifest-path crates/pivot-core/Cargo.toml --test formulas`; confirm failure.
- [ ] Implement bound AST compilation, syntax/binding for authoring, dependency checks and source expressions; preserve missing-reference and nonfinite distinctions.
- [ ] Run formula fixtures and baseline formula tests; commit `feat: port bound formulas and source evaluation`.

### Task 5: Port category eligibility, fiscal resolution and member scopes

**Files:** Create pivot-core/src/{categories,fiscal,scopes}.rs and tests/scopes.rs. Reference tableModel/categories, fiscalContext, facets, groupResolution, pivotParams and tableExecution/runtimeParams.

**Interfaces:** `eligible_pool(input: &EvaluatedRows, model: &CompiledModel, params: &RuntimeParams) -> EligiblePool`; `resolve_member(pool: &EligiblePool, scope: &CalculationScope, selectors: &[MemberSelector]) -> Result<CalculationScope, Vec<ModelError>>`; `member_domain(pool: &EligiblePool, request: &MemberDomainRequest) -> MemberDomainResult`.

- [ ] Add oracle tests for mixed fiscal year ends, stub periods, missing authoritative evidence, excluded/missing/no-counterpart members, empty Page choice, typed group matches and runtime constraints with Pivot disabled. Assert category resolution retains source identities and declared context.
- [ ] Run `cargo test --manifest-path crates/pivot-core/Cargo.toml --test scopes`; confirm failure.
- [ ] Port eligibility and fiscal/member semantics with existing request/projection budgets and warning evidence. Never default absent fiscal metadata to December.
- [ ] Run scope/fiscal/runtime fixture parity; commit `feat: port fiscal and member scope resolution`.

### Task 6: Port analytical measures, totals and Statement calculations

**Files:** Create pivot-core/src/{analytical,statement}.rs, formulas/aggregate.rs and tests/{analytical,statement}.rs. Reference tableModel/calculate, totals, resultFilters, measures, unpivot and statementModel/compile, linePolicy and rollups.

**Interfaces:** `calculate_view(input: &Dataset, definition: &ValidatedDefinition, selection: &SelectionSpec, params: &RuntimeParams, order: &dyn ValueOrder) -> Result<CalculatedView, Diagnostic>`; `calculate_totals(pool: &EligiblePool, scope: &CalculationScope, model: &CompiledModel) -> ScopedValues`. Internal CalculatedView is never directly serialized to the UI.

- [ ] Write parity tests for measures/source and aggregate formulas, scoped result qualification, Page/checklists, unpivot descriptors, per-group ratios and recalculated totals. Add Statement tests for flow versus stock policy, required missing lines, derived lines, fiscal evidence and mixed-context refusal.
- [ ] Run both new Cargo integration tests; confirm failure.
- [ ] Port full calculation orchestration, Statement compilation and evaluation, count metadata and provenance. Preserve baseline evaluation order and identity deduplication; do not approximate totals from visible output.
- [ ] Run complete analytical and Statement fixture parity; commit `feat: port analytical and Statement calculation pipeline`.

### Task 7: Implement revisioned result sessions and all result consumers

**Files:** Create pivot-core/src/{session,inspection,authoring,witness}.rs and tests/session.rs. Reference resultStore, selection, subsetTransfer, inspection, formulaAuthoring and identityWitness.

**Interfaces:** `Session::new(locale: String, limits: ResourceLimits) -> Session`; `Session::register(input: Dataset, revision: u64) -> Result<(), Diagnostic>`; `Session::dispatch(request: CoreRequest, order: &dyn ValueOrder) -> CoreResponse`. CoreRequest/CoreResponse implement every existing ExecutionRequest/ExecutionResponse operation through the Task 2 wire contract. Exports expose explicit transfer IDs and next-batch requests, not an eager full export.

- [ ] Write tests for reversed nested row blocks, scoped selection/allMatching, totals/facets/chart data, authoring preview/member domains, inspection truncation and identity witnesses. Assert a failed new definition leaves the last published revision usable; requests for failed/old revisions refuse, and schema never changes before atomic publication.
- [ ] Run `cargo test --manifest-path crates/pivot-core/Cargo.toml --test session`; confirm failure.
- [ ] Implement session ownership, atomic candidate publication and all existing consumer operations. Port exact limits from validators, runtimeParams, formulaAuthoringProtocol and subsetTransfer. Preserve the 32-transfer ceiling, 1200 visible-selection/identity budget and existing bounded evidence projections. Add injectable resource limits for input admission and cache/export bytes rather than guess hardware ceilings.
- [ ] Run session tests and oracle operation traces; assert disposal releases handles/transfers and cannot be reused. Commit `feat: add revisioned Rust result sessions`.

### Task 8: Connect the Rust worker with explicit lifecycle and failure handling

**Files:** Extend pivot-wasm/src/lib.rs; create rust/{runtime,rust.worker}.ts and runtime.test.ts; modify workerClient.ts only for worker initialization/handshake hooks; preserve existing TypeScript worker.

**Interfaces:** Wasm exports `open_session(options: WireSessionOptions) -> u32`, `dispatch(handle: u32, request: WireRequest) -> WireResponse` and `close_session(handle: u32)`. `loadRustRuntime(): Promise<RustRuntime>` exposes these methods. `createRustExecutor(widgetId: string, factory?: () => Worker): LocalWorkerExecutor` reuses the existing worker client with rust.worker.ts. No native Tauri dependency is imported into this worker.

- [ ] Write tests for loading failure, protocol mismatch, trap, malformed response, cancellation while applying, disposal during initialization and generation-safe restart. Assert every pending promise settles on worker loss and stale generation messages cannot change selection or schema.
- [ ] Run runtime tests and workerClient.test.ts; confirm the new cases fail.
- [ ] Initialize Wasm once per worker; queue validated requests until ready; keep file parsing in worker-side TypeScript where necessary. Wire collation through Task 3. Abort invalidates publication; hard cancel terminates the worker and restores only the last committed input/model through existing hydration behavior. Do not promise interruption inside a synchronous Wasm call.
- [ ] Run worker tests plus oracle traces using a real compiled Wasm instance; commit `feat: integrate Rust table worker`.

### Task 9: Specify and test the SSRM provider contract

**Files:** Create rust/{providerContract,providerContract.test,remoteProviderFixture}.ts; add pivot-core/tests/provider_contract.rs; modify tableExecution/types.ts with compatible provider descriptors, leaving existing renderer-facing signatures intact.

**Interfaces:** `ExecutionProvider.open(source: SourceBinding, options: SessionOptions): Promise<ProviderSession>`; `SourceBinding = {kind:'local',input:WidgetDataset,inputRevision:number} | {kind:'remote',sourceId:string,snapshotId:string}`. ProviderSession contains sessionId, protocolVersion:1, capabilities and a TableExecutor-compatible result interface. Local-specific import/schema methods stay on LocalWorkerExecutor. Backend snapshot binding is specified and exercised only by the test double.

- [ ] Write tests asserting page sizes 1/2/50 and reversed delivery return identical schema/totals, columns include unloaded split members, stable IDs survive windows, unsupported capabilities refuse before apply, expired snapshots return explicit errors and unknown counts are never represented as exact zero.
- [ ] Run providerContract tests and Rust provider-contract tests; confirm failure.
- [ ] Define capability preflight, opaque snapshot/result identity and explicit unavailable-count/snapshot-expiration protocol representation. Keep exact local counts in the existing adapter; unavailable counts require an explicit refusal there until a future renderer supports them. Implement the deterministic test double over a complete fixture, never using the fetched page as calculation input.
- [ ] Run conformance against Rust local sessions and remote fixture; commit `feat: define SSRM-ready provider contract`.

### Task 10: Integrate application selection and prove unchanged table behavior

**Files:** Create rust/providerFactory.ts and providerFactory.test.ts; modify stores/tableExecutionStore.ts; extend existing store/runtime and TableRenderer.execution tests without rewriting TableRenderer.tsx.

**Interfaces:** `createTableProvider(widgetId: string, engine: 'typescript' | 'rust'): LocalWorkerExecutor`. An explicit developer/test engine override chooses the reference provider during rollout; initialization errors never silently switch engines. Production default stays TypeScript until Task 12 acceptance.

- [ ] Add tests proving each provider preserves saved definitions, linked baseline reconciliation, table commit ordering, previews, group parameters, selection, chart/export and inspection. Assert engine failure surfaces a recoverable error rather than producing a partial table.
- [ ] Run providerFactory tests, tableExecutionStore.runtime.test.ts and TableRenderer.execution.test.tsx; confirm new integration failures before wiring.
- [ ] Inject createTableProvider into the existing store factory; preserve saved model authority and downstream subset semantics. Keep renderer, CSS and application persistence contracts unchanged.
- [ ] Run affected store/renderer and local-table tests with both explicit provider choices; commit `feat: connect Rust provider to table execution store`.

### Task 11: Package Wasm for desktop, browser and browser conformance

**Files:** Modify vite.config.ts, package.json, scripts/build-web.mjs, .github/workflows/ci.yml and scripts/browser.mjs as needed; create e2e/rust-pivot.spec.ts, e2e/fixtures/rust-pivot-harness.tsx and playwright.pivot.config.ts.

**Interfaces:** `ensurePivotWasm(): Promise<void>` in scripts/build-pivot-wasm.mjs is called from a Vite build/dev plugin so direct Vite, Tauri, browser and web packaging all build or verify the pinned artifact. Release builds fail on missing/stale artifacts. Import generated wasm with Vite's asset URL mechanism; initialize from emitted URL and ship all assets locally.

- [ ] Write browser tests that initialize the worker from built assets without network CDN, SharedArrayBuffer or cross-origin isolation; run contract traces and disposal. Add tests for base-path asset resolution and packaged web asset response/MIME handling. Assert rust.worker's reachable calculation graph excludes the TypeScript evaluator.
- [ ] Run `pnpm exec playwright test --config playwright.pivot.config.ts`; confirm failures before packaging.
- [ ] Add Rust/Wasm build jobs with pinned toolchain and CLI; preserve existing native Cargo job and notices checks. Add dedicated Chromium and WebKit projects for Pivot without changing unrelated suite defaults. Validate the private web server's asset route, cache and Wasm MIME behavior as well as Vite dev.
- [ ] Run `pnpm build`, `pnpm build:web`, `pnpm test:web`, `pnpm test:web:browser`, the dedicated browser tests and existing pivot-drawer/pivot-table-frame tests. Verify the Tauri packaged app loads Wasm under its actual CSP/protocol. Commit `build: package portable Pivot worker across platforms`.

### Task 12: Measure limits, validate real iPad and activate Rust

**Files:** Create scripts/benchmark-pivot.mjs, e2e/rust-pivot-resources.spec.ts and docs/releases/validation/rust-pivot/{acceptance.md,measurements.json}; modify resource-limit defaults and providerFactory.ts only after acceptance evidence.

**Interfaces:** `ResourceLimits` includes maxInputBytes, maxRows, maxPivotColumns, maxBatchBytes, maxCachedBlockBytes and maxConcurrentTransfers; byte accounting includes encoded payloads and an explicit conservative estimate for internal state. Preserve existing semantic/protocol limits. New defaults are selected from measured supported-device budgets, recorded with device/OS/browser/dataset/toolchain details; engine limit enforcement stays testable via injected small limits.

- [ ] Write resource tests with tiny injected limits asserting input refusal, wide-output refusal, bounded export/backpressure and no partial publication. Add stale-result tests during rapid edits and recovery after background/resume or worker replacement.
- [ ] Run resource tests; confirm missing enforcement fails before choosing defaults.
- [ ] Benchmark representative small, large, wide, mixed-type, fiscal and formula-heavy fixtures for initialization, calculation, repeated edits, input conversion, collation crossings, peak observable memory and transfer costs. Record the measurement method; do not present unavailable Safari process memory as an exact measurement. Set admission/cache defaults conservatively from supported iPad measurements and assert boundaries in tests.
- [ ] Run on a real iPad Safari device: import, grouping/splits, source/member formulas, fiscal totals, filters, rapid edits, selection, chart/export, touch navigation and background/resume. Record evidence or leave default activation blocked; desktop WebKit is insufficient. Confirm Safari touch/CSS behavior through existing references.
- [ ] Run `cargo test --locked --manifest-path crates/pivot-core/Cargo.toml`, `pnpm typecheck`, `pnpm lint`, `pnpm test:run`, dedicated Chromium/WebKit tests, relevant existing Pivot/table e2e, web packaging checks and native Tauri build/smoke. Full runs are completion gates, not repeated after every task.
- [ ] Compare baseline and Rust evidence, document accepted floating-point differences, confirm every spec requirement has a passing check, then change the production provider default to Rust. Keep explicit rollback selection until a separately reviewed cleanup. Commit `feat: activate validated Rust Pivot execution`.

## Completion and handoff

No product implementation has begun. Tasks depend on preceding contracts; perform semantic parity review before integrating the worker, and whole-branch review before activation. Resource targets and real-device evidence are explicit activation gates, not permission to claim iPad readiness prematurely. If real-device access is unavailable, finish unaffected development and report that activation remains pending.

The next stage is a separate Rust DOM-renderer design using this same provider interface. Native/server execution and a production SSRM provider are also separate stages; the new core can start on v4 and persist through later releases without changing the user-facing analytical definition.

### Task 10 serialized AST compatibility boundary

Protocol 1 refuses unknown or malformed serialized formula AST kinds as unsupported
IR. Some corrupt saved ASTs formerly yielded TypeScript partial independent cells;
Rust refuses that whole candidate recoverably, retains authored intent and any prior
successful publication when input is unchanged, and supports repair without source
reacquisition. Known AST shapes with missing references, cycles or formula type errors
retain supported diagnostic and independent-output semantics. This exception adds no
business fallback, AST rewriting or calculation over fetched result pages.
