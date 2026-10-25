# Native Rust table_ssrm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a v10 SSRM widget with full native Rust analytical parity, existing OpenBB endpoint compatibility, durable uploads and Docker/gateway integration.

**Architecture:** Link a native HTTP service to pivot-core through a reusable wire crate. Two frontend adapters implement the shared provider boundary: managed native execution and conservative OpenBB SSRM compatibility. A server ingestion process reuses the existing file parser; calculations execute only in native Rust.

**Tech Stack:** Rust 1.98.1, pivot-core, Axum/Tokio HTTP, ICU locale collation, TypeScript/React, existing SheetJS parser, Node ingestion, Docker Compose and the existing Node gateway. Pin added dependency versions and commit lockfiles after verifying compatible versions during execution.

**Spec:** ../specs/2026-10-14-table-ssrm-design.md

## Global Constraints

- Authoritative repositories: Adventures-OpenBQ/bdobb and Adventures-OpenBQ/openbq-docker.
- Start from v10: bdobb ba5553d52b7048bd313eb224eac9505c5c3960bf; Docker 186034209b38c9774a211d6ccbea581129b6e8fc.
- Use codex/table-ssrm-v10 feature branches; preserve existing unrelated checkouts.
- Full parity is required for the managed rich path.
- Support both table_ssrm and ssrm_table; preserve existing local Wasm behavior.
- Saved cards contain source references and definitions, never credentials or datasets.
- No full-dataset browser fallback; unsupported provider operations refuse explicitly.
- No live deployment, remote push or publication in this implementation plan.
- Preserve Apache-2.0 headers and update dependency notices.

## Review Focus

- Refresh races with export: export must retain its original result while the widget moves forward (Tasks 5, 9).
- Same source identifier under different users: every persisted and transient lookup must enforce ownership (Tasks 3, 4, 10).
- Locale differences between browser and server: identities, ordering and recipe fingerprints must remain compatible (Task 2).
- Standard endpoint returns no stable keys or count: show honest capabilities/counts without invented identity semantics (Tasks 7, 8).
- Restart after upload but before session publication: committed upload remains reopenable and partial uploads are not visible (Tasks 3, 4).

## File map and dependency order

All paths below are relative to bdobb unless prefixed `docker:`.

- crates/pivot-wire/: shared JSON conversion extracted from pivot-wasm/src/wire.rs.
- crates/pivot-native/: native ValueOrder adapter and reusable managed session execution.
- crates/table-service/: authenticated HTTP, source catalog, session actors and export lifecycle.
- server/table-ingest/: file parser and configured backend acquisition; private child-process IPC.
- src/lib/tableExecution/remote/: wire transport, managed provider and standard SSRM adapter.
- src/components/renderers/SsrmTableRenderer.tsx: provider-backed table integration.
- src/hooks/useTableResult.ts and src/stores/tableExecutionStore.ts: remote session lifecycle.
- docker:table-service/: pinned image/build metadata and service configuration examples.
- docker:docker-compose.yml and docker:funnel-gateway/: service wiring and canonical route policy.
- web/: matching authenticated relay routes, pinned policy and web tests.

Implement Tasks 1–6 before managed UI integration. Task 7 is an independent
adapter after Task 1; Task 8 consumes Tasks 6–7; Task 9 integrates analytical
consumers; Task 10 integrates the stack; Task 11 qualifies the complete delivery.
The two repositories are one release integration, not independent products.

### Task 1: Share the native wire codec

**Files:** Create crates/pivot-wire/{Cargo.toml,Cargo.lock,src/lib.rs,tests/roundtrip.rs}; modify crates/pivot-wasm/{Cargo.toml,Cargo.lock,src/lib.rs,src/wire.rs}; add src/lib/tableExecution/remote/types.ts.

**Interfaces:** Produce pivot_wire::decode_request(json: &str) -> Result<CoreRequest, String> and encode_response(session_id: u32, response: CoreResponse) -> Result<String, String>, preserving the current worker JSON shape. Reuse the actual core response type from session dispatch; do not invent another envelope. Remote HTTP adds string identities outside this core envelope.

