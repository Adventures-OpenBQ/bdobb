# V9 screening and income chart verification

November 19, 2026. The local candidate adds screening bubble regression, historical dividend steps and an income-statement Sankey. The shipping checks below passed. [Independent whole-change review](review.md) is pending.

## Candidate pins

| Repository | Pre-feature baseline | Tested commit |
| --- | --- | --- |
| BDOBB | `c6911588ac5d7dba748008abe6aec1ab09ab2204` | `fd5edb848a3ffe0e3f6bc78a4065e310640206c5` |
| Canonical openbq-eodhd | `349f2de40773cf2e1d9e2993ebabf3184871c07d` | `5c54b403513ef5759a9c1d461da54669e2a6d91c` |
| openbq-docker | `f1ff723e66ece8bf404a8211716a62591d464581` | `fb2df569e30c618652a9eec00db95c7ec7d4ad86` |

The BDOBB test and build results refer to the tested commit in the table. The later validation document commit adds the records, screenshots and current plan and design status. Two documentation-only commits in the BDOBB product history, `a1083ea57364b29015824e6561f5ab698e63169f` and `5e0430a1b5e4cf52fd5d36d74a0b108b48700205`, concern the separately planned eight chart families. The three candidate branches are local `codex/v9-screening-income` branches. The earlier BDOBB #87, provider #5 and Docker #32 PRs were preserved.

## BDOBB shipping checks

Node 26.13.0, pnpm 10.34.4 and Vite 6.4.3 ran the final application checks. The native test command used Rust 1.98.1.

| Command | Exit | Result |
| --- | ---: | --- |
| `pnpm typecheck` | 0 | TypeScript passed. |
| `pnpm lint` | 0 | ESLint passed. |
| `pnpm test:run` | 0 | 9,575 passed in 515 files, 47 skipped in seven files, zero failed. Includes eight financial-evidence tests through the compiled Rust/Wasm path. |
| `pnpm scrub` | 0 | Content and source header scans passed. |
| `pnpm test:web` | 0 | 57 passed, zero failed or skipped. |
| `pnpm build` | 0 | 3,872 modules transformed. Production assets and source maps emitted in 17.02 s. |
| `pnpm pivot:verify` | 0 | The packaged Wasm artifacts matched the pinned build inputs and artifact hashes. |
| `pnpm pivot:test` | 0 | 200 native tests and 19 wire codec tests passed, zero failed or skipped. |

Task 4 built and initialized the emitted module for native Statement placement. Task 6 ran `pnpm pivot:build` after changing the native dividend ex-date alias projection, initialized the rebuilt module and negotiated protocol 1. The final product gate verified the artifact hashes and ran the full native and application tests.

The seven opt-in integration suites under `src/test/integration` account for all 47 Vitest skips. They are `rita-authoring-live` (12), `rita-table-model-live` (4), `agent-conformance-live` (13), `workspace-login` (1), `real-endpoints` (5), `reference-backend` (6) and `rita-live` (6). The pre-feature unit baseline passed 9,367 tests in 509 files with the same 47 skips. Both runs emitted 1,734 React `act` warnings across 150 cases. The existing TableRenderer diagnostics include the dropped `close` column and two jsdom canvas-context messages. The final and baseline Vite builds both reported mixed dynamic and static imports for the logger and dashboard store, and chunks over 500 kB after minification.

## Chromium acceptance

Playwright drove the real BDOBB UI against the companion fixture backend. The final run passed 13 tests in 46.9 s, with four screening and income cases, four existing chart-recipe cases and five existing risk-exposure cases. Zero tests failed or skipped. Node emitted the existing warning that `FORCE_COLOR` overrides `NO_COLOR`. The Sankey contrast fix also passed 123 focused tests across its builder, typed input and both linked and Plotly renderers.

Run these from the BDOBB root in separate terminals. The output paths designate writable scratch directories.

```sh
BDOBB_BROWSER_PORT=17419 BDOBB_MOCK_PORT=17420 node scripts/browser.mjs

BDOBB_BROWSER_PORT=17419 BDOBB_MOCK_PORT=17420 \
  PLAYWRIGHT_HTML_OUTPUT_DIR=/tmp/screening-task9-contrast-report \
  pnpm exec playwright test e2e/screening-income.spec.ts e2e/chart-recipes.spec.ts \
  e2e/risk-exposure.spec.ts --project=chromium --output /tmp/screening-task9-contrast-results

pnpm exec vitest run src/lib/widgetData/chartRecipes/incomeSankey.test.ts \
  src/lib/widgetData/chartRecipes/incomeSankeyInput.test.ts \
  src/components/renderers/ChartRenderer.test.tsx src/components/renderers/LinkedChartRenderer.test.tsx
```

