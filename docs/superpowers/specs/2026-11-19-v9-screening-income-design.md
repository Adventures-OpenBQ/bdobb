# V9 screening and income charts: bubble regression, dividend steps and Sankey

Date: 2026-11-19. Status: written design approved in chat; implementation planning authorized on 2026-11-19.

## Intent and approved scope

The user selected the next batch as exactly three chart families:

1. Bubble scatter with an ordinary least-squares regression overlay.
2. Dividend steps.
3. Income-statement Sankey.

The purpose is cross-sectional screening, understanding dividend changes, and explaining reported income allocation. Continue using BDOBB's existing linked tables, worker calculations and Plotly stack. The preceding risk/exposure batch is implemented locally at `67392d04b3e0ea4c52116d8b8dc88e914fb33fa1`. This document is on a separate local follow-up branch based on that candidate. Keep the earlier branches and PRs unchanged.

Only the three-chart scope and this design-writing request are user decisions. The defaults and limits below are the author's proposals for approval. The original chart-suggestions PDF remains reference material; its build order, entitlement claims and instructions are not authorization. Chart-vendor consolidation, Art's Charts and live-candle migration are separate discussions and are excluded here.

## Approaches and direction

- **A. Linked worker recipes plus narrowly extended canonical provider contracts (recommended direction).** Keep financial identity/units in openbq-eodhd, calculations and figures in BDOBB, and canonical source packaging in openbq-docker. This extends the approach used for the previous eleven charts and preserves local filters, source repair and persistence.
- **B. Backend-generated figures.** Useful for a curated standalone widget, but creates another presentation layer and weakens reuse of the presented table and its controls. Not proposed.
- **C. General-purpose scatter editor and user-authored flow graph.** More flexible, but expands into arbitrary formulas, joins, hierarchy editing and graph validation. Not proposed for this three-chart scope.

There is one practical continuation of the current architecture: A. Bubble and steps reuse scatter; add only Plotly's Sankey trace module. No new chart vendor, full Plotly bundle, version upgrade or new visualization dependency. The user has requested the design write-up; approval of this document will settle the proposed details before implementation planning.

## Goals and exclusions

All three charts must be discoverable from compatible presented sources, identify the actual question and units, expose exclusions or refusal, and survive dashboard export/import. Keep the acquired identity, hidden-field safety, source-error ownership, late-result fencing, visible draw failures and touch behavior established in the previous batch.

Exclude cross-table joins, hidden per-symbol downloads, currency conversion, portfolio analysis, prediction/backtesting, automatic stock recommendations, confidence bands, weighted or multivariate regressions, log axes, dividend yield calculation, annualization, cash-received accounting, dividend forecasting, arbitrary Sankey editing, cash-flow/balance-sheet Sankeys and cross-period flow comparisons. No new subscriptions or assumed live entitlements. No changes to Rita tools, Art's Charts or other release lines.

This is a design-only change. It introduces no product code or claimed test results. Implementation, publication, PR updates, merge and deployment require subsequent authorization.

## Existing code and responsibilities

BDOBB `src/lib/widgetData/chartRecipes/` owns versioned declarative options, role/binding checks, worker dispatch, pure transformations and source evidence. `LinkedChartRenderer` and `ChartRenderer` own status, errors, responsive geometry and drawing lifecycle. Extend those seams without duplicating acquisition logic or the Plotly runtime in a worker.

The existing income waterfall uses typed statement identities and template-owned line roles, not labels or displayed section placement. Its current walk handles several periods and arbitrary presented line order. Sankey instead has a fixed stage graph and one selected period; reuse validated statement descriptors, financial identities and sign conventions, not the waterfall's rendered trace or table order as a graph.

Canonical provider `openbq_eodhd/models/screener.py` currently omits the upstream five-day return and currency symbol. Add a normalized five-day price-change fraction from `refund_5d_p / 100`, preserve `currency_symbol`, and expose verified market-cap denomination facts without modifying the original market-cap value. Missing/nonfinite upstream return remains null with usable diagnostics; never substitute one-day or absolute return. Preserve the existing fractional dividend_yield, qualified symbol, exchange and last_day_data_date.

