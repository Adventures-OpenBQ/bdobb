# Temporal Widget Gap Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Page retained TemporalDB results safely and automatically acquire eligible missing daily-price data under a saved, scoped policy.

**Architecture:** Preserve an immutable execution as the result identity. Add bounded cursor viewing first, then a server adapter to the existing managed table protocol for complete-result operations. A separate durable run orchestrator resolves policy, coverage, acquisition and publication before starting an immutable execution.

**Tech Stack:** Existing TypeScript/React/Zustand client, Rust managed table service, Python/Pydantic TemporalDB, PostgreSQL scoped control functions, existing capture bridges and MCP SDK. No new orchestration framework.

**Spec:** `docs/superpowers/specs/2026-11-03-temporal-widget-gap-closure-design.md` (approved by user November 3, 2026).

## Global Constraints

- Automatic acquisition initially applies only to current-corrected runs under an explicitly selected, enabled saved policy.
- Known-at, effective-on, snapshot and replay stay cache-only.
- Every page and derived result retains the execution/result hash, query revision and temporal receipt.
- Preserve exact decimals/large integers; never silently coerce values or label partial-page calculations global.
- Reuse scoped jobs, persisted budgets, fencing and authorization; provider credentials remain server-side.
- No arbitrary client URLs, artifact paths or inferred SQL-to-provider requests.
- No main changes, publication or deployment. Current candidate baseline: client c6fb037f, host 84ac1af, backend ad37d75; backend image source e5f49ff.

## Review Focus

- Query refresh during a page request must not publish the old page into the new execution: Task 1/2 race tests.
- Duplicate values across page boundaries need distinct stable row identities: Task 1 ordinal tests.
- Matches outside the first page must affect global filter/pivot/export results: Task 3 conformance tests.
- Revocation and one cancelled waiter cannot leak data or cancel another authorized run: Task 5/7 tests.
- Empty accepted provider responses cannot cause an automatic request loop: Task 6/7 negative-coverage tests.

---

### Task 1: Retained execution pager

**Files:** Create `src/lib/temporal/paging.ts`, `src/lib/temporal/paging.test.ts`; modify `src/lib/temporal/sourceAdapter.ts` and its test.

**Interfaces:** `createTemporalPager(client: TemporalClient, binding: QueryBinding): TemporalPager`; `TemporalPager.open(signal): Promise<TemporalPage>`, `next(signal)`, `previous(signal)`, `dispose(): void`. `TemporalPage` contains validated `ResultPage`, `executionId`, zero-based `offset`, one-based `pageNumber`, `hasPrevious`, `hasNext`. Cursors remain private to the pager. Extract the existing start/poll logic into the pager; opening occurs once per acquisition generation.

- [ ] Write failing tests: a 2,001-row execution traverses 1,000/1,000/1 rows with exactly one start; previous rereads the same execution; equal-valued rows have distinct ordinal identities; forged receipt/schema, repeated cursor, non-progress, excessive cursor length and cancellation are refused.
- [ ] Run `pnpm exec vitest run src/lib/temporal/paging.test.ts src/lib/temporal/sourceAdapter.test.ts`; confirm failures concern missing pager behavior.
- [ ] Implement bounded page traversal with immutable receipt/schema/count checks. Limit retained cursor history to 1,000 pages and one active request; use server page-size 1,000 and existing transport byte limits. Reject rather than silently truncate history. Keep exact wire values.
- [ ] Extend source adaptation with an optional already-validated `TemporalPage`; preserve execution/ordinal row IDs and explicit page-local completeness/provenance. Run tests and TypeScript checking.
- [ ] Commit `feat: add retained temporal execution paging`.

### Task 2: Widget paging controls and scope lifecycle

**Files:** Modify `src/stores/tableExecutionStore.ts`, `src/components/renderers/QueryDataRenderer.tsx`; add `src/components/renderers/QueryDataRenderer.paging.test.tsx` and store paging tests.

**Interfaces:** Store methods `nextTemporalPage(dashboardId, cardId): Promise<void>`, `previousTemporalPage(...)`; ephemeral `readTemporalPaging(...)` returns page number/offset/navigation/busy flags without cursors. Scope, binding and refresh changes dispose the pager. Existing store revision guards own publication.

