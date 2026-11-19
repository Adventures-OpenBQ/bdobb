# V9 Risk and ETF Exposure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add daily-return histograms, indexed watchlist small multiples, ETF holding-weight Pareto charts and sector/region dot plots to BDOBB v9.

**Architecture:** Extend the existing versioned linked-chart recipes and dedicated worker. Compute histogram bins, indexed prices and ETF ordering/sums in pure TypeScript; render with the already registered scatter/bar traces. Bind ETF identity and denominator to the actual acquired request or explicit snapshot receipt, preserving safety evidence through both table engines.

**Tech Stack:** Existing TypeScript/React, Web Workers, Plotly partial bundle, Vitest and Playwright; existing Python provider/Docker checks only if a proven upstream contract gap requires changes.

**Spec:** [Approved design](../specs/2026-11-19-v9-risk-exposure-design.md), originally committed as `4e5b9f1e`, approved in chat on 2026-11-19. Read it in full before executing a task.

## Global Constraints

- “Each chart has exactly one linked table.”
- “Required fields must be presented; projection must not fetch hidden values.”
- “Accept documented complete or bounded daily acquisitions. Refuse paged, sampled, partial or unknown history, grouped/pivoted input, conflicting identity/units and unavailable required fields.”
- “Never infer completeness from 50 rows or from a weight sum near one.”
- “No additional visualization dependency or trace module is needed.”
- “No synthetic 'Other', inferred remainder, 80/20 conclusion or claim that the line reaches the whole fund is allowed.”
- “No expansion to other release lines, Rita tools or Art's Charts.”
- Preserve first-batch settings, status/error ownership, worker fencing and export/import behavior. No hidden fetches, normalization of ETF weights, currency conversion, portfolio/look-through work, density/fitted distributions or box/violin variants.
- Keep AGPL headers in BDOBB and Apache headers in canonical provider/vendor code. Do not publish machine paths, credentials or private infrastructure in evidence.
- This is an unexecuted plan. No code changes, pushes, PR updates, merges or deployment are authorized by writing it.

## Review Focus

- A delayed response for fund A after editing/arming fund B must retain A's acquired identity or be discarded, never be relabeled B (Task 2).
- Filtering away a bad ETF weight/fund identity or a conflicting price currency must not turn unsafe acquired data into a certified comparison (Tasks 2 and 7).
- Adjacent floating-point bin boundaries must conserve every return exactly once, including the maximum and tiny nonzero ranges (Task 3).
- Responsive reflow must not change small-multiple symbol order, shared scales, baseline or same-question zoom (Tasks 4 and 7).
- More than 50 delivered holdings and a near-100% rounded sum must preserve actual numeric values and disclose the displayed subset (Task 5).

## Baseline, dependency order and execution boundaries

The existing isolated worktree is on `codex/v9-risk-exposure-design`. Its product parent is BDOBB `0ee0bdba8020d5a61a991af0ca7f4b093a443d88`; design-only commit `4e5b9f1e` follows it. Retain the current isolated workspace unless its state has changed. When implementation is authorized, use a separate local `codex/v9-risk-exposure` branch from the committed plan or preserve the current follow-up branch if the user prefers. Never silently push follow-up commits onto the first package's PR branch.

Read-only PR status was checked while planning: BDOBB #87, provider #5 and Docker #32 were OPEN at their design-pinned heads. Recheck at execution; if merged, establish that the chosen v9 base contains the exact first-package changes before rebasing the follow-up. Preserve existing review evidence and do not rewrite published history. Inspect AGENTS instructions; use CodeGraph first only when the repository has `.codegraph/`.

Tasks 1–2 establish contracts. Tasks 3–6 implement independently testable builders. Task 7 integrates all four. Task 8 supplies examples/browser evidence and shipping gates. Task 9 is independent final review. Shared-file edits are sequential; recipe builder tasks can be delegated independently after their prerequisite contracts pass. Keep each task's RED/GREEN evidence and one scoped commit; run focused tests while iterating and the complete shipping suite once after integration. Do not add unrelated test repetition.

At start run `pnpm install --frozen-lockfile` only if dependencies are missing, verify the existing pinned Wasm build using `pnpm pivot:verify`, and run the unchanged baseline `pnpm test:run`. Prior first-package counts are context, not an assumed new result. If a baseline gate fails, diagnose before attributing the failure to this batch. Record exact baseline commits and production file/JS/map byte counts for Task 8's comparison.

