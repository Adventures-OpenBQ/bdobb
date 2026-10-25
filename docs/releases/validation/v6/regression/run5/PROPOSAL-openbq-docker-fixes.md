# Proposal: openbq-docker fixes for the run-5 OPENBQ_API widget defects

Status: **proposal, awaiting approval.** Nothing has been implemented. Written 2026-10-09 from run 5 (`README-services.md`, `backend-sweep/failures.tsv`, `backend-sweep/openbq-seeded*.jsonl`, `manifests/services.md`).

**Image under test.** `openbq-local:3.0.0`, OCI revision `35011a55` (image `3c72a542d2e5`). That revision is **not** the `v3.0.0` tag. The tag `v3.0.0` (= `v4.0.0` = `v5.0.0`) is `071ae7a`, which reverts `35011a5`'s Yahoo 401 retry. The two differ only in `v3/yfinance/source/openbq_yfinance/client.py`, `v3/yfinance/verify.py` and `v3/yfinance/README.md` and `source.json`. Every line reference below holds at both revisions.

**Where the code lives.** The image installs upstream `openbb-*` 2.0.x wheels from `requirements.lock` and patches them with `provider-fixes/` (hash-checked by `apply.py`). It also vendors `openbq_yfinance`, which is an exact copy of the `openbq-yfinance` repository's `v3.0.0` tag, and runs one `openbb-api` process. References of the form `openbb_x/...:N` are to the pinned wheel (openbb-core 2.0.1, openbb-platform-api 2.0.1, all other `openbb-*` 2.0.0).

## 1. Summary

| Class (unique widgets) | Count | Ours to fix? |
|---|---|---|
| Required input has no default | 192 | **Yes.** openbb-core (via overlay) plus the Fed viewer handlers |
| Backend defect | 14 | **Yes.** 2 in openbq-yfinance, 1 image dependency, 11 in `openbb-*` packages (via overlay) |
| Default too broad (EIA) | 25 | **Yes.** Descriptor defaults |
| Service stall over 60 s | 5 | Partly. CFTC is owned by the CFTC session; a general deadline guard is proposed here |
| Upstream | 55 | No. Dispositions only (§3); some mitigations |
| Harness input invalid | 11 | No. Not a backend finding |

Of the 995 widgets, 736 defaults return 2xx. The fixes below cover **231 widgets** directly (192 + 14 + 25). G5 adds a guard for the 5 stalls.

Delivery follows the existing pattern: an overlay file in `provider-fixes/` with a recorded original hash, plus an upstream PR to the OpenBQ OpenBB fork. openbq-yfinance fixes ship as a tag in that repository, re-vendored into the image.

## 2. Fixable groups

### G1. Required inputs with null defaults (192 widgets)

**What happens.** The 192 split as 100 → 500, 80 → 422 and 12 → 400. The 100 500s are 83 pydantic `missing` errors (58 of them yfinance) plus 17 Federal Reserve file viewers.

**Root cause, part a (500 instead of 422).**
- `openbb_core/app/provider_interface.py:322-325`, called at `:439`, adds every provider-only field with `force_optional=True`. The FastAPI route therefore accepts a request that omits `symbol`, and the provider's own `QueryParams` raises later.
- That later error reaches `openbb_core/api/exception_handlers.py:94-99`. There, `all_in_query` is never true for a *missing* field, because a missing field is never in the query string.
- The error then falls through to `exception()`. At line 38 it reads `error.errors`, a bound method rather than a list, so the `missing` → 422 branch at lines 48-55 is dead code. The response is 500.

**Root cause, part b (descriptor).** `openbb_platform_api/utils/openapi.py:502` sets `optional = not required`. Because of `force_optional`, it emits `optional: true, value: null` for inputs the provider requires. The client has no signal that it should prompt for them.

**Root cause, part c (viewers).** The Fed viewer handlers iterate `params.get("url", [])`. A body of `{"url": null}` yields `None`, which then gets iterated:
- `openbb_federal_reserve/federal_reserve_router.py:95,269`
- `openbb_federal_reserve/ffiec.py:39,137`

