# Published-PR independent scoped re-reviews

Fresh Ponytail full and Superpowers reviews covered PRs #89, #6 and #33. The original reports are preserved in published-pr-reviews.md. This record captures their scoped re-review after the corrections and eight simplifications. Raw probes, commands and execution logs remain in the local PR-review evidence workspace; artifact names below identify them.


## Superpowers provider and Docker

- **Mixed-case listing declarations — ADDRESSED.** In provider `75a9026`, `openbq_eodhd/models/_daily_price_chart_source.py:139` checks every recognized identity declaration before normalization. Agreeing `code` and `Code` retained six rows. Conflicting declarations on retained and dropped rows produced `identity_conflict`. The chart refused the original wrong-ticker input and accepted the unchanged six-quote control. Client `0490aa8` validates selected row entries and projected origins in `dailyPriceEvidence.ts:102`, `:154` and `:196`. The correction preserves the existing .US listing namespace. Provider controls (`fix-evidence/review-raw-after.log`) · Client controls (`fix-evidence/review-client-after.log`) · Original chart probe (`fix-evidence/review-chart-after.log`)
- **Partial and continuing arrays — ADDRESSED.** Provider `_daily_price_chart_source.py:130` applies one case- and underscore-insensitive check to the existing marker families. On both installed equity and ETF mirrors, declaring `isPartial` or `nextCursor` on the second listing returned HTTP 502 after one call per requested symbol. The plain, genuinely unpaged and counted-empty controls retained their expected responses. The client rejects a delivered marker before using its value at `dailyPriceEvidence.ts:104`. Installed HTTP controls (`fix-evidence/installed-wire-controls.log`) · Canonical alias controls (`fix-evidence/canonical-wire-controls.log`)
- **Duplicate without an original coordinate — ADDRESSED.** Provider `_daily_price_chart_source.py:103` rejects a safe receipt that assigns its only raw row to the duplicate count. The unchanged reproduction raised the expected Pydantic validation error. Genuine empty arrays, valid duplicates, and known omitted originals remain covered by the focused tests. Original probe (`fix-evidence/review-raw-unchanged-after.log`) · Focused tests (`fix-evidence/provider-focused.log`)

### New breakage in the fix diff

None found. The provider's strict bounds on date strings and numeric types still guard the shared date and finite-number helpers. All 23 recorded boundary cases matched. Array-error precedence, acquisition-time assertions and the fresh shallow copy of the scalar-only mock bar retain their previous behavior. Boundary results (`fix-evidence/helper-equivalence.log`) · Provider suite, 965 passed and one optional skip (`fix-evidence/provider-full.log`)

Docker `2c54646` vendors exactly provider tree `35e2586eca1f6b39527412188879eb133639d026`. The corrected standalone pin test points to `75a902664054b3afbd23c5b6328efe7eedcf429c`. The final arm64 image index is `sha256:f8cca8ee400a88f4ae331bc498c9e28520e9ff766410926bbfdac0e4edd29404`. All 151 vendor paths, 95 installed provider files and 104 wheel RECORD entries reconciled. The installed suite passed 26 tests and 47 subtests. Its effective Requests bundle used certifi 2026.10.23. The public GET retained 29 quotes and 28 observed pairs for each listing. Vendor audit (`fix-evidence/vendor-parity-final.log`) · Wheel and trust audit (`fix-evidence/installed-package.log`) · Installed tests (`fix-evidence/installed-pytest.log`) · Public capture (`fix-evidence/public-http.log`)

### Out-of-scope observations

None added. The previously documented arm64 and standard-router dependency limits still apply.

### Verdict

**All three findings are addressed, with no new Critical or Important breakage.** Provider PR 6, Docker PR 33 and their integration are ready from this scoped review.


## Superpowers client and integration

# Scoped Superpowers re-review of BDOBB PR 89 and the paired source contract

**Verdict: approved for the corrected client and paired integration.** Reviewed the 18-file client follow-up from `21a5b092fc00797dedc41054d09d6fcba911c6e8` to `0490aa8456c472c6fb4c6f0393656f4d35824f01`, the corresponding acquisition changes at provider `75a902664054b3afbd23c5b6328efe7eedcf429c`, and the Docker pairing at `2c5464675090c73f0c52cf8482ccf454e07b7704`. The original full review remains in the published-head report (`superpowers-client-review.md`).

## Original finding

**Important — conflicting listing declarations: ADDRESSED.** I reran both unchanged probes. For a request for MCD.US, the canonical fetcher flagged both `Code=MSFT, Exchange=TO` and `symbol=MCD.US, Ticker=MSFT.US` as `identity_conflict`, with six raw and zero delivered rows. The client independently refused both selected arrays. The lowercase conflicting control was refused and the unlabeled positive still produced five returns. Fresh provider results (`rereview-provider-identity.log`) · Fresh client results (`rereview-client-identity.log`)

Provider reconciliation now inspects each original identity declaration before normalization. Client `src/lib/widgetData/chartRecipes/dailyPriceEvidence.ts:101` checks every recognized selected-row declaration. `acquiredFields` at line 172 preserves each original spelling as a separate field, and `presentedRowsAgree` checks each acquired declaration before a worker can hide it. Exact canonical date, adjusted close and required multi-listing symbol bindings are preserved. The new positive and negative tests include agreeing simultaneous case variants and an aliased conflict removed by a later filter in each executor. Admission tests (`../../src/lib/widgetData/chartRecipes/dailyPriceEvidence.test.ts`) · Both-engine tests (`../../src/lib/tableExecution/rust/dailyPriceEvidence.test.ts`)

**Previously noted Minor — empty-source repair message: OPEN, unchanged.** A fully filtered live source may report that no valid daily prices remain before reporting an invalid saved binding. The request excluded this diagnostic-ordering change. Neither case renders a chart.

