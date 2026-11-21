# Published-PR follow-up for observed daily returns

The published-head reviews found that contradictory listing declarations and partial acquisitions could qualify an observed-return chart. The follow-up checks these facts at the original daily SDK array, the selected HTTP rows and the acquired field origins used by both executors. Independent scoped re-review is complete. Both Superpowers reviewers closed their findings with no new Critical or Important breakage; Ponytail confirmed all eight simplifications and 38 fewer hand-maintained lines. [Scoped review records](published-pr-rereviews.md). [Original review reports and probe output](published-pr-reviews.md)

## Corrections

- The raw observer reconciles every declared symbol, ticker, code and exchange alias before adding the requested symbol or letting normalization discard a row. Each value retains the existing whitespace and case normalization. Agreeing `code=AAPL` and `Code=" aapl "` qualify. Either a kept or dropped conflicting code sets `identity_conflict`. The `.US` suffix continues to identify the EODHD namespace.
- The observer checks the existing partial and continuation marker families across snake, camel and case variants. A marker in the second listing aborts the whole GET. Both `isPartial` and `nextCursor` returned HTTP 502 for the two mirrors and the standard alias controls. The check still uses marker presence, including a false value. Ordinary historical GETs and unpaged opted-in acquisitions remain available.
- The client checks all raw delivered aliases and partial markers, then rechecks original column names at worker registration. The canonical date, adjusted-close and required multi-listing symbol field bindings still require exact origins. Tests filter the contradictory row and project away the aliased column through the actual TypeScript and Rust executors. Both refuse the chart.
- The Python safe receipt requires an original delivered or omitted coordinate for any positive duplicate count. Genuine duplicates with either kind of original and all-zero empty receipts pass. Version 1 retains its existing fields. The client’s return calculation and chart schema are unchanged.

## Source and transport

| Artifact | Revision |
| --- | --- |
| Canonical source | `75a902664054b3afbd23c5b6328efe7eedcf429c`, tree `35e2586eca1f6b39527412188879eb133639d026` |
| Docker | `2c5464675090c73f0c52cf8482ccf454e07b7704`, tree `803ccb3977625596950ddff0ca7e9bf18ec93811` |
| Client code and shared browser fixture | `ef7fd0ab65e2902746333efb4207fd6e9c786481` |
| Corrected HTTP replay | `f92046747ab09520adb7f0f42ce847f977962225` |
| Local Linux arm64 v3 | `openbq-v9-live-observed-returns:review-75a9026-2c54646-20261120` |
| Image index | `sha256:f8cca8ee400a88f4ae331bc498c9e28520e9ff766410926bbfdac0e4edd29404` |
| Linux arm64 manifest | `sha256:1e8866e09fe8d12a28b649b0f256afd584041d158bcd02ba6dc7f7409a111a5c` |
| Image configuration | `sha256:67f14cf1828b0507fbbe332873c34918db508bf8aa04d8e579ec0b3660e3dae0` |

All 151 canonical tracked files match the Docker vendor tree, including modes. The per-file SHA-256 inventory matches the Git blobs. The manifest file itself hashes to `3d4bac4fa88eef77c79736183329a8d53802531062489bf56b12d54982de200d`. The installed audit verified 95 provider files and 104 hashed wheel RECORD entries. The package inventory digest is `b06a90b360c9b637fb4c4dc1075e28875263340081d37f317b44de72d32c2ff9`. The final image uses provider 9.0.1, Core and Platform API 2.0.1, Requests 2.34.2 and certifi 2026.10.23. The trust gate and the real SDK session used bundle SHA-256 `2ef52ad56b4803e264045c915e55c236cbfa045b84b81efefc218a19eb44bd2b`. The network-disabled `pip check` passed.

The installed mirror GETs exercised the generated `results` selector, the receipt in `extra.results_metadata.chart_sources` and one daily SDK call per listing in request order (MCD.US then AAPL.US). A second listing with a dropped conflicting code returned an unsafe receipt. A second listing declaring continuation failed the GET. Ordinary, empty and unpaged controls passed. The deterministic captures contained 19 delivered of 21 raw rows, producing 7 MCD and 9 AAPL returns. The public equity GET returned 29 adjusted closes and 28 adjacent observed returns for each listing. This fresh SDK response matched the independently saved public arrays for October 12 through November 19, 2026. The historical direct HTTPS capture retains its original timestamp. Separate direct GETs at 02:32 UTC on November 21 matched its bytes exactly. The SHA-256s were `04ecc3153ccc7ae62653c332c5741671e742430acabd1fde614b1a20dbf2499a` for MCD.US and `da4eaf62364dfb9bb93784665166e1d80155b1d796513c424e7a5ff5e19e5a17` for AAPL.US. Standard equity and ETF captures used deterministic SDK arrays in the separate canonical Core 2.0.1 / Platform API 1.3.6 environment with standard routers outside their declared dependency range.