## File map and fixed interfaces

Paths are relative to BDOBB unless marked otherwise. Existing paths were inspected; new paths below are intentional.

- `src/lib/widgetData/chartRecipes/types.ts`, `settings.ts`, `bindings.ts`: closed options, field roles and validation.
- New `priceSamples.ts`: selected-symbol preparation and daily returns; reuse `input.ts` and `priceEvidence.ts` without changing first-package semantics.
- New `etfEvidence.ts`: acquisition-bound fund/kind/basis/safety evidence and projected-source eligibility.
- `src/hooks/useWidgetData.ts`, `src/components/WidgetCard.tsx`, `src/stores/tableExecutionStore.ts`: actual completed acquisition context delivery.
- `src/lib/tableRowValues.ts`, `localTableData.ts`, `tableExecution/engine.ts`, `tableExecution/resultStore.ts`: explicit receipt decoding, raw certification, scope and projection.
- New `returnDistribution.ts`, `smallMultiples.ts`, `etfPareto.ts`, `etfExposure.ts`, with colocated tests: pure builders.
- `run.ts`, `workerClient.ts`, `LinkedChartRecipeControls.tsx`, `LinkedChartRenderer.tsx`, `ChartRenderer.tsx`, `src/styles.css`: worker dispatch, controls and responsive plot viewport.
- Existing persistence/apps extension validators plus their tests: use shared decoder; add no duplicate schema.
- New `docs/examples/v9-risk-exposure/`, `docs/examples/v9-risk-exposure.apps.json`, `e2e/fixtures/risk-exposure.ts`, `e2e/risk-exposure.spec.ts`: deterministic demonstration and browser acceptance.
- New `docs/releases/validation/v9/risk-exposure/{verification,review}.md`; existing `src/help/guide/charts.md`, `src/help/topics/charts.md`, `docs/releases/v9.0.0-release-notes.md`: evidence and user help.

Add these version-1 members to the existing `RecipeOptions` union; keep existing members unchanged:

```ts
type DistributionOptions = { version: 1; kind: 'return-distribution'; fields: PriceBindings; symbol: string; bins: number };
type MultiplesOptions = { version: 1; kind: 'small-multiples'; fields: PriceBindings; symbols: string[] };
type ParetoOptions = { version: 1; kind: 'etf-pareto'; fields: { holding: string; label?: string; weight: string } };
type ExposureOptions = { version: 1; kind: 'etf-exposure'; fields: { category: string; weight: string }; mode: 'sector' | 'region' };
```

There is no configurable normalization or Pareto cap: these are fixed at shared-base 100 and 50. Extend `RecipeContext` with optional `viewportWidth?: number`, finite and positive, maximum 10000; absent means 900. Width affects arrangement only and is not saved in dashboard settings or figure question revision.

Each builder exports `(dataset: WidgetDataset, options: Extract<RecipeOptions, {kind: K}>, context: RecipeContext): RecipeResult`, named `buildReturnDistribution`, `buildSmallMultiples`, `buildEtfPareto`, `buildEtfExposure`. Use the existing `RecipeResult` success/refusal shape. Runtime decoding still accepts unknown input at the existing decoder seam; exported builders validate their own options like the first-package builders.

### Task 1: Close the four recipe contracts and persistence rules

**Files:** Modify `chartRecipes/{types,settings,bindings}.ts`, their existing tests and `run.ts`; inspect `src/lib/appsExtensionsV4.ts` and `src/lib/widgetData/persistence.ts` shared-decoder call sites, modifying only if needed; test `src/lib/widgetData/persistence.test.ts`, `src/lib/appsExtensionsV3.test.ts` and `src/lib/appsJson.test.ts` for the existing serialized entry paths.

**Interfaces:** Consumes existing `RecipeOptions`, `PriceBindings`, `decodeRecipeOptions`, `requiredRecipeFields`, `savedBindingIssue`. Produces the four options above and their role/required-field definitions. During partial implementation, `runRecipe` ends with an explicit unsupported-recipe refusal so intermediate commits typecheck; do not expose new chart choices until Task 7 replaces that fallback for every supported kind.

- [ ] **Step 1: Add failing decoder/round-trip tests.** Valid histogram `bins: 30`, single symbol; valid multiples with 1 and 12 ordered unique symbols; Pareto optional label; both dot modes. Pin boundaries with `expect(decodeRecipeOptions({...hist, bins: 4}, hist.kind).ok).toBe(false)` and the same for 101, fractional/NaN bins, 0/13 symbols, duplicate symbols, version 2, extra keys and colliding bindings. Assert `requiredRecipeFields(pareto)` excludes absent label and no new options contain identity/coverage certification.

