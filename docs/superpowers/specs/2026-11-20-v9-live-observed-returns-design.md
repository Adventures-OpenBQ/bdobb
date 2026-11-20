# Live observed-return box and violin charts — design proposal

20 November 2026. User chose general NYSE/Nasdaq support and a fixed October–November 2026 example. Written design approval remains pending. This design supersedes the calendar-qualified AAPL pilot proposal and preserves the existing approved statistical question.

## Intent and exact question

Enable the existing return box and violin views for bounded EODHD daily adjusted-close acquisitions, without an AAPL-only allowlist. Qualified .US equity series, including NYSE and Nasdaq listings, use the same source path. This is not certification of a ticker's primary venue, historical exchange membership, every exchange session, a screening universe or an underlying issuer/share-class identity across ticker reuse.

The existing approved chart compares adjacent **observed daily adjusted-close quotes**, breaking at known invalid, dropped or filtered observations. It does not require independently verified consecutive exchange sessions. Tuesday and Thursday can form a pair when they are the only acquired observations. If Wednesday existed in the raw response and was invalid, removed by normalization or later filtered, it breaks that pair. Friday to Monday remains eligible. A pair may span multiple exchange sessions if an upstream observation was absent without a corresponding raw row; that upstream completeness is unknown and must be disclosed.

This matches the approved return-box/violin design, priceSamples.dailyReturnSamples and current tests. The earlier reconnaissance incorrectly added historical venue-directory and independent-calendar prerequisites. Those belong to a separately designed session-certified enhancement, not this source-enablement project.

## Approaches and selected proposal

1. **Recommended: preserve the observed-return contract and qualify the existing route.** Capture raw facts before the provider loses them, bind an optional receipt to the completed price request and actual selected rows, preserve known omission coordinates through both engines, and use the existing worker and controls. This enables general supported listings without another feed or chart library. It cannot claim exchange-calendar completeness.
2. **Session-certified distributions.** Add date-valid venue references and authoritative calendars, detecting expected-but-undelivered sessions. This answers a stricter question and needs historical reference coverage absent from this project. No such data service, purchase or calendar requirement is included.

The controller recommends approach 1 because it preserves the approved chart semantics and the user's request to use existing EODHD data. The final approval covers this exact observed-return scope; prior language about verified consecutive sessions is superseded.

## Source scope and fixed examples

Keep the source table as the owner of acquisition. Opted-in daily US equity/ETF historical requests use explicit inclusive start/end dates and fully qualified EODHD listing keys. General support means no fixed AAPL/MCD whitelist; it does not promise every symbol is entitled or that .US identifies NYSE versus Nasdaq. Plain routes and unsupported assets remain usable as ordinary tables without chart qualification.

Use fixed 2026-10-12 through 2026-11-19 examples, with no rolling default. The public demo returned 29 unique positive prices for each of AAPL.US and MCD.US, yielding 28 adjacent observed pairs per listing. The examples demonstrate both exchange categories without claiming a complete historical exchange universe. Other explicit bounded windows may qualify under the same evidence contract; dates are not restricted to the example month.

Support the existing source's one or multiple declared listings, up to the chart's existing 12 selected listings. A single source-table HTTP request may invoke the existing per-symbol SDK calls. Each included listing must have one successful full daily array, its own bound identity and original acquisition facts. No renderer fetch, hidden predecessor, auxiliary fundamentals query, calendar HTTP call or second price fetch is introduced. Partial success across requested listings does not qualify a silently reduced universe. Preserve the caller's selection order. A single-listing response may identify its listing via the completed path/request rather than requiring a synthetic symbol column.

## Provider evidence

Add an opt-in chart_source flag to the existing historical query and a closed daily-price source receipt consistent with the common chart-source envelope. Validate the exact effective daily interval, qualified listings and explicit date bounds. The ordinary response contract remains unchanged without opt-in. Standard and generated mirror routes, and the shared equity/ETF fetcher registration, receive explicit tests; no crypto, FX, index or weekly evidence is accidentally enabled.

Inspect each actual SDK response before rows_from_bars, pandas or model coercion drops data. Capture raw/delivered/normalized counts and original field origins. Validate error envelopes, dates, conflicting identity declarations and adjusted-close basis. Preserve dated invalid adjusted prices and dated rows dropped for other normalizer reasons as gap coordinates. An undatable omitted observation cannot be positioned safely and refuses qualification. Conflicting same-listing/date prices refuse; exact repetitions can collapse once with explicit counts. Do not replace adjusted close with close. Both endpoints of a return come from this acquisition, using the currently adjusted history returned by the provider, with no historical-as-known claim.

A completed bounded unpaged response establishes acquisition of the delivered rows, not the existence of every exchange quote. Distinguish raw/normalizer loss from paging, truncation, an error/denial object or a known partial acquisition; the latter cannot qualify. A valid empty array remains a distinct empty/insufficient result. No receipt contains hidden numeric prices. Coordinate-only negative facts may describe removed observations.

## Client and both-engine admission

