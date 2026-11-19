# V9 financial chart expansion verification

The local candidate rendered all seven charts in Chromium and restored them from a BDOBB Workspace export. The packaged estimates route returned its three guard states in an offline HTTP query. This record covers the implementation tested on 2026-11-19. Independent whole-branch review is complete; all eight Important and four original Minor findings are addressed. See the [review outcome](review.md).

## Repository pins

| Repository | Product base | Tested candidate |
| --- | --- | --- |
| BDOBB | `a96b96195619e0c66f416bb8fb929bb8dac18cd7` | `27b4a56bff6fe3fbc7d57bcde42f0741c73f0eff` |
| openbq-docker | `159e0db6c8209cf21c2e940e3845ad9561ba90a5` | `f1ff723e66ece8bf404a8211716a62591d464581` |
| openbq-eodhd | `5341fbf5031f6e65e6ee74eaf62fd56b069ba38c` | `349f2de40773cf2e1d9e2993ebabf3184871c07d` |

The BDOBB packaging change starts at `1ae04481fb6ec6cd2ca0ce4a04c3a366c4947519`. The provider includes guarded estimates, its inclusive 10% threshold and the shipped v9.0.1 error, redaction, calendar and dividend-yield fixes. The reviewed provider also preserves reported quarters when an optional analyst count is nonfinite. Its tests use an inert SDK placeholder. Package version is 9.0.1. The separate existing provider tag `v9.0.1` resolves to `59603cc1957b01af98b75be257520b0f48a637fc`.

Docker's `v9/eodhd/source.json` records the exact provider commit and SHA-256 digests for all 118 tracked files. The vendored directory and canonical commit have the same Git tree, `60e1d3f87747bf2eff1830748d6a6bcd581a3911`. There are zero packaging edits in this tree. Run these commands in the respective repositories to verify the identity.

```sh
git -C "$DOCKER_REPO" rev-parse f1ff723e66ece8bf404a8211716a62591d464581:v9/eodhd/source
git -C "$PROVIDER_REPO" rev-parse '349f2de40773cf2e1d9e2993ebabf3184871c07d^{tree}'
```

The public web preview retains its published v9 Docker pin `d81131133fbdf850db8f854ae5c08d1c496d0dd7` and vendored policy SHA-256 `9bb645fcc139e399f36a03fd53521a21942c92884d0253c9d7d35705a6876361`. The existing policy accepted the exact candidate earnings-vs-estimates URL, including its symbol and provider query. The web security test asserts this and the image checks verify the corresponding endpoint and widget.

## BDOBB gates

The following commands ran individually and in order on arm64 macOS, using Node 26.13.0, pnpm 10.34.4, Playwright 1.62.1 and Chromium 151.0.7922.34. The table-engine tests used the prepared repository WASM build.

| Command | Exit | Observation |
| --- | ---: | --- |
| `pnpm install --frozen-lockfile` | 0 | Lockfile up to date. pnpm reported ignored dependency install scripts. |
| `pnpm typecheck` | 0 | TypeScript passed. |
| `pnpm lint` | 0 | ESLint passed. |
| `pnpm test:run` | 0 | 9,190 passed, 47 skipped. Seven opt-in integration files cover live Rita, agent, login and backend services. |
| `pnpm scrub` | 0 | Both public-content and license-header checks were clean. |
| `pnpm test:web` | 0 | 57 passed, including the guarded query route. |
| `pnpm build` | 0 | Production assets and source maps emitted. Vite reported its chunk-size advisory. |
| `pnpm exec playwright test e2e/chart-recipes.spec.ts --project=chromium` | 0 | Four tests passed with a real module worker and Plotly. |

The first full suite exposed an explicitly selected custom numeric price field from an untyped raw snapshot. It was refused before the currency comparison. A worker-level case reproduced the failure. The shared role check can establish an undeclared custom field's numeric type from the delivered observations while enforcing declared types, origin exclusions and raw-column requirements. Direct input, projected output, mixed values, provider origin and currency-specific messages passed their focused checks.

### Production bytes

Totals include every regular file under `dist`, including source maps. Both builds used the same dependency lockfile.

