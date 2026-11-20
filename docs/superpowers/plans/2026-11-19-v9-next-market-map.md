# Market-Map Treemap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render an honest delivered-capitalization map independently, with named-index weight mode gated on authoritative membership.

**Architecture:** Consume one prepared listing/sector/area/completed-session table. Use stable sector→listing treemap IDs; mode-specific evidence separates latest acquired capitalization from certified index weight.

**Tech Stack:** Existing TypeScript/React/Plotly and worker/table engines; Python/Pydantic canonical provider; Vitest, Playwright and Docker.

**Spec:** [Approved specification](../specs/2026-11-19-v9-next-market-map-design.md).

## Global Constraints

- Read the approved family specification and [shared roadmap](../specs/2026-11-19-v9-next-eight-charts-design.md). The user approved these plans for implementation with subagents and independent final review on 2026-11-19.
- Start after the shared foundation in the [orchestration plan](2026-11-19-v9-next-eight-charts.md). Existing three-chart changes remain a separate candidate; recheck their final pins and tests before branching. No published branch rewrite, push, merge, deployment, subscription or scheduled snapshot collection.
- Source tables own acquisition and explicit preparation. No hidden fetches/joins/FX, guessed units, inferred historical vintages, runtime proof in settings, or unknown-to-complete promotion. Verify source readiness before enabling a real route.
- Preserve raw unsafe facts and coordinate-only omissions through TypeScript, compiled Rust and linked descendants. Use closed versioned settings, original units, bounded escaped text, distinct zero/missing/error states and source repair.
- Follow-latest defaults resolve only acquired observations at runtime; explicit pins disappearing on reacquisition refuse without substitution. Semantic choices reset revision; same-question refresh and viewport do not.
- Apply draft/applied, source-status ownership, late worker/draw fencing and touch/overflow behavior from the existing three-chart implementation. Independently review each task and the complete family; measure module/worker bytes separately.

## Review Focus

- A boundedpage is not S&P500; enforce mode/title against sourceevidence.
- Completedclose-to-close is not intraday; test sessioncontract refusal.
- Root/sector sums equal observedleafareas without parentdoublecount; independent test.
- Hidden currency/session/member conflicts remain unsafe before areaexclusions.
- Tiny cells, duplicate labels and filterdrill cannot erase exactaccessible values.

---

## File map and frozen interfaces

Provider new `models/_market_map_source.py`, `tests/test_market_map_source.py`; extend `models/screener.py` only for documented additive fields/evidence, never synthesize index components. BDOBB `chartRecipes/marketMap.ts`, `.test.ts`, `marketMapEvidence.ts`, `.test.ts`, `plotly.ts`; controls/dispatch; `e2e/market-map.spec.ts`.

Options are exactly `{version:1,kind:'market-map',mode:'delivered-cap'|'index-weight',universe:string,session:'latest'|string,fields:{listing:string,sector:string,area:string,change:string,session:string}}`. Figure builders use `(dataset: WidgetDataset, options: RecipeOptions, context: RecipeContext): RecipeResult`; `buildMarketMap` is the family entry point unless the KPI-specific signature below applies. `ChartBuildResult<T>` comes from the foundation. Family source decoder `parseMarketMapSource(value: unknown): MarketMapSource | undefined` is strict and closed; reuse the existing price decoder instead for return summaries.

**Frozen source shape:** MarketMapSource extends the common receipt with `mode:'delivered-cap'|'index-weight'`, `universe:string`, `session:string`, `return_basis:'completed-close-to-close-fraction'`, `area_basis:'listing-currency-cap'|'index-weight-fraction'`, `denomination:string|null`, `membership_as_of:string|null`, `coverage:'complete'|'bounded'|'partial'|'sample'|'unknown'`, `rounding_bound_fraction:number|null`, and `unsafe:{identity_conflict:boolean,session_conflict:boolean,denomination_conflict:boolean,membership_conflict:boolean,duplicate_conflict:boolean,excess_weight:boolean}`. Mode-specific decoder requires denomination for cap or authoritative membership/weight-validity reference for index. All source IDs/units are checked against the recorded preparation contract.

### Task 1: Prove and implement the acquired source contract

**Files:** Source/evidence paths in the map; add `docs/chart-contracts/market-map.md` in the canonical provider when provider work applies.

**Interfaces:** Consumes foundation capture/projection hooks; produces the family source decoder and validated runtime facts: qualified listings, same completed close-to-close session, normalized one-session return, area basis, acquisition vintage and raw cohort currency/session/duplicate flags; capmode common denomination and latest same-acquisition cap facts; indexmode authoritative named membership/weights and validity for session plus completeness/rounding contract.

