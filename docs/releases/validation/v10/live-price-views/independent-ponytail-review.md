# Independent Ponytail full review

November 21, 2026. This is the original assessment of `7dca3c02`. The final scoped review verified all six reductions. [Final fix review](independent-final-fix-review.md)

Reviewed the approved design, plan constraints and implementation diff `327cbd5d..7dca3c02`.

- `e2e/installed-price-views.spec.ts:L122–149` — **shrink:** Share capture loading, route replay and backend setup with `e2e/installed-return-summary.spec.ts:L31–33,L63–85`. Keep capture eligibility, chart layout and the independent raw-array oracle in their respective specs.
- `e2e/installed-return-summary.spec.ts:L47–62,L89–94` — **shrink:** Use the existing `recordRecipeReplies` fixture and retain the polling and box/violin sample checks. The two installed specs can observe the same recipe worker through one hook.
- `src/components/renderers/LinkedChartRenderer.tsx:L372–386` — **shrink:** Share one Apply handler for ownership and the general recipe controls. Use the drawing-and-source guard for ownership, news and return summary, the source-only guard for the three new price views, and the existing unguarded commit for other recipes. Construct the next settings once.
- `src/lib/widgetData/chartRecipes/input.ts:L129` — **shrink:** Return the validated projection omissions from `readLiveDailyPriceSource` at `dailyPriceEvidence.ts:L255–261` and use them directly. Preparation currently reopens and revalidates the same provenance for coordinates the source reader already checked.
- `e2e/live-price-views.spec.ts:L43` — **delete:** The import helper's `existsSync` preflight duplicates the required `readFileSync`, which already fails with the example path when missing.
- `e2e/fixtures/return-summary.ts:L184` — **delete:** Both Rita fixture callers pass `liveSourceId`. Use the existing fixture constant directly.

net: -32 lines possible, estimated.

## Separate main-review observation

`src/lib/widgetData/chartRecipes/smallMultiples.ts:L66`, `src/styles.css:L2449`. The archived TypeScript Chromium screenshot of the default imported example cuts through the required small-multiples live-scope line. The text is present in the scrollable status area and the visibility assertion passes despite the clipping. The screenshot also cuts off the histogram acquisition-window note beneath its visible scope statement. This is a presentation issue for the main review.

Source and tests were reviewed read-only and were not rerun.