| Corrected capture | SHA-256 |
| --- | --- |
| [canonical-standards](../../../../../e2e/fixtures/installed-observed-returns/75a9026/canonical-standards.json) | `bd8262814090779f55daa6dfe64840fb1e62ed67378e05cd3994fd5f205dc111` |
| [deterministic-sdk](../../../../../e2e/fixtures/installed-observed-returns/75a9026/deterministic-sdk.json) | `259a9638c5f658c97e9390e0636aa02b7d8665ddac7f9836dfd357ea84e55085` |
| [public-demo](../../../../../e2e/fixtures/installed-observed-returns/75a9026/public-demo.json) | `b12530ef2e936073d4b76dfa9e2252b7713fec4f6920d677f605022d3b3df99b` |

## Verification

| Gate | Result |
| --- | --- |
| Before the fix | Seven failing provider cases, 65 passing controls. Eighteen failing client cases, 114 passing controls. The old image failed six new mirror subtests. |
| After the fix | 72 focused provider tests. 965 provider tests passed overall, one optional ArcticDB skip and seven upstream warnings. 132 focused client admission, recipe and executor tests. |
| Full client | 10,275 passed, 47 optional integration skips. TypeScript, isolated lint, Knip and scrub passed. Knip reported the existing unused `Monitor` export. |
| Builds and web | Both production bundles built. 57 web tests and 3 WASM packaging tests passed. Verified WASM file SHA-256 `eb55d3eea863ce87460e430d638e6a5db961c99370708429adac0be349c111fa`, 4,570,872 bytes. |
| App bundle | 15 JS files, 8,616,685 bytes raw and 2,707,238 gzip. Against the original baseline, +33,892 raw and +10,682 gzip bytes. Existing chunk-size and mixed-import warnings remain. |
| Docker | Host suite passed 121 tests and 15 subtests. Final source pin and installed suite passed (26 passed, 1 warning, 47 subtests passed). |
| Browser | All 48 live cases and 20 corrected installed replays passed across Chromium and WebKit, each with TypeScript and compiled Rust. Every invocation used one worker and zero retries. |
| Review simplifications | The eight accepted local reductions remove 38 hand-maintained lines in total, counting canonical source once. See the dispositions below. |

The development browser replays recorded two source GETs per case and zero additional GETs on the public box-to-violin change. Each installed Rust replay observed one successful WASM fetch. The installed TypeScript replays observed zero. The independent production-mode request count on the originally published client is recorded separately in the historical review.

## Simplification dispositions

| Suggestion | Applied change and verification | Net lines |
| --- | --- | ---: |
| One coordinate callback | Each adapter supplies one callback. Daily coordinates come from captured provenance. Metric and estimate adapters use `satisfies`, and existing one-argument callers keep definite result types. The typecheck, adapter tests and both executors passed. | −5 |
| Shared shape predicates | Daily and ETF hierarchy decoding share the descriptor-aware exact-keys check and nonnegative safe-integer count check. Their other family-specific predicates stay local. | −2 |
| Shared browser fixture | Both suites use the same viewport, WASM response observer and engine assertion. Installed cases retain separate worker samples and HTTP request attachments. | −8 |
| Date parsing | Reused the strict ISO date parser with the existing string and length guards. Ten date boundary inputs matched the original behavior. | −5 |
| Price validation | Reused finite-number conversion with exact numeric type and positive-value guards. Thirteen boundary values matched, including booleans, infinities, NaN and overflowing integers. Shared import additions and removals cancel across the two helpers. | −5 |
| Array errors | Flattened the failed-object check before marker detection. The final array check preserves wrapper rejection and error precedence. | −3 |
| Test clocks | Two bounded clock replacements now use the recorded instants’ timezone conversion through `SimpleNamespace`. The timestamp test verifies the acquisition instant. | −9 |
| Docker mock copy | The SDK mock creates a fresh list and shallow copy of a dictionary containing only immutable scalar values. The installed route tests passed. | −1 |

The standalone source-pin test first caught a stale expected commit. The corrected test passed, and qualification uses the subsequent Docker revision and image above. The first full lint invocation overlapped a Vitest Vite configuration file and got ENOENT. An isolated full lint run passed. The original review probe stopped at the newly rejected orphan receipt, and a second copy explicitly expecting that validation error completed the remaining cases. Earlier captures, warnings and the previously reported narrow-touch hover failure remain in the historical verification. [Earlier qualification](verification.md)

The image and public runtime evidence cover the local arm64 mirrors and the two sampled listings. The standard-router dependency limitation, optional integration skips and historical geometry evidence retain their existing scope. The separate Minor about which refusal message appears on a fully filtered table remains open.

## Publication and CI

The reviewed fixes are being published to the existing [provider PR #6](https://github.com/Adventures-OpenBQ/openbq-eodhd/pull/6), [Docker PR #33](https://github.com/Adventures-OpenBQ/openbq-docker/pull/33) and [client PR #89](https://github.com/Adventures-OpenBQ/bdobb/pull/89). Current-head CI is reported on those PRs separately from local qualification. No merge or deployment is included.
