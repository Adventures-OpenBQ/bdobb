# V9 Screening and Income Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bubble regression, dividend steps and income-statement Sankey to v9, with defensible financial evidence and independently reviewed shipping results.

**Architecture:** Extend canonical provider acquisition metadata, transport it through linked tables and workers, and build three pure Plotly recipes. Preserve existing generated provider routes and legacy behavior. Vendor only verified canonical provider commits into Docker.

**Tech Stack:** TypeScript/React, existing Plotly 3.7 stack, Vitest/Playwright, Python/Pydantic/OpenBB AnnotatedResult, Rust table engine, Docker.

**Spec:** [Approved design](../specs/2026-11-19-v9-screening-income-design.md), approved in chat on 2026-11-19.

## Global Constraints

- Exactly three families; no hidden fetches, joins, FX, entitlement lookup, chart-vendor migration, dependency upgrade or full Plotly bundle. Add only Sankey trace registration.
- Bubble: dividend-yield fraction versus five-day price-change fraction; market-cap area; maximum diameter 48 pixels; no minimum-area distortion. Unweighted intercept OLS defaults on, requires N >= 3 and nonzero finite X/Y variance.
- Dividend: split-adjusted amount, ex-date, one qualified instrument/payment currency, inclusive acquired bounds, verified coverage; no unadjusted fallback, annualization or future extension.
- Sankey: one typed issuer/actual FY or FQ period/reporting currency/scale; positive revenue, finite nonnegative remaining anchors. No loss-period graph or aggregate operating-expense links.
- Evidence precedes projection, survives both engines and linked descendants, and is reacquired after import. Unknown evidence refuses; settings cannot certify data.
- Preserve source-status ownership, late-result fencing, draft/applied distinction, source repair, fitting-plot touch zoom and overflow-dependent scrolling.
- Keep earlier published branches/PRs unchanged; use isolated codex/ branches. No publication, merge or deployment in this plan.

## Review Focus

1. A discarded raw row or hidden conflicting denomination must still refuse the affected bubble cohort (Tasks 1, 4).
2. An empty response must not become a certified dividend history; a trailing omitted event must terminate the held level (Tasks 1, 6).
3. Quote currency, display abbreviations and requested bounds must never manufacture statement units or dividend coverage (Tasks 1, 7).
4. Same-source refresh and source replacement must not show the wrong graph or duplicate alerts after delayed worker/draw failures (Task 8).
5. Extreme finite numbers and seemingly identical duplicate observations must not yield misleading fits, step intervals or conserved flows (Tasks 5–7).

---

## Baselines, ownership and execution order

BDOBB baseline: design commit `1b90d824`, based on risk/exposure `67392d04b3e0ea4c52116d8b8dc88e914fb33fa1`. Provider baseline: `349f2de40773cf2e1d9e2993ebabf3184871c07d`. Docker baseline: `f1ff723e66ece8bf404a8211716a62591d464581`. At execution recheck clean status, heads and existing PRs BDOBB #87/provider #5/Docker #32; record divergence before choosing new branches. Do not reset another worktree or repeat the prior batch.

Execute Tasks 1–4 before chart builders; Tasks 5–7 consume their frozen interfaces; Task 8 integrates; Tasks 9–10 verify the final paired candidate. Preserve the user's chosen subagent execution: fresh implementer and fresh task review, then independent whole-change review. Never have concurrent writers in shared plumbing. Use repository-local Python environments and the installed pnpm/toolchain; commands below run from the named repository root. Use CodeGraph first only if `.codegraph/` exists.

### File map and shared interfaces

Provider additions: `openbq_eodhd/models/_chart_evidence.py` owns strict receipts and raw safety analysis; `models/screener.py`, `corporate_actions.py`, `fundamental.py` own acquisition/normalization; `tests/test_chart_evidence.py` owns cross-endpoint evidence tests. Retain generated `eodhd_router.py`; update generated widget assets through their existing generator, not hand-written route logic.