Validate screener identity and price-data dates on the raw acquired rows before the current normalizer can drop rows with missing codes. Any unassignable raw identity/date becomes an acquisition-level unsafe fact for this recipe, not a silent reduction in sample size. Preserve raw/normalized/delivered counts and bounded diagnostics without exposing credentials or omitted numeric cells.

`models/corporate_actions.py` already maps value to amount, unadjustedValue to unadjusted_amount, and date to ex_dividend_date, retaining payment currency and optional period/frequency. Its JSON transport must remain explicit. Carry its known split-adjusted amount basis and actual instrument identity in typed metadata/provenance. The income provider is `models/fundamental.py`; preserve issuer, fiscal kind/end, reporting currency and scale as acquired facts when adapting its rows into a statement.

For dividends, collect the full raw response's event dates, validation outcomes and coverage evidence before normalization. The existing code drops malformed ex-dates and raises EmptyDataError for an empty response; neither behavior may silently certify a continuous chart. Keep the legacy endpoint's records/error behavior compatible. A chart-source snapshot path may expose additive acquisition metadata or an opt-in local wrapper over the same single upstream request and shared normalizer. It must retain a pre-drop unsafe flag for undated records and coordinate-only gaps for invalid or excluded dated events. A successful raw empty array with independently verified coverage is a documented zero-event snapshot; an EmptyDataError, HTTP failure, inaccessible history or a list with discarded undated events is not. Exact transport keys and the choice of additive envelope versus an opt-in local wrapper belong to the implementation plan; these facts and legacy compatibility are binding.

Provider changes are additive, fixture-tested and canonical. Do not introduce Plotly into the provider. Regenerate the Docker v9 vendored source/pin/hash manifest from the verified provider commit and check equality; never independently patch its algorithm. Update widget fields/formats where necessary so the normalized return and source facts survive the actual backend adapter. Retain previously shipped provider fixes.

## Common source, unit and persistence contract

Each chart links to exactly one source table. Tables own acquisition, symbols, date bounds, screener query, filters and selection; recipes own explicit bindings and their small option sets. Recipes request only presented fields. No chart expands an acquisition or fetches another series. Required hidden/removed fields produce repair instructions.

Capture the effective completed request and its returned facts, not later edited card parameters. Qualified instrument identity includes exchange. Names, tickers without sufficient venue identity and currency glyphs alone are not proof of equivalence. Preserve source field origin through aliases and prove role-specific bindings: a percentage-point return, absolute price change and a fractional yield are different fields even if they are numeric.

Check acquired units and contradictions before grouping or projection, retain compact safety facts through both TypeScript and Rust engines, dotted response selectors and further linked tables, and revalidate at worker execution. Keep original unsafe facts when their columns or rows are hidden. Source repair must not manufacture a new positive certificate from a derived subset. Saved chart options contain no identity, currency, completeness or unit certification; export/import reacquires evidence from the source. Distinguish acquisition scope from active presented filters, including a filter that happens to match every row.

Snapshot scatter can show a paged, filtered or unknown delivered cross-section if it explicitly labels that sample and makes no whole-universe claim. Dividend steps need documented complete or bounded event acquisition with acquired start/end dates; partial/paged/sample/unknown event history refuses because omitted events would change the held step. Sankey requires a validated income-statement snapshot for one issuer/period with complete reported anchor facts. Limiting the number of fully delivered period records is not the same as paging away statement lines: the former is allowed, the latter does not certify the selected statement. Count alone is never proof of completeness. Deterministic fixture sources can declare explicit source receipts under the same validation as backend acquisitions.

Settings are closed, versioned plain data. Reject unknown keys, unsupported versions, conflicting binding roles and invalid ranges on import and runtime. Keep previous recipe settings unchanged. Source/type/field/symbol/period changes reset the semantic question and relevant interaction state. Same-question refresh preserves zoom. A semantic refusal or relink clears the previous plot; same-source transient failure may retain it with one stale notice. Ignore obsolete worker/draw replies and show active local calculation or Plotly errors separately from parent-owned source alerts.

