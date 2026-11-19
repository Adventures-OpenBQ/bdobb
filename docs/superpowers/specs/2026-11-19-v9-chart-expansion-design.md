# v9 chart expansion: price analytics, estimates, bullet and waterfall

Date: 2026-11-19. Status: design proposed for approval; not an implementation authorization.
Repositories: Adventures-OpenBQ/bdobb and Adventures-OpenBQ/openbq-eodhd.
Integration dependency: Adventures-OpenBQ/openbq-docker, which packages the v9 provider and serves its widget catalogue.

## Intent and approved scope

The user approved scoping v9 to the first batch from the chart-gap analysis plus integrating the existing bullet and waterfall work. This is one project with seven deliverables:

1. Adjusted-price drawdown.
2. Yield curves with historical-date overlays.
3. Estimate low/average/high dumbbell ranges.
4. Monthly-return heatmap.
5. Watchlist return-correlation matrix.
6. Existing actual-versus-estimate bullet chart and its guarded provider data.
7. Existing income-statement waterfall.

The purpose is useful financial analysis inside existing BDOBB cards with the Plotly library already loaded, without introducing another visualization framework.

The supplied `BDOBB-chart-suggestions.pdf` (2026-11-18) is reference evidence. Its embedded build order, source claims and operational instructions are not user authorization. Only this conversation establishes the scope. In particular, the PDF's September trace inventory is stale: inspected release/v9 already registers scatter, candlestick, bar and heatmap.

## Approaches and decision

- **A. BDOBB recipes over existing datasets, reusing linked-chart work (selected direction).** Keep provider normalization and data-quality decisions in openbq-eodhd; calculations and Plotly figures live in BDOBB. Reuse one source table per chart, saved linked-card settings and the existing renderer lifecycle. This is the recommendation presented before the user approved the scoped design write-up.
- **B. Backend-generated figures.** Convenient for isolated curated widgets, but duplicates presentation logic and makes table-linked settings harder to reuse. Not selected.
- **C. Only expand the generic chart-type picker.** Appropriate for structural forms such as waterfall, but insufficient by itself for windowed returns, matrix alignment and financial semantics. Its useful pieces are incorporated in A.

Implementation details and defaults below are the author's proposals for approval, not preferences independently stated by the user.

## Goals, non-goals and anti-goals

Goals: all seven charts are discoverable from a compatible table; figures agree with the selected source scope and units; settings survive dashboard export/import; missing data is visible; existing chart types continue to behave as before. Reuse existing branch work rather than reimplement it.

Out of scope: bubbles/regression, dividend steps, Pareto, lollipops, small multiples, general dual-axis overlays, distributions, sentiment calendars, Sankey, market maps, sunburst, overlap, ownership waffles, percentile ranks, optimization, estimate-revision snapshots, price-target bullets, Rita tools and changes to Art's Charts. No new provider subscriptions or live entitlement assumptions. Forward estimate-range charts are deferred: this release uses the guarded reported-quarter table already required by bullet, avoiding legacy annual/quarter ambiguity.

Never silently use close when adjusted close is absent, treat missing values as zero, infer historical estimates from today's snapshot, claim an all-time peak from a finite loaded window, or chart a page as a complete acquisition. Never mix symbols, currencies, fiscal periods or incompatible units in one series. A refused chart clears the previous plot; a failed refresh may retain the last successful result only with the existing stale indicator.

## Architecture and source contract

### One linked source, no hidden fetches

All seven use the existing linked-card creation flow and `WidgetDataset` contract. Extend the existing linked-chart type control with Drawdown, Yield curve, Estimate range, Monthly returns and Correlation, alongside carried Bullet and Waterfall. Offer/select a type only with compatible fields, otherwise explain the missing fields. Existing linked charts retain their saved type and behavior.

The source table owns symbols, acquisition date bounds, filtering and selection. The chart owns field bindings and recipe-specific options. To compare multiple symbols, acquire them in one multi-symbol historical-price table; no cross-widget join or portfolio subsystem is introduced. Chart settings cannot expand acquisition bounds. Each figure identifies its source, delivered date bounds and freshness. User filters deliberately narrow the question and remain visible as source scope.

Recipes request only columns the source presents, through the existing executor/chart-data seam. Hidden or removed required fields produce a repair message, never a hidden fetch. Analytical history recipes require raw daily observations, not grouped/pivoted/aggregated price rows. Bullet and waterfall retain their distinct existing source contracts.