- The explicit US screener fixture delivered seven rows. The August 31 cohort plotted four with unweighted N = 4 and R² = 0.609524. The actual SVG diameters of 48 px and 24 px correspond to a fourfold difference in capitalization. Hover exposed the original capitalization, both percentages and the qualified listing. Filtering to one point withheld the fit. Filtering away a conflicting acquired row still refused the cohort until a clean refresh. [Desktop light capture](screenshots/bubble-desktop-light.png)
- The verified dividend fixture displayed split-adjusted GBP per current share within the inclusive January–June window. Hover showed the March 17 special distribution at 0.375 GBP. Filtering to quarterly payments left three markers and two disconnected step segments. The omitted ex-date ended the first hold. An unknown-coverage refresh cleared the plot. Verified reacquisition and relinking repaired it. [Filtered gap capture](screenshots/dividend-filtered-gap.png)
- The USD × 1000 FY 2026 Sankey drew ten nodes and nine ribbons. Revenue was 100, cost of revenue 40 and gross profit 60. The derived operating deduction was 30 with an aggregate operating-expense value of 70 in the Statement. Mouse and touch hover exposed the original values. Unknown scale cleared the plot and a verified snapshot restored it. Conservative tooltip contrast bounds at the native opacity were 10.90:1 and 5.32:1 for dark nodes and links, and 11.18:1 and 6.50:1 for light nodes and links. [Desktop dark capture](screenshots/income-desktop-dark.png) · [Touch link capture](screenshots/income-touch-link.png)
- A 390 px emulated touch viewport tapped Sankey links and nodes and scrolled the overflowing plot to net income at 20 USD × 1000. Resizing preserved the analysis revision and node order. Finger drags zoomed the fitting bubble and dividend plots. [Scrolled touch capture](screenshots/income-touch-net-income.png)
- Native export preserved the applied price cohort, disabled fit and selected fiscal column. A second page imported it, made three new opted-in source requests and plotted changed response values. The export excluded rows, receipts, retrieval timestamps and snapshot certification. [Fixture workspace and HTTP server](../../../../examples/v9-screening-income/README.md)

## Production JavaScript bytes

Baseline and candidate used `pnpm build`. This comparison includes all 14 emitted JavaScript files and excludes source maps, CSS, Wasm binaries and other assets. Raw counts are file lengths and gzip counts use Node's default `gzipSync` on the file bytes. The final palette is in `recipe.worker-BdNf9U5Q.js` and this table uses the fresh final `dist/assets`.

| Vite output | Baseline raw | Candidate raw | Raw change | Baseline gzip | Candidate gzip | Gzip change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Application index | 3,397,908 | 3,508,572 | +110,664 | 1,099,644 | 1,134,510 | +34,866 |
| Recipe worker | 51,200 | 98,966 | +47,766 | 17,507 | 33,679 | +16,172 |
| TypeScript table worker | 253,414 | 273,826 | +20,412 | 79,835 | 86,177 | +6,342 |
| Rust table worker bridge | 100,220 | 109,569 | +9,349 | 31,593 | 34,638 | +3,045 |
| Help dialog | 728,512 | 732,146 | +3,634 | 245,303 | 246,572 | +1,269 |
| All JavaScript | 7,839,973 | 8,031,798 | +191,825 | 2,455,175 | 2,516,867 | +61,692 |

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

Exit 0. **537 passed, one skipped, one warning** in 2.20 s. The skip is the optional ArcticDB integration, which requires `openbb_arcticdb.utils`. OpenBB Core emitted the existing `DeprecationWarning: Inheritance class ClientSession from ClientSession is discouraged` from `openbb_core/provider/utils/client.py:63`. The baseline was 511 passed, one skipped and the same warning.

## Docker image and source pin

