# V10 Live Histogram, Drawdown and Small Multiples Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the existing histogram, drawdown and small-multiple views to use qualified live EODHD daily adjusted-price data, packaged as proposed v10 additions.

**Architecture:** Reuse the existing backend-authoritative daily-price receipt and coordinate lineage. Extend only the three selected consumers, worker admission and Parameters/renderer gates; preserve local preparation, financial algorithms and source ownership. Provider and Docker product contracts remain unchanged unless a demonstrated defect requires revising the design.

**Tech Stack:** TypeScript, React, Plotly 3.7.0, existing TypeScript and compiled Rust/WASM table engines, Vitest, Playwright, pnpm 10.34.4.

**Spec:** `docs/superpowers/specs/2026-11-21-v9-live-price-views-design.md` (functional design approved 21 November 2026; filename retained). V10 packaging is the controller's recommendation in response to the user's release question and is included for plan approval.

## Global Constraints

- “Live” means a refreshable daily historical acquisition, not streaming or intraday updates.
- Retain existing calculations, local-snapshot workflows and Plotly 3.7.0. Keep recipe version 1 and existing persisted settings.
- Enable only `return-distribution`, `drawdown`, `small-multiples`, alongside the already qualified `return-summary`. Correlation and monthly returns receive no new live admission.
- Table completeness stays unchanged, including `unknown`. Invalid live evidence must not gain snapshot authority. No hidden prices in receipts or live authority in portable exports.
- Histogram: one listing, 5–100 bins, at least two finite returns; known gaps reset adjacency. Exact live scope: **Observed quote-to-quote returns; exchange-session completeness unknown.**
- Drawdown: observed running peak carries across gaps; disconnected line and fill. Exact scope: **Drawdown uses observed adjusted prices in the loaded history; exchange-session completeness and peaks during missing observations are unknown.**
- Small multiples: 1–12 selected listings in selection order, earliest shared positive baseline at 100, common end from visible delivered dates including null-price rows. Exact scope: **Indexed observed adjusted prices; exchange-session completeness unknown.**
- Source table owns requests; no renderer acquisition, outside predecessor, session certification, rolling demo, new vendor or dependency upgrade.
- Fixed examples: **2026-10-12 through 2026-11-19**, **AAPL.US/MCD.US**; histogram AAPL, other views both. Parameters saved closed.
- Keep this work separate from open v9 PRs. Use a `codex/v10-live-price-views` execution branch with the approved client foundation; do not push the new code to the existing v9 branch. Release package/version bumps and merge targets belong to the eventual release process, not this feature implementation.
- No implicit app-catalog regeneration, push, merge or deployment. No empty provider/Docker changes to manufacture three PRs.

## Review Focus

1. A legitimate adjusted-price alias called `close` or `revenue_adjusted` must work in Parameters, mounted renderer and worker; actual raw close must refuse. Tests: Tasks 1/3.
2. An incompatible source replacement while an earlier request is held must not display the old chart under the new question. Tests: Tasks 3/5.
3. A malformed receipt on a backend dataset with snapshot-like metadata must not fall through to snapshot admission. Tests: Task 1.
4. Filtering the last row of one listing changes the small-multiple common end; omission coordinates must not extend it. Tests: Tasks 2/4.
5. A fully filtered selected listing is omitted with an explicit note in drawdown, but refuses the entire small-multiple result. Tests: Tasks 2/4.

## Files and task order

Tasks 1–3 are sequential: shared preparation, numerical consumers/worker, then UI gates. Task 4 validates their combined transport. Task 5 adds portable examples and real-browser qualification. Task 6 records final checks and independent reviews. Each coding task uses RED/GREEN and a focused commit; preserve actual failures and reruns.

Existing production files: `src/lib/widgetData/chartRecipes/{input,priceSamples,returnDistribution,drawdown,smallMultiples,run}.ts`, `src/components/renderers/{LinkedChartRecipeControls,LinkedChartRenderer}.tsx`. Tests stay beside their owners. Do not restructure these modules or add a capability framework. Add only the example, browser test and validation files named below.

### Task 1: Share narrowly admitted live-price preparation

