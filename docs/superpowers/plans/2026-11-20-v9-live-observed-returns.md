# Live Observed Returns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable existing box/violin charts from bounded EODHD daily US listing acquisitions while retaining known gaps and disclosing unknown exchange-session completeness.

**Architecture:** Capture raw-response facts before normalization and transport a closed, opt-in daily-price receipt alongside the delivered rows. Validate it against the completed source request, preserve coordinate-only omissions through both table engines, and admit the same samples in controls and worker. Keep the existing statistical implementation and source ownership.

**Tech Stack:** Python/Pydantic/OpenBB/EODHD SDK; TypeScript/React/Vitest/Playwright; Rust pivot-core/WASM; existing Plotly 3.7.0; paired Docker image.

**Spec:** `docs/superpowers/specs/2026-11-20-v9-live-observed-returns-design.md` (user approved 20 November 2026).

## Global Constraints

- “Observed quote-to-quote returns; exchange-session completeness unknown.” Use this exact visible scope sentence for live inputs.
- General qualified .US listings, including NYSE/Nasdaq; no AAPL/MCD whitelist or venue certification.
- Fixed examples: 2026-10-12 through 2026-11-19 inclusive; AAPL.US and MCD.US. No rolling default.
- One successful full unpaged daily array per requested listing, 1–12 selected listings. Partial acquisition cannot silently shrink selection.
- Both endpoints come from acquired adjusted-close history; no raw-close substitution, hidden predecessor, calendar or renderer fetch.
- Known invalid/dropped/filtered observations break adjacency; an upstream-undelivered date is unknown, not an invented gap.
- Boxes require five finite returns; violin twenty plus valid density. Preserve R7, Tukey, KDE, bandwidth and common-window clipping before differencing.
- Preserve ordinary responses, local snapshots, Parameters/drafts/Apply, pins, source tickets, geometry fences and Rita ownership.
- No numeric prices in receipts or omission metadata; no backend proof survives portable export.
- Plotly and unrelated dependency versions remain unchanged. Docker qualification needs patched certifi before deployment; no deployment is authorized.

## Review Focus

1. Mixed valid/failed multi-listing response must refuse qualification, never show a successful subset (Task 1).
2. A known raw gap and a different later-filtered gap must both break pairs through a grandchild (Task 3).
3. A synthetic backend receipt imported from a file must not gain live authority (Task 2).
4. A held old request completing after credential/window replacement must not republish obsolete output (Task 4).
5. Provider schema exposed through the installed generated alias must actually transport the receipt, not merely advertise a flag (Task 5).

---

## Workspaces and file responsibilities

Client checkout is the current isolated `codex/v9-live-observed-returns` branch. Before execution, create isolated provider and Docker worktrees from merged provider main and Docker release/v9 using using-git-worktrees. Do not reuse or reset original release branches. Record exact bases and working-tree status. No `.codegraph/` exists in the inspected roots; recheck the new roots and use CodeGraph first if present.

`P/` below means the canonical provider root; `D/` means the Docker root; unprefixed paths are client-relative. Never hand-edit `D/v9/eodhd/source` independently of canonical source. Preserve original release workspaces and six catalog recovery files. Never run the default catalog generator: any catalog check must use an explicit disposable `OPENBQ_DOCKER_DIR`.

- Provider `_daily_price_chart_source.py`: closed receipt models and raw acquisition accounting.
- Provider `_bars.py`, `equity_historical.py`: opt-in acquisition plumbing, ordinary path unchanged.
- Client `dailyPriceEvidence.ts`: closed receipt decoder/route/row reconciliation and live admission adapter.
- Existing chart-source contracts/registry: family registration and shared transport only.
- Existing price evidence/input/samples: gap composition and return-specific admission, no global completeness promotion.
- Engine projection modules and Rust chart sources: coordinate/field lineage only.
- Existing renderer/controls: shared eligibility and scope disclosure.
- Docker installed tests and canonical vendor: actual runtime transport and pairing.

## Shared interface decisions

Add family kind `daily-price` to both closed unions. Keep envelope maximum seven receipts: that is a per-response family limit, not registry size. Use one receipt for the whole requested listing set, so existing delivered-count equality remains valid.

`DailyPriceReceipt` extends the existing version-1 common receipt. Add exact fields: `interval: '1d'`, `start_date: string`, `end_date: string`, `symbols: string[]` (ordered qualified unique keys), `date_field: 'date'`, `price_field: 'adjusted_close'`, `symbol_field: 'symbol' | null`, `listings: DailyPriceListingFacts[]`. Each listing facts record has `symbol`, `raw_count`, `normalized_count`, `delivered_count`, `duplicate_count`, `omissions: [symbol, date][]`. Counts sum to common counts; exact duplicate collapse is accounted separately from omissions. Dates are strict ISO dates within bounds. Capture raw endpoint responses before mutating bars or normalizing them. No embedded prices.

