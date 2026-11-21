# Independent reviews of the published PR heads

These reports apply to the three published heads identified by each reviewer. The evidence appendix preserves the original probe output. The follow-up records implementation and verification on the replacement commits. [Follow-up qualification](published-pr-follow-up.md)

# Post-publication Superpowers review of provider PR 6 and Docker PR 33

Reviewed the complete provider change from `a7597ecfb02d087c98c80df926b057f134b076e1` to `adb2e2e410552863bcbfbd5584e3e7c9720d0cbc` (8 paths) and Docker from `86ccb0a61662714b051c9a63d3436139aca851d5` to `52436dd8a1a6a13eaf142a8486a7f0bda7f1db5b` (17 paths). The client integration probe ran at `21a5b092fc00797dedc41054d09d6fcba911c6e8`. The acceptance criteria came from the approved live-observed-returns design and six-task plan. Inspected the raw SDK implementation, receipt/normalizer code, test changes, Docker stages, lock, trust gate, generated-route tests, release evidence and client capture/admission path. The review changed no product files. The probes and this report are confined to this evidence directory.

## Strengths

- PR 6 attaches the observer immediately after the actual daily SDK call and before it adds the per-symbol marker. Malformed arrays and a failed later listing abort the whole opt-in request. The ordinary path retains its previous empty response, row handling and symbol sort. The receipt preserves caller order independently of that table sort. [Bar fetcher](https://github.com/Adventures-OpenBQ/openbq-eodhd/blob/adb2e2e410552863bcbfbd5584e3e7c9720d0cbc/openbq_eodhd/models/_bars.py)
- Exact repetitions, in-window dated gaps, out-of-window records, undatable rows and invalid adjusted-close readings are tracked upstream of coercion. A later Pydantic validation failure also leaves an omission coordinate. The closed schema requires matching per-listing aggregates, unique in-window omissions, strict data types, sorted diagnostics and UTC acquisition time. Daily interval and currency/unit declarations are checked on rows that the normalizer later drops.
- PR 33's source subtree and the canonical Git commit both resolve to tree `757335c861fead6e500414eef46b3c080f053fdf`. This verifies all 151 tracked paths including modes. The source manifest and recorded wheel audit additionally compared per-file SHA-256 values, 95 installed package files and 104 wheel RECORD entries. The Dockerfile applies the certifi 2026.10.23 lock and the Requests bundle fingerprint gate in the parent of both API stages. The final image's existing network-disabled audit recorded the effective certifi bundle and a clean `pip check`. [Installed audit](verification.md#final-declaration-fix-and-requalification)
- I independently recomputed every return in all five final HTTP captures from the served adjusted prices and recorded gap coordinates. The four deterministic captures each give seven MCD and nine AAPL returns. The public equity mirror matches the separately acquired arrays on all 29 prices and 28 pairs per symbol. The checks confirmed both requested SDK calls occurred in caller order, the generated widget selects `results`, and all receipt counts reconcile. [Capture audit and fixture hashes](#backend-capture-auditlog)
- The logged canonical suite had 958 passes and one optional ArcticDB skip. The installed mirror suite had 25 passes, 41 passing subtests and one OpenBB deprecation warning. Existing standard-route controls, final-image mirror HTTP captures and the client replays distinguish generated metadata from actual transport. [Provider result](verification.md#final-declaration-fix-and-requalification) · [Installed result](verification.md#final-declaration-fix-and-requalification)

## Issues

### Critical

None found.

### Important

1. **An explicitly mismatched ticker can become a return on the requested listing.** PR 6 `openbq_eodhd/models/_daily_price_chart_source.py:150` fetches identity declarations by exact lower-case dictionary key. EODHD uses `Code` and `Exchange` elsewhere in this provider (`openbq_eodhd/models/search.py:53`). In a six-row AAPL acquisition, a final row explicitly declaring `Code="MCD"` and `Exchange="US"` passed with six delivered rows and an empty diagnostic list. Its price was 250 after an AAPL price of 100. The OpenBB row model had already stripped the conflicting declaration. The real client accepted the provider response and produced a +150% return for AAPL. The lower-case `code="MCD"` control correctly produced `identity_conflict`. Agreeing `code="AAPL", Code="AAPL", Exchange="US"` qualified. Contradictory `code="AAPL", Code="MCD"` incorrectly qualified, as did a conflicting `Code="MCD"` on a row lost to a null close. Inspect every recognized identity spelling before dropping rows or injecting a requested symbol, and reconcile simultaneous aliases rather than taking the first. Test a mixed-case contradiction on both kept and dropped rows and an agreeing declaration. Preserve the distinction between the .US listing suffix and primary venue. This fix requires no new venue map or venue-membership check. The client also uses case-sensitive alias lookup on selected rows and acquired field origins in `src/lib/widgetData/chartRecipes/dailyPriceEvidence.ts:124` and `:181`. Exercise its rejection independently when such fields are actually delivered. PR 33 ships the identical provider code at `v9/eodhd/source/openbq_eodhd/models/_daily_price_chart_source.py:150`. [Raw controls](#backend-raw-probelog) · [Actual client result](#backend-chart-probelog)
2. **A declared continuation or partial SDK array can qualify as complete.** PR 6 `openbq_eodhd/models/_daily_price_chart_source.py:29` and `:135` use exact spelling for paging/partial keys. The set covers both `next_page` and `nextPage`, but only one spelling for `next_cursor` and `is_partial`. A six-row array with a nonempty `nextCursor` on the last observation returned six safe rows and yielded a chart. An explicit `isPartial=true` likewise yielded safe evidence. Snake-case controls failed the acquisition. Use consistent canonicalization for these already recognized marker families. Verify that an explicit continuation or partial marker in a later requested listing prevents a successful-subset result. Preserve tests with true unpaged arrays. PR 33 vendors the same implementation at `v9/eodhd/source/openbq_eodhd/models/_daily_price_chart_source.py:135`. [Raw controls](#backend-raw-probelog) · [Client result](#backend-chart-probelog)

### Minor

- **The closed Python receipt validator accepts a duplicate with no original observation.** PR 6 `openbq_eodhd/models/_daily_price_chart_source.py:103` accepts a safe per-listing record with raw count 1, delivered and normalized counts 0, duplicate count 1 and zero omissions. The receipt passes `DailyPriceReceipt.model_validate_json`. The current producer only records repeats after observing a first signature and the client explicitly rejects this state in `dailyPriceEvidence.ts:64`, limiting present impact. Make the Python validator reject the same contradictory safe record and add a boundary test. [Probe result](#backend-raw-probelog)

## Evidence gaps

The Docker image identified by the local runtime was Linux/arm64 with OCI index `sha256:068944e7bded0471cb222399db083ffeb6306ae30fe14954907fa0dd8dfc2acc`. That dependency-consistent image serves the two generated mirrors. The separately captured standard equity/ETF endpoints used a deterministic SDK and OpenBB Core 2.0.1 with standard packages that declare Core below 2. Their HTTP responses support functional alias coverage with those particular installed bytes. A dependency-supported standard-router runtime remains unqualified. The reviewer checked the prior installed logs and the current image identity. The reviewer did not repeat the broad suites or build a new image. The targeted failure probes substituted only the SDK array and then used the normal fetcher and actual client chart builder. No sensitive credentials were used. [Canonical alias controls](verification.md#final-declaration-fix-and-requalification) · [Image identity](verification.md#final-declaration-fix-and-requalification)

## Declined to judge

- Exchange-session completeness, venue certification, historical ticker/issuer continuity and all-symbol entitlements. The contract promises adjacent observed quotes for a qualified acquisition. Only the two recorded public listings and fixed dates have live evidence.
- AMD64, production deployments, operator-managed CA settings and a deployment rollout. Qualification covered the default Requests trust in the local arm64 image, and the approved scope excludes deployment.
- Local-file lifecycle, renderer UI, statistical implementation and full TS/Rust worker evaluation beyond the reproduced client boundary. The separate PR 89 reviewer owns these paths.
- Hardware/device and live ArcticDB behavior. Neither is required to inspect the provider's daily EOD SDK capture or Docker mirror packaging.
- Presence of explicit false partial flags on an otherwise full array. The existing documented rule refuses markers by presence. This is a conservative false refusal, and this review only requires that true partial or continuing arrays reliably refuse.
- Future trust-store changes and validity of packages outside the captured versions. The current PR gate addresses exact fingerprints in the pinned bundle.

## Assessment and recommendations

| Scope | Ready to merge? | Reason |
| --- | --- | --- |
| Provider PR 6 | With fixes | The normal public payload and known gap cases work. Both Important cases can produce trusted charts from contradicted source facts. |
| Docker PR 33 | With fixes | The vendor, trust and installed-runtime checks match the current canonical commit exactly. That pin carries both Important findings. |
| Integration | With fixes | The actual chart builder accepted the faulty provider results, including a return from the wrong declared ticker. |

Correct the two Important findings in canonical source, align the client's delivered identity checks, and regenerate the Docker vendor/pin from the corrected commit. Retain the failing inputs as narrowly focused regressions through a normal GET and perform corresponding paired-image and client qualification at the replacement commits. The independently reconstructed public series and the default Requests bundle check remain useful controls for that requalification.

# BDOBB PR 89 and its paired acquisition contract

Reviewed the full 41-file client change from `70f1ab3477498cb7ccbd6e9ff109a17512b3eeb2` through `21a5b092fc00797dedc41054d09d6fcba911c6e8` in passes against the approved 20 November design and six-task plan. Cross-PR review used canonical provider `adb2e2e410552863bcbfbd5584e3e7c9720d0cbc`, Docker `52436dd8a1a6a13eaf142a8486a7f0bda7f1db5b`, the pre-fix and final wire captures, and the portable and local qualification records. File references below are client-relative unless identified otherwise.

## Strengths

- The regular table data client checks the completed URL, selector and identity of the selected response array. The adapter checks the provider, exact effective query, ordered listings, closed receipt fields, raw counts and unique delivered/omitted coordinates. The local-file path excludes this receipt family. A successful return-specific check leaves generic table completeness unknown. See `src/lib/dataClient.ts:520`, `src/lib/widgetData/chartRecipes/chartSourceContracts.ts:120`, `src/lib/localTableData.ts:166` and `src/lib/widgetData/chartRecipes/dailyPriceEvidence.ts:254`.
- Both executors check incoming rows before table operations can hide an incompatible declared unit or interval. The generic native and TypeScript coordinate projections preserve original fields, retain inherited omissions across links, and add later filtered dates. The grandchild tests check one provider omission plus two distinct table omissions against exact dated values, while aggregated/ambiguous inputs lose qualification. See `src/lib/tableExecution/engine.ts:42`, `src/lib/tableExecution/rust/protocol.ts:23`, `crates/pivot-core/src/chart_sources.rs:43`, `src/lib/tableExecution/resultStore.ts:83`, `src/lib/tableExecution/rust/dailyPriceEvidence.test.ts:104` and `src/lib/widgetData/chartRecipes/input.ts:114`.
- Both views share adjacent-price ratios, preserve selected listing order, and clip prices before differencing. Tests distinguish undelivered Wednesday from removed Wednesday, weekend pairs, 4/5 and 19/20 thresholds, exact zeros, zero IQR and extreme observations. Accepted plots disclose the observed-quote scope. See `src/lib/widgetData/chartRecipes/priceSamples.ts:34`, `src/lib/widgetData/chartRecipes/priceSamples.ts:112`, `src/lib/widgetData/chartRecipes/returnSummary.test.ts:344`, and `src/components/renderers/LinkedChartRenderer.tsx:669`.
- The checked-in browser cases open and close Parameters, preserve a draft until measured Apply, compare both charts' accessible values, and exercise filtering, common pins and reacquisition after portable import. They test held replacements for symbol, bounds, interval, backend, selector and credential, matching stale recovery, and Rita tool payloads before and after off-tab Run with configured and pinned sources. See `e2e/live-return-summary.spec.ts:46`, `:122`, `:169`, `:237` and `:287`.
- Independently recomputed every expected return, including its date, in all ten route captures across six JSON files. Both public captures reproduce exactly 29 adjusted closes and 28 returns for each listing. Deterministic captures reproduce 7 MCD.US and 9 AAPL.US pairs. The four route spellings, generated selectors, ordered SDK calls per GET and all six recorded fixture digests matched. [Calculation results](#verified-client-captureslog)
- A fresh production-mode TypeScript browser build with the repository's browser shims and final public capture issued exactly one source GET for the table alone. With the chart added it issued one GET total for two boxes and remained at one after applying violin and rendering both densities. This resolves the initial request-count question raised by the two GETs observed in the recorded development runs. [Standalone table](#count-source-alonelog) · [Box and violin](#count-browserlog) · [Probe](#count-browserts)

## Issues

### Critical

None found.

### Important

**Conflicting listing declarations can qualify prices for the wrong instrument.** Provider `openbq_eodhd/models/_daily_price_chart_source.py:151` reads only exact lowercase field names. The normalizer at provider `openbq_eodhd/models/_bars.py:133` then discards other fields. The client uses the same exact lowercase lookups on the actual selected array at `src/lib/widgetData/chartRecipes/dailyPriceEvidence.ts:124` and skips mixed-case identity origins at `src/lib/widgetData/chartRecipes/dailyPriceEvidence.ts:181`. EODHD's own search and ETF data use `Code` and `Exchange` for identity, as shown in provider `openbq_eodhd/models/search.py:53` and `openbq_eodhd/models/_etf_hierarchy_source.py:155`.

On the published heads, the canonical fetcher accepted a daily request for MCD.US with six bars explicitly declaring `Code=MSFT, Exchange=TO`. It produced a clear receipt with six raw and six delivered. The client accepted those declarations in selected rows and plotted five returns under MCD.US. Both also accepted the contradictory pair `symbol=MCD.US, Ticker=MSFT.US`. With lowercase `code=MSFT, exchange=TO`, the provider flagged `identity_conflict` and the client refused. A control without identity declarations qualified. The captured public examples contain the ordinary expected rows. [Provider probe](#identity-provider-probepy) · [Provider results](#identity-provider-probelog) · [Client probe](#identity-client-probecjs) · [Client results](#identity-client-probelog)

Inspect every occurrence of a recognized identity alias case-insensitively on raw bars, selected rows and acquired field origins. Verify conflicting variants even when a valid lowercase identity exists or the row will later be filtered. Keep the exact canonical bindings required by the receipt, and preserve eligibility for unlabeled rows and consistent optional aliases. Add regression cases on the provider, client and installed route, then update the vendor and paired verification for the corrected heads.

### Minor

The existing fully filtered live source prioritizes “No valid daily prices remain” over an unavailable saved binding at `src/lib/widgetData/chartRecipes/input.ts:103`. This affects repair guidance. Both conditions refuse and no observations are plotted.

## Evidence gaps

- The full test suite, prior browser matrices, compiled Rust, image installation and real-service fetches are attributed to the recorded qualification runs. I checked the product-to-published-head diff, recalculated fixture results, ran the focused identity probes, and ran the production-mode Chromium/TypeScript request-count probe. I did not re-run the complete suites. Published client changes after the last full product gate are fixtures, the replay's fixture path, and documentation.
- Image qualification covers the local arm64 mirror routes with a dependency-consistent stack. The standard routes were captured in a separate installed canonical environment whose extension packages declare an older Core range. The production-mode browser probe used a replay backend and browser shims. Historical validation records preserve the optional skips, the transient narrow-touch hover failure, and environment warnings.

## Declined to judge

- Exchange-session completeness, venue membership across time, issuer continuity and historical-as-known prices require additional data beyond the approved observed-quote question.
- Other account entitlements and future vendor revisions are outside the public sample. General qualification is judged on source shape and identity, including the conflicting examples above.
- Physical devices, amd64 installation, live ArcticDB, broader dependency upgrades and deployment are outside this client qualification. The companion reviews cover vendor package and trust-bundle implementation in detail.

## Assessment

**Ready to merge PR 89 and its paired integration? With fixes.** Hold integration on the current heads. The fixed-window results, normal request lifecycle and cross-engine projection are substantiated, but the source can still authorize prices explicitly declared for a different listing. Correct and requalify the identity checks across all three branches before integration.

# Ponytail full review

- `client/src/lib/widgetData/chartRecipes/chartSourceContracts.ts:L42` shrink: Give `coordinates(receipt, provenance)` one optional result and call it directly in `sourceState`. Rename the daily implementation and delete its empty fallback. Use `satisfies ChartSourceAdapter<…>` on the metric and estimate adapters so their existing one-argument callers retain their definite return types. −5 lines.
- `client/src/lib/widgetData/chartRecipes/dailyPriceEvidence.ts:L42` shrink: Move the generic exact-own-keys and nonnegative-safe-integer predicates into `chartSourceShape.ts` and import them in both the daily and ETF hierarchy decoders. Both currently run the same descriptor-aware record check, key-count check and own-key checks. −3 lines.
- `client/e2e/installed-return-summary.spec.ts:L45` shrink: Move the existing live suite’s Playwright `engineEvidence` fixture into `e2e/fixtures/return-summary.ts` and yield its engine and WASM URLs to the installed suite. Both specs then use the same viewport, successful-WASM-response listener and engine assertion. Keep the installed request and worker-sample attachments. About −7 lines.
- `provider/openbq_eodhd/models/_daily_price_chart_source.py:L36` shrink: Use `return value if isinstance(value, str) and len(value) == 10 and iso_date(value) is not None else None` with the existing strict round-trip parser in `_chart_evidence.py`. −5 lines.
- `provider/openbq_eodhd/models/_daily_price_chart_source.py:L176` shrink: Use `return type(value) in (int, float) and value > 0 and finite_number(value) is not None`. The existing helper catches integer overflow and rejects infinities. The exact type guard still excludes booleans and strings. −5 lines.
- `provider/openbq_eodhd/models/_daily_price_chart_source.py:L132` shrink: Raise `invalid_response` first for a non-dict or a truthy error field, then raise `partial_acquisition` for intersecting partial keys. Keep the final array check for wrappers. This removes the nested success branch while preserving diagnostic precedence. −2 lines.
- `provider/tests/test_daily_price_chart_source.py:L66` stdlib: Replace both datetime subclasses with `SimpleNamespace(now=acquired_at.astimezone)` and `SimpleNamespace(now=later.astimezone)` at the same two monkeypatch sites. The bounded daily path calls only `now` on those two objects and the timestamp assertion still distinguishes acquisition from transformation. −9 lines.
- `docker/v9/eodhd/tests/test_daily_price_chart_source.py:L43` shrink: Return `[BAR.copy()]` from the SDK mock and drop the `deepcopy` import. Each call still gets a fresh list and dictionary, and every value in `BAR` is immutable. −1 line.

## Review evidence and limits

| PR | Base → reviewed head | Flow examined |
| --- | --- | --- |
| Client #89 | `70f1ab3477498cb7ccbd6e9ff109a17512b3eeb2` → `21a5b092fc00797dedc41054d09d6fcba911c6e8` | Completed request and response → acquisition → TypeScript/Rust projection → draft and recipe → chart. Checked the six capture files, their replay consumers and release references. |
| Canonical provider #6 | `a7597ecfb02d087c98c80df926b057f134b076e1` → `adb2e2e410552863bcbfbd5584e3e7c9720d0cbc` | Equity/ETF qualification → per-listing SDK calls → raw audit → shared normalizer → closed receipt, including the ordinary path and negative tests. |
| Docker #33 | `86ccb0a61662714b051c9a63d3436139aca851d5` → `52436dd8a1a6a13eaf142a8486a7f0bda7f1db5b` | API image trust check, source pin, installed mirror routes and SDK assertions. All eight changed canonical files matched their vendored copies byte for byte. |

Read-only source review against the approved six-task plan. The two TypeScript suggestions for the adapter and predicates passed focused in-memory type checks. The Python helper replacements matched the current functions on 10 date and 13 price inputs, including malformed dates, booleans, nonfinite values and oversized integers. Browser suites, image builds and broad tests were outside this pass. Line savings are estimates across hand-maintained files, counting canonical changes once.

net: -37 lines possible.

## Original review evidence

### backend-capture-audit.log

```text
canonical-standards.json 39de0d64ef43c2fffa9a4a919a9782189c6c79d0f6ac6bacadbb17ecc483748f /api/v1/equity/price/historical [('MCD.US', 9, 7), ('AAPL.US', 10, 9)]
canonical-standards.json 39de0d64ef43c2fffa9a4a919a9782189c6c79d0f6ac6bacadbb17ecc483748f /api/v1/etf/historical [('MCD.US', 9, 7), ('AAPL.US', 10, 9)]
deterministic-sdk.json ec79f38d4491ad5a21116e746b07608f74e177d4ab84b6b53ce334b78f23d239 /api/v1/eodhd/equity/price/historical [('MCD.US', 9, 7), ('AAPL.US', 10, 9)]
deterministic-sdk.json ec79f38d4491ad5a21116e746b07608f74e177d4ab84b6b53ce334b78f23d239 /api/v1/eodhd/etf/historical [('MCD.US', 9, 7), ('AAPL.US', 10, 9)]
public-demo.json a993a8c8b8cb443b338ea5d16864e62bf1ee89bad4013402a1956fbe76e0b61c /api/v1/eodhd/equity/price/historical [('MCD.US', 29, 28), ('AAPL.US', 29, 28)]
```

### backend-raw-probe.log

```text
control rows 6 diagnostics []
orphan_receipt_accepted True
agreeing_case rows 6 diagnostics []
conflicting_case rows 6 diagnostics []
lower_identity rows 5 diagnostics ['identity_conflict']
dropped_case rows 5 diagnostics []
case_identity rows 6 diagnostics []
case_exchange rows 6 diagnostics []
lower_partial EODHD (AAPL.US): partial_acquisition
camel_partial rows 6 diagnostics []
lower_cursor EODHD (AAPL.US): partial_acquisition
camel_cursor rows 6 diagnostics []
false_partial EODHD (AAPL.US): partial_acquisition
```

### backend-chart-probe.log

```text
backend-control.json true [ 0, 0, 0, 0, 1.5 ]
backend-case_identity.json true [ 0, 0, 0, 0, 1.5 ]
backend-camel_cursor.json true [ 0, 0, 0, 0, 1.5 ]
```

### verified-client-captures.log

```text
e2e/fixtures/installed-observed-returns/adb2e2e/canonical-standards.json /api/v1/equity/price/historical MCD.US 9 quotes/7 returns, AAPL.US 10 quotes/9 returns
e2e/fixtures/installed-observed-returns/adb2e2e/canonical-standards.json /api/v1/etf/historical MCD.US 9 quotes/7 returns, AAPL.US 10 quotes/9 returns
SHA256 39de0d64ef43c2fffa9a4a919a9782189c6c79d0f6ac6bacadbb17ecc483748f
e2e/fixtures/installed-observed-returns/adb2e2e/deterministic-sdk.json /api/v1/eodhd/equity/price/historical MCD.US 9 quotes/7 returns, AAPL.US 10 quotes/9 returns
e2e/fixtures/installed-observed-returns/adb2e2e/deterministic-sdk.json /api/v1/eodhd/etf/historical MCD.US 9 quotes/7 returns, AAPL.US 10 quotes/9 returns
SHA256 ec79f38d4491ad5a21116e746b07608f74e177d4ab84b6b53ce334b78f23d239
e2e/fixtures/installed-observed-returns/adb2e2e/public-demo.json /api/v1/eodhd/equity/price/historical MCD.US 29 quotes/28 returns, AAPL.US 29 quotes/28 returns
SHA256 a993a8c8b8cb443b338ea5d16864e62bf1ee89bad4013402a1956fbe76e0b61c
e2e/fixtures/installed-observed-returns/canonical-standards.json /api/v1/equity/price/historical MCD.US 9 quotes/7 returns, AAPL.US 10 quotes/9 returns
e2e/fixtures/installed-observed-returns/canonical-standards.json /api/v1/etf/historical MCD.US 9 quotes/7 returns, AAPL.US 10 quotes/9 returns
SHA256 cc6240f361b50930c6e7d533b0f6a05332dccf776dc14579039ffabb1cbed9f3
e2e/fixtures/installed-observed-returns/deterministic-sdk.json /api/v1/eodhd/equity/price/historical MCD.US 9 quotes/7 returns, AAPL.US 10 quotes/9 returns
e2e/fixtures/installed-observed-returns/deterministic-sdk.json /api/v1/eodhd/etf/historical MCD.US 9 quotes/7 returns, AAPL.US 10 quotes/9 returns
SHA256 1ad0ae85769c72b38a3db998f6e21791853cd2e65fa97083401f00f4d1be7669
e2e/fixtures/installed-observed-returns/public-demo.json /api/v1/eodhd/equity/price/historical MCD.US 29 quotes/28 returns, AAPL.US 29 quotes/28 returns
SHA256 1564b9e9893cb620c7baf8a8397e6a154f7db0dd8cda05699037f7c6d82d31a9
```

### count-source-alone.log

```text
source alone 1
```

### count-browser.log

```text
boxes 2 GETs 1
violins 2 GETs 1
```

### count-browser.ts

```typescript
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dashboardSeed, seedApp } from '../../e2e/fixtures';
import { card, openParameters } from '../../e2e/fixtures/chart-recipes';
import { liveRecipe } from '../../e2e/fixtures/return-summary';
async function main() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({viewport:{width:1250,height:930},baseURL:'http://127.0.0.1:19931'});
    const endpoint = '/api/v1/eodhd/equity/price/historical';
    const capture = JSON.parse(readFileSync('e2e/fixtures/installed-observed-returns/adb2e2e/public-demo.json','utf8')).routes[endpoint];
    const origin='http://127.0.0.1:17926', sourceId='aaaaaaaa-2222-4333-8444-555555555555';
    let gets = 0;
    await page.route(origin+'/**',async route=>{
      const url=new URL(route.request().url()), prices=url.pathname===endpoint;
      if(prices) gets++;
      await route.fulfill({json:prices?capture.body:url.pathname==='/widgets.json'?{[capture.widgetId]:capture.widget}:{},
        status:200,headers:{'Access-Control-Allow-Origin':'*'}});
    });
    const chart = {id:'returns',widgetId:'linked_chart',backendId:'builtin',title:'Captured return summaries',params:{},
      linkedSource:{kind:'widget',sourceWidgetId:sourceId},linkedChart:{type:'return-summary',recipe:liveRecipe,measures:[],display:'grouped'},layout:{x:0,y:0,w:40,h:29}};
    const source = {id:sourceId,widgetId:capture.widgetId,backendId:'captured-eodhd',title:'Captured EODHD prices',params:capture.query,layout:{x:0,y:29,w:40,h:14}};
    const seed = dashboardSeed(process.env.ONLY_SOURCE?[source]:[chart,source]);
    seed['backends.json']=JSON.stringify([{id:'captured-eodhd',name:'Captured EODHD',baseUrl:origin,authLocation:'header',validateWidgets:false}]);
    await seedApp(page,seed);
    await card(page,'Captured EODHD prices').getByRole('columnheader',{name:/adjusted.close/i}).waitFor();
    if(process.env.ONLY_SOURCE) { console.log('source alone',gets); return; }
    const plot=card(page,chart.title);
    await plot.locator('.boxlayer path.box').first().waitFor();
    console.log('boxes',await plot.locator('.boxlayer path.box').count(),'GETs',gets);
    const params=await openParameters(plot);
    await params.getByLabel('Return view').selectOption('violin');
    await params.getByRole('button',{name:'Apply chart settings'}).click();
    await plot.locator('.scatterlayer path.js-fill').first().waitFor();
    console.log('violins',await plot.locator('.scatterlayer path.js-fill').count(),'GETs',gets);
  } finally { await browser.close(); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
```

### identity-provider-probe.py

```python
"""Run from the canonical provider checkout with PYTHONPATH=. and its Python."""
import asyncio
from unittest.mock import MagicMock, patch

from openbq_eodhd.models.equity_historical import EODHDEquityHistoricalFetcher

days = ["2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"]
query = dict(symbol="MCD.US", start_date="2026-10-12", end_date="2026-11-19", interval="1d", chart_source=True)
for declaration in ({}, {"code": "MSFT", "exchange": "TO"}, {"Code": "MSFT", "Exchange": "TO"}, {"symbol": "MCD.US", "Ticker": "MSFT.US"}):
    sdk = MagicMock()
    sdk.get_eod_historical_stock_market_data.return_value = [
        dict(date=day, open=100, high=120, low=95, close=101+i, volume=10, adjusted_close=100+i, **declaration)
        for i, day in enumerate(days)
    ]
    with patch("openbq_eodhd.models._bars.get_client", return_value=sdk):
        result = asyncio.run(EODHDEquityHistoricalFetcher.fetch_data(query, {"eodhd_api_key": "TEST"}))
    receipt = result.metadata["chart_sources"]["receipts"][0]
    print(dict(declaration=declaration, requestedPeriod=sdk.get_eod_historical_stock_market_data.call_args.kwargs["period"],
               receiptInterval=receipt["interval"], diagnostics=receipt["diagnostics"],
               delivered=receipt["delivered_count"], raw=receipt["raw_count"]))
```

### identity-provider-probe.log

```text
{'declaration': {}, 'requestedPeriod': 'd', 'receiptInterval': '1d', 'diagnostics': [], 'delivered': 6, 'raw': 6}
{'declaration': {'code': 'MSFT', 'exchange': 'TO'}, 'requestedPeriod': 'd', 'receiptInterval': '1d', 'diagnostics': ['identity_conflict'], 'delivered': 0, 'raw': 6}
{'declaration': {'Code': 'MSFT', 'Exchange': 'TO'}, 'requestedPeriod': 'd', 'receiptInterval': '1d', 'diagnostics': [], 'delivered': 6, 'raw': 6}
{'declaration': {'symbol': 'MCD.US', 'Ticker': 'MSFT.US'}, 'requestedPeriod': 'd', 'receiptInterval': '1d', 'diagnostics': [], 'delivered': 6, 'raw': 6}
```

### identity-client-probe.cjs

```javascript
// Run from the client root. Execute the bundled probe in memory.
const {buildSync} = require('esbuild');
const {createRequire} = require('node:module');
const {resolve} = require('node:path');
const contents = `
import { liveDailyPriceDataset } from './src/test/fixtures/liveDailyPrices';
import { readLiveDailyPriceSource } from './src/lib/widgetData/chartRecipes/dailyPriceEvidence';
import { buildReturnSummary } from './src/lib/widgetData/chartRecipes/returnSummary';
const days = ['2026-10-12','2026-10-19','2026-10-26','2026-11-02','2026-11-09','2026-11-16'];
const fields = {date:'date', price:'adjusted_close'};
const bounds = {start_date:days[0],end_date:'2026-11-19'};
for (const [declaration, length] of [[{},6],[{code:'MSFT',exchange:'TO'},6],[{Code:'MSFT',Exchange:'TO'},6],[{symbol:'MCD.US',Ticker:'MSFT.US'},6]]) {
  const rows = days.slice(0,length).map((date,i)=>({date,adjusted_close:100+i,...declaration}));
  const dataset = liveDailyPriceDataset(rows,['MCD.US'],{bounds});
  const result = buildReturnSummary(dataset,{version:1,kind:'return-summary',view:'box',fields,symbols:['MCD.US'],window:{mode:'own'}},{today:bounds.end_date,theme:'light',maxDecimals:2});
  console.log(JSON.stringify({declaration,rows:rows.length,qualified:!!readLiveDailyPriceSource(dataset),chart:result.ok,samples:result.returnSummary?.series[0].samples.length,message:result.message}));
}
`;
const {text} = buildSync({stdin:{contents,resolveDir:process.cwd(),loader:'ts'},bundle:true,packages:'external',format:'cjs',platform:'node',write:false,logLevel:'silent'}).outputFiles[0];
new Function('require',text)(createRequire(resolve('package.json')));
```

### identity-client-probe.log

```text
{"declaration":{},"rows":6,"qualified":true,"chart":true,"samples":5}
{"declaration":{"code":"MSFT","exchange":"TO"},"rows":6,"qualified":false,"chart":false,"message":"Choose a local adjusted-price snapshot with an acquisition receipt documenting its daily interval and dates."}
{"declaration":{"Code":"MSFT","Exchange":"TO"},"rows":6,"qualified":true,"chart":true,"samples":5}
{"declaration":{"symbol":"MCD.US","Ticker":"MSFT.US"},"rows":6,"qualified":true,"chart":true,"samples":5}
```