**Files:** Modify `src/lib/widgetData/chartRecipes/input.ts`, `priceSamples.ts`; test `priceSamples.test.ts`, `dailyPriceEvidence.test.ts`; reuse `src/test/fixtures/liveDailyPrices.ts` and `chartSources.ts`.

**Interfaces:** Export `PreparedPrices` from `input.ts`; its successful variant gains `sourceMode: 'snapshot' | 'live'`. Export `acceptsLiveDailyPriceRecipe(kind: RecipeKind): boolean`, true for exactly the four permitted kinds. Rename `prepareLiveReturnPrices(dataset: WidgetDataset, fields: PriceBindings): PreparedPrices | undefined` to `prepareLiveDailyPrices` and migrate existing call sites. Add `preparePriceChartInput(dataset: WidgetDataset, fields: PriceBindings, kind: RecipeKind): PreparedPrices`: use qualified live preparation only for allowed kinds, otherwise preserve existing `preparePrices`. `prepareSelectedPrices` gains an optional final `kind?: 'return-distribution' | 'small-multiples'` argument; omitted argument preserves current local-only behavior. It delegates selection to the existing `selectPrices`.

- [ ] Write failing `priceSamples.test.ts` cases using `liveDailyPriceDataset`: qualified live inputs retain `completeness.kind === 'unknown'`, return `sourceMode === 'live'`, preserve adjusted values and raw gap coordinates. Assert the capability predicate is true for the four names and false for every other recipe kind.
- [ ] Add refusal cases for wrong original field, forged local authority, invalid receipt combined with snapshot-like metadata, conflicting original identities/units/interval, empty data, aggregation and mixed origins. Use existing evidence fixtures/checks rather than synthesizing trusted metadata by hand. Pin that unsafe facts cannot be removed by filtering to gain qualification. Snapshot results remain `sourceMode === 'snapshot'`.
- [ ] Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/priceSamples.test.ts src/lib/widgetData/chartRecipes/dailyPriceEvidence.test.ts`; confirm new cases fail for missing interfaces/live admission, not fixture errors.
- [ ] Implement those interfaces with the existing reader, coordinate projection and `finishPrices`. Keep generic `preparePrices` local behavior intact. Preserve the original return-summary local proof checks and sample thresholds. If `provenance.metadata.chartSources` has its own `daily-price` entry but `readLiveDailyPriceSource` fails, refuse before snapshot fallback; entry presence is only grounds to refuse, never grounds to admit. Apply the same guard to return-summary admission. Keep return-specific scope wording in the return-summary consumer so sharing preparation does not mislabel drawdown or indexed prices; preserve its exact existing copy. Do not grant trust from a newly invented metadata flag.
- [ ] Run the same tests plus `src/lib/widgetData/chartRecipes/returnSummary.test.ts` and `pnpm typecheck`; expect all pass. Commit `refactor: share qualified live price preparation` with only the task's files.

### Task 2: Wire the three numerical consumers and worker

**Files:** Modify `src/lib/widgetData/chartRecipes/{returnDistribution,drawdown,smallMultiples,run}.ts`; test their corresponding `.test.ts` files. Reuse Task 1 interfaces and existing builders/options/types.

**Interfaces:** Existing `buildReturnDistribution`, `buildDrawdown`, `buildSmallMultiples` and `runRecipe` signatures remain unchanged. Histogram/small multiples pass their own kind to `prepareSelectedPrices`; drawdown uses `preparePriceChartInput`. Use `sourceMode` for source-specific notes/labels; shared preparation must not attach return-only wording to price-level views. Worker binding bypass remains conditional on both allowed kind and verified live evidence, followed by origin checks in preparation.

- [ ] Add live-builder tests and corresponding `runRecipe` tests. For histogram, `[100,100,110,99]` at 5 bins gives counts `[1,0,1,0,1]`, total 3. Three quotes allow two returns; two quotes refuse. Retain existing edge/constant/overflow cases. Check title `Observed return distribution`, axis `Observed quote-to-quote return`, live sample/refusal wording and exact scope; local titles/copy remain unchanged.
- [ ] Pin gap differences with dated quotes: Tue 100, Thu 121, Fri 133.1 yields two observed pairs if Wednesday was never acquired; an evidenced missing Wednesday breaks the first pair, leaving one and therefore an insufficient histogram. Include Friday-to-Monday. No hidden predecessor is available.
- [ ] For drawdown, test `[100,120,null,90,150]` gives `[0,0,null,-0.25,0]`, with both line and fill disconnected and the pre-gap peak retained. Keep the loaded-history title, exact live scope and existing omit-with-note behavior; all selected unavailable refuses. Do not add a twelve-listing cap.
- [ ] For small multiples, A prices 100/110/121 on Jan 5/6/7 and B prices 50/55 on Jan 6/7 produce baseline Jan 6, end Jan 7, A `[100,110]`, B `[100,110]` within numerical tolerance. Filter B's last row: end becomes Jan 6 and lack of a later valid observation refuses. A delivered null final row still determines end; an omission coordinate alone cannot extend it. Missing selected listing refuses without dropping a panel. Check exact live scope and identical local/live numerical output for equivalent observations.
- [ ] Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/returnDistribution.test.ts src/lib/widgetData/chartRecipes/drawdown.test.ts src/lib/widgetData/chartRecipes/smallMultiples.test.ts src/lib/widgetData/chartRecipes/run.test.ts`; verify meaningful RED.
- [ ] Wire preparation and source-specific copy without rewriting histogram binning, peak calculation, `fillRuns`, common-date helpers or indexing. Update only the allowed worker preflight. Add regression assertions that live correlation/monthly returns still refuse and box/violin remain admitted.
- [ ] Run the same tests plus Task 1 tests and `returnSummary.test.ts`; expect all pass. Commit `feat: enable live histogram drawdown and small multiples`.

