# Independent whole-branch review of the v9 risk and ETF charts

Reviewed the approved design, implementation plan, controller rulings, full 75-file change package and recorded acceptance evidence for BDOBB `0ee0bdba8020d5a61a991af0ca7f4b093a443d88..fe0ed64f4d28cfea15f91744b05c9800b7ea5400`. The package was read in bounded chunks. I inspected the acquisition and projection paths, pure builders, controls, renderer lifecycle, native import/export tests, browser scenarios and canonical provider qualification code.

## Strengths

- The histogram computes consecutive simple returns in the worker, preserves zero, breaks at known gaps, accounts for arithmetic overflow and assigns the maximum to the closed final bin. Count-conservation, degenerate-range and extreme-value cases have direct numerical assertions. The extreme browser check measures the actual bar bounds.
- Small multiples preserve the authored symbol order, find a common positive baseline, cap every panel at the earliest delivered end date and match both axes. The desktop browser test measures shared zoom after a real drag and grid resize. The Pareto builder validates the delivered rows before applying the 50-holding limit, sums original weights with compensated arithmetic and reports displayed and delivered sums separately. Exposure dots preserve original labels, zero weights and the equity-exposure denominator.
- ETF evidence is derived during acquisition and survives projection. The hook associates context with the completed response. The snapshot parser allowlists receipt fields. TS view calculation and Rust registration carry raw weight and identity failures through hidden columns and downstream linked tables. I found no dashboard field that can author this certification. The changed request path excludes configured query credentials on the capture allowlist, and the browser export check looks for runtime evidence leakage.
- Mounted parent tests exercise relinking, delayed results, failed refresh, semantic refusal, source repair, one source notice and chart-read/worker/save errors. The fixture dashboard makes genuine new acquisition requests on a second import. The exhaustive chart-type picker includes the four saved types, including the previously deferred imported picker case.
- The product comparison leaves dependencies and Plotly registrations unchanged. I confirmed the provider and Docker checkouts are clean and at their recorded commits. The tested product head `f900f8bb3107ebc68579c6d4549edf26d4611637` differs from the reviewed head only by the verification document and ten screenshots. Recorded results were 9,351 unit passes, 47 opt-in skips, 57 web passes and nine Chromium passes. All seven shipping gates exited zero. The warning comparison records identical React act counts in the baseline and candidate. I did not repeat these suites.

## Critical

None found.

## Important

1. **Include the exchange in the identity of a bare EODHD ticker.** `src/lib/widgetData/chartRecipes/etfEvidence.ts:87`. The GET captures the exchange, but certification derives the fund solely from the symbol. The pinned provider qualifies a bare symbol with the requested exchange, defaulting to US, before fetching fundamentals (`openbq_eodhd/models/_fundamentals.py:41`). A focused probe requested `DEMO` with `US` and `LSE` on the same holdings source. Both acquired identities, displayed fund names and Pareto revisions were identical. A qualified receipt that correctly says `DEMO.LSE` also disagrees with the bare requested `DEMO` under the current equality check. Preserve a canonical acquired instrument for recognized routes, accounting for the provider's bare-symbol echo in exposure rows. Retain explicit receipt identity on snapshot-only sources. Check bare, qualified, default-exchange, same-ticker/different-exchange and genuinely conflicting cases.
2. **Bind the exposure category to the verified mode.** `src/lib/widgetData/chartRecipes/bindings.ts:29`. The category role accepts sector, country or region for either mode. Checking the receipt kind in the builder does not check the chosen column. In a certified sector dataset carrying both `sector=Industrials` and `country=Canada`, selecting country succeeded and produced a chart titled “DEMO.US sector exposure” with Canada as its category. Restrict category roles by mode in controls, import/runtime eligibility and worker execution. Resolve renamed columns using their source field identity. Exercise both directions with a source containing both dimensions.
3. **Honor a conflicting percentage-point declaration on the acquired weight column.** `src/lib/widgetData/chartRecipes/etfEvidence.ts:66`. The checks recognize textual unit metadata but omit the acquired column's numeric formatter. The backend adapter passes the widgets.json column format through to the raw dataset. BDOBB's `percent` displays percentage points and `normalizedPercent` multiplies fractional data by 100 (`src/lib/format.ts:120`). With raw weight 0.5 and an acquired `percent` formatter, the probe printed table value **0.5 %** and accepted sector hover **50%**. Treat an explicit acquisition-time percentage-point format as contradictory to the fractional ETF contract, retain the refusal through projection, and support the canonical fractional format. A later user display preference should never certify a unit.
4. **Make lower watchlist panels reachable by swiping inside the plot on touch screens.** `src/components/renderers/LinkedChartRenderer.tsx:350`. Only exposure dots opt into touch scrolling. I imported the shipped example into Chromium mobile emulation at 600 × 980. The one-column watchlist viewport measured 277 pixels high and contained 720 pixels of plots. Three upward finger swipes starting inside the first panel's Plotly drag surface left scrollTop at zero. The narrow layout therefore offers 443 pixels of scrollable content that a swipe in the normal plot surface fails to reach. Provide a usable touch scroll gesture for small multiples and retain desktop zoom and panel tap/inspection. Test reaching the final panel by starting the gesture inside a plotted panel.
5. **Show failures from the final Plotly draw in the chart card.** `src/components/renderers/ChartRenderer.tsx:133`. If the worker succeeds and `renderPlot` rejects, the catch only writes a log. The user still sees a successful data summary next to an empty or previously rendered plot. The existing rejection test at `src/components/renderers/ChartRenderer.test.tsx:186` asserts logging. The new mounted failure tests cover read, worker and save failures, which occur earlier. Surface a bounded local draw error for the active figure, ignore superseded draw failures and clear the local message on recovery. Keep the source alert owned by the parent. This inherited path also serves all four new recipes, for which the design explicitly requires visible renderer-local errors.

