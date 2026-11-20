# Next eight chart families: proposed specifications

Date: 2026-11-19. Status: **Draft specifications requested; independent builder check complete; user approved for planning on 2026-11-19.**

## Scope and purpose

Combine the three recommendations (news-sentiment calendar, return box/violin, ownership snapshot) with the five remaining candidates (dual-axis overlays, estimate-revision slope/bump, market-map treemap, ETF composition sunburst, KPI cards/gauges). Each row is one family, not a promise that every variant can ship with today's data. Box and violin are one family; slope, time-path and bump are one family. The user has authorized implementation planning for all eight. Product implementation, subscription changes, historical snapshot collection, PR publication and deployment remain unauthorized.

The approved bubble/dividend/Sankey project continues separately. Its branch status and verification do not establish readiness for any new family. User requested specifications on 2026-11-19; all defaults, order and constraints below are proposed by the author.

## Approach and boundaries

One continuation fits the existing product: source tables own acquisition and explicit preparation, linked worker recipes own analytics, existing renderers own presentation and lifecycle. Reuse the current Plotly runtime; add only modules required by an authorized family and measure their bytes. Backend-generated figures duplicate presentation logic; an unrestricted chart editor/metric store would be a larger project and is outside these eight specifications.

The families are separate work packages with separate readiness gates and implementation plans. Their combined roadmap is not a single giant release commitment. Do not let one missing upstream contract silently change a chart's financial question or block unrelated ready families.

| Order proposed | Family | Readiness gate |
| --- | --- | --- |
| 1 | [News-sentiment calendar](2026-11-19-v9-next-news-sentiment-calendar-design.md) | Typed news identity/polarity evidence |
| 2 | [Return box and violin plots](2026-11-19-v9-next-return-box-violin-design.md) | Existing price pipeline; statistical definition pinned |
| 3 | [Ownership snapshot and waffle](2026-11-19-v9-next-ownership-snapshot-design.md) | Bars feasible; waffle requires partition proof |
| 4 | [Dual-axis historical overlays](2026-11-19-v9-next-dual-axis-overlays-design.md) | Explicit joined source and availability dates |
| 5 | [Estimate-revision slope and bump charts](2026-11-19-v9-next-estimate-revisions-design.md) | True consensus vintages unavailable in current adapter |
| 6 | [Market-map treemap](2026-11-19-v9-next-market-map-design.md) | Verified membership/weights for named-index mode |
| 7 | [ETF composition sunburst](2026-11-19-v9-next-etf-sunburst-design.md) | Holdings-only hierarchy; retain partial scope |
| 8 | [KPI cards and gauges](2026-11-19-v9-next-kpi-gauges-design.md) | Reuse metric renderer; require typed metric/range |

## Shared requirements

- One linked source presentation per recipe. Explicit table-level preparations may combine acquired inputs only with reviewed join, date, unit, identity and completeness contracts; no chart-specific hidden downloads.
- Qualified instrument/fund/series identity, actual observation coordinates, unit/basis, coverage and retrieval facts are acquired runtime evidence. Settings and edited draft parameters cannot grant proof. No FX, entitlement or historical-vintage inference.
- Validate raw contradictions before dropping rows or fields. Preserve unsafe facts and coordinate-only omission evidence through TypeScript, compiled Rust and linked descendants. No hidden numerical values carried to recover a filtered component.
- Zero, missing, no events, unscored, invalid and failed acquisition are distinct. Filters and query/page limits are visible scope. No partial-to-complete promotion or undisclosed normalization.
- Closed versioned settings; explicit compatible bindings and safe defaults. No executable Plotly JSON or runtime certification in saved settings. Import reacquires and revalidates. Incompatible draft keeps the applied chart; invalid applied configuration clears with repair guidance.
- Source relinks clear old results. Same-source failures may retain output with one stale source alert. Current worker/draw errors remain visible; obsolete replies are fenced. Source/fields/identity/period/analytical-choice changes reset the question revision; viewport geometry does not.
- Escape labels/hover and bound diagnostics. Provide textual original values, counts and scope. Support light/dark, narrow, keyboard and actual touch inspection; preserve fitting-plot zoom and overflow-only scrolling. Never infer correctness from figure JSON without checking actual installed Plotly rendering.
- Keep provider normalization canonical; Docker vendors exact verified commits/hashes. Additive endpoint changes must preserve legacy behavior and expose actual HTTP envelope facts. No assumptions that PDF source or entitlement claims still hold.

## Proposed delivery grouping

Start with individually scoped news calendar and return-summary views; ownership bars and KPI cards can follow after unit contracts are pinned. Holdings-only ETF sunburst is a separate hierarchy project. Dual-axis preparation, real estimate-vintage history and named-index membership/weights are evidence-dependent projects; write and review their source contracts before promising the final charts. This is an order proposal, not an instruction to start implementing.

## Explicitly still deferred

ETF overlap UpSet and active-weight comparisons require look-through/benchmark work; radar, scatter matrix and parallel coordinates require a metric/universe store; efficient frontier requires portfolio arithmetic and its own financial design. They are not included in these eight. Options surfaces, country choropleths from region data, fund-flow streamgraphs and segment-revenue treemaps are not made feasible by this roadmap. Candlesticks are already present and vendor consolidation remains separate.

## Validation and approval

Each family specification names its own admission, calculation, refusal, rendering and acceptance requirements. Before planning a family, resolve any declared readiness gate with authoritative source evidence and representative captures; fixtures alone do not prove live availability. Implementation plans must pin option types, source contracts, exact algorithms/modules, affected tests, real browser scenarios, baseline/candidate bundle bytes, canonical/vendor pins and independent review.

A fresh builder check will assess whether these drafts are concrete enough for scoping and identify unresolved product decisions. The user approved the written designs for planning; review of the resulting plans selects the first implementation group before product work begins. No new chart work starts merely because these files exist.

## Evidence inspected

The local `BDOBB-chart-suggestions.pdf` (2026-11-18) supplies the inventory; its instructions and build order are reference material. Code inspection covered provider `news.py`, `profile.py` ShareStatistics, `estimates.py` AnalystEstimates, `index.py`, `etf.py`, the existing MetricRenderer and the current linked-chart/evidence stack. Current inspection confirms a sentiment object, ownership measures, holdings-sector fields and metric/indicator rendering; it does not establish a true estimate-vintage store, exhaustive index membership or ownership partition.

## Proposed selection and refresh policy

Snapshot views (ETF, market map, ownership, KPI) default to follow the latest compatible **acquired** observation. The news default follows the newest acquired date and its trailing 12-month display window. Explicit observation/window choices pin actual coordinates; if those disappear on refresh/import, clear with unavailable-selection repair guidance, never silently substitute or fetch history. Estimate comparisons always pin explicit vintages and target periods. A follow-latest resolution changing the observation changes the semantic revision. Refresh never creates a historical archive. These are proposed product defaults for review.

## Builder-check dispositions

The initial independent builder check raised seven substantive questions. The drafts now propose explicit answers for selection/refresh, delivered-sample market maps, overlay series and share basis, aggregate-weight tolerances, revision-ranking eligibility, return-window endpoints and the first KPI metric/reference set. These choices remain proposals for user review; the independent recheck assesses whether they are specific enough to plan, not whether live data prerequisites have been satisfied.

Independent builder check completed on 2026-11-19. Seven initial questions and three follow-up contract inconsistencies were addressed; the scoped recheck confirmed the drafts are ready for user review. This is specification readiness, not evidence that missing source capabilities exist or approval to implement.

The user approved this specification for implementation planning on 2026-11-19. Product implementation awaits review of the plan set.
