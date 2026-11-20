# Independent re-reviews of the screening and income fixes

[Current disposition](review.md) · [Original review and reproducers](original-review.md)

## Independent re-review of the remaining income draft finding

**Finding 5 — ADDRESSED. All seven original findings are closed. Ready to merge from code review.** The other six dispositions stand from the preceding review. I found no new regression in the scoped BDOBB change.

I reviewed `cbbb1269bdebfc25e012ca48b726c9d865666524..b6dcaea30941f8180134429a3d35d8ce4bf12dc7`. The product fix is `2d95868da701f9fa698d6f25f8c25f7a5217cbf8`. The previously reviewed provider and Docker pins remain `6f9f1cb20475c3204867bf03c3f3dc5f7141ca96` and `0e843db5465725f124075709528ea485618c87ad`.

- **Draft and worker admission agree.** The period selector and worker call the same resolver at `src/lib/widgetData/chartRecipes/incomeSankeyInput.ts:72` and `:94`. It selects the compiler-proven period column, checks the acquired field set and reported origin, and requires a finite presented value without a cell error. The controls receive the resulting repair message at `src/components/renderers/LinkedChartRenderer.tsx:114`.
- **The existing financial rules still apply.** The calculated gross-profit fallback requires its authorized formula, presented revenue and cost, and the matching calculated value. Missing optional costs or taxes remain disclosed reconciliation components. The TypeScript and compiled Rust cases at `src/lib/widgetData/chartRecipes/incomeSankeyInput.test.ts:83`, `:96`, `:126` and `:134` check the choices alongside the worker for these cases and a hidden required anchor.
- **The original reproduction is covered end to end.** The mounted test at `src/components/WidgetCard.linked.test.tsx:891` checks the plot element and saved recipe. The Chromium test at `e2e/screening-income.spec.ts:433` starts with ten FY 2026 nodes. Selecting the fully acquired FY 2025 period missing net income disables Apply, displays the specific repair and retains the ten nodes and saved FY 2026 selection. Selecting the eligible period enables Apply again. A refresh that removes the applied period's net-income anchor clears its graph. The original-head browser log records the failing enabled button. The corrected focused and full Chromium logs record this test passing.

The follow-up logs report 158 focused Vitest passes, 9,597 full-suite passes with 47 optional skips, and 15 Chromium passes. The recorded standalone lint retry, typecheck, build and scrub completed successfully. I checked the diff, focused regressions and existing execution evidence for this disposition. No repeat full-suite run was needed. This review covers local code readiness. Prior limits on live entitlement, physical touch, Safari/Tauri and deployment still apply.

## Reproduce the selected-period follow-up

Run the retained regression cases from the BDOBB root. The earlier verification applied the same new cases to `cbbb1269bdebfc25e012ca48b726c9d865666524`, where they failed when Apply stayed enabled. On `2d95868da701f9fa698d6f25f8c25f7a5217cbf8`, the focused Chromium case passed in 2.9 s. The full regression is retained in the normal application tests.

```sh
pnpm exec vitest run src/components/WidgetCard.linked.test.tsx -t 'another full record'
pnpm exec playwright test e2e/screening-income.spec.ts --project=chromium -g 'ten-node applied Sankey'
```

The earlier paired formatter failure and its correction have a separate [opt-in reproducer](reproduce/README.md).

## Independent re-review of the seven screening and income fixes

**Verdict: With fixes.** Six findings are addressed. One Important finding remains open. A real Chromium probe showed that a user can still apply an income period whose acquired receipt already proves the required net-income anchor is missing. Applying it removes a previously working chart. There are zero Critical or Minor findings and no separate new regression in the reviewed fix range.

Reviewed BDOBB `b3716058..cbbb1269bdebfc25e012ca48b726c9d865666524`, whose tested product head is `4f5e254eeccb4daad55cb70c6616f7b205e5c5dd`, canonical provider `5c54b403..6f9f1cb20475c3204867bf03c3f3dc5f7141ca96`, and Docker `fb2df569..0e843db5465725f124075709528ea485618c87ad`.

## Disposition