The BLS handlers already carry this fix in the overlay (`provider-fixes/openbb_bls/routers/*.py`).

**Recommendation: declare the param required and let the client prompt. Do not ship invented defaults.** The 192 inputs are a mix of symbols, CIKs, queries and URL selections. AAPL is wrong for 17 routes, and 31 others return 204 with it. A synthetic default would also show data the user never asked for.

**Fix.** Three overlay edits:
1. `exception_handlers.py:38`: call `error.errors()` when it is callable. The existing lines 48-55 then return 422 with `{"type": "missing", "loc": [...]}`.
2. `provider_interface.py:322-325`: when `force_optional` is set on a required field, also set `choices.setdefault(provider_name, {}).setdefault("x-widget_config", {})["optional"] = False`. `widgets.py:166-181` already merges per-provider `x-widget_config` into that provider's widget param. Each provider's widget then says `optional: false`, while the shared route stays optional for the other providers.
3. The Fed `*_download` handlers: use `urls = params.get("url") or []`, the same as BLS. A null selection then returns `[]`.

**Test.**
- A build-time script asserts that every `_obb` widget whose provider field `is_required()` has `optional: false`.
- `GET /api/v1/yfinance/equity/profile` with no `symbol` returns 422.
- Each Fed viewer given `{"url": null}` returns `[]`. Extend `scripts/verify-provider-fixes.py`, which does this for BLS.

**Risk.** Medium. Edits 1 and 2 touch openbb-core and so affect every route. The 80 routes that already return 422 must not change, and the openbb-core error-shape tests must still pass. The client must honour `optional: false` with `value: null`; that is decision D1.

### G2. `pywry` missing (`tmx_equity_screener_builder_obb`, 1 widget)

**Root cause.** `openbb-tmx` 2.0.0 declares `pywry>=2.0.6` only under its `builder` extra (wheel METADATA). `requirements.lock` pins `openbb-tmx==2.0.0` without the extra. The iframe imports `pywry` at `openbb_tmx/utils/screener_iframe.py:211,240`.

**Fix, choose one:**
- (a) Add `pywry==2.0.6` and its dependencies (`pytauri`, `redis`, `watchdog`, `setproctitle`, `websockets`) to `requirements.in` and the lock. Wheels exist for cp312 `manylinux_2_35` on amd64 and arm64, which the bookworm-based `python:3.12-slim` satisfies.
- (b) Drop the widget with `openbb-api --exclude '["/api/v1/tmx/equity/screener_builder*"]'`.

**Recommendation:** (b), unless the screener builder matters to an episode. Option (a) adds a native GUI stack to a headless image for one widget.

**Test.** For (a), `python -c "from pywry import Option; from pywry.grid import build_grid_html"` in the build, plus a 200 from the widget. For (b), the widget is absent from `widgets.json`.

**Risk.** (a) Image size, and native imports may need GTK/WebKit libraries at import time (unverified). (b) A visible widget disappears.

### G3. Code defects (13 widgets)