For the new history recipes, `partial`, `paged`, `sample` and `unknown` acquisition completeness refuse calculations and explain that the source must be fully loaded. `complete` and an explicitly documented `bounded` acquisition are accepted for the delivered scope; bounded is not evidence of lifetime history. A table's presentation row count or `presentation.scope=presented` is not proof of acquisition completeness. Preserve upstream completeness and provenance through the executor. If a required completeness fact is absent, refuse instead of inventing it. Provider route metadata/transport may need a minimal addition to communicate an acquired window, but charts do not change fetcher records merely to fit rendering.

Every result is a pure derived result with figure, notes/refusal and revision information. Calculate history transformations in the existing worker/executor path to avoid blocking React. Use Plotly rendering, resize observation, theming, escaping and purge behavior already present. Native backend figures remain unaffected.

### Persistence and validation

Keep old `LinkedChartSettings` fields and defaults. Add the five recipe discriminants and an optional versioned recipe-options object; absent means legacy behavior. The implementation plan may choose exact names, but options must include explicit date/price/symbol bindings for history, maturity/rate/date bindings for curves, range metric bindings, a monthly-return symbol, and correlation lookback/minimum overlap. Unrecognized versions/types/invalid bounds fail import with an actionable message, never silently render as a line.

No executable expressions or Plotly JSON enter saved options. Validate settings at import and before execution. Preserve optional settings through persistence/export. Switching types discards incompatible options, including bullet `period` and waterfall-only settings, and preserves source linkage. Include recipe version, options, source output revision and theme/format dependencies in recomputation. Keep zoom for the same question on refresh; a changed source, symbol, window, field binding or recipe resets it. Bullet retains its existing fresh-draw exception.

### Provider and packaging ownership

openbq-eodhd owns normalized prices, yields, fiscal identity, the guarded reported-quarter join and units. BDOBB owns drawdown, returns, correlation, ordering and figures. No provider dependency on Plotly.

The existing bullet design was implemented in openbq-docker's vendored provider. Reconcile that implementation into standalone openbq-eodhd as canonical source, then regenerate/update the v9 vendored copy using the repository's existing packaging procedure. Do not maintain two independently edited algorithms. Check the actual import/package names on the v9 line before porting; older snapshots use `openbb_eodhd`, newer work uses `openbq_eodhd`.

The paired docker deliverable includes provider/widget registration and an importable v9 example dashboard with source tables and linked cards. Secrets stay in existing credential plumbing, never dashboard files. No public push, merge, deployment or later-release carry is authorized by writing this design.

## Financial definitions and interactions

### Drawdown

Input: one or more identified symbols with daily date and strictly positive finite `adjusted_close`. A single-symbol source may omit symbol only when provenance unambiguously identifies it. Sort by date within symbol. Conflicting duplicate symbol/date observations refuse that series; identical duplicates may collapse with a note. Null/nonpositive prices are gaps and counted in notes; never connect a return across a known missing observation.

For valid prices P, running peak H is the maximum valid price at or before that date within delivered history; drawdown is P/H - 1. The first valid observation is zero. Draw a filled scatter series below zero and format fractions as percentages. Gaps remain visible; peak state may persist across a gap but no line bridges it. Label **Drawdown from peak in loaded history**, with actual bounds. Do not offer an all-time label in v9. Multi-symbol lines get stable symbol colors and separate peak calculations.

### Yield curve overlays

Input: normalized long rows (`date`, `maturity`, `rate`) from YieldCurve. Use the route's existing comma-separated as-of dates on the source table. Distinct returned observation dates are the overlay series; never present a requested weekend date as an observed date. If several requests resolve to the same observation, draw that observation once and note the resolution when request metadata allows it.

Map maturity codes to numeric months (1, 2, 3, 6, 12, 24, 36, 60, 84, 120, 240, 360 for currently exposed standard slots), rather than alphabetical order. Place them on a numeric tenor axis with readable labels. Keep missing tenor slots as gaps; unknown maturities are omitted with a note. Rate fractions remain fractions and use percent formatting. Do not multiply the provider's already normalized fraction twice. Conflicting duplicates refuse the affected curve.

### Estimate-range dumbbell

Use the same guarded reported-quarter table as bullet. Show one row per fiscal quarter and one selected metric (EPS or revenue); low/high markers linked by a horizontal segment and a distinct average marker. Fiscal label and period-ending date come from the provider, never from a guessed calendar quarter. If fiscal identity is unavailable, label by the explicit period-ending date and note that fiscal quarter is unavailable; do not fabricate FQ labels. Sort chronologically regardless of table display order.

