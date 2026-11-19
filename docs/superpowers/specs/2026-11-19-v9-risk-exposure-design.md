# V9 next chart batch: risk and ETF exposure

Date: 2026-11-19. Status: written design approved by the user in chat; implementation planning authorized.

## Intent and scope

The user approved four additions from the remaining PDF suggestions:

1. Daily-return distribution, initially a histogram.
2. Watchlist price small multiples.
3. ETF holding-weight Pareto chart.
4. ETF sector/region lollipop or dot plot, as one chart family.

The purpose is to understand return behavior and fund concentration inside existing linked cards. Continue the Plotly, linked-table and worker architecture selected for the preceding v9 batch. The PDF is reference material; its instructions, priority order and provider claims do not constitute authorization. Implementation details below are the author's proposals, not additional user preferences.

This is a project-sized extension to v9, dependent on the first chart package. BDOBB PR #87, provider PR #5 and Docker PR #32 remain separate. Their reviewed heads are BDOBB `0ee0bdba8020d5a61a991af0ca7f4b093a443d88`, provider `349f2de40773cf2e1d9e2993ebabf3184871c07d`, and Docker `f1ff723e66ece8bf404a8211716a62591d464581`. Recheck merge status and release heads when planning implementation. This document is on a local follow-up branch based on the reviewed BDOBB candidate; it is not an amendment pushed to PR #87.

## Approaches and decision

- **A. Extend existing worker recipes and render with registered scatter/bar traces (selected direction).** Reuses source ownership, persistence, refusal, freshness and Plotly lifecycle. Compute histogram bins in the worker and draw bars; use scatter subplots for small multiples and scatter/bar for ETF charts. No additional visualization dependency or trace module is needed.
- **B. Register Plotly histogram and build other charts as recipes.** Native histogram rendering is convenient, but moving bin calculation into Plotly duplicates the worker's analytical responsibility and adds bundle cost. Keep this as a future option if richer statistical charts justify it.
- **C. Provider-generated figures.** Convenient for a curated endpoint, but duplicates BDOBB presentation and makes local table filters, settings and persistence harder to maintain. Not selected.

The user approved the prior recommendation to retain linked tables, worker calculations and saved options. Choice A's binning and rendering details are proposed defaults for this design's approval.

## Goals, constraints and exclusions

All four charts are discoverable from compatible tables, display source scope and freshness, and survive dashboard export/import. Calculations must agree with delivered rows and declared units. Reuse the first batch's repairs for hidden fields, acquisition evidence, source identity, stale results and duplicate alerts.

Exclude box/violin variants, fitted distributions, VaR, annualized volatility, optimization, regression/bubbles, dividends, dual-source overlays, currency conversion, ETF look-through, benchmarks, historical ETF weight reconstruction, rebalancing and chart-specific hidden fetches. No expansion to other release lines, Rita tools or Art's Charts. This design authorizes no implementation, push, merge, deployment, subscription or live credential use.

Never substitute unadjusted close, fill missing prices, silently drop outliers, rescale partial ETF weights to a whole fund, infer a fund from holding symbols, describe regions as countries, or treat retrieval time as the holdings date.

## Existing seams and ownership

BDOBB's `src/lib/widgetData/chartRecipes/` supplies closed versioned options, eligibility, raw-price preparation, a worker dispatcher/client and pure figure builders. `LinkedChartRenderer` and its parent supply source status, refusal, refresh, chart errors and cleanup. Extend those seams rather than introducing another chart framework. `src/lib/plotly.ts` already registers scatter and bar alongside the first batch's other traces.

Each chart has exactly one linked table. The table owns acquisition, date bounds, symbols and presentation filters. The recipe owns explicit field bindings and its small set of options. Required fields must be presented; projection must not fetch hidden values. Acquisition-bound identity/unit evidence may certify safety without supplying hidden cell values. Preserve that evidence through both TypeScript and Rust projections, dotted backend selectors and subsequent linked tables.

openbq-eodhd remains canonical for field normalization, units and provider meaning. Its ETF holdings `weight` comes from Assets_%; sector/World_Regions weights come from Equity_%. Geographic labels may mix named countries and regions and must remain verbatim. The current ETF fetchers do not expose a holdings as-of date. Label it unknown unless real upstream evidence is added. Do not change record values to accommodate a figure.