BDOBB additions under `src/lib/widgetData/chartRecipes/`: `financialEvidence.ts` (validated acquisition evidence), `bubbleRegression.ts`, `dividendSteps.ts`, `incomeSankey.ts` and matching `.test.ts` files. Existing `types.ts`, `settings.ts`, `bindings.ts`, `run.ts`, `recipe.worker.ts` dispatch the new closed kinds. `dataClient.ts`, `useWidgetData.ts`, `localTableData.ts`, `tableRowValues.ts` and `tableExecution/` transport evidence; statement model/compiler supplies typed origins. UI lives in existing linked controls/renderers; registration stays in `src/lib/plotly.ts`.

Freeze these names in Task 1/3; later tasks must import rather than reinvent them:

- Provider metadata key: `chart_evidence`, schema `version: 1`, discriminant `kind: 'screener' | 'dividends' | 'income'`. Return through `AnnotatedResult.metadata`, preserving the normal `results` list. Opt-in query `chart_source: bool = False` on the three existing models; examples opt in. No custom router or second upstream request.
- Common evidence: acquired qualified identity where applicable, UTC `retrieved_at`, raw/normalized/delivered counts, bounded diagnostic codes, `unsafe` facts, source field origins/units. Never include credentials or omitted numeric cells. Metadata is validated against completed request/response, not editable draft params.
- Screener data field `price_change_5d` is fractional; retain `currency_symbol`. Evidence has per-price-date denomination/duplicate safety, global unassignable identity/date and unit-conflict flags, and effective sort/filter/page scope. `exchange=US` plus `$` permits USD; other ambiguity stays unknown.
- Dividend evidence has qualified symbol, `amount_basis: 'split-adjusted-current-share'`, inclusive requested interval, coverage union `verified | unknown | clipped`, authority/reference, and coordinate-only raw event dates/invalid-date flags. Payment currency comes from events. No hidden amounts in evidence.
- Income evidence has qualified issuer, period kind/end, statement-owned currency, scale multiplier with authority, per-period full-record coverage and canonical field origins. Scale remains unknown until authoritative proof exists.
- `parseFinancialEvidence(value: unknown): FinancialEvidence | undefined`; `projectFinancialEvidence(evidence: FinancialEvidence, visibleCoordinates: readonly string[]): FinancialEvidence` preserves acquired safety and adds omission coordinates. Define/export `FinancialEvidence` as the strict discriminated union above. Projection cannot upgrade coverage or clear unsafe facts.
- Add recipe kinds `bubble-regression`, `dividend-steps`, `income-sankey`, each `version: 1`. Bubble options: role bindings, `priceDate: 'latest' | ISODate`, `regression: boolean`; dividend: role bindings and `instrument: string`; Sankey: `periodColumn: string`. Use existing binding types, worker input/context and `RecipeResult`; each new builder exports `buildBubbleRegression`, `buildDividendSteps` or `buildIncomeSankey` with signature `(dataset: WidgetDataset, options: RecipeOptions, context: RecipeContext): RecipeResult`, narrowing the discriminant internally as existing builders do. Import WidgetDataset from `../types` and recipe types from `./types`; ISODate means a validated YYYY-MM-DD string.

### Task 1: Canonical acquisition contracts and coverage policy

**Files:** Create provider `models/_chart_evidence.py`, `tests/test_chart_evidence.py`; modify `models/screener.py`, `models/corporate_actions.py`, `models/fundamental.py`; test `tests/test_phase3_market.py`, `tests/test_corporate_actions.py`, `tests/test_fundamental.py`, `tests/test_eodhd_router.py`.

**Interfaces:** Produces the opt-in AnnotatedResult and fields defined above. Shared raw transport returns successful empty lists to the opt-in path; legacy callers retain EmptyDataError. Shared normalizers are used by both paths; receipt construction occurs before dropped records.