### Task 3: Admit live input through Parameters and the mounted renderer

**Files:** Modify/test `src/components/renderers/LinkedChartRecipeControls.tsx` / `.test.tsx`, `LinkedChartRenderer.tsx` / `.test.tsx`.

**Interfaces:** Rename the shared acquired-input callback/prop `loadReturnInput` to `loadPriceInput`, retaining the existing `LoadAcquiredInput = (signal: AbortSignal) => Promise<WidgetDataset>` prop contract; the renderer may return its existing `ChartResult` subtype. Keep return-summary-only draft/listing callbacks and measured Apply behavior distinct. Use Task 1's predicate for the four recipe kinds. Do not change exported saved settings or existing `loadSymbols` local choices.

- [ ] Add failing controls tests for each new kind: an admitted backend dataset with unknown completeness populates listing choices and origin-based fields. Adjusted aliases `close` and `revenue_adjusted` work; a raw close origin never becomes a candidate. A local snapshot with existing non-qualified symbol names retains its former choices; do not apply the return-summary-only qualified listing filter globally.
- [ ] Add mounted renderer tests: the three live charts reach the worker despite unknown table completeness; invalid/empty inputs show worker refusal and reopen-Parameters action. Test all three gates, including `FinancialChart`'s current early `savedBindingIssue` and completeness checks. Correlation/monthly returns retain current restrictions.
- [ ] Add replacement/draft tests: hold an old source response, replace bounds/symbol/backend, release old response and assert it cannot restore the old result; a matching refresh failure may retain labeled stale output. Unapplied chart changes remain drafts across closing/reopening Parameters.
- [ ] Run `pnpm exec vitest run src/components/renderers/LinkedChartRecipeControls.test.tsx src/components/renderers/LinkedChartRenderer.test.tsx`; verify new assertions fail for the actual early gates.
- [ ] Generalize acquired-input loading and origin choices for exactly the allowed kinds. For these kinds, defer ready-only binding/completeness decisions to authoritative worker admission rather than treating unknown as complete. Preserve raw-local validation in the worker. Keep `returns` state exclusively for return-summary view/window/measuring logic; do not expose those controls on the new kinds.
- [ ] Run the same tests and `pnpm typecheck`; expect all pass. Commit `feat: expose live price views in Parameters`.

### Task 4: Prove filtering and linked lineage on both engines

**Files:** Extend `src/lib/tableExecution/rust/dailyPriceEvidence.test.ts`; reuse `src/test/tableProviderBoundary.ts` and its existing TypeScript/compiled-Rust engine matrix. Production transport files change only if a demonstrated failure requires it.

