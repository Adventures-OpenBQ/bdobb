# Run 5: service and HTTP-level results (no GUI)

Candidate: `codex/clean-v6` at f035a43. This half drives no app. Every result below is a **backend** disposition. All renderer and native-gesture parts are NOT_RUN here and belong to the operator's GUI pass.

**Result.** The reference backends, EXAMPLE_DATA (Market Kit) and the fixtures pass at HTTP level. OPENBQ_API fails at the backend:
- 14 widgets have backend defects;
- 25 EIA defaults are rejected as too broad;
- the service wedged for about 13 minutes under 3 concurrent slow CFTC requests.

The service also has broad descriptor gaps: 192 widgets have no usable default for a required input.

## Per-case status

| Case | Backend (this run) | GUI | Evidence |
|---|---|---|---|
| V3-001 | **PASS** | NOT_RUN | 70 widgets, 1 app, 14 tabs and 70 cards (exact). The ID set is the archived 69 plus `omni-python-widget`, which is the 70th ID, with nothing removed. Two widgets are unplaced: `company_list` and `plotly_chart_with_raw_data`. All 70 IDs went through the protocol: 68×2xx, the intentional 500, and `/udf` (root 404 by design, `/udf/config` 200). The 5 POST-only widgets that run 4 left at 405 now pass via POST. Non-default: 18 ok, 52 have no alternative value. Files: `manifests/reconcile.json`, `backend-sweep/baseline.jsonl`. |
| V3-002 | **PASS** | NOT_RUN | 72 widgets, 2 apps, 18 tabs, 74 cards. Versus baseline: added `openbq_demo_nulls` and `openbq_demo_prices`, nothing removed. Versus the inventory's 71 roster, the only extra is `omni-python-widget`. **Python Omni exclusion:** curated serves the descriptor but refuses execution with 403 ("Omni code execution in 'python' is not allowed … OPENBQ_OMNI_EXEC_ALLOWED"); baseline executes it (200). The intentional error (`markdown_widget_with_error_handling`, 500) has its own disposition. Upstream failures: **0 this run**; run 4's star-history image and `chains_highchart` 500s now return 200. Two descriptor diffs versus baseline are date defaults stamped at container start (2026-10-06 vs 2026-10-07). Files: `backend-sweep/curated.jsonl`, `manifests/reconcile.json`. |
| V3-010 | **FAIL** (backend) | NOT_RUN | All 995 widgets were enumerated and swept, default plus one non-default. 736 defaults return data. The failure list is below. Provider examples: OPENBQ apps.json has 38 apps, 223 tabs and 630 cards, and every card resolves. The v3.1.0 demo-providers fixture has 7 IDs: only `uscongress_bills_congress_gov_obb` (ok) and `cftc_cot_cftc_obb` (default 500, non-default ok) are served. **5 are absent** from the served catalog: EIA STEO, BLS search, EconDB indicators, Alpha Vantage EPS, `videos_video_custom_obb`. |
| V3-010 nine smoke checks | CBOE quote **PASS**, SEC search **PASS**; the other 7 **PASS only with input** | NOT_RUN | The six Yahoo checks and the historical chart (yfinance historical in chart view) fail on descriptor defaults: `symbol` is required but `value: null` (422/500). With `symbol=AAPL` all return data: historical 252 OHLC rows (chartable), quote 1, profile 1, fast info 1, income 156, balance 276. File: `backend-sweep/summary.json` → `smoke`. |
| EXAMPLE_DATA catalog | **PARTIAL** | NOT_RUN | Market Kit: 43/43 widgets return 200 (static files, so non-default is not applicable). 2 apps, 24 tabs, 120 cards. The Rita Tab Runner's 36 `markdown` cards are client built-in Markdown (`state.params.text`), not served widgets. `market_prices` is unplaced. Independent data oracles pass 47/47 (V6-007 practice, V6-008 monthly OHLCV, V6-010 returns, volatility, drawdown, portfolio and event rows). The served `aapl.json` is identical to frozen `demos/prices.json`. **Not served:** the practice/prices manifest (404), so its oracle ran against the frozen fixture only. Note: the AAPL window includes a real $0.25 dividend on 2025-02-10. Files: `backend-sweep/example-data.jsonl`, `backend-sweep/example-oracle.json`. |
| E05-012, 017, 018, 019, 020, 021, 022, 023 | **PASS** (request/response contract) | NOT_RUN | 14 probes against REFERENCE_BASELINE, each matching the legacy oracle text. Bravo returns no rows and A returns rows; false, 250, Rehearsal, 2026-10-02, "Selection of Days: 7", AAPL,MSFT,AMZN, AAPL,MSFT,GOOGL, alpha,beta, test/7, and Q1/Q2 Report options with a Q1 Report echo. File: `backend-sweep/e05-http.json`. |
| E05-067 | **PASS** (backend half) | NOT_RUN | The intentional error returns HTTP 500 `{"detail":"Error that just occurred"}`, and the neighbouring `markdown_widget` returns 200. |
| E05-044 | NOT_RUN | NOT_RUN | Requires stopping the reference container; the brief forbids restarts. |
| Fixture manifest | **PASS** | n/a | 26/26 fixture hashes match `fixture-inventory.json` (sha a6909480…). Contract docs are unchanged since run 1. Files: `manifests/fixtures.tsv`, `manifests/contract.sha256`. |

