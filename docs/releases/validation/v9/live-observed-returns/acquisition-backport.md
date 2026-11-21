# V9 daily-price acquisition refusal

November 21, 2026. Client backport of the shared acquisition checks reviewed in `750f7831`, based on v9 client head `a8d0d5be` and publication-planning head `b5b471ef`.

## Acquisition and table behavior

The HTTP adapter checks for explicit partial or paging markers and incompatible completeness on the response, `extra` and `extra.results_metadata`. A request for the live daily-price contract that fails capture carries `dailyPriceRejected: true` into table provenance. Table ingestion and executor validation also retain the restriction when they discard a recognized daily-price receipt that fails revalidation. The same restriction reaches linked tables and the recipe worker. Return Summary Parameters uses the worker's acquisition refusal and disables Apply for the rejected source.

The loopback HTTP test replayed 58 captured rows through the normal data client, table input, both table engines and a linked child. It checked the following cases.

| Acquisition | Table completeness | Chart result |
| --- | --- | --- |
| Qualified EODHD opt-in | Unknown | Box and violin each used 28 observed returns per listing. Histogram, drawdown and small multiples refused live input. |
| Root partial marker, result cursor, pagination in `extra` or partial result completeness | Unknown | All tested price charts refused. |
| Nested legacy snapshot on the opted-in route, wrong selector, or daily-price declaration on the wrong route | Complete | All 58 rows remained available, and all tested price charts refused. |
| Complete legacy snapshot with a daily-price receipt lacking its coordinate ledger | Complete | All 58 rows remained available after executor revalidation. All tested price charts refused. |
| Ordinary backend rows without opt-in | Unknown | All 58 rows remained available. |
| Ordinary backend snapshot without opt-in | Complete | Histogram, drawdown and small multiples used the documented snapshot. |
| Documented local snapshot | Complete | All five tested chart options qualified. |

The presented-row JSON test on each executor compared all 58 rows with the source and checked that the export carried no acquisition metadata. The browser workspace replay separately checked reacquisition from its saved source and the documented local import path. [Original v9 verification](verification.md)

## Before and after

The calibrated RED command ran the two regression files against the original production code. It produced 18 failures and 60 passes. Both engines accepted the four marked responses as live and qualified the four rejected legacy snapshot cases. Two Parameters cases lacked the acquisition refusal. The eight-file GREEN run passed 221 tests. An initial GREEN run had one assertion still expecting the ordinary snapshot prompt for a rejected opt-in request. The updated assertion distinguishes the ordinary and opted-in paths.

~~~sh
pnpm exec vitest run src/lib/tableExecution/rust/dailyPriceEvidence.test.ts \
  src/components/renderers/LinkedChartRecipeControls.test.tsx
PIVOT_WASM_VERIFY_ONLY=1 pnpm exec vitest run \
  src/lib/tableExecution/rust/{dailyPriceEvidence,priceEvidence}.test.ts \
  src/components/renderers/LinkedChartRecipeControls.test.tsx \
  src/lib/widgetData/chartRecipes/{dailyPriceEvidence,returnSummary,priceSamples,input,chartSourceRegistry}.test.ts
~~~

## Client and build gates

| Command | Result |
| --- | --- |
| `PIVOT_WASM_VERIFY_ONLY=1 pnpm test:run` | 10,301 passed and 47 optional live or external-integration tests skipped across seven files. |
| `pnpm test:web` | 57 passed. |
| `pnpm typecheck`, `pnpm lint`, `pnpm knip`, `pnpm scrub` | All exited zero. Knip reported the already recorded unused `Monitor` type. |
| `pnpm pivot:build` and `pnpm pivot:verify` | Fresh pinned Rust 1.98.1 and wasm-bindgen 0.2.128 build, emitted-module smoke test and artifact verification passed. |
| `PIVOT_WASM_VERIFY_ONLY=1 pnpm pivot:test` | 199 Rust core, one WASM crate and 19 wire-codec tests passed. |
| `PIVOT_WASM_VERIFY_ONLY=1 pnpm test:pivot:packaging` | Three tests passed. |
| `NODE_OPTIONS=--max-old-space-size=6144 PIVOT_WASM_VERIFY_ONLY=1 pnpm build` and `pnpm build:web` with the same environment | Production app and private web package builds passed. Vite reported mixed import and chunk-size warnings. |

The compiled WASM artifact was 4,570,872 bytes with SHA-256 `eb55d3eea863ce87460e430d638e6a5db961c99370708429adac0be349c111fa`.

## Browser verification

| Browser | Table engine | Live Return Summary | Installed response replay |
| --- | --- | ---: | ---: |
| Chromium 151.0.7922.34 | TypeScript | 12 passed | 5 passed |
| Chromium 151.0.7922.34 | Compiled Rust | 12 passed | 5 passed |
| WebKit 26.5 | TypeScript | 12 passed | 5 passed |
| WebKit 26.5 | Compiled Rust | 12 passed | 5 passed |

All 68 required executions passed with zero retries. The fixture asserted that Rust runs loaded a successful `application/wasm` response and that TypeScript runs loaded none. The installed cases replay the committed responses from standard and mirrored routes. The live spec exercises chart rendering and Parameters, including visible table rows and disabled Apply after the interval or selector invalidates the opted-in source. Fresh account traffic and image builds are outside this client verification. [Installed capture provenance](published-pr-follow-up.md)

Run `e2e/live-return-summary.spec.ts` and `e2e/installed-return-summary.spec.ts` with Playwright 1.62.1, `--workers=1 --retries=0`, and `PIVOT_WASM_VERIFY_ONLY=1`. Use the standard app Playwright harness with a WebKit project using `devices['Desktop Safari']` alongside its Chromium project. Run the two projects with `VITE_TABLE_ENGINE=typescript` and again with `VITE_TABLE_ENGINE=rust`. The separate `PIVOT_WASM_VERIFY_ONLY=1 pnpm test:pivot:browser` conformance suite passed 16 cases across the two browsers.

### Additional legacy return checks

The first concurrent browser runs also included `e2e/return-summary.spec.ts` and `e2e/return-summary-geometry.spec.ts`. TypeScript recorded 50 passed and four failures across the two browsers. Rust recorded 51 passed and three failures. The extra failures concern the existing local snapshot specs.

- Chromium and TypeScript missed the median tooltip in `keeps original-percent ticks on a real narrow touch zoom and preserves the zoom on resize`. The trace shows the local snapshot box mounted and the touch action completed, followed by an empty hover layer during the five-second assertion. Chromium and Rust passed the same case in the concurrent run. An isolated Chromium and TypeScript rerun passed all three executions with `--repeat-each=3 --retries=0`. The cause of the transient missing hover remains unconfirmed. [Prior observation](verification.md#client-browser-behavior)
- WebKit rejected the Chromium CDP touch calls in `keeps original-percent ticks on a real narrow touch zoom and preserves the zoom on resize` and `scrolls a wide return comparison by touch` on both engines. For an additional WebKit legacy run, exclude those two tests with `--grep-invert 'keeps original-percent ticks|scrolls a wide return comparison by touch'`. Chromium exercised both.
- WebKit also reported same-origin development worker modules as fetch traffic in `exports authored pins after detaching the local asset, and reacquires with explicit repair on a new page`. The final empty-request assertion listed 414 development module GETs with TypeScript and 348 with Rust. The TypeScript attempt on archived pre-backport `b5b471ef` reproduced the same 414 GETs and failure. The requests were all to the loopback Vite origin. Chromium passed the test on both engines.
