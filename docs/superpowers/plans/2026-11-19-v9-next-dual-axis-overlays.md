# Dual-Axis Historical Overlays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render two closed historical overlay questions without hidden joins or availability-date guessing.

**Architecture:** Use an explicitly prepared acquired long table, retaining both series source coordinates and join/availability proof. Plot existing scatter traces on separately labeled linear axes; preparation is a source capability, not a chart fetch.

**Tech Stack:** Existing TypeScript/React/Plotly and worker/table engines; Python/Pydantic canonical provider; Vitest, Playwright and Docker.

**Spec:** [Approved specification](../specs/2026-11-19-v9-next-dual-axis-overlays-design.md).

## Global Constraints

- Read the approved family specification and [shared roadmap](../specs/2026-11-19-v9-next-eight-charts-design.md). The user approved specifications for planning; implementation awaits review of these plans.
- Start after the shared foundation in the [orchestration plan](2026-11-19-v9-next-eight-charts.md). Existing three-chart changes remain a separate candidate; recheck their final pins and tests before branching. No published branch rewrite, push, merge, deployment, subscription or scheduled snapshot collection.
- Source tables own acquisition and explicit preparation. No hidden fetches/joins/FX, guessed units, inferred historical vintages, runtime proof in settings, or unknown-to-complete promotion. Verify source readiness before enabling a real route.
- Preserve raw unsafe facts and coordinate-only omissions through TypeScript, compiled Rust and linked descendants. Use closed versioned settings, original units, bounded escaped text, distinct zero/missing/error states and source repair.
- Follow-latest defaults resolve only acquired observations at runtime; explicit pins disappearing on reacquisition refuse without substitution. Semantic choices reset revision; same-question refresh and viewport do not.
- Apply draft/applied, source-status ownership, late worker/draw fencing and touch/overflow behavior from the existing three-chart implementation. Independently review each task and the complete family; measure module/worker bytes separately.

## Review Focus

- Fiscal target date is not report availability; mounted fixture asserts actual x.
- Restated EPS cannot claim historical knowledge; test vintage copy and incompatible basis.
- Monthly CPI is not interpolated daily; test independent coordinate lengths/gaps.
- Prepared lineage is required; two arbitrary source cards cannot grant overlay proof.
- Dual axes remain visible and separately ranged after narrow resize; actual Plotly test.

---

## File map and frozen interfaces

Provider new `models/_overlay_chart_source.py` and `tests/test_overlay_chart_source.py` for explicit snapshot validation; no invented live endpoint. BDOBB `chartRecipes/dualAxisOverlay.ts`, `.test.ts`, `overlayEvidence.ts`, `.test.ts`; settings/controls/dispatch; `e2e/dual-axis-overlay.spec.ts`.

Options are exactly `{version:1,kind:'dual-axis-overlay',recipe:'price-eps'|'cpi-ten-year',fields:{series:string,date:string,value:string,availableAt?:string,targetStart?:string,targetEnd?:string}}`. Figure builders use `(dataset: WidgetDataset, options: RecipeOptions, context: RecipeContext): RecipeResult`; `buildDualAxisOverlay` is the family entry point unless the KPI-specific signature below applies. `ChartBuildResult<T>` comes from the foundation. Family source decoder `parseOverlaySource(value: unknown): OverlaySource | undefined` is strict and closed; reuse the existing price decoder instead for return summaries.

**Frozen source shape:** OverlaySource extends the common receipt with `recipe:'price-eps'|'cpi-ten-year'`, `series:{left:OverlaySeriesFact,right:OverlaySeriesFact}`, `preparation:{input_refs:string[],reference:string}`, and `unsafe:{identity_conflict:boolean,unit_conflict:boolean,coordinate_conflict:boolean,basis_conflict:boolean,untraced_omission:boolean}`. OverlaySeriesFact is `{id:string,unit:'money-per-share'|'index'|'yield-fraction',currency:string|null,basis:string,coordinate:'observation-date'|'availability-date',period_kind:'FQ'|null,restated:boolean}`; basis/id are validated against the finite closed recipe source contract, never arbitrary strings accepted as authority. Retain coordinate-only omission arrays per series.

### Task 1: Prove and implement the acquired source contract

**Files:** Source/evidence paths in the map; add `docs/chart-contracts/dual-axis-overlays.md` in the canonical provider when provider work applies.

**Interfaces:** Consumes foundation capture/projection hooks; produces the family source decoder and validated runtime facts: two exact acquired series identities and field units, independent coordinates/omissions, explicit preparation lineage; price/EPS qualified listing+issuer/current split-adjusted share basis/currency/FQ target/actual report availability/restatement vintage; macro exact CPI and nominal-ten-year identifiers/bases verified against authoritative contracts.