Name the decoder test `validates four risk recipe contracts without accepting certification`; use local valid `hist` and `pareto` options from the fixed interfaces:

```ts
expect(decodeRecipeOptions(hist, 'return-distribution').ok).toBe(true);
expect(decodeRecipeOptions({ ...hist, bins: 4 }, hist.kind).ok).toBe(false);
expect(decodeRecipeOptions({ ...pareto, fund: 'FORGED' }, pareto.kind).ok).toBe(false);
expect(requiredRecipeFields(pareto)).toEqual(['holding', 'weight']);
```
- [ ] **Step 2: Run `pnpm test:run src/lib/widgetData/chartRecipes/settings.test.ts src/lib/widgetData/persistence.test.ts src/lib/appsExtensionsV3.test.ts src/lib/appsJson.test.ts`; observe new cases fail for unsupported types.**
- [ ] **Step 3: Implement union/roles/decoding.** Use numeric weight roles and source-origin alias matching; holding accepts symbol/ticker/holding ID, category accepts sector/country/region, renamed fields retain sourceFieldId. Default histogram bins belong in controls, not silent import repair. Reject grouped/calculated bindings. Keep fixed Pareto cap and normalization out of saved options. Validate optional context width in `run.ts` without changing existing context callers.
- [ ] **Step 4: Rerun those files plus `pnpm typecheck`; expect PASS.** Existing chart settings round-trip unchanged and malformed new settings refuse.
- [ ] **Step 5: Commit `feat(charts): define risk and ETF recipe settings`.** Stage only this task's files and record focused results.

### Task 2: Bind ETF safety evidence to the acquired source

**Files:** Create `chartRecipes/etfEvidence.ts`, `etfEvidence.test.ts`; modify/test `src/hooks/useWidgetData.ts`, `useWidgetData.test.tsx`, `src/components/WidgetCard.tsx`, `src/stores/tableExecutionStore.ts`, `tableExecutionStore.test.ts`, `src/lib/{tableRowValues,localTableData}.ts` and `localTableData.test.ts`, `tableExecution/{engine,resultStore}.ts`, `resultStore.test.ts`, `tableExecution/rust/oracle.test.ts`.

**Interfaces:** Create `BackendEtfAcquisition = { endpoint: string; parameters: Record<string,string>; retrievedAt: number }`, `EtfEvidence` with version 1, fund, kind (`holdings|sector|region`), basis (`fund-assets|equity-exposure`), holdingsCoverage (`unknown|partial|complete`), optional asOf and retrievedAt, and any acquired issue. Export `etfAcquisitionProvenance(dataset: WidgetDataset): DatasetProvenance` and `readEtfEvidence(dataset: WidgetDataset, expected: EtfEvidence['kind']): {ok:true; evidence:EtfEvidence; notes:string[]} | {ok:false; message:string}`. Evidence lives under `provenance.metadata.etfEvidence`; it is runtime data, never a saved recipe assertion.

- [ ] **Step 1: Add failing acquisition and projection tests.** Assert a completed holdings request for `FUND_A.US` remains A when controls change to B before B runs; a delayed A success cannot be labeled B. Assert hidden conflicting `fund_symbol`/weight-basis values still refuse after chartData and a second linked table. Assert holding `symbol: 'HOLDING.US'` is never interpreted as the fund. Snapshot unknown/paged coverage remains unknown/paged after projection.

Name the source test `keeps ETF evidence bound to the completed request`; name the engine test `retains hidden ETF safety failures through two projections`. After the test's real executor projection:

```ts
expect(projected.provenance.metadata?.etfEvidence).toMatchObject({ fund: 'FUND_A.US', basis: 'fund-assets' });
expect(readEtfEvidence(conflictingProjection, 'holdings').ok).toBe(false);
expect(projected.completeness.kind).toBe('paged');
```
- [ ] **Step 2: Run `pnpm test:run src/hooks/useWidgetData.test.tsx src/stores/tableExecutionStore.test.ts src/lib/localTableData.test.ts src/lib/tableExecution/resultStore.test.ts src/lib/tableExecution/rust/oracle.test.ts src/lib/widgetData/chartRecipes/etfEvidence.test.ts`; observe the new evidence assertions fail.**
- [ ] **Step 3: Implement request-to-dataset context.** Capture endpoint, resolved/armed fetch parameters and completion time inside `useWidgetData`'s successful request generation, alongside its data; expose `acquisition` on the hook result. Allowlist only symbol, exchange and provider in captured parameters; do not copy arbitrary request parameters, URL credentials or tokens into dataset provenance. Pass it with `acquired` through `WidgetCard` to an optional fourth argument of `setBackendRows(d,id,data,acquisition?)`. Store it atomically with that payload; clear it on failure and retain old identity with stale old rows. Never derive context from current card edits when consuming a completed payload.
- [ ] **Step 4: Implement the bounded route/receipt mapping.** Recognize namespaced `/eodhd/etf/{holdings,sectors,countries}` directly; recognize generic `/etf/...` aliases only when the acquired provider parameter is explicitly eodhd. Match URL path segments, not arbitrary substring or widget title. Holdings implies fund-assets; sectors/countries imply equity-exposure. Use one nonblank request symbol; reject a comma list or conflicting receipt. Unknown routes require an explicit snapshot receipt. Do not change ordinary backend-array completeness.
- [ ] **Step 5: Extend the existing string receipt allowlist with `fund_symbol`, `etf_kind`, `weight_basis`, `holdings_coverage`, `as_of`, `retrieved_at`; retain all prior keys and strict envelope checks.** Snapshot ETF receipts require fund_symbol/kind/basis; validate recognized enums, ISO date and retrieval timestamp. Missing coverage defaults unknown; absence of as_of remains unknown. `symbol` still means a price symbol and must not masquerade as ETF fund identity. Backend receipt and acquired request conflicts refuse; neither wins silently.
- [ ] **Step 6: Certify at `datasetFromRows`/`calculateView` before filters or field projection.** Validate row identity/basis aliases against the acquired facts and raw weight cells against the declared fractional weight field; propagate an issue even if its row or field is subsequently hidden. Mark acquired evidence once rather than recertifying a derived subset as fresh acquisition. Grouped/pivoted/aggregate ETF input refuses. Keep only compact safety facts and scope/counts in projection, no hidden weights. `readEtfEvidence` checks expected kind, retained source lineage and evidence shape, explains filtered/delivered coverage, and distinguishes retrieved time from snapshot date. Invalidity of omitted weights remains a safety refusal; ordinary omission of valid rows is a labeled source filter, not full-fund coverage.
- [ ] **Step 7: Rerun Step 2 plus `pnpm typecheck`; expect PASS in both engines.** Add a real backend dotted-selector request using the existing `setBackendRows` HTTP fixture pattern; compare canonical raw and projected evidence and confirm numeric rows are unchanged. Import/reopen must rebuild evidence from reacquired source, not persisted chart metadata.
- [ ] **Step 8: Commit `feat(charts): preserve acquired ETF identity and weight basis`.** Record that inspected existing provider records need no change; canonical provider and Docker remain pinned. If an actual upstream gap prevents this contract, stop that dependency for a scoped plan amendment rather than inventing route facts or independently editing the vendor.

### Task 3: Daily-return sample and worker-binned histogram

**Files:** Create `chartRecipes/{priceSamples,returnDistribution}.ts` and their colocated tests; extend `fixtures.ts` only for reusable deterministic data.

**Interfaces:** Consume `preparePrices`, existing PriceSeries and `DistributionOptions`. Export `prepareSelectedPrices(dataset, fields: PriceBindings, symbols: string[]): {ok:true; series:PriceSeries[]; scope:PriceScope; notes:string[]} | {ok:false; refused:true; message:string}`; selection order must be retained and absent/conflicted selected symbols refuse. Export `dailyReturnSamples(series: PriceSeries): {samples:{date:string; value:number}[]; excludedNonfinite:number; gapCount:number}`. Produce `buildReturnDistribution` per fixed builder signature.

- [ ] **Step 1: Add failing calculation tests.** Use prices `[100,100,110,99]`; assert three returns approximately `[0,.1,-.1]` and total bin counts 3. Assert the min and max each appear once, exact interior edges enter the right-hand bin, a tiny nonconstant range conserves N, zero returns are not missing, and all equal returns form one finite-width centered bin. A null/omitted point breaks both adjacent-return opportunities; no bridging. Conflicted/absent selection, <2 valid returns, nonpositive prices, arithmetic overflow and paged history exercise explicit notes/refusal.

