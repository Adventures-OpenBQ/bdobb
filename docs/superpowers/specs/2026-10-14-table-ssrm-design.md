# Native Rust table_ssrm for v10

Date: 2026-10-14
Status: approved by user; implementation in progress

## Intent and approved scope

Add a production server-side table widget to Adventures-OpenBQ/bdobb v10,
reusing the Rust pivot foundation and its provider interfaces. Support both
BDoBB-managed native Rust execution and existing provider-owned OpenBB SSRM
endpoints. Managed execution has full parity with the current pivot feature set
and supports backend sources and CSV/XLS uploads. Include service packaging and
authenticated gateway integration in Adventures-OpenBQ/openbq-docker v10.

Inspected bases: bdobb main and release/v10 at
ba5553d52b7048bd313eb224eac9505c5c3960bf; openbq-docker main and release/v10 at
186034209b38c9774a211d6ccbea581129b6e8fc. Implement on feature branches based
on these v10 lines, preserving unrelated local work. Remote delivery and live
stack deployment are separate from preparing and testing the changes.

## Architecture and alternatives

Recommended architecture: a native Rust HTTP service linked to pivot-core,
two frontend provider adapters, and a shared table_ssrm widget integration.
Embedding execution in the existing Python API couples lifecycle and releases;
requiring all endpoints to implement the rich protocol loses OpenBB compatibility.
The selected design preserves the existing local Wasm path and compiles no Wasm
into the managed backend execution path.

The new service owns source snapshots, native result sessions, capabilities,
resource admission, and bounded result delivery. Use the existing versioned
TableDefinition, wire values, revision coordinates, and provider contracts;
extend them explicitly where production remote acquisition requires it.
Do not serialize internal calculated views or download complete remote datasets
to emulate server execution in the browser.

## Managed native provider

The frontend binds an opaque source identifier to an authenticated session.
Session creation negotiates protocol, locale, capabilities, and limits. Apply
produces a result identity, schema, counts, completeness, and diagnostics.
Subsequent operations bind session, source snapshot, and result revision.
Preserve apply, rows, input schema, authoring previews and formula binding,
member domains, inspection, identity witness, selection, facets, totals, chart
data, exports/presented subsets, cancellation, and disposal.

Reuse pivot-core calculations rather than porting or replacing their semantics.
Full parity includes legacy and analytical pivots, grouping and splits, source
and aggregate formulas, categories, member scopes, checklists, runtime parameters,
source/result filters, fiscal behavior, Statement views, scoped totals, selection,
charts, exports, linked subsets, saved definitions, typed identities, diagnostics,
and missing/null/nonfinite values. Non-additive totals re-evaluate their scope.
Dynamic pivot columns derive from the full backend snapshot and result definition.

Native ordering needs an explicit compatibility adapter: the current core relies
on host collation, recipe comparison, and sort permutations. Provide locale-aware
native implementations and test them against existing fixtures and the JavaScript
baseline. Do not substitute bytewise text order. If a required ordering behavior
cannot be reproduced, return an explicit compatibility diagnostic and fail parity
qualification; do not silently weaken the full-parity acceptance requirement.

## Existing OpenBB provider adapter

Recognize both table_ssrm and ssrm_table. Adapt standard OpenBB/AgGrid SSRM POST
requests and rowData/rowCount responses, preserving widget parameters and configured
authentication. Support declared pagination, sorting, filtering, grouping and
pivot operations only when supported by the endpoint. Validate metadata and
responses, including unknown counts and missing stable identities.

Standard SSRM does not automatically provide the analytical provider contract.
Expose capabilities conservatively using explicit extension metadata and verified
baseline operations. Hide or disable unsupported authoring and result operations
with an explanation; never calculate whole-dataset totals, pivots, selections,
charts, or exports from the loaded page. Treat unknown/estimated counts honestly.
Preserve endpoint-defined group keys through an adapter-owned stable mapping;
never assume display labels are rich-provider group IDs. Standard endpoints with
no snapshot guarantees must not be presented as immutable rich result sessions.

Reference: https://docs.openbb.co/workspace/developers/widget-types/ssrm_mode
Verify the official example's exact wire shape during implementation.

## Acquisition, ownership, and persistence

Managed sources are either registered backend widget sources with their parameter
bindings or private uploaded files. Backend acquisition runs server-side through
configured source adapters. Resolve upstreams through a configured allowlist;
keep credentials on the server and do not accept arbitrary client-supplied URLs
as an unrestricted fetch proxy. Preserve column metadata, provenance, freshness,
completeness, and fiscal/Statement evidence during normalization.

Upload CSV, TSV, XLS, XLSX, and existing JSON table formats through a bounded
endpoint. Parsing must preserve current file semantics, including numeric values,
missing cells, date formats and epochs, sheet selection, and supported display
formats. Reuse the existing parser in a server ingestion component if necessary;
analytical execution stays native Rust. Parsing parity tests decide admissibility.

Persist uploaded bytes and source metadata in a private Docker volume, scoped to
the authenticated principal. Saved cards store source references and definitions,
not full datasets, credentials, or transient sessions. Reopening a dashboard
reacquires/reloads its source and creates a fresh session. A missing upload yields
an actionable unavailable-source state. Provide explicit deletion and cleanup;
active sessions may retain their admitted snapshot until disposed or expired.
Backend source registrations must remain resolvable across restarts.

