# Return Box and Violin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compare the same admitted adjusted-price return samples as worker-defined boxes or KDE violins.

**Architecture:** Reuse price evidence and adjacency from return distribution. Compute quartiles and KDE in the worker; use one registered box module for precomputed summaries and existing scatter polygons for KDE, avoiding a second statistical implementation in Plotly.

**Tech Stack:** Existing TypeScript/React/Plotly and worker/table engines; Python/Pydantic canonical provider; Vitest, Playwright and Docker.

**Spec:** [Approved specification](../specs/2026-11-19-v9-next-return-box-violin-design.md).

## Global Constraints

- Read the approved family specification and [shared roadmap](../specs/2026-11-19-v9-next-eight-charts-design.md). The user approved these plans for implementation with subagents and independent final review on 2026-11-19.
- Start after the shared foundation in the [orchestration plan](2026-11-19-v9-next-eight-charts.md). Existing three-chart changes remain a separate candidate; recheck their final pins and tests before branching. No published branch rewrite, push, merge, deployment, subscription or scheduled snapshot collection.
- Source tables own acquisition and explicit preparation. No hidden fetches/joins/FX, guessed units, inferred historical vintages, runtime proof in settings, or unknown-to-complete promotion. Verify source readiness before enabling a real route.
- Preserve raw unsafe facts and coordinate-only omissions through TypeScript, compiled Rust and linked descendants. Use closed versioned settings, original units, bounded escaped text, distinct zero/missing/error states and source repair.
- Follow-latest defaults resolve only acquired observations at runtime; explicit pins disappearing on reacquisition refuse without substitution. Semantic choices reset revision; same-question refresh and viewport do not.
- Apply draft/applied, source-status ownership, late worker/draw fencing and touch/overflow behavior from the existing three-chart implementation. Independently review each task and the complete family; measure module/worker bytes separately.

## Review Focus

- Omitted price breaks both adjacent returns; parity test gaps under filters.
- Common range excludes return with predecessor outside bounds; test unequal calendars.
- R7 and Plotly quartile defaults cannot diverge; assert precomputed summary attrs.
- Constant/near-constant samples do not divide by zero; test KDE fallback and finite geometry.
- All selected listings stay represented or selection refuses; test N4 among valid peers.

---

## File map and frozen interfaces

BDOBB new `chartRecipes/returnSummary.ts`, `.test.ts`; reuse `priceSamples.ts`; modify `plotly.ts`, registration tests, recipe types/settings/bindings/dispatch and controls; `e2e/return-summary.spec.ts`.

Options are exactly `{version:1,kind:'return-summary',fields:PriceBindings,symbols:string[],view:'box'|'violin',window:{mode:'own'}|{mode:'common',start:string,end:string}}`. Figure builders use `(dataset: WidgetDataset, options: RecipeOptions, context: RecipeContext): RecipeResult`; `buildReturnSummary` is the family entry point unless the KPI-specific signature below applies. `ChartBuildResult<T>` comes from the foundation. Reuse `prepareSelectedPrices`, `dailyReturnSamples`, `priceAcquisitionProvenance` and `priceOmissionEvidence` from the existing price modules; do not introduce a new PriceEvidence type or decoder. Family admission adds explicit window and N checks.

### Task 1: Prove and implement the acquired source contract

**Files:** Source/evidence paths in the map; add `docs/chart-contracts/return-box-violin.md` in the canonical provider when provider work applies.

**Interfaces:** Consumes foundation capture/projection hooks; produces the family source decoder and validated runtime facts: existing qualified listing, adjusted-price basis, acquired dates and continuity evidence; no new provider fields or evidence certification.