## Minor

- **Include the shared baseline in panel hover.** `src/lib/widgetData/chartRecipes/smallMultiples.ts:99`. The tooltip gives the symbol, point date and index. The required baseline date is only in the status area, which can be distant from the selected panel. Include the baseline date and index 100 in hover, and assert a plotted point's tooltip.
- **Distinguish an acquired filter that happens to match every row.** `src/lib/widgetData/chartRecipes/etfEvidence.ts:139`. The filtered-source disclosure relies solely on a row-count decrease. An active filter that currently matches every acquired row receives the same scope label as an unfiltered table. Carry a compact filter-active fact through presented provenance for this label, retaining both counts. The current numbers themselves are correct.
- **Surface cell errors on an explicitly selected holding label.** `src/lib/widgetData/chartRecipes/etfPareto.ts:66`. An errored selected label silently falls back to the holding ID. The design calls for refusal on cell errors. Keep the ID fallback for an omitted optional binding and distinguish a bound cell error so it can be repaired. The existing holding weight and identity checks protect the sums.
- **Correct singular histogram hover copy.** `src/lib/widgetData/chartRecipes/returnDistribution.ts:121`. One observation renders as “1 observations” and the extreme browser assertion requires that wording. Use count-neutral copy such as “Count 1”, or pluralize, and update the assertion. Counts are correct.
- **Clarify how to reopen the example on a second machine.** `docs/examples/v9-risk-exposure/README.md:16`. The saved connection uses loopback. Tell readers to start the provided fixtures at the documented port on the destination machine and connect to that local server before import.
- **Verify the restored bin count on the actual trace.** `e2e/risk-exposure.spec.ts:210`. After reimport the browser test checks the input value and an independent regional weight. Also check that the reopened nonconstant histogram has seven rendered bins with conserved observations. The test already measures those bins before export.

## Verification limits and declined to judge

- Live vendor availability, entitlements and current fund coverage were excluded. The approved scope allowed offline contracts and deterministic snapshots. I checked qualification and weight meanings against the pinned provider source.
- Device-specific Safari, native Tauri touch handling and physical-device usability were outside the recorded Chromium scope. My independent touch measurement used real Chromium input dispatch in mobile emulation.
- Behavior of opt-in integration services was outside the seven recorded gates. Their 47 skipped tests remain unverified in this batch.
- Fitted risk models, full-fund reconstruction, alternative normalizations, synchronized cursors, multi-fund joins and extra chart families were explicitly excluded from the design.
- I did not republish, repackage or redeploy the sibling repositories. Their clean pinned code and unchanged BDOBB dependency/trace paths cover the requested scope check.
- I did not regrade baseline React warnings as branch findings. The shipping record matches counts, emitting tests and components against the same-day first-batch baseline.

## Assessment