Name the sample test `preserves zero returns and breaks known gaps`, and the histogram test `conserves samples at both range endpoints`. For prepared points with the four specified prices:

```ts
const { samples } = dailyReturnSamples(series);
expect(samples).toHaveLength(3);
expect(samples[0].value).toBe(0);
expect(samples[1].value).toBeCloseTo(.1);
expect(samples[2].value).toBeCloseTo(-.1);
```
- [ ] **Step 2: Run `pnpm test:run src/lib/widgetData/chartRecipes/priceSamples.test.ts src/lib/widgetData/chartRecipes/returnDistribution.test.ts`; expect missing-export/new-behavior failures.**
- [ ] **Step 3: Implement selected preparation and samples.** Layer strict selected-symbol checks on existing preparation; do not alter first-package treatment of unselected conflicts. Use previous=null on a known gap. Count discarded nonfinite returns separately from price gaps.
- [ ] **Step 4: Implement `buildReturnDistribution`.** Default bins are supplied by controls; builder enforces 5–100 integers. Calculate equal bins over full observed range, left-closed/right-open except final closed. Choose the bin index arithmetically with a final-maximum clamp, avoiding cumulative edge drift. Constant display half-width is `max(abs(value)*0.01,1e-6)` when finite; if it cannot form finite distinct edges, refuse explicitly. Bars carry boundaries/inclusion, count and count/N hover. Add N/date bounds/gap notes, percent X/count Y, no clipped outliers or extra statistics.
- [ ] **Step 5: Rerun Step 2 plus existing `input.test.ts`, `correlation.test.ts`, `monthlyReturns.test.ts`; expect PASS with original behavior retained.**
- [ ] **Step 6: Commit `feat(charts): add daily return distribution recipe`.**

### Task 4: Shared-base indexed small multiples

**Files:** Create `chartRecipes/smallMultiples.ts`, `smallMultiples.test.ts`; consume Task 3's `priceSamples.ts` without changing its interfaces.

**Interfaces:** Consume `MultiplesOptions`, `prepareSelectedPrices`, context width. Export `smallMultiplesGrid(width:number, count:number): {columns:number; rows:number; height:number}` and `buildSmallMultiples`. The builder returns ordinary `RecipeResult`; responsive geometry stays in figure layout.

- [ ] **Step 1: Add failing tests.** A=[100,110,90], B=[200,180,220] on shared dates must produce [100,110,90] and [100,90,110], the same baseline and axis ranges. Add a late-starting B to move the common baseline, stale last-delivered dates to cap all panels, disjoint valid dates to refuse, a null after baseline to break its path, nonfinite index to refuse, all-constant prices and 12 ordered symbols. Assert source bounds excluded by the common interval are noted.

Name the normalization test `indexes selected symbols on one shared baseline`; name the geometry test `reflows without changing the chart question`:

```ts
expect(smallMultiplesGrid(400, 12)).toEqual({ columns: 1, rows: 12, height: 2700 });
expect(smallMultiplesGrid(800, 12)).toEqual({ columns: 2, rows: 6, height: 1380 });
expect(smallMultiplesGrid(1200, 12)).toEqual({ columns: 3, rows: 4, height: 940 });
```
- [ ] **Step 2: Run `pnpm test:run src/lib/widgetData/chartRecipes/smallMultiples.test.ts`; expect new-builder failures.**
- [ ] **Step 3: Implement common interval and figure.** Find earliest intersection of positive observed dates across selected symbols; cap at earliest last delivered observation date and require at least one later valid observation for every selected symbol. All panels use identical date limits and numeric Y range including 100; a constant shared range gets finite symmetric padding. No independent rebasing or restart after a gap. Use stable symbol trace IDs and axis mappings in selection order.
- [ ] **Step 4: Implement grid geometry.** Width <640: one column; 640–959: two; >=960: three, capped by count. Use 220 plot pixels per grid row plus 60 total for margins; shared ranges stay unchanged across width changes. This geometry is a plan-level layout choice, not a new saved option. Reflow does not enter the question revision.
- [ ] **Step 5: Rerun Step 2 with widths 400/800/1200; expect PASS and identical numeric traces/order/ranges after reflow.**
- [ ] **Step 6: Commit `feat(charts): add shared baseline watchlist small multiples`.**

### Task 5: Original-weight ETF holdings Pareto

**Files:** Create `chartRecipes/etfPareto.ts`, `etfPareto.test.ts`.

