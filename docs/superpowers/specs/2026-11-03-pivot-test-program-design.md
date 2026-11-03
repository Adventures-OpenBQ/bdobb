# Pivot, Statement and linked-widget test program

Date: 2026-11-03
Status: Proposed design; staged approach approved, this document awaiting approval.
Target: BDOBB release/v4, TypeScript and Rust/WASM.

## Intent and agreed approach

Protect financial correctness and linked-widget consistency while determining the practical scale of both engines. Correctness failures block v4 qualification. Performance measurements begin as advisory; resource refusal is acceptable only where the tested input exceeds a documented supported limit, and must not be recorded as successful execution at that scale.

Alternatives considered: run the entire matrix on every PR (slow feedback and high resource cost); retain research-only harnesses (weak regression protection); staged coverage (selected by the user). Stage small deterministic checks in PR CI, broader parity/browser coverage in a separately invoked or scheduled suite, and large-data/native-device evidence in release qualification. Scheduling implementation follows design approval; no desktop automation is requested.

## Current evidence and limits

The real SEC reference comprises six companies, 98 mapped facts and 110 verified numeric Statement cells. NVIDIA covers two fiscal years; the other companies cover one. Exact periods and mapped values were checked against original filing XML. This is correctness evidence, not a large Statement performance test.

The acquired 2025Q1 SEC financial-statement package has 3,658,551 raw facts. Preserve all source rows, duplicate keys, missing values, units, rounded bulk dates and filing versions. Bulk records are not automatically certified Statement inputs. Decimal and source-string references remain authoritative. Downloads and generated large artifacts stay outside Git, with checksummed manifests. SEC contact identification remains environment configuration and is omitted from public artifacts.

The linked demo exercises actual Chromium workers in both engines. It exposed an explicit-empty-selection bug fixed on PR #25 at e858d619. The temporary browser harness also needs an existing event-shim alias; treat harness setup separately from production fixes. A pinned-label USD allowlist protects the demo chart, but is not a general unit-validation feature.

## Test architecture

Maintain three independent layers:

1. Small committed, redistributable fixtures and independent expected financial outcomes.
2. Deterministic native/TypeScript/WASM execution and action-trace comparisons.
3. Actual browser-worker and native-app acceptance, including rendering and persistence.

Engine agreement alone is insufficient: both can share a bug. Golden cases use original XBRL/Decimal evidence or independently specified invariants. Reuse existing result-store, subset-transfer, worker and Playwright seams; do not replace them with a mock implementation of linking.

## Coverage and acceptance

### A. Financial semantics

Cover missing versus zero, negative values, duplicate facts with distinct IDs, duplicate row identities, amended filings, multiple currencies and units, mixed companies, annual/quarterly overlap, differing fiscal boundaries and 52/53-week years. Exercise flow accumulation, stock endpoints, single-period refusal, formula dependencies, optional lines and errors on required lines.

Use explicit filing/as-of selection for amendments; never combine original and amended facts as additional observations. Distinguish absent concepts, explicit mappings and derived lines. A calculated gross-profit line must not masquerade as a reported fact.

Safe integer monetary references must match exactly. Preserve Decimal reference strings for fractional quantities. Before adding a computed fractional case, specify its operation-specific absolute/ULP tolerance and why; do not apply a blanket percentage tolerance to financial totals. Values that fail the dataset's declared numeric conversion policy must be flagged or refused, not silently rounded into certified cases.

Expected refusal/error is a passing negative case only when the documented error kind, scope and affected identities match. Mixed-company cells must not silently sum. A company comparison requires a separate company dimension or separate single-company scopes; a single-company Statement cannot pretend to be a consolidated comparison.

### B. Differential and randomized parity

Run the same seeded source and operation trace in TS and WASM: filter, sort, group, split, select, unselect, clear, reset and change source. Compare public values/errors, row identities/order, selected subsets, completeness and provenance. Normalize only declared transport differences, not financial or selection differences.

Preserve explicit empty selection as zero rows; clear/no selection exposes all eligible rows. Reconciliation of removed nonempty identities retains its existing contract. Include the regression in PR CI.

Use bounded property-generated inputs with typed collisions, nulls and formula cases, plus real fixture traces. On failure save seed and complete action trace, then minimize to a small reproducer. Fixed seeds run in PR checks; broader rotating seeds run in the extended suite. Stable-ID and dependency semantics must be verified beyond the currently loaded viewport.

### C. Linked behavior and asynchronous publication

Cover multi-company selection, empty company filter, company/line switching back and forth, all/clear/reset, error-cell selection, excluded unit selection, missing chart fields and renamed template lines. Exercise chains and sibling consumers: raw facts -> Statement -> selected-value table/chart, with raw-source drilldown as a sibling that filters original company/line/period facts.

Inject delayed and out-of-order responses at transport seams. Include cancellation, disposal/remount and a new source revision arriving during an open subset transfer. Release delayed results after the newest result completes. Old deliveries must never become current.

A completed prior figure may remain only while explicitly marked stale/updating or failed; it must keep its matching schema, mapping and revision. Successful empty results remove old data. Invalid/error values must never be rendered as a current numeric result. Validate visible output and worker deliveries, not status flags alone.

