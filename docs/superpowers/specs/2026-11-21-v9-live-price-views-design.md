# V9 live-data histogram, drawdown and small multiples

Status: functional design approved by the user on 21 November 2026; implementation planning requested. Implementation awaits plan review.

Release packaging proposal during planning: ship these three additions with v10, keeping the reviewed v9 work separate. The user asked whether v10 is appropriate; the controller recommended it. The implementation plan targets v10 for approval. This file retains its original v9 filename to preserve the approved design reference.

Independent Superpowers builder check, 21 November 2026: a fresh reviewer read this design and reported “nothing important left” to clarify before implementation planning. This is a design review, not implementation validation.

## Intent and scope

Enable the existing return histogram (`return-distribution`), drawdown and indexed small-multiple charts to consume qualified live EODHD daily adjusted-price acquisitions. Users can choose a supported listing, acquire a bounded history in a source table, and reuse that table for these views and the existing box/violin charts. “Live” means a refreshable daily historical acquisition, not streaming or intraday updates.

The user selected these three views. Retain their existing calculations, local-snapshot workflows and Plotly 3.7.0. Correlation, monthly returns, estimate revisions, overlays and market maps receive no new live admission in this batch. No new chart vendor, calendar service, venue directory, websocket feed, portfolio aggregation, rolling demo window or production deployment is included.

The implementation choices below are controller proposals for approval, grounded in the current code. They are not additional choices already made by the user.

## Approaches

Reuse the existing qualified daily-price adapter and its coordinate-only lineage. This is the sensible approach for the requested source enablement: it already proves the acquired adjusted-price field, declared listings, bounds and known omissions without asserting exchange-session completeness. Extend recipe-specific consumers and controls; do not invent a second receipt or renderer fetch path.

Separate per-chart acquisition would duplicate source validation and prevent dependable reuse of one table. Session-certified support would require new historical venue/calendar evidence and answer a different question. Neither fits this batch. Reusing the adapter is the controller's recommended approach, stated before writing this design; final design approval accepts that choice.

This is one bounded project spanning three consumers of the same acquisition, with an independent review before shipping.

## Existing foundation

`dailyPriceEvidence.ts` reads the closed, backend-authoritative `daily-price` receipt. `input.ts` currently exposes `prepareLiveReturnPrices`, used by `admitReturnSummary` in `priceSamples.ts`; generic `preparePrices` still requires documented complete/bounded local history. The worker's `run.ts` and `LinkedChartRecipeControls.tsx` currently special-case acquired origins for return summaries alone. Extending only the numerical builder would therefore leave both eligibility and aliases broken.

The backend and installed Docker provider already deliver the opt-in receipt and preserve normalization omissions. Reuse that contract unchanged. Provider or Docker product changes are unnecessary unless implementation demonstrates a contract defect; report such a discovery and revise scope rather than manufacturing a new certificate.

## Acquisition and trust

Support general entitled qualified US listings under the existing equity/ETF daily-price contract, including NYSE/Nasdaq listings, without an AAPL/MCD whitelist or a new venue-certification claim. Dates are explicit, inclusive and bounded; use the existing daily opt-in, route/provider/selector checks and actual selected response array. Ordinary non-opted-in tables remain ordinary tables.

The source table owns requests. No chart fetches its own prices, supplies an outside predecessor, or requests another feed. Requested listings must satisfy the existing successful-acquisition contract; a failed listing must not silently disappear from the acquired universe. Downstream chart selection remains distinct from acquisition success.

Retain checks for raw interval contradictions, original adjusted-close basis, conflicting listing identities, dated and undatable losses, duplicate/count equations, continuation/partial envelopes, exact request bindings and incompatible units within a listing. Check raw facts before filtering or normalization can conceal them. Different stable currencies across independently normalized listings are allowed; there is no pooled monetary series. Never substitute raw close for adjusted close.