**Interfaces:** Consume `ParetoOptions`, `readEtfEvidence(dataset,'holdings')`; export `buildEtfPareto` and a module constant `PARETO_WEIGHT_TOLERANCE = 1e-6` (fractional weight). No provider calls.

- [ ] **Step 1: Add failing tests.** Weights [.3,.2,.1] produce cumulative [.3,.5,.6], not [.5,5/6,1]. Unknown/paged/filtered coverage stays visibly scoped. Assert distinct IDs with equal labels remain separate; equal weights sort by ID; exact ID/weight duplicates collapse with note; conflicting IDs/weights and null/cell-error/negative/nonfinite/>1 weights refuse. Include zero.

Name the calculation test `accumulates original fund weights without rescaling`; inspect the builder's bar and line traces after narrowing successful RecipeResult:

```ts
expect(bars.y).toEqual([.3, .2, .1]);
expect(line.y[0]).toBeCloseTo(.3);
expect(line.y[1]).toBeCloseTo(.5);
expect(line.y[2]).toBeCloseTo(.6);
```
- [ ] **Step 2: Run `pnpm test:run src/lib/widgetData/chartRecipes/etfPareto.test.ts`; observe new-builder failures.**
- [ ] **Step 3: Implement validation, sorting and cumulative values.** Validate all delivered rows before selecting largest 50; invalid row 51 must still refuse. Use compensated summation for delivered and displayed sums. Total >1+1e-6 refuses. Within tolerance retain exact values and set Y maximum to `max(1,total)` with formatted headroom, no clipping/normalization. One Y axis for both weights and cumulative line; use stable internal category IDs and separate escaped labels.
- [ ] **Step 4: Add explicit cap/rounding regressions.** For 60 holdings of .01, assert 50 bars, final cumulative approximately .5, disclosed delivered sum approximately .6 and counts 50/60. For total 1.0000005 preserve it; total 1.000002 refuses. Unknown snapshot date must say 'Holdings as-of date not supplied'; retrieval time cannot fill that field. No Other or inferred remainder.
- [ ] **Step 5: Rerun Step 2; expect PASS for calculation and disclosure assertions.**
- [ ] **Step 6: Commit `feat(charts): add scoped ETF concentration Pareto`.**

### Task 6: Sector and geographic-region exposure dots

**Files:** Create `chartRecipes/etfExposure.ts`, `etfExposure.test.ts`.

**Interfaces:** Consume `ExposureOptions`, `readEtfEvidence(dataset,options.mode)` and export `buildEtfExposure`. The mode enum matches Task 2's sector/region kinds; fund-assets is never accepted for this chart.

- [ ] **Step 1: Add failing tests.** Sector and region fixtures preserve [.4,.2,0] without renormalization; 'North America' and 'United Kingdom' remain literal labels. Assert 'Reported equity exposure (%)', a fixed [0,1] X range, zero dots visible, stable weight/label order, coverage and date status. Duplicate categories refuse even for equal weights. Wrong mode, fund-assets, mixed fund evidence, invalid/cell-error weights refuse. Do not require category sum=1 or claim geographic categories are disjoint.

Name the region test `preserves geographic labels and original equity weights`; after selecting the dots trace:

```ts
expect(dots.x).toEqual([.4, .2, 0]);
expect(dots.y).toEqual(['North America', 'United Kingdom', 'Other supplied region']);
expect(figure.layout.xaxis.range).toEqual([0, 1]);
```
- [ ] **Step 2: Run `pnpm test:run src/lib/widgetData/chartRecipes/etfExposure.test.ts`; expect new-builder failures.**
- [ ] **Step 3: Implement dots and thin stems in scatter.** Preserve every category; one trace for stems with explicit breaks and one for dots. Set finite plot height to `max(280,36*categoryCount+80)`; UI scrolling is Task 7. Include original category/weight/basis hover and escaped labels; zero must have a visible marker at the origin.
- [ ] **Step 4: Rerun Step 2 with a long-category fixture; expect PASS and no dropped rows, normalization, synthetic category or country-map claim.**
- [ ] **Step 5: Commit `feat(charts): add ETF sector and region exposure dots`.**

### Task 7: Worker dispatch, controls, responsive viewport and lifecycle

