# v9 Chart Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver drawdown, historical yield curves, guarded estimate ranges, monthly returns and correlation in BDOBB v9, integrating existing bullet and waterfall implementations.

**Architecture:** Each chart links to one presented table through `executor.chartData(revision, fields, signal)`. Pure TypeScript recipes derive figures in a dedicated worker after the existing executor returns its revision-qualified dataset; legacy linked figures stay on their current path. openbq-eodhd owns guarded estimates and normalized data; openbq-docker vendors that canonical source and verifies the paired v9 catalogue.

**Tech Stack:** TypeScript, React, existing table executors/Web Workers, Plotly.js 3.7-compatible partial bundle, Vitest, Playwright, Python >=3.10, OpenBB provider extension, pytest.

**Spec:** [Approved design](../specs/2026-11-19-v9-chart-expansion-design.md), committed as `7c6a7046`; user approved in chat on 2026-11-19. Also read the linked bullet/composition designs and the v4 waterfall design referenced there.

## Global Constraints

- “All seven use the existing linked-card creation flow and `WidgetDataset` contract.”
- “No cross-widget join or portfolio subsystem is introduced.”
- “Chart settings cannot expand acquisition bounds.”
- “For the new history recipes, `partial`, `paged`, `sample` and `unknown` acquisition completeness refuse calculations and explain that the source must be fully loaded.”
- “No full Plotly bundle, new visualization dependency or version upgrade.”
- “No public push, merge, deployment or later-release carry is authorized by writing this design.”
- “Any discovery that requires new data acquisition, removes one of the seven deliverables or changes the financial definitions returns for design review.”
- Keep AGPL-3.0-only headers in BDOBB and Apache-2.0 headers in provider/package sources. No credential values in tests, logs or example dashboards.

## Review Focus

- Late worker results after changing source/settings must never replace the current chart (Task 9).
- Filters that remove intervening prices must not create a return across that known gap (Task 4).
- Non-US trading calendars and weekend month ends must not fabricate missing weekday prices or reject an otherwise covered month (Tasks 6–7).
- A restored dashboard with a removed/hidden binding must explain repair and clear the old chart (Tasks 3, 9).
- Renamed package imports and stale docker provenance pins must fail verification rather than ship two provider algorithms (Tasks 1–2, 10).

## Repository preparation and dependency map

This plan is stored in the existing clean bullet worktree for review only. At execution, invoke using-git-worktrees, inspect AGENTS.md, dirty state and `git rev-parse --git-dir/--git-common-dir` for each repository. Create isolated execution worktrees/branches `codex/v9-chart-expansion` (BDOBB), `codex/v9-chart-estimates` (provider), and `codex/v9-chart-package` (docker), preserving all unrelated working changes. Use current `origin/release/v9` for BDOBB/docker when verified present; provider uses its verified v9-compatible baseline. Record full base hashes; do not assume a branch exists or use the article repository.

Read-only donor roots already located:
- BDOBB bullet: `/Users/artcashin/Developer/openbq-bdobb-v9-bullet`, tip inspected `baf9ed7d` before design commits.
- BDOBB waterfall: `/Users/artcashin/Developer/openbq-bdobb-v4-waterfall`, `78219efe`.
- Docker bullet/provider: `/Users/artcashin/Developer/openbq-docker-v9-bullet`, `1982719`.
- Canonical provider: `/Users/artcashin/Developer/openbq-eodhd`, snapshot `5341fbf`.

Use `git log BASE..DONOR -- <paths>` and inspect each patch to identify feature commits and dependencies. Port selected changes, not donor branch tips or entire v4 trees. Record full hashes/paths in `docs/releases/validation/v9/chart-expansion/dependencies.md` in BDOBB. Bring this spec and plan into the execution worktree as documentation only. Capture the baseline production bundle bytes before feature integration with `pnpm install --frozen-lockfile` and `pnpm build`; retain build output summary for comparison.

Tasks 1–2 establish upstream inputs. Tasks 3–4 establish shared interfaces. Tasks 5–8 implement recipes. Task 9 exposes them. Task 10 integrates packaging/demo and closes verification. Do not parallelize tasks sharing settings, renderer or worker files.

## File ownership and fixed interfaces

Paths below are relative to the repository named on each task. Existing files were located in the inspected worktrees; new paths are deliberate additions.

- Provider `openbq_eodhd/models/earnings_vs_estimates.py`: guarded join port; `_fundamentals.py`: v1.1 cache/helper port; registry/router and tests: discoverability.
- BDOBB `src/lib/widgetData/chartRecipes/types.ts`: `RecipeOptions`, `RecipeContext`, `RecipeResult`; `settings.ts`: validation, required fields, type changes; `input.ts`: scope/identity/price preparation; one file per recipe; `run.ts`: pure dispatch.
- BDOBB `src/lib/widgetData/chartRecipes/recipe.worker.ts`, `workerClient.ts`: asynchronous, cancellable transformation of an existing dataset, no fetching and no Plotly runtime imports.
- BDOBB `src/components/renderers/LinkedChartRenderer.tsx`: source request and result lifecycle; new `LinkedChartRecipeControls.tsx`: controls only. Keep the existing `ChartRenderer` render/resize/purge seam.
- Existing `types.ts`, `appsExtensionsV4.ts`, persistence and test files: legacy compatibility and serialization. Existing `plotly.ts`: only trace registration/redraw integration.

