# Dual-axis historical overlays specification

Date: 2026-11-19. Status: **User approved specification, plan and subagent implementation on 2026-11-19; final independent review required.**

The user requested combining the three suggested families with the five other remaining candidates. Definitions and defaults were proposed by the author and approved by the user for implementation planning on 2026-11-19. Read the [common roadmap](2026-11-19-v9-next-eight-charts-design.md) with this specification. Existing approved three-chart implementation remains separate.

## Question and initial closed recipes
Show **Adjusted closing price and reported diluted EPS** for one issuer, or **CPI and ten-year Treasury yield** for one explicit market/economy series pair. These are two named questions, not an arbitrary metric/axis editor. Each axis names its own unit and scale. Overlay proximity is not a correlation estimate or causal claim.

## Acquisition and alignment
The chart consumes one explicitly prepared, acquired overlay table. Preparing that table may use a separately reviewed table-level join; the chart must not secretly fetch a second endpoint or align unrelated sources. Preserve each series' acquired identifier, unit, currency where applicable, source date, timestamp meaning, vintage and omissions. The implementation plan must identify the concrete preparation route and prove its joins. Two compatible independent cards alone do not certify an overlay.

Price is the adjusted-close series already supported. EPS is a reported diluted EPS observation associated with a fiscal period and actual announcement/availability date. Plot it at the actual report availability date as discrete markers by default, retaining fiscal period in hover. Do not plot EPS at fiscal period end as if it were known then, substitute analyst estimates, or extend a reported value into future dates. Restatement/known-vintage limits must be visible; no point-in-time backtest claim.

For CPI/yield, preserve level/index basis and yield fraction/percent conversion as separate units. Plot monthly CPI at its measurement coordinate with release-date provenance; absent availability facts prohibit an information-timing interpretation. Do not forward-fill CPI to daily rows or interpolate a false daily series. Each series retains its own coordinates and gaps; no zero filling or duplicate-date averaging.

## Axes and interaction
Two linear y axes, left/right labels and units always visible, distinct line/marker patterns, no automatic zero-based ratio normalization and no log axes initially. Worker auto-ranges each independently; changing either scale can change apparent relationship, disclosed in help. Persist only the closed recipe and compatible bindings; no user-authored formula or third series. Use existing scatter/bar as appropriate; no new module expected.

## Acceptance and readiness
Test missing report dates, fiscal versus report date, different calendars/frequencies, explicit gaps, adjusted-price basis, split/restated EPS basis, date-only versus timestamp identity, multiple issuers, missing unit/currency facts, duplicate conflicts and actual two-axis labels/hover at narrow/touch sizes. Readiness: data acquisition/join and availability-date proof are a prerequisite; do not ship a chart that appears sound only on hand-aligned fixture rows.

## Proposed first-source definitions

The equity overlay initially supports actual fiscal-quarter (FQ) diluted EPS only, with verified matching issuer/listing, reporting/quote currency and current split-adjusted share basis. No annual, TTM, basic EPS or ADR conversion fallback. If HistoricalEps does not prove diluted/current-share basis, it is not eligible merely because it has an eps_actual field. A currently acquired restated value may appear at its original announcement coordinate only with an explicit **currently restated; not historical as-known** label and retrieval vintage; original-vintage backtesting remains excluded. Conflicting versions within a snapshot refuse rather than invent a revision sequence.

The macro overlay initially names US CPI for all urban consumers, all items, seasonally adjusted, index basis 1982–84=100, versus the US nominal ten-year constant-maturity Treasury yield. These descriptive series definitions are proposed scope; exact authoritative series identifiers, endpoint support and yield units must be pinned before implementation planning. There is no arbitrary country/index/real-yield selector in this first slice. If either precise series is unavailable, return for scope review rather than substitute another CPI/yield.

The user approved this specification for implementation planning on 2026-11-19. The user approved the plan set for subagent implementation and independent final review on 2026-11-19.