`unsafe` has exactly `undatable_loss`, `conflicting_duplicates`, `identity_conflict`, `partial_acquisition`, `invalid_response`, `missing_adjusted_basis` boolean keys. Unsafe facts prevent admission, not ordinary table use. Use common ordered diagnostics derived from these keys; do not accept arbitrary diagnostic strings. A valid empty list can produce a counted insufficient result on opt-in while ordinary empty behavior stays unchanged.

Client exports `dailyPriceSourceAdapter: ChartSourceAdapter<DailyPriceReceipt>` and `readLiveDailyPriceSource(dataset: WidgetDataset): { receipt: DailyPriceReceipt; scope: PriceScope; symbols: string[]; rawOmissions: PriceCoordinate[] } | undefined` from `dailyPriceEvidence.ts`. The latter returns only reconciled transient backend authority and original/projection field identity. Unknown upstream coverage never becomes global table completeness. Keep provider raw omissions distinct from the existing table `priceOmissions` until recipe admission unions coordinates; retain separate counts for explanation.

### Task 1: Capture and qualify raw provider arrays

**Files:** Create `P/openbq_eodhd/models/_daily_price_chart_source.py`, `P/tests/test_daily_price_chart_source.py`; modify `P/openbq_eodhd/models/{_chart_sources.py,_bars.py,equity_historical.py}`, `P/tests/{test_bars.py,test_equity_historical.py}`, `P/docs/chart-source-contracts.md`.

**Interfaces:** Consumes actual per-listing SDK response, explicit query bounds and final normalized rows. Produces `DailyPriceReceipt` and existing `AnnotatedResult` metadata envelope. Add optional raw observer to shared bar acquisition with default disabled; ordinary crypto/FX callers do not participate. Reject omitted explicit bounds before transform_query supplies defaults when chart_source is enabled.

- [ ] Write `test_daily_price_opt_in_counts_calls_and_raw_gaps`: three dated raw rows, middle close null, two delivered rows; assert one SDK call, raw=3/normalized=2/delivered=2 and middle coordinate present, original retrieval time retained. Verify no extra request occurs.
- [ ] Add parameterized raw cases: malformed/denied/partial/paged object; undatable loss; adjusted null/nonpositive/nonfinite; raw-close-only; same-date exact and conflicting repetitions; conflicting symbol aliases; out-of-bounds dates; missing bounds; weekly/intraday/non-US; empty array. Assert qualification or exact unsafe reason and no close fallback. Exact repetitions collapse once; conflicting prices refuse even if later filtered.
- [ ] Add multi-listing case with one failed array: assert no successful-subset receipt. Assert selection order, per-listing count sums and single-listing null symbol_field. Test legacy responses and ordinary EmptyDataError unchanged.
- [ ] Run `python -m pytest tests/test_daily_price_chart_source.py -q` in P; preserve actual RED output before implementation.
- [ ] Implement the closed schema and observer/plumbing, attaching receipts only for opted-in daily qualified US equity/ETF fetches. Test the shared fetcher registration explicitly and prove crypto/FX/plain requests receive no receipt.
- [ ] Run `python -m pytest tests/test_daily_price_chart_source.py tests/test_bars.py tests/test_equity_historical.py tests/test_chart_sources.py -q`; expected all passing. Commit provider implementation and raw RED/GREEN evidence summary.

### Task 2: Bind receipts to completed client acquisitions

**Files:** Create `src/lib/widgetData/chartRecipes/dailyPriceEvidence.ts` and `.test.ts`; modify `chartSourceContracts.ts`, `chartSourceRegistry.ts`, `chartSourceContracts.test.ts`, `chartSourceRegistry.test.ts` in that directory; extend `src/test/fixtures/chartSources.ts` only for reusable fixtures.

**Interfaces:** Consumes Task 1 exact wire schema and existing `BackendAcquisition`/`ChartSourceAdapter` contracts. Produces the adapter and `readLiveDailyPriceSource` signatures above. Register only the standard equity/ETF historical and generated mirror paths actually discovered from installed OpenAPI in Task 5; obtain route fixtures before finalizing tests, not guessed paths.