- [ ] Write failing tests: next/previous controls page within one execution; refresh starts another; late old-page delivery cannot activate; logout/backend credential change evicts the pager; busy/first/last states disable controls correctly.
- [ ] Run focused tests and observe the missing controls/state failures.
- [ ] Add private pager ownership to Temporal source acquisition. Page changes use a new table input revision, invalidate linked derived state correctly and preserve fixed execution identity. Do not persist cursors in dashboards, exports or local storage.
- [ ] Display page range and loaded-versus-total count. Keep the warning that transforms/charts/exports concern the loaded page until Task 3 enables remote complete-result capabilities. Test ordinary widgets remain unaffected.
- [ ] Run focused tests, TypeScript check and commit `feat: expose safe temporal page navigation`.

### Task 3: Complete retained results through managed table sessions

**Files:** Client `src/lib/tableExecution/remote/temporalProvider.ts` and tests, `src/stores/tableExecutionStore.ts`; Rust `crates/table-service/src/sources.rs`, `config.rs`, `http.rs`, new `temporal.rs` and tests; backend new `temporaldb/api/table_source.py` and tests; host gateway and relay temporal route allowlists/tests.

**Interfaces:** Server configured `TemporalExecutionSource` resolves only an authorized execution UUID and expected result hash. New scoped retained-source batch endpoint supplies exact typed rows/schema/receipt to the trusted table service. The service imports the retained source under the caller's existing namespace, enforces configured row/byte/time limits, and returns its existing opaque `SourceRef`. `createTemporalTableProvider(...)` then uses existing managed sessions, capabilities, wire commands and result identities. Never place source locations or provider credentials in the browser.

- [ ] Write failing integration tests for >1,000 rows with a matching row only on the last page; global sorting/filtering, pivot totals, linked derivation and export must include it. Add cross-scope, changed receipt, numeric precision, source expiry, request limit and interrupted-import cleanup tests.
- [ ] Verify red before implementing the new retained-source admission path.
- [ ] Resolve caller-to-TemporalDB scope through server-managed account/credential bindings; reauthorize every source read. Require successful bounded exhaustion and exact source identity before admitting a complete source. Reuse managed session admission, wire validation and safe-exact-count proof; do not invent a parallel table engine.
- [ ] Enable only capabilities actually supported by the adapter. Over-limit/unsupported operations return typed refusals; cursor-view mode remains available with honest subset labels. Test whole-result and page-only states separately.
- [ ] Run managed provider/Rust service tests, browser linked/export tests and commit `feat: bind retained temporal executions to managed tables`.

### Task 4: Saved acquisition policy contracts and storage

**Files:** Backend `migrations/033_acquisition_policies.sql`, new `temporaldb/acquisition/contracts.py`, `policies.py`, `api/acquisition.py`; contract schema and generated client types; backend/client contract tests.

**Interfaces:** `AcquisitionPolicy` has immutable ID/revision, scope, enabled flag, allowlisted datasets/providers/account references, identity/date/request/byte/time/concurrency budgets and negative-coverage TTL. `PolicyStore.get(scope,id,revision)` and privileged `save(...)`. Public policy responses omit credentials and private transport configuration. `GET /temporal/v1/acquisition/policies` lists only granted policy summaries.

- [ ] Test versioned policy persistence, operator-only mutation, workspace/entitlement isolation, stale revision/revocation, unsupported provider and invalid/unbounded limits.
- [ ] Observe failures; implement scoped PostgreSQL functions/grants consistent with existing control authority. Do not grant direct table access to API roles.
- [ ] Regenerate contract types; test strict parsing and secret-free responses.
- [ ] Run focused authority/contract tests; commit `feat: persist scoped acquisition policies`.

### Task 5: Durable run attempts

**Files:** Backend `migrations/034_acquisition_runs.sql`, new `temporaldb/acquisition/runs.py`, `api/acquisition.py`; tests `tests/test_acquisition_runs.py`.

**Interfaces:** `RunService.submit(scope, RunRequest)->RunHandle`, `status(scope,run_id)`, `cancel(scope,run_id)`. Request references query/revision, already resolved params/context, policy ID/revision and idempotency key. States: waiting, acquiring, normalizing, ready, failed, cancelled. Ready includes final execution ID. `POST/GET/DELETE /temporal/v1/runs` routes are scope-authenticated and separately classified from read-only cache tools.

- [ ] Test durable restart/idempotency, illegal transitions, cross-scope access, policy revocation and cancellation of one of two compatible waiters.
- [ ] Verify red; implement scoped attempts and waiter references. Deduplication includes workspace, entitlement, provider account, policy compatibility and normalized acquisition identity.
- [ ] Reauthorize before scheduling, freezing and serving; cancellation detaches the waiter without killing another authorized waiter's work. Never create immutable execution while acquisition is waiting.
- [ ] Test existing execution deadline remains unchanged; run authority tests and commit `feat: track durable acquisition-backed query runs`.