| Widgets | Repo / package | Root cause | Proposed fix | Test |
|---|---|---|---|---|
| `yfinance_equity_history_metadata`, `yfinance_market_status` | **openbq-yfinance** (vendored at `v3/yfinance/source`) | `records.py:19,52` test `isinstance(…, dict)`. yfinance 1.7.0's `HistoryMetadata` is a `collections.abc.Mapping`, so it falls through to `{'value': <object>}`. `clean()` at `:31` passes any unknown object through, including the `tz` field (`datetime.timezone`) of `Market.status`. **Reproduced locally** against Yahoo. | Use `Mapping` at both checks. At the end of `clean()`, return `str(value)` for anything that is not a JSON scalar. | Unit test: `records(HistoryMetadata-like Mapping)` and `records({"tz": timezone.utc})` both pass `json.dumps`. |
| `sec_institutions_search` | openbb-sec | `models/institutions_search.py:66`: `str.contains(query.query)` with `query` defaulting to `None` (line 17). | `if query.query:` filter, else return all rows (or raise an `OpenBBError` asking for a query). | Null query → 200 (or 400 with a message), never 500. |
| `dallas_banking_conditions`, `dallas_global_real_economic_activity` | openbb-federal-reserve | Hard-coded sheet names `dallas_bcs.py:93` `CSV_BCS_Index_Results` and `dallas_igrea.py:89` `IGREA`. **Live files now have** `BCS_Index_Results` and `Kilian Index`. | Pick the sheet by name with a fallback: the old name, the new name, then the only sheet. Column layouts are unverified and must be checked. | Parse the live workbook in an offline fixture test. |
| `usda_vegetables_and_pulses`, `usda_livestock_and_meat_domestic_data` | openbb-government-us | Hard-coded archive members `ers_vegetables_and_pulses.py:12` `Vegetables_Pulses.csv` and `ers_livestock_and_meat_domestic_data.py:18,28-58` `MeatSD.csv`/`MeatStats.csv`. **Live zips now hold** `vegetables-pulses-data.csv`, `Meat-Supply-Disappearance.csv` and `Meat-Statistics.csv`. | Map to the new names, or match case-insensitively on a stem. Column layouts are unverified and must be checked. | Fixture test against the current zips. |
| `usda_farm_household_income_and_characteristics` | openbb-government-us | `ers_farm_household_income_and_characteristics.py:173` `int(column.rstrip("F"))`. Upstream now marks preliminary years `2025P`. | `rstrip("FP")`, and sort `P` the same way as `F` at `:190`. | `parse_year("2025P") == 2025`. |
| `fred_fixedincome_government_tips_yields` | openbb-fred | `models/tips_yields.py:200-205` filters ids by maturity. When nothing matches or no rows return, line 242 `melt(id_vars="date")` raises KeyError. Why `maturity=5` matched nothing is unverified (needs a FRED key). | Raise `EmptyDataError` when `ids` or the frame is empty, so the route returns 204 instead of 500. Then check the `DTP` id pattern for 5-year. | Empty frame → 204. |
| `famafrench_country_portfolio_returns` (Australia) | openbb-famafrench | `utils/constants.py:1007` maps to `Australia.Dat`. Upstream ships `Austrlia.Dat`. | Map `"Australia": "Austrlia.Dat"`. | `country=australia` → 200. |
| `cboe_futures_settlement_prices` (`options=true`) | openbb-cboe | `utils/helpers.py:461` reads the CSV raw. On that session `Price` held a non-numeric token (`'CA…'`, truncated in the record), and the model's `price: float` rejects it. Today's file is clean. | `to_numeric(data["price"], errors="coerce")`, so non-numeric becomes null. | Fixture CSV containing a `CAB` row → 200 with a null price. |
| `nasdaq_equity_calendar_splits` | openbb-nasdaq | The standard model `calendar_splits.py:31-32` requires `numerator`/`denominator: float`. `models/calendar_splits.py:107-117` passes `None` for ratios that `_split_ratio` can't parse. | Make both fields optional on `NasdaqCalendarSplitsData`, or skip unparseable rows. | Ratio `"1-for-10"` → no 500. |
| `ffiec_list_of_banks_peer_group` | openbb-federal-reserve | `models/list_of_banks_peer_group.py:130` `amount * 1000` on a fractional thousands value. Line 60 types the field `int`. | `round(amount * 1000)`. | Fractional input → int. |

**Risk.** Low for each fix, since each is local to one fetcher. The Dallas and USDA renames are upstream format drift; check columns as well as names. `famafrench` and `cboe` are one-liners.

### G4. EIA defaults too broad (25 widgets)

**Root cause.** Every facet and date defaults to null and `limit` defaults to `None`. `openbb_us_eia/utils/api_query.py:287-292` refuses an unfiltered request over `MAX_AUTO_ROWS = 500_000` (line 17). That ceiling is deliberate, because such a response would be hundreds of MB. Since `sort` defaults to `asc` (lines 44-47), a bare `limit` would return the *oldest* rows.

**Fix.** Give these widgets a descriptor default of `limit = 5000` and `sort = desc`, which is one API page and the newest rows. Do it through per-provider `x-widget_config` on the `limit` and `sort` fields in an overlay of `api_query.py`. This changes descriptors only; API callers keep the full-pagination default.