## 1. Bubble scatter with regression

### Initial question and controls

The initial named recipe is **Dividend yield versus five-day price change**, with bubble area proportional to market capitalization. Bind instrument ID, dividend_yield, normalized five-day change, market_cap, exchange/denomination facts and observation date; name and sector may supplement hover. This batch does not add arbitrary X/Y metric choices. Keeping one defined question avoids a metric store and ambiguous units while still delivering the PDF's intended screening chart.

Use one **price-data date** for the sample, from last_day_data_date. Default to the latest date among presented rows; let the user select another returned price-data date explicitly. Older price observations do not silently join that fit. Record delivered, selected-date, usable and excluded counts. Yield and capitalization are the latest values returned by that acquisition, with no guarantee they were measured on the price-data date. Show both the selected price-data date and screen retrieval time; this selector does not reconstruct a historical screen or a point-in-time backtest. A source returning the same listing on different dates is not an automatic time-series regression.

The canonical example explicitly screens US listings. Verify common market-cap denomination: upstream market caps are in listing currency, not a common converted currency. Initially a recognized EODHD US result with exchange US and currency_symbol $ can use the documented USD contract; $ by itself or the request filter alone is insufficient. Other exchanges require an explicit, acquisition-bound unambiguous denomination. Refuse mixed or unknown denominations rather than compare unlike bubble areas; no FX conversion or extra fundamentals lookup is introduced. Preserve genuine qualified identities for secondary listings; do not claim issuer-deduplicated coverage.

Currency validation is per raw price-data-date cohort, before presentation filters or numeric exclusions. Different valid currencies on disjoint price dates may form separate usable cohorts; two currencies within the selected raw date refuse even when a source filter hides one. Invalid/unassignable raw identities or dates refuse all cohorts because they cannot be assigned safely. Declared field-unit conflicts remain acquisition-wide. Retain per-date compact safety facts across projection rather than re-certifying only surviving rows.

### Admission and figure

Rows need one stable listing ID, the selected price-data date, finite X and Y, and finite positive market cap. Zero yield and zero return are valid. Missing/invalid numeric observations are omitted with counts/reasons; conflicting duplicate listing/date rows refuse, while exact duplicate observations may collapse with a note. A positive and a missing value for the same observation are conflicting, not a license to take the usable one. Missing/corrupt required identity, date, unit or denomination facts refuse rather than silently filter an unsafe universe.

No automatic outlier removal, winsorization or magnitude-based unit guessing. Values remain those reported after the documented percentage conversion. This chart does not independently validate the provider's economic accuracy or historical point-in-time availability. Source-defined filters and excluded numeric rows are disclosed. A financial unit conflict cannot be repaired by dropping the conflicting hidden dimension.

Render an equal-area scaled scatter marker: use sizemode area and one shared positive scale relative to the largest admitted market cap, with an upper display diameter of 48 pixels. Avoid a minimum-size floor that misstates relative area; very small marks may be difficult to hit, so retain a textual sample summary and the source table. A legend explains that area represents reported market cap in the identified denomination. Hover gives qualified listing, X/Y values, original market cap, date and optional name/sector. Both axes show percentages from fractions; no double multiplication.

### Regression definition

Default regression is enabled, with a persisted on/off control. Fit unweighted OLS with an intercept to exactly the plotted usable listings, independent of bubble size. Require N >= 3 and nonzero finite X and Y variance. If the sample is smaller or constant, keep the valid bubbles and explain why the fit and R-squared are unavailable. Never report an invented zero R-squared.

Use numerically stable centered/scaled sums. Slope is covariance(X,Y)/variance(X), intercept is mean(Y)-slope*mean(X), and R-squared is squared Pearson correlation for that same intercept fit. Only clamp rounding-sized excursions from [0,1]; numerical failure withholds the fit with a note. Draw the line only across observed X bounds. Publish N and R-squared; hover gives the fitted relationship and sample scope. No p-values, confidence intervals, forecasts, causality or extrapolation.