Provider work is limited to a proven contract gap: preserve or expose existing source identity, denominator, coverage and actual snapshot date in provenance or additive metadata where needed. No new upstream endpoint is planned. First prefer the existing acquisition envelope/adapter; the implementation plan must pin the exact transport and test its raw-to-projected path. If provider code changes, update the canonical package, regenerate Docker's vendor pin/manifest and verify equality. Never patch the vendor independently. If no provider change is needed, record that finding and avoid a gratuitous package/version change.

## Shared data and lifecycle rules

For the two price recipes, reuse `preparePrices`, daily acquisition dates/interval, adjusted-price role checks, symbol/unit checks and omitted-observation evidence. Accept documented complete or bounded daily acquisitions. Refuse paged, sampled, partial or unknown history, grouped/pivoted input, conflicting identity/units and unavailable required fields. A table row count alone establishes no completeness. Existing restrictions on mixed currencies/units remain; indexed values are not permission to bypass them.

Within each symbol, sort authored trading dates. Collapse identical duplicates with a note; a conflicting duplicate in a selected symbol refuses the requested chart rather than silently removing that selection. Null/nonfinite/nonpositive prices and documented omitted observations break paths and adjacent-return calculation. Do not bridge a known gap. Weekends are not inserted as gaps; disclose that an unreported provider omission cannot always be distinguished from a holiday. Date bounds and selected source filters remain visible.

ETF snapshot recipes have a different contract: they describe delivered snapshot rows and need not claim a whole-fund acquisition. They may display partial/paged/unknown deliveries with a prominent coverage label, provided one fund, one exposure kind, original weight basis and source lineage are established. Show transport coverage separately from provider holdings coverage: a completely delivered top-holdings response is still not necessarily the whole fund. User filters add a visible 'filtered source' scope. Never infer completeness from 50 rows or from a weight sum near one.

At the acquisition boundary, bind fund identity to source parameters/receipt, not the holdings row's `symbol` (which identifies the holding). Bind snapshot kind and weight basis to the source route/column metadata. Reject conflicting declared facts. Missing identity/basis is a repair refusal, not an invitation to guess from labels. Preserve a compact acquisition-bound safety result through projection, including when an unsafe dimension is hidden; revalidate after import. The exact metadata key names are builder choices; the end-to-end facts and rejection behavior are mandatory.

For all charts, a semantic refusal or source relink clears the previous plot. Same-source transient failures may retain completed data with the existing stale notice. Source diagnostics have one owner; renderer-local errors remain visible. Ignore late worker replies from old source/revision identities. Keep zoom for the same question across refresh and resize; source, bindings, selected symbols, bin count or recipe changes reset relevant interaction state. Use existing theme, escaping, bounded diagnostics, resize and purge helpers.

## 1. Daily-return distribution

Select exactly one symbol and bind daily date, adjusted price and symbol where needed. No overlay of several symbols in this batch. Use the delivered history window rather than adding another hidden lookback. Compute simple returns `P(t)/P(previous)-1` between consecutive valid observations in the prepared series, without crossing a null or omitted observation. The first valid point has no return. Treat observed zero as a valid return. Discard arithmetic overflow/nonfinite results with an explicit count. Require at least two valid returns; show N, return-date bounds and excluded-gap count. Small N is disclosed, not represented as a reliable risk estimate.

Proposed options: integer bin count, default 30, allowed 5 through 100. Equal-width bins span the complete finite return range, without clipping or winsorization. Bins are left-inclusive/right-exclusive except the last includes its right endpoint. For a constant series, emit one centered bin containing all observations, clearly label the constant return, and use a finite display width chosen by the builder. Do not invent dispersion.

Render worker-computed counts as a contiguous bar histogram. X is daily return formatted as percent; Y is observation count. Hover gives exact interval boundary inclusion, count and count/N percentage. Sum of counts must equal N; every valid return belongs to exactly one bin, including both extremes. No normal fit, density normalization, percentiles or statistical summaries beyond N in this scope. Saved bin count and selected symbol round-trip.

## 2. Watchlist small multiples