- [x] Write `test_screener_chart_receipt_precedes_drop`, `test_dividend_empty_coverage_is_not_inferred`, `test_income_currency_is_statement_owned`, and legacy compatibility tests. Assert raw `refund_5d_p=5` becomes `price_change_5d=.05`, yield `.004` stays `.004`; missing code/date sets unsafe even if normalization drops it; same-date hidden EUR/USD conflicts survive. Assert quote GBX does not override dividend GBP or statement USD. Assert no metadata/empty/error behavior changes with `chart_source=False`.
- [x] Run `python -m pytest tests/test_chart_evidence.py tests/test_phase3_market.py tests/test_corporate_actions.py tests/test_fundamental.py tests/test_eodhd_router.py -q`; expect new contract assertions to fail before implementation.
- [x] Implement strict receipts and opt-in transport, including a single raw SDK request, genuinely empty versus error distinction, malformed ex-date refusal facts and full selected-period record facts. Preserve fractional units and raw counts; never derive safety from normalized survivors.
- [x] Pin authority in `docs/chart-source-contracts.md`: a deterministic fully acquired explicit snapshot fixture is the positive dividend coverage authority. Ordinary EODHD responses have **unknown coverage** unless an independently documented acquisition-bound coverage guarantee exists; do not accept a user query boolean or assumed subscription as proof. A request older than a known coverage window is clipped. Ship explicit safe snapshot examples and an honest real-route refusal when no authority exists. For canonical statement scale, cite an authoritative field-unit contract with a captured fixture before enabling that route; otherwise emit unknown scale and test refusal. Do not silently drop either chart family or claim a refused route verified. Supporting explicit snapshot receipts supplies the positive path without inventing EODHD entitlements/units.
- [x] Add positive covered snapshot, successful covered empty snapshot, clipped-history and unknown-scale fixtures. Assert invalid amount dates remain coordinate-only gaps; undated raw events make the entire acquisition unsafe. Test metadata actually reaches the HTTP envelope through OpenBB, including empty `results`.
- [x] Rerun the command above; expect all tests pass. Commit scoped provider files and contract document as `feat: expose opt-in financial chart acquisition evidence`.

### Task 2: Pair canonical provider and Docker source

**Files:** Docker `v9/eodhd/source/`, `v9/eodhd/source.json`, `v9/eodhd/tests/test_source_pin.py`, `v9/eodhd/tests/test_stack.py`, `v9/eodhd/verify.py`, `docs/v9/eodhd-port.md`, `v9/eodhd/README.md`; provider widget assets if normalized fields need exposure.

**Interfaces:** Consumes Task 1's committed canonical tree; produces exact vendored source and manifest pins, unchanged generated mirror semantics.

- [x] Add route tests asserting opted-in screener fields/receipt, dividends empty/unsafe metadata and income currency/scale status through the packaged OpenBB runtime. Assert standard requests retain legacy behavior and dotted response selectors can address `results` without losing envelope evidence.
- [x] Run `python -m pytest v9/eodhd/tests -q`; expect new route contract tests to fail against the previous vendor pin.
- [x] Regenerate vendor tree and hashes using the existing packaging procedure from Task 1's exact commit. Update field formats to show fractional five-day return once; expose payment/reporting facts without presenting them as quote currency.
- [x] Run `python -m pytest v9/eodhd/tests -q` and the existing `v9/eodhd/verify.py` invocation documented in the Docker README against a freshly built candidate image. Expect exact tree/hash equality and all route checks passing; record image digest. Commit `build: pin financial chart evidence provider`.

### Task 3: Preserve evidence through acquisition and both table engines

**Files:** Create `financialEvidence.ts`, `financialEvidence.test.ts`; modify `src/lib/dataClient.ts`, `src/hooks/useWidgetData.ts`, `src/lib/localTableData.ts`, `src/lib/tableRowValues.ts`, `src/lib/tableExecution/engine.ts`, `resultStore.ts`, `rust/protocol.ts`, `rust/runtime.ts`; update matching tests and `crates/pivot-core/` only where its wire/projection implementation requires it.

**Interfaces:** Produces the shared parser/projector and acquisition-bound FinancialEvidence. Extend the existing acquired-context transport atomically with rows; statement evidence joins compiler presentation provenance without trusting labels.

