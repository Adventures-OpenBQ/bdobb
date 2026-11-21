# v10 live price views verification

## Verified revisions

| Repository | Commit |
| --- | --- |
| BDOBB product and browser tests, `codex/v10-live-price-views` | `e3ca1f18b9bf17671aafecb3b5ede224722a7c98` |
| BDOBB with the example inventory correction | `614c217735b36575486b13b15cf767f7bcbf9959` |
| BDOBB final acquisition, Parameters and disclosure corrections | `750f7831630f77fd075d2fa90f3d242738053e56` |
| BDOBB evidence reviewed in final closeout | `de267011cb3dd334010cb515c87be8a857087afc` |
| Paired EODHD provider | `75a902664054b3afbd23c5b6328efe7eedcf429c` |
| Paired OpenBQ Docker | `2c5464675090c73f0c52cf8482ccf454e07b7704` |

Verification ran November 21, 2026, on Node 26.13.0 and pnpm 10.34.4. The client branch starts at `327cbd5d641c4f4dfc9ab106ae2d8e6f37f8663f` and inherits the separately qualified v9 observed-returns work. That foundation is required for release integration. The provider and Docker worktrees were clean at the paired revisions. The v10 example requires released BDOBB 10.0.0 or later. These checks built the development package, still version 9.0.0. [Implementation plan](../../../../superpowers/plans/2026-11-21-v10-live-price-views.md) · [v9 paired verification](../../v9/live-observed-returns/verification.md)

## Final review fixes

The original loopback probe reproduced three incorrect admissions on the pre-fix revision. Both explicit partial/paging variants qualified, and the opted-in nested snapshot produced 28 returns labeled daily. After correction the same probe refuses each altered response. The positive control still yields 28 observed AAPL.US returns with table completeness `unknown`. The nested snapshot retains its reported `complete` table status and its 58 rows.

The permanent regression runs 11 cases against each executor, from loopback HTTP or documented local import through registration, chart data, a presented subset, linked child registration and chart calculation. It includes ordinary backend and local snapshot controls, both positive and rejected receipt paths, changed route/selector, and removal of invalid evidence during registration. The closed-example browser opens each invalid chart's Parameters and checks that Apply is disabled. [Executor suite](../../../../../src/lib/tableExecution/rust/dailyPriceEvidence.test.ts) · [Browser suite](../../../../../e2e/live-price-views.spec.ts)

| Final gate | Result |
| --- | --- |
| Full client suite | 10,358 passed, 47 opt-in skips. An initial run found 19 failures in four suites with reduced chart registries. The optional adapter lookup correction passed all 330 affected tests before the successful full rerun. |
| Focused chart, engine and UI suites | 191 passed. The original calibrated executor RED reproduced 10 failures. Removing the snapshot refusal during the fix wave reproduced eight executor failures and one Chromium browser failure. |
| Typecheck, ESLint, Knip and scrub/header check | All exited 0. |
| Web, pivot, packaging and both builds | All exited 0. The web suite passed 57 tests and packaging passed 3. The compiled WASM matches the pinned fingerprint. |

| Final browser suite | TypeScript Chromium | TypeScript WebKit | Rust Chromium | Rust WebKit |
| --- | ---: | ---: | ---: | ---: |
| Synthetic live price views | 6 | 6 | 6 | 6 |
| Installed price views | 3 | 3 | 3 | 3 |
| Closed-example geometry rerun | 1 | 1 | 1 | 1 |
| Live Return Summary | 12 | — | — | — |
| Installed Return Summary | 5 | 5 | 5 | 5 |
| Risk Exposure | 5 | 4 | 5 | 4 |

The final browser matrix totals 90 passing executions with zero retries. The four targeted geometry reruns checked 24 notes. Each check requires at least one nonempty line-box collection. Each line fits inside the status scrollport on both axes. The six notes per example cover the histogram scope and window, drawdown scope, and small-multiples scope, baseline/end and window. In Chromium the small-multiples scope occupied y=672–689 inside a scrollport spanning y=563–714 CSS pixels. WebKit measured approximately y=672.26–688.74 in the same scrollport. The archived Chromium screenshot from before this fix clips that line and the histogram window.

The browser commands used the configurations in the original verification section below. The geometry rerun selected `-g "imports the fixed example"` on each engine-specific server. Every final price-view run recorded the expected engine and WASM response behavior. The archive listed below contains `final-fix-evidence/commands.tsv`, failure and rerun logs, screenshots, per-note rectangles, output assertions, build logs and Playwright reports. The three archived capture hashes and the example bytes still match the original records. [Review status](review.md)

## Original client gates

