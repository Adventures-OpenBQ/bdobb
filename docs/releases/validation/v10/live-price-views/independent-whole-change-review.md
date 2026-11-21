# Independent whole-change Superpowers review

November 21, 2026. This is the original assessment of `7dca3c02`. The review of the subsequent fixes records the final dispositions. [Final fix review](independent-final-fix-review.md)

Reviewed BDOBB `327cbd5d..7dca3c02` against the approved 21 November design and v10 plan. This review covered the feature diff, the shared acquisition and presentation paths it activates, the three consumers, the installed and synthetic replay suites, the engine matrix, the example, and the release evidence. I inspected the archived closed-workspace screenshot and the dirty-remount comparison. I ran a focused loopback HTTP replay against the reviewed head. These are the results of this review at that head.

## Strengths

- The four-kind admission boundary keeps correlation and monthly returns on their prior paths. A valid acquisition binds to original date, adjusted-price and listing fields through aliases. Both executor variants exercise two levels of filtering and reordering, including a decoy column named `adjusted_close`. Raw omission dates and subsequent filter omissions remain distinguishable. See `src/lib/widgetData/chartRecipes/input.ts:21` and `src/lib/tableExecution/rust/dailyPriceEvidence.test.ts:158`.
- The financial algorithms use the expected observations. A known gap resets return adjacency, a drawdown retains its prior observed peak across a null and closes each fill segment separately, and small multiples share a positive baseline and an end derived from visible delivered rows. Installed replay compares raw-array expectations to both worker and Plotly traces, including both drawdown listings. See `e2e/installed-price-views.spec.ts:54` and `:207`.
- The queued-save guard checks source link, acquisition state, executor, revision and current settings again when the settings store processes the save. The browser verifies matching-refresh recovery and source replacement. Export/import tests hold reacquisition while checking that none of the three imported charts renders from saved authority. See `src/components/renderers/LinkedChartRenderer.tsx:364` and `e2e/live-price-views.spec.ts:212`.
- The standalone example links all three cards to a fixed, refreshable source and saves Parameters closed. The release record identifies the inherited v9 prerequisite, the paired revisions, the actual engine/browser runs and the development version. The installed qualification is explicitly archived replay.

## Critical

None.

## Important — fix before approval

1. **Explicit partial or continuing HTTP responses qualify all three charts.** At `src/lib/widgetData/chartRecipes/dailyPriceEvidence.ts:233`, the response check accepts a matching provider. The marker check at line 104 covers result rows. `chartSourceContracts.ts:128` checks explicit completeness values, leaving other recognized markers in the HTTP response or result metadata unchecked. In the archived public mirror response, adding only top-level `isPartial: true` or `extra.results_metadata.nextCursor: "page-2"` produced qualified charts for all three views, including 28 observed returns. A positive control qualified, and a root `completeness: "partial"` control refused. A paged result can therefore be treated as the acquired history even when the backend explicitly reports more data. Check the recognized markers at the relevant response-envelope and result-metadata locations during capture. Keep the existing marker and row checks and test both altered responses through acquisition.
2. **An invalid opted-in selection can fall back to the legacy snapshot path.** `src/lib/dataClient.ts:533` retains the chart source only on successful capture. At `src/lib/widgetData/chartRecipes/input.ts:111`, the negative check depends on a surviving `metadata.chartSources['daily-price']`. I retained the archived daily-price declaration and opted-in request, and changed the selected `results` to `{rows: <same captured array>, completeness: "complete", receipt: {start_date, end_date, interval}}`. Live capture rejected this wrong response shape. The table then parsed the selected legacy envelope at `src/stores/tableExecutionStore.ts:159` and all three charts rendered from snapshot fallback. The histogram described its 28 returns as daily, and the drawdown and panels lost the live scope disclosure. With provider omissions, fallback can also lose the coordinates that break the series. Carry the recognized failure far enough to prevent snapshot admission, including at executor and linked-input boundaries, or reject this downgrade at backend ingestion. Preserve legitimate documented snapshot imports and ordinary non-opted-in tables. The existing test at `dailyPriceEvidence.test.ts:221` starts after the stage at which the evidence is lost.
3. **The default example clips the small-multiples disclosure.** At `src/lib/widgetData/chartRecipes/smallMultiples.ts:66` the live disclosure follows the other notes. The rendered panel count and dataset status precede them (`LinkedChartRenderer.tsx:623`), and `src/styles.css:2449` caps the status area at 25%. In the supplied Chromium screenshot the chart begins midway through the disclosure's line. It can be reached by scrolling the status area, but the default card cuts the financial qualification in half. Make the full scope, baseline/end and acquisition window readable in this closed example. Check their text rectangles against the status scrollport in a browser regression. The existing `toBeVisible()` at `e2e/live-price-views.spec.ts:56` also passes for clipped text.