- [x] Add `hidden_bad_row_survives_second_link`, `dotted_selector_retains_envelope_evidence`, `stale_request_cannot_attach_receipt`, `projection_does_not_certify_empty` to the evidence and TS/Rust parity suites. Assert a filtered conflict remains unsafe; hidden dividend date contributes a gap but no amount; period-count limit remains full-record coverage; forged saved receipt is ignored.
- [x] Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/financialEvidence.test.ts src/lib/tableExecution`; expect new tests fail without transport.
- [x] Implement strict allowlisted decoding and projection. Preserve acquisition-wide flags, per-date cohorts, per-period completeness, field origins, coordinates and retrieval time across both engines and second-linked tables. No runtime receipt in dashboard serialization; reacquire on load. A missing/malformed receipt refuses evidence-dependent recipes.
- [x] Run the preceding Vitest command plus `pnpm pivot:test` and `pnpm pivot:build` when Rust/wire changes occur; exercise compiled WASM parity, not a mocked Rust label. Expect parity and snapshot allowlist tests pass. Commit `feat: retain financial chart evidence through linked tables`.

### Task 4: Closed options, bindings and typed statement input

**Files:** `chartRecipes/types.ts`, `settings.ts`, `bindings.ts`, `run.ts`, `recipe.worker.ts`, `workerClient.ts`, their tests; `src/lib/widgetData/persistence.ts`, `src/lib/appsExtensionsV4.ts`; create `chartRecipes/incomeSankeyInput.ts` and `.test.ts`; use `src/lib/statementModel/{catalog,taxonomy,compile,types}.ts` without changing formula semantics.

**Interfaces:** Produces three strict options and `resolveIncomeSankeyInput(dataset: WidgetDataset, options: Extract<RecipeOptions, {kind: 'income-sankey'}>): IncomeSankeyInput | RecipeRefusal`; export `RecipeRefusal = Extract<RecipeResult, {ok: false}>` from `types.ts`. Income input contains typed anchors/components, original monetary values, issuer, period, currency/scale and validated origins. Only canonical reported IDs plus the exact installed unmodified `calculated_gross_profit` formula are accepted; no additional alias/formula substitution.

- [x] Write decoder round-trip/unknown-key/version tests; hidden-binding repair tests; `renamed_or_moved_line_keeps_origin`, `edited_gross_profit_formula_refuses`, `common_net_income_is_not_net_income`, `limited_periods_not_truncated_lines`. Assert tampered settings cannot inject units/coverage and optional filtered COGS/tax remain unavailable, not zero.
- [x] Run `pnpm exec vitest run src/lib/widgetData/chartRecipes src/lib/widgetData/persistence.test.ts src/lib/statementModel`; expect new kind/input assertions fail.
- [x] Implement discriminated options, role-specific origin/unit checks, default latest actual date/period selection and fixed typed input resolver. Worker dispatch must not append legacy date-role notes to incompatible recipes. Revision includes financial question/choices, excludes viewport. Validate on import and execution.
- [x] Rerun the same tests plus existing apps V3/V4 envelope tests; expect old recipes unchanged. Commit `feat: define screening and income recipe contracts`.

### Task 5: Bubble sizing and stable regression

**Files:** Create `bubbleRegression.ts`, `.test.ts`; modify dispatch tests.

**Interfaces:** Consumes Tasks 3–4; produces `buildBubbleRegression` and `fitUnweightedOls(points: readonly {x: number; y: number}[]): {slope: number; intercept: number; rSquared: number; n: number} | {reason: string}`.

- [x] Write exact/noisy fit tests: points `(0,1),(1,3),(2,5)` yield slope 2/intercept 1/R² 1/N 3; `(0,0),(1,1),(2,1)` yields slope .5/intercept 1/6/R² .75. Test constant X/Y, N<3, zero yield/return, extreme finite data, conflicting duplicate missing/value, exact duplicate collapse, cap<=0 exclusions, disjoint-date currencies and hidden same-date conflicts. Assert fit uses exactly plotted rows, not capitalization weights.
- [x] Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/bubbleRegression.test.ts`; expect missing builder/fit failures.
- [x] Implement centered/scaled OLS, bounded rounding clamp, finite-line checks and observed-X endpoints. Marker area shares one scale capped at 48px diameter, with no minimum floor. Single sample trace prevents legend subset ambiguity. Label price-data date versus acquisition vintage, page/sort/filter scope, denomination, all counts/exclusions and withheld-fit reason. Escape hover labels; avoid overflow from direct cap squaring.
- [x] Rerun the targeted test and recipe suite; expect exact assertions and size-ratio checks pass. Commit `feat: add bubble scatter with unweighted regression`.

### Task 6: Dividend event segments and coverage refusal

**Files:** Create `dividendSteps.ts`, `.test.ts`; modify dispatch tests.