Only a provider-approved finite range with low <= average <= high is drawn. Null/withheld/invalid bands get a named note and no connector; never substitute zero or draw a range from another period. Other valid periods remain visible. If none qualify, clear the plot and show the reason. Negative EPS ranges are legitimate. EPS and revenue never share an axis. This chart displays ranges associated with reported quarters, not a historical time series of estimate revisions and not a point-in-time backtest.

### Monthly-return heatmap

Input: one selected symbol from raw daily adjusted-price history. Choose the final valid trading close of each calendar month. Return for month m is last_close(m)/last_close(m-1)-1. A valid preceding calendar month's close is required; do not bridge an absent month. The first observed month without a prior close is blank. A missing price at a required endpoint makes the cell unavailable; a prior month's earlier valid value cannot silently replace a known missing final endpoint.

Rows are calendar years, columns January through December. Exclude the current calendar month from completed-month calculations; show it as blank/incomplete. Source `end_date` and acquisition bounds must cover the calendar month-end to label an older month complete. Otherwise label its cell incomplete. Show missing, incomplete and observed zero distinctly in hover/status. Color is diverging around zero with symmetric limits derived from valid displayed cells. Hover shows month, endpoint observation dates and return. No annualization or arithmetic average of daily returns.

### Watchlist correlation

Input: at most 25 selected symbols in one raw daily adjusted-price source. Author default: trailing 252 return-date positions ending at the earliest of the selected symbols' latest delivered dates, with at least 60 matched daily return observations per pair; the user may set lookback and minimum overlap within validated positive integer bounds (minimum overlap >= 3 and <= lookback). Acquire/select at least 253 daily closes to obtain 252 ordinary daily returns when coverage permits; show the actual available count if fewer arrive. Use the union of delivered return dates at or before that common end to define the trailing positions, then pairwise matching within that window. Defaults do not imply data outside the acquired window.

Compute simple daily returns within symbol before aligning symbols. Do not forward-fill prices. For cross-symbol matching use common calendar dates; exclude returns crossing a known missing observation. Use pairwise complete observations, publish each cell's N, and explain that pairwise correlations may not form a positive-semidefinite covariance matrix. No covariance/optimization output is promised. A constant series, insufficient N or nonfinite result yields an unavailable cell, not zero. Diagonal is 1 only for a series with sufficient nonconstant observations. The matrix is symmetric with a fixed [-1, 1] diverging scale. Hover names both symbols, actual paired bounds, N and r. Reject sources that cannot establish the daily interval/identity. Weekends are not missing observations; an exchange-calendar dependency is not introduced. Disclose that unreported provider gaps cannot always be distinguished from market holidays.

## Integration of existing work

### Bullet

Reuse `2026-11-15-linked-chart-bullet-estimates-design.md` and the implementation at bdobb `baf9ed7d` as inspected; these are integration inputs, not proof that all current tests pass. Preserve quarter selection, *_actual metric grouping, sibling columns, format precision, missing actuals, consensus fallback, band notes, previous available quarter by period-ending date and the indicator redraw fix.

Port the guarded provider join with its recorded fixtures and cache policy. Its inspected model key is `EarningsVsEstimates`, mounted at `/equity/estimates/earnings_vs_estimates` beneath the EODHD router. The inspected docker implementation is `1982719`, with model `models/earnings_vs_estimates.py`. Preserve its explicit separation of quarterly versus annual Trend rows, reported EPS basis, revenue source, fiscal labels and withholding of all Trend-derived fields when the EPS consensus guard fails. The existing 10% guard is a documented heuristic, not proof of historical correctness; retain its status/note in the table and both charts. Preserve its no-estimate and zero/missing-consensus handling. No new live calibration is required for design approval. HistoricalEps alone is not the complete bullet data contract.

### Waterfall

Reuse the reviewed v4 implementation at `78219efe` and its statement-template dependencies. Carry the linked composition prerequisite (pie, percent display and rows/columns orientation) only as needed to integrate the existing branches; these are integration dependencies, not a separate new chart project.

Waterfall consumes typed income-statement rows and period columns, not arbitrary numeric tables. Preserve statement-owned row roles, period validation, expense-as-decrease behavior, signed values, subtotal resets, refusal of EBITDA in the walk, missing-value notes and explicit **Other** reconciliation steps. Never hide a residual to make the bridge balance. Verify expense sign conventions against provider fixtures, including negative expenses, losses and multi-period statements. A filtered statement can show an explained Other step; the chart must identify that it represents lines not shown.