- [ ] Write source-bound fixtures and tests for the first two Review Focus hazards, plus contradictory/missing evidence, counts, hidden unsafe rows, aliases, grandchild projection and legacy requests. Preserve source pre-drop facts; a query flag or saved setting cannot grant certification.
- [ ] Run provider `python -m pytest tests/test_market_map_source.py -q` and the new BDOBB evidence suite; expect missing contract/decoder assertions.
- [ ] Record authoritative source fields/units/date meaning and captured representative payloads in the contract document. Verdict is `ready` only when every required fact is evidenced; otherwise record exact `blocked-source` facts, keep that real route disabled and test honest refusal. Explicit acquired local snapshots can exercise builders, but are not evidence of live availability. Do not invent a new upstream endpoint, archive or entitlement.
- [ ] Implement additive opt-in `chart_source` normalization using `AnnotatedResult.metadata.chart_sources`, a single existing acquisition and family-specific closed Pydantic/TS variants. Raw diagnostics precede drops. Preserve default legacy errors/results. For prepared/vintage sources, implement explicit snapshot validation only until the documented real contract exists. Register only proven completed-request route/selector/identity matches.
- [ ] Rerun the same source tests plus compiled Rust linked evidence tests when projection changes; expect closed parser rejection and legacy compatibility. Commit only source-contract/evidence changes as `feat: validate market-map acquisition contracts`. Record readiness verdict for the family reviewer.

### Task 2: Implement the mathematical builder and truthful figure

**Files:** Builder/test module from file map; dispatch only its implemented kind (KPI uses its separate typed worker).

**Interfaces:** Consumes Task1 evidence and frozen options; produces builder and pure data helpers below.

- [ ] Add failing tests named `known_result`, `zero_missing_and_scope`, `hidden_unsafe_fact`, `numerical_limits`, and the remaining three Review Focus cases. Concrete assertions include `expect(root.value).toBe(300); expect(sectorChildren.map(x=>x.value)).toEqual([100,200]);` Pin these cases: cap areas100/200 total300 without normalization; partial screener page title delivered sample; absent performance is unavailable distinctzero; mixedrawcurrency/session hidden byfilters refuses; namedindex withoutmembership/weightproof refuses; partialindex weights>1 beyondbound refuses.
- [ ] Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/marketMap.test.ts`; expect missing builder or wrong-result assertions.
- [ ] Implement `buildMarketHierarchy(dataset, options): ChartBuildResult<MarketMapHierarchy>` derives sector/root areas from included positive leaves. No double-counted parent observations. Capmode can use boundedpage but color only verifiedcompletedclose-to-close return; show capretrieval vs pricesession separately. No older separate area snapshot rollforward. Index totalcomplete=1 within declaredsumrounding cap1e-4 (or1e-12 withoutprecision); partialtotal>1 samebound refuses. Never transform cap into indexweight. Color fixed symmetric sample bound max(abs(change)) with a zero-only fallback of +/- .01 fraction (one percentage point); with no valid returns hide the scale and mark all performance unavailable, original changes in hover; missing uses separate unavailablefill. All labels/hover are escaped, original values remain available, and nonfinite/unfaithful render geometry refuses rather than silently dropping required observations.
- [ ] Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/marketMap.test.ts` and affected shared math/evidence tests; expect the exact results and refusal/summary assertions to pass. Render an ordinary and extreme figure with installed Plotly, inspecting actual ranges/path or bands rather than JSON alone.
- [ ] Commit scoped builder/tests and own dispatch as `feat: build market-map analytics`.

### Task 3: Integrate controls, persistence and browser acceptance

**Files:** Existing controls/renderers/settings/bindings/worker/app decoders; named e2e file and fixture; create `docs/examples/v9-next-market-map/` and matching `.apps.json`; help/release notes. Register fixture-only manifests explicitly in apps-sync without distributing unresolved IDs.

**Interfaces:** Consumes Tasks1–2 and the closed options; produces discoverable source-backed controls and reacquired portable examples.

- [ ] Add failing decoder/parent/browser tests: strict unknown-key/version rejection, missing evidence disables Apply, incompatible draft retains applied output, invalid applied/import clears, A→B pending/failure/recovery, same-source stale output with one parent alert, obsolete worker/draw rejection, local draw error, pinned-missing repair and same-question resize. Delivered capitalization default; named-index disabled until proof. Latest/pinned completed session and sector drill, no hiddenquotes. Register only treemap and update derivedallowlist. Test actualrootarea/hover/tap/drillreset/narrowlabels and no percentindex claim for monetaryareas.
- [ ] Run the affected Vitest parent/decoder suites and `pnpm exec playwright test e2e/market-map.spec.ts --project=chromium`; expect missing controls/acceptance assertions before integration.
- [ ] Implement controls/defaults/repair and source acquisition; keep semantic revision separate from viewport. Integrate only the stated module/renderer and derived allowlist. Add explanatory examples/help for positive acquired snapshots and unavailable live contracts; never advertise a fixture as a verified live feed.
- [ ] Rerun those tests, typecheck, lint, scrub and example-import tests. Inspect real Chromium screenshots in light/dark/narrow/touch; test original-value hover, gestures and new-page requests after export/import. Run affected existing chart browsers once; record exact tests/skips and module/worker byte deltas.
- [ ] Commit scoped integration/examples as `feat: integrate market-map controls and acceptance`. Request an independent family review; fix findings with regressions and scoped re-review. The orchestration plan owns final paired provider/Docker shipping gates. A blocked real source remains a disclosed readiness blocker, never a claim of full live feature completion.

## Self-review and handoff

Each specification requirement has an owner: source/evidence Task1, calculations/geometry Task2, UI/lifecycle/persistence/browser/docs Task3, final packaging in the orchestration plan. Review Focus cases are explicitly assigned to source or builder/parent tests. This plan describes future checks, not passing implementation results. Preserve the user's subagent execution preference and independent final review, the user approved implementation on 2026-11-19.