- [ ] Write `test_completed_request_and_selected_rows_required`: actual response results and envelope admit only with exact route/provider/selector, opt-in, explicit bounds, interval and ordered declared symbols. Check selected array equality, all count sums, raw omission accounting and original field origins.
- [ ] Write `test_live_authority_cannot_be_imported_or_filtered_clean`: synthetic local-backend receipt, unknown keys/unsafe fields, duplicate or case-conflicting query keys, wrong selector/provider, forged count/date/listing, mismatched row alias and pre-filter unsafe facts all refuse. Ordinary tables remain available and unknown global completeness stays unknown.
- [ ] Run `pnpm exec vitest run src/lib/widgetData/chartRecipes/dailyPriceEvidence.test.ts`; record RED.
- [ ] Implement strict decoding, route matching, whole-acquisition reconciliation and backend-only authority using existing capture/projection hooks. Do not invent a generic trust flag or persist response prices in metadata.
- [ ] Run the new test plus `chartSourceContracts.test.ts` and `chartSourceRegistry.test.ts` with vitest; expected all passing. Commit.

### Task 3: Preserve gaps through both engines and admit observed samples

**Files:** Modify `src/lib/widgetData/chartRecipes/{priceEvidence.ts,input.ts,priceSamples.ts,priceSamples.test.ts,returnSummary.test.ts}`, `src/lib/tableExecution/{engine.ts,resultStore.ts}`, `crates/pivot-core/src/chart_sources.rs`; create `src/lib/tableExecution/rust/dailyPriceEvidence.test.ts`. Touch shared projection/wire types only if the existing coordinate protocol cannot represent this family.

**Interfaces:** Consumes Task 2 adapter/reader; produces return-specific admitted input for existing `admitReturnSamples` caller, retaining local-file path. Provider omissions and table omissions are distinct metadata channels; combine only as null coordinates for the existing price indexing/pairing functions. Original field identity must survive rename/reorder/link, including single-symbol sources with no symbol column.

- [ ] Add paired fixtures Tue=100/Thu=121: unknown Wednesday yields exactly one 0.21 return; raw omitted Wednesday yields no pair. Friday=100/Monday=110 yields one 0.10 return. Use tolerance for floating ratios, exact coordinates for identity.
- [ ] Add both-engine alias/reorder/filter/link/grandchild cases with a raw Wednesday omission plus a different delivered row filtered later: assert both interruptions survive, no numeric values are carried in evidence, and aggregation/mixed identity/ambiguous origins refuse. Filter cannot erase an original conflict.
- [ ] Add common-window tests excluding the first price before differencing, preserved selection order, absent listing refusal, 4/5 and 19/20 thresholds, zero-IQR and extreme values. Existing snapshot tests must remain unchanged and passing.
- [ ] Run new vitest cases before implementation and save RED. Build actual Rust/WASM for compiled-engine tests; do not substitute a mocked bridge.
- [ ] Implement narrow propagation and shared admission. No change to dailyReturnSamples ratio math, R7/Tukey/KDE algorithms or other recipes' completeness requirements.
- [ ] Run `pnpm pivot:build`, `pnpm exec vitest run src/lib/widgetData/chartRecipes/priceSamples.test.ts src/lib/widgetData/chartRecipes/returnSummary.test.ts src/lib/tableExecution/rust/dailyPriceEvidence.test.ts src/lib/tableExecution/rust/priceEvidence.test.ts`, and `pnpm pivot:test`; expected passing compiled transport and math tests. Commit.

### Task 4: Expose live eligibility and preserve source lifecycle

**Files:** Modify `src/components/renderers/{LinkedChartRecipeControls.tsx,LinkedChartRecipeControls.test.tsx,LinkedChartRenderer.tsx,LinkedChartRenderer.test.tsx}`, `src/lib/widgetData/chartRecipes/{returnSummary.ts,types.ts}` only as required; create `e2e/live-return-summary.spec.ts`; extend `e2e/fixtures/return-summary.ts`. Add fixed source examples using the existing example authoring path, Parameters saved closed.

**Interfaces:** Both controls and worker consume Task 3 admission, not independent URL heuristics. Render exact global scope sentence plus explanation that pairs may span sessions when upstream observations were absent. Keep local snapshot copy appropriate to its authority.

- [ ] Add component RED proving live qualified input offers box/violin while an ordinary unqualified historical table does not; both modes render identical samples. Parameters starts closed and reopening preserves draft and applied values.
- [ ] Add held-request RED: symbol/bounds/interval/backend/selector/credential replacement retires old output, late completion cannot restore it; matching refresh alone may retain stale output with one error notice. Draft navigation does not Run. Exercise configured/pinned Rita with off-tab Run and explicit override preservation using existing ownership fixtures.
- [ ] Implement eligibility/copy and fixed examples. No renderer network calls, proof export, new vendor, calendar query or numeric metadata.
- [ ] Add Playwright tests for actual source-table GET, Plotly/accessible counts, box→violin, filtering/common window/pins, replacement/failure/recovery, off-tab Run/Rita and export/import/reacquisition in both TypeScript and compiled Rust modes. Imported file must not retain live authority; deliberate documented local snapshots still work.
- [ ] Run component vitest tests, `pnpm exec playwright test e2e/live-return-summary.spec.ts e2e/return-summary.spec.ts e2e/return-summary-geometry.spec.ts --project=chromium --workers=1 --retries=0`; run equivalent WebKit live-source cases and compiled Rust engine fixture. Record exact commands/environment/results; no claim an unavailable mode passed. Commit.

