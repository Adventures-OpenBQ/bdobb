# Next Eight Chart Families Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver eight independently scoped chart families without substituting unsupported financial data or interrupting the approved three-chart candidate.

**Architecture:** Implement one shared acquisition-evidence extension, then separate family plans using the existing linked tables/workers/renderers. Keep source-dependent live modes disabled until their named evidence gates pass; synthetic fixtures never prove real source availability. Canonical provider changes are packaged into Docker from exact reviewed commits.

**Tech Stack:** Existing TypeScript/React/Plotly, TypeScript and compiled Rust table execution, Python/Pydantic/OpenBB, Vitest/Playwright, Docker.

**Spec:** [Eight-family roadmap and linked specifications](../specs/2026-11-19-v9-next-eight-charts-design.md), approved for planning in chat on 2026-11-19.

## Global Constraints

- The user approved all eight plans for subagent execution with independent final review on 2026-11-19. The previous three-chart implementation and review are complete; this sequence may proceed.
- No hidden source acquisitions, implicit joins, FX, assumed entitlements, historical snapshot collector, metric store or look-through project. Existing source evidence and legacy routes remain compatible.
- Sources own data and explicit preparation; workers own exact financial definitions and figures; settings cannot certify runtime data. Unknown prerequisites refuse honestly.
- Raw unsafe facts survive filtering, aliases, both engines and linked descendants. No source repair can recertify a surviving subset. No hidden numeric values recover removed components.
- Follow latest means latest acquired compatible observation; explicit missing pins refuse with repair. Import reacquires. Preserve draft/applied behavior, one source alert, stale ownership, late-result fencing, accessibility and actual touch interaction.
- No Plotly version/vendor/full-bundle change. Proposed module additions: box, treemap, sunburst only. News heatmap, worker-rendered KDE/scatter, bars, overlays, revision paths and existing indicator reuse registered traces. Measure each addition before shipping.
- Separate codex/ work branches; preserve existing public PRs. No push, merge or deployment without a subsequent request. Follow CodeGraph-first only in already indexed repositories.

## Review Focus

1. A fixture or editable parameter must not certify a live route; source-bound tests belong to the foundation and each family's Task1.
2. Aggregate/linked data must not inherit invalid source proof; test both engines and grandchild after alias/filter/recalculation.
3. Follow-latest resolution must not overwrite explicit pins during export/import or a delayed refresh; family parent/browser tests.
4. Display rounding, unregistered traces and actual Plotly geometry must not silently change financial definitions; family builder tests exercise installed renderer.
5. Eight independent capabilities must not become one all-or-nothing release or hide blocked real sources; readiness ledger plus independent family and final paired review.

---

## Baseline, work packages and execution order

At execution, first record final reviewed SHAs/image digest of the existing three-chart candidate, worktree status, open PR heads and baseline tests/bundle bytes. The current specification commit is `a1083ea5`; it is not a final product baseline. Reuse an already isolated workspace or use using-git-worktrees/native tooling; do not reset or overwrite current work. Capture exact source heads, do not assume any prior PR merged.

Run shared Task1 below once. Then execute these family plans sequentially, reviewing each task before dependent work. The order is a proposed delivery order based on data readiness, not a promise that a blocked source is available:

| Order | Plan | Source gate before real enablement |
| --- | --- | --- |
| 1 | [News-sentiment calendar](2026-11-19-v9-next-news-sentiment-calendar.md) | Typed polarity, stable article identity and raw date/duplicate facts |
| 2 | [Return box/violin](2026-11-19-v9-next-return-box-violin.md) | Existing price evidence; pinned quantiles/KDE |
| 3 | [Ownership bars/waffle](2026-11-19-v9-next-ownership-snapshot.md) | Unit/date/class facts; waffle additionally independent partition proof |
| 4 | [KPI cards/gauges](2026-11-19-v9-next-kpi-gauges.md) | Typed metric/reference units and observation selection |
| 5 | [ETF sunburst](2026-11-19-v9-next-etf-sunburst.md) | Same holdings snapshot and fund-assets basis/coverage |
| 6 | [Dual-axis overlays](2026-11-19-v9-next-dual-axis-overlays.md) | Explicit prepared source, exact series and availability/share-basis proof |
| 7 | [Estimate revisions](2026-11-19-v9-next-estimate-revisions.md) | True acquired vintages; stronger complete batch/universe proof for bump |
| 8 | [Market map](2026-11-19-v9-next-market-map.md) | Completed-session return; named index additionally authoritative components/weights |