New discriminants: `drawdown`, `yield-curve`, `estimate-range`, `monthly-returns`, `correlation`. `LinkedChartSettings` retains existing fields; new `recipe?: RecipeOptions` is discriminated by `version: 1` and `kind` matching `type`.

```ts
type PriceBindings = { date: string; price: string; symbol?: string };
type RecipeOptions =
 | { version: 1; kind: 'drawdown'; fields: PriceBindings; symbols: string[] }
 | { version: 1; kind: 'yield-curve'; fields: { date: string; maturity: string; rate: string } }
 | { version: 1; kind: 'estimate-range'; fields: { periodEnd: string; fiscalPeriod?: string; status: string; note?: string; low: string; average: string; high: string }; metric: 'eps' | 'revenue' }
 | { version: 1; kind: 'monthly-returns'; fields: PriceBindings; symbol: string }
 | { version: 1; kind: 'correlation'; fields: PriceBindings; symbols: string[]; lookback: number; minOverlap: number };
type RecipeContext = { theme: 'light' | 'dark'; maxDecimals: number; today: string };
// RecipeResult aliases the existing LinkedFigureResult success/refusal/error shape.
// Successful revision is a stable question key, NOT an output-revision token.
```

`runRecipe(dataset: WidgetDataset, options: RecipeOptions, context: RecipeContext): RecipeResult` is the worker's only analytical entry point. Each `build<Name>(dataset, options: Extract<RecipeOptions,{kind: KIND}>, context): RecipeResult` has the same argument order. `requiredRecipeFields(options): string[]` returns deduplicated presented fields. `validateRecipeOptions(value: unknown, chartType: string): RecipeOptions | null` rejects invalid/unknown combinations. `recipeEligibility(dataset, options): string | null` returns a refusal reason.

Separate recomputation identity (request generation, source/result/output revisions, options, theme and precision) from `layout.uirevision` (source widget, recipe, bindings, selected symbols/window). A refresh recalculates without resetting zoom; a changed question resets it. Pass `today` as a YYYY-MM-DD calendar date from the app clock, not a UTC timestamp guessed inside the worker.

## Tasks
### Task 1: Port guarded reported-quarter data to the canonical provider

**Repository:** openbq-eodhd

**Files:** Create `openbq_eodhd/models/earnings_vs_estimates.py`, `tests/test_earnings_vs_estimates.py`; modify `openbq_eodhd/models/_fundamentals.py`, `openbq_eodhd/__init__.py`, `openbq_eodhd/eodhd_router.py`, `tests/test_fundamentals_cache.py`, `tests/test_provider_registration.py`, `tests/test_eodhd_router.py`.

**Interfaces:** Preserve donor `EODHDEarningsVsEstimatesFetcher`/Data/QueryParams and `get_earnings_v11(symbol, exchange, credentials)` helper signature as actually defined by the donor. Produce model key `EarningsVsEstimates`, mirror `/equity/estimates/earnings_vs_estimates`, columns `symbol`, `period_ending`, `fiscal_period`, `report_date`, metric siblings and band status/note.

- [ ] **Step 1: Add or carry the regression tests**

Carry the donor recorded/mock fixtures. Pin named tests for `band_check`: 1.03 vs 1.00 passes, 1.11 vs 1.00 withholds, zero/missing consensus withholds, absent Trend is no_estimate. Assert withholding clears all Trend-derived EPS/revenue/count/growth fields while actual/History consensus remain. Assert quarterly/annual separation, fiscal Q4 outlier, unknown fiscal-year-end, null revenue, negative/zero year-ago growth behavior and isolated v1.1 cache keys. Verify the mirror is the only intended addition; package imports use `openbq_eodhd`.

Contract assertions (fixture/result variables are local to the named test):

```python
assert band_check(1.03, 1.00, True)[0] == 'ok'
assert band_check(1.11, 1.00, True)[0] == 'withheld'
assert band_check(1.00, 0.00, True)[0] == 'withheld'
```

- [ ] **Step 2: Verify the regression fails before the change**

Run `python -m pytest tests/test_earnings_vs_estimates.py tests/test_fundamentals_cache.py tests/test_provider_registration.py tests/test_eodhd_router.py -q`. Expect the named new behavior to fail (or missing module/route), not an unrelated environment failure. For carried work, run donor tests against the pre-port target first; do not invent a new failing test merely to duplicate a passing donor test.

- [ ] **Step 3: Implement the change**

Port only the guarded join, cache helper and registration patches from the docker donor. Preserve existing guard, percent formats and reported-EPS descriptions; do not rewrite financial arithmetic from memory. Keep credentials in existing client utilities. Test standard-route parity in an environment with its declared standard routers; do not skip parity failures to pass the gate.

- [ ] **Step 4: Verify the task**

Run `python -m pytest tests/test_earnings_vs_estimates.py tests/test_fundamentals_cache.py tests/test_provider_registration.py tests/test_eodhd_router.py -q` again; expect all selected tests to pass. Inspect the diff for scope and run `git diff --check`.