### Task 5: Install paired provider and qualify fixed examples

**Files:** Modify `D/v9/eodhd/tests/test_next_chart_sources.py`; create `D/v9/eodhd/tests/test_daily_price_chart_source.py`; regenerate `D/v9/eodhd/source/` from Task 1 canonical commit. Record transport fixtures in the client e2e fixtures and qualification notes in `docs/releases/validation/v9/live-observed-returns/{verification.md,review.md}`.

**Interfaces:** Consumes canonical Task 1 commit and Tasks 2–4 client admission. Produces installed HTTP/OpenAPI/widget captures with actual selector, metadata, raw SDK call counts and client replay, plus exact canonical/vendor/installed hashes.

- [ ] Add installed RED for standard and generated equity/ETF aliases: chart_source exposed and passed through, exactly one bounded SDK call per listing, same delivered rows and envelope; legacy/no-opt-in and unsupported asset routes gain no proof.
- [ ] Vendor canonical source using the repository's documented narrow vendor procedure; compare every source path and installed file. Do not run a default catalog sync or overwrite external working copies.
- [ ] Before building a qualification image, apply the separately scoped certifi patch/pin and corresponding trust-bundle regression check in an isolated dependency change, or record that image qualification is blocked. Do not silently reuse the known affected image or combine unrelated Plotly/PDF/tooling upgrades. No deployment.
- [ ] Run installed pytest tests in the rebuilt image; capture actual GET/selector/envelope for aliases and replay through client capture and worker. Count SDK calls rather than infer them from source-table HTTP count.
- [ ] Capture public demo AAPL.US and MCD.US for fixed inclusive dates with demo credentials excluded from committed URLs/logs. Independently count 29 unique positive quotes and 28 observed pairs per listing; compare exact source values with chart output. If upstream history changed, preserve mismatch and explain it instead of changing expected values or dates silently. Keep deterministic fixtures as separate offline evidence.
- [ ] Commit paired packaging and portable qualification report with exact image/source identities, failures/reruns/skips, live entitlement limits and certifi status.

### Task 6: Final verification and independent review

**Files:** Update `docs/releases/validation/v9/live-observed-returns/{verification.md,review.md}` and task checkbox states in this plan.

**Interfaces:** Consumes all task commits, fixture/capture identities and real command output. Produces reviewable branches and final independent review; this task does not authorize merge, push or deployment of the new feature.

- [ ] Run client `pnpm test:run`, `pnpm test:web`, `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm knip`, `pnpm scrub`, `pnpm build`, plus actual compiled-engine/browser gates above. Compare bundle raw/gzip measurements against this branch's pre-implementation baseline; no new trace registration/vendor expected.
- [ ] Run full provider `python -m pytest -q`, installed transport tests and Docker source parity checks. Distinguish pre-existing optional skips/warnings from regressions; never report fixture coverage as real ArcticDB or physical-device validation.
- [ ] Request fresh independent whole-change review of exact base-to-head diffs across all three repos, approved spec, test evidence and actual runtime captures. Check no hidden numeric proof, no global trust promotion, gap composition, caller ordering, ordinary-route compatibility and source replacement races. Fix Critical/Important findings with targeted RED/GREEN and fresh review.
- [ ] Report exact commits, checks, remaining limitations and any blocked installed-image proof. Preserve release worktrees/catalog recovery evidence; no destructive cleanup. Present results for user review before integration.

## Plan self-review

Spec coverage: source/receipt and loss accounting → Tasks 1–2; both-engine admission/lineage → Task 3; calculations and UI/lifecycle → Tasks 3–4; qualification/vendor/image/examples → Tasks 5–6. All five Review Focus cases have named owning tests. Wire names and exported reader signatures are shared above; no live session-calendar or listing-directory prerequisite was reintroduced. certifi remains a separate prerequisite with an explicit non-success outcome if unavailable.

## Execution handoff

Preserved execution preference: subagent-driven implementation with independent task reviews and final whole-change review. User review of this plan is required before execution. No product code, dependency installation or qualification image build was performed while writing it.
