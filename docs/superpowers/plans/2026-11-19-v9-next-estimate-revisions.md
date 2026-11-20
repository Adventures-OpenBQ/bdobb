# Estimate-Revision Slope, Path and Bump Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compare consensus for an identical target period across proven acquired vintages, with ranking only under stronger universe proof.

**Architecture:** Validate explicit vintage-history snapshots; the current Earnings.Trend target date cannot supply observation history. Build slope/path with scatter and gate bump on exact snapshot batches and complete stable eligible universe.

**Tech Stack:** Existing TypeScript/React/Plotly and worker/table engines; Python/Pydantic canonical provider; Vitest, Playwright and Docker.

**Spec:** [Approved specification](../specs/2026-11-19-v9-next-estimate-revisions-design.md).

## Global Constraints

- Read the approved family specification and [shared roadmap](../specs/2026-11-19-v9-next-eight-charts-design.md). The user approved these plans for implementation with subagents and independent final review on 2026-11-19.
- Start after the shared foundation in the [orchestration plan](2026-11-19-v9-next-eight-charts.md). Existing three-chart changes remain a separate candidate; recheck their final pins and tests before branching. No published branch rewrite, push, merge, deployment, subscription or scheduled snapshot collection.
- Source tables own acquisition and explicit preparation. No hidden fetches/joins/FX, guessed units, inferred historical vintages, runtime proof in settings, or unknown-to-complete promotion. Verify source readiness before enabling a real route.
- Preserve raw unsafe facts and coordinate-only omissions through TypeScript, compiled Rust and linked descendants. Use closed versioned settings, original units, bounded escaped text, distinct zero/missing/error states and source repair.
- Follow-latest defaults resolve only acquired observations at runtime; explicit pins disappearing on reacquisition refuse without substitution. Semantic choices reset revision; same-question refresh and viewport do not.
- Apply draft/applied, source-status ownership, late worker/draw fencing and touch/overflow behavior from the existing three-chart implementation. Independently review each task and the complete family; measure module/worker bytes separately.

## Review Focus

- Earnings.Trend.date cannot certify observed_at; source-bound refusal test.
- Different fiscal targets or FY/FQ cannot form a revision; test same-looking labels.
- Nonpositive baseline never creates a percent growth rank; test signedchanges.
- Changing universe/missingmember does not manufacture rank movement; wholecolumnrefuses.
- Conflicting duplicate snapshots hidden by filter remain unsafe; both-engine test.

---

## File map and frozen interfaces

Provider new `models/_estimate_vintage_source.py`, `tests/test_estimate_vintage_source.py`; existing `models/estimates.py` legacy unchanged unless an authoritative real history contract is evidenced. BDOBB `chartRecipes/estimateRevisions.ts`, `.test.ts`, `estimateVintageEvidence.ts`, `.test.ts`; controls/settings/dispatch; `e2e/estimate-revisions.spec.ts`.

Options are exactly `{version:1,kind:'estimate-revisions',metric:'eps'|'revenue',view:'slope'|'path'|'bump',target:{start:string,end:string,kind:'FY'|'FQ'},vintages:string[],fields:{issuer:string,vintage:string,targetStart:string,targetEnd:string,targetKind:string,value:string}}`. Figure builders use `(dataset: WidgetDataset, options: RecipeOptions, context: RecipeContext): RecipeResult`; `buildEstimateRevisions` is the family entry point unless the KPI-specific signature below applies. `ChartBuildResult<T>` comes from the foundation. Family source decoder `parseEstimateVintageSource(value: unknown): EstimateVintageSource | undefined` is strict and closed; reuse the existing price decoder instead for return summaries.

**Frozen source shape:** EstimateVintageSource extends the common receipt with `metric:'eps'|'revenue'`, `target:{start:string,end:string,kind:'FY'|'FQ'}`, `vintages:{id:string,observed_at:string,batch:string}[]`, per-issuer verified currency/share-basis declarations, `universe:{status:'unknown'}|{status:'complete',id:string,members:string[],baseline_batch:string,current_batch:string}`, and `unsafe:{identity_conflict:boolean,vintage_conflict:boolean,target_conflict:boolean,unit_conflict:boolean,duplicate_conflict:boolean}`. Each snapshot coordinate is issuer+target+vintage, never the provider target date alone. Strict per-issuer fact entries carry no hidden estimate values.

### Task 1: Prove and implement the acquired source contract

**Files:** Source/evidence paths in the map; add `docs/chart-contracts/estimate-revisions.md` in the canonical provider when provider work applies.

**Interfaces:** Consumes foundation capture/projection hooks; produces the family source decoder and validated runtime facts: qualified issuer, independently verified observed_at/snapshot batch, exact targetstart/end/kind, metric unit/currency/current share basis, acquisition coverage and raw duplicate/scope flags; bump additionally baseline/current batches, declared stable universe and all-member eligibility.