The displayed sample may be a market-cap-sorted page, not a random or complete universe. State this plainly whenever applicable. Changing source filters, selected date or usable rows recomputes both bubbles and fit; hiding a legend category must not silently create a different regression sample. No grouped sector traces with interactive subset fits are planned.

## 2. Dividend steps

### Meaning and basis

Show **Last reported split-adjusted dividend per share**, indexed by ex-dividend date for exactly one acquired instrument and one payment currency. Use HistoricalDividends amount, which the upstream value field expresses in today's split-adjusted share terms. Do not substitute unadjusted_amount when amount is missing. No unadjusted-mode toggle is included in this batch; original cash received belongs to a separate accounting question.

Payment currency is required and must not be inferred from the listing currency: a London quote may be in pence while its dividends are in pounds. The canonical instrument is derived from the acquired request, including default/explicit exchange, and preserved even when dividend rows omit a symbol. Split-adjustment basis and retrieval vintage are visible. Restated historical dividends are not presented as a historical point-in-time forecast.

Bind ex-date, amount and currency; optional provider frequency/nature is shown on hover and in notes. Declaration/payment dates are supplementary when supplied, not substitutes for ex-date. Include all supplied distribution types. Label Special or Other only when the provider supplies that classification; unknown classifications stay unknown. Do not call every payment a regular dividend or annualize unlike cadences.

### Events and held steps

The chart-source request supplies explicit inclusive start/end dates. Certify the entire interval only from a documented nontruncated provider acquisition within its known entitlement coverage or an explicit fully acquired snapshot; requested bounds, HTTP 200, first/last event and row count are insufficient by themselves. Unknown or clipped coverage refuses. Omitted upstream bounds mean earliest/latest provider-available history, not lifetime coverage; they do not become a bounded chart receipt unless the actual covered interval is independently known. A plan-limited history (such as the documented free-history window) cannot certify an older requested interval. There is no new entitlement lookup or assumed paid plan in this scope. The implementation plan must pin a positive covered-source fixture, a clipped-history refusal and the concrete source's coverage authority before calling the paired route verified.

Sort events chronologically. Finite zero is a real observation; null, nonfinite or negative amounts are invalid, never zero-filled. Invalid amount events break the held path until the next valid event and are counted. A missing/invalid ex-date or conflicting currency/instrument/basis refuses because event order or comparability cannot be established.

Several distributions on the same ex-date cannot safely be deduplicated from amount alone: current upstream records lack a stable event ID. Refuse multiple same-date rows with guidance to acquire an unambiguous event source; do not silently collapse identical-looking rows or sum a possible duplicate regular/special pair. Supporting explicit event IDs and a separate total-per-date view is deferred.

Render horizontal-then-vertical scatter steps with visible event markers. A valid event holds its observed amount until the next event; the vertical change occurs at the new ex-date. This is an observed last-payment level, not a promised payment schedule. No line before the first valid event and no inferred zero for missing months. By default end at the last delivered event rather than extend the level into the future. Show acquired window separately from observed event bounds. A one-event source renders its marker with an explanation that there is no step interval yet.

Filtering away an intervening event must not join the surrounding levels as if the event never existed. Carry coordinate-only omission evidence from the acquired history, insert a gap, and retain exclusion counts without fetching the omitted amount. Precisely: a valid day-1 level holds up to the known omitted/invalid day-2 ex-date, then stops; the path is absent until the next valid day-3 event. A trailing omitted/invalid event still supplies the boundary at which the earlier level stops. Explicit segment endpoints must preserve that known day-1 interval instead of letting Plotly's null handling erase it. If continuity cannot be established, refuse and request the unfiltered fully loaded event source. Future supplied ex-dates are withheld from the historical path and counted as scheduled/future; no current-time or end-date extension implies a forecast.

A verified successful zero-event window clears the graph and says no dividend events were supplied in that covered interval. It does not assert the instrument has never paid dividends. Acquisition errors remain errors and are never converted into this state.

