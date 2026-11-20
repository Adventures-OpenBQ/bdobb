# ETF composition sunburst specification

Date: 2026-11-19. Status: **Draft proposal for user review; not implementation authorization.**

The user requested combining the three suggested families with the five other remaining candidates. Definitions and defaults below are author proposals, not prior user decisions. Read the [common roadmap](2026-11-19-v9-next-eight-charts-design.md) with this specification. Existing approved three-chart implementation remains separate.

## Question and scope
How are the delivered holdings of one acquired fund distributed across sectors? The initial hierarchy is fund→sector→holding using the **same holdings acquisition**. This is a holdings snapshot, not portfolio look-through, issuer exposure consolidation or a whole-fund sector map reconstructed from incompatible sources.

## Source and hierarchy
The existing holdings adapter exposes holding identity, weight and sector; use its verified fund-assets fractional basis, acquisition date/vintage and coverage evidence. Root and sector values are derived from included holding leaves. Do not graft EtfSectors equity-exposure percentages onto fund-assets holding weights; those bases can differ, and their separate current endpoints are not proof of matching snapshots. Region data remains region data and is excluded from this initial hierarchy.

Preserve fund identity separately from constituent identities. Missing holding sector becomes **Sector unavailable**; it does not trigger per-holding fundamentals lookups. Exact duplicate holding identities need the established acquisition duplicate policy; conflicting weights/classifications refuse. Finite nonnegative weights are required; zero leaves can remain in accessible summary without a zero-area wedge. No absolute-valuing negative exposures or normalizing delivered weights to 100%.

For partial/top-N/unknown coverage, title and root summary explicitly identify delivered holdings and total observed fund weight. An **Unallocated/not delivered** wedge requires independently evidenced common denominator and missing mass; do not call the residual cash or non-equity. Without that proof omit the residual wedge and state that the sunburst shows only delivered holdings. Complete whole-fund claims need explicit coverage. Filters disclose visible versus acquired weight; hiding a leaf must not recertify completeness.

## Controls and rendering
Persist fund, hierarchy depth and either follow-latest or an explicit pinned snapshot coordinate; resolved latest coordinates remain runtime facts; click/tap drills within the acquired tree only. Add only sunburst trace module when this family is authorized. Stable typed node IDs prevent identical sector/holding labels colliding. Hover shows original fund weight, delivered-root percentage clearly distinguished, fund and date. Accessible text lists exact original weights for wedges too small to inspect. Reuse fixed financial evidence/linked lifecycle rules, with tested home/root navigation.

## Acceptance and readiness
Test partial holdings and honest root labels, incompatible sector-feed basis refusal, sector-null bucket, duplicate/conflicting leaves, negative/zero weights, root-parent-child conservation, source filters, unknown denominator, no normalization, drill/reset and actual narrow/touch hover. Readiness: holdings-only hierarchy is feasible using existing fields, subject to preserving raw classification/weight contradictions before normalization; no general ETF look-through dependency is introduced.

## Proposed total-weight admission

This is an unlevered, long-only fund-assets composition view. Reject a delivered positive-weight total above 1 beyond source rounding; leveraged/gross-exposure totals need a separate design, even if nonnegative. An explicitly complete root must total 1 within the sum of independently declared rounding bounds capped at 1e-4 fraction; when no rounding precision is declared use 1e-12 cancellation tolerance. A complete root outside that bound refuses. Partial/unknown roots below 1 remain delivered-only roots, not complete compositions. Preserve original totals and disclose admitted rounding; no correction to leaf values, normalization or artificial cash wedge.