### Task 6: Bounded coverage preflight and negative evidence

**Files:** New `temporaldb/acquisition/preflight.py`; `migrations/035_acquisition_coverage.sql`; existing dataset discovery/identity helpers; `tests/test_acquisition_preflight.py`.

**Interfaces:** `preflight(scope, policy, query, resolved_params, context)->AcquisitionPlan` returns bounded normalized provider requests, accepted coverage evidence and explicit refusals. SQL acquisition uses explicit per-source mappings in policy/query metadata, never inference from SQL text. Negative outcomes are scoped to provider/account/identity/request bounds with TTL/retry eligibility.

- [ ] Test no request on cache hit; current-corrected miss plans bounded work; other modes refuse acquisition; weekends/accepted empty responses/unavailable ranges respect negative evidence; unknown coverage remains unknown.
- [ ] Add tests for source/identity/date-span/coverage-work/request-plan limits and ambiguous multi-source SQL.
- [ ] Observe red; implement deterministic preflight using accepted coverage evidence and source-specific identity validation. Request bounds do not become coverage proof.
- [ ] Run focused tests; commit `feat: plan bounded temporal cache acquisition`.

### Task 7: Acquisition and publication orchestration

**Files:** New `temporaldb/acquisition/orchestrator.py`; modify runtime dispatcher, dataset acquisition transports and provider bridges as needed; add `tests/test_acquisition_orchestration.py`, `tests/test_yfinance_managed_acquisition.py`.

**Interfaces:** Worker `advance_run(lease)` consumes attempts/plans through existing scoped jobs and provider budgets. Qualify EODHD and yfinance daily-price adapters independently. No new acquisition provider is advertised before its durable capture and accepted-publication flow passes recorded-transport tests.

- [ ] Test cache hit generates zero requests; concurrent miss acquires once; durable-capture failure, normalization rejection, budget failure, revoked policy and negative response cannot become an unqualified success.
- [ ] Verify red; implement fenced, bounded progress through acquisition, normalization and accepted publication. Freeze relative params at submission; freeze final current-corrected manifest only after eligible publication.
- [ ] Start immutable execution once and attach its ID to the ready attempt. Preserve capture/publication evidence and acquisition decisions in run/receipt linkage. Persist retry and failure reasons without credentials.
- [ ] Test old pinned execution and historical knowledge views remain unchanged after today's correction; replay performs no provider requests.
- [ ] Run recorded provider-boundary/orchestration tests and commit `feat: execute policy-driven temporal cache acquisition`.

### Task 8: Widgets and Rita use the same run service

**Files:** Client temporal client/contracts, QueryLibraryDialog, QueryDataRenderer, new `src/lib/temporal/runs.ts` and tests; backend MCP tool registry/schemas/tests; gateway/relay route policies and vendor receipts.

**Interfaces:** `TemporalClient.policies()`, `submitRun(request)`, `runStatus(id)`, `cancelRun(id)`. Optional query-binding acquisition reference is strictly versioned and backwards compatible; absent reference preserves cache-only behavior. New MCP policy/preflight/run/status/cancel tools explicitly mark acquisition-capable operations as writes.

- [ ] Test selected policy revision, frozen relative inputs, queued/acquiring/normalizing/ready/failure states, cancellation and expired authorization. Existing saved query widgets remain cache-only without policy selection.
- [ ] Verify red; show resolved policy assumptions and coverage decisions alongside the final receipt. Rita and widgets call the same run APIs; no hidden provider requests during cache-only discovery/query.
- [ ] Update allowlists minimally and regenerate exact host receipts. Test unrelated routes remain denied and secrets never enter browser responses/logs.
- [ ] Run focused widget/MCP/relay/gateway tests; commit `feat: expose policy-driven temporal runs to widgets and Rita`.

### Task 9: Installed qualification and release evidence

**Files:** Extend backend installed acceptance harness and browser tests; regenerate backend runtime lock and client corresponding source; update candidate status/evidence.

- [ ] Add >1,000-row browser acceptance for page viewing and complete-result managed operations, including exact exports and a result outside the first page.
- [ ] Add recorded cache miss -> provider bridge -> durable capture -> accepted publication -> frozen widget result, plus cache hit/no request and concurrent deduplication checks.
- [ ] Run full frontend/backend and relevant Rust/host tests; build immutable images and the unsigned app; run installed qualification against exact artifacts. Keep live Rita, packaged runtime and intended NAS claims separate unless actually qualified.
- [ ] Independent whole-branch review; fix important findings, regenerate exact receipts/source archive after final code freeze, and leave main unchanged.