**Interfaces:** Consumes strict dividend evidence/options; produces `buildDividendSteps`. Segments use explicit known boundary endpoints and `connectgaps: false`; no omitted amount is available to the builder.

- [x] Write `held_level_ends_at_trailing_omission`: day1 amount1, missing day2, valid day3 amount2 produces day1→day2 at1, gap, day3 marker; when day3 absent the day1→day2 segment still exists. Test invalid/null/negative amount gaps, real zero, one event, no pre-first/future extension, future count, duplicate same-date refusal, malformed raw date, special/unknown labels, split-restated amount versus unadjusted amount, GBP payments with GBX quote, unknown/clipped coverage and covered empty snapshot.
- [x] Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/dividendSteps.test.ts`; expect new behavior assertions fail.
- [x] Implement chronological historical `hv` segments and markers, coordinate-only omissions, acquired/observed bounds, inclusive window validation, payment-currency/identity/basis refusal and explicit no-events versus unavailable messages. No missing-month zero inference or today/interval-end extension. Include retrieval vintage and all excluded/scheduled counts.
- [x] Rerun targeted and full recipe tests; expect exact segment coordinates and refusal reasons pass. Commit `feat: add evidence-backed dividend steps`.

### Task 7: Conserved typed income Sankey

**Files:** Create `incomeSankey.ts`, `.test.ts`; modify `src/lib/plotly.ts` and its trace allowlist tests.

**Interfaces:** Consumes `IncomeSankeyInput`; produces `buildIncomeSankey` and `buildIncomeFlows(input: IncomeSankeyInput): IncomeFlowGraph | RecipeRefusal`. Graph exposes stable stage IDs, strictly positive finite links and original-value stage summaries for conservation tests.

- [x] Write conserved fixtures R100/COGS40/GP60/totalOpEx70/OI30/PBT25/tax5/NI20: COGS40 and derived operating deduction30; no totalOpEx70 link or invented credit40. Test negative tax credit, both residual signs, unavailable optional cells, required cell error, zero anchors/links, loss refusal, FY/FQ conflict, statement-vs-quote currency, unknown/conflicting scale, typed formula origin, moved sections and extreme numeric ratios. Assert every stage inflow equals outflow and every link is finite positive.
- [x] Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/incomeSankey`; expect missing graph/build assertions fail.
- [x] Implement fixed DAG R→GP→OI→PBT→NI, expense sinks/credit sources, explicit derived middle bridges and stage residuals `B-A-sum(s)`. Reuse waterfall cancellation tolerance `min(EPSILON*max(abs(reported),magnitude),1e-9*max(1,abs(reported)))`; test a whole-unit residual remains visible. No double-counted aggregate/children. Reversible common display scale preserves originals in hover; refuse overflow/unfaithful widths. Fixed non-draggable nodes, accessible zero anchors and throughput-versus-reported labels. Register only installed Sankey module and derive native trace validation from registration.
- [x] Rerun targeted tests and Plotly allowlist tests; expect conservation and module registration pass. Commit `feat: add reconciled income statement Sankey`.

### Task 8: Controls and real parent/renderer lifecycle

**Files:** `src/components/renderers/LinkedChartRecipeControls.tsx`, `src/components/renderers/LinkedChartRenderer.tsx`, `src/components/renderers/ChartRenderer.tsx`, matching component tests, `src/styles.css`.

**Interfaces:** Consumes the three closed kinds and worker results; produces discoverable compatible recipes, explicit applied choices and bounded accessible status.

- [x] Add component tests for invalid draft preserving applied chart/disabled Apply, invalid applied/import clearing, A→B pending/failure/recovery, same-source failure showing one parent stale notice, late worker and draw failures ignored, current Plotly failure visible. Exercise each new family through the actual parent. Assert bindings/source/date/period/instrument reset question revision while resize does not.
- [x] Run `pnpm exec vitest run src/components/renderers/LinkedChartRecipeControls.test.tsx src/components/renderers/LinkedChartRenderer.test.tsx src/components/renderers/ChartRenderer.test.tsx` using resolved existing paths; expect new control/lifecycle assertions fail.
- [x] Integrate named recipe controls, regression toggle/date selector, instrument/period choices, repair guidance and source-owned status. Keep fitting scatter/step touch drag zoom and desktop zoom on resize; only overflowing content uses touch scroll. Fixed Sankey nodes remain inspectable. No duplicate source error banner.
- [x] Rerun component and recipe tests; expect lifecycle/error counts and controls pass. Commit `feat: integrate screening and income chart controls`.

