# Ownership snapshot and waffle specification

Date: 2026-11-19. Status: **User approved for implementation planning on 2026-11-19; not implementation authorization.**

The user requested combining the three suggested families with the five other remaining candidates. Definitions and defaults were proposed by the author and approved by the user for implementation planning on 2026-11-19. Read the [common roadmap](2026-11-19-v9-next-eight-charts-design.md) with this specification. Existing approved three-chart implementation remains separate.

## Question and honest view modes
What ownership and float measures does one acquired issuer snapshot report? Default to separate labeled bars for insider ownership, institutional ownership and free float. These are independent measures, not a partition of the same shares. Show units, source date and retrieval time. This family includes the PDF's waffle only when a source explicitly certifies mutually exclusive exhaustive buckets with a common denominator.

## Data and comparability
The current ShareStatistics adapter exposes outstanding_shares, float_shares, free_float, percent_insiders and percent_institutions. It calculates free_float in percentage points; it currently does not establish that all ownership fields share an as-of date or partition. Preserve qualified issuer and field-specific unit/date provenance. Convert percentage points to fraction exactly once under a canonical field contract; no magnitude guessing. Do not assume a general UpdatedAt value is a measurement date for every field. Unknown observation dates remain unknown and visible.

Bars require finite source percentages in [0,100] or verified fractional equivalent. Zero is observed; missing is unavailable. Do not stack insiders + institutions + float, subtract them from 100, or label a remainder as retail. Do not combine issuer classes or venues from bare ticker matching. Optional float/outstanding count comparison needs matching share class, basis, date and count units; otherwise withhold that ratio.

## Waffle admission and geometry
Waffle is disabled for ordinary current ShareStatistics data until an acquired partition contract proves mutually exclusive buckets, exhaustive common denominator and consistent snapshot/class. A custom acquired partition may qualify under the same checks. Use 100 cells, allocate counts by largest remainder with deterministic canonical-key ties, disclose 1% cell granularity and retain exact source percentages in text/hover. Never force an incomplete partition to 100 by normalization. A rounding-sized discrepancy may be disclosed under a pinned tolerance; a genuine unallocated share is explicit only when coverage certifies its meaning. Individual categories above 100%, negatives and conflicting duplicate categories refuse.

## Controls and acceptance
Persist issuer and bars/waffle choice, not partition certification. Use existing bar/scatter primitives; no new vendor or module is expected. Waffle refusal keeps repair guidance and explains the overlap issue. Test overlap, float denominator, institutional/insider units, unknown/mixed dates/classes, true zero, sum mismatch, 33.3/33.3/33.4 allocation, ties, narrow layout, touch and accessible exact values. Readiness: independent bars need unit evidence; real-data waffle remains gated on a partition contract, not enabled by an optimistic UI toggle.

## Proposed partition rounding limit

For an otherwise independently certified exhaustive waffle partition, accept only total-rounding error bounded by the sum of acquired per-category rounding bounds and capped at 0.01 percentage point. Without declared rounding precision use 1e-10 percentage point for cancellation only. Show exact original percentages and the total discrepancy. Largest-remainder allocation fills the 100 visual cells as an explicitly approximate display; it does not rewrite the source shares or manufacture a remainder category. Totals outside tolerance refuse waffle. Independent bars remain available when their own units/identities are valid.

The user approved this specification for implementation planning on 2026-11-19. Product implementation awaits review of the plan set.