- [ ] **Step 5: Commit the task's listed files only**

Use `git add -- <explicit changed paths from this task>` after inspecting status, then `git commit -m "feat(eodhd): port guarded reported earnings comparisons"`. Do not stage the whole worktree.

### Task 2: Integrate existing linked composition, bullet and waterfall

**Repository:** bdobb

**Files:** Modify `src/lib/widgetData/{types,chartFigure,bulletFigure,waterfallFigure}.ts`, their `.test.ts` files, `src/lib/plotly.ts`, `src/lib/plotly.test.ts`, `src/lib/appsExtensionsV4.ts`, existing import tests, `src/components/renderers/LinkedChartRenderer.tsx` and its test. Carry statement-model dependencies only where donor patches require them.

**Interfaces:** Produce union of legacy types plus pie/bullet/waterfall, existing `buildLinkedFigure` formatting signature and its refusal/notes union; keep bullet period and waterfall typed statement contracts.

- [ ] **Step 1: Add or carry the regression tests**

Carry existing composition/bullet/waterfall tests before implementation. Assert one selected quarter, prior available quarter by date, hidden range siblings, consensus-only fallback, negative actual, decimal-setting redraw, refused plot clearing and fresh indicator rendering. Assert waterfall requires typed income/period metadata, refuses EBITDA, handles negative expense and losses, resets subtotals and exposes Other residuals. Assert registered types include scatter/candlestick/bar/heatmap/pie/indicator/waterfall and native unregistered traces remain refused.

Contract assertions (fixture/result variables are local to the named test):

```ts
expect(REGISTERED_TRACE_TYPES.has('indicator')).toBe(true);
expect(REGISTERED_TRACE_TYPES.has('waterfall')).toBe(true);
expect(REGISTERED_TRACE_TYPES.has('surface')).toBe(false);
```

- [ ] **Step 2: Verify the regression fails before the change**

Run `pnpm exec vitest run src/lib/widgetData/chartFigure.test.ts src/lib/widgetData/bulletFigure.test.ts src/lib/widgetData/waterfallFigure.test.ts src/lib/plotly.test.ts src/components/renderers/LinkedChartRenderer.test.tsx`. Expect the named new behavior to fail (or missing module/route), not an unrelated environment failure. For carried work, run donor tests against the pre-port target first; do not invent a new failing test merely to duplicate a passing donor test.

- [ ] **Step 3: Implement the change**

Reconcile donor patches onto the actual v9 baseline and record dependencies. Union validators and type-change cleanup rather than choosing one branch version. Preserve signed expense semantics and missing notes. Import indicator/waterfall through partial modules only. Carry tests even if their file names require normalization into the listed files.

- [ ] **Step 4: Verify the task**

Run `pnpm exec vitest run src/lib/widgetData/chartFigure.test.ts src/lib/widgetData/bulletFigure.test.ts src/lib/widgetData/waterfallFigure.test.ts src/lib/plotly.test.ts src/components/renderers/LinkedChartRenderer.test.tsx` again; expect all selected tests to pass. Inspect the diff for scope and run `git diff --check`.

- [ ] **Step 5: Commit the task's listed files only**

Use `git add -- <explicit changed paths from this task>` after inspecting status, then `git commit -m "feat(v9): integrate linked bullet and statement waterfall"`. Do not stage the whole worktree.

### Task 11: Carry missing v4 statement-editing controls (approved amendment; execute after Task 2)

**Repository:** bdobb

**Files:** Create `src/lib/statementModel/placement.ts`, `placement.test.ts`; modify `src/lib/statementModel/{types,compile,validation,overrides,updates}.ts` and their existing tests plus `persistence.test.ts` and snapshots; modify `src/components/renderers/table-model/StatementPanel.tsx` and its test; create `src/lib/widgetData/waterfallStatement.test.ts`; update `docs/releases/validation/v9/chart-expansion/dependencies.md`.

**Interfaces:** Extend `StatementOverrides` with optional `lineSection: Record<lineId, sectionId>`; preserve donor `displayedSections(template, overrides)` API. Compile displayed placement while retaining original statement-owned line identity used by waterfall. New UI Section selector moves lines between sections, Move up complements existing Move down. Dependencies: reviewed Task 2; donors `9d8786df`, `60a59b1c`, editor/integration regression hunks from `78219efe`.

- [ ] **Step 1: Carry tests before production changes.** Pin persistence, validation, reset-one/reset-section/reset-all and template-update conflict behavior for lineSection. Assert section picker follows user section order; moving appends once to target, removes old displayed placement, and returning home clears redundant override. Assert line/formula IDs and monetary bindings remain unchanged; hidden target inheritance works; both up/down buttons respect bounds; read-only viewers cannot change placement. Include compiled-waterfall regression: moved expense retains decrease role.

```ts
expect(saved.overrides.lineSection[lineId]).toBe(targetSectionId);
expect(movedLine.id).toBe(originalLine.id);
expect(expenseWaterfallStep).toBeLessThan(0);
```

