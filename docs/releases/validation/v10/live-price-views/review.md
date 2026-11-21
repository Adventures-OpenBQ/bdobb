# v10 live price views review

## Review status

The five scoped implementation reviews approved qualified preparation, numerical consumers, Parameters and renderer admission, both-engine filtered lineage, and examples and browser replay. The independent whole-change Superpowers and Ponytail reviews are pending. Their scope includes financial semantics, evidence qualification, UI gates, source lifecycle, actual TypeScript and Rust transport, and v10 packaging. [Approved design](../../../../superpowers/specs/2026-11-21-v9-live-price-views-design.md) · [Implementation plan](../../../../superpowers/plans/2026-11-21-v10-live-price-views.md)

| Scoped review | Disposition |
| --- | --- |
| 1. Qualified daily-price preparation | Approved. Shared admission rejects invalid live evidence and preserves local snapshot proof rules. The full suite still reports React `act` and jsdom canvas diagnostics. |
| 2. Numerical consumers | Approved. Observed pairing, across-gap peaks, and shared baseline and delivered end have focused regression coverage. Correlation and monthly returns retain snapshot-only admission. |
| 3. Parameters and renderer | Approved after correction. Queued Apply could persist settings for a replaced source. Three regression tests reproduced the stale saves. The source, revision and settings guard in `fc0faea3` passed the 92-case focused rerun and follow-up review. |
| 4. Both-engine lineage | Approved. The 46-case TypeScript/WASM matrix verifies filters, original column origins, refusal and ticket retirement. Task 5's raw-array oracle also checks both visible drawdown listings. |
| 5. Examples and browser replay | Approved with the evidence limits below. The browser imports the checked-in example and independently derives the installed replay's numerical expectations. |
| 6. Verification self-review | The full-suite inventory failure and scrub path failure were corrected. The test-only inventory change is `614c2177`. The regression setup working-directory correction is confined to the local test runner. [Verification results](verification.md) |

## Observations for whole-change review

- A targeted comparison mounted an off-tab Return Summary and histogram with a dirty, unapplied source start-date draft. In Chromium and WebKit, both remounts displayed “Calculating chart…” with stale/updating status and produced zero new recipe replies during a five-second observation. Their requests still used the committed October 12 bounds. After Run both calculated 27 pairs from the October 13 bounds. The shared producer state and remount request code matched the pre-v10 base. The permanent test qualifies committed and explicit Rita reads and the chart after Run. Pre-Run chart availability after a dirty remount remains unqualified.
- The held-response browser assertion checks that retired output is absent after route fulfillment and before releasing the replacement. A reply delayed into the interval between that assertion and the replacement could escape the browser check. The executor matrix independently exercises stale ticket rejection. [Browser hold](../../../../../e2e/live-price-views.spec.ts) · [Executor matrix](../../../../../src/lib/tableExecution/rust/dailyPriceEvidence.test.ts)
- The installed replay arrays contain positive delivered adjusted prices. The local small-multiples test specifically pins the end date on a still-visible null-price row and verifies that a later omission coordinate cannot extend it. [Small-multiples tests](../../../../../src/lib/widgetData/chartRecipes/smallMultiples.test.ts)
- In the archived closed-workspace screenshot, the small-multiples live-scope note is partially clipped at the bottom of the notes area beneath preceding notes. Browser text assertions establish that the scope is present. The image raises a readability question for the whole-change review. The screenshot is `price-views-closed.png` under the Task 5 Chromium TypeScript evidence.
- Task 5 logs contain Node warnings from simultaneous `NO_COLOR` and `FORCE_COLOR` settings. The Task 6 regression runner cleared both variables.

The release handoff remains pending the independent reviews and any focused fixes they require. The implementation, verification and scoped review record are local to `codex/v10-live-price-views`.