**Ready to merge with fixes.** The four analytical paths are implemented and supported by substantial numerical and browser coverage. Correct the three ETF interpretation defects, the touch watchlist gesture and the final draw-error reporting before merge. Recheck the repaired paths and the applicable shipping gates on the new product head. This is an independent local review, with no GitHub approval or release action.

The targeted Vitest and Chromium probes used a disposable archive of the reviewed head, the existing dependencies and the pinned generated Wasm. They measured the candidate behavior described above. The product checkout, index, HEAD and branch were unchanged.

## Consolidated fix resolutions

The independent assessment above describes commit `fe0ed64f`. The implementer addressed the findings in `9019093b0596ecada2d923380a02af38ed450adf`. The entries below identify the regression evidence for that commit. [Verification record](verification.md)

| Finding | Change and verification |
| --- | --- |
| Important 1 · Fund identity | The recognized route qualifies a bare ticker with its requested exchange, defaulting to US. The acquisition accepts a matching qualified receipt and its original request echo on exposure rows. Snapshot-only identities retain their explicit spelling after case normalization. Evidence and Pareto tests distinguish US and LSE titles and revisions, retain the holding ID, and reject conflicting row and receipt identities. |
| Important 2 · Exposure category | The control, saved-binding check and worker use the chosen mode’s source field names. A mixed snapshot has separate renamed sector and country fields. The builder and saved-option tests cover both invalid directions. The mounted chart refuses mismatched receipt kind; Chromium exercises the unavailable draft, relink and recovery. |
| Important 3 · Weight formatter | Raw certification refuses the percentage-point formatter. Both table engines pass through the original refusal and accept the fractional formatter. A linked child changes its display format in both directions and retains the parent’s certification. |
| Important 4 · Watchlist touch | A coarse-pointer watchlist releases the Plotly drag handler. Chromium swipes from within the subplot drag surfaces to the final BIRCH panel and taps a marker. The desktop test zooms a subplot and preserves matched ranges across reflow. |
| Important 5 · Draw failure | An active draw rejection produces a bounded local alert and detaches the plot, triggering its observer and Plotly cleanup. Superseded rejections cannot change the active figure. Mounted tests cover recovery, late rejection, local read/worker/save diagnostics and parent-owned source status. |
| Minor 1 · Baseline hover | Marker hover includes the shared baseline date and index 100. Desktop and mobile Chromium inspect real marker tooltips. |
| Minor 2 · All-matching filters | The engines record an ETF presentation flag from effective source filters and preserve it across a linked subset. Tests show one of one acquired rows after applying a matching filter or checklist, and restore the ordinary scope on clearing the filter. |
| Minor 3 · Holding label | A cell error on a bound label refuses even on a repeated holding. Omitting the label still uses the holding ID. |
| Minor 4 · Histogram copy | Hover uses count-neutral wording. Chromium inspects both a count of one at the largest finite boundary and a count of three at the ordinary final boundary. |
| Minor 5 · Fixture setup | The example explains copying the fixture directory, starting the server on the destination machine at port 17910 and validating the loopback connection there. |
| Minor 6 · Reopened bins | The native reimport test reads the reopened nonconstant Plotly trace, asserts seven bins and sums their counts to seven observations. |

# Independent re-review of the consolidated fixes

**Ready to merge with one further fix.** All five original Important findings and all six Minor findings are addressed. The small-multiple touch fix introduces one Important regression on a coarse-pointer card whose panels already fit.

I reviewed the 38 changed files from `fe0ed64f4d28cfea15f91744b05c9800b7ea5400` through `7f89bcda24204dbcaff53838ed0a5298c8173794`, including the 121,687-byte package in bounded chunks. I used the original independent findings as acceptance criteria and the controller’s rulings on unsaved mode changes and touch scrolling.

## Original findings