Match the completed request's route/provider, exact selector and selected array, declared listing set, daily interval and bounds. Reject conflicting or duplicate query keys, wrong selector/provider, forged local-backend authority, count mismatches and unknown receipt fields. Validate metadata against actual rows before any downstream projection. Do not globally promote unrelated table completeness from unknown to complete.

Provide a return-specific bounded acquired input only after the receipt proves complete acquisition of its delivered arrays and accounts for raw normalization loss. Both new-draft eligibility and worker execution use the same qualification path. Preserve existing documented local-file behavior. Bad raw facts cannot be filtered away to obtain proof.

Keep provider missing/dropped coordinates distinct from later table-filter omissions. Propagate the coordinate-only facts and original field identities through TypeScript and compiled Rust, aliases, reorders, filters, links and grandchildren. A removed delivered Wednesday breaks Tuesday-to-Thursday. An unobserved Wednesday does not become a fictitious known gap. Aggregation, mixed listing identity and ambiguous provenance refuse.

## Calculations and UI

Do not change R7 quantiles, Tukey whiskers, outlier retention, Gaussian KDE, bandwidth, price ratios, adjustment basis or common-window clipping. Boxes still require five finite returns and violin twenty plus valid density. Both render the same admitted samples. Common windows clip prices before differencing; no outside predecessor is read. Keep per-listing counts and dates, excluded opportunities and exact original values.

Retain existing Parameters, source selection, saved pins, measured Apply, draft preservation and local import/reacquisition. Add concise scope wording: **Observed quote-to-quote returns; exchange-session completeness unknown.** Details explain that an upstream-undelivered observation is unknown and a pair may span multiple sessions. Never label these independently verified one-session returns. The chart does not pool currencies or imply a currency-hedged portfolio return.

Symbol, bounds, interval, backend, selector or credential replacement retires incompatible results. Only matching same-question refresh can retain stale output. Draft edits do not Run through navigation. Rita without explicit overrides uses the committed question for configured/pinned origins. Source tickets and geometry fences stay intact.

## Qualification and shipping

- Provider raw-response RED/GREEN tests: one counted SDK call per listing, original timestamp, normalizer drops, dated invalids, undatable refusal, exact/conflicting duplicates, malformed/denied/partial/paged responses, identity/bounds/interval mismatch, empty input, raw-close-only input and legacy ordinary responses. Test single/multiple symbols and shared equity/ETF aliases explicitly.
- Admission tests compare Tuesday→Thursday with and without an acquired Wednesday, weekend pairs, raw gap plus a different filtered row, common-window endpoints, ambiguous aliases and both engines' linked-grandchild lineage. No hidden prices or portable evidence may survive export.
- Preserve exact sample/statistical thresholds at 4/5 and 19/20, zero-IQR and extreme values. Existing builder tests remain authoritative. Confirm AAPL and MCD fixed examples each yield 28 observed pairs for the independently captured public response.
- Installed paired tests use generated widget/OpenAPI opt-in, actual GET/selector/metadata and one source request with counted SDK calls. Plain responses must not gain chart proof. Re-vendor exact canonical provider source and verify all installed files and receipt transport.
- Browser checks on both engines operate the real source table, box/violin, Parameters, filtering, common-window/pins and actual Plotly/accessible values, plus held replacement, failure/stale recovery, off-tab Run/Rita and source-free import/reacquisition.
- Run appropriate tests/types/lint/Knip/scrub/build, bundle measurements and independent review. Preserve original failures/reruns/skips. Plotly stays at the existing qualified version for this feature; dependency remediation is separate work.
- Rebuilding Docker for qualification must also use the separately required patched certifi trust bundle before any deployment. This design does not authorize a deployment target or upgrades to Plotly/PDF/tooling. No deployment is included.

## Acceptance and remaining builder decisions

A bounded source for any entitled, supported qualified .US listing can drive the existing two views from its observed daily array. AAPL.US and MCD.US fixed examples demonstrate two 28-pair distributions if the responses still match the captured data. Known removed observations break adjacency; unknown upstream absences remain unknown and disclosed. Local snapshots and ordinary table callers retain existing behavior.

The builder chooses the narrow receipt signatures and registration hooks consistent with current closed contracts, whether existing coordinate transport needs an additive extension, and the smallest test arrangement. No new financial algorithm, venue directory, hidden fetch, saved proof, dependency vendor or account purchase is required.

## References

- Existing approved spec: docs/superpowers/specs/2026-11-19-v9-next-return-box-violin-design.md
- Existing observed-pair contract: src/lib/widgetData/chartRecipes/priceSamples.ts and returnSummary.test.ts
- EODHD daily data and adjustment documentation: https://eodhd.com/financial-apis/api-for-historical-data-and-volumes
- Fixed public examples: https://eodhd.com/api/eod/AAPL.US?api_token=demo&from=2026-10-12&to=2026-11-19&period=d&order=a&fmt=json and corresponding MCD.US request.

Status: user selected general NYSE/Nasdaq support and fixed example; this exact written observed-return design awaits approval. No feature code has been written.