| Command | Result |
| --- | --- |
| `pnpm test:run` | Exit 0 after the inventory correction. 10,336 passed and 47 opt-in skips across 545 passing files and 7 skipped files. |
| `pnpm typecheck` | Exit 0. |
| `pnpm lint` | Exit 0. Focused ESLint also passed after the inventory correction. |
| `pnpm knip` | Exit 0. |
| `pnpm scrub` | Exit 0 after the tracked plan path correction. Scrub and header checks clean. |
| `pnpm test:web` | Exit 0. 57 passed. |
| `pnpm pivot:test` | Exit 0. 199 pivot-core, 1 pivot-wasm, and 19 wire codec tests passed. |
| `pnpm pivot:verify` | Exit 0. Existing generated WASM matched the pinned source and artifact fingerprints. |
| `pnpm test:pivot:packaging` | Exit 0. 3 passed, including the emitted-WASM smoke checks within the packaging run. |
| `pnpm build` | Exit 0. Vite production build emitted assets. |
| `pnpm build:web` | Exit 0. Built the local private preview function. |
| `git diff --check` and `git diff --cached --check` | Exit 0. |

The first full suite exited 1 with 10,335 passes and one failure. The exact example inventory omitted the new workspace. The one-line registration preserved the exhaustive check. `pnpm exec vitest run src/lib/appsJson.examples.test.ts` then passed all 134 cases before the full rerun. The first scrub exited 1 on an absolute home-directory path in the tracked plan. The correction uses portable worktree names and preserves the scrub rules. [Example inventory](../../../../../src/lib/appsJson.examples.test.ts)

The 47 skips were opt-in integrations for Rita authoring (12), Rita table model (4), example agents (13), Workspace sign-in (1), real endpoints (5), reference backend (6), and Rita live (6). The unit suite emitted React `act` and jsdom canvas diagnostics. Both Vite builds reported mixed static/dynamic imports and chunks over 500 kB.

## Original browser matrix

Counts are passed test executions. Chromium was 151.0.7922.34 and WebKit was 26.5. All entries ran with zero retries.

| Suite | TypeScript Chromium | TypeScript WebKit | Rust Chromium | Rust WebKit |
| --- | ---: | ---: | ---: | ---: |
| Live price views, synthetic source | 5 | 5 | 5 | 5 |
| Installed price views, qualified mirror replay | 3 | 3 | 3 | 3 |
| Live Return Summary regression | 12 | — | — | — |
| Installed Return Summary regression | 5 | 5 | 5 | 5 |
| Risk Exposure regression | 5 | 4 | 5 | 4 |

Task 5 ran the first three rows at the verified product revision. The inventory correction adds a filename to a unit-test list, so those browser runs carry forward. The configured run covers each browser's five synthetic workflow cases and three qualified installed replay routes. The legacy lifecycle spec ran on Chromium with the repository's ordinary browser configuration. [Live price view configuration](../../../../../playwright.live-price-views.config.ts) · [Legacy spec](../../../../../e2e/live-return-summary.spec.ts)

Task 6 ran the final two rows on fresh servers at the selected engines. The matrix exercises both canonical legacy captures, both deterministic installed mirrors, and the public equity capture for Return Summary. Risk Exposure covers its local financial views and units in both themes, panel zoom on resize, extreme histogram count-one hover, workspace repair/filter/export/reacquisition, and Chromium CDP touch gestures. The CDP touch case was selected only in Chromium. The other four Risk Exposure cases ran in both browsers. [Installed Return Summary spec](../../../../../e2e/installed-return-summary.spec.ts) · [Risk Exposure spec](../../../../../e2e/risk-exposure.spec.ts)

The live price view and installed Return Summary specs recorded successful `application/wasm` responses for `pivot_wasm_bg.wasm` in every Rust case and zero WASM responses in TypeScript. Risk Exposure used the same engine-specific servers. Its test fixture does not record per-case WASM responses.

The Task 5 browser commands were run from the client root with distinct browser/mock ports.

```sh
BDOBB_BROWSER_PORT=18755 BDOBB_MOCK_PORT=18756 VITE_TABLE_ENGINE=typescript pnpm exec playwright test --config playwright.live-price-views.config.ts
BDOBB_BROWSER_PORT=18757 BDOBB_MOCK_PORT=18758 VITE_TABLE_ENGINE=rust pnpm exec playwright test --config playwright.live-price-views.config.ts
BDOBB_BROWSER_PORT=18763 BDOBB_MOCK_PORT=18764 VITE_TABLE_ENGINE=typescript pnpm exec playwright test --config playwright.config.ts e2e/live-return-summary.spec.ts --retries=0
```