- [x] Add roundtrip fixtures asserting existing tagged missing/null/nonfinite values, formulas, fiscal definitions and diagnostics survive unchanged; invalid protocol/unknown fields fail.
- [x] Run `cargo +1.98.1 test --manifest-path crates/pivot-wire/Cargo.toml`; expect missing implementation failure.
- [x] Extract pure conversions from pivot-wasm/src/wire.rs; keep Wasm-specific handles and host callbacks in pivot-wasm.
- [x] Define HTTP envelope types: SourceRef {sourceId:string}, OpenSession {protocolVersion:1,sourceId:string,widgetId:string,locale:string,inputRevision:number}, RemoteIdentity {sessionId:string,sourceSnapshotId:string,resultId?:string}. Use the existing wire codec for command payloads.
- [x] Run shared-wire tests, existing pivot-core/pivot-wasm tests and `pnpm test:pivot:packaging`; expect no wire behavior changes.
- [x] Commit `refactor: share pivot wire codec with native adapters`.

### Task 2: Native ordering and calculation parity

**Files:** Create crates/pivot-native/{Cargo.toml,Cargo.lock,src/lib.rs,src/ordering.rs,tests/parity.rs,tests/ordering.rs}; reuse crates/pivot-core/tests and src/test/fixtures/rust-pivot.

**Interfaces:** NativeOrder::new(locale: &str) -> Result<NativeOrder, Diagnostic> implements pivot_core::ordering::ValueOrder. NativeSession::new(locale: &str, limits: ResourceLimits) -> Result<NativeSession, Diagnostic>; dispatch(&mut self, request: CoreRequest) returns the existing core response type.

- [x] Add failing parity cases for en-US numeric/case/accent ordering, other fixture locales, empty/missing values, equal-key stable ties, nonfinite numeric comparisons and category recipe ordering.
- [x] Run `cargo +1.98.1 test --manifest-path crates/pivot-native/Cargo.toml`; expect missing adapter failure.
- [x] Implement ICU locale comparisons and host-compatible sort permutations; carry the current orderingBridge.ts options and baseline sort semantics into the adapter.
- [x] Run the full analytical fixture corpus through NativeSession and compare with existing oracle outputs: exact identities/structure/diagnostics, existing reviewed numeric tolerances. Include Statement, fiscal and selection cases.
- [x] Run native and core suites; require full parity. If native ordering cannot match, stop parity qualification and fix the adapter before proceeding with feature claims.
- [x] Commit `feat: execute pivot sessions natively with compatible ordering`.

### Task 3: Durable source catalog and authenticated ownership

**Files:** Create crates/table-service/{Cargo.toml,Cargo.lock,src/lib.rs,src/config.rs,src/auth.rs,src/sources.rs,tests/sources.rs}.

**Interfaces:** Principal(String); SourceCatalog::create_upload(principal, idempotency_key, metadata, bytes) -> Result<SourceRef, ServiceError>; register_backend(principal, idempotency_key, binding) -> Result<SourceRef, ServiceError>; read(principal, source_id) -> Result<StoredSource, ServiceError>; delete(principal, source_id) -> Result<(), ServiceError>. Store uploads plus metadata under an opaque principal namespace with atomic publication. BackendBinding uses configured backendId, widgetId and validated params, never an arbitrary URL.

- [x] Add tests named foreign_principal_cannot_read_or_delete, retry_returns_same_source, interrupted_upload_is_not_published and restart_reopens_committed_upload; assert no foreign bytes/metadata are returned.
- [x] Run `cargo +1.98.1 test --manifest-path crates/table-service/Cargo.toml --test sources`; expect absent catalog failure.
- [x] Implement durable catalog, authenticated desktop credentials and trusted-gateway principal verification. Reject forged headers, invalid identifiers, path traversal and conflicting idempotency retries.
- [x] Add validated nonzero configurable limits; reject oversized streaming uploads while reading, with cleanup of partial files. Add owner-only deletion and session reference retention rules.
- [x] Re-run source tests with temporary storage and restart simulation; expect all pass.
- [x] Commit `feat: persist private managed table sources`.

### Task 4: File and backend ingestion

**Files:** Create server/table-ingest/{index.ts,protocol.ts,files.test.ts,backend.ts,backend.test.ts}; modify package.json and existing localTableData.ts only as required for pure server reuse; create crates/table-service/src/ingest.rs and tests/ingest.rs.

**Interfaces:** ingestFile(name:string,bytes:Uint8Array,widgetId:string,inputRevision:number): Promise<WidgetDataset> reuses datasetFromBytes. acquireBackend(binding:BackendBinding,context:ServerBackendConfig): Promise<WidgetDataset> fetches configured sources and normalizes existing dataset metadata. Native ingestion receives framed, size-bounded wire-encoded datasets through private child-process IPC; commands are enum operations, never shell strings.

