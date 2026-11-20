# Linked KPI Cards and Gauges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse MetricRenderer for typed source-linked headlines and indicator gauges only with explicit meaningful ranges.

**Architecture:** Add a linked metric adapter and a small typed worker result rather than force cards into Plotly figures. Reuse MetricRenderer for card view and ChartRenderer plus the already registered indicator for gauge view, with the same source/error/revision policy as linked charts.

**Tech Stack:** Existing TypeScript/React/Plotly and worker/table engines; Python/Pydantic canonical provider; Vitest, Playwright and Docker.

**Spec:** [Approved specification](../specs/2026-11-19-v9-next-kpi-gauges-design.md).

## Global Constraints

- Read the approved family specification and [shared roadmap](../specs/2026-11-19-v9-next-eight-charts-design.md). The user approved specifications for planning; implementation awaits review of these plans.
- Start after the shared foundation in the [orchestration plan](2026-11-19-v9-next-eight-charts.md). Existing three-chart changes remain a separate candidate; recheck their final pins and tests before branching. No published branch rewrite, push, merge, deployment, subscription or scheduled snapshot collection.
- Source tables own acquisition and explicit preparation. No hidden fetches/joins/FX, guessed units, inferred historical vintages, runtime proof in settings, or unknown-to-complete promotion. Verify source readiness before enabling a real route.
- Preserve raw unsafe facts and coordinate-only omissions through TypeScript, compiled Rust and linked descendants. Use closed versioned settings, original units, bounded escaped text, distinct zero/missing/error states and source repair.
- Follow-latest defaults resolve only acquired observations at runtime; explicit pins disappearing on reacquisition refuse without substitution. Semantic choices reset revision; same-question refresh and viewport do not.
- Apply draft/applied, source-status ownership, late worker/draw fencing and touch/overflow behavior from the existing three-chart implementation. Independently review each task and the complete family; measure module/worker bytes separately.

## Review Focus

- Manyrows cannot selectfirst silently; directworkerandcardtest.
- Zero/error/missing remain distinct; test originalMetricRenderer compatibility.
- Percentagepoints/fraction andcurrency cannotbe changedbyformatsettings.
- Out-of-rangevalue stays exact and doesnot produceapparentlyvalidneedle.
- Reference ofdifferentperiod/class/basis or forgedsavedproof refuses.

---

## File map and frozen interfaces

BDOBB new `src/lib/widgetData/kpi/{types,settings,build,kpi.worker,workerClient}.ts` and tests, `src/components/renderers/LinkedKpiRenderer.tsx`, `.test.tsx`; modify `MetricRenderer.tsx`, `WidgetCard.tsx`, app/persistence decoder and controls. Provider new `models/_metric_chart_source.py`, applicable `models/metrics.py`/`quote.py`/`screener.py`, `tests/test_metric_chart_source.py`; `e2e/linked-kpi.spec.ts`.

Options are exactly `LinkedKpiOptions={version:1,metric:'price'|'market_cap'|'dividend_yield'|'pe_ratio'|'eps_ttm'|'revenue_ttm',valueField:string,observation:{mode:'latest'}|{mode:'pinned',id:string},view:'card'|'gauge',range?:{min:number,max:number,label:string},reference?:{kind:'observation',id:string}|{kind:'user-target',value:number}}`. Figure builders use `(dataset: WidgetDataset, options: RecipeOptions, context: RecipeContext): RecipeResult`; `buildKpiSnapshot` is the family entry point unless the KPI-specific signature below applies. `ChartBuildResult<T>` comes from the foundation. Family source decoder `parseMetricSource(value: unknown): MetricSource | undefined` is strict and closed; reuse the existing price decoder instead for return summaries.

**Frozen source shape:** MetricSource extends the common receipt with `issuer:string`, `listing:string`, `share_class:string`, `metrics` keyed only the six preset names, each `{origin:string,unit:MetricUnit,as_of:string|null,period_start:string|null,period_end:string|null,period_kind:'FY'|'FQ'|'TTM'|null,adjustment_basis:string|null}`, acquired observation IDs/vintage coordinates, and `unsafe:{identity_conflict:boolean,unit_conflict:boolean,period_conflict:boolean,basis_conflict:boolean,duplicate_conflict:boolean}`. MetricUnit is a closed union `{kind:'money'|'money-per-share',currency:string}|{kind:'count'|'fraction'|'multiple'}`. Origins/bases are adapter-verified literals from the preset contract, never certified by format strings. Counts and omission coordinates do not carry hidden metric values.

### Task 1: Prove and implement the acquired source contract

**Files:** Source/evidence paths in the map; add `docs/chart-contracts/kpi-gauges.md` in the canonical provider when provider work applies.

**Interfaces:** Consumes foundation capture/projection hooks; produces the family source decoder and validated runtime facts: exact metric origin/unit, qualified issuer/listing/class, observationcoordinate/vintage and unknownasofflag, currency/adjustment/reportingperiodbasis, rowidentityandreferencecomparability; userrange/target explicitlyassumptions, neveracquiredconsensus.

