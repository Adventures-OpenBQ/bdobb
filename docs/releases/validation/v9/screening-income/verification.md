# V9 screening and income chart verification

November 19, 2026. The local candidate adds screening bubble regression, historical dividend steps and an income-statement Sankey. The independent whole-change review identified seven Important findings. The corrected candidate passed the shipping checks below. Independent re-review of the fix range is pending. [Review findings and dispositions](review.md)

## Candidate pins

| Repository | Pre-feature baseline | Tested commit |
| --- | --- | --- |
| BDOBB | `c6911588ac5d7dba748008abe6aec1ab09ab2204` | `4f5e254eeccb4daad55cb70c6616f7b205e5c5dd` |
| Canonical openbq-eodhd | `349f2de40773cf2e1d9e2993ebabf3184871c07d` | `6f9f1cb20475c3204867bf03c3f3dc5f7141ca96` |
| openbq-docker | `f1ff723e66ece8bf404a8211716a62591d464581` | `0e843db5465725f124075709528ea485618c87ad` |

The listed product heads include the review fixes. The subsequent BDOBB evidence commit updates these records and screenshots. Two historical documentation-only commits in the BDOBB product history, `a1083ea57364b29015824e6561f5ab698e63169f` and `5e0430a1b5e4cf52fd5d36d74a0b108b48700205`, concern the separately planned eight chart families. The three candidate branches are local `codex/v9-screening-income` branches. The earlier BDOBB #87, provider #5 and Docker #32 PRs were preserved.

## BDOBB shipping checks

Node 26.13.0, pnpm 10.34.4 and Vite 6.4.3 ran the final application checks. The native test command used Rust 1.98.1.

| Command | Exit | Result |
| --- | ---: | --- |
| `pnpm typecheck` | 0 | TypeScript passed. |
| `pnpm lint` | 0 | ESLint passed. |
| `pnpm test:run` | 0 | 9,596 passed in 515 files, 47 skipped in seven files, zero failed. Includes ten paired TypeScript and compiled Rust/Wasm financial-evidence projection tests. |
| `pnpm scrub` | 0 | Content and source header scans passed. |
| `pnpm test:web` | 0 | 57 passed, zero failed or skipped. |
| `pnpm build` | 0 | 3,873 modules transformed. Production assets and source maps emitted in 15.81 s. |
| `pnpm pivot:verify` | 0 | The packaged Wasm artifacts matched the pinned build inputs and artifact hashes. |
| `pnpm pivot:test` | 0 | 200 native tests and 19 wire codec tests passed, zero failed or skipped. |

Task 4 built and initialized the emitted module for native Statement placement. Task 6 ran `pnpm pivot:build` after changing the native dividend ex-date alias projection, initialized the rebuilt module and negotiated protocol 1. The final product gate verified the artifact hashes and ran the full native and application tests.

The seven opt-in integration suites under `src/test/integration` account for all 47 Vitest skips. They are `rita-authoring-live` (12), `rita-table-model-live` (4), `agent-conformance-live` (13), `workspace-login` (1), `real-endpoints` (5), `reference-backend` (6) and `rita-live` (6). The pre-feature unit baseline passed 9,367 tests in 509 files with the same 47 skips. Both runs emitted 1,734 React `act` warnings across 150 cases. The existing TableRenderer diagnostics include the dropped `close` column and two jsdom canvas-context messages. The final and baseline Vite builds both reported mixed dynamic and static imports for the logger and dashboard store, and chunks over 500 kB after minification.

## Chromium acceptance

Playwright drove the real BDOBB UI against the companion fixture backend. The final run passed 14 tests in 55.8 s, with five screening and income cases, four existing chart-recipe cases and five existing risk-exposure cases. Zero tests failed or skipped. Node emitted the existing warning that `FORCE_COLOR` overrides `NO_COLOR`.

Run these from the BDOBB root in separate terminals. The output paths designate writable scratch directories.

```sh
BDOBB_BROWSER_PORT=17419 BDOBB_MOCK_PORT=17420 node scripts/browser.mjs

BDOBB_BROWSER_PORT=17419 BDOBB_MOCK_PORT=17420 \
  PLAYWRIGHT_HTML_OUTPUT_DIR=/tmp/fix-browser-report \
  pnpm exec playwright test e2e/screening-income.spec.ts e2e/chart-recipes.spec.ts \
  e2e/risk-exposure.spec.ts --project=chromium --output /tmp/fix-browser-results
```