| Output | Base | Candidate | Change |
| --- | ---: | ---: | ---: |
| Files | 128 | 130 | +2 |
| Total bytes | 45,921,262 | 46,767,826 | +846,564 |
| JavaScript bytes | 7,626,953 | 7,801,530 | +174,577 |
| Source map bytes | 27,723,098 | 28,395,085 | +671,987 |

The recipe worker is 34,367 bytes, plus a 145,300-byte source map. Comparing `src/lib/plotly.ts` to the product base shows three additional trace modules, `pie`, `indicator` and `waterfall`. The five new recipes reuse scatter or heatmap. Package and lockfile diffs against the product base are empty.

## Browser and fixture evidence

Import the [native dashboard](../../../../examples/v9-chart-expansion.apps.json) with its [fixture connection](../../../../examples/v9-chart-expansion/README.md). The desktop example uses four source tables from a local static server. Its workspace export records chart settings, Statement intent and links. Running the companion server supplies the fictional rows again when restoring the export.

| Chart | Light | Dark | Browser observations |
| --- | --- | --- | --- |
| Drawdown | [Light](screenshots/light-drawdown.png) | [Dark](screenshots/dark-drawdown.png) | Separate filled paths across missing prices. A new gap preserves hidden symbol traces and data zoom. Card resize preserves zoom. |
| Yield curve | [Light](screenshots/light-yield-curve.png) | [Dark](screenshots/dark-yield-curve.png) | An observed date stays hidden across date insertion and removal. A narrow touch card retains 12 numeric maturities and separates its visible tick labels. |
| Monthly returns | [Light](screenshots/light-monthly-returns.png) | [Dark](screenshots/dark-monthly-returns.png) | Three real hovers distinguish zero, missing price and incomplete current month. A fixed local April 30 clock crosses May 1 in UTC. |
| Correlation | [Light](screenshots/light-correlation.png) | [Dark](screenshots/dark-correlation.png) | Pairwise N and paired date bounds appear on hover. Constant-series cells explain unavailable variance. All six symbol labels appear on the narrow layout. |
| Estimate ranges | [Light](screenshots/light-estimate-range.png) | [Dark](screenshots/dark-estimate-range.png) | All four quarters retain axis slots, including the trailing withheld quarter and its diagnostic. |
| Bullet | [Light](screenshots/light-bullet.png) | [Dark](screenshots/dark-bullet.png) | Switching quarters updates actuals and consensus. The fresh redraw keeps each bar above its range. |
| Waterfall | [Light](screenshots/light-waterfall.png) | [Dark](screenshots/dark-waterfall.png) | A real Other residual reconciles the bridge. Moving a cost to Income and reordering it in the Statement editor preserves its negative step after export/import. |

The same run filtered and removed the price source, observed stale, paged and recovered states, changed correlation lookback, and reopened the native export in a separate page. [Stale completed chart](screenshots/stale.png) and [paged acquisition refusal](screenshots/refusal.png) show the two distinct states. All 16 checked-in captures were reviewed. Browser and companion fixtures use deterministic data in the existing test transport. The browser gate covers Chromium desktop and touch emulation.

The explicit acquisition envelope uses the local JSON table decoder for ordinary backend tables. Complete or bounded evidence arrives with the rows. The adapter tests exercise TypeScript and Rust worker projections, including refusal of explicitly paged envelopes. For a dotted table selector such as `results.rows`, an HTTP regression exercises the actual backend adapter and yield curve. The receipt and rows survive selection, fiscal relabelling on either tab and date-bound parameter resolution. Paged snapshots refuse yield history. Ordinary results arrays keep their table rows and have unknown history coverage. Chromium verified the yield chart refuses a bare array and recovers on receipt of a bounded snapshot. The live SSRM executor keeps its paged contract. An episode-9 catalogue sync in a temporary directory emitted the same 16-app output before and after this change (SHA-256 `2078bfeb26e109a32cd3be1e5bcc238826150c92e509c0bc60123a699425c9ed`). The checked-in Docker catalogue has its pre-existing separate digest and has no packaging diff.

Both local table engines preserve estimate comparison checks through a linked table. Hiding an inconsistent or partially missing currency leaves a repair message. Projected rows carry only requested cells. A canonical feed can omit a currency column. The estimate-range control and worker bind the fiscal period end through its source field. A multi-row bullet requires one instrument and unambiguous quarter keys. The renderer respects withheld and missing provider bands, including the recorded consensus fallback. A pending or failed relink clears the old bullet or waterfall, and a successful relink draws the new source with a distinct Plotly revision.