### Task 9: Examples, documentation and real browser acceptance

**Files:** Create `docs/examples/v9-screening-income/`, `docs/examples/v9-screening-income.apps.json`, `e2e/fixtures/screening-income.ts`, `e2e/screening-income.spec.ts`; modify `src/lib/appsJson.examples.test.ts`, `src/help/guide/charts.md`, `src/help/topics/charts.md`, `docs/releases/v9.0.0-release-notes.md`.

**Interfaces:** Examples consume real versioned options; deterministic fixtures use the strict acquired receipt parser, including positive explicit snapshots and honest backend refusal examples.

- [x] Add example-import tests and Chromium cases for all three charts, visible sample/coverage/unit copy, actual bubble hover and Sankey node/link values, source repair, hidden conflict/gap behavior, export/import reacquisition on a new page, light/dark, narrow/touch, scroll versus fitting zoom and resized node stability.
- [x] Run `pnpm exec vitest run src/lib/appsJson.examples.test.ts` and `pnpm exec playwright test e2e/screening-income.spec.ts --project=chromium`; expect missing examples/control acceptance failures before adding examples.
- [x] Add examples and help explaining fixed question, delivered-page regression, split restatement, coverage refusal, derived Sankey bridges/loss refusal and scale authority. Use explicit US screener example; distinguish positive snapshot evidence from routes with unknown entitlement/scale. Inspect saved screenshots and actual counts/flows; repair visual clipping/hover/touch issues before passing.
- [x] Rerun commands above, expect all cases pass; commit `docs: demonstrate v9 screening and income charts` with fixture/browser changes.

### Task 10: Final paired verification and independent review

**Files:** Create `docs/releases/validation/v9/screening-income/{verification,review,rulings}.md`; provider/Docker evidence documents where relevant.

**Interfaces:** Consumes exact final candidate SHAs/image digest; produces reviewable results and independent review, not PRs or deployment.

- [x] Run BDOBB `pnpm typecheck`, `pnpm lint`, `pnpm test:run`, `pnpm scrub`, `pnpm test:web`, `pnpm build`, targeted Chromium suite plus existing chart-recipe/risk-exposure browser suites. Run compiled Rust parity/packaging checks if transport changed. Record counts, skips/warnings and baseline/candidate raw+gzip bundle bytes, isolating Sankey module growth from worker growth.
- [x] Run provider full offline `python -m pytest -q` with the existing network-blocking fixture/audit procedure (network denial must raise OSError so connection tests retain semantics). Rebuild Docker from the exact canonical candidate; run source equality/hash, image/route/pin checks and verifier. Never describe a mock fixture as live entitlement validation; list unknown-coverage/scale real-route refusals explicitly.
- [x] Request an independent whole-change review by a fresh reviewer uninvolved in implementation, covering all three repositories, design compliance, unsafe hidden facts, financial math, actual rendering and evidence claims. Record findings and exact reviewed SHAs. Treat review feedback through receiving-code-review; add regression tests before fixes and rerun affected checks. Independent reviewer checks the fix range before closure.
- [x] Record exact commands/results, source/image pins, screenshot paths, unresolved limitations and disposition of each finding. No open Important/Critical findings; do not label the paired real routes verified if proof is absent. Commit only durable verification documents as `docs: record screening and income verification and review`.
- [x] Present completed local changes, test evidence and independent review to the user. Preserve earlier PRs; publication is a subsequent requested action.

## Plan self-review and handoff

Coverage checked against every approved design section: provider pre-drop evidence, coverage/scale authority, both-engine projection, settings/typed origins, three mathematical builders, UI lifecycle, browser interactions and paired packaging each have an owning task. The five Review Focus conditions have explicit tests above. Interface names and dependency order are shared once; no runtime evidence is persisted. The local implementation, paired verification and independent review are complete.

The [verification record](../../releases/validation/v9/screening-income/verification.md) identifies the exact local candidate and its test scope. The [independent review record](../../releases/validation/v9/screening-income/review.md) records closure of all seven findings.