- The explicit US screener fixture delivered seven rows. The August 31 cohort plotted four with unweighted N = 4 and R² = 0.609524. The actual SVG diameters of 48 px and 24 px correspond to a fourfold difference in capitalization. Hover exposed the original capitalization, both percentages and the qualified listing. Filtering to one point withheld the fit. Filtering away a conflicting acquired row still refused the cohort until a clean refresh. [Desktop light capture](screenshots/bubble-desktop-light.png)
- The verified dividend fixture displayed split-adjusted GBP per current share within the inclusive January–June window. Hover showed the March 17 special distribution at 0.375 GBP. Filtering to quarterly payments left three markers and two disconnected step segments. The omitted ex-date ended the first hold. An unknown-coverage refresh cleared the plot. Verified reacquisition and relinking repaired it. [Filtered gap capture](screenshots/dividend-filtered-gap.png)
- The USD × 1000 FY 2026 Sankey drew ten nodes and nine ribbons. Revenue was 100, cost of revenue 40 and gross profit 60. The derived operating deduction was 30 with an aggregate operating-expense value of 70 in the Statement. Mouse and touch hover exposed the original values. Unknown scale cleared the plot and a verified snapshot restored it. Conservative tooltip contrast bounds at the native opacity were 10.90:1 and 5.32:1 for dark nodes and links, and 11.18:1 and 6.50:1 for light nodes and links. [Desktop dark capture](screenshots/income-desktop-dark.png) · [Touch link capture](screenshots/income-touch-link.png)
- A 390 px emulated touch viewport tapped Sankey links and nodes and scrolled the overflowing plot to net income at 20 USD × 1000. Resizing preserved the analysis revision and node order. Finger drags zoomed the fitting bubble and dividend plots. [Scrolled touch capture](screenshots/income-touch-net-income.png)
- Native export preserved the applied price cohort, disabled fit and selected fiscal column. A second page imported it, made three new opted-in source requests and plotted changed response values. The export excluded rows, receipts, retrieval timestamps and snapshot certification. [Fixture workspace and HTTP server](../../../../examples/v9-screening-income/README.md)

- The paired image generated the screening widget and normalized the fixture return from 5 percentage points to a stored 0.05. Chromium rendered the actual source-table cell as **5 %**. The same test on the earlier paired image rendered **0.05 %**. [Generated source table](screenshots/paired-formatted-table.png)
- The narrow-span case admitted three listings with X values 0.1, 0.10000000000000002 and 0.10000000000000003. At 780 × 480, all three marker centers fell at x = 347.5 inside the 695 px domain and at distinct y coordinates 282.87, 163 and 43.13. Both fitted endpoints coincided with the sample extremes. At widths 390 and 1100, the three centers fell at 152.5 and 507.5 respectively. The fit retained the input fractions and R² of 1. [780 × 480 plot](screenshots/narrow-span-regression.png)

## Production JavaScript bytes

Baseline and candidate used `pnpm build`. This comparison includes all 14 emitted JavaScript files and excludes source maps, CSS, Wasm binaries and other assets. Raw counts are file lengths and gzip counts use Node's default `gzipSync` on the file bytes. The paired fix build emitted `recipe.worker-DNrVM__9.js` and `index-PxkeL3Sv.js`.

| Vite output | Baseline raw | Candidate raw | Raw change | Baseline gzip | Candidate gzip | Gzip change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Application index | 3,397,908 | 3,513,473 | +115,565 | 1,099,644 | 1,135,944 | +36,300 |
| Recipe worker | 51,200 | 99,687 | +48,487 | 17,507 | 33,925 | +16,418 |
| TypeScript table worker | 253,414 | 274,519 | +21,105 | 79,835 | 86,350 | +6,515 |
| Rust table worker bridge | 100,220 | 110,261 | +10,041 | 31,593 | 34,809 | +3,216 |
| Help dialog | 728,512 | 732,146 | +3,634 | 245,303 | 246,576 | +1,273 |
| All JavaScript | 7,839,973 | 8,038,805 | +198,832 | 2,455,175 | 2,518,895 | +63,720 |

Task 7 separately bundled the Plotly wrapper and recipe worker with the same local esbuild options at the pre-Sankey and Task 7 heads. The Plotly wrapper with traces grew from 1,238,815 to 1,366,659 minified bytes with CSS excluded, a change of **127,844 raw and 35,957 gzip bytes**. The standalone worker grew from 75,507 to 97,911 minified bytes, a change of **22,404 raw and 8,028 gzip bytes**. The standalone wrapper measures the Sankey trace registration in isolation. The production index measures the output of Vite's whole application build, and the recipe worker is separately emitted. The sole added registration is `plotly.js/lib/sankey`. The package manifest and pnpm lockfile match the pre-feature baseline.

## Canonical provider

The full provider suite ran in the prepared Python 3.12.13 environment with a socket audit hook. It raised `OSError` on `socket.connect` to preserve connection-error test behavior. From the canonical checkout, with its prepared environment active, the command was equivalent to:

```sh
python - <<'PY'
import sys
import pytest

def deny_network(event, args):
    if event == "socket.connect":
        raise OSError("Offline verification: network disabled")

sys.addaudithook(deny_network)
raise SystemExit(pytest.main(["-q"]))
PY
```