## Widget counts per service

| Service | Widgets | Apps / tabs / cards | Default 2xx | Default failures (non-ok) |
|---|---|---|---|---|
| REFERENCE_BASELINE | 70 | 1 / 14 / 70 | 69 (incl. UDF config) | 1 intentional |
| REFERENCE_CURATED | 72 | 2 / 18 / 74 | 70 (incl. UDF config) | 1 intentional, 1 no-exec exclusion |
| OPENBQ_API | 995 | 38 / 223 / 630 | 736 (incl. 5 UDF config, 10 empty) | 259 |
| EXAMPLE_DATA | 43 | 2 / 24 / 120 | 43 | 0 |

## OPENBQ_API failure dispositions (unique widgets; rows in `backend-sweep/failures.tsv`)

| Disposition | Widgets | What it is |
|---|---|---|
| DESCRIPTOR_INPUT_REQUIRED | 192 | The descriptor ships `null` for a required input: symbol, query, CIK, or a hidden `urls` selection. Some surface as 500 rather than 422, which is itself a defect smell. A supplemental seeded pass (`openbq-seeded*.jsonl`) gave these results: 115 return 200 (53 with symbol=AAPL, 36 from app card state, 26 from the viewer's first option); 31 return 204 (mostly Yahoo); 17 return 400/422 (AAPL not valid for the route); 25 could not be seeded. Congress and USDA viewers take the URL list as the raw JSON body. |
| UPSTREAM | 55 | Nasdaq/Nasdaq Nordic, Atlanta and KC Fed return non-JSON (`Expecting value`), EIA timeouts and rate limit, Yahoo 401 (funds), Fed BadZipFile/404 files, FINRA unreadable, US Treasury 403, OECD empty responses, and an SEC HTML block page. |
| BACKEND_DEFAULT_TOO_BROAD | 25 | EIA: the descriptor default trips the backend's own pagination ceiling. |
| BACKEND_DEFECT | 14 | `tmx_equity_screener_builder` (`No module named 'pywry'`); `yfinance_market_status` and `yfinance_equity_history_metadata` (unserializable types); `sec_institutions_search` (TypeError); Dallas Fed banking conditions and global real economic activity (worksheet not found); USDA vegetables & pulses and livestock & meat (archive member missing); USDA farm household income (`'2025P'`); `fred_..._tips_yields` (KeyError `date`); Fama-French Australia (upstream spells it `Austrlia.Dat`); Cboe futures settlements, Nasdaq splits calendar, and FFIEC peer group (response model parse). |
| BACKEND_SERVICE_STALL | 5 | CFTC positioning, swap trades, swap valuation and historical fixings, plus FINRA bonds: requests over 60 s. This coincided with the roughly 13-minute OPENBQ_API wedge (`manifests/services.md`). |
| HARNESS_INPUT_INVALID | 11 | The non-default value this harness chose is invalid for the route (for example "Please select a topic…", "Invalid food group…"). Not a backend finding. |

## Tooling

- `backend-sweep/sweep5.py` extends run 4's `sweep_lib` with: a POST retry on 405, the UDF `/config` probe, symbol/date/limit non-default fallbacks, and a stall guard.
- `seeded.py` runs the supplemental seeded and viewer passes.
- `e05_http.py` runs the E05 probes.
- `example_oracle.py` runs the independent example-data oracles.
- `summarize.py` does the classification and reconciliation and writes `summary.json`, `failures.tsv` and `manifests/reconcile.json`.

Not done here: per-param-class exhaustive variation (one non-default per widget only), authorized/missing/invalid key paths (no keys were in scope), E05-049 (a client unit suite, not HTTP), and every renderer and gesture check.
