# News-Sentiment Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render delivered news sentiment by UTC day, with scored/unscored counts and honest sample scope.

**Architecture:** Extend CompanyNews acquisition evidence and use a worker-owned daily aggregation with the registered heatmap trace. No news-coverage or trading-signal claim is inferred from a delivered page.

**Tech Stack:** Existing TypeScript/React/Plotly and worker/table engines; Python/Pydantic canonical provider; Vitest, Playwright and Docker.

**Spec:** [Approved specification](../specs/2026-11-19-v9-next-news-sentiment-calendar-design.md).

## Global Constraints

- Read the approved family specification and [shared roadmap](../specs/2026-11-19-v9-next-eight-charts-design.md). The user approved specifications for planning; implementation awaits review of these plans.
- Start after the shared foundation in the [orchestration plan](2026-11-19-v9-next-eight-charts.md). Existing three-chart changes remain a separate candidate; recheck their final pins and tests before branching. No published branch rewrite, push, merge, deployment, subscription or scheduled snapshot collection.
- Source tables own acquisition and explicit preparation. No hidden fetches/joins/FX, guessed units, inferred historical vintages, runtime proof in settings, or unknown-to-complete promotion. Verify source readiness before enabling a real route.
- Preserve raw unsafe facts and coordinate-only omissions through TypeScript, compiled Rust and linked descendants. Use closed versioned settings, original units, bounded escaped text, distinct zero/missing/error states and source repair.
- Follow-latest defaults resolve only acquired observations at runtime; explicit pins disappearing on reacquisition refuse without substitution. Semantic choices reset revision; same-question refresh and viewport do not.
- Apply draft/applied, source-status ownership, late worker/draw fencing and touch/overflow behavior from the existing three-chart implementation. Independently review each task and the complete family; measure module/worker bytes separately.

## Review Focus

- Hidden raw invalid date/identity still refuses; test source projection and grandchild.
- Missing polarity and exactly neutral score remain different; test all-unscored day.
- Article ID shared across pages cannot inflate counts; test identical/conflicting duplicates.
- UTC midnight/leap-year boundaries do not shift calendar cells; test timestamps with offsets.
- Pinned window absent after reload refuses; test real import/reacquisition.

---

## File map and frozen interfaces

Provider `models/news.py`, new `models/_news_chart_source.py`, `tests/test_news.py`, `tests/test_news_chart_source.py`; BDOBB `chartRecipes/newsCalendar.ts`, `.test.ts`, `newsEvidence.ts`, `.test.ts`; existing recipe settings/bindings/dispatch, linked controls and `e2e/news-calendar.spec.ts`.

Options are exactly `{version:1,kind:'news-sentiment-calendar',fields:{timestamp:string,articleId:string,instrument:string,polarity:string},instrument:string,window:{mode:'latest-12-months'}|{mode:'pinned',start:string,end:string}}`. Figure builders use `(dataset: WidgetDataset, options: RecipeOptions, context: RecipeContext): RecipeResult`; `buildNewsCalendar` is the family entry point unless the KPI-specific signature below applies. `ChartBuildResult<T>` comes from the foundation. Family source decoder `parseNewsSource(value: unknown): NewsSource | undefined` is strict and closed; reuse the existing price decoder instead for return summaries.

**Frozen source shape:** NewsSource extends the common receipt with `instrument:string`, `polarity_unit:'polarity[-1,1]'`, `coordinates:{article_id:string,utc_day:string,scored:boolean}[]`, `scope:{kind:'complete'|'bounded'|'partial'|'sample'|'unknown',start:string|null,end:string|null,limit:number|null,offset:number|null}`, and `unsafe:{invalid_identity:boolean,invalid_timestamp:boolean,duplicate_conflict:boolean,unit_conflict:boolean}`. `field_origins` has exactly timestamp/articleId/instrument/polarity with adapter-verified literals; invalid/undated raw articles set unsafe before drop. No polarity value or article body is carried for hidden coordinates.

### Task 1: Prove and implement the acquired source contract

**Files:** Source/evidence paths in the map; add `docs/chart-contracts/news-sentiment-calendar.md` in the canonical provider when provider work applies.

**Interfaces:** Consumes foundation capture/projection hooks; produces the family source decoder and validated runtime facts: qualified instrument, UTC timestamp origin, canonical article ID/URL origin, verified polarity range [-1,1], query scope, raw invalid timestamp/identity and conflicting-duplicate flags, acquired article coordinates and scored/unscored classification (no hidden article body).