The control selects one actual source instrument where supported; it never fetches it. No multi-currency overlay, dividend yield, reinvestment, growth-rate calculation, payment calendar or inferred dividend suspension is added.

## 3. Income-statement Sankey

### Admission and supported scope

Consume the compiler-validated Income statement presentation, not an arbitrary table with similarly named labels. Require one acquisition-bound issuer, one reporting currency and scale, and exactly one selected fiscal period column. Default to the latest presented period by its actual period end. Preserve FY versus FQ identity and reporting basis; no FY/FQ/TTM mixing or invented calendar-quarter label. Hidden or removed required anchors require repair. Do not combine consolidated net income with net income to common shareholders as interchangeable endpoints.

Reporting currency comes from the same acquired Financials.Income_Statement.currency_symbol block, checked against any per-period declaration; never from General.CurrencyCode or the listing currency. Preserve that fact before the current adapter discards statement metadata. Preserve the monetary scale from a verified canonical field contract or an explicit source declaration, not from number magnitude, an abbreviation formatter or a user display choice. The provider's unchanged numeric values and their declared scale travel together; custom thousands/millions snapshots must declare a common multiplier. Unknown/conflicting currency or scale refuses. The implementation plan must identify the evidence establishing the canonical scale before enabling the real route; absent evidence is a refusal, not an assumed multiplier of one.

The existing income query limit selects whole period records before converting their complete returned fields. A fully acquired selected period with all required anchors remains eligible even when only a limited number of years/quarters was requested. Preserve this period-record coverage separately from whole-history completeness. Missing/null required anchors, truncated per-period line delivery or conflicting period identity refuse. Removing an optional component is disclosed reconciliation, not evidence that its full-period record was truncated.

Initial anchors are Revenue, Gross profit, Operating income, Income before tax and Net income. Resolve canonical typed line IDs with preserved origin. Only the installed, unmodified calculated-gross-profit formula may replace a missing reported gross_profit when its required revenue and cost inputs are present; label it calculated. Other alias/formula substitutions require an explicit supported mapping in the implementation plan, not a runtime guess.

Revenue must be positive; all downstream anchors must be finite and nonnegative. This first Sankey intentionally refuses loss periods or negative reported core subtotals with a clear explanation. Signed periods remain available in the existing waterfall. Supporting loss/deficit node conventions would be a separate scope amendment, not silently drawing negative link widths or absolute-valuing profits.

### Fixed stage graph and reconciliation

Use a fixed directed acyclic income-allocation graph, independent of display order and current section placement. Stages reconcile Revenue to Gross profit, Gross profit to Operating income, Operating income to Income before tax, and Income before tax to Net income. Carry the reported next anchor into the next stage exactly once. Incoming/outgoing stage labels distinguish reported anchors from total reconciled throughput when adjustment inflows exist.

Use canonical cost_of_revenue at the first stage and income_tax_expense at the final stage. The middle bridges are derived from reported anchors: Gross profit minus Operating income is explicitly labeled **Net operating deductions (derived)**, or net operating credits when the direction reverses; Operating income to Income before tax is derived net non-operating income/expense. Do not request total_operating_expenses or its R&D/SG&A/depreciation children as independent links. EODHD's aggregate can include cost of revenue depending on the issuer, so using it again would count a cost twice while manufacturing a balancing adjustment. Interest and other net effects are not counted again from individual lines. Detailed expense drilldown is deferred.

Acceptance example: revenue 100, cost of revenue 40, gross profit 60, total_operating_expenses 70 and operating income 30 produces COGS 40 and derived net operating deductions 30. The ambiguous aggregate 70 does not create a link or a fictitious credit of 40.

For stage anchors A and B and included signed component steps s, compute residual = B-A-sum(s). Cost/tax values follow the existing source sign convention: a positive expense is a negative step; a negative expense is an explicit credit inflow. Negative component flows become positive-valued expense-sink links; positive components become positive-valued credit-source links. A positive residual enters from an explicitly derived adjustment source; a negative residual leaves to an adjustment sink. The two middle bridges use no independent reported component: their signed residual is the derived net operating or non-operating change described above. Other residuals are named by stage, with hover stating they include adjustments and lines not shown. Never hide a residual to make the graph balance.

