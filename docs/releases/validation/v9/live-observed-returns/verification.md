# Live observed returns paired verification

**Observed quote-to-quote returns; exchange-session completeness unknown.**

The fixed examples use AAPL.US and MCD.US from 2026-10-12 through
2026-11-19 inclusive. The acquisition contract also accepts other eligible
bounded daily US listing requests when the backend account has access.

## Source and image identity

| Artifact | Identity |
| --- | --- |
| Canonical openbq-eodhd | `8c06e57ea08f85c3b48a6eff8d99068486b180dc`, tree `848e07485337ccc942f50872fdb43bcb9cb84954`, distribution 9.0.1 |
| Docker baseline | `86ccb0a61662714b051c9a63d3436139aca851d5` |
| Docker certifi change | `3eb7252e4209b724ef07220cd6d0eab61de2df30` |
| Docker pairing | `deb1811d3c958cdd79efa87be7a0247cbdf98d73` |
| Client acquisition and recipe code | `dcd2541383f8f58044fca7374ea5e46dac5d9afa` |
| Vendored file inventory | 151 canonical paths, `source.json` SHA-256 `6651d70dfc1a447ed0e0cee97cb5f523f5fa5cc6b9f135dbca160865bfc52693` |
| Installed wheel files | 95 package files match the pin. All 104 hashed RECORD entries match, including generated metadata. Package SHA-256 inventory digest `cc771f741daeb7eaa49a0d7d59c94b9f1d4f2932f1db889c1dee0a2d36e5e14f`. |
| Local v3 qualification image | `openbq-v9-live-observed-returns:qualification-20261120`, OCI index `sha256:dcaa9362191ac90078313522d32a10ba2f4292f90c0db7d246a446fda5354f56` |
| linux/arm64 manifest | `sha256:56c0063a7a67215936e21ffa6c94f1d2ceed0e8ceb5e183b342c897964d3ebc6` |
| Image config | `sha256:dd3d756d280c8a6a1421aeee61d24ff7b6c390043a88305e4c7dfd585aa83d70` |

The vendor copy used `git ls-tree` and per-path `git show` at the reviewed
provider commit. Every path and byte was compared. The wheel inventory
compares installed package files and wheel RECORD paths with the package
subset of the pin.

## Served transport

| API path | Generated widget |
| --- | --- |
| `/api/v1/eodhd/equity/price/historical` | `eodhd_equity_price_historical_eodhd_obb` |
| `/api/v1/eodhd/etf/historical` | `eodhd_etf_historical_eodhd_obb` |

Both served OpenAPI GET definitions and generated widgets expose
`chart_source` with a false default. The generated widgets select
`results` through `data.dataKey`. The receipt is at
`extra.results_metadata.chart_sources`, with envelope version 1 and one
`daily-price` receipt. Credential values are excluded from the captures.

Each alias received one GET and made one SDK call per listing in request
order for the exact inclusive bounds with daily period and ascending order.
Each deterministic acquisition sent 21 raw rows and delivered 19 rows.
MCD.US has one dated invalid adjusted price. AAPL.US has one exact repeat.
The same captured values yield seven and nine pairs, respectively. The
standard equity and ETF aliases used the same fetcher registrations and
returned the same rows in the separately installed local canonical runtime
with a stubbed SDK and OpenBB Core 2.0.1. In that runtime,
`openbb-equity==1.6.2`, `openbb-etf==1.6.2` and
`openbb-platform-api==1.3.6` each declare `openbb-core>=1.6.10,<2.0.0`.
The standard routes were observed outside those declared bounds. The
dependency-consistent installation verified by `pip check` is the Docker
image with the two EODHD mirrors and Core and Platform API 2.0.1. [Installed mirror capture](../../../../../e2e/fixtures/installed-observed-returns/deterministic-sdk.json) · [Standard alias capture](../../../../../e2e/fixtures/installed-observed-returns/canonical-standards.json)

The installed tests verify plain and opted-in row equality on clean data and
check that plain empty data stays HTTP 204 while an opted-in empty array
returns HTTP 200 with a zero-count receipt. Plain, non-US and weekly
requests and crypto, FX and index routes carry no daily-price receipt.

## Public demo

The independent HTTPS responses contained 29 unique positive adjusted
prices and 28 adjacent pairs per listing. In the qualified image, the
equity mirror's opted-in GET made one real SDK call per listing. The
SDK arrays matched the independent responses, and the selected table
dates and adjusted closes matched them exactly. The capture received
HTTP 200, validated the data and wrote the fixture. At process exit, an
aiohttp shutdown callback raised an ignored `RuntimeError` because its
future was attached to a different event loop.