**Alternative.** A relative `start_date` (for example the last year), if the client supports relative date tokens (decision D3).

**Test.** All 25 defaults → 200 with at most 5,000 rows, newest first.

**Risk.** Low. Widgets that work today also get the 5,000-row default, so a table that showed full history now shows the latest 5,000 rows until the user raises `limit`.

### G5. Stall class (5 widgets; the 13-minute wedge)

**What happened.** The stalls were CFTC positioning, swap trades, swap valuation and historical fixings, plus FINRA bonds (`bond_type=CA`). The image already contains the CFTC work: `140c4c6`, `169a17b`, `239db5a` and `cf62ff5`, which give per-provider loops and run CFTC and CBOE one at a time. Even so, three concurrent CFTC requests wedged even `apps.json` for about 13 minutes. A static route starving like that points to CPU-bound work holding the GIL against the server loop, not to loop blocking.

**Owner.** CFTC belongs to the session "Fix openbq-docker CFTC routes wedging the API". Its branch `claude/v3-cftc-wedge-fix` sits at `140c4c6`, which is already in the image. Its worktree holds uncommitted edits last touched 2026-10-07, and no CFTC commit newer than `cf62ff5` (2026-10-08) exists in the clones. No competing CFTC fix is proposed here. Run 5 is new evidence for that session: the wedge **recurs on `35011a5`**.

**General guard (all providers).** In the overlay `provider-fixes/openbb_core/app/command_runner.py:297-299`, wrap the provider future in `asyncio.wait_for(…, timeout=OPENBQ_COMMAND_TIMEOUT)` (default 55 s) and map a timeout to **504** with a clear detail. This frees the HTTP request and gives the client an answer instead of a hang. It cannot cancel the work already on the provider loop (the existing `ponytail:` note at `:249-250`), and it does not fix GIL starvation. That needs process isolation, which is the CFTC session's call.

**CFTC session review (2026-10-09).** The CFTC session agrees with G5, with these refinements.
- **Timeouts are per provider.** CFTC needs at least 90 s, or forex `swap_trades` (about 70 s on the NAS) will always return 504.
- **Cancel through the wrapped future.** Calling `wait_for` on it cancels the provider-loop task at its next await, which releases the CFTC lock and drains the queue. This corrects "cannot cancel" above for awaiting code.
- **Keep the existing structure.** The per-provider loops and the CFTC and CBOE locks stay.
- **Run 5 detail.** The CFTC defaults succeeded (7 s, 40 s and 45 s). Every CFTC non-default call queued behind the lock and timed out, as did `historical_fixings`' default.
- **Not fixed by G5:**
  - Synchronous CPU sections in polars and pandas cannot be interrupted.
  - The `apps.json` stall on the main loop is still unexplained. The working hypothesis is GIL starvation plus serializing large results, for example FINRA CA's roughly 150 MB of JSON. It has not been measured on the NAS.

  The real cure is **process isolation for heavy routes**, which is a user decision (D8). The CFTC session's note is `openbq-g5-assessment.md`, in the coordinator's side-session notes.

**FINRA.** The overlay already narrows the default bond type (`bond_list.py`), but non-default types still pull the full list. Apply the guard; no FINRA-specific fix.

**Test.** A provider command that sleeps 70 s → 504 in about 55 s, while `widgets.json` keeps answering.

**Risk.** Low. Legitimately slow cold calls (CBOE chains about 3.5 s, cold CFTC tens of seconds) must fit under the deadline, so it should be configurable per provider.

## 3. Upstream-only failures (no code fix)