| Finding | Verdict | Evidence |
| --- | --- | --- |
| Important 1 · Exchange-aware fund identity | ADDRESSED | Recognized EODHD routes qualify bare symbols with the requested exchange or default US, preserve qualified symbols, check receipts against the acquired instrument and accept the provider’s request echo on exposure rows. Receipt-only snapshots retain their declared identity. The tests exercise conflicting qualifications, holding IDs and distinct US/LSE titles and chart revisions. See `src/lib/widgetData/chartRecipes/etfEvidence.ts:102`. |
| Important 2 · Exposure dimension | ADDRESSED | Sector and geographic roles use different origin-field allowlists in controls, saved binding checks and the worker. Tests cover both wrong-mode bindings after renaming. The browser verifies Apply stays disabled for an incompatible draft, the applied figure remains visible and relinking clears it before the repaired figure draws. See `src/lib/widgetData/chartRecipes/bindings.ts:29`. |
| Important 3 · Acquired percentage-point formatter | ADDRESSED | Raw certification refuses the percentage-point formatter. TS and Rust parent/child tests retain the refusal after a downstream override and accept originally fractional weights after a downstream display change. The numeric value stays 0.5 in both transfers. See `src/lib/widgetData/chartRecipes/etfEvidence.ts:69`. |
| Important 4 · Scrolling an overflowing watchlist by touch | ADDRESSED | Chromium swipes starting inside the subplot surfaces reach the last BIRCH panel at 600 pixels wide, and a tap reveals its baseline. The desktop zoom/reflow test still passes. The new fitting-card regression is recorded below. See `e2e/risk-exposure.spec.ts:261`. |
| Important 5 · Plotly draw errors | ADDRESSED | The active failure has a bounded, visible local alert. Detaching its plot triggers cleanup. A new figure recovers, and an obsolete draw rejection cannot replace the active figure or emit a misleading error. The component tests cover removal, recovery and late rejection. See `src/components/renderers/ChartRenderer.tsx:152`. |
| Minor 1 · Shared baseline in hover | ADDRESSED | The tooltip includes index 100 and the shared date. Desktop hover and mobile tap read the actual rendered text. See `src/lib/widgetData/chartRecipes/smallMultiples.ts:99`. |
| Minor 2 · Active filter that matches all rows | ADDRESSED | The TS and Rust presentation paths carry the ETF filter flag through a linked subset independently of raw acquisition certification. The parity cases check a matching filter, a matching checklist and clearing the filter. See `src/lib/widgetData/chartRecipes/etfEvidence.ts:128`. |
| Minor 3 · Explicitly bound holding label error | ADDRESSED | A bound label with a cell error refuses before duplicate collapse. Omitting the optional binding still permits the ID fallback. See `src/lib/widgetData/chartRecipes/etfPareto.ts:61`. |
| Minor 4 · Singular histogram count | ADDRESSED | Count-neutral hover works for one and three observations, including the upper extreme. See `src/lib/widgetData/chartRecipes/returnDistribution.ts:121`. |
| Minor 5 · Second-machine example setup | ADDRESSED | The example now explains copying the fixtures, serving them on the destination at port 17910 and validating the destination’s loopback connection. See `docs/examples/v9-risk-exposure/README.md:16`. |
| Minor 6 · Bins after native reimport | ADDRESSED | Chromium reads the reopened trace and verifies seven bins with seven total observations. See `e2e/risk-exposure.spec.ts:215`. |

## New breakage in the fix diff

**Important · A fitting watchlist loses touch zoom.** `src/components/renderers/LinkedChartRenderer.tsx:350` opts every watchlist into touch scrolling. At `src/components/renderers/ChartRenderer.tsx:127`, defining a scroll height is enough to disable the Plotly drag mode on a coarse pointer. This also affects a single panel or a wide one-row grid that has no vertical overflow to scroll. The shared Plotly configuration hides the mode bar. For these cards, the user loses direct zoom with no corresponding scrolling benefit.

I ran one comparative Chromium mobile-emulation scenario in a disposable archive at each revision. It imported the supplied dashboard with the supported one-symbol CEDAR selection and increased the watchlist card height to 32 grid units, then dispatched a finger drag inside the plot at a 1100 × 1080 viewport. Both revisions measured a 568-pixel client height and a 568-pixel scroll height. On `fe0ed64f`, drag mode was zoom and the displayed March 2–16 interval narrowed to March 4–11. On `7f89bcda`, drag mode was false and the same gesture left the interval at March 2–16. Both probe processes completed and printed the measured values.

For watchlists, disable direct drag only when the scroll viewport actually overflows vertically. Re-evaluate when the card or figure changes height. Keep the existing overflow swipe/tap and desktop assertions, then verify the fitting coarse-pointer chart still zooms. The explicitly accepted tradeoff for an overflowing watchlist stands.

**Critical and Minor new findings.** None.

## Shipping evidence and limits