Exit 0. **539 passed, one skipped, one warning** in 1.85 s. The skip is the optional ArcticDB integration, which requires `openbb_arcticdb.utils`. OpenBB Core emitted the existing `DeprecationWarning: Inheritance class ClientSession from ClientSession is discouraged` from `openbb_core/provider/utils/client.py:63`. The baseline was 511 passed, one skipped and the same warning.

## Docker image and source pin

The final source comparison matched all **121 canonical paths, modes, Git blob IDs, bytes and SHA-256 manifest entries**. The canonical root tree and `v9/eodhd/source` both resolve to `44d643057e12e009ddd9f3e4ea9be540d2839f4a`. Docker records the exact canonical commit and provider version 9.0.1 in `v9/eodhd/source.json`. The package verification checked all **86 installed provider files** against that manifest. The generated mirror router, eight-card EODHD app, Dockerfile and dependency lock match the Docker baseline.

To reproduce the Git tree comparison, run the first command in the canonical checkout and the second in the Docker checkout. The Docker source-pin test checks the vendored files against the manifest.

```sh
git rev-parse '6f9f1cb20475c3204867bf03c3f3dc5f7141ca96^{tree}'
git rev-parse 0e843db5465725f124075709528ea485618c87ad:v9/eodhd/source
```

The local fix candidate was built with Docker 29.9.3, target `v3`, platform `linux/arm64`. Its verified OCI digests are:

| Object | Digest |
| --- | --- |
| Index | `sha256:44976f3671e5642c30808316d147e40bd841404455bad9c29aa1dbbd8f18d74b` |
| Platform manifest | `sha256:9fd705a80765116708c27e7089f8667341d7e14091996e7bf7516c72374e90eb` |
| Image config | `sha256:7b782d2a4d74ed5960d1210f99ff188ad038bd47bb316f285991150e5a9a2eeb` |

Run from the Docker checkout. `$PYTEST_DEPS` denotes the prepared pytest dependency directory mounted for the offline run.

```sh
docker build --progress=plain --target v3 -t openbq-screening-fix .

docker run --rm --network none -e PYTHONPATH=/testdeps \
  -v "$PYTEST_DEPS:/testdeps:ro" -v "$PWD/v9/eodhd:/qualification/v9/eodhd:ro" \
  -w /qualification openbq-screening-fix \
  python -m pytest v9/eodhd/tests -q -p no:cacheprovider

docker run --rm --network none -v "$PWD/v9/eodhd:/check:ro" \
  openbq-screening-fix python /check/verify.py
```

| Check | Exit | Result |
| --- | ---: | --- |
| Build | 0 | 16 build-time EODHD verifier checks passed. Videos, EconDB, yfinance, v4 calendar/fundamentals and `pip check` also passed. |
| Runtime pytest | 0 | 17 passed and two subtests passed in 181.13 s, with one baseline aiohttp warning. |
| Runtime verifier | 0 | 16 passed in 169.981 s. |

The same final image supplied the build, runtime, installed-wheel and generated-cell evidence. Its build-time EODHD verifier ran 16 tests in 93.774 s. The build emitted the familiar pip root-user and upgrade notices and EconDB error-fixture messages.

The packaged checks ran through the generated OpenBB/FastAPI routes with upstream SDK fixtures. They exercised opt-in receipts and legacy responses, including the legacy empty-dividend HTTP 204. Fixtures also tested normalized screener units, dividend omissions and payment currency, statement reporting currency and the existing acquisition call counts.

The provider week-boundary regression normalizes 2025-02-01 from a January fiscal year-end issuer in both yearly and quarterly buckets. The actual returned quarterly snapshot fed the TypeScript and compiled Rust Statement engines with separate display-calendar bindings. The title read “HSBA.LSE · Income Sankey / FQ · 2025-02-01 · USD × 1000”. Ordinary legacy statements retain their earlier fiscal labeling.

## Verification limits

- `/api/v1/eodhd/equity/screener` was exercised through the packaged route with a stubbed upstream response. The explicit US example verifies the delivered page's semantics and makes no market-universe or live entitlement claim.
- `/api/v1/eodhd/equity/fundamental/dividends` supplies unknown coverage on the live route, including when the upstream array is empty. Dividend steps refuse unknown or clipped coverage. The positive chart relies on an independently evidenced fixture window.
- `/api/v1/eodhd/equity/fundamental/income` can supply statement-owned reporting currency and period facts, with unknown monetary scale on the live route. Income Sankey refuses that receipt. The positive chart relies on a fixture declaration of USD × 1000.
- Browser acceptance covers desktop and emulated touch in Chromium. Physical touch hardware, Safari and native Tauri interactions remain unverified. Live EODHD availability, entitlements and provider measurements were outside the offline test runs. The local Docker image was neither published nor deployed.