| Source | Widgets | Disposition / mitigation |
|---|---|---|
| Nasdaq and Nasdaq Nordic (incl. `tmx_markets_movers_nasdaq`) | 21 | Non-JSON body (`Expecting value`), consistent with bot blocking of the egress IP. Mitigation: catch `JSONDecodeError` and raise `OpenBBError("Nasdaq returned a non-JSON (likely blocked) response")`, so the client sees 400 with a clear reason instead of a raw parse error. |
| EIA timeouts (9) and rate limit (1) | 10 | Map `TimeoutError` to 504 with a message, not `Unexpected Error -> TimeoutError ->` (500, empty). Caching EIA responses would also cut rate-limit hits. |
| Yahoo 401 (funds ×9, predefined screener) | 10 | **Environment, not code.** The NAS firewall leaves `fc.yahoo.com` unresolvable, so yfinance gets no cookie or crumb. This is the finding in the `071ae7a` revert. The fix is a router allow rule, which is the operator's call. |
| Atlanta Fed `BadZipFile` | 3 | Upstream serves non-zip content. Mitigation: a clear error. |
| Kansas City Fed 404 | 3 | Files moved. They might be re-pointable like the Dallas and USDA cases, but this was **not investigated**. |
| FINRA lookup unreadable, US Treasury 403, OECD empty, SEC HTML block page, ECB no pair, USDA RUCA timeout | 8 | Upstream. SEC's block page usually means the declared User-Agent is missing or rejected; check the SEC UA setting before calling it pure upstream. |

## 4. Home line and carry

| Fix | Subject first ships | Proposed home | Carry to |
|---|---|---|---|
| G1, G3 (openbb-* overlay), G4, G5 guard | `v1.0.0`: same `openbb-*` pins on v1/v2/v3. The overlay mechanism starts at `v2.0.0`. | `release/v3` (the image under test) | `v4.0.0` and `v5.0.0` (same commit and image as v3, so the same build) and `release/v6` |
| G3 yfinance (`records.py`) | `v3.0.0` (Episode 3 adds the extension) | `openbq-yfinance` repo → new tag (for example `v3.0.1`) → re-vendor into openbq-docker `release/v3` | Same as above |
| G2 `pywry` | `v1.0.0` (`openbb-tmx` pinned without the extra since v1) | `release/v3` | Same as above |

**Lineage gaps.**
- `origin/release/v6` is at `169a17b` and lacks 13 commits that `v3.0.0` has, including `239db5a`, `cf62ff5`, the FX-pricing commits and the Omni gate. Those must be carried before or alongside these fixes.
- Backporting to `v1.0.0`/`v2.0.0` is unclear. v1 has no overlay mechanism, and v2's overlay lacks the core files G1 and G5 patch. I'm not guessing; see D5.
- The NAS image (`35011a5`) is not any tag. Whichever build ships these fixes should come from a tagged commit.

## 5. Decisions for the user

1. **D1. Required versus default.** Approve "declare required, the client prompts" for the 192 (recommended). The client must render `optional: false, value: null` as a prompt, which needs verifying in BDOBB. The V3-010 smoke cases would then pass only with supplied input; accept that, or ask for an AAPL descriptor default on the yfinance symbol routes only.
2. **D2. `pywry`.** Install it (a) or exclude the TMX screener builder (b, recommended)?
3. **D3. EIA default.** `limit=5000, sort=desc` (recommended) or a relative `start_date`, and only for the 25 widgets or for all EIA widgets?
4. **D4. Stall guard.** Approve the configurable, per-provider 504 deadline in the command runner: 55 s by default, at least 90 s for CFTC. It cancels through the wrapped future. The CFTC session agreed on 2026-10-09.
5. **D5. Lines.** Approve `release/v3` as home, with carry to v4, v5 and v6, which is one image across v3-v5. Backport to v1/v2: yes or no? And the version label for the rebuilt image (for example `openbq-local:3.0.1`).
6. **D6. Upstream PRs.** File the `openbb-*` fixes as PRs to the OpenBQ OpenBB fork alongside the overlay (the existing practice), or overlay only?
7. **D7. Upstream mitigations (§3).** Do the error-mapping mitigations (Nasdaq non-JSON, EIA timeout → 504) now or later? Should someone look for the KC Fed files' new locations?
8. **D8. Process isolation for heavy routes** (CFTC, FINRA CA and others with large or CPU-bound results). This is the real cure for the main-loop and `apps.json` stalls. Do it, or accept G5's partial relief for now?