## Targeted reproduction

The local evidence archive preserves `final-superpowers-probe.mjs` and its result log. Restore the evidence directory to run the original command from the client root at `7dca3c02`. [Evidence archive location](verification.md#local-evidence-archive)

```sh
node .superpowers/sdd/2026-11-21-v10-live-price-views/final-superpowers-probe.mjs
```

The script calls the real `fetchWidgetData` against a loopback replay, then the table snapshot parser, row dataset builder and recipe worker entry point. It uses global fetch as the Tauri HTTP transport. The five original result records are retained in `final-superpowers-probe.jsonl` alongside the script. Existing broad checks were not repeated.

## Minor observations and ledger dispositions

| Observation | Disposition |
| --- | --- |
| Dirty, unapplied off-tab source draft on remount | Shared availability limitation. Both the prior Return Summary and the histogram showed zero new recipe replies over five seconds in Chromium and WebKit. GETs kept the committed bounds and Run produced the expected new history. This does not invalidate committed-question identity. Keep the limitation in handoff, including that a pre-Run chart can remain on “Calculating chart…”. No source-store redesign is required for v10. |
| Retired-response browser assertion | The spot check at `e2e/live-price-views.spec.ts:200` could miss a transient presentation before replacement. Current executor and renderer tests independently cover stale revision rejection and cancellations. Optional improvement is an event or mutation observation spanning that interval. |
| Second drawdown listing in the engine matrix | Resolved by both-listing raw-array worker and rendered comparisons at `e2e/installed-price-views.spec.ts:207` on both engine servers. |
| Delivered-null terminal date absent from installed captures | Covered on the documented snapshot path by `smallMultiples.test.ts:103`. Qualified live delivery requires a positive finite price and expresses known losses as coordinates. The retained tests cover why later omissions cannot extend the common end. |
| React act, jsdom canvas, Node color and Vite build diagnostics | Recorded. The relevant gates completed and these messages do not establish a product regression. No feature change required. |
| Deliberately missing-column and stale/missing-WASM negative-test messages | Optional explanatory note beside the passing gates. |
| Extra navigation to historical paired/image evidence | Optional direct link to the v9 published follow-up. The verified identifiers and existing links already distinguish past qualification from current replay. |
| Inventory and scrub failures | Resolved with the filename registration, portable plan paths and logged passing reruns. |
| Scope note clipping | Confirmed visually. Important finding 3 owns the fix. |

## Declined to judge

- Fresh entitled production acquisition, a new provider image and release deployment were outside the approved work. The replay establishes compatibility with the captured responses only.
- The release version bump and ultimate v9 integration target remain release-integration decisions. The example's v10 requirement and the development version are disclosed.
- A redesign of shared off-tab stale-display availability spans the prior producer lifecycle. The committed request and post-Run behavior were judged above.

## Assessment

**Ready to merge? With fixes.** The numerical implementation and normal-path integration are supported by independent raw-array checks. Two reproduced input shapes defeat required refusal behavior, and the default example clips required financial context. Close the three Important findings and verify their boundary conditions before approval.