- [x] Write failing parser tests comparing uploaded CSV/TSV/JSON/XLS/XLSX to localTableData fixtures: 1900/1904 dates, blank cells, duplicate headers, formatting and malformed files. Assert the source file survives ingestion failure for a later retry.
- [x] Write backend tests asserting configured credential injection, refused unknown backends/redirect destinations, retained completeness/fiscal evidence and timeout behavior.
- [x] Run `pnpm exec vitest run server/table-ingest`; expect missing implementation failure.
- [x] Implement parser reuse and configured backend adapters. Bound child-process concurrency, bytes, execution time and output; terminate failed parses without leaking uploaded content into errors.
- [x] Add native IPC tests for truncated frames, invalid tagged values and child exit; verify no partial snapshot publication.
- [x] Run ingestion suites and localTableData regression tests; expect semantic parity.
- [x] Commit `feat: ingest uploaded and backend table sources on the server`.

### Task 5: Managed HTTP sessions and bounded result delivery

**Prerequisite discovered during execution (Task 5A):** Add `crates/pivot-native-worker` with bounded framed RPC and real Linux OS memory/time containment. Existing core `max_state_bytes` intentionally refuses Statement/MEMBER/witness contexts and includes Wasm-host reservations, so the service must use contained native result processes. Preserve Wasm safeguards; disable that structural mode only inside OS-contained workers, retaining other core limits. Qualify worker isolation, cancellation, and required semantic cases in Docker before resuming HTTP integration. See the worker README and execution ledger for evidence.

**Files:** Create crates/table-service/src/{main.rs,http.rs,sessions.rs,exports.rs,errors.rs}, tests/{http.rs,lifecycle.rs,exports.rs}.

**Interfaces:** GET /healthz, /widgets.json and /capabilities; POST /sources/uploads, /sources/backends and /sessions; DELETE /sources/:id and /sessions/:id; POST /sessions/:id/commands and /sessions/:id/cancel; POST /sessions/:id/exports; GET /exports/:id/batches?sequence=N; DELETE /exports/:id. Commands consume Task 1 wire requests with Task 1 remote identity. Export batches are bounded, sequential and pinned to one published result. Every route checks Principal and limits.

- [x] Add HTTP tests for negotiation, every existing provider operation, foreign ownership, unknown locale/protocol, invalid JSON, body limits and structured errors.
- [x] Add lifecycle tests asserting slow apply A cannot overwrite apply B, cancelled apply preserves old result, dispose releases resources, expiry differs from zero rows, and refresh failure preserves previous publication.
- [x] Add export test asserting refresh during export retains original columns/rows; duplicate sequence retries return the same batch and skipped sequences refuse.
- [x] Run service tests; expect missing routes/session manager failures.
- [x] Implement per-session bounded execution actors using NativeSession; use a bounded compute pool and admission queue. Publication uses generations and snapshot/result identities. Cancellation invalidates publication promptly; synchronous compute may finish within the admitted resource/time boundary and must not publish afterward.
- [x] Implement capabilities covering actual supported operations, safe exact-count admission, expiry cleanup, ownership checks, result pinning and bounded batch transfers.
- [x] Run service/native suites; verify failed applies and exports do not mutate active revisions. Commit `feat: serve native analytical table sessions over HTTP`.

### Task 6: Managed frontend execution provider

**Files:** Create src/lib/tableExecution/remote/{transport.ts,managedProvider.ts,managedProvider.test.ts,transport.test.ts}; modify src/lib/dataClient.ts and tableExecution/rust/providerFactory.ts.

**Interfaces:** createManagedProvider(config:RemoteProviderConfig): ExecutionProvider; RemoteProviderConfig {baseUrl:string,request:typeof fetch}. SourceBinding.kind remote carries the opaque source reference already defined by the existing contract. Add fields through a versioned extension if needed, preserving existing local callers. Implement all ProviderResultExecutor methods using Task 5 endpoints.

- [x] Add failing tests for open/apply/rows, wire decoding, all analytical operations, cancellation, stale result responses, unknown counts, disposal and reconnect after expiry.
- [x] Run `pnpm exec vitest run src/lib/tableExecution/remote/managedProvider.test.ts`; expect absent provider failure.
- [x] Implement authenticated transport using existing backend connection conventions, protocol validation, revision checking and bounded batch iteration; no client calculations or full input registration for remote sources.
- [x] Run remote transport, provider contract and providerFactory suites; assert the production import graph excludes remoteProviderFixture.
- [x] Commit `feat: connect remote managed pivot providers`.

