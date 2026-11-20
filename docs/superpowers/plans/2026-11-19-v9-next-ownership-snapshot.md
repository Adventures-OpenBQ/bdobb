# Ownership Snapshot and Waffle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show independent ownership measures and permit waffle only for acquired certified partitions.

**Architecture:** Normalize ShareStatistics unit/date/class facts and render independent bars by default. A separate strict partition-source variant can drive a 100-cell waffle; the present insider/institution/float fields do not certify that variant.

**Tech Stack:** Existing TypeScript/React/Plotly and worker/table engines; Python/Pydantic canonical provider; Vitest, Playwright and Docker.

**Spec:** [Approved specification](../specs/2026-11-19-v9-next-ownership-snapshot-design.md).

## Global Constraints

- Read the approved family specification and [shared roadmap](../specs/2026-11-19-v9-next-eight-charts-design.md). The user approved these plans for implementation with subagents and independent final review on 2026-11-19.
- Start after the shared foundation in the [orchestration plan](2026-11-19-v9-next-eight-charts.md). Existing three-chart changes remain a separate candidate; recheck their final pins and tests before branching. No published branch rewrite, push, merge, deployment, subscription or scheduled snapshot collection.
- Source tables own acquisition and explicit preparation. No hidden fetches/joins/FX, guessed units, inferred historical vintages, runtime proof in settings, or unknown-to-complete promotion. Verify source readiness before enabling a real route.
- Preserve raw unsafe facts and coordinate-only omissions through TypeScript, compiled Rust and linked descendants. Use closed versioned settings, original units, bounded escaped text, distinct zero/missing/error states and source repair.
- Follow-latest defaults resolve only acquired observations at runtime; explicit pins disappearing on reacquisition refuse without substitution. Semantic choices reset revision; same-question refresh and viewport do not.
- Apply draft/applied, source-status ownership, late worker/draw fencing and touch/overflow behavior from the existing three-chart implementation. Independently review each task and the complete family; measure module/worker bytes separately.

## Review Focus

- Overlap cannot be turned into a partition; test ordinary ShareStatistics refusal.
- Percent points versus fractions are fixed by contract; test .5 and50 without guessing.
- Class/date/denominator conflicts hidden by filters remain unsafe; both engines.
- Rounding allocation totals100 without altering reported shares; test ties and residual.
- Unknown date and zero ownership remain distinct from missing; actual summary/hover test.

---

## File map and frozen interfaces

Provider `models/profile.py`, new `models/_ownership_chart_source.py`, `tests/test_ownership_chart_source.py`; BDOBB `chartRecipes/ownershipSnapshot.ts`, `.test.ts`, `ownershipEvidence.ts`, `.test.ts`; controls/settings/dispatch; `e2e/ownership-snapshot.spec.ts`.

Options are exactly `{version:1,kind:'ownership-snapshot',issuer:string,view:'bars',fields:{insiders?:string,institutions?:string,freeFloat?:string}}|{version:1,kind:'ownership-snapshot',issuer:string,view:'waffle',fields:{bucket:string,share:string}}`. Figure builders use `(dataset: WidgetDataset, options: RecipeOptions, context: RecipeContext): RecipeResult`; `buildOwnershipSnapshot` is the family entry point unless the KPI-specific signature below applies. `ChartBuildResult<T>` comes from the foundation. Family source decoder `parseOwnershipSource(value: unknown): OwnershipSource | undefined` is strict and closed; reuse the existing price decoder instead for return summaries.

**Frozen source shape:** OwnershipSource extends the common receipt with `issuer:string`, `share_class:string`, `measures` keyed only insiders/institutions/freeFloat (each `{unit:'percent-points'|'fraction',basis:'shares-outstanding',as_of:string|null}`), `partition:{status:'unavailable'}|{status:'verified',as_of:string,denominator:'outstanding-shares',exclusive:true,exhaustive:true,rounding_bound_percent:number,reference:string}`, and `unsafe:{identity_conflict:boolean,unit_conflict:boolean,date_conflict:boolean,partition_conflict:boolean}`. date_conflict means contradictory declarations for the same observation, not merely independently dated bar measures. `field_origins` maps only the declared measure or bucket/share roles.

### Task 1: Prove and implement the acquired source contract

**Files:** Source/evidence paths in the map; add `docs/chart-contracts/ownership-snapshot.md` in the canonical provider when provider work applies.

**Interfaces:** Consumes foundation capture/projection hooks; produces the family source decoder and validated runtime facts: qualified issuer/share class, source units per measure, field-specific measurement date or explicit unknown, acquisition vintage, raw contradictions; partition variant additionally common denominator, exhaustive/mutually-exclusive certificate, canonical bucket keys and declared rounding bounds.