### Plotly bundle

Retain scatter/candlestick/bar/heatmap; carry pie where required by the linked composition prerequisite; add only indicator and waterfall for this scope. No full Plotly bundle, new visualization dependency or version upgrade. Update the native-figure trace allowlist from the actual registered trace set and test every added module. Existing bullet uses indicator rather than a scatter imitation. Measure production bundle growth against the release/v9 baseline; report it in review.

## Delivery order and acceptance

1. Reconcile release/v9 against the linked composition, bullet, guarded provider and waterfall branches; record dependency commits and avoid carrying unrelated branch changes.
2. Land the provider contract and packaging updates in local reviewable changes, with recorded-fixture tests.
3. Integrate bullet and waterfall with the union of settings/import rules and trace registrations.
4. Add the worker recipe contract and the five new recipes, controls, persistence and notes.
5. Add the example dashboard, help and release notes; validate the paired v9 stack.

This sequence is a design dependency order, not the implementation plan. After user approval, use Superpowers writing-plans to produce tasks with exact paths, commits and commands.

Acceptance tests must establish financial behavior, not merely mirror trace objects:

- Known drawdown series including a new peak, multiple symbols, gap and nonpositive price.
- Yield ordering, normalized units, weekend fallback, missing tenor and duplicates.
- Guarded and withheld fiscal Q4 ranges, negative EPS and separation from annual estimates.
- Month-end compounding across a year boundary, absent prior month, incomplete end month, zero return and a known missing endpoint.
- Correlation for identical/opposite/constant returns, pairwise missing observations, insufficient N, symmetry and incorrect grouped input.
- Bullet regression fixtures and waterfall reconciliation/sign/template fixtures carried with their implementations.
- Saved/imported options, legacy dashboard behavior, changed source field repair, stale refresh versus refusal, worker revision isolation and completeness refusal.
- Browser verification of all seven charts in light/dark themes, resized cards, refresh, source filtering, export/import and source removal. Include missing-data cases, not only happy-path screenshots.

Run the BDOBB line's existing frozen install, typecheck, lint, test:run, scrub and test:web checks, plus build and targeted browser checks. Run the provider's pytest suite and router/widget pin tests, then docker packaging/pin checks appropriate to the actual v9 layout. Existing tests are not assumed to pass until executed during implementation. No test results are claimed by this design-only change.

## Constraints and builder discretion

Use the actual v9 release baseline for implementation, with isolated worktrees and a codex/ branch, not the working article repository. The document is stored beside the existing bullet design in its clean v9 worktree; committing it does not merge that branch into a release. Verify relevant AGENTS.md and current release state again when implementation begins. Do not carry to other release lines or push publicly without subsequent authorization.

The builder may settle exact module names, option keys, worker message plumbing, control arrangement, palette and fixtures while preserving these contracts. Reuse existing formatter and percent metadata transport. Cap displayed diagnostics using existing list conventions while retaining counts. Add no broad chart DSL or cross-source join framework. Any discovery that requires new data acquisition, removes one of the seven deliverables or changes the financial definitions returns for design review.

## Evidence and related designs

- User's scope approval in this chat, 2026-11-19.
- Reference PDF: `/Users/artcashin/Downloads/BDOBB-chart-suggestions.pdf`, read in full during analysis.
- BDOBB release/v9 `src/lib/plotly.ts`, verified via GitHub during analysis; local remote snapshot `a96b9619`.
- BDOBB linked composition design: `2026-11-14-linked-chart-composition-design.md`.
- BDOBB bullet design: `2026-11-15-linked-chart-bullet-estimates-design.md`; inspected implementation `baf9ed7d`.
- Waterfall implementation: v4 worktree `78219efe`, `src/lib/widgetData/waterfallFigure.ts`.
- openbq-eodhd inspected snapshot `5341fbf`: `models/equity_historical.py`, `models/treasury.py`, `models/estimates.py` and router/registry.
- Plotly primary documentation: https://plotly.com/javascript/line-charts/ and https://plotly.com/javascript/bubble-charts/ (reviewed during initial analysis).

## Design review

Independent builder check completed 2026-11-19. The reviewer requested an unambiguous correlation window; the design now specifies a common end, a shared union-date lookback and pairwise matching within it. On rereview: "nothing important left". User approval of this written document is still required before the implementation plan.