- [ ] **Step 2: Run RED.** `pnpm exec vitest run src/lib/statementModel src/components/renderers/table-model/StatementPanel.test.tsx src/lib/widgetData/waterfallStatement.test.ts`; expect missing placement support to fail, not toolchain/import setup.
- [ ] **Step 3: Port minimal donor production changes.** Preserve current v9 validation/security limits and APIs; no unrelated v4 editor refactor. Carry display placement, compilation, validation, template update and reset semantics together, avoiding UI-only state that cannot survive save/import.
- [ ] **Step 4: Verify GREEN.** Rerun the focused command, `pnpm typecheck`, `pnpm lint`, then full `pnpm test:run` once; inspect diff and `git diff --check`. Document any preexisting warning by name.
- [ ] **Step 5: Commit scoped paths** with `feat(statement): carry section placement and line ordering controls`, then independent task review before Task 3.

### Task 3: Define persisted recipe options and field validation

**Repository:** bdobb

**Files:** Create `src/lib/widgetData/chartRecipes/{types,settings}.ts`, `settings.test.ts`; modify `src/lib/widgetData/types.ts`, `src/lib/appsExtensionsV4.ts`, `src/lib/appsJson.cleanV4.test.ts`, `src/lib/widgetData/persistence.test.ts`.

**Interfaces:** Produce the fixed types/functions above. `withRecipeType(settings, type): LinkedChartSettings` drops incompatible recipe/period/seriesFrom options; new recipe controls populate valid defaults before committing. Legacy settings without recipe remain unchanged.

- [ ] **Step 1: Add or carry the regression tests**

`recipe_options_round_trip` asserts a version-1 correlation config (252/60) survives import/export. Reject version 2, kind/type mismatch, duplicate/empty symbols, >25 symbols, fractional/unsafe lookback, minOverlap<3 or >lookback, and executable/function-valued options. Assert 1–25 distinct correlation symbols accepted, monthly requires one symbol, empty binding names rejected. Test legacy snapshots unchanged and switching away from bullet clears period.

Contract assertions (fixture/result variables are local to the named test):

```ts
expect(validateRecipeOptions({version: 2, kind: 'correlation'}, 'correlation')).toBeNull();
expect(validateRecipeOptions({version: 1, kind: 'drawdown'}, 'correlation')).toBeNull();
```

- [ ] **Step 2: Verify the regression fails before the change**

Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/settings.test.ts src/lib/appsJson.cleanV4.test.ts src/lib/widgetData/persistence.test.ts`. Expect the named new behavior to fail (or missing module/route), not an unrelated environment failure. For carried work, run donor tests against the pre-port target first; do not invent a new failing test merely to duplicate a passing donor test.

- [ ] **Step 3: Implement the change**

Use closed declarative version-1 option shapes; reject extra unsupported shapes with actionable import errors. Keep optional legacy category/measures fields for file compatibility but do not require them for a recipe whose bindings supply the necessary columns. Validate again at runtime; never default an invalid new discriminant into legacy lines.

- [ ] **Step 4: Verify the task**

Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/settings.test.ts src/lib/appsJson.cleanV4.test.ts src/lib/widgetData/persistence.test.ts` again; expect all selected tests to pass. Inspect the diff for scope and run `git diff --check`.

- [ ] **Step 5: Commit the task's listed files only**

Use `git add -- <explicit changed paths from this task>` after inspecting status, then `git commit -m "feat(charts): persist validated financial recipe options"`. Do not stage the whole worktree.

### Task 4: Preserve acquisition evidence and prepare raw daily observations

**Repository:** bdobb

**Files:** Create `src/lib/widgetData/chartRecipes/input.ts`, `input.test.ts`; modify `src/lib/widgetData/sources.ts`, `src/lib/tableExecution/resultStore.ts`, `src/lib/tableExecution/resultStore.test.ts` only for demonstrated metadata loss; add `src/lib/widgetData/chartRecipes/fixtures.ts`.

**Interfaces:** Produce `preparePrices(dataset, fields: PriceBindings): {ok:true; series: PriceSeries[]; notes:string[]; scope: PriceScope} | {ok:false; message:string; refused:true}`. `PriceSeries={symbol:string; points:{date:string; price:number|null}[]}`; `PriceScope={start:string; end:string; interval:"1d"}`. `recipeEligibility` implements completeness and aggregation checks.

- [ ] **Step 1: Add or carry the regression tests**

Test complete and evidenced bounded acquisitions; refuse paged/partial/sample/unknown and a bounded source lacking acquisition dates/daily interval. Assert grouped/aggregated rows refused. Same symbol/date identical prices collapse with note; conflicts invalidate that symbol with note, leaving valid others; all invalid yields refusal. Null/zero/Infinity are gaps. Missing symbol may resolve only from one unambiguous provenance symbol. Hidden fields, mixed identities and mixed units refuse. Test a source-filter exclusion of a dated price retains a null barrier instead of yielding a multi-day return.

Contract assertions (fixture/result variables are local to the named test):

```ts
// In input.test.ts, use the bounded fixture with the acquisition evidence removed.
expect(recipeEligibility(unevidencedBounded, drawdownOptions)).not.toBeNull();
expect(recipeEligibility(pagedDataset, drawdownOptions)).not.toBeNull();
```