- [ ] Write source-bound fixtures and tests for the first two Review Focus hazards, plus contradictory/missing evidence, counts, hidden unsafe rows, aliases, grandchild projection and legacy requests. Preserve source pre-drop facts; a query flag or saved setting cannot grant certification.
- [ ] Run provider `python -m pytest tests/test_estimate_vintage_source.py -q` and the new BDOBB evidence suite; expect missing contract/decoder assertions.
- [ ] Record authoritative source fields/units/date meaning and captured representative payloads in the contract document. Verdict is `ready` only when every required fact is evidenced; otherwise record exact `blocked-source` facts, keep that real route disabled and test honest refusal. Explicit acquired local snapshots can exercise builders, but are not evidence of live availability. Do not invent a new upstream endpoint, archive or entitlement.
- [ ] Implement additive opt-in `chart_source` normalization using `AnnotatedResult.metadata.chart_sources`, a single existing acquisition and family-specific closed Pydantic/TS variants. Raw diagnostics precede drops. Preserve default legacy errors/results. For prepared/vintage sources, implement explicit snapshot validation only until the documented real contract exists. Register only proven completed-request route/selector/identity matches.
- [ ] Rerun the same source tests plus compiled Rust linked evidence tests when projection changes; expect closed parser rejection and legacy compatibility. Commit only source-contract/evidence changes as `feat: validate estimate-revisions acquisition contracts`. Record readiness verdict for the family reviewer.

### Task 2: Implement the mathematical builder and truthful figure

**Files:** Builder/test module from file map; dispatch only its implemented kind (KPI uses its separate typed worker).

**Interfaces:** Consumes Task1 evidence and frozen options; produces builder and pure data helpers below.

- [ ] Add failing tests named `known_result`, `zero_missing_and_scope`, `hidden_unsafe_fact`, `numerical_limits`, and the remaining three Review Focus cases. Concrete assertions include `expect(change).toMatchObject({absolute:2,percent:.2}); expect(ranks).toEqual([1,1,3]);` Pin these cases: same target baseline10/current12 gives+2/+20%; targetdate masquerading as vintage refuses; negative/zero baseline keeps absolute but no percent; missingvintage gaps; bump exactties1/1/3, missingmember invalidates whole column; no nominal EPS ranking.
- [ ] Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/estimateRevisions.test.ts`; expect missing builder or wrong-result assertions.
- [ ] Implement `compareEstimateVintages(dataset, options): ChartBuildResult<EstimateRevisionData>` requires2 vintages for slope and>=3 for path. No snapshot creation/storage/scheduler. Bump ranks percentage revision descending from one explicit baselinebatch, only positive baselines, identical actualfiscalcoverage and exact baseline/current batch for every declared member; no fuzzy windows or eligible-subset rank. Runtime cannot substitute target-period history for vintages. All labels/hover are escaped, original values remain available, and nonfinite/unfaithful render geometry refuses rather than silently dropping required observations.
- [ ] Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/estimateRevisions.test.ts` and affected shared math/evidence tests; expect the exact results and refusal/summary assertions to pass. Render an ordinary and extreme figure with installed Plotly, inspecting actual ranges/path or bands rather than JSON alone.
- [ ] Commit scoped builder/tests and own dispatch as `feat: build estimate-revisions analytics`.

### Task 3: Integrate controls, persistence and browser acceptance

**Files:** Existing controls/renderers/settings/bindings/worker/app decoders; named e2e file and fixture; create `docs/examples/v9-next-estimate-revisions/` and matching `.apps.json`; help/release notes. Register fixture-only manifests explicitly in apps-sync without distributing unresolved IDs.

**Interfaces:** Consumes Tasks1–2 and the closed options; produces discoverable source-backed controls and reacquired portable examples.

- [ ] Add failing decoder/parent/browser tests: strict unknown-key/version rejection, missing evidence disables Apply, incompatible draft retains applied output, invalid applied/import clears, A→B pending/failure/recovery, same-source stale output with one parent alert, obsolete worker/draw rejection, local draw error, pinned-missing repair and same-question resize. Explicit metric/target/vintages, slope default; path requires3; bump disabled without stronger proof. Show target versus observation date, reference vintage, coverage and unavailable cells. Existing scatter only. Test linegap/hover/rankaxis, import pinnedmissing refusal, no background capture and positive fixture versus honest unsupportedlive route.
- [ ] Run the affected Vitest parent/decoder suites and `pnpm exec playwright test e2e/estimate-revisions.spec.ts --project=chromium`; expect missing controls/acceptance assertions before integration.
- [ ] Implement controls/defaults/repair and source acquisition; keep semantic revision separate from viewport. Integrate only the stated module/renderer and derived allowlist. Add explanatory examples/help for positive acquired snapshots and unavailable live contracts; never advertise a fixture as a verified live feed.
- [ ] Rerun those tests, typecheck, lint, scrub and example-import tests. Inspect real Chromium screenshots in light/dark/narrow/touch; test original-value hover, gestures and new-page requests after export/import. Run affected existing chart browsers once; record exact tests/skips and module/worker byte deltas.
- [ ] Commit scoped integration/examples as `feat: integrate estimate-revisions controls and acceptance`. Request an independent family review; fix findings with regressions and scoped re-review. The orchestration plan owns final paired provider/Docker shipping gates. A blocked real source remains a disclosed readiness blocker, never a claim of full live feature completion.

## Self-review and handoff

Each specification requirement has an owner: source/evidence Task1, calculations/geometry Task2, UI/lifecycle/persistence/browser/docs Task3, final packaging in the orchestration plan. Review Focus cases are explicitly assigned to source or builder/parent tests. This plan describes future checks, not passing implementation results. Preserve the user's subagent execution preference and independent final review, the user approved implementation on 2026-11-19.