| Listing | Direct response bytes, SHA-256 | First and last adjusted close |
| --- | --- | --- |
| AAPL.US | `da4eaf62364dfb9bb93784665166e1d80155b1d796513c424e7a5ff5e19e5a17` | 340.7111 on 2026-10-12 and 349.21 on 2026-11-19 |
| MCD.US | `04ecc3153ccc7ae62653c332c5741671e742430acabd1fde614b1a20dbf2499a` | 235.65 on 2026-10-12 and 272.35 on 2026-11-19 |

The capture keeps the independent source values, served widget, OpenAPI
query contract, full response, SDK arguments and expected return samples.
The Chromium replay loads the captured response through the regular table
data client and widget selector. It compares every date and double returned
by the real recipe worker for both box and violin, and checks that changing
the view makes no additional source GET. The development harness sent
two initial replays of each captured question on both engines. The live
SDK counts come from the single independent image acquisition. [Public wire capture](../../../../../e2e/fixtures/installed-observed-returns/public-demo.json) · [Replay assertions](../../../../../e2e/installed-return-summary.spec.ts)

Public access was exercised for these two examples. Access to other
listings, longer windows and account-specific feeds depends on entitlement.
The captured values reflect the adjusted history served at acquisition.

## Requests trust

The old image trusted the removed G3, C1 and C3 roots. The qualification
image uses certifi 2026.10.23 and Requests 2.34.2. The active Requests
bundle is `/usr/local/lib/python3.12/site-packages/certifi/cacert.pem`.
Its SHA-256 `2ef52ad56b4803e264045c915e55c236cbfa045b84b81efefc218a19eb44bd2b`
matches the bundle extracted from the verified PyPI wheel. The build
checks the effective CA file and fails on any of the removed fingerprints
identified in the regression. The full public SDK run used the same verified
CA file. [Certifi advisory](https://github.com/certifi/python-certifi/security/advisories/GHSA-6q48-6c7w-9gw2) · [Verified distribution](https://pypi.org/project/certifi/2026.10.23/)

## Verification runs

| Command or run | Result |
| --- | --- |
| New installed route regressions against old image | 8 failing subtests on missing opt-in schema, absent receipts and opt-in empty HTTP 204. An initial test draft had 4 failures and 4 missing-key/envelope errors. Added explicit presence assertions and reran. |
| Exact trust gate against old image | Failed on the three removed emSign G3, C1 and C3 roots. The first gate also flagged G1. The first build with the patched distribution exposed that broad assertion, which was corrected using official fingerprints. |
| `docker build --target v3` | Passed. EODHD's 23-test in-build stack gate passed. Requests trust and `pip check` passed in the resulting image. |
| Installed `pytest` and parity | Network-disabled v3 container, 24 tests and 33 subtests passed with no skips. The run reported one existing OpenBB aiohttp inheritance deprecation. Installed package and RECORD hash comparisons passed. |
| Host Docker `pytest tests v3/tests` | 121 passed and 15 subtests passed. The first collection attempt lacked PyYAML. The rerun used test-only PyYAML 6.0.3. |
| Canonical and vendor parity | 151 byte comparisons passed and the source pin test passed. |
| Canonical provider suite inherited from Task 1 | 948 passed. One optional ArcticDB cache test was skipped. |
| Canonical selector preflight | The nested selector passed for both mirrors. A subsequent assertion requiring an explicit widget override failed in both cases and was withdrawn after confirming that the generated default supplies `data.dataKey = "results"`. |
| Public image capture | HTTP 200, content assertions passed and fixture written. An aiohttp process-exit callback then raised an ignored cross-event-loop `RuntimeError`. |
| Chromium 151.0.7922.34 with TypeScript and compiled Rust | Five replay tests passed per engine, zero retries or skips. The five Rust runs loaded the actual WASM binary and TypeScript loaded none. The binary SHA-256 was `eb55d3eea863ce87460e430d638e6a5db961c99370708429adac0be349c111fa`. |
| Client typecheck, targeted lint and scrub | Passed. |

The first Chromium TypeScript preflight rendered both standard alias boxes
and matched their worker samples. Its binary observer misidentified the
Vite WASM URL shim. The replay now counts only successful
`application/wasm` responses.

To replay the captured transport in a development checkout, run
`VITE_TABLE_ENGINE=typescript pnpm exec playwright test e2e/installed-return-summary.spec.ts`
and repeat with `VITE_TABLE_ENGINE=rust`. The replay uses only the committed
captures and the local browser harness.

This qualification covers a local image. Broader project verification and
the independent review are tracked separately. [Review](review.md)