Web ownership derives from the existing authenticated identity, forwarded through
a trusted gateway boundary with spoofable client identity headers removed.
Desktop uses an explicitly configured authenticated principal. Authorization is
checked on source, upload, session, result, and export access; opaque IDs alone
are not authorization. Credentials never enter saved dashboards or responses.

## Publication, refresh, and resource lifecycle

Each result uses a fixed source snapshot. Refresh prepares a replacement snapshot
and result, publishing only after successful calculation. Failed, cancelled,
expired, or superseded work cannot replace the active result. Schema, rows,
selection, totals, charts, linked outputs, and exports use matching revisions.
An export pins its result while streaming bounded batches with backpressure.

On service restart or expiration, clients recreate sessions from persisted source
references. Surface snapshot expiration distinctly from zero rows. Do not retry
mutating acquisition/upload requests ambiguously: use idempotency identities.
Use bounded worker execution so Rust calculations do not block HTTP handling.
Native result workers run in separate processes with qualified OS memory and time
containment; the core's existing Wasm-oriented structural budget remains unchanged.
This avoids its deliberate Statement/MEMBER/witness refusals in native service
execution while keeping allocation failures outside the HTTP process.
Limit per-principal concurrency and memory. Cancellation must invalidate obsolete
publication promptly; document whether computation stops cooperatively or runs to
completion behind a bounded queue. Disposal and expiry release session resources.

Define and validate configurable upload, parsing, input, output-column, row-block,
export-batch, session, concurrency, time, and cache limits. Reject admission with
structured errors, preserving the last valid result. Measure representative
workloads before selecting production defaults; do not claim unlimited scale.

## Widget and user experience

Route SSRM types into the new provider-backed renderer instead of today's refusal
notice. Reuse existing table and pivot interaction patterns, saved configuration,
theme tokens, keyboard navigation, accessibility, and coarse-pointer support.
The client retains bounded row blocks and cache entries. Lazy group expansion
fetches the requested parent's siblings. Handle exact, estimated, and unknown
counts without manufacturing totals or allocating the entire result in the DOM.

Keep full-parity controls for managed/rich providers. Adapt controls for standard
providers according to their capabilities. Show loading, source freshness,
completeness, unsupported-operation, expiration, refresh-failure, and upload-error
states. Existing ordinary and local-file table behavior remains unchanged.
Use existing chart, linked-table, export and table-tool integration seams, ensuring
managed operations refer to server result scope rather than visible rows.

## Docker and web gateway integration

Package a reproducible native service image from the bdobb Rust source with a
pinned source revision or release artifact; avoid maintaining a second core copy.
Add compose service wiring, health checks, persistent uploads volume, resource
configuration, and private networking to openbq-docker v10. Make service availability
explicit in widget discovery and settings. Publish no unauthenticated service port.

Add narrowly defined routes and method/body limits for discovery, acquisition,
uploads, sessions, queries, cancellation, disposal, and streaming exports. Support
standard provider SSRM POSTs only through admitted provider routes. Apply auth,
CSRF protection where cookie-authenticated, ownership forwarding, and timeouts.
Update the canonical funnel-gateway policy and the vendored bdobb web copy with
matching provenance/hash checks. Preserve current API/news/grid/state behavior.
Prepare deployment instructions and smoke checks; do not alter the live stack.

## Validation and acceptance

1. Run existing Rust pivot and provider conformance suites against native sessions;
   compare analytical outputs, identities, diagnostics, ordering and metadata.
2. Cover file parsing parity and backend normalization with representative fixtures,
   including fiscal/Statement metadata and incomplete sources.
3. Test HTTP acquisition, uploads, ownership, session lifecycle, all result operations,
   revision isolation, cancellation, expired snapshots, limits, and streaming.
4. Use an official-shape standard SSRM fixture for POST contracts, grouping, filters,
   sorting, counts, capability refusal, and provider errors.
5. Browser tests exercise managed and standard widgets, pivot authoring, lazy groups,
   refresh, selection, charts, linked subsets, exports, dashboard reopen and uploads.
6. Assert bounded client fetch/cache behavior on datasets larger than one row block;
   prove totals and dynamic pivot columns remain independent of loaded blocks.
7. Run desktop/web builds, type checks, lint and relevant regressions. Test gateway
   route policy, denied methods/bodies, ownership spoofing and canonical/vendor parity.
8. Build the service image and validate compose wiring and health checks when Docker
   is available; report unavailable runtime validation explicitly.

Full parity is required for the managed rich path. Standard-provider functionality
is limited to actual endpoint capabilities and communicated clearly to the user.
No benchmark, platform, or live-deployment success may be claimed without evidence.

## Delivery boundaries

No new query language, SQL/DuckDB acceleration, Rust DOM renderer, rewrite of local
Wasm execution, automatic conversion of every existing table to SSRM, or automatic
live-stack deployment. Existing provider endpoints may remain limited; the managed
path supplies the full analytical feature set. Implementation follows written-spec
approval, a reviewed implementation plan, and the selected execution method.