- [ ] **Step 2: Verify the regression fails before the change**

Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/input.test.ts src/lib/tableExecution/resultStore.test.ts`. Expect the named new behavior to fail (or missing module/route), not an unrelated environment failure. For carried work, run donor tests against the pre-port target first; do not invent a new failing test merely to duplicate a passing donor test.

- [ ] **Step 3: Implement the change**

Normalize dates by calendar date, sort within symbol and never substitute close. Extract acquisition window/interval/symbol from existing provenance.parameters/receipt with explicit tested adapters. Preserve upstream evidence; never upgrade SSRM paged status from row counts. For filtered histories preserve known omitted-date barriers via provenance or refuse calculation if continuity cannot be established; do not read hidden data. Fully acquired JSON/file sources are the supported demo path. Snapshot creation must use an existing explicit source operation; do not add background page exhaustion.

- [ ] **Step 4: Verify the task**

Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/input.test.ts src/lib/tableExecution/resultStore.test.ts` again; expect all selected tests to pass. Inspect the diff for scope and run `git diff --check`.

- [ ] **Step 5: Commit the task's listed files only**

Use `git add -- <explicit changed paths from this task>` after inspecting status, then `git commit -m "feat(charts): validate historical source scope and continuity"`. Do not stage the whole worktree.

### Task 5: Implement drawdown and historical yield curves

**Repository:** bdobb

**Files:** Create `src/lib/widgetData/chartRecipes/{drawdown,yieldCurve}.ts` and matching `.test.ts` files.

**Interfaces:** Produce `buildDrawdown` and `buildYieldCurve` using the fixed build signature and RecipeResult. Consume Task 4 price preparation for drawdown; curves use explicit date/maturity/rate bindings.

- [ ] **Step 1: Add or carry the regression tests**

`drawdown_tracks_loaded_peak` expects prices [100,80,120,90] to yield [0,-.2,0,-.25]; test independent second symbol, unsorted input, null barrier and exact loaded-history label. Curve fixture with year_10=.04, month_1=.03, year_2=.035 must sort x=[1,24,120] and preserve fractional y. Test weekend request -> actual observation label, duplicate requests collapsing, missing tenor as gap, unknown tenor note and conflicting duplicate curve refusal.

Contract assertions (fixture/result variables are local to the named test):

```ts
// With the four-price fixture above and explicit version-1 bindings.
const result = buildDrawdown(dataset, options, context);
expect(result.ok).toBe(true);
if (result.ok) expect(result.figure.layout.title).toEqual(expect.objectContaining({text: 'Drawdown from peak in loaded history'}));
```

- [ ] **Step 2: Verify the regression fails before the change**

Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/drawdown.test.ts src/lib/widgetData/chartRecipes/yieldCurve.test.ts`. Expect the named new behavior to fail (or missing module/route), not an unrelated environment failure. For carried work, run donor tests against the pre-port target first; do not invent a new failing test merely to duplicate a passing donor test.

- [ ] **Step 3: Implement the change**

Use filled scatter for drawdown with connectgaps false and per-symbol stable colors. Use numeric-month tenor map from the spec and one scatter line per observed date for curves. A failed individual series may be omitted only with an explicit note; if none survive return refused. Escape text and use existing themedLayout/formatting helpers.

- [ ] **Step 4: Verify the task**

Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/drawdown.test.ts src/lib/widgetData/chartRecipes/yieldCurve.test.ts` again; expect all selected tests to pass. Inspect the diff for scope and run `git diff --check`.

- [ ] **Step 5: Commit the task's listed files only**

Use `git add -- <explicit changed paths from this task>` after inspecting status, then `git commit -m "feat(charts): add loaded-history drawdown and yield curves"`. Do not stage the whole worktree.

### Task 6: Implement completed-month return heatmap

**Repository:** bdobb

**Files:** Create `src/lib/widgetData/chartRecipes/monthlyReturns.ts`, `monthlyReturns.test.ts`.

**Interfaces:** Produce `buildMonthlyReturns` using Task 4 series/scope and explicit `context.today`; success uses the existing heatmap trace.

- [ ] **Step 1: Add or carry the regression tests**

`monthly_uses_endpoint_ratio` expects Nov close 100, Dec 110, Jan 99 to produce Dec=.10, Jan=-.10. Assert no Nov return without October; absent December makes January unavailable. Test a month ending Sunday with last observed Friday and acquisition end on Sunday is complete; acquisition ending Friday before Sunday is incomplete. Null final dated row prevents fallback to an earlier close. Assert current month incomplete, genuine zero distinguishable from missing, and December/January placed in separate year rows.

Contract assertions (fixture/result variables are local to the named test):

```ts
// Pair fixture months with returned heatmap z cells.
expect(decemberReturn).toBeCloseTo(0.10, 12);
expect(januaryReturn).toBeCloseTo(-0.10, 12);
expect(incompleteMonthCell).toBeNull();
```