- [ ] Write source-bound fixtures and tests for the first two Review Focus hazards, plus contradictory/missing evidence, counts, hidden unsafe rows, aliases, grandchild projection and legacy requests. Preserve source pre-drop facts; a query flag or saved setting cannot grant certification.
- [ ] Run provider `python -m pytest tests/test_ownership_chart_source.py -q` and the new BDOBB evidence suite; expect missing contract/decoder assertions.
- [ ] Record authoritative source fields/units/date meaning and captured representative payloads in the contract document. Verdict is `ready` only when every required fact is evidenced; otherwise record exact `blocked-source` facts, keep that real route disabled and test honest refusal. Explicit acquired local snapshots can exercise builders, but are not evidence of live availability. Do not invent a new upstream endpoint, archive or entitlement.
- [ ] Implement additive opt-in `chart_source` normalization using `AnnotatedResult.metadata.chart_sources`, a single existing acquisition and family-specific closed Pydantic/TS variants. Raw diagnostics precede drops. Preserve default legacy errors/results. For prepared/vintage sources, implement explicit snapshot validation only until the documented real contract exists. Register only proven completed-request route/selector/identity matches.
- [ ] Rerun the same source tests plus compiled Rust linked evidence tests when projection changes; expect closed parser rejection and legacy compatibility. Commit only source-contract/evidence changes as `feat: validate ownership-snapshot acquisition contracts`. Record readiness verdict for the family reviewer.

### Task 2: Implement the mathematical builder and truthful figure

**Files:** Builder/test module from file map; dispatch only its implemented kind (KPI uses its separate typed worker).

**Interfaces:** Consumes Task1 evidence and frozen options; produces builder and pure data helpers below.

- [ ] Add failing tests named `known_result`, `zero_missing_and_scope`, `hidden_unsafe_fact`, `numerical_limits`, and the remaining three Review Focus cases. Concrete assertions include `expect(allocateWaffle([{id:'a',percent:33.3},{id:'b',percent:33.3},{id:'c',percent:33.4}])).toEqual({a:33,b:33,c:34});` Pin these cases: ordinary insider/institution/float measures never admit waffle; percentages normalize exactly once; missing date stays unknown; 33.3/33.3/33.4 yields33/33/34; equal remainders tie by canonical ID; sum outside acquired rounding bound refuses; float cannot be subtracted into retail.
- [ ] Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/ownershipSnapshot.test.ts`; expect missing builder or wrong-result assertions.
- [ ] Implement `allocateWaffle(buckets: readonly OwnershipBucket[]): Record<string,number>` uses floors then largest remainders only after independently certified partition admission. Cap total discrepancy at .01 percentage point AND acquired rounding bounds (or1e-10 cancellation without precision). Do not rewrite original shares. Bars admit finite [0,100] percentages individually with explicit units; no stacking/retail remainder. Expose zero, unavailable, unknown date separately. All labels/hover are escaped, original values remain available, and nonfinite/unfaithful render geometry refuses rather than silently dropping required observations.
- [ ] Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/ownershipSnapshot.test.ts` and affected shared math/evidence tests; expect the exact results and refusal/summary assertions to pass. Render an ordinary and extreme figure with installed Plotly, inspecting actual ranges/path or bands rather than JSON alone.
- [ ] Commit scoped builder/tests and own dispatch as `feat: build ownership-snapshot analytics`.

### Task 3: Integrate controls, persistence and browser acceptance

**Files:** Existing controls/renderers/settings/bindings/worker/app decoders; named e2e file and fixture; create `docs/examples/v9-next-ownership-snapshot/` and matching `.apps.json`; help/release notes. Register fixture-only manifests explicitly in apps-sync without distributing unresolved IDs.

**Interfaces:** Consumes Tasks1–2 and the closed options; produces discoverable source-backed controls and reacquired portable examples.

- [ ] Add failing decoder/parent/browser tests: strict unknown-key/version rejection, missing evidence disables Apply, incompatible draft retains applied output, invalid applied/import clears, A→B pending/failure/recovery, same-source stale output with one parent alert, obsolete worker/draw rejection, local draw error, pinned-missing repair and same-question resize. Default independent labeled bars; waffle choice disabled with partition repair reason on ordinary data. Existing bar/scatter only. Test 100 cells, exact source percentages, narrow/touch and as-of/retrieval copy, draft retention and no saved certification.
- [ ] Run the affected Vitest parent/decoder suites and `pnpm exec playwright test e2e/ownership-snapshot.spec.ts --project=chromium`; expect missing controls/acceptance assertions before integration.
- [ ] Implement controls/defaults/repair and source acquisition; keep semantic revision separate from viewport. Integrate only the stated module/renderer and derived allowlist. Add explanatory examples/help for positive acquired snapshots and unavailable live contracts; never advertise a fixture as a verified live feed.
- [ ] Rerun those tests, typecheck, lint, scrub and example-import tests. Inspect real Chromium screenshots in light/dark/narrow/touch; test original-value hover, gestures and new-page requests after export/import. Run affected existing chart browsers once; record exact tests/skips and module/worker byte deltas.
- [ ] Commit scoped integration/examples as `feat: integrate ownership-snapshot controls and acceptance`. Request an independent family review; fix findings with regressions and scoped re-review. The orchestration plan owns final paired provider/Docker shipping gates. A blocked real source remains a disclosed readiness blocker, never a claim of full live feature completion.

## Self-review and handoff

Each specification requirement has an owner: source/evidence Task1, calculations/geometry Task2, UI/lifecycle/persistence/browser/docs Task3, final packaging in the orchestration plan. Review Focus cases are explicitly assigned to source or builder/parent tests. This plan describes future checks, not passing implementation results. Preserve the user's subagent execution preference and independent final review, the user approved implementation on 2026-11-19.