- [ ] Write source-bound fixtures and tests for the first two Review Focus hazards, plus contradictory/missing evidence, counts, hidden unsafe rows, aliases, grandchild projection and legacy requests. Preserve source pre-drop facts; a query flag or saved setting cannot grant certification.
- [ ] Run provider `python -m pytest tests/test_news_chart_source.py -q` and the new BDOBB evidence suite; expect missing contract/decoder assertions.
- [ ] Record authoritative source fields/units/date meaning and captured representative payloads in the contract document. Verdict is `ready` only when every required fact is evidenced; otherwise record exact `blocked-source` facts, keep that real route disabled and test honest refusal. Explicit acquired local snapshots can exercise builders, but are not evidence of live availability. Do not invent a new upstream endpoint, archive or entitlement.
- [ ] Implement additive opt-in `chart_source` normalization using `AnnotatedResult.metadata.chart_sources`, a single existing acquisition and family-specific closed Pydantic/TS variants. Raw diagnostics precede drops. Preserve default legacy errors/results. For prepared/vintage sources, implement explicit snapshot validation only until the documented real contract exists. Register only proven completed-request route/selector/identity matches.
- [ ] Rerun the same source tests plus compiled Rust linked evidence tests when projection changes; expect closed parser rejection and legacy compatibility. Commit only source-contract/evidence changes as `feat: validate news-sentiment-calendar acquisition contracts`. Record readiness verdict for the family reviewer.

### Task 2: Implement the mathematical builder and truthful figure

**Files:** Builder/test module from file map; dispatch only its implemented kind (KPI uses its separate typed worker).

**Interfaces:** Consumes Task1 evidence and frozen options; produces builder and pure data helpers below.

- [ ] Add failing tests named `known_result`, `zero_missing_and_scope`, `hidden_unsafe_fact`, `numerical_limits`, and the remaining three Review Focus cases. Concrete assertions include `expect(days['2026-11-19']).toMatchObject({mean: 0, scored: 2, delivered: 3});` Pin these cases: two scored polarities -1/+1 plus one missing score produce mean0/scored2/delivered3; no delivered day is missing, not neutral; duplicate ID conflict refuses; one multitag article counts once for selected instrument; midnight UTC and leap day group correctly.
- [ ] Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/newsCalendar.test.ts`; expect missing builder or wrong-result assertions.
- [ ] Implement `aggregateNewsDays(dataset, options): ChartBuildResult<NewsCalendarData>` groups only presented, deduplicated delivered articles on UTC day. Use compensated bounded sums; mean requires at least one valid score. Render fixed color domain [-1,1], explicit missing/unscored masks and accessible counts. Default latest acquired date minus 12 calendar months; clamp leap-day bounds by calendar arithmetic, not milliseconds. All labels/hover are escaped, original values remain available, and nonfinite/unfaithful render geometry refuses rather than silently dropping required observations.
- [ ] Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/newsCalendar.test.ts` and affected shared math/evidence tests; expect the exact results and refusal/summary assertions to pass. Render an ordinary and extreme figure with installed Plotly, inspecting actual ranges/path or bands rather than JSON alone.
- [ ] Commit scoped builder/tests and own dispatch as `feat: build news-sentiment-calendar analytics`.

### Task 3: Integrate controls, persistence and browser acceptance

**Files:** Existing controls/renderers/settings/bindings/worker/app decoders; named e2e file and fixture; create `docs/examples/v9-next-news-sentiment-calendar/` and matching `.apps.json`; help/release notes. Register fixture-only manifests explicitly in apps-sync without distributing unresolved IDs.

**Interfaces:** Consumes Tasks1–2 and the closed options; produces discoverable source-backed controls and reacquired portable examples.

- [ ] Add failing decoder/parent/browser tests: strict unknown-key/version rejection, missing evidence disables Apply, incompatible draft retains applied output, invalid applied/import clears, A→B pending/failure/recovery, same-source stale output with one parent alert, obsolete worker/draw rejection, local draw error, pinned-missing repair and same-question resize. Chart label News sentiment calendar; instrument choice only from acquired facts, latest/pinned calendar window, delivered/scored article counts and query page/retrieval scope. Add no module. Test actual heatmap cell hover/tap, no-score labels, keyboard summary, both engines, new-page reacquisition and error ownership.
- [ ] Run the affected Vitest parent/decoder suites and `pnpm exec playwright test e2e/news-calendar.spec.ts --project=chromium`; expect missing controls/acceptance assertions before integration.
- [ ] Implement controls/defaults/repair and source acquisition; keep semantic revision separate from viewport. Integrate only the stated module/renderer and derived allowlist. Add explanatory examples/help for positive acquired snapshots and unavailable live contracts; never advertise a fixture as a verified live feed.
- [ ] Rerun those tests, typecheck, lint, scrub and example-import tests. Inspect real Chromium screenshots in light/dark/narrow/touch; test original-value hover, gestures and new-page requests after export/import. Run affected existing chart browsers once; record exact tests/skips and module/worker byte deltas.
- [ ] Commit scoped integration/examples as `feat: integrate news-sentiment-calendar controls and acceptance`. Request an independent family review; fix findings with regressions and scoped re-review. The orchestration plan owns final paired provider/Docker shipping gates. A blocked real source remains a disclosed readiness blocker, never a claim of full live feature completion.

## Self-review and handoff

Each specification requirement has an owner: source/evidence Task1, calculations/geometry Task2, UI/lifecycle/persistence/browser/docs Task3, final packaging in the orchestration plan. Review Focus cases are explicitly assigned to source or builder/parent tests. This plan describes future checks, not passing implementation results. Preserve the user's subagent execution preference and independent final review, but wait for review of this plan before starting new implementation.
