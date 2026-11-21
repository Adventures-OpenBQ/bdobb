# Live observed returns paired verification

**Observed quote-to-quote returns; exchange-session completeness unknown.**

The fixed examples use AAPL.US and MCD.US from 2026-10-12 through
2026-11-19 inclusive. The acquisition contract also accepts other eligible
bounded daily US listing requests when the backend account has access.

The current provider revision and installed-image results are recorded in the [published-PR follow-up](published-pr-follow-up.md).

The following history records the first qualification. The final fixes have a
separate provider pin, image, captures and test results. [Final qualification](#final-declaration-fix-and-requalification)

## Source and image identity

| Artifact | Identity |
| --- | --- |
| Client baseline | `3d7b3c9a7b8ec7518de50a5c407d9521e65a68c2` |
| Client release-check input | `ce39607e16a3cefb3a8fa59bebf6d796d3b974e0`, tree `3be69e0c29f816f60570b364fb654ec8d7ec05b4` |
| Canonical provider baseline | `a7597ecfb02d087c98c80df926b057f134b076e1` |
| Canonical openbq-eodhd | `8c06e57ea08f85c3b48a6eff8d99068486b180dc`, tree `848e07485337ccc942f50872fdb43bcb9cb84954`, distribution 9.0.1 |
| Docker baseline | `86ccb0a61662714b051c9a63d3436139aca851d5` |
| Docker certifi change | `3eb7252e4209b724ef07220cd6d0eab61de2df30` |
| Docker pairing | `deb1811d3c958cdd79efa87be7a0247cbdf98d73`, tree `3cb533f2f885d7e2a26f1017011e4fac80e8db77` |
| Client product and unit test input | `b4f35811ca6b129b5d477f66bd3e9aa950323e75` |
| Strengthened Rita browser assertions | `dcd2541383f8f58044fca7374ea5e46dac5d9afa` |
| Client installed transport replay | `8ee95590147751f43634ea608b96799081b52cd2` |
| Vendored file inventory | 151 canonical paths, `source.json` SHA-256 `6651d70dfc1a447ed0e0cee97cb5f523f5fa5cc6b9f135dbca160865bfc52693` |
| Installed wheel files | 95 package files match the pin. All 104 hashed RECORD entries match, including generated metadata. Package SHA-256 inventory digest `cc771f741daeb7eaa49a0d7d59c94b9f1d4f2932f1db889c1dee0a2d36e5e14f`. |
| Local v3 qualification image | `openbq-v9-live-observed-returns:qualification-20261120`, OCI index `sha256:dcaa9362191ac90078313522d32a10ba2f4292f90c0db7d246a446fda5354f56` |
| linux/arm64 manifest | `sha256:56c0063a7a67215936e21ffa6c94f1d2ceed0e8ceb5e183b342c897964d3ebc6` |
| Image config | `sha256:dd3d756d280c8a6a1421aeee61d24ff7b6c390043a88305e4c7dfd585aa83d70` |

All three isolated `codex/v9-live-observed-returns` checkouts were clean at
the release-check inputs. A fresh check compared the canonical and vendored
Git paths, bytes and manifest hashes at the pinned commits. The wheel
inventory compares installed package files and wheel RECORD paths with the
package subset of the same pin.

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
| `docker build --target v3` | Passed. EODHD's 23-test in-build stack gate passed. Requests trust and `pip check` passed in the resulting image. This successful build emitted its own ignored aiohttp cross-event-loop shutdown warning. [Raw build excerpt](evidence/first-qualification-build-excerpt.txt) |
| Installed `pytest` and parity | Network-disabled v3 container, 24 tests and 33 subtests passed with no skips. The run reported one existing OpenBB aiohttp inheritance deprecation. Installed package and RECORD hash comparisons passed. |
| Host Docker `pytest tests v3/tests` | 121 passed and 15 subtests passed. The first collection attempt lacked PyYAML. The rerun used test-only PyYAML 6.0.3. |
| Canonical and vendor parity | 151 byte comparisons passed and the source pin test passed. |
| Canonical `python -m pytest -q` at `8c06e57e` | 948 passed. One optional ArcticDB cache test was skipped. Seven warnings came from installed OpenBB packages and extensions. |
| Canonical selector preflight | The nested selector passed for both mirrors. A subsequent assertion requiring an explicit widget override failed in both cases and was withdrawn after confirming that the generated default supplies `data.dataKey = "results"`. |
| Public image capture | HTTP 200, content assertions passed and fixture written. An aiohttp process-exit callback then raised an ignored cross-event-loop `RuntimeError`. |
| Chromium 151.0.7922.34 with TypeScript and compiled Rust | Five replay tests passed per engine, zero retries or skips. The five Rust runs loaded the actual WASM binary and TypeScript loaded none. The binary SHA-256 was `eb55d3eea863ce87460e430d638e6a5db961c99370708429adac0be349c111fa`. |
| Client `PIVOT_WASM_VERIFY_ONLY=1 pnpm test:run` at `b4f35811` | 10,242 passed, 47 optional integration skips across seven files. The first run had one failure in the local snapshot prompt. Restoring the prompt passed the focused test and the full rerun. Unrelated React test warnings were present. |
| Client `pnpm pivot:test` at `17669a66` | 199 Rust core, 1 WASM crate and 19 wire codec tests passed. The later alias correction passed 115 focused cases with actual compiled WASM. |
| Client `PIVOT_WASM_VERIFY_ONLY=1 pnpm test:web` | 57 passed, zero skips. |
| Client `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm scrub` | Exit 0 for typecheck, full lint, scrub and header checks. |
| Client `pnpm knip` | Exit 0. Its unused exported `Monitor` type warning in `src/browser-shim/window.ts` also appears in the baseline. In the baseline archive, ordinary Knip and its Git-ceiling rerun reported 19 unused dependencies and seven unused dev dependencies. `pnpm exec knip --no-progress --no-gitignore` restored source discovery, reporting the same type and 16 ignored build outputs. [Raw baseline diagnostic](evidence/baseline-knip-no-gitignore.txt) |
| Client `pnpm pivot:verify` and `PIVOT_WASM_VERIFY_ONLY=1 pnpm test:pivot:packaging` | Exit 0. All three packaging tests passed, including refusal of missing, stale and altered compiled artifacts. |
| Client `PIVOT_WASM_VERIFY_ONLY=1 pnpm build` and `PIVOT_WASM_VERIFY_ONLY=1 pnpm build:web` | Exit 0 for the production app frontend and private web function. The existing mixed static/dynamic import warnings and 500 kB chunk warning appeared in the builds. |

The first Chromium TypeScript preflight rendered both standard alias boxes
and matched their worker samples. Its binary observer misidentified the
Vite WASM URL shim. The replay now counts only successful
`application/wasm` responses.

Between the original client full-unit and release-check commits, the Git diff contained only browser tests,
captured fixtures and release notes. The Rust crate, build script and wire
codec test inputs also match the `pnpm pivot:test` run. The provider full
suite and Docker runtime evidence apply to the exact provider and Docker
commits listed above. Release-check commands ran on Darwin arm64 with Node
26.13.0, pnpm 10.34.4 and the verified compiled WASM bytes.

## Client browser behavior

| Mode | Product matrix at `b4f35811` | Rita assertions at `dcd25413` |
| --- | --- | --- |
| Chromium 151.0.7922.34, TypeScript | 22 passed, including 12 live and 10 existing return and geometry cases | 2 passed |
| Chromium 151.0.7922.34, compiled Rust | 22 passed, plus a focused portable-copy rerun | 2 passed |
| WebKit 26.5, TypeScript | 12 live cases passed | 2 passed |
| WebKit 26.5, compiled Rust | 12 live cases passed, plus a focused portable-copy rerun | 2 passed |

The browser checks exercised the source table, both figures and accessible
samples, Parameters, filtering, common pins, source replacement and recovery,
configured and pinned Rita, export/import and reacquisition. Controlled stale
and failed Rita tool responses failed both strengthened assertions before the
eight focused cases passed across the four modes. The first three Chromium
TypeScript attempts exposed fixture locator, import, WASM observation and
GET counting issues. They recorded 5 failures, then 1 failure with 6 passes,
then 1 failure with 21 passes. A later concurrent run passed all live cases
and failed one existing narrow-touch median hover case. The unchanged test
passed in the serial 22-case run. The cause of the transient failure remains
unconfirmed.

To replay the captured transport in a development checkout, run
`VITE_TABLE_ENGINE=typescript pnpm exec playwright test e2e/installed-return-summary.spec.ts`
and repeat with `VITE_TABLE_ENGINE=rust`. The replay uses only the committed
captures and the local browser harness.

| Captured fixture | SHA-256 |
| --- | --- |
| `canonical-standards.json` | `cc6240f361b50930c6e7d533b0f6a05332dccf776dc14579039ffabb1cbed9f3` |
| `deterministic-sdk.json` | `1ad0ae85769c72b38a3db998f6e21791853cd2e65fa97083401f00f4d1be7669` |
| `public-demo.json` | `1564b9e9893cb620c7baf8a8397e6a154f7db0dd8cda05699037f7c6d82d31a9` |

## Production app bundle

The baseline and release build each emitted 15 `dist/assets/*.js` files.
The measurement sums exact byte sizes and independently compressed each
file with Python `gzip.compress(data, mtime=0)`. Source maps, `.mjs`, WASM,
CSS and image assets are outside the JavaScript comparison.

| Build | Raw bytes | Gzip bytes |
| --- | ---: | ---: |
| Baseline `3d7b3c9a` | 8,582,793 | 2,696,556 |
| Release-check input `ce39607e` | 8,612,818 | 2,705,709 |
| Delta | +30,025 (+0.35%) | +9,153 (+0.34%) |

Eight JavaScript chunks match the baseline SHA-256. The remaining chunks
are listed with their size deltas and final fingerprints.

| Final JavaScript chunk | Raw delta | Gzip delta | SHA-256 |
| --- | ---: | ---: | --- |
| `HelpDialog-Ci1dEJKi.js` | 0 | 0 | `b9204066f7ccfb96a3f0f5316951d3ff8f7ccaf12da3857bbc24c87e46bcce15` |
| `MarkdownEditorRenderer-BuZDdBZZ.js` | 0 | -2 | `6fffa5fc06d831ee1a4ae8360598a4fa7500e71039ff85cf7941e320d0e92b08` |
| `index-LgEINeZK.js` | +7,407 | +2,150 | `2f4f9fbdfba7ccc756d3b3654d9fa9fc4519676e0c37d18dd72ed3e22500c2a1` |
| `kpi.worker-CKq4SyA_.js` | +5,011 | +1,564 | `aee35b91210154ec4f7be72a7fce5093dacf443500d7da3852296a29dbaf9813` |
| `recipe.worker-Bo2xkmfK.js` | +7,067 | +2,204 | `6cebc86133593392c04e82378d4a6755f35f5bb7fb101e013fc49bcc9b2f06d7` |
| `rust.worker-f7fctsqO.js` | +5,322 | +1,645 | `4e10f107ba93625cfa1404dd59fa2a1a4c9ce516434491631678c87ec7c5721f` |
| `table.worker-Bv0sf6Wj.js` | +5,218 | +1,592 | `423c801de8f913e9c2a46d0b20c2541ccc3a041c8cb4a3bd95a7b55ebb3c3323` |

The dependency manifest, lock and Plotly trace registry match the baseline.
The installed Plotly version is 3.7.0. The app, private web package and
baseline use the same 4,570,872-byte WASM binary described above.

The installed-image proof covers the local `linux/arm64` v3 Docker image
and its two EODHD mirrors. Browser proof comes from desktop-hosted Chromium
and WebKit. Physical devices, `linux/amd64` and a live ArcticDB service
remain outside this qualification. [Review](review.md)

## Final declaration fix and requalification

The final canonical provider checks row declarations of OpenBB interval,
SDK period, currency and unit on every original bar, including bars later
removed. A weekly declaration or a within-listing denomination change sets
the closed `invalid_response` flag. The client checks actual selected rows
and checks acquired field origins at each worker input before a filter or
projection can hide a conflict. Unlabelled sparse daily observations and
different stable denominations on separate listings qualified in controls.

| Artifact | Final identity |
| --- | --- |
| Client product | `45a165321a32ae6225d1c9ebade6f12959c9f67a`, tree `0319a9aa092afd175b374d990cdfddafba5880ef` |
| Canonical provider | `adb2e2e410552863bcbfbd5584e3e7c9720d0cbc`, tree `757335c861fead6e500414eef46b3c080f053fdf` |
| Docker pairing | `52436dd8a1a6a13eaf142a8486a7f0bda7f1db5b`, tree `f8b9017849086221e36dcee0c9e16bb614d939e1` |
| Source manifest | 151 paired Git blobs, SHA-256 `338a6b2540135d10b0e0205cddb21849b0e72c24a540e10c3c8a137e97e90062` |
| Local arm64 v3 image | `openbq-v9-live-observed-returns:final-adb2e2e-20261120`, index `sha256:068944e7bded0471cb222399db083ffeb6306ae30fe14954907fa0dd8dfc2acc` |
| arm64 manifest | `sha256:d00182470c84e8105d966226c7cdd50fdfe6a81c6cbc3490f1bc0e7d93bb3a7a` |
| Image config | `sha256:8a2a1ede68b9ae3b39d75d6efb9bd31b85f41012f358f633b670b3e83b962524` |
| Wheel inventory | 95 files and 104 hashed RECORD entries verified. Package-file inventory digest `1e1ea87c2db7d4c629c4b351813ec287e9a2acf209b70d9ad2c89ef59700df0b`. |

The new image passed its 24-test EODHD and 11-test EconDB build gates. A
separate ignored aiohttp cross-event-loop shutdown warning appeared in
this build. The installed trust check confirmed the same patched certifi
2026.10.23 and Requests 2.34.2 CA file and fingerprint exclusions. The
installed `pip check` passed. The host Docker unit/static suite passed
121 tests plus 15 subtests.

| Final verification | Result |
| --- | --- |
| Before the fixes | All four independent provider and client probes reproduced. Nine provider regressions failed and 56 controls passed. The client and both actual worker engines had 13 failing regressions and 100 passes. The tests against the previous image had eight failing subtests on dropped contradictory rows across the equity and ETF mirrors. |
| Provider | Focused suite 65 passed. Full suite 958 passed, one optional ArcticDB skip and seven warnings from installed extensions. |
| Client | Focused capture, recipe and paired worker suite 113 passed. Full suite 10,256 passed and 47 optional skips across seven skipped files. Existing React act warnings remain. Web suite 57 passed. |
| Static checks | Typecheck, lint, Knip, scrub, headers and pinned WASM verification passed. A concurrent lint invocation encountered a transient Vite config ENOENT; the serial unchanged rerun passed. Knip reported the existing unused Monitor type. |
| Production bundles | App and private web builds passed with existing mixed-import and large-chunk warnings. App JS totals across 15 files were 8,616,858 raw and 2,707,025 gzip bytes (mtime zero), up 34,065 raw and 10,469 gzip over the original baseline. A shell wrapper initially failed to parse the measurement heredoc. The standalone measurement completed. Both packaged WASM copies retained the original 4,570,872 bytes and SHA-256. |
| Focused live source UI | Chromium 151.0.7922.34 and WebKit 26.5 each passed four live cases on TypeScript and four on compiled Rust. All 16 passed with zero retries or skips. Cases covered authoring, pins and filtering, ordinary sources, stale recovery/replacement and source-free export/import. |

The final-image deterministic socket GETs again delivered 19 rows from 21 raw
observations on each mirror, yielding seven MCD.US pairs and nine AAPL.US pairs.
The source and widget used the nested `data.dataKey` selector and the OBBject
receipt path recorded above. The separate canonical installation also repeated
its four deterministic alias GETs, with the previously described dependency
constraint on the standard routers. Each source GET made one bounded daily SDK
call per listing, in MCD.US, AAPL.US order.

Fresh direct public HTTPS acquisitions at 23:51 UTC on 20 November matched the
earlier byte hashes for each symbol. The final image's real public equity
mirror GET at 23:55 UTC acquired 29 distinct positive adjusted prices and
28 returns per listing. Its SDK responses matched the fresh independent arrays,
and selected values matched them by listing and date. The public capture
finished with HTTP 200, wrote the fixture, then emitted the previously observed
ignored aiohttp shutdown warning. The three capture files below record the
new identities. The original capture files remain at their previous paths.

| Final capture | SHA-256 |
| --- | --- |
| [Canonical standard aliases](../../../../../e2e/fixtures/installed-observed-returns/adb2e2e/canonical-standards.json) | `39de0d64ef43c2fffa9a4a919a9782189c6c79d0f6ac6bacadbb17ecc483748f` |
| [Installed deterministic mirrors](../../../../../e2e/fixtures/installed-observed-returns/adb2e2e/deterministic-sdk.json) | `ec79f38d4491ad5a21116e746b07608f74e177d4ab84b6b53ce334b78f23d239` |
| [Installed fresh public equity](../../../../../e2e/fixtures/installed-observed-returns/adb2e2e/public-demo.json) | `a993a8c8b8cb443b338ea5d16864e62bf1ee89bad4013402a1956fbe76e0b61c` |

At client replay commit `561bc4f4b812b3c626feb031a967064e6a926bd4`
(tree `8150c030244937ebb2325fbd885d8e347de69b13`), all five new transport
cases passed in Chromium with TypeScript, and all five passed with the actual
Rust binary. Every replay compared worker dates and return values exactly,
with zero retries or skips. The development browser requested each source
twice, then switched the public view to violin without another GET. Each
installed backend count above is for a single source GET.

The network-disabled final image passed all 25 installed tests and 41 subtests,
including the eight previously failing declaration subtests, next-source
regressions and the source pin. There were zero skips and one OpenBB aiohttp
inheritance deprecation. The pinned WASM packaging suite passed all three
cases. Scope remains the local arm64 image, the two installed mirrors and the
desktop-hosted browsers above. The independent scoped re-review of the consolidated fix is complete: both Important findings are addressed and no new Critical or Important breakage was found. [Final independent fix review](independent-final-fix-review.md).
