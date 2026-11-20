# Estimate-revision slope and bump charts specification

Date: 2026-11-19. Status: **User approved specification, plan and subagent implementation on 2026-11-19; final independent review required.**

The user requested combining the three suggested families with the five other remaining candidates. Definitions and defaults were proposed by the author and approved by the user for implementation planning on 2026-11-19. Read the [common roadmap](2026-11-19-v9-next-eight-charts-design.md) with this specification. Existing approved three-chart implementation remains separate.

## Question and variants
How did consensus EPS or revenue for the **same target fiscal period** change across actual recorded consensus snapshots? Slope mode compares two selected acquired vintages for the same issuer/metric/target period. Time-path mode connects at least three vintages. Bump mode ranks comparable issuers at each vintage and is enabled only with a documented ranking universe and metric comparability.

## Evidence and important current gap
The current AnalystEstimates adapter maps Earnings.Trend.date to date and exposes EPS/revenue low/average/high; it does not establish independent estimate observation vintages. Rows for different target fiscal periods are not revisions. An earlier calendar date is not evidence that a later consensus value was available then. Never relabel target-period history or 7/30/60/90-day change fields as independently acquired snapshots.

Require acquisition-bound issuer, metric, target fiscal end/kind, observed_at/vintage, consensus value, unit/currency/share basis, and source contract proving the vintage meaning. Accept a separately acquired explicit snapshot history with matching declarations. Capturing and storing new recurring snapshots is a separate persistence/scheduling design, not a hidden chart side effect. No snapshot automation is created by this specification. Historical data rights and accessible interval require verification; no PDF entitlement claim is accepted as authority.

## Calculation and semantics
Compare the identical target end/kind between vintages; quarterly/annual/TTM observations cannot mix. Signed change is later minus earlier, original units shown. Percent change is optional only when earlier value is strictly positive; negative/zero prior consensus shows signed absolute change and an unavailable percentage, not a misleading growth rate. A missing vintage yields an explicit gap. Conflicting duplicate identity/target/vintage refuses; exact repeats can collapse with a disclosed count.

Bump ranks descending by the dimensionless percentage revision defined in the proposed eligibility section, with equal values tied at competition rank (1,1,3); stable qualified identity ordering is only for layout. Require the same declared universe and exact target-period coverage across vintages; a changing delivered screener page does not qualify. Nominal EPS/revenue-level ranking is excluded. The initial implementable scope is slope/time-path; bump stays disabled absent the stronger source facts.

## Rendering and acceptance
Reuse scatter lines/markers, original consensus units and explicit vintage/target labels. Persist metric, target period, variant and acquired vintages; do not fetch history. Test target-date-as-vintage refusal, true revisions, restated snapshots, annual/quarter mismatch, zero/negative baseline, unit/class conflicts, gaps, ties, changing universe and actual hover/status. Readiness: current endpoint alone is insufficient; verified vintage source is a hard prerequisite.

## Proposed bump eligibility

When a future verified source enables bump mode, rank **percentage consensus revision from one explicit common baseline batch**, not nominal cross-issuer EPS or revenue levels. All members must have strictly positive baselines, the identical actual target fiscal start/end/kind, the same baseline and current snapshot batch, and stable declared universe membership. No fuzzy observation-time window or issuer-specific fiscal mapping. One missing/ineligible member makes that entire rank column unavailable; do not rank a changing subset. Percentage revisions use the same metric and within-issuer currency/share basis at both vintages. Competition ranks handle ties. Slope/time-path remains usable for negative baselines via absolute signed changes; bump stays disabled without these stronger facts.

The user approved this specification for implementation planning on 2026-11-19. The user approved the plan set for subagent implementation and independent final review on 2026-11-19.