The last two rows used a local configuration inheriting the ordinary browser config. It selected `installed-return-summary.spec.ts` and `risk-exposure.spec.ts`, added Desktop Safari with `grepInvert: /scrolls to the final watchlist panel and zero-weight region/`, and set one worker, zero retries, the client root as the server working directory, and `reuseExistingServer: false`. With the local configuration at `$regression_config`, the invocation was as follows, with output paths supplied for reports and failure evidence.

```sh
env -u NO_COLOR -u FORCE_COLOR BDOBB_BROWSER_PORT=18773 BDOBB_MOCK_PORT=18774 VITE_TABLE_ENGINE=typescript pnpm exec playwright test --config "$regression_config"
env -u NO_COLOR -u FORCE_COLOR BDOBB_BROWSER_PORT=18775 BDOBB_MOCK_PORT=18776 VITE_TABLE_ENGINE=rust pnpm exec playwright test --config "$regression_config"
```

The initial TypeScript regression command on ports 18771/18772 exited 1 before running tests because Playwright tried to resolve the server command from the configuration's evidence directory. The client-root working directory fixed startup. The completed TypeScript and Rust runs each passed 19 cases. Task 5 also retained the expected missing-example failure and intermediate fixture assertion failures during test calibration. The final Task 5 counts were 16 per engine and 12 for the legacy spec.

## Paired installed replay

The generated equity and ETF mirror widgets selected `results` through `data.dataKey`. The preserved HTTP 200 GETs have the daily-price receipt in `extra.results_metadata.chart_sources.receipts` with version 1, `adjusted_close`, `2026-10-12` through `2026-11-19`, and both listings. The deterministic routes each delivered 19 rows and one known MCD.US omission. The public equity route delivered 29 positive prices and 28 observed returns per listing. The browser replay verifies captured queries, recipe worker values, Plotly trace data, and accessible notes against the captured raw rows and omission coordinates. [Installed price view spec](../../../../../e2e/installed-price-views.spec.ts)

| Capture | SHA-256 |
| --- | --- |
| [Installed deterministic mirror equity and ETF](../../../../../e2e/fixtures/installed-observed-returns/75a9026/deterministic-sdk.json) | `259a9638c5f658c97e9390e0636aa02b7d8665ddac7f9836dfd357ea84e55085` |
| [Installed public equity](../../../../../e2e/fixtures/installed-observed-returns/75a9026/public-demo.json) | `b12530ef2e936073d4b76dfa9e2252b7713fec4f6920d677f605022d3b3df99b` |
| [Canonical legacy standard aliases](../../../../../e2e/fixtures/installed-observed-returns/75a9026/canonical-standards.json) | `bd8262814090779f55daa6dfe64840fb1e62ed67378e05cd3994fd5f205dc111` |

The mirror captures originated in the paired local Linux arm64 v3 image with Core and Platform API 2.0.1. Their metadata records provider tree `35e2586eca1f6b39527412188879eb133639d026` and image index `sha256:f8cca8ee400a88f4ae331bc498c9e28520e9ff766410926bbfdac0e4edd29404`. The standard alias fixtures came from a separate Core 2.0.1 installation outside the standard routers' declared Core bounds. They cover the legacy client replay path. Supported installed qualification uses the mirror routes.

This v10 record covers archived installed HTTP replay and synthetic source tests. The earlier provider suite, image build, and public HTTPS acquisition belong to the separate v9 qualification.

## Example and portable data

Inspection and the scrub check found no credentials in the new example files. The workspace specifies chart settings and the fixed request on the generated mirror widget. A compatible-app round trip preserves the recipe settings and source reference and rejects injected receipts or price coordinates. The executor matrix also verifies presented JSON export on both engines. A browser export followed by a fresh import holds the reacquisition response and confirms all three charts wait for fresh source data. The branch adds only the two v10 example files under `docs/examples`. Existing snapshot examples and installed capture files compare byte-for-byte with the implementation base. [Example workspace](../../../../examples/v10-live-price-views.apps.json) · [Portable round-trip coverage](../../../../../src/lib/appsExtensionsV3.test.ts) · [Executor matrix](../../../../../src/lib/tableExecution/rust/dailyPriceEvidence.test.ts) · [Browser lifecycle coverage](../../../../../e2e/live-price-views.spec.ts)

## Local evidence archive

The handoff archive path is `.superpowers/archives/2026-11-21-v10-live-price-views-sdd.tar.gz` relative to the client root. The full SDD evidence tree includes Task 5, Task 6, and final-fix command logs, reports, screenshots, assertions and capture hashes. [Review record](review.md)