The final source comparison matched all **121 canonical paths, modes, Git blob IDs, bytes and SHA-256 manifest entries**. The canonical root tree and `v9/eodhd/source` both resolve to `cada8b9dc759cbf729a7f4b0719728ac5df018a9`. Docker records the exact canonical commit and provider version 9.0.1 in `v9/eodhd/source.json`. The package verification checked all **86 installed provider files** against that manifest. The generated mirror router, eight-card EODHD app, Dockerfile and dependency lock match the Docker baseline.

To reproduce the Git tree comparison, run the first command in the canonical checkout and the second in the Docker checkout. The Docker source-pin test checks the vendored files against the manifest.

```sh
git rev-parse '5c54b403513ef5759a9c1d461da54669e2a6d91c^{tree}'
git rev-parse fb2df569e30c618652a9eec00db95c7ec7d4ad86:v9/eodhd/source
```

The local Task 2 candidate was built with Docker 29.9.3, target `v3`, platform `linux/arm64`. Its verified OCI digests are:

| Object | Digest |
| --- | --- |
| Index | `sha256:7a56d854c1f1e189e154e8902a45d2ba850c12df0693b9a8e5e447f609c89df7` |
| Platform manifest | `sha256:c3bdbb55046947532303727488d27db27aa74b5f5470c6e5d2dd46b86bd00881` |
| Image config | `sha256:29194cc441478f99947697b6ba2da441fcaadb922b796b75bacb8d150558ecd1` |

Run from the Docker checkout. `$PYTEST_DEPS` denotes the prepared pytest dependency directory mounted for the offline run.

```sh
docker build --progress=plain --target v3 -t openbq-eodhd-chart-candidate .

docker run --rm --network none -e PYTHONPATH=/testdeps \
  -v "$PYTEST_DEPS:/testdeps:ro" -v "$PWD/v9/eodhd:/qualification/v9/eodhd:ro" \
  -w /qualification openbq-eodhd-chart-candidate \
  python -m pytest v9/eodhd/tests -q -p no:cacheprovider

docker run --rm --network none -v "$PWD/v9/eodhd:/check:ro" \
  openbq-eodhd-chart-candidate python /check/verify.py
```

| Check | Exit | Result |
| --- | ---: | --- |
| Build | 0 | 16 build-time EODHD verifier checks passed. Videos, EconDB, yfinance, v4 calendar/fundamentals and `pip check` also passed. |
| Runtime pytest | 0 | 17 passed and two subtests passed in 98.77 s, with one baseline aiohttp warning. |
| Runtime verifier | 0 | 16 passed in 98.500 s. |
| Final runtime fixture rerun, `-k ChartSource` | 0 | Six passed and two subtests passed in 13.75 s using the same image and final checkout tests. |

The first image was built before the final test-only edits. Runtime checks mounted the checkout read-only to pick up the refined omitted-amount assertion and the final placeholder syntax. The vendored provider tree and wheel build inputs match the Docker commit in the table. Task 2 also recorded a repeat build after the omitted-amount test refinement, with index `sha256:4568aec0403236c8c466d464b5162f77760623e721f1a872510275f7649d644f` and 16 passing build-time EODHD checks. The runtime rows above refer to the first digest. The documented build diagnostics are the existing pip root-user and upgrade notices and expected EconDB error-fixture output.

The packaged checks ran through the generated OpenBB/FastAPI routes with upstream SDK fixtures. They exercised opt-in receipts and legacy responses, including the legacy empty-dividend HTTP 204. Fixtures also tested normalized screener units, dividend omissions and payment currency, statement reporting currency and the existing acquisition call counts.

## Verification limits

- `/api/v1/eodhd/equity/screener` was exercised through the packaged route with a stubbed upstream response. The explicit US example verifies the delivered page's semantics and makes no market-universe or live entitlement claim.
- `/api/v1/eodhd/equity/fundamental/dividends` supplies unknown coverage on the live route, including when the upstream array is empty. Dividend steps refuse unknown or clipped coverage. The positive chart relies on an independently evidenced fixture window.
- `/api/v1/eodhd/equity/fundamental/income` can supply statement-owned reporting currency and period facts, with unknown monetary scale on the live route. Income Sankey refuses that receipt. The positive chart relies on a fixture declaration of USD × 1000.
- Browser acceptance covers desktop and emulated touch in Chromium. Physical touch hardware, Safari and native Tauri interactions remain unverified. Live EODHD availability, entitlements and provider measurements were outside the offline test runs. The local Docker image was neither published nor deployed.