**Files:** Modify/test `chartRecipes/{run,workerClient}.ts`, `run.test.ts`, `workerClient.test.ts`, `src/components/renderers/{LinkedChartRecipeControls,LinkedChartRenderer,ChartRenderer}.tsx`, their existing tests, `src/components/WidgetCard.linked.test.tsx`, `src/styles.css`. Add `src/lib/widgetData/chartRecipes/viewport.ts` and `viewport.test.ts` only for shared geometry decisions; avoid spreading layout math into multiple components.

**Interfaces:** `runRecipe` dispatches all four builder exports; no supported kind reaches the interim unsupported refusal. Controls consume existing role/default and decoder APIs. Add optional `scrollHeight?: number` to `ChartRenderer`: a scroll wrapper owns overflow while the Plotly node gets an explicit pixel height; absent preserves all existing chart sizing. `recipePlotHeight(kind,figure): number | undefined` reads finite layout.height only for small-multiples/etf-exposure and never trusts arbitrary imported Plotly JSON.

- [ ] **Step 1: Add failing controls/dispatch tests.** New labels are Return distribution, Small multiples, ETF holdings Pareto and ETF exposure. Histogram starts at 30 bins, needs one selected symbol, validates 5/100 endpoints. Multiples preserve checkbox selection order and reject 13. Exposure mode changes validate compatible source and never fetch a new endpoint. Stale/missing fields remain repairable and no fund/basis certification input is offered.
- [ ] **Step 2: Run `pnpm test:run src/components/renderers/LinkedChartRecipeControls.test.tsx src/lib/widgetData/chartRecipes/run.test.ts`; observe new controls/dispatch failures.**
- [ ] **Step 3: Wire dispatch and controls.** Extend labels, field defaults, availability, symbol loading and plain saved candidates. Keep type-switch cleanup and legacy displays. Validate worker viewport width; use ResizeObserver on the card's available plot width, updating context only when its grid breakpoint changes. Recompute geometry in the worker without changing semantic revision or issuing acquisition requests. Reuse existing worker abort/revision checks.
- [ ] **Step 4: Add failing real parent lifecycle tests parameterized across the four types.** Drive A success -> B pending -> B failure -> B recovery, then late A reply; assert no old plot while B pending/refused, exactly one source alert, B-only data after recovery and preserved chart/save errors. Same-source failure retains explicitly stale completed data. Repeat unsafe ETF source with its conflict field hidden and then repaired; repeat a price recipe with mixed acquired currency hidden and verify it remains refused. Assert export/import has settings but no runtime certification and revalidates the reacquired source.
- [ ] **Step 5: Implement scoped scrolling and status summaries.** Only the two tall recipe types opt into `scrollHeight`; small multiples use Task 4 geometry and dots use Task 6 height. The card viewport retains its height; inner Plotly content scrolls. Preserve resize/purge setup and accessible count/scope summaries; render source identity, coverage, filtered scope and unknown as-of date in text, not color alone. Keep unsafe-refusal clearing and one error owner.
- [ ] **Step 6: Run `pnpm test:run src/lib/widgetData/chartRecipes src/components/renderers/LinkedChartRecipeControls.test.tsx src/components/renderers/LinkedChartRenderer.test.tsx src/components/renderers/ChartRenderer.test.tsx src/components/WidgetCard.linked.test.tsx src/stores/tableExecutionStore.test.ts src/lib/widgetData/persistence.test.ts`, then `pnpm typecheck` and `pnpm lint` sequentially.** Expect all pass, no first-batch regressions; avoid running lint concurrently with Vite/Vitest temporary config generation.
- [ ] **Step 7: Commit `feat(charts): integrate risk and ETF chart controls and lifecycle`.**

### Task 8: Native example, browser acceptance and shipping evidence

**Files:** Create `docs/examples/v9-risk-exposure/{README.md,prices.json,holdings.json,sectors.json,regions.json,widgets.json}`, `docs/examples/v9-risk-exposure.apps.json`, `e2e/fixtures/risk-exposure.ts`, `e2e/risk-exposure.spec.ts`, `docs/releases/validation/v9/risk-exposure/verification.md`; modify `src/lib/appsJson.examples.test.ts`, chart help and v9 release notes named in the file map.

**Interfaces:** Reuse existing `e2e/fixtures/chart-recipes.ts` import/transport patterns, not its private seven-chart assumptions. Fixture sources use strict acquisition receipts from Tasks 1–2. Example has four chart cards plus source tables; exposure card can be relinked from sectors to regions to demonstrate both modes.