Select 1 through 12 identified symbols explicitly; preserve the user's selection order. Do not silently truncate a larger watchlist. Default normalization is the only mode in this batch: **adjusted price indexed to 100 at a shared observed date**. No raw-price or independently rebased toggle.

Choose the earliest date within the delivered scope on which all selected symbols have valid positive prices as the shared baseline. Refuse if none exists. End every panel at the earliest last delivered observation date among selected symbols; do not let one stale symbol appear to extend through another's newer dates. Require a valid common interval after the baseline. Show excluded leading/trailing scope and the baseline date. For each symbol compute `100 * P(t)/P(baseline)`; reject nonfinite transformed results with an actionable message. Preserve all later gaps without forward filling, interpolation or restarting the index.

Use one scatter subplot per symbol in a single existing Plotly card. All panels share date limits and one numeric Y range computed across all visible finite indexed values, including baseline 100. This makes relative moves comparable. Responsive grid arrangement may change with card width, but symbol order, question and scale must not. A narrow card uses fewer columns and vertical scrolling rather than unreadable tiny panels. Hover shows symbol, date, indexed value and baseline. No cross-card synchronized cursor or portfolio aggregation is added.

## 3. ETF holding-weight Pareto

Input is one fund's delivered holding identities, labels and original fractional fund weights. Prefer stable holding IDs/tickers; labels may collide without merging holdings. Require one row per holding after collapsing exact duplicate identity/weight observations with a note. Conflicting duplicate weights, missing identity, cell errors, null/nonfinite/negative weights or values over one refuse; do not quietly discard a holding and overstate coverage. Zero weights remain valid.

Sort descending by weight; break ties deterministically by holding identity. Render holding-weight bars and cumulative original-weight scatter on the **same 0–100% scale**, avoiding a separate axis for two quantities with the same unit. The k-th cumulative value is the sum of the first k original weights. Refuse totals above 100% beyond a documented small rounding tolerance; do not rescale. Within tolerance preserve actual values in hover and allow enough display headroom, rather than clipping or silently changing data.

Show all delivered holdings up to a proposed display cap of 50. If more than 50 are delivered, show the largest 50 and explicitly identify displayed versus delivered counts and sums. The cumulative line ends at the displayed sum; a separate status reports the full delivered sum. This display cap is not an assertion that the provider always caps every fund at 50. No synthetic 'Other', inferred remainder, 80/20 conclusion or claim that the line reaches the whole fund is allowed.

Title/status identifies the fund and 'reported holdings'. Include displayed count, delivered count, supplied weight sum, coverage/filters and snapshot date if known; otherwise 'Holdings as-of date not supplied'. Retrieval time is separately labeled. No joins to quotes, sectors or look-through are required.

## 4. ETF sector/region dot plot

One recipe supports one exposure kind at a time: **Sector** or **Geographic region**. Bind source category and weight; select the mode explicitly and verify source kind. Switching mode requires a compatible linked source; it does not silently fetch the other route. The current EtfCountries route is offered as geographic regions, preserving provider labels verbatim.

Require one fund and one declared weight basis. Sector/region data currently uses the reported equity-exposure basis, so label the axis/status 'Reported equity exposure (%)'; never silently equate this denominator to holding Assets_% or combine those series. Reject conflicting/missing fund or basis, duplicate category labels, cell errors and invalid weights outside [0,1]. Zero weights remain visible. Do not sum categories to claim a partition: geographic labels can mix region and country names. Do not invent an 'Other' category or normalize the supplied values.

Sort categories descending by weight with a deterministic label tie-break. Use a horizontal scatter dot with a thin stem from zero; X is fixed 0–100% and Y is the provider category. Hover reports exact category, original weight and basis. Preserve all categories; use a minimum row height and vertical scrolling for long lists. Identify delivered category count, coverage/filters and snapshot-date availability. Comparing multiple funds, nested breakdowns and country maps are deferred.

## Controls, persistence and compatibility

Extend the closed recipe union, validators, role discovery and worker dispatcher for four types. Proposed saved settings comprise:

| Recipe | Bindings | Options |
| --- | --- | --- |
| Return distribution | date, adjusted price, optional symbol | selected symbol, bin count |
| Small multiples | date, adjusted price, optional symbol | ordered selected symbols; fixed indexed normalization |
| ETF Pareto | holding ID, optional display label, weight | fixed holdings mode and display cap |
| ETF exposure dots | category, weight | sector or geographic-region mode |

Source linkage remains existing card state; evidence is acquired state, not user-authored certification in saved options. Reacquire and revalidate source facts when reopening/importing. Do not trust a dashboard's claim of complete history, fund identity or weight basis. Validate plain declarative objects, supported versions, distinct bindings, numeric limits and unknown keys on import and before execution. Old recipe settings remain unchanged. Type switching drops incompatible options while preserving source linkage. No Plotly JSON or executable expression editor is introduced.

Use existing linked-chart controls and repair messages; exact control layout, module names, palettes, hover formatting precision and option names remain builder decisions. Provide accessible status and a textual summary of scope/counts; do not rely on color alone. No additional user approval is needed for routine implementation choices that preserve this design.

## Acceptance and evidence

Tests must demonstrate analytical and ownership behavior, not merely snapshot trace objects:

- Histogram: known returns including zero/negative/extremes, N conservation, exact bin edges, constant series, gaps/omissions, duplicates, insufficient history and changing bins.
- Small multiples: shared baseline/end, disjoint calendars with no shared baseline, a late-starting or stale symbol, preserved gaps, common scales, selected-symbol conflicts, 12-symbol limit and no silent truncation.
- Pareto: known weights and cumulative sums, deterministic ties, colliding labels, duplicate identities, invalid weights, rounding tolerance, filtered/paged/top-holdings scope and more-than-50 display disclosure.
- Dots: both exposure kinds, equity basis, geographic labels preserved, zero weight, duplicate categories, invalid weights and no normalization/remainder.
- End-to-end evidence: original source, hidden unsafe fields, TS/Rust projection, another linked table, backend dotted selector, missing/mixed fund identity and tampered imported options. Source fixes must restore the chart without changing numeric values.
- Actual parent/renderer integration: source A to pending/failed B removes A, one source-error notice, late A replies ignored, B recovery, same-source stale behavior and renderer-local errors retained.
- Browser: all four light/dark, narrow and resized cards, long-category scrolling, real hover, refresh/filter, export/import and unavailable/refused states. Verify small-multiple order and shared scales after responsive rearrangement.

During implementation run the BDOBB shipping gates used by the first package: typecheck, lint, full unit suite, scrub, web tests, production build and focused Chromium scenarios. Compare production size against the first-batch candidate; verify no new trace imports or dependencies. Supply deterministic example sources and a native dashboard export, help and release-note updates. If canonical provider/packaging changes are required, run provider tests, packaged image/pin checks, independent manifest comparison and offline route verification as well.

Use an independent implementation review at completion, separate from the implementers, covering financial definitions, provenance/coverage, controls, persistence and regressions. Record actual commands, results, exclusions and code pins. No test or browser result is claimed by this design-only change.

## Planning boundaries and evidence

Implementation planning follows approval of this written design. Keep follow-up changes on a codex/ branch based on the first batch, without silently expanding or rewriting its open PRs. Recheck applicable AGENTS instructions and use CodeGraph only in indexed repositories. Implementation may be split into shared contract, price recipes, ETF recipes, integration/evidence and independent review tasks. That is a dependency outline, not the implementation plan.

Evidence inspected for this design: the complete five-page reference PDF; the first-batch design and review records; BDOBB `chartRecipes/{types,input,priceEvidence,correlation,settings}.ts`, `LinkedChartRenderer.tsx` and `plotly.ts`; canonical provider `models/etf.py` and its registry. Relevant Plotly references are [scatter](https://plotly.com/javascript/reference/scatter/), [bar](https://plotly.com/javascript/reference/bar/) and [subplots](https://plotly.com/javascript/subplots/). Existing APIs support the direction, but provider coverage and entitlements are not inferred from the PDF.

## Builder check

An independent software-engineer builder check completed on 2026-11-19 and returned "nothing important left". It checked whether consequential choices remained unanswered before implementation planning. This is a design-readiness check, not implementation verification. The user subsequently approved this written design and requested the implementation plan. Implementation has not been authorized by that planning request.