- [ ] **Step 2: Verify the regression fails before the change**

Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/monthlyReturns.test.ts`. Expect the named new behavior to fail (or missing module/route), not an unrelated environment failure. For carried work, run donor tests against the pre-port target first; do not invent a new failing test merely to duplicate a passing donor test.

- [ ] **Step 3: Implement the change**

Use final observed trading rows per calendar month and require valid endpoints plus source coverage through month-end. Keep unavailable cell states in customdata/notes even though Plotly z is null. Use symmetric diverging color limits and a nonzero fallback when all valid returns are zero. Never infer an exchange holiday calendar.

- [ ] **Step 4: Verify the task**

Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/monthlyReturns.test.ts` again; expect all selected tests to pass. Inspect the diff for scope and run `git diff --check`.

- [ ] **Step 5: Commit the task's listed files only**

Use `git add -- <explicit changed paths from this task>` after inspecting status, then `git commit -m "feat(charts): add completed monthly return heatmap"`. Do not stage the whole worktree.

### Task 7: Implement pairwise watchlist return correlation

**Repository:** bdobb

**Files:** Create `src/lib/widgetData/chartRecipes/correlation.ts`, `correlation.test.ts`.

**Interfaces:** Produce `buildCorrelation`; consume PriceSeries and shared scope. Result customdata contains each pair's N and actual paired date bounds.

- [ ] **Step 1: Add or carry the regression tests**

Use four closes [100,110,99,118.8] -> [.1,-.1,.2] and a second proportional series: r=1 with minOverlap=3. A series with opposite returns yields r=-1; a constant-return series yields unavailable. Assert symmetric cells/N, invalid diagonal unavailable, fewer than 60 pairs unavailable at defaults. Pin union-date window ending at earliest symbol latest date with pairwise matching (not all-symbol intersection); missing rows never forward-fill. Test two different trading calendars and a weekend without inventing observations. Reject >25 symbols.

Contract assertions (fixture/result variables are local to the named test):

```ts
expect(identicalPairR).toBeCloseTo(1, 12);
expect(oppositePairR).toBeCloseTo(-1, 12);
expect(constantPairR).toBeNull();
expect(pairN).toBe(3);
```

- [ ] **Step 2: Verify the regression fails before the change**

Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/correlation.test.ts`. Expect the named new behavior to fail (or missing module/route), not an unrelated environment failure. For carried work, run donor tests against the pre-port target first; do not invent a new failing test merely to duplicate a passing donor test.

- [ ] **Step 3: Implement the change**

Compute returns within each series before alignment; null barriers reset adjacent return availability. Build one union return-date window, take trailing lookback positions, then Pearson pairwise complete observations. Use a numerically stable centered calculation; clamp floating rounding only near [-1,1]. Document that no PSD covariance matrix is promised; fixed heatmap range [-1,1], cell N and actual coverage visible.

- [ ] **Step 4: Verify the task**

Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/correlation.test.ts` again; expect all selected tests to pass. Inspect the diff for scope and run `git diff --check`.

- [ ] **Step 5: Commit the task's listed files only**

Use `git add -- <explicit changed paths from this task>` after inspecting status, then `git commit -m "feat(charts): add pairwise daily return correlation"`. Do not stage the whole worktree.

### Task 8: Implement guarded estimate range chart and recipe dispatch

**Repository:** bdobb

**Files:** Create `src/lib/widgetData/chartRecipes/{estimateRange,run}.ts`, matching `.test.ts` files.

**Interfaces:** Produce `buildEstimateRange` and `runRecipe` dispatching exactly five discriminants; Task 1 supplies guarded rows and Task 3 supplies options.

- [ ] **Step 1: Add or carry the regression tests**

Assert low=-2, average=-1, high=.5 draws valid EPS connectors; band_status=withheld/no_estimate draws no range and includes fiscal/date reason. Reversed bounds or missing average are unavailable. Unknown fiscal identity falls back to period-end label. Valid rows survive another withheld row; all withheld refuses. EPS/revenue are separate single-metric choices. A dispatch test exercises every kind and unknown runtime options refuse.

Contract assertions (fixture/result variables are local to the named test):

```ts
const result = buildEstimateRange(allWithheldDataset, epsOptions, context);
expect(result).toMatchObject({ok: false, refused: true});
```

- [ ] **Step 2: Verify the regression fails before the change**

Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/estimateRange.test.ts src/lib/widgetData/chartRecipes/run.test.ts`. Expect the named new behavior to fail (or missing module/route), not an unrelated environment failure. For carried work, run donor tests against the pre-port target first; do not invent a new failing test merely to duplicate a passing donor test.

- [ ] **Step 3: Implement the change**

Use scatter low/high endpoints, connectors and distinct average marks, chronologically ordered by period-end; never infer revision history. Route through shared version/runtime validation and history eligibility where appropriate. Use typed statement and guarded estimate eligibility separately from raw-price completeness rules. Return stable question revisions and existing notes/refusal semantics.

- [ ] **Step 4: Verify the task**

Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/estimateRange.test.ts src/lib/widgetData/chartRecipes/run.test.ts` again; expect all selected tests to pass. Inspect the diff for scope and run `git diff --check`.

- [ ] **Step 5: Commit the task's listed files only**

Use `git add -- <explicit changed paths from this task>` after inspecting status, then `git commit -m "feat(charts): add guarded estimate ranges and recipe dispatch"`. Do not stage the whole worktree.

### Task 9: Wire cancellable worker recipes and linked-card controls