1. **ADDRESSED — Screener table units.** Canonical `openbq_eodhd/models/screener.py:82` emits the fractional-percent formatter. Generated widget tests cover the field in the provider and Docker. The retained paired Chromium spec reads the extracted widget and the 0.05 response row and requires the actual `td[data-field="price_change_5d"]` to display “5 %”. The old-image log records “0.05 %” and the new-image test passed. The canonical and Docker vendor trees both have ID `44d643057e12e009ddd9f3e4ea9be540d2839f4a`.
2. **ADDRESSED — Explicitly incomplete dividend delivery.** `src/lib/tableRowValues.ts:45` reconciles local file scope with the typed receipt. `src/lib/widgetData/chartRecipes/financialEvidence.ts:286` and `:401` check both the HTTP envelope and the result object before selecting rows. Regression cases at `src/lib/widgetData/chartRecipes/financialEvidence.test.ts:93` cover paged, partial and sampled acquisitions and preserve a verified HTTP array that declares no negative scope.
3. **ADDRESSED — Contradictory source facts hidden by projection.** `src/lib/widgetData/chartRecipes/financialEvidence.ts:196`, `:220`, `:299`, `:324` and `:340` close the reported dividend diagnostic, fiscal label, venue suffix, amount basis and row/receipt fiscal identity cases. The ingress tests cover both source boundaries. The linked tests at `src/lib/tableExecution/rust/financialEvidence.test.ts:125` exercise both TypeScript and compiled Rust after the contradictory basis column disappears.
4. **ADDRESSED — Week-based fiscal period identity.** Canonical `openbq_eodhd/models/fundamental.py:148` retains bucket-proven kind, leaves the unverifiable year and numbered quarter unknown and uses the same logic for row and receipt. The legacy path still uses its original helper. Provider tests cover the February 1, 2025 boundary for annual and quarterly buckets. `src/lib/widgetData/chartRecipes/incomeSankeyInput.test.ts:225` verifies the resulting title through both Statement engines.
5. **NOT ADDRESSED — A statically ineligible draft can still replace a working chart.** The code now correctly blocks unknown dividend coverage, unsafe screening cohorts, unknown income scale and truncated income period records. Tests at `src/components/WidgetCard.linked.test.tsx:791`, `:835` and `:866` cover several of those repairs. One selected-period condition demonstrably remains. `src/lib/widgetData/chartRecipes/financialAdmission.ts:52` checks record coverage and conflict flags but skips `present_fields`. `src/components/renderers/LinkedChartRenderer.tsx:115` returns that period as an eligible choice. The worker requires a source-verified net-income anchor at `src/lib/widgetData/chartRecipes/incomeSankeyInput.ts:123` and `:139`.

   **Focused real-browser reproduction.** Load the shipped screening-and-income example with a valid FY 2026 period. In the FY 2025 record set `net_income=null` and remove only `net_income` from that period's receipt `present_fields`, leaving record coverage full and currency and scale verified. The corrected candidate rendered ten FY 2026 nodes. Selecting FY 2025 left Apply enabled. Clicking it removed all ten nodes and showed “Present a finite, source-verified Net income anchor for the selected period.” No missing data had to be fetched to predict this outcome.

   Use the selected period's acquired field set to share mandatory-anchor admission with the worker. Preserve the allowed gross-profit formula fallback and optional expense reconciliation. A mounted test should retain the earlier period's plot and settings while the incompatible draft identifies the missing anchor. If a later refresh makes an already applied period ineligible, the existing worker refusal should still clear it.
6. **ADDRESSED — First-use verified empty source.** `src/components/renderers/LinkedChartRenderer.tsx:132` and `:135` bind the empty proof to the current source revision, its zero raw events and an empty presentation. `src/components/renderers/LinkedChartRecipeControls.tsx:39` and `:66` permit first use and preserve existing field aliases. The mounted first-use case at `src/components/WidgetCard.linked.test.tsx:813` selects the instrument, applies and shows the verified no-events message. The alias test at `src/components/renderers/LinkedChartRecipeControls.test.tsx:156` covers previously applied settings.
7. **ADDRESSED — Clipped bubble and fitted endpoints.** `src/lib/widgetData/chartRecipes/bubbleRegression.ts:113` widens the axis range when the relative offset and span make ordinary SVG coordinate conversion unreliable. `e2e/screening-income.spec.ts:384` requires all three centers and both fitted endpoints inside the real plot domain at three sizes. The recorded old 1024-pixel vertex on the 695-pixel plot is now on-screen. At these exceptionally close X values the three points resolve to the same horizontal pixel. Their original values and vertical positions remain distinct in the supplied chart data and the report discloses the geometry.

## Verification and limits

I checked the fix packages, focused tests, paired-cell spec and recorded logs. They support 9,596 passing BDOBB unit tests with 47 optional skips, 57 web tests, 14 Chromium acceptance cases, 539 provider passes with one optional skip, 17 Docker tests plus two subtests and 16 runtime verifier checks. The image verification reports 121 matching source paths and 86 matching installed files. I ran the single additional real-Chromium case described under finding 5. The declared passing suites remain valid for their tested inputs.

No independent new breakage surfaced in the correction ranges. Live entitlement, physical touch/Safari/Tauri, future chart families, public release and the economic accuracy of upstream financial values remain outside this re-review. The remaining issue is in the original review's required draft behavior.