For the pinned USD demo, rename/change a line and prove that a stale allowlist cannot admit non-USD data. Silent omission of a renamed USD line is recorded as a demo configuration failure, not as proof of correct chart behavior. General unit metadata/guards are a separately scoped product decision if required.

### D. Persistence and lifecycle

Save, reload, restart, and export/import the dashboard with local data present. Verify definitions, mappings, source links, chart fields and durable selections. Verify reset/default behavior and distinguish session-only viewer parameters from durable authoring state: session-only changes must not be asserted to survive restart.

Test missing/replaced local files, template version/label changes and unavailable chart fields. Preserve public provenance; do not persist private evaluator state or replay an upstream formula as executable child code. Cross-window tests must prove updates in both directions without changing viewer persistence rules.

### E. Failure and recovery

Terminate a worker, reject malformed input, cross documented row/column/byte limits, interrupt a subset stream and refuse acquisition. Cover first-publication and replacement-publication failures. No partial transfer becomes a completed input. A coherent previous result may remain with an explicit stale/error state. Retry/reset must recover without reopening the app where the supported lifecycle permits it.

### F. Scale and performance

Separate three workloads: (1) real bulk SEC ingestion/ordinary analytical stress at 100k, 1m and 3,658,551 rows; (2) progressively larger real certified Statement inputs, whose attainable size is reported rather than invented; (3) clearly labeled synthetic, financially valid Statement fixtures for cardinality stress beyond certified coverage. Never obtain a 'large real Statement' by blindly duplicating the 98 facts.

Use stable hashed samples for representative coverage and retain prefix samples for reproducibility, reporting each sampling policy. Include skew, high cardinality, missing values and duplicate-key observations. Do not use cross-currency/concept sums as financial correctness references for bulk analytical benchmarks.

Measure acquisition/parse, registration/encoding, preparation/calculation, filter/selection recalculation, linked transfer, chart-data delivery and rendering separately. Include total time to usable view, event-loop/input responsiveness, peak process RSS and WASM linear-buffer size. Linear-buffer size is not process peak memory. Include repeated switch/clear cycles to look for retained-memory growth after warm-up; do not assume memory buffers shrink after each query.

Pin source commit, generated artifact fingerprint, runtime/browser/OS/locale, hardware, limits and dataset checksums. Use isolated build directories, sequential runs without concurrent builds, fresh processes for cold measurements and explicit warm measurements. Start with five alternating baseline/candidate observations per feasible workload; if a workload is too expensive, report fewer observations as exploratory. Preserve all samples and report medians/range; do not present five observations as a reliable p95 estimate.

No performance threshold is a release gate initially. Report regressions, refusals and timeouts separately. After repeated baseline evidence, propose workload/device-specific budgets for approval. Do not raise resource limits merely to obtain a completed benchmark.

### G. Platform qualification

Run deterministic correctness on both engines, browser interactions in Chromium and WebKit, and native Tauri lifecycle/worker/import tests on the available macOS device. Add narrow viewport, touch/coarse pointer, keyboard navigation, scroll/virtualization and cross-window updates. Other operating systems/devices remain explicitly unqualified until run on them. Native manual acceptance uses a recorded checklist when reliable automation is unavailable.

## Execution tiers and release gates

PR tier: small financial goldens, fixed parity seeds, selection regression and a short linked-worker browser trace. Keep existing CI checks intact; select tests by demonstrated coverage rather than duplicating every browser action in every layer.

Extended tier: broader seeded parity, delayed-response/failure matrix, persistence and Chromium/WebKit scenarios. Make results attributable to the exact candidate commit. Do not treat a suite that did not execute as green.

Release tier: all correctness tiers, large workloads, native/device checklist and a consolidated evidence manifest. Correctness failures and missing required qualification evidence block release acceptance. Environment failures are distinct from product failures and still leave the required gate incomplete. Performance stays advisory. Tests for unsupported capabilities assert an explicit documented refusal.

## Order of work and deliverables

1. Inventory existing tests, freeze the reference fixtures and map every requirement to existing or missing coverage.
2. Add deterministic multi-company/empty-scope and lifecycle cases; keep new production fixes separate by TS versus Rust/WASM and target release/v4.
3. Add seeded parity/action traces and fault injection, then persistence and browser/platform coverage.
4. Establish scale measurements after correctness is stable; run native/device qualification and summarize gaps.

Deliver a coverage matrix, versioned fixture manifests, small committed regression cases, reproducible run commands, machine-readable results and a release report classifying each requirement as passed, failed, not run or unsupported. Every result names the candidate commit. Large data/logs/screenshots are external artifacts referenced by manifest; no credentials or contact email in Git.

The builder may choose exact fixture organization, test counts/seeds, timeout ceilings, fault-injection wrappers and CI job grouping after inspecting existing coverage. Initial choices must be recorded; they must not weaken the financial invariants or turn unrun cases into passes. This design does not authorize merging PRs, raising limits, changing calendar behavior or introducing a general chart unit-validation feature.
