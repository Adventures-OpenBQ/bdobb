# Market-map treemap specification

Date: 2026-11-19. Status: **Draft proposal for user review; not implementation authorization.**

The user requested combining the three suggested families with the five other remaining candidates. Definitions and defaults below are author proposals, not prior user decisions. Read the [common roadmap](2026-11-19-v9-next-eight-charts-design.md) with this specification. Existing approved three-chart implementation remains separate.

## Question and default
What is the composition and delivered daily performance of a named equity universe? Use a sector→listing treemap; area is verified index weight for the named index mode, color is normalized one-session price change. A separate delivered-sample market-cap mode may use common-denomination capitalization, but its title must not claim S&P 500 membership or index weights.

## Required acquisition
One acquired hierarchy/table must bind qualified listing, stable sector identity, positive area value and its basis, normalized change, observation/session date and completeness; named-index mode additionally requires membership date and named universe. Current provider index.py has index discovery/history; this inspection did not identify an index-component weights feed. The PDF's component/weight claim is a prerequisite to verify, not an implemented capability. No hidden hundreds-of-symbol quote downloads, index reconstruction from a screener page or new subscription assumption.

A named index requires authoritative membership and weights for the same index/as-of basis plus a complete or explicitly bounded acquired snapshot. Sector joins and daily quote joins belong in an explicit source preparation contract, with missing matches disclosed. Qualified secondary listings are not issuer-deduplicated automatically. Do not replace index weight with market cap without changing recipe mode/title.

## Hierarchy and missing facts
Sector parent areas are derived from presented children, not duplicated as additional observed weights. Root totals describe the named index only when coverage certifies it; otherwise label delivered components and any independently evidenced unallocated weight. Never normalize partial holdings to a full index. Distinct same-date denominations refuse market-cap mode; no FX inference from a currency glyph. Missing performance uses a neutral **unavailable** fill distinct from exactly zero. Different sessions refuse a combined current-day color map. Unknown sector is an explicit delivered category, not a guessed classification.

## Controls, rendering and acceptance
Persist acquired universe/mode, sector drill level and either follow-latest or explicit snapshot/session pins. Resolve latest coordinates only at runtime. Fixed symmetric color bounds selected from the delivered sample are disclosed; common scale across comparisons must be explicit. Exclude nonpositive/invalid area with counts only when identity/basis safety is intact; zero-performance is valid. Add only the treemap module if used; use stable node IDs, readable small-cell text and accessible listing table with original areas/changes. No sunburst duplicate for this family initially.

Test partial/mislabeled index refusal, area sum conservation, missing sector/performance, raw hidden currency/session conflicts, duplicate membership, area basis switches, stale price versus membership dates, overflow, drill/reset, tiny cells and actual touch/hover. Readiness: index membership/weight contract is a hard prerequisite for named-index mode; delivered-sample mode must remain honestly named.

## Proposed first slice and date policy

A delivered-sample capitalization map may ship independently before named-index mode, after its own source contract is verified. A bounded screener page can supply area/sample facts, but only a prepared source with a verified **completed close-to-close trading-session return** can supply color; do not substitute intraday or unknown timestamp changes. Capitalization is the latest value returned in that one completed acquisition, not asserted historically measured at the price close. Show capitalization retrieval vintage and return session separately, as for the implemented screening bubble. Every color must identify the same completed session. An older separate area snapshot cannot be overlaid with a later session in this initial slice.

Named-index weights require their own membership/weight as-of date, displayed separately from the completed price session. The initial contract requires a weight snapshot valid for that session, with explicit evidence of validity; older weights do not silently roll forward. For complete weight roots require total fraction 1 within declared source rounding bounds, capped at 1e-4 (one basis point); absent declared rounding use cancellation tolerance 1e-12. Excess or shortfall outside that bound refuses complete mode. Root labels retain original totals and any admitted rounding discrepancy; no data normalization.

For a partial index snapshot, reject positive observed weights totaling more than 1 beyond the same declared-rounding bound (or 1e-12 without precision evidence). Partial coverage cannot justify an impossible over-100% net-weight root. This bound does not apply to market-cap mode, whose common-denomination areas are absolute monetary values rather than index weights.