**Repository:** bdobb

**Files:** Create `src/lib/widgetData/chartRecipes/{recipe.worker,workerClient}.ts`, `workerClient.test.ts`, `src/components/renderers/LinkedChartRecipeControls.tsx` and its test; modify `src/components/renderers/LinkedChartRenderer.tsx` and test.

**Interfaces:** Produce `createRecipeWorker(): {run(dataset, options, context, signal): Promise<RecipeResult>; dispose():void}`. Requests carry monotonic requestId and source/result/output revision identity; replies echo identity. Renderer calls executor.chartData then worker.run for new types only.

- [ ] **Step 1: Add or carry the regression tests**

Worker test resolves old request after new and asserts old result ignored; abort rejects/cleans up; dispose terminates and removes listeners; worker errors become actionable failures. Renderer tests all five new type options, compatible-field eligibility, hidden/removed binding repair clearing old plot, monthly symbol and correlation 252/60 defaults, and no fetch beyond selected source. A source removal or type switch during work cannot publish late output. Fresh data recomputes with same uirevision; source/options changes reset it. Theme/precision redraw does not rerun on React's main thread. Refusal clears; refresh failure retains stale successful plot.

Contract assertions (fixture/result variables are local to the named test):

```ts
// Resolve request B first, then A in the worker test's controlled reply harness.
expect(publishedRequestIds).toEqual([requestB]);
expect(workerTerminate).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Verify the regression fails before the change**

Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/workerClient.test.ts src/components/renderers/LinkedChartRecipeControls.test.tsx src/components/renderers/LinkedChartRenderer.test.tsx`. Expect the named new behavior to fail (or missing module/route), not an unrelated environment failure. For carried work, run donor tests against the pre-port target first; do not invent a new failing test merely to duplicate a passing donor test.

- [ ] **Step 3: Implement the change**

Use Vite module-worker construction and structured-clone-safe options/dataset. Keep computation outside useMemo; cache the completed figure/result by computation identity. Worker never calls fetch or imports Plotly runtime. Ensure requiredRecipeFields checks presented columns before executor request. Replace legacy category/measures preflight only for new recipes; preserve viewer/read-only behavior and existing ResizeObserver/purge path. Validate saved config before commit and surface save failures.

