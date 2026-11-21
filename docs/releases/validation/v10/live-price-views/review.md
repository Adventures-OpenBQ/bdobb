# v10 live price views review

## Row-visibility review

The fresh [independent correction review](independent-row-visibility-review.md) approved the visible-cell assertion and portable verification commands at `66540fc4`. The prior row-visibility Minor is closed; no review findings remain for this correction. [Coverage proof and results](row-visibility.md). This is independent agent review, not a human GitHub approval.

## Stacked reconciliation review — November 21, 2026

Fresh independent Superpowers review of the complete stacked change and reconciliation at `3808e73e` approved publication with no Critical or Important findings. It verified v9 `bf67cf72` as an ancestor, preserved acquisition and pivot contracts, and independently counted the test evidence. [Independent stacked review](independent-stacked-review.md) · [Reconciliation verification](verification.md)

At that reviewed revision, one nonblocking Minor concerned synthetic refusal cases checking only a column header. The [row-visibility follow-up](row-visibility.md) adds a visible listing-cell assertion in each case and demonstrates that hiding the data rows defeats the new assertion while the original tests pass. The dual-executor cases independently verify 58 retained rows; the new browser check establishes representative rendered-cell visibility. The recorded initial failures remain part of the verification history. This is independent agent review, not a human GitHub approval.

The publication target is a stacked PR against `codex/v9-live-observed-returns`. Release integration, release version changes and merge decisions are separate. Existing client #89, provider #6 and Docker #33 remain unmerged. The historical local-handoff status below describes the earlier revision.

## Review status

**Approved for local handoff on November 21, 2026.** The independent whole-change Superpowers review at `7dca3c02` found three Important issues. The independent Ponytail review recommended six simplifications and corroborated the clipped disclosures. The independent scoped review of `7dca3c02..de267011` confirmed all three findings were addressed in `750f7831`, verified all six simplifications, and found no new Critical or Important issues. [Whole-change review](independent-whole-change-review.md) · [Ponytail review](independent-ponytail-review.md) · [Final fix review](independent-final-fix-review.md)

The five scoped implementation reviews approved qualified preparation, numerical consumers, Parameters and renderer admission, both-engine filtered lineage, and examples and browser replay. [Approved design](../../../../superpowers/specs/2026-11-21-v9-live-price-views-design.md) · [Implementation plan](../../../../superpowers/plans/2026-11-21-v10-live-price-views.md)

| Scoped review | Disposition |
| --- | --- |
| 1. Qualified daily-price preparation | Approved. Shared admission rejects invalid live evidence and preserves local snapshot proof rules. The full suite still reports React `act` and jsdom canvas diagnostics. |
| 2. Numerical consumers | Approved. Observed pairing, across-gap peaks, and shared baseline and delivered end have focused regression coverage. Correlation and monthly returns retain snapshot-only admission. |
| 3. Parameters and renderer | Approved after correction. Queued Apply could persist settings for a replaced source. Three regression tests reproduced the stale saves. The source, revision and settings guard in `fc0faea3` passed the 92-case focused rerun and follow-up review. |
| 4. Both-engine lineage | Approved. The 46-case TypeScript/WASM matrix verifies filters, original column origins, refusal and ticket retirement. Task 5's raw-array oracle also checks both visible drawdown listings. |
| 5. Examples and browser replay | Approved with the evidence limits below. The browser imports the checked-in example and independently derives the installed replay's numerical expectations. |
| 6. Verification self-review | The full-suite inventory failure and scrub path failure were corrected. The test-only inventory change is `614c2177`. The regression setup working-directory correction is confined to the local test runner. [Verification results](verification.md) |

## Whole-change findings and fixes

| Finding at the reviewed revision | Fix and verification |
| --- | --- |
| An explicit partial response or cursor qualified as live history. | Capture checks the recognized partial and paging markers and declared scope at the root, in `extra` and in `extra.results_metadata`. The public mirror replay exercises these boundaries on both executors. |
| A rejected opted-in selection containing a legacy snapshot qualified the three charts. | The acquisition records a refusal that survives registration and linked transfer. The table preserves its rows and reported completeness. All four price-history recipes refuse the invalid history. The three new views also disable Apply in Parameters. Qualified input, plain backend snapshots and documented local files retain their respective behavior. |
| The default closed example clipped disclosure text. | The three price view cards allow up to half the renderer height for scrollable status. The browser checks the text rectangles of the financial scope, the shared baseline and end, and the acquisition window. The histogram window is also fully readable. |

The six Ponytail changes share installed capture and replay setup, use the shared recipe worker observer, consolidate Apply while preserving its guards, reuse validated projection omissions, and remove the duplicate file check and Rita fixture argument. The installed specs retain their independent numerical comparisons. [Verification](verification.md) · [Executor regression](../../../../../src/lib/tableExecution/rust/dailyPriceEvidence.test.ts) · [Closed-example and refusal checks](../../../../../e2e/live-price-views.spec.ts)

The capture and refusal fixes also apply to the inherited v9 live Return Summary foundation. The v10 release depends on the v9 foundation. A separate v9 release requires backporting these shared fixes into its own integration branch.

## Remaining review observations

- A targeted comparison mounted an off-tab Return Summary and histogram with a dirty, unapplied source start-date draft. In Chromium and WebKit, both remounts displayed “Calculating chart…” with stale/updating status and produced zero new recipe replies during a five-second observation. Their requests still used the committed October 12 bounds. After Run both calculated 27 pairs from the October 13 bounds. The shared producer state and remount request code matched the pre-v10 base. The permanent test qualifies committed and explicit Rita reads and the chart after Run. Pre-Run chart availability after a dirty remount remains unqualified.
- The held-response browser assertion checks that retired output is absent after route fulfillment and before releasing the replacement. A reply delayed into the interval between that assertion and the replacement could escape the browser check. The executor matrix independently exercises stale ticket rejection. [Browser hold](../../../../../e2e/live-price-views.spec.ts) · [Executor matrix](../../../../../src/lib/tableExecution/rust/dailyPriceEvidence.test.ts)
- The installed replay arrays contain positive delivered adjusted prices. The local small-multiples test specifically pins the end date on a still-visible null-price row and verifies that a later omission coordinate cannot extend it. [Small-multiples tests](../../../../../src/lib/widgetData/chartRecipes/smallMultiples.test.ts)
- Task 5 logs contain Node warnings from simultaneous `NO_COLOR` and `FORCE_COLOR` settings. The Task 6 regression runner cleared both variables.

The handoff retains the reviewed implementation on the local `codex/v10-live-price-views` branch. The final evidence records 10,358 passing client tests, 47 opt-in skips, and 90 passing browser executions. Four of those browser executions recorded geometry checks for 24 disclosure notes. [Final verification](verification.md#final-review-fixes)
