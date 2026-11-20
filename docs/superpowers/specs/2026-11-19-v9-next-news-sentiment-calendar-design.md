# News-sentiment calendar specification

Date: 2026-11-19. Status: **User approved for implementation planning on 2026-11-19; not implementation authorization.**

The user requested combining the three suggested families with the five other remaining candidates. Definitions and defaults were proposed by the author and approved by the user for implementation planning on 2026-11-19. Read the [common roadmap](2026-11-19-v9-next-eight-charts-design.md) with this specification. Existing approved three-chart implementation remains separate.

## Question and presentation
How did the sentiment of delivered company news vary by calendar day? One qualified instrument, daily calendar cells, neutral midpoint at zero, fixed polarity color domain [-1,1]. Show article count and scored count in each day's accessible summary. A missing day is distinct from a day with scored mean zero. Default to the acquired interval, capped to the latest 12 calendar months for readable display; the selector only narrows returned dates.

## Data and calculation
Consume one acquired CompanyNews table with article timestamp, stable article ID or canonical URL, instrument association and numeric sentiment polarity. The current provider preserves the sentiment object; add an explicitly typed polarity projection and evidence of its upstream range before enabling real data. Do not guess which nested score is polarity or rescale probabilities into polarity. UTC calendar day is the initial documented grouping rule; retain original timestamp on hover. Filter to the selected acquired instrument before grouping; a multi-symbol article counts once for that instrument.

Daily value is the unweighted arithmetic mean of valid article polarities, not a market mood score or trading signal. Deduplicate identical stable article identities; conflicting payloads for one identity refuse. Without stable identity refuse this recipe rather than count possible repeated pages. Zero is valid. Invalid/missing sentiment contributes to unscored count, not neutral. Invalid timestamps and ambiguous instrument identity refuse before projection. No-score days have an unscored state, with no numerical mean.

## Scope, controls and rendering
The initial view is explicitly **Delivered news sentiment**, not all news. Persist instrument and either follow-latest or an explicitly pinned calendar window; resolved default bounds remain runtime facts; retain acquired query, page/limit and retrieval time. A calendar gap says no scored articles delivered, not no news occurred. Mean and counts recompute from the same presented sample and expose filters. Acquired pre-drop diagnostics remain available. Use the registered heatmap trace with separate missing/unscored treatment and keyboard-readable day summaries; no additional trace module is expected.

## Acceptance and readiness
Test midnight UTC boundaries, leap day/year crossing, mean [-1,1], true zero, all-unscored, duplicate/conflicting articles, missing dates, hidden invalid facts, paged disclosure, multitag article counts, and actual cell hover/tap in light/dark/narrow layouts. A successful acquired empty interval needs truthful zero-delivery wording; errors stay errors. Readiness: existing provider has sentiment objects, but typed polarity, stable identity and pre-drop acquisition evidence need verification. No claim of exhaustive news coverage.

The user approved this specification for implementation planning on 2026-11-19. Product implementation awaits review of the plan set.
