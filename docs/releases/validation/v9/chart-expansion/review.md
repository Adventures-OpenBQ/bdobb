# Final scoped re-review

**Ready to integrate? Yes.** All eight original Important findings and all four original Minor findings are addressed. I found one new Minor presentation issue and no open Critical or Important issue.

I checked the fix ranges ending at BDOBB `c1b2ee9cb320bdacb9fe6701047844125d37ca04`, canonical provider `349f2de40773cf2e1d9e2993ebabf3184871c07d` and Docker `f1ff723e66ece8bf404a8211716a62591d464581`. BDOBB's changes after tested code `27b4a56b` are confined to release notes, verification documentation and screenshot evidence.

## Original findings

| Finding | Verdict | Basis |
| --- | --- | --- |
| F1. Backend page treated as complete yield history | Addressed | Backend arrays default to unknown with a delivered count. An explicit negative acquisition scope survives row extraction without a receipt. A complete or bounded declaration without a receipt stays unknown. The dotted-selector HTTP test covers those cases, exact-total absence and receipted positive cases. |
| F2. Bullet comparing two instruments | Addressed | Bullet requests presented symbol identities and checks them against acquisition-bound evidence. Multi-row comparisons require a single instrument. Duplicate dates, ambiguous selected periods and duplicate normalized fiscal keys refuse. Single-row unguarded legacy numeric bullets remain supported. |
| F3. Bullet ignoring provider status | Addressed | The requested fields include the source guard and note. Withheld, missing and unrecognized statuses suppress Trend numbers throughout the bullet calculation. Recorded consensus remains available. Tests cover a numeric withheld row, no-estimate and a hidden guard across a linked table. |
| F4. Hidden or partly missing currency enabling estimate ranges | Addressed | The shared source evidence records affected field names and safety results. Both projection paths carry that evidence. The selected metric rechecks presented dimensions and rejects unsafe hidden ones. The regression cases include mixed and missing currency plus a second linked table whose rows omit the hidden values. |
| F5. Report date accepted as fiscal period end | Addressed | The control uses the provider-origin role. The worker entry and pure builder reject an unrelated date ID. The renamed source field test verifies a legitimate period-end alias. |
| F6. Mounted and off-tab fiscal periods differ | Addressed | Both paths use the shared fiscal-row hook. It corrects snapshot rows while preserving the enclosing acquisition evidence. The real HTTP comparison asserts FQ1/FY2026 and receipt equality on both tabs. |
| F7. Earliest/latest anchors lose snapshot rows | Addressed | The bounds helper decodes the snapshot rows. The hook test verifies the unrestricted first request, correctly resolved second request, retained original receipt and no third request. |
| F8. Old bullet/waterfall survives relinking | Addressed | Both carried chart types remount for a new immediate source and include that identity in the figure revision. The regression checks a held and failed B acquisition followed by recovery and a new revision. The completed chart status includes source and freshness. |
| Minor 1. Nonfinite optional analyst counts | Addressed | The canonical helper checks finiteness before converting to an integer. The parametrized provider test covers NaN and positive/negative infinity and retains the approved quarter's actual estimate. |
| Minor 2. Waterfall helper import cycle | Addressed | Color, escape and bounded-list helpers are in a leaf module. The dispatcher and waterfall no longer import one another at runtime. |
| Minor 3. Quadratic duplicate-label suffix search | Addressed | Suffix searches resume from the next free candidate for each base label. The global occupied-name set preserves disambiguation when genuine labels resemble generated ones. |
| Minor 4. Unbounded estimate diagnostics | Addressed | Both success and refusal paths retain five bounded messages plus the remaining count. The source table retains full details. The 20-row regression exercises both forms. |

## New findings

- **Minor. A blocked source can announce its error twice on bullet and waterfall cards.** BDOBB `src/components/renderers/LinkedChartRenderer.tsx:223` now renders the source view's error. Its normal parent already renders the same error at `src/components/WidgetCard.tsx:2224` for an eligible linked chart. On a failed relink, this yields duplicate visible messages and duplicate assertive alerts. The isolated renderer test only mounts the inner component. One component can own the source error while the renderer continues to display its own chart-data errors. The chart clears correctly, so this can follow integration.

## Verification and limits

The independently read canonical root tree and Docker vendor tree both resolve to `60e1d3f87747bf2eff1830748d6a6bcd581a3911`. The canonical commit in the Docker manifest matches the reviewed head, and I independently recomputed all 118 listed local SHA-256 digests. The application test cases above were inspected against the production changes. The reported shipping suites, Chromium runs and image/HTTP tests come from the fix report and its evidence. I did not rerun those full gates.

## Declined to judge

- Unchanged behavior outside these fix ranges. The request limits this pass to the prior findings and regressions introduced by the fixes.
- Live-provider behavior, deployment and other browser engines. Those remain outside the scoped acceptance evidence.

## Controller disposition

The duplicate source-error notice is accepted as a nonblocking presentation follow-up. The application clears the previous source's chart correctly. No Critical or Important finding remains open. The original complete review and the scoped fix review were independent of the implementation agents. All changes remain on the local candidate branches.

## Source-error follow-up

BDOBB `d423622ce6892ce330d1065e01392674fc606122` resolves the duplicate alert for bullet and waterfall cards. The card displays the source diagnostic once. The chart renderer still displays chart-read, field-validation, refusal and save diagnostics. The regression uses the actual Choose source and Refresh actions to verify the single alert, the removal of the old plot and recovery with a distinct source revision. See [follow-up verification](verification.md#source-error-follow-up).