## Provider and Docker gates

The prepared provider environment used Python 3.12.13, OpenBB Core 2.0.1 and the standard routers. A Python socket audit hook blocked network access. Provider credentials were unset. The local Docker 29.9.3 build produced Linux/arm64 image `sha256:7eb8decbad0e1afb68e940b755c4899e23fa8adcac62a2ac7754e032eb7630cc` with the locked 2.0.1 core/platform API and 9.0.1 extension.

| Command | Exit | Observation |
| --- | ---: | --- |
| `python -m pytest tests -q` in provider | 0 | 511 passed, one optional ArcticDB integration skipped, one upstream aiohttp deprecation. |
| `ruff check openbq_eodhd/models/estimates.py tests/test_earnings_vs_estimates.py` in provider | 0 | Canonical helper and route tests passed. |
| `python3 scripts/check-public.py` in Docker | 0 | Public-content scan passed, including the vendored tests. |
| `docker build --target v3 --progress=plain --iidfile /tmp/chart-final-fix-image .` | 0 | Local image built with no image tag. |
| `python -m pytest -p no:cacheprovider v9/eodhd/tests/test_stack.py v9/eodhd/tests/test_source_pin.py tests/test_images.py -q` in image | 0 | 20 passed, four subtests passed, one upstream deprecation. |
| `python v9/eodhd/verify.py` in image | 0 | Nine stack checks passed. Verified 53 mirrors, their widget routes, the EODHD app, a stubbed price query and authenticated app loading. |
| Offline HTTP query using FastAPI TestClient in image | 0 | HTTP 200. The recorded provider fixture yielded no_estimate for 2025-06-30, ok for 2026-06-30, and withheld for 2026-09-30, with both withheld averages null. The approved quarter retained EPS average 1.8924 and returned null for its two malformed optional analyst counts. |
| `git diff --check` and `git diff --cached --check` | 0 | Scoped changes passed whitespace checks. |

The image test containers used `--network none`, a read-only checkout at `/review`, and the prepared pure-Python pytest modules at `/pytest` for the focused suite. The HTTP probe stubbed only the provider's two upstream fundamentals reads, using the canonical test’s recorded inputs and nonfinite analyst counts for the approved quarter. An inert placeholder satisfied local router credential validation. Validation did not use live provider accounts or NAS deployment.

## Review and handoff

The independent whole-branch reviewer approved the consolidated fix wave with no open Critical or Important findings. [Per-finding dispositions](review.md) and [execution rulings with their costs](rulings.md) are preserved beside this record. A duplicate source-error notice on failed bullet/waterfall relinking is the one accepted nonblocking follow-up.

A controller-run full verification on the reviewed code returned 9,190 BDOBB tests passed with 47 opt-in skips and 511 provider tests passed with one optional ArcticDB skip. All 118 packaged file hashes and the canonical/vendor Git tree were independently rechecked. The code and image pins above remain unchanged by this documentation handoff.

## Source-error follow-up

BDOBB `d423622ce6892ce330d1065e01392674fc606122` keeps the source failure alert in `LinkedCardBody`. A WidgetCard regression reproduced two alerts for the same failed relink before the fix. Both bullet and waterfall now display one alert, keep the old source's plot cleared while the new source is pending or blocked, and redraw with the recovered source's data and revision after Refresh. Separate renderer tests exercise chart-read and settings-save errors and a stale financial recipe after a failed refresh.

| Command | Exit | Observation |
| --- | ---: | --- |
| `pnpm test:run src/components/WidgetCard.linked.test.tsx -t 'announces a failed'` | 1 before fix, 0 after fix | Both cases failed on duplicate alerts, then passed. |
| `pnpm test:run src/components/WidgetCard.linked.test.tsx src/components/renderers/LinkedChartRenderer.test.tsx src/stores/tableExecutionStore.test.ts` | 0 | 160 passed. |
| `pnpm typecheck` | 0 | TypeScript passed. |
| `pnpm lint` | 0 | ESLint passed. |
| `pnpm test:run` | 0 | 9,194 passed, 47 opt-in skips. Existing React `act(...)` warnings appeared in unrelated tests. |