- [ ] Write source-bound fixtures and tests for the first two Review Focus hazards, plus contradictory/missing evidence, counts, hidden unsafe rows, aliases, grandchild projection and legacy requests. Preserve source pre-drop facts; a query flag or saved setting cannot grant certification.
- [ ] Run provider `python -m pytest tests/test_overlay_chart_source.py -q` and the new BDOBB evidence suite; expect missing contract/decoder assertions.
- [ ] Record authoritative source fields/units/date meaning and captured representative payloads in the contract document. Verdict is `ready` only when every required fact is evidenced; otherwise record exact `blocked-source` facts, keep that real route disabled and test honest refusal. Explicit acquired local snapshots can exercise builders, but are not evidence of live availability. Do not invent a new upstream endpoint, archive or entitlement.
- [ ] Implement additive opt-in `chart_source` normalization using `AnnotatedResult.metadata.chart_sources`, a single existing acquisition and family-specific closed Pydantic/TS variants. Raw diagnostics precede drops. Preserve default legacy errors/results. For prepared/vintage sources, implement explicit snapshot validation only until the documented real contract exists. Register only proven completed-request route/selector/identity matches.
- [ ] Rerun the same source tests plus compiled Rust linked evidence tests when projection changes; expect closed parser rejection and legacy compatibility. Commit only source-contract/evidence changes as `feat: validate dual-axis-overlays acquisition contracts`. Record readiness verdict for the family reviewer.

### Task 2: Implement the mathematical builder and truthful figure

**Files:** Builder/test module from file map; dispatch only its implemented kind (KPI uses its separate typed worker).

**Interfaces:** Consumes Task1 evidence and frozen options; produces builder and pure data helpers below.

- [ ] Add failing tests named `known_result`, `zero_missing_and_scope`, `hidden_unsafe_fact`, `numerical_limits`, and the remaining three Review Focus cases. Concrete assertions include `expect(epsTrace.x).toEqual(['2026-05-08']); expect(epsTrace.x).not.toContain('2026-03-31');` Pin these cases: EPS fiscalendMar31/announcementMay8 plots atMay8; unsupported basic/annual/TTM or ADR basis refuses; restated current value labeled not as-known; CPI monthly coordinates remain monthly with no daily forwardfill; missing source dates gap instead of zero.
- [ ] Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/dualAxisOverlay.test.ts`; expect missing builder or wrong-result assertions.
- [ ] Implement `prepareOverlaySeries(dataset, options): ChartBuildResult<OverlaySeriesPair>` validates each series independently and preserves dates. Initial equity scope FQ diluted EPS with verified same current-share/quote basis, discrete report-date markers; source cannot prove diluted basis =>refuse. Initial macro scope US all-urban all-items SA CPI index1982–84=100 and US nominal10-year constant-maturity yield; pin exact source IDs in Task1 evidence before live enablement. Linear dual axes, both units always visible, no normalization, inference or automatic correlation. All labels/hover are escaped, original values remain available, and nonfinite/unfaithful render geometry refuses rather than silently dropping required observations.
- [ ] Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/dualAxisOverlay.test.ts` and affected shared math/evidence tests; expect the exact results and refusal/summary assertions to pass. Render an ordinary and extreme figure with installed Plotly, inspecting actual ranges/path or bands rather than JSON alone.
- [ ] Commit scoped builder/tests and own dispatch as `feat: build dual-axis-overlays analytics`.

### Task 3: Integrate controls, persistence and browser acceptance

**Files:** Existing controls/renderers/settings/bindings/worker/app decoders; named e2e file and fixture; create `docs/examples/v9-next-dual-axis-overlays/` and matching `.apps.json`; help/release notes. Register fixture-only manifests explicitly in apps-sync without distributing unresolved IDs.

**Interfaces:** Consumes Tasks1–2 and the closed options; produces discoverable source-backed controls and reacquired portable examples.

- [ ] Add failing decoder/parent/browser tests: strict unknown-key/version rejection, missing evidence disables Apply, incompatible draft retains applied output, invalid applied/import clears, A→B pending/failure/recovery, same-source stale output with one parent alert, obsolete worker/draw rejection, local draw error, pinned-missing repair and same-question resize. Two named recipe choices; bindings only from compatible prepared table. No arbitrary metric/third-series editor. Source repair points to preparation/availability facts, not a hidden download. Test actual axes and original hover, touch/zoom, no subscription fetch and import refusal on missing evidence.
- [ ] Run the affected Vitest parent/decoder suites and `pnpm exec playwright test e2e/dual-axis-overlay.spec.ts --project=chromium`; expect missing controls/acceptance assertions before integration.
- [ ] Implement controls/defaults/repair and source acquisition; keep semantic revision separate from viewport. Integrate only the stated module/renderer and derived allowlist. Add explanatory examples/help for positive acquired snapshots and unavailable live contracts; never advertise a fixture as a verified live feed.
- [ ] Rerun those tests, typecheck, lint, scrub and example-import tests. Inspect real Chromium screenshots in light/dark/narrow/touch; test original-value hover, gestures and new-page requests after export/import. Run affected existing chart browsers once; record exact tests/skips and module/worker byte deltas.
- [ ] Commit scoped integration/examples as `feat: integrate dual-axis-overlays controls and acceptance`. Request an independent family review; fix findings with regressions and scoped re-review. The orchestration plan owns final paired provider/Docker shipping gates. A blocked real source remains a disclosed readiness blocker, never a claim of full live feature completion.

## Self-review and handoff

Each specification requirement has an owner: source/evidence Task1, calculations/geometry Task2, UI/lifecycle/persistence/browser/docs Task3, final packaging in the orchestration plan. Review Focus cases are explicitly assigned to source or builder/parent tests. This plan describes future checks, not passing implementation results. Preserve the user's subagent execution preference and independent final review, but wait for review of this plan before starting new implementation.