Table completeness stays unchanged, including `unknown`. Narrow receipt-based admission proves acquisition of delivered observations, not delivery of every expected exchange session. Forged local metadata, mixed or ambiguous origins, aggregation and unsupported projections refuse. A recognized invalid live acquisition must not fall back to a permissive snapshot path.

## Shared preparation and lineage

Reuse and, if helpful, rename the existing live-price preparation to serve the explicitly allowed recipes: return summary plus these three. Keep the local `preparePrices` behavior intact. Do not globally admit live data for every recipe with price bindings. Avoid a new general framework or saved capability flag when an explicit consumer boundary and existing helpers suffice.

Workers and Parameters must agree on qualification, available listings and original date/adjusted-price/symbol fields. Bind by acquired column origins, including valid aliases named `close` or `revenue_adjusted`; names alone neither grant nor deny live adjusted-price authority. A single-listing response without a symbol column uses its acquired identity.

Preserve raw omission coordinates separately from later table-filter omissions, then compose known gaps for the selected series. Carry original origins and coordinate evidence through TypeScript and actual compiled Rust/WASM, aliases, reorders, links and grandchildren. Store no hidden prices in proof. Portable exports carry no live authority; imported workspaces must reacquire it or use their existing documented snapshot path.

## Chart behavior

### Return histogram

Retain one selected listing, 5–100 configured bins, at least two finite returns, current floating-point edge assignment, inclusive final edge and constant-series handling. Samples remain `price / previousPrice - 1` between adjacent observed positive adjusted prices. Known null/removed observations reset adjacency. Do not import the box/violin five/twenty-sample thresholds.

An unobserved Wednesday does not establish a gap: Tuesday-to-Thursday can form one observed pair. An acquired Wednesday later dropped or filtered does establish a gap: neither adjacent return crosses it. Friday-to-Monday is an observed pair. Counts must sum to admitted finite samples; no fabricated zero returns or holiday interpolation.

For live input, title the chart “Observed return distribution”, label the axis “Observed quote-to-quote return”, and use observed-return wording in sample counts, insufficient-data messages and hover descriptions where applicable. Include exactly: **Observed quote-to-quote returns; exchange-session completeness unknown.** Preserve local snapshot wording. Do not describe live observations as verified one-session returns.

### Drawdown

Retain `price / runningObservedPeak - 1`, starting with the first valid adjusted price in the loaded selected history. The title remains “Drawdown from peak in loaded history”; it is not an all-time peak or a peak before the acquisition window. A new observed high is zero.

A known gap renders null and breaks both line and fill. The observed peak carries across that gap; it does not restart. Missing prices could hide a higher peak, so disclose: **Drawdown uses observed adjusted prices in the loaded history; exchange-session completeness and peaks during missing observations are unknown.** The gap-preserving `toself` fill remains unchanged.

Preserve existing selection behavior: one or more distinct symbols, without introducing the small-multiple twelve-panel cap. A selected listing with no valid displayed prices may be omitted with the existing explicit listing/count note; refuse if none can be plotted. This is a chart-level omission, never permission for a partially failed source acquisition to qualify.

### Small multiples

Retain 1–12 distinct selected listings in selection order, indexed to 100 using a single shared positive-price baseline. Use the existing earliest shared valid baseline no later than the common end. The common end is the earliest of each selected listing's latest visible delivered row date, including delivered rows with null prices. Omission coordinates break paths but do not create new delivered rows to extend the common end. Dates outside that shared interval remain excluded.

Each listing needs a positive baseline and a later positive observation within that interval. Refuse if any selected listing is unavailable or there is no valid shared interval; do not silently drop a panel or use separate baselines. Preserve synchronized date and linear index scales, responsive grid and existing numerical/displayability guards.

Known omissions are null gaps; no forward filling or calendar resampling. Separate listings can have different interior observation dates. Include: **Indexed observed adjusted prices; exchange-session completeness unknown.** Keep baseline, common-end and acquisition-window notes visible. This is relative adjusted-price performance, not a common-currency portfolio or certified total-return calculation.