- [ ] **Step 4: Verify the task**

Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/workerClient.test.ts src/components/renderers/LinkedChartRecipeControls.test.tsx src/components/renderers/LinkedChartRenderer.test.tsx` again; expect all selected tests to pass. Inspect the diff for scope and run `git diff --check`.

- [ ] **Step 5: Commit the task's listed files only**

Use `git add -- <explicit changed paths from this task>` after inspecting status, then `git commit -m "feat(charts): expose worker-backed linked financial recipes"`. Do not stage the whole worktree.

### Task 12: Preserve already-shipped provider v9.0.1 baseline fixes (execute after Task 9, before Task 10)

**Repository:** openbq-eodhd

**Files:** Restore the released diffs in `openbq_eodhd/models/_client.py`, `calendar.py`, `dividend_yield.py`, `pyproject.toml`, `tests/test_client.py`, `tests/test_calendar.py`, `tests/test_phase3_market.py`.

**Interfaces:** Retain the guarded reported-quarter port and inclusive threshold fix. The canonical provider execution branch was initially based on local `5341fbf`; Docker already pins released `59603cc` (`v9.0.1`). Preserve that released baseline before vendoring, not a release/version downgrade.

- [ ] **Step 1: Read the exact released delta** `git diff 5341fbf 59603cc -- <listed paths>`. Carry the released tests first; pin token redaction (plain and URL-encoded errors, suppressed secret-bearing exception chains), request-limit/upstream error mapping, split-only trailing dividend yield and busy-day calendar paging.
- [ ] **Step 2: Run RED:** `python -m pytest tests/test_client.py tests/test_calendar.py tests/test_phase3_market.py -q`; confirm the released regression cases fail against the older baseline, without live calls.
- [ ] **Step 3: Port the released production delta** without overwriting the guarded earnings files. Keep `9.0.1` and its declared test dependency; no tag or publication. Record released donor commits in the report.
- [ ] **Step 4: Run GREEN** focused command, full provider `python -m pytest tests -q`, Ruff on changed paths and `git diff --check`. Use the prepared Task 1 environment and no real API keys.
- [ ] **Step 5: Commit** only listed paths with `fix(eodhd): preserve shipped v9.0.1 baseline fixes`; independent review before Task 10.

### Task 10: Package the paired v9 stack, examples and final verification

**Repository:** openbq-docker plus bdobb

**Files:** Docker: update `v9/eodhd/source/`, `v9/eodhd/source.json`, `v9/eodhd/README.md`, `v9/eodhd/tests/test_stack.py`, `tests/test_images.py`, `docs/v9/eodhd-port.md`; create `v9/eodhd/tests/test_source_pin.py`. BDOBB: create `docs/examples/v9-chart-expansion.apps.json`, `e2e/chart-recipes.spec.ts`, `e2e/fixtures/chart-recipes.ts`, `docs/releases/validation/v9/chart-expansion/verification.md`; update `src/help/guide/linked-widgets.md`, `src/help/guide/charts.md`, `docs/releases/v9.0.0-release-notes.md`.

**Interfaces:** Consume committed canonical provider source and integrated BDOBB settings. Produce importable source-table/linked-card example, exact provider source SHA receipt, and final gate evidence without live EODHD calls.

- [ ] **Step 1: Add or carry the regression tests**

Docker test asserts 53 mirrors including earnings-vs-estimates, correct widget registration and no old package imports. Source-pin test compares vendored provider-owned paths to the canonical pinned source manifest (allow only explicitly recorded packaging edits). Browser fixture uses fictional deterministic daily prices, curves, guarded estimates and typed statement rows; import all seven linked cards, verify nonempty plots and financial labels, switch light/dark, resize, refresh, filter, remove source, export/import and exercise incomplete/withheld cases.

Contract assertions (fixture/result variables are local to the named test):

```python
assert '/api/v1/eodhd/equity/estimates/earnings_vs_estimates' in registered_paths
assert vendored_manifest == canonical_manifest
```

- [ ] **Step 2: Verify the regression fails before the change**

Run `python -m pytest v9/eodhd/tests/test_stack.py v9/eodhd/tests/test_source_pin.py tests/test_images.py -q`. Expect the named new behavior to fail (or missing module/route), not an unrelated environment failure. For carried work, run donor tests against the pre-port target first; do not invent a new failing test merely to duplicate a passing donor test.

- [ ] **Step 3: Implement the change**

Use the port ledger's documented vendoring procedure; no EODHD prepare-source script was found, so copy only canonical tracked package/test/doc files via a reviewed explicit manifest and verify their content hashes. Set source.json commit to the actual canonical commit; do not fabricate a tag. Update mirror-count comments consistently. Keep default EODHD apps.json intact unless an actual registration change requires it; the seven-chart dashboard lives in BDOBB docs/examples and is imported as a BDOBB-native dashboard, not silently injected into provider apps. Do not claim all seven draw directly from live paged sources: the example's complete bounded fixtures and refusal behavior are deliberate. Update help with acquisition limits, drawdown wording, calendar-month semantics, pairwise N, estimate heuristic and waterfall Other notes. Run the final gates below and commit each repository separately.

- [ ] **Step 4: Verify the task**

Run `python -m pytest v9/eodhd/tests/test_stack.py v9/eodhd/tests/test_source_pin.py tests/test_images.py -q` again; expect all selected tests to pass. Inspect the diff for scope and run `git diff --check`.

- [ ] **Step 5: Commit the task's listed files only**

Use `git add -- <explicit changed paths from this task>` after inspecting status, then `git commit -m "docs(v9): package and verify financial chart expansion"`. Do not stage the whole worktree.

## Final gates and completion evidence

Run in BDOBB execution worktree, individually (stop on failures):

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test:run
pnpm scrub
pnpm test:web
pnpm build
pnpm exec playwright test e2e/chart-recipes.spec.ts --project=chromium
```

Run in a provider environment with `pip install -e '.[dev]'` and standard routers required by parity tests installed under the repo's existing constraints: `python -m pytest tests -q`. Run docker Task 10 checks in its supported OpenBB stack test environment, then `python v9/eodhd/verify.py` in the built/available v9 image environment. Do not interpret missing OpenBB packages as a product failure or skip them as a pass; prepare the documented environment and rerun. Image builds are local only and require no deployment.

Record exact commands, exit status, environment, full base/feature/provider hashes, importable example path and bundle byte comparison in verification.md. No arbitrary bundle threshold is invented: report the measured delta and verify only the approved partial modules were added. Include seven-chart light/dark screenshots plus refusal/stale examples from browser validation; do not embed keys or account data.

Before claiming completion, use verification-before-completion, request a whole-branch code review, resolve material findings and rerun affected checks. Keep commits local and provide the three repository diffs/commit hashes for review. Use finishing-a-development-branch only within the user's authorized local handoff; no merge/push/deploy or forward carry is implied.

## Self-review record

- Spec coverage: seven chart deliverables -> Tasks 1–2, 5–8; provenance and incomplete scope -> Task 4; import/persistence -> Task 3; worker lifecycle and UI -> Task 9; paired stack/help/browser/bundle evidence -> Task 10.
- Step scan: each task has test assertions, red check, implementation boundary, green check and scoped commit. No product code is written by this planning change.
- Type consistency: five discriminants and RecipeOptions share one definition; all builders use one argument order and RecipeResult; worker.run invokes runRecipe; no new remote executor protocol is required.
- Review focus: all five conditions above have explicit owning tests. Paged SSRM sources remain refused rather than reclassified from visible row counts.
- Proportion: algorithms stay in implementer-owned modules; the plan fixes interfaces, numerical examples and integration seams rather than reproducing function bodies.

## Execution handoff

Plan only; implementation has not begun. Review this plan, then choose native execution in this chat or subagent-driven execution. Native is recommended because the branch reconciliation, settings union and provenance/worker integration share interfaces and benefit from one implementer; retain a fresh whole-branch reviewer at the end. If the user chooses delegation, use the required subagent-driven-development workflow instead. Approval of the design did not choose an execution method.