- [ ] Write source-bound fixtures and tests for the first two Review Focus hazards, plus contradictory/missing evidence, counts, hidden unsafe rows, aliases, grandchild projection and legacy requests. Preserve source pre-drop facts; a query flag or saved setting cannot grant certification.
- [ ] Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/returnSummary.test.ts src/lib/widgetData/chartRecipes/priceSamples.test.ts` with the new admission tests; expect missing family/admission failures, not an environmental failure.
- [ ] Reuse existing adjusted-price evidence and add only the window/sample admissions needed here. No provider change or duplicate price-certification layer.
- [ ] Rerun the same source tests plus compiled Rust linked evidence tests when projection changes; expect closed parser rejection and legacy compatibility. Commit only source-contract/evidence changes as `feat: validate return-box-violin acquisition contracts`. Record readiness verdict for the family reviewer.

### Task 2: Implement the mathematical builder and truthful figure

**Files:** Builder/test module from file map; dispatch only its implemented kind (KPI uses its separate typed worker).

**Interfaces:** Consumes Task1 evidence and frozen options; produces builder and pure data helpers below.

- [ ] Add failing tests named `known_result`, `zero_missing_and_scope`, `hidden_unsafe_fact`, `numerical_limits`, and the remaining three Review Focus cases. Concrete assertions include `expect(summary).toMatchObject({q1:.01,median:.02,q3:.03,lowerWhisker:0,upperWhisker:.03,outliers:[1]});` Pin these cases: sample returns [0,.01,.02,.03,1] has R7 quartiles .01/.02/.03 and outlier1; N4 refuses selection, N5 boxes, N19 violin falls back to boxes, N20 eligible; constant samples show zero IQR and withhold KDE; both endpoints must be inside common date bounds.
- [ ] Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/returnSummary.test.ts`; expect missing builder or wrong-result assertions.
- [ ] Implement Export `summarizeReturns(values: readonly number[]): ReturnBoxSummary` and `estimateReturnDensity(values: readonly number[]): DensityResult`. R7 uses h=(N-1)*p and linear interpolation; whiskers are actual observations within 1.5IQR. Gaussian bandwidth .9*min(sampleSD,IQR/1.34)*N^(-1/5); use 128 evaluation points including observed min/max, one shared density-width scale across selected listings, and no tail extension or independent maximum normalization. N>=5 for every selected listing, violin N>=20 or retain box with reason; at most12 listings. Common window shares inclusive bounds, not session pairs. All labels/hover are escaped, original values remain available, and nonfinite/unfaithful render geometry refuses rather than silently dropping required observations.
- [ ] Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/returnSummary.test.ts` and affected shared math/evidence tests; expect the exact results and refusal/summary assertions to pass. Render an ordinary and extreme figure with installed Plotly, inspecting actual ranges/path or bands rather than JSON alone.
- [ ] Commit scoped builder/tests and own dispatch as `feat: build return-box-violin analytics`.

### Task 3: Integrate controls, persistence and browser acceptance

**Files:** Existing controls/renderers/settings/bindings/worker/app decoders; named e2e file and fixture; create `docs/examples/v9-next-return-box-violin/` and matching `.apps.json`; help/release notes. Register fixture-only manifests explicitly in apps-sync without distributing unresolved IDs.

**Interfaces:** Consumes Tasks1–2 and the closed options; produces discoverable source-backed controls and reacquired portable examples.

- [ ] Add failing decoder/parent/browser tests: strict unknown-key/version rejection, missing evidence disables Apply, incompatible draft retains applied output, invalid applied/import clears, A→B pending/failure/recovery, same-source stale output with one parent alert, obsolete worker/draw rejection, local draw error, pinned-missing repair and same-question resize. Label Return summaries, preserve listing order, default box, explicit common-window bounds. Keep outlier observations and accessible original summaries/counts. Register only box; test actual box/outlier/KDE hover, shared density scale, light/dark/touch, import and semantic revision.
- [ ] Run the affected Vitest parent/decoder suites and `pnpm exec playwright test e2e/return-summary.spec.ts --project=chromium`; expect missing controls/acceptance assertions before integration.
- [ ] Implement controls/defaults/repair and source acquisition; keep semantic revision separate from viewport. Integrate only the stated module/renderer and derived allowlist. Add explanatory examples/help for positive acquired snapshots and unavailable live contracts; never advertise a fixture as a verified live feed.
- [ ] Rerun those tests, typecheck, lint, scrub and example-import tests. Inspect real Chromium screenshots in light/dark/narrow/touch; test original-value hover, gestures and new-page requests after export/import. Run affected existing chart browsers once; record exact tests/skips and module/worker byte deltas.
- [ ] Commit scoped integration/examples as `feat: integrate return-box-violin controls and acceptance`. Request an independent family review; fix findings with regressions and scoped re-review. The orchestration plan owns final paired provider/Docker shipping gates. A blocked real source remains a disclosed readiness blocker, never a claim of full live feature completion.

## Self-review and handoff

Each specification requirement has an owner: source/evidence Task1, calculations/geometry Task2, UI/lifecycle/persistence/browser/docs Task3, final packaging in the orchestration plan. Review Focus cases are explicitly assigned to source or builder/parent tests. This plan describes future checks, not passing implementation results. Preserve the user's subagent execution preference and independent final review, the user approved implementation on 2026-11-19.
