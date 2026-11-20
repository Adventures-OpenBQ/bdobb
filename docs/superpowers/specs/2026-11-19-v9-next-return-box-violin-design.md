# Return box and violin plots specification

Date: 2026-11-19. Status: **Draft proposal for user review; not implementation authorization.**

The user requested combining the three suggested families with the five other remaining candidates. Definitions and defaults below are author proposals, not prior user decisions. Read the [common roadmap](2026-11-19-v9-next-eight-charts-design.md) with this specification. Existing approved three-chart implementation remains separate.

## Question and presentation
Compare the distributions of observed daily simple returns for up to 12 explicitly selected acquired listings. Box is the default view; violin is an alternative rendering of the same admitted samples. Preserve selection order. Shares of returns use fraction-valued data with percent labels. Do not mix returns from currencies or instruments into one pooled distribution or imply currency-hedged portfolio results.

## Data and statistics
Reuse the implemented return-distribution price evidence and adjacent valid adjusted-close pair rules. Qualified listing, date, positive finite adjusted price and adjustment basis are required. Missing/invalid dates, duplicate conflicts and omitted price observations do not become adjacent pairs. No forward fill, zero fill, winsorization or annualization. Count valid returns, excluded opportunities, date bounds and adjustment basis per listing; a paged/partial history refuses because adjacency can be incomplete. Different listing windows are allowed only with explicit per-listing date labels; provide an optional common-window selection over acquired data without inventing missing observations.

Compute box summaries in the worker: median; Q1/Q3 with the explicit R7 linear quantile convention; Tukey whiskers at the most extreme observed values within 1.5 IQR; keep all outside observations as marked outliers, never delete them. At least five returns per listing; otherwise refuse that selection with a repair message, rather than silently drop a chosen listing. Constant samples remain valid boxes with an accessible zero-IQR summary.

Violin uses the exact same returns, minimum 20 per listing, a documented Gaussian KDE with one explicit bandwidth rule: 0.9 * min(sample standard deviation, IQR/1.34) * N^(-1/5). If scale/bandwidth is zero or not finite, withhold violin and retain box with a reason. Restrict displayed density to observed min/max; label density smoothing rather than infer observations outside that range. No normal fit, VaR, significance test or forecast.

## Controls, modules and acceptance
Persist selected listings, view and common-window choice. Register only box/violin modules if the implementation uses them; worker-owned quartiles must not silently use Plotly's differing defaults. The implementation plan must pin the installed violin bandwidth/kernel behavior or render worker KDE with existing scatter so the stated definition remains true. Match the existing histogram's evidence, errors, zoom and touch policies.

Test R7 quantiles, whisker boundary equality, outliers retained, N=4/5 and 19/20, constant samples, tiny/large returns and overflow, omitted-date adjacency, unequal calendars, common-window exclusion, source aliases, both-engine lineage and actual hover/tap of summary/sample values. Readiness: price evidence exists; KDE implementation and any module bytes need an explicit builder decision before planning.

## Proposed common-window sample

Common window means common inclusive date bounds, not an intersection of trading-session pairs. Default bounds are the overlap of the selected acquired histories; within them each listing retains its own legitimate market sessions and gaps, with per-listing N and dates shown. Both price endpoints of an admitted return must lie inside the selected bounds; a first in-window close with its prior close outside the window contributes no return. No hidden predecessor is read, and no outside-window return is imported. An empty overlap or too-small resulting sample requests a wider or different selection.