- [ ] Write source-bound fixtures and tests for the first two Review Focus hazards, plus contradictory/missing evidence, counts, hidden unsafe rows, aliases, grandchild projection and legacy requests. Preserve source pre-drop facts; a query flag or saved setting cannot grant certification.
- [ ] Run provider `python -m pytest tests/test_metric_chart_source.py -q` and the new BDOBB evidence suite; expect missing contract/decoder assertions.
- [ ] Record authoritative source fields/units/date meaning and captured representative payloads in the contract document. Verdict is `ready` only when every required fact is evidenced; otherwise record exact `blocked-source` facts, keep that real route disabled and test honest refusal. Explicit acquired local snapshots can exercise builders, but are not evidence of live availability. Do not invent a new upstream endpoint, archive or entitlement.
- [ ] Implement additive opt-in `chart_source` normalization using `AnnotatedResult.metadata.chart_sources`, a single existing acquisition and family-specific closed Pydantic/TS variants. Raw diagnostics precede drops. Preserve default legacy errors/results. For prepared/vintage sources, implement explicit snapshot validation only until the documented real contract exists. Register only proven completed-request route/selector/identity matches.
- [ ] Rerun the same source tests plus compiled Rust linked evidence tests when projection changes; expect closed parser rejection and legacy compatibility. Commit only source-contract/evidence changes as `feat: validate kpi-gauges acquisition contracts`. Record readiness verdict for the family reviewer.

### Task 2: Implement the mathematical builder and truthful figure

**Files:** Builder/test module from file map; dispatch only its implemented kind (KPI uses its separate typed worker).

**Interfaces:** Consumes Task1 evidence and frozen options; produces builder and pure data helpers below.

- [ ] Add failing tests named `known_result`, `zero_missing_and_scope`, `hidden_unsafe_fact`, `numerical_limits`, and the remaining three Review Focus cases. Concrete assertions include `expect(result.value).toBe(0); expect(result.deltaPercent).toBeUndefined();` Pin these cases: realvalue0 remains0; current2/reference0 yieldsabsolute2 andpercentunavailable; manyrowswithoutselection refuses; fraction.04 displays4% exactlyonce; value120/range0..100 shows120 without-of-rangestate, nofalseendpointneedle; EPSreference differenttargetperiod refuses.
- [ ] Run `pnpm exec vitest run src/lib/widgetData/kpi/build.test.ts`; expect missing builder or wrong-result assertions.
- [ ] Implement Export `buildKpiSnapshot(dataset: WidgetDataset, options: LinkedKpiOptions): KpiResult`, where success `{ok:true,snapshot:{value:number,label:string,unit:MetricUnit,asOf:string|null,retrievedAt:string,deltaAbsolute?:number,deltaPercent?:number,referenceLabel?:string,outOfRange:boolean},revision:string,notes:string[]}` and failureusesRecipeRefusal. Strictunit enum includes money/count/fraction/multiple with explicitcurrency/basisfields. Samefield acquiredreference only; EPS/revenue mustsameactualperiod acrossvintages. Usertarget is labeledassumption. Percentdelta onlyreference>0. Rangefinite min<max, neverinferred; outofrange renderscard+alert instead ofclampedgauge. All labels/hover are escaped, original values remain available, and nonfinite/unfaithful render geometry refuses rather than silently dropping required observations.
- [ ] Run `pnpm exec vitest run src/lib/widgetData/kpi/build.test.ts` and affected shared math/evidence tests; expect the exact results and refusal/summary assertions to pass. Render an ordinary and extreme figure with installed Plotly, inspecting actual ranges/path or bands rather than JSON alone.
- [ ] Commit scoped builder/tests and own dispatch as `feat: build kpi-gauges analytics`.

### Task 3: Integrate controls, persistence and browser acceptance

**Files:** Existing controls/renderers/settings/bindings/worker/app decoders; named e2e file and fixture; create `docs/examples/v9-next-kpi-gauges/` and matching `.apps.json`; help/release notes. Register fixture-only manifests explicitly in apps-sync without distributing unresolved IDs.

**Interfaces:** Consumes Tasks1–2 and the closed options; produces discoverable source-backed controls and reacquired portable examples.

- [ ] Add failing decoder/parent/browser tests: strict unknown-key/version rejection, missing evidence disables Apply, incompatible draft retains applied output, invalid applied/import clears, A→B pending/failure/recovery, same-source stale output with one parent alert, obsolete worker/draw rejection, local draw error, pinned-missing repair and same-question resize. Use metric widget type with optional closed `linkedMetric` config and new LinkedKpiRenderer receiving source executor/parentstatus; no widening existing RecipeResult. Add separate typed metricworker/client fences. MetricRenderer receives explicitly formatted validatedsnapshot, preserving legacyvalue/label/delta payloads. Existingindicator only; no newmodule. Test invaliddraftretains, importreacquires, localvsparenterrorownership, actualgauge/card/keyboard/touch and unknownasofcopy.
- [ ] Run the affected Vitest parent/decoder suites and `pnpm exec playwright test e2e/linked-kpi.spec.ts --project=chromium`; expect missing controls/acceptance assertions before integration.
- [ ] Implement controls/defaults/repair and source acquisition; keep semantic revision separate from viewport. Integrate only the stated module/renderer and derived allowlist. Add explanatory examples/help for positive acquired snapshots and unavailable live contracts; never advertise a fixture as a verified live feed.
- [ ] Rerun those tests, typecheck, lint, scrub and example-import tests. Inspect real Chromium screenshots in light/dark/narrow/touch; test original-value hover, gestures and new-page requests after export/import. Run affected existing chart browsers once; record exact tests/skips and module/worker byte deltas.
- [ ] Commit scoped integration/examples as `feat: integrate kpi-gauges controls and acceptance`. Request an independent family review; fix findings with regressions and scoped re-review. The orchestration plan owns final paired provider/Docker shipping gates. A blocked real source remains a disclosed readiness blocker, never a claim of full live feature completion.

## Self-review and handoff

Each specification requirement has an owner: source/evidence Task1, calculations/geometry Task2, UI/lifecycle/persistence/browser/docs Task3, final packaging in the orchestration plan. Review Focus cases are explicitly assigned to source or builder/parent tests. This plan describes future checks, not passing implementation results. Preserve the user's subagent execution preference and independent final review, but wait for review of this plan before starting new implementation.