Delivered-cap market map may be selected independently once its narrower source gate is met. Source discovery is not permission to invent a substitute financial definition. A source gate that fails produces a precise blocked-source record, safe refusal tests and a request to choose between obtaining the required source or deferring that real mode. Work on independent ready families can proceed; do not report all eight live capabilities complete while a gate is unresolved.

## Shared file map and frozen transport

Create BDOBB `src/lib/widgetData/chartRecipes/chartSourceContracts.ts`, `.test.ts`, `chartSourceRegistry.ts`, `.test.ts`; extend `src/lib/dataClient.ts`, `src/lib/tableRowValues.ts`, `src/lib/localTableData.ts`, `src/hooks/useWidgetData.ts`, `src/lib/tableExecution/{engine,resultStore}.ts`, Rust protocol/contract/projection only where required. Provider create `openbq_eodhd/models/_chart_sources.py` with closed shared models; family adapters add their own closed variants. Do not loosen or replace the current three-family `financialEvidence` decoder.

New wire envelope: `AnnotatedResult.metadata.chart_sources = {version:1, receipts:[...familyReceipts]}`; HTTP path `extra.results_metadata.chart_sources`. Each family kind occurs at most once. Family receipt common fields are `version:1`, closed literal `kind`, UTC `retrieved_at`, ordered nonnegative `raw_count`, `normalized_count`, `delivered_count`, and family-allowlisted `diagnostics`/`unsafe` facts. Family plans own exact origin/unit/basis/scope fields and source validators; no open-ended string metadata grants proof. Multiple independently eligible family receipts may accompany one acquisition. An acquisition never becomes eligible for another family merely because one receipt validated.

- Export `ChartSourceReceipt` as the common receipt constraint with literal kind union `news | ownership | overlay | estimate-vintages | market-map | etf-hierarchy | metric`, version/counts/time and diagnostics/unsafe fields above; the base constraint is never itself a positive decoder. `ChartSourceMap = Partial<Record<ChartSourceReceipt['kind'], ChartSourceReceipt>>`; family decoders recover their complete closed variant on read.
- Export `ChartBuildResult<T> = {ok:true,value:T,notes:string[]} | RecipeRefusal`.
- Export `captureChartSources(context: BackendAcquisition, response: unknown, selectedRows: readonly unknown[]): ChartSourceMap | undefined`; existing completed-request context owns actual route/allowlisted parameters. Static registry entries bind one known route/selector/kind to a closed family decoder and raw-row cross-check. No plugin or settings can register a validator.
- Export `readChartSource<T extends ChartSourceReceipt>(provenance: DatasetProvenance, kind: T['kind'], decode: (value: unknown) => T | undefined): T | undefined`; always revalidate the family receipt and runtime omission supplement. A type assertion alone never certifies it.
- Export `projectChartSources(provenance: DatasetProvenance, columns: readonly DatasetColumn[], rows: readonly DatasetRow[]): DatasetProvenance`; import DatasetColumn and DatasetRow from `widgetData/types.ts`. Preserve acquired flags/counts, add only declared coordinate omissions and active-filter facts, never upgrade coverage. Family adapters add projection rules when introduced; recalculation clears presentation-specific proof.
- Runtime storage is `provenance.metadata.chartSources`; it is not serialized with settings. A trusted local JSON snapshot can add top-level `chart_sources` under the strict local-file parser. Remote snapshot-shaped rows cannot bypass completed-request validation. Family validators are introduced with their tests in each Task1; unknown kinds are rejected, not passed through as opaque positive proof.

### Task 1: Shared Evidence plumbing and compatibility boundary

**Files:** Shared map above; tests `src/lib/dataClient.test.ts`, `src/lib/localTableData.test.ts`, `src/stores/tableExecutionStore.test.ts`, new `src/lib/tableExecution/rust/chartSources.test.ts`; provider `tests/test_chart_sources.py`.

**Interfaces:** Produces the capture/read/project helpers, `ChartBuildResult`, source registry contract and compatible opt-in metadata channel. Consumers are family Task1 decoders. Keep family-specific parsers out until their contracts exist; test fixtures can supply a strictly scoped test decoder through the pure helper parameter without registering a production source.