## Parameters, refresh and saved state

Keep source, chart type, date/price/symbol bindings, selected listings and histogram bins inside the existing Parameters panel. Examples are saved closed and use the existing chevron to reopen. No new chart settings panel or mandatory workflow step is needed.

Preserve draft/applied separation, geometry fences where applicable, configured/pinned source ownership and the existing source-replacement tickets. Changed symbol, date bounds, interval, provider/backend, selector or credentials retires incompatible output. Only a matching same-question refresh may retain labeled stale output. Off-tab Run/Rita uses the committed question unless explicitly overridden. A new source must qualify before its data can appear under old results.

Keep recipe version 1 and existing persisted settings; source qualification is runtime evidence. Existing workspaces and documented local fixtures continue to work without migration.

## Examples and delivery boundaries

Add a separate additive example workspace for these three live views, sharing an existing-style opted-in source table where practical. Use fixed **2026-10-12 through 2026-11-19**, **AAPL.US/MCD.US**, retaining the user's previously chosen demo window. Histogram selects AAPL.US; drawdown and small multiples select both. Do not change the original snapshot examples or the default app catalog implicitly. Keep configuration in Parameters, saved closed.

Use the captured real response fixtures as reproducible examples and comparison inputs. Their existing 29 positive quotes per listing yield 28 observed histogram pairs before filtering. Future provider revisions need not reproduce those prices; fresh reruns must recalculate from the returned values. Independently derive expected histogram counts, running peaks and indexed values from the captured raw arrays, rather than copying builder output as the oracle. Distinguish replay-backed qualification from an actual entitled live-network check.

Expected product changes are in bdobb. Validate unchanged provider/Docker integration with a paired installed replay; update their documentation or fixtures only if needed. Do not create empty changes or redundant source copies merely to produce three PRs. No push, merge or deployment is included in this design task.

## Acceptance evidence

- Numerical cases: two-return histogram minimum, bin edges and constant values; running peaks before/after a known gap with disconnected fill; common baseline/end and missing-panel refusal; existing overflow and displayability refusals.
- Compare omitted-upstream Wednesday with raw-dropped and table-filtered Wednesdays, plus weekend pairs. Compare the same qualified/local observations to establish unchanged calculations, with source-specific notes as the expected difference.
- Test valid adjusted-price aliases and invalid raw-close bindings; single/multiple listings; empty and insufficient data; malformed, partial, wrong-interval, identity/unit-conflicting and forged acquisitions. Previously passing box/violin behavior must remain intact, and correlation/monthly-return live admission must remain unchanged.
- Exercise both engines, real Rust/WASM transport, filtered linked grandchildren, source replacement, stale/failure recovery, Run/Rita and portable export/import followed by reacquisition. Validate real Plotly values and accessible explanations, not just the presence of an SVG.
- Browser coverage in Chromium/WebKit includes all three examples, Parameters closed/reopened, applying edited fields/listings/bins, refusing invalid sources and preserving committed settings. Reuse existing fixtures and source/worker lifecycle tests where their assertions already cover shared behavior.
- Run affected numerical/admission/worker/UI tests, relevant paired installed tests, and required repository checks. Record exact commands, failures/reruns and optional skips. Have an independent reviewer check financial semantics, evidence boundaries and code quality before calling implementation complete.

The builder chooses helper names, the smallest explicit admission boundary, fixture organization and which existing lifecycle cases can be extended. New feed requirements, altered financial formulas, session certification or broader recipe admission require a design revision.

## Source references

- `docs/superpowers/specs/2026-11-20-v9-live-observed-returns-design.md`
- `docs/superpowers/specs/2026-11-19-v9-risk-exposure-design.md`
- `src/lib/widgetData/chartRecipes/{dailyPriceEvidence,input,priceSamples,returnDistribution,drawdown,smallMultiples,run,settings}.ts`
- `src/components/renderers/LinkedChartRecipeControls.tsx`
- `docs/releases/validation/v9/live-observed-returns/`