### Task 7: Existing OpenBB SSRM compatibility

**Files:** Create src/lib/tableExecution/remote/{openbbSsrm.ts,openbbSsrm.test.ts,openbbTypes.ts}; add e2e/fixtures/ssrm-provider.mjs.

**Interfaces:** createOpenbbSsrmProvider(config:OpenbbSsrmConfig): ExecutionProvider. Config binds the existing widget endpoint/params, columns, authenticated request function and optional declared capabilities. Adapt startRow/endRow, sortModel, filterModel, rowGroupCols/groupKeys and declared pivot/value fields to official request shape verified against the upstream example.

- [x] Write fixtures from the official SSRM example; assert expected POST body and rowData/rowCount parsing, parameter propagation, nested grouping and provider errors.
- [x] Test absent counts, duplicate/missing row keys, unsupported formula/selection/export refusal and schema changes. Assert no hidden local aggregation occurs and no unsupported capabilities are advertised.
- [x] Run `pnpm exec vitest run src/lib/tableExecution/remote/openbbSsrm.test.ts`; expect absent adapter failure.
- [x] Implement conservative capability mapping and group-key identity mapping. Explicitly represent non-snapshot providers; reject rich operations that cannot satisfy the existing provider contract rather than forge revision guarantees.
- [x] Run adapter and shared provider tests. Commit `feat: adapt existing OpenBB SSRM endpoints`.

### Task 8: Widget, authoring and upload integration

**Files:** Create src/components/renderers/{SsrmTableRenderer.tsx,SsrmTableRenderer.test.tsx}; modify src/components/{WidgetCard.tsx,WidgetCard.test.tsx}, src/lib/{builtins.ts,builtins.test.ts,types.ts}, src/hooks/{useWidgetData.ts,useTableResult.ts}, src/stores/tableExecutionStore.ts; add src/lib/tableExecution/remote/sourceClient.ts and tests.

**Interfaces:** SsrmTableRenderer receives existing widget/card/backend context and acquires the provider from explicit manifest protocol metadata, defaulting existing SSRM widgets to standard compatibility. Source client exposes uploadFile(file,signal), registerBackend(binding,signal), deleteSource(sourceId,signal). Card persistence stores source ID, source kind and definition.

- [x] Replace refusal tests with managed/standard widget routing tests while keeping ordinary tables unchanged; assert SSRM avoids the normal GET data hook.
- [x] Add tests for upload/save/reopen, failed refresh, capability-driven pivot controls and exact/unknown count navigation. Assert missing source produces a re-upload/rebind action.
- [x] Run targeted renderer, hook and persistence suites; expect current refusal path failures.
- [x] Connect lazy row/group fetches and existing table/pivot controls to provider results; extend shared table rendering only where counts or remote lifecycle require it. Keep cache bounded and preserve existing CSS/ARIA/focus interactions.
- [x] Integrate upload and backend-source creation into the existing library/file workflow, making server execution an explicit choice for new managed tables.
- [x] Run renderer, WidgetCard, useWidgetData, local table and persistence regressions. Commit `feat: render and author server-side table widgets`.

### Task 9: Full analytical consumer parity

**Prerequisite discovered during integration (Task 9A):** Add server-owned derived sessions and a managed-provider derivation primitive for linked tables. Existing local linked acquisition downloads subsets and registers local input, which cannot satisfy managed backend-only execution. Pin parent result/selection, enforce ownership and bounded native/server admission, return identities only, and retain existing local/standard behavior.

**Files:** Modify src/stores/tableExecutionStore.ts, src/hooks/useTableResult.ts, src/components/renderers/LinkedChartRenderer.tsx and src/lib/agent/tableModel/{target.ts,describe.ts,arrange.ts}, src/lib/export.ts, src/components/WidgetCard.tsx (export integration), src/lib/tableModel/linkedBindings.ts; add src/lib/tableExecution/remote/consumers.test.ts and e2e/ssrm-parity.spec.ts.

**Interfaces:** Existing table tool, chart, export and linked-subset consumers use ProviderResultExecutor results from the bound remote revision. Do not add a second formula or selection evaluator.

