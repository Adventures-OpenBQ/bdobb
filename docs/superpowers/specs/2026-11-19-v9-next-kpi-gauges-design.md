# KPI cards and gauges specification

Date: 2026-11-19. Status: **User approved for implementation planning on 2026-11-19; not implementation authorization.**

The user requested combining the three suggested families with the five other remaining candidates. Definitions and defaults were proposed by the author and approved by the user for implementation planning on 2026-11-19. Read the [common roadmap](2026-11-19-v9-next-eight-charts-design.md) with this specification. Existing approved three-chart implementation remains separate.

## Question and reuse
Display one explicitly selected, acquired numeric metric with units, issuer/series identity and as-of/vintage; add a gauge only when an explicit meaningful range or target is supplied. Reuse and extend MetricRenderer for ordinary headline values rather than create a competing metric-card system. Plotly indicator is already registered for bullet charts; do not add a new module/vendor for this family.

## Selection and evidence
The existing metric renderer accepts value/label/delta or the first row of a list. New linked KPI selection must require exactly one selected identity/observation/metric, not silently choose row zero of an arbitrary source. Bind the original numeric field and acquired unit; no formatted-string parsing or arbitrary metric formulas. Distinguish ratios, percentage points/fractions, currency, counts and multiples. A missing value is unavailable, zero is valid, and an errored/nonfinite value must not show a zero needle.

Show reported date separately from retrieval time; unknown as-of remains visible. An EPS metric retains share basis and period, a yield retains fractional unit, and currency facts are metric-specific. No common financial favorable/unfavorable color from sign alone. User display formatting cannot change acquired units or make the metric comparable with a target in different units.

## Gauge and delta semantics
Default view is a KPI card with no gauge and no inferred target. A gauge requires explicit finite min < max in the same units and a saved visible basis label (user range or acquired contract). Zero need not be the minimum. A value outside range is shown exactly in text plus an out-of-range state; do not clamp it to an apparently valid endpoint. User thresholds are named user settings, not objective valuations or recommendations. No invented maximum from the current value.

Delta is optional and requires an explicit comparable prior observation or target binding. Signed absolute delta is current minus reference; percentage change only when reference is strictly positive. Never fetch the prior value or infer a prior fiscal period from table order. Persist bindings/view/explicit range and target choices, never runtime units or source certification. Existing generic metric payload compatibility is retained.

## Acceptance and readiness
Test one-row versus ambiguous many-row input, true zero/missing/cell error/nonfinite values, fraction formatting exactly once, metric date/currency/period mismatches, negative baseline, invalid/exceeded ranges, target unit conflict, stale/error notices, import tampering and real narrow/touch/accessible rendering. Readiness: metric renderer and indicator module exist; typed source-bound metric units and reference comparisons need extension before automatic presets.

## Proposed initial metric and reference set

Limit linked presets initially to verified last price, market capitalization, dividend yield, trailing P/E, trailing EPS and trailing revenue, using the canonical source fields price, market_cap, dividend_yield, pe_ratio, eps_ttm and revenue_ttm. A field name is a candidate, never proof of units/identity/period. No generic arbitrary numeric-field preset or user formula in the first slice. The existing generic MetricRenderer payload contract remains compatible.

Reference choices are another explicitly selected acquired observation of the **same metric** or a clearly labeled user-entered target in its verified units. Same-metric comparisons require stable issuer/listing/class, unit/currency, and adjustment basis. EPS/revenue references initially compare different acquired vintages of the identical reporting period/basis; prior fiscal-period and analyst-target joins are excluded. Price/market-cap/yield/P-E observation-date comparisons retain both dates and any available measurement-vintage caveat. The user target is an assumption, never an acquired consensus. No automatic previous-row delta or implied favorable direction.

The user approved this specification for implementation planning on 2026-11-19. Product implementation awaits review of the plan set.