**Interfaces:** Consume the unchanged `LocalWorkerExecutor.chartData` and Task 2's `runRecipe`. Existing `daily-price` coordinate transport and backend receipt are the contract; no new Rust wire schema or provider receipt is planned.

- [ ] Add matrix cases running all three options against filtered, renamed, reordered linked grandchildren. Compose a raw omission with a different table-filtered coordinate and assert distinct notes and nulls. Assert original column origins remain authoritative under misleading adjusted aliases.
- [ ] Verify histogram sample counts, drawdown carry-across-gap values and small-multiple baseline/end after filtering final rows. Filter every row of one selected listing and assert drawdown's named omission versus small-multiple refusal. Verify metadata contains coordinates but no removed numeric prices.
- [ ] Add mixed-source/aggregate refusal and portable-provenance removal checks using existing export tests/helpers where already owned; avoid introducing a new export format. Ensure source replacement invalidates old tickets in both engines.
- [ ] Run `pnpm exec vitest run src/lib/tableExecution/rust/dailyPriceEvidence.test.ts`; verify new consumer expectations fail before their wiring where useful, then pass with Tasks 1–3. Use actual compiled WASM; missing artifacts are setup failures, not optional skips. Run `pnpm pivot:build` once if current artifacts are absent/stale, then `pnpm pivot:verify`.
- [ ] Commit `test: cover live price view lineage in both engines`. If all added tests immediately pass because transport already supports them, record that fact; do not manufacture a transport change or fake a RED result.

### Task 5: Add v10 examples and browser/installed replay qualification

**Files:** Create `docs/examples/v10-live-price-views.apps.json`, `docs/examples/v10-live-price-views/README.md`, `e2e/live-price-views.spec.ts`, `e2e/installed-price-views.spec.ts`, `playwright.live-price-views.config.ts`. Reuse `e2e/fixtures/{return-summary,chart-recipes}.ts` and the captured `e2e/fixtures/installed-observed-returns/75a9026/*.json`; change shared fixture helpers only when required for reuse.

**Interfaces:** New example has one opted-in source table and three linked charts, recipe version 1, existing `extensions.bdobb`/layout shape and nested widget `data.dataKey='results'`. Source selection and backend connection follow the existing observed-return example. No credentials in JSON. Browser tests consume existing fixture `test` for engine/WASM evidence and `card`, `plot`, `openParameters` helpers.

- [ ] Write failing tests that import the exact new example, find all three configured charts, verify Parameters saved closed/reopened and fixed request bounds/listings. Capture real recipe-worker replies for numerical assertions and check actual Plotly traces plus accessible notes; do not use SVG presence as numerical proof.
- [ ] Add installed replay cases using captured mirror equity and ETF responses and public-demo capture. Independently derive expected values from raw response arrays: histogram sample/bin totals, drawdown per-date observed peaks, and small-multiple baseline/indexes. Assert public capture has 29 prices/28 observed pairs per listing. Label synthetic tests, installed replay and any current-network probe distinctly; standard canonical captures do not prove supported Core 2 installed standard routes.
- [ ] Add browser actions covering all three forms: histogram listing/bins, drawdown listing selection, small-multiple ordering; apply/reopen preserves choices and uses no extra acquisition. Cover filtering a known point, source replacement with held old GET, refresh failure/recovery, off-tab committed Run/Rita with explicit-override preservation, export/import without proof followed by reacquisition. Extend existing lifecycle tests instead of duplicating an entire matrix where their assertions already prove shared behavior.
- [ ] Add `playwright.live-price-views.config.ts`: inherit ordinary web server/defaults, select only the two new specs, define `chromium`/`webkit` using Desktop Chrome/Safari, workers 1, retries 0, retain failure traces. The existing fixture records actual browser and WASM loading for both engines. Keep existing global CI config unchanged unless adding these cases there is necessary.
- [ ] Run `VITE_TABLE_ENGINE=typescript pnpm exec playwright test --config playwright.live-price-views.config.ts`; confirm missing example/live gates produce RED. Create the example and README without catalog regeneration; label requires BDOBB 10.0.0 or later for released availability and paired qualified backend. Preserve original snapshot examples unchanged.
- [ ] Run the preceding command and `VITE_TABLE_ENGINE=rust pnpm exec playwright test --config playwright.live-price-views.config.ts`, with a newly started or verified matching-engine browser server for each. Expect all new cases pass in both browsers with zero retries and Rust WASM evidence. Archive screenshots and replies outside product fixtures; no blanket timeout increases to hide waits.
- [ ] Commit `feat: add v10 live price view examples and browser coverage`.