## Follow-up changes checked

- Client marker canonicalization mirrors the provider's by-presence rule for the established continuation names, including mixed-case, snake-case and camel-case forms. The raw provider defect that could produce an admitted successful subset now aborts the acquisition, and a contradictory selected or projected client input loses authority. The source's safe duplicate invariant agrees with the client. Original probe reruns (`fix-evidence/review-raw-after.log`) · Installed route controls (`fix-evidence/installed-wire-controls.log`)
- `chartSourceContracts.ts:177` calls one coordinate callback with the originating provenance. Daily-price admission still requires reconciled captured coordinates. The other adapters keep their receipt-based implementations. The metric and estimate adapters preserve definite one-argument results through `satisfies`. The extracted exact-key and count predicates match both previous implementations, including descriptor, own-property and safe-integer checks.
- The shared Playwright fixture observes successful WASM responses before navigation. Both suites retain their engine assertions, and the installed suite still checks the ordered worker samples and attaches the source request evidence. The corrected active fixture path identifies `75a9026`. The recorded runs passed 48 live and 20 installed cases with zero retries across both engines in Chromium and WebKit. The four installed modes recorded two initial development requests, with one WASM download in each compiled-Rust case and none in TypeScript. Browser evidence (`fix-evidence/browser-summary.log`)
- I independently recalculated all dates and returns from the new captures, verified per-GET selector and SDK request order, and compared their file hashes. The four deterministic routes yielded 7 MCD.US and 9 AAPL.US returns. The actual public equity capture matched the direct arrays and yielded 28 returns from 29 prices for each listing. All six historical captures remain intact. The canonical tree and Docker vendor subtree independently resolved to the identical Git object `35e2586eca1f6b39527412188879eb133639d026`. Fresh capture comparisons (`rereview-client-captures.log`) · Image attribution (`fix-evidence/image-identities.json`)

## New breakage

No new Critical, Important or Minor findings in the fix range. The corrected identity and continuation checks apply consistently across the examined boundaries. The fixed-window calculations, chart scope, and prior source lifecycle remain supported.

## Evidence and scope

The fresh independent executions were the two original identity probes and the capture calculation. For the broader gates I inspected the current qualification logs: 132 focused client tests, 10,275 full client passes with 47 optional skips, 965 provider passes with one optional skip, and 26 installed tests plus 47 subtests. The replacement image index is `sha256:f8cca8ee400a88f4ae331bc498c9e28520e9ff766410926bbfdac0e4edd29404`. The earlier production-mode one-GET probe is attributable to the original head. The corrected browser matrix uses the development harness.

**Declined to judge:** behavior outside this corrective diff was covered by the original complete review. Physical devices, amd64, standard routes under a dependency-consistent Core 2 installation, additional entitlements and session completeness remain outside the recorded qualification.


## Ponytail full

# Ponytail full follow-up review

All eight findings are addressed. The three PRs remove 38 hand-maintained lines through these changes. No further complexity finding in the follow-up diff.

| Original finding | Disposition at reviewed head | Net lines |
| --- | --- | ---: |
| Client coordinate callback | `sourceState` calls `coordinates(receipt, provenance)` once and rejects an unavailable result. The daily adapter reads its captured coordinates. The metric and estimate adapters retain definite one-argument signatures for their direct callers. | −5 |
| Client shape predicates | Daily-price and ETF hierarchy decoders now import the same exact-keys and count predicates. They retain descriptor-aware plain-record checks, own-key equality and nonnegative safe integers. | −2 |
| Browser runtime fixture | Both suites import the same automatic viewport and WASM observer fixture. Its teardown verifies the engine on passing cases. Installed replays still attach per-view worker samples and the HTTP request record. | −8 |
| Provider ISO date parser | The string and ten-character guards precede the existing ISO round-trip parser. The returned value is the original string. The recorded equivalence check covers ten date inputs. | −5 |
| Provider price validator | The strict int/float and positive-value checks precede `finite_number`, which rejects infinities and catches overflowing integers. The recorded equivalence check covers thirteen inputs. | −5 |
| Provider response guard | Malformed/error objects still receive priority over continuation markers. A wrapper without either still fails the final array check. The guard runs before any successful listing is returned. | −3 |
| Provider clock doubles | The two `SimpleNamespace` objects provide the `now` method each bounded daily path calls. They return distinct instants, and the test still asserts the acquisition timestamp. | −9 |
| Docker mock copy | Each SDK call returns a fresh list and a fresh dictionary. Every `BAR` value is a string or number. | −1 |

I checked the commit diffs for client PR #89 (`21a5b092..0490aa84`), canonical PR #6 (`adb2e2e4..75a90266`), and Docker PR #33 (`52436dd8..2c546467`). Git line counts give −15 for client simplification commit `ef7fd0ab` and −22 for provider simplification commit `75a90266`. The Docker mock hunk accounts for the remaining −1. The total excludes regression coverage, required validation, release records, new wire captures and generated vendor copies. I compared the three changed canonical files byte for byte with the Docker mirror and checked that the installed replay selects the corrected `75a9026` captures.

The identity checks examine simultaneous aliases before a dropped row can hide the conflict. Provider and client normalize the recognized continuation-key spellings and check marker presence. The duplicate-count invariant and its tests serve the required acquisition contract. These changes introduce no additional framework or dependency.

This was a source and recorded-evidence review. The existing logs record 965 provider tests passed with one skip, 10,275 client tests passed with 47 skips, 68 browser cases passed across Chromium/WebKit and TypeScript/Rust, and 26 installed tests plus 47 subtests passed. I did not rerun the suites. Fix report and gate evidence (`fix-report.md`)

Lean already. Ship.