- [ ] Add RED tests `remote_snapshot_cannot_bypass_request`, `dotted_selection_keeps_matched_receipt`, `late_request_cannot_attach_context`, `unknown_or_duplicate_kind_rejected`, `hidden_safety_survives_grandchild`, `recalculation_drops_presentation_proof`, `settings_cannot_supply_receipt`. Assert a legacy response has identical rows/status and no new source receipt; a wrong route or `chart_source=false` never attaches evidence.
- [ ] Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/chartSourceContracts.test.ts src/lib/dataClient.test.ts src/stores/tableExecutionStore.test.ts` and provider `python -m pytest tests/test_chart_sources.py -q`; expect missing helper/contract failures.
- [ ] Implement closed envelope validation and actual completed-request capture before dotted extraction, atomic rows/context delivery, local-only explicit snapshot trust, reserved runtime metadata, per-family static registry and omission/proof hooks. Existing three-chart and ETF evidence paths stay unchanged. Bind field origins through aliases; do not infer a compatible source from matching labels.
- [ ] Run those tests, affected local table/engine suites and the real compiled Rust boundary tests. When native code changes run `pnpm pivot:build`, `pnpm pivot:test`, typecheck and packaging verification. Expect legacy behavior and both-engine grandchild invariants to pass. Run a focused actual worker clone test rejecting executable/tampered options.
- [ ] Commit scoped plumbing as `feat: add source-bound next-chart evidence channel`. Independent task review must approve spec and quality before family decoders build on it. Record source contract additions and exact exported interfaces in the execution ledger.

### Task 2: Shared Paired shipping verification and independent final review

Run after each selected delivery group, not before its family plans. Do not repeat unchanged whole suites between every edit; rerun affected tests after fixes and final shipping gates on the actual final group candidate.

**Files:** Canonical provider contract documents/tests; Docker `v9/eodhd/source/`, `source.json`, tests/verifier and port docs; BDOBB `docs/releases/validation/v9/next-charts/{verification,review,rulings}.md` with a per-family readiness table.

**Interfaces:** Consumes reviewed family source commits and client candidate; produces exact canonical/vendor/image pins, shipping evidence and an independent reviewed handoff.

- [ ] Add packaged route/metadata/legacy tests before repinning; run against previous image to observe expected missing contracts, then vendor the exact canonical tracked tree and regenerate hashes. No independent vendor algorithm patch. Verify path/mode/blob/byte/hash equality and installed provider files.
- [ ] Build the actual candidate image and run offline provider pytest, packaged image route/pin suite and documented verifier. Record image platform/config/manifest digests and source SHAs. Source readiness table must distinguish verified live contract, explicit acquired snapshot support, and blocked-source; deterministic mocks never prove entitlement or historical availability.
- [ ] Run BDOBB typecheck, lint, full unit suite, scrub, web tests, production build, affected existing chart browsers and each shipped family Chromium suite. Run compiled Rust parity/packaging checks if source/proof transport changed. Inspect actual screenshots/values/gestures; record exact counts/skips/warnings and isolated per-module/worker plus production bundle raw/gzip bytes against baseline.
- [ ] Request independent whole-group review by a reviewer separate from implementers, covering financial semantics, source/canonical packaging, raw-hidden hazards, lifecycle, actual rendering and claims. Resolve findings through regression tests and scoped re-review, rerunning affected gates. Preserve explicit source blockers rather than declaring a fixture-only live feature complete.
- [ ] Record all dispositions and controller rulings with costs, exact reviewed SHAs and any limitations; commit only durable evidence as `docs: record next-chart verification and independent review`. Keep local branches reviewable; publication is a subsequent user action.

## Self-review and execution handoff

Checked all eight family specs against their individual plans: source gates/units/identity Task1; exact statistics/hierarchy/figure Task2; controls/persistence/lifecycle/real browser Task3; common transport and final packaging here. Each Review Focus hazard has an owning test. No source contract is declared verified merely by writing this plan. KPI uses its own typed metric result and existing metric renderer rather than widening the existing figure result union. Partial hierarchy scopes, versioned options, explicit pins, actual source prerequisites and legacy preservation are covered.

The user approved this plan set for implementation on 2026-11-19. Preserve the established subagent execution and independent final review preference. Approval of these plans would not authorize subscriptions, new snapshot automations, publication, merge or deployment.