- [ ] **Step 1: Add failing example import and browser assertions.** Native import must preserve all four new settings and links; include zero/gap price data, an incomplete holdings snapshot, 60 delivered holdings and enough region categories to scroll. Assertions inspect numeric Plotly traces, visible coverage and actual hover, not only SVG existence.
- [ ] **Step 2: Run `pnpm test:run src/lib/appsJson.examples.test.ts` and `pnpm exec playwright test e2e/risk-exposure.spec.ts --project=chromium`; observe fixture/acceptance failures.**
- [ ] **Step 3: Build fixtures, example, help and browser flows.** Test light/dark rendering, histogram edges/counts, shared baseline/Y range, Pareto 50/60 disclosure, sector-to-region source repair, long-list scrolling, narrow/touch layout, card resize/reflow with order and zoom retained, source refresh/filter/refusal/removal, actual settings application and workspace export/import into another page. Keep fictional data and no credentials. Use existing fixture server conventions and document its exact start/import instructions.
- [ ] **Step 4: Rerun Step 2 plus first-batch browser suite `pnpm exec playwright test e2e/chart-recipes.spec.ts e2e/risk-exposure.spec.ts --project=chromium`; expect PASS.** Inspect the resulting light/dark/narrow screenshots and save representative artifacts under this batch's validation directory. Record what was actually inspected.
- [ ] **Step 5: Run shipping gates sequentially: `pnpm typecheck`, `pnpm lint`, `pnpm test:run`, `pnpm scrub`, `pnpm test:web`, `pnpm build`, `git diff --check`.** Record exits/counts/warnings and exact tested code pin. Compare dist total/JS/map bytes to the first-batch baseline built with the same lockfile; confirm no added Plotly trace registrations or package/lockfile changes. Do not assert a pass from prior-batch logs.
- [ ] **Step 6: Record repository scope.** Expected canonical provider `349f2de...` and Docker `f1ff723...` are unchanged because the new identity/basis transport is in BDOBB. Confirm both actual heads and clean diffs. If Task 2 proved upstream edits necessary, separately implement/review canonical changes, regenerate all vendor hashes, and run provider offline pytest, packaged image stack/source-pin tests, verify.py and offline ETF HTTP checks before claiming the paired stack verified; do not borrow the first-batch counts.
- [ ] **Step 7: Commit `docs(v9): add verified risk and ETF chart examples`.** Include evidence and release/help updates; no new public operations or first-package PR mutations.

### Task 9: Independent whole-branch review and local handoff

**Files:** Create `docs/releases/validation/v9/risk-exposure/review.md`; update `verification.md` with final reviewed/tested pins. Product edits only if a finding requires them.

**Interfaces:** Independent reviewer consumes approved spec, this plan, diff from first-batch code pin, test evidence and any provider/vendor diff. It must be separate from implementers. Keep the user's prior preference for subagent execution and independent final review unless they steer otherwise.

- [ ] **Step 1: Dispatch an independent reviewer with a precise base/head range and the design/plan links.** Ask for Critical/Important/Minor findings, file:line evidence, financial correctness, acquisition trust boundaries, retained hidden-field safety, source-error ownership, sizing/zoom behavior and scope completeness. Distinguish recorded agent review from GitHub approval.
- [ ] **Step 2: Resolve every actionable finding or document a technically supported disposition.** Add a failing regression for behavior fixes, observe RED, implement minimally, rerun affected checks and request scoped independent re-review. Rerun full gates only if changed code or unresolved evidence warrants it. No open Important/Critical issue at final acceptance.
- [ ] **Step 3: Write the final evidence record and commit `docs(v9): record independent risk and ETF chart review`.** Identify all four acceptance outcomes, exact tested code head, subsequent docs-only commits, retained warnings/skips and any browser/live-provider exclusions.
- [ ] **Step 4: Verify `git status --short`, `git diff --check` and local commit ranges; report actual outcome and worktree path.** Preserve worktree and existing open PR branches. Publishing follow-up PRs, merging and deployment require the user's later instruction.

## Plan self-review

Completed while writing, not delegated: each design section maps to contracts/evidence (Tasks 1–2), analytics (3–6), UI/persistence/lifecycle (7), examples/shipping (8), or independent review (9). The five Review Focus cases have explicit owning tests. Recipe discriminants, mode enums, builder names, evidence shape, limits and context width agree across tasks. Provider/vendor changes are evidence-triggered, with no pretend upstream deliverable. Layout and numerical defaults left open by the design are settled above without changing its scope. No implementation tests have been run or claimed for this planning-only commit.
