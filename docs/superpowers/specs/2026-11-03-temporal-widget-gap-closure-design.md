# TemporalDB widget paging and policy-driven acquisition

Status: proposed design; awaiting user approval before implementation.

## Intent

Close the two v11 plumbing gaps identified during build/review: query widgets currently load only one 1,000-row page, and a query cache miss has no integrated acquisition workflow. BDOBB should perform the integration work, expose the resolved assumptions, and preserve reproducible temporal results for later portfolio analysis.

## Agreed direction and alternatives

The user selected automatic acquisition under a saved policy, rather than a manual acquisition action for every missing-data run. Existing cache inspection and replay remain read-only. Query execution explicitly associated with an enabled acquisition policy may schedule acquisition automatically.

For paging, use the existing table execution/provider contracts, extended for retained TemporalDB executions. A browser loop that concatenates every page is simpler but moves unbounded data and calculation into the browser. A separate custom grid duplicates safety, export and linked-widget behavior. Reuse of the table pipeline is the recommended engineering choice; this is a proposal, not a prior user decision.

## Observable behavior

A query widget identifies its fixed query revision, temporal context, result execution and acquisition-policy revision. It reports cache hit, acquisition queued/running, normalization pending, ready, partial, denied or failed. A refresh creates a new execution; an existing pinned execution never changes.

Tables page through a frozen execution. Sorting, filtering, pivots, linked charts and exports must declare whether they concern the entire retained result or a bounded subset. They must not quietly compute whole-result answers from a visible page. Unsupported operations are refused or explicitly qualified.

The receipt shows requested and resolved temporal settings, policy identity/revision, coverage evidence, acquisition decisions and provider capture/publication identities. New data received today must never be represented as locally known at an earlier cutoff.

## Existing components and boundaries

- `temporaldb_query` uses QueryDataRenderer, a Temporal source adapter and the existing table execution store. The adapter currently reads one page, checks receipt identity and labels partial data honestly.
- `temporaldb_explorer` browses datasets/schema/coverage and builds shared queries.
- Backend execution pages already have execution-scoped cursors and retained receipts. This is transport paging, not yet a complete remote table-calculation protocol.
- EODHD and yfinance provider capture bridges are wired in the v11 host overlay. Capture admission and worker normalization are distinct stages.
- Managed backend acquisition currently has explicit provider support; the yfinance ODP bridge is not interchangeable with that acquisition transport. Neither is implied to be complete by this design.
- Existing provider budgets, scoped jobs, leases, worker fencing, query/result authorization and exact-value codecs must be reused.

## Paging design

1. Add retained-execution source identity to the table provider boundary. Resolve a saved-query revision and temporal context once; bind every page and derived result to the same execution/result hash and source receipt.
2. Validate cursor progress, schema, receipt identity, row identity, count quality and numeric values. Reject loops, duplicate/inconsistent pages, cross-scope cursors and revision changes. Bound rows, response bytes, session lifetime and concurrent requests; propagate cancellation.
3. Integrate a remote table session over the retained execution using the existing managed provider contract. The server resolves retained artifacts after authorization. Clients cannot supply filesystem paths, object-store locations, arbitrary upstream URLs or provider credentials.
4. Keep transformations on the complete retained source for global operations. An initial cursor-view slice may ship only with explicit capability limits: it must not masquerade as complete remote pivot/filter/export support.
5. Preserve linked table/chart source identity, inspection/selection witnesses and bounded export semantics. Export exhaustion, limits, truncation and partial results stay explicit. Session expiry or scope change invalidates access and cached views.

## Automatic acquisition design

A saved policy is server-owned, versioned and scoped to workspace/entitlement. It allows specific datasets, providers, identities, date bounds, freshness thresholds, request/byte/time budgets and retry/concurrency limits. It references operator-managed provider-account bindings; no credentials belong in widgets, policies returned to clients, or MCP arguments.

Execution requests reference a policy ID and revision. A read-only preflight resolves identities and bounds, checks accepted coverage and distinguishes missing coverage from an empty valid result. Absence of returned market observations does not prove missing data; weekends, holidays, delistings and unavailable provider history must not cause endless fetches.

For eligible current-corrected runs, the server deduplicates bounded provider jobs, honors persisted provider budgets, durably retains responses, waits for accepted normalization/publication, and then freezes a new execution manifest. Concurrent identical requests share work. Failure returns an explicit failed or qualified stale result according to policy; it does not silently change providers or loosen the date/knowledge boundary.

For known-at and snapshot/replay runs, acquisition cannot revise the selected historical knowledge boundary. A policy may permit collecting evidence for a separate later run, but the requested historical run still succeeds only from eligible retained evidence or reports unavailable coverage. Replay never triggers provider acquisition.

SQL cannot be safely translated into arbitrary provider requests. Automatic acquisition requires declared source-to-dataset identities and bounded acquisition inputs. Unsupported/ambiguous queries fail preflight with an explanation. Initial qualification covers EODHD daily prices and supported yfinance daily-price identities; additional datasets need their own coverage and capture qualification.

Expose policy discovery, preflight and acquisition/run status to Rita through MCP. A tool that can acquire data is a write-capable tool, not a read-only cache query. Preserve existing cache-only discovery/query behavior. Rita and direct widgets use the same execution service and receipts.

## Implementation order

1. Protocol inventory and failing conformance tests: map the safer table protocol to the Temporal adapter and list supported/refused capabilities explicitly.
2. Cursor-based retained result viewing with strict identity/budget/cancellation tests and a >1,000-row demonstration.
3. Remote complete-result transformations, linked widgets and bounded exports through the table provider contract; qualify global correctness beyond the first page.
4. Saved acquisition policies and read-only coverage preflight, initially for qualified daily-price sources.
5. Automatic execution orchestration: cache miss -> scoped acquisition -> durable capture -> accepted normalization/publication -> frozen result.
6. Rita/MCP tools and widgets showing policy assumptions, progress, coverage and receipts; run installed browser/provider-path acceptance.

Steps are separate reviewable increments. Existing integration branches remain the baseline; no main changes, publication or production deployment is implied.

## Verification and release gates

- Page boundary, forged/expired/cross-scope cursor, receipt/schema mismatch, duplicate page, cancellation and byte/row limit cases.
- Exact decimals/large integers, totals, filtering, sorting, pivot/chart and export correctness on >1,000-row retained results, including matches outside page one.
- Cache hit sends no provider request; an eligible miss acquires once; concurrent misses deduplicate; budgets and permissions fail closed.
- Durable-write failure, provider failure, normalization rejection, incomplete coverage and repeated unavailable dates do not produce unqualified success or retry storms.
- Known-at correctness before/after a newly received correction; pinned results and replay remain unchanged after automatic acquisition.
- Browser -> relay -> gateway -> installed TemporalDB -> actual provider bridge against recorded transports. Live provider smoke tests are separately identified and bounded.
- Rita tools and widgets agree on execution/policy identity and contain no provider credentials. Record live Rita, native desktop and intended NAS qualification separately.

## Non-goals

Portfolio analytics, skfolio/OpenPort, arbitrary provider acquisition, automatic factor/model selection and OAuth migration are not part of these two plumbing gaps.