I verified that tested product commit `9019093b0596ecada2d923380a02af38ed450adf` and reviewed evidence head `7f89bcda24204dbcaff53838ed0a5298c8173794` differ only in verification documents and screenshots. The existing logs record 9,366 unit passes with 47 opt-in skips, 57 web passes, nine Chromium passes and successful pinned Wasm initialization. The shipping record reports all seven gates passed. I independently checked the scoped whitespace diff and the clean checkout. I ran only the one named browser comparison across the two revisions.

## Declined to judge

- Unchanged first-batch and whole-branch behavior was already covered by the original independent review. This pass assessed the fix diff.
- Physical touch devices, Safari and native Tauri gesture handling were outside the recorded browser environments. The new finding reproduces in Chromium mobile emulation.
- Live provider entitlements, opt-in integrations and Docker deployments were outside this fix wave. It changes no provider or Docker files.

This local re-review changes no product files, index entries or branch state.

## Fitting watchlist correction

Product commit `5a4403e68fcb9841df1db5038fcc06012d918a1b` measures the actual watchlist viewport and plot. The observer rechecks vertical overflow when either element resizes. Fitting watchlists retain their authored touch drag mode. Overflowing coarse-pointer watchlists release vertical dragging to scroll. The existing fixed-axis exposure policy continues to support vertical scrolling and marker inspection.

The new unit regression exercises a 280-pixel plot at viewport heights of 568, 220 and 280 pixels. The Chromium regression resizes the same three-symbol watchlist from overflowing to fitting and back. It then zooms a fitting single CEDAR panel at 1100 × 1080 with a finger drag, verifying that both date bounds move inward. [Verification record](verification.md)


## Final independent confirmation

# Final independent re-review of watchlist touch zoom

**ADDRESSED. Ready to merge.** The fitting watchlist supports finger-drag zoom again. An overflowing watchlist supports vertical swiping and marker inspection. I found no new Critical, Important or Minor issues in this correction.

I reviewed the eight-file diff from `7f89bcda24204dbcaff53838ed0a5298c8173794` through `09a7122d6946f1afc6efeb3b7c50ed89317178c2`. In `src/components/renderers/ChartRenderer.tsx:130`, the watchlist measures actual viewport overflow on attachment and observes the viewport and its inner plot. This covers both a resized card and a reflowed plot. The observer disconnects on cleanup. Both the Plotly drag-mode override and touch-end handling follow the measured state on coarse pointers. Exposure retains its existing fixed-axis touch behavior through the separate opt-in at `src/components/renderers/LinkedChartRenderer.tsx:350`.

The Chromium regression reproduces the original single-CEDAR case at 1100 × 1080, verifies zero vertical overflow, sends a real finger drag inside the subplot and checks that both displayed date bounds move inward. The same browser scenario measures the three-panel card across both overflow transitions, scrolls to BIRCH, taps its marker and inspects the zero-weight exposure marker. The marker stability check follows an in-viewport assertion and preserves the actual touchscreen tap and tooltip assertions. See `e2e/risk-exposure.spec.ts:277` and `e2e/risk-exposure.spec.ts:304`.

The production fix is `5a4403e68fcb9841df1db5038fcc06012d918a1b`. I confirmed the tested commit `2a0e55edb6a0e8f3eefa3d60c2052b1a553deac9` changes only the browser test after that fix. The reviewed head adds verification documents and one refreshed screenshot. The recorded unit and browser regressions failed before the correction. I inspected the passing logs for 71 focused tests, three consecutive focused Chromium runs, all nine integrated Chromium cases, 9,367 unit passes with 47 opt-in skips and 57 web passes. The shipping record reports successful typecheck, lint and build, and the final content/header scrub is clean. The scoped whitespace check passed.

**Limits.** I used the instrumented Chromium results and did not rerun passing suites. Physical touch hardware, native Tauri and Safari remain unverified. The eleven findings addressed in the preceding review were outside this final interaction check. The product checkout, index and branch were unchanged by this review.


## Current disposition

All five original Important findings and six Minor findings are addressed. The introduced fitting-touch-watchlist regression is also addressed. The final independent reviewer approved the correction with no new findings. Review is an independent local agent assessment, not a GitHub approval or merge. Provider and Docker code remain unchanged.

The controller accepts the recorded review limits: live vendor availability/entitlements, physical devices/Safari/native Tauri touch, opt-in services, explicitly excluded analytical features and deployment remain outside this acceptance. None is represented as verified. Baseline React diagnostics remain attributed existing warnings.