### Task 6: Final verification, independent reviews and handoff

**Files:** Create `docs/releases/validation/v10/live-price-views/verification.md` and `review.md`; update this plan's checkboxes only for completed steps. Use existing provider/Docker checkout paths recorded below read-only unless a defect is established.

**Interfaces:** Deliver an evidence record binding commands/results to exact client/provider/Docker commits and captured installed responses. Independent reviewer receives approved spec, this plan and full implementation diff, including examples/tests.

- [ ] Run client checks once after the final product changes: `pnpm test:run`, `pnpm typecheck`, `pnpm lint`, `pnpm knip`, `pnpm scrub`, `pnpm test:web`, `pnpm pivot:test`, `pnpm pivot:verify`, `pnpm test:pivot:packaging`, `pnpm build`, `pnpm build:web`. Run the Task 5 two-engine browser commands and existing `e2e/live-return-summary.spec.ts`, `e2e/installed-return-summary.spec.ts`, `e2e/risk-exposure.spec.ts` for regression coverage; use Chromium/WebKit configuration as appropriate and record actual cases, not an assumed total. Re-run affected checks after any fixes; broader repetition needs a new reason.
- [ ] Verify paired installed replay still matches provider `75a902664054b3afbd23c5b6328efe7eedcf429c` and Docker `2c5464675090c73f0c52cf8482ccf454e07b7704` receipts/selectors from the qualified capture. Run affected installed/provider tests only if those sources or contracts change; otherwise document unchanged inputs and current replay result. Do not claim a new image build, current live HTTP check or full provider rerun from historical evidence.
- [ ] Obtain a fresh independent whole-change Superpowers review covering financial semantics, qualification boundaries, UI gates, source lifecycle, both-engine transport and v10 packaging. Run the previously requested Ponytail full review workflow if available; record actual scope and findings separately. Address actionable findings with failing regression tests and focused verification. Require no unresolved blocking findings before completion.
- [ ] Record commands, exact heads, results, genuine optional skips, failures/reruns, replay origin and review dispositions. Verify examples contain no credentials and no live proof survives portable exports. Run `git diff --check` and commit `docs: record v10 live price view verification and review`.
- [ ] Hand off local branch, test results, independent-review status and any material limits. Do not push, create PRs, merge the reviewed v9 work or deploy without a subsequent instruction covering those actions.

## Execution preparation and self-review

Use the existing isolated client workspace (currently `codex/v9-live-price-views-design`) and preserve its approved design/plan commits when creating the execution branch. Do not alter the original open v9 branch. The implementation baseline inherits qualified v9 code; eventual release integration must include that prerequisite rather than treating it as already merged.

Client workspace: `/Users/artcashin/.codex/worktrees/v9-live-observed-returns/openbq-bdobb-v9-bullet`. Provider: `/Users/artcashin/.codex/worktrees/v9-live-returns-provider/openbq-eodhd`. Docker: `/Users/artcashin/.codex/worktrees/v9-live-returns-docker/openbq-docker-v9-bullet`. Check current status and exact commits before executing, and inspect `.codegraph/` before searching code in each repo; do not index missing graphs. Record baseline/setup checks under the task's verification record, install no dependencies during planning, and preserve unrelated local changes.

Self-review completed against every design section: receipt/scope and fallback Task 1; algorithms and exact copy Task 2; Parameters/lifecycle Task 3; engines/lineage Task 4; examples/installed replay/browser lifecycle Task 5; verification/review/shipping boundaries Task 6. Each Review Focus item has an owning task. Existing `return-summary` behavior and local snapshots remain explicit regression obligations. No new financial algorithm, acquisition service, saved setting or provider certificate is introduced.

Execution method carried forward from the user's project preference: subagent-driven tasks with independent review, followed by a fresh whole-change review. Await plan review before invoking implementation skills.