- [x] Add failing tests with more than one page: pivot columns and totals include unseen rows; allMatching excludes IDs across unloaded groups; non-additive totals recompute; chart/export/linked data use the selected full scope.
- [x] Include fiscal/Statement authoring, runtime group parameters, formula binding/member-domain inspection and saved-definition reopen. Test refresh during chart and export requests for revision isolation.
- [x] Run consumer and browser parity tests; expect missing remote integration failures.
- [x] Connect consumers through provider capabilities; standard endpoints refuse unsupported whole-scope consumers clearly. Preserve active-result identity through streams and linked requests.
- [x] Run analytical, Statement, linked, selection, export and remote regression suites. Commit `feat: preserve full analytical parity for remote tables`.

### Task 10: Native image, compose and authenticated web routes

**Files:** Create deploy/table-service/{Dockerfile,README.md}; docker:table-service/{README.md,settings.example.json}; modify docker:docker-compose.yml, docker:.env.example, docker:funnel-gateway/{config.mjs,server.mjs,policy.mjs,policy.test.mjs,gateway.test.mjs}; modify web/{server.mjs,policy.mjs,policy.vendored.json,security.test.mjs}, scripts/gateway-vendor.mjs and package.json.

**Interfaces:** Private table-service upstream; canonical /table family maps Task 5 routes with method-specific admission. Standard provider POST forwarding is restricted to registered SSRM routes, never a general proxy. Trusted gateway identity is authenticated separately from ordinary backend credentials.

- [x] Add failing canonical gateway and web tests for admitted methods/paths, rejected oversized bodies, CSRF, ownership spoofing, absent service, upstream timeout and streamed batch errors; preserve API/news/grid/state tests.
- [x] Build the native service plus ingestion worker in a multi-stage image. Pin the bdobb source revision/artifact digest in Docker build metadata after the service commit; keep one Rust source authority. Add healthcheck, private network, persistent private uploads volume and configurable limits.
- [x] Implement canonical routes and trusted identity forwarding; strip client ownership headers. Re-vendor policy and record provenance/hash using existing scripts. Wire managed discovery and service configuration into desktop/web backend settings.
- [x] Run `node --test funnel-gateway/*.test.mjs` in Docker repo, `pnpm test:web` in bdobb, and `docker compose config --quiet`; expect pass. Build/run image and test authenticated health/session/upload/restart when Docker is available.
- [x] Commit each repository's coherent service/gateway changes with explicit pairing metadata; do not push or deploy.

### Task 11: Qualification, documentation and final review

**Files:** Create e2e/{ssrm-widget.spec.ts,ssrm-resources.spec.ts}, docs/superpowers/evidence/2026-10-14-table-ssrm/{README.md,qualification.json}; update existing SSRM help/refusal copy, README.md, package scripts and dependency notices; docker:table-service/README.md and Docker verification docs.

- [x] Add browser scenarios for both protocols, uploads, dashboard reopen, lazy expansion, keyboard use, narrow viewport, theme, errors and refresh. Resource test asserts bounded requested rows and cache after many pages.
- [x] Run Rust native/service/wire/core/Wasm tests, `pnpm typecheck`, `pnpm lint`, `pnpm test:run`, `pnpm build`, `pnpm build:web`, pivot packaging/browser checks, SSRM browser checks, gateway/web tests and notices checks. Investigate new failures; distinguish baseline failures with captured evidence.
- [x] Record tested rows/columns, peak service memory, browser request/cache bounds and operation timings on representative data. Choose documented configurable defaults from measurements, rerun limit tests, and avoid unsupported scale claims.
- [x] Document source registration, uploads/deletion/retention, authentication, configuration, pairing, recovery, standard-provider limitations and cancellation semantics. Record unavailable Docker/device checks explicitly.
- [x] Perform independent whole-branch review through the chosen execution workflow; fix material issues and rerun affected checks.
- [x] Commit qualification evidence and report both branches, commit IDs, validation results and any material limitations. Do not report completion if managed full parity is unverified.

## Self-review

Coverage: Tasks 1–2 preserve analytical/wire semantics and native ordering; 3–4 own
sources and ingestion; 5–6 implement result lifecycle and transport; 7 supports
standard providers; 8–9 deliver widget and consumer parity; 10 packages and gates
the service; 11 qualifies platform and resource behavior. Each Review Focus item
has an explicit owning test. Existing local Wasm tests remain required because the
shared codec extraction touches their transport. Task 10 requires a final service
commit before resolving the Docker image source pin; do not put a moving branch
name into release metadata.