For every junction, incoming reported anchor plus positive components/residual must equal outgoing reported anchor plus the magnitudes of negative components/residual. All link widths are finite and strictly positive. Zero-valued links are omitted from drawing but reported zero anchors remain in the accessible summary. Do not draw cycles, links back to prior stages, or claim this is a cash-flow statement.

Missing optional component values are not zero observations: omit the component, retain the difference as a labeled residual and report which component is unavailable. Cell errors on required anchors refuse. Optional component errors are reported as unavailable and reconciled rather than silently read as numeric values. If a selected component is filtered out, the residual says it includes lines not shown; no hidden amount is fetched. Required anchors cannot be filtered out and then reconstructed from hidden values.

Treat only cancellation-sized residuals as rounding noise, using the established waterfall precision rule: no whole-currency-unit residual disappears. State rounding tolerance in acceptance fixtures. Carry units and magnitudes consistently; use a reversible common display scale if necessary, with original monetary values in hover. Refuse arithmetic overflow or a graph whose positive values cannot be represented faithfully. A node's total throughput may include credits or adjustments; never label it as a reported subtotal unless the numbers are equal.

Node identities are template/stage IDs, not labels. Labels and hover values are escaped. Chart title and status name issuer, selected fiscal period/end, currency/scale, included components, calculated anchors and reconciliation. Fixed, non-draggable node placement provides stable reading order; responsive orientation/layout is a builder choice constrained by readable labels, original flow direction and usable touch inspection. Add only the Sankey trace registration and derive native-figure validation from the actual registered list.

## Controls, errors and accessibility

Add three closed recipe types with explicit options, not a generic Plotly JSON editor:

| Chart | Saved choices | Fixed semantics |
| --- | --- | --- |
| Bubble regression | compatible bindings, selected observation date or latest, regression enabled | yield vs normalized five-day change, area=market cap, unweighted intercept OLS |
| Dividend steps | compatible bindings, one selected instrument | ex-date, split-adjusted amount, historical observed step |
| Income Sankey | one typed presented fiscal-period binding | fixed anchored graph, cost/tax components and derived middle bridges, nonnegative anchors |

Persist and validate choices on import and runtime. Never persist acquired certification or trust edited metadata in an exported dashboard. Incompatible unsaved drafts explain why Apply is unavailable and keep the last applied chart; an actually invalid applied/imported configuration refuses and clears it. No implicit source switching or secret field acquisition.

Use semantic titles, textual counts/scope, zero/missing distinctions, local error alerts and non-color flow labels. Support real marker/node/link hover and touch inspection. Reuse overflow-dependent touch scrolling where tall content requires it, preserving drag zoom on fitting scatter/step plots and desktop zoom across resize/refresh. Sankey itself has fixed node positions. The worker's question revision includes source identity, bindings, observation/period, selected instrument and analytical choices, excluding viewport geometry.

## Delivery boundaries and acceptance

Implementation planning must first pin the canonical provider/adapter contracts and regenerate paired Docker packaging, then add the worker builders and settings, then integrate controls/examples/help and run acceptance. The provider is currently pinned at `349f2de40773cf2e1d9e2993ebabf3184871c07d`; Docker at `f1ff723e66ece8bf404a8211716a62591d464581`. Recheck release heads and earlier PR merge state when implementation begins. Do not rewrite existing published branches or independently maintained vendor code.

Use isolated codex/ branches. Follow applicable AGENTS instructions and CodeGraph-first only in repositories with an existing index. Exact file/module names, option keys, role transport plumbing, node colors and layout geometry are builder decisions for the implementation plan. Any need for a new upstream lookup, currency conversion, dropping a chart family or changing the fixed financial definitions returns for design review.

Acceptance must cover:

- Provider five-day percentage conversion exactly once, missing/invalid returns, preserved existing fractional yield, currency/denomination and all prior provider fixes; compare canonical/vendor trees and hashes.
- Bubble exact-fit and noisy-fit samples with known slope/intercept/R-squared, equal-area sizes, zero values, price-date versus acquisition-time semantics, raw bad identity/date before normalization, duplicate conflicts, constant/small samples, missing/outlier observations, sorted-page disclosure, same-date currency conflicts hidden by filters, disjoint-date valid denominations and extreme finite plotting limits. Marker hiding must not silently change the stated regression sample.
- Dividend ex-date timing, split-adjusted versus unadjusted values across a known split, payment versus quote currencies, Special/unknown frequency, successful zero-event coverage versus empty/error response, zero/invalid amounts, same-date ambiguity, undated raw events before normalization, explicit/clipped/unknown bounds, future records, and the exact segment endpoints around intervening or trailing omitted events.
- Sankey known conserved stage flows, ambiguous aggregate-expense example, optional/missing components, tax credits and negative expenses, positive/negative residuals, zero anchors, statement-reporting versus listing currency, scale conflicts/unknown scale, period-count limit versus truncated statement lines, loss refusal, no aggregate/child double count, typed formula/line origin, section moves/filtering and numerical limits.
- Raw-to-projected and second-linked-table evidence through TypeScript and compiled Rust, backend dotted selectors, hidden unsafe facts, tampered import settings and actual reacquisition on workspace reopening.
- Actual parent/renderer lifecycle for all three: A-to-B pending/failure/recovery, late worker/draw rejection, no stale wrong-source graph, one source alert, independent local errors and same-source stale indication.
- Real Chromium light/dark, narrow and touch, markers and Sankey links, resize/zoom or node stability, scroll/inspection, source repairs, active filter scope, export/import and new-page requests. Inspect rendered screenshots and counts/flows, not only figure JSON.

Run the existing BDOBB shipping gates (typecheck, lint, full unit suite, scrub, web tests, build and targeted browser checks), provider offline tests and actual packaged route/pin checks on the final paired candidate. Record code pins, warnings/skips and baseline-to-candidate bundle bytes, separating the new Sankey module from worker code. Use deterministic fixtures with no credentials. An independent reviewer separate from implementers checks the complete implementation and any fix range. Live entitlements, physical-device Safari/Tauri and deployment are not implied by deterministic Chromium verification.

## References and design readiness

- User approved this three-chart scope in chat on 2026-11-19.
- Existing BDOBB recipes, `waterfallFigure.ts`, statement taxonomy/compiler/catalog and previous risk/exposure review.
- Canonical provider `screener.py`, `corporate_actions.py`, `fundamental.py` and corresponding fixtures, inspected at the pinned provider commit.
- [EODHD screener contract](https://eodhd.com/financial-apis/stock-market-screener-api): five-day percentage field, fractional yield and listing-currency capitalization.
- [EODHD dividend contract](https://eodhd.com/financial-apis/api-splits-dividends): ex-date, split-adjusted and historical unadjusted amounts, optional event classification and payment currency.
- [EODHD statement glossary](https://eodhd.com/financial-academy/financial-faq/fundamentals-glossary-common-stock) and [fundamentals structure](https://eodhd.com/financial-apis/stock-etfs-fundamental-data-feeds): issuer-specific aggregate-expense conventions and statement-owned reporting currency.
- [Plotly scatter](https://plotly.com/javascript/reference/scatter/) and [Sankey](https://plotly.com/javascript/reference/sankey/); implementation must use the installed version's supported attributes, not assume the current website's newer features exist locally.

An independent builder check raised four material questions about overlapping expenses, dividend pre-normalization continuity/coverage, screener date-cohort semantics and statement currency/period completeness. The author resolved them in the revised contracts above without expanding the three-chart scope. The scoped readiness recheck returned "nothing important left" on 2026-11-19. This is design readiness, not implementation verification or user approval. The user approved this written design on 2026-11-19 and requested the implementation plan. Product implementation awaits review of that plan.
