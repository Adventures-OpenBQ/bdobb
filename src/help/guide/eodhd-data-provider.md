---
type: Note
tags: [bdobb, help, integrations, eodhd, provider, calendar, api-key]
---

# EODHD Data

EODHD (EOD Historical Data) is the paid data vendor Episode 9 adds to the stack. BDOBB never calls EODHD's data API and keeps no EODHD key. EODHD data reaches a card the way every provider's does: as widgets a connected OpenBB backend serves in its `widgets.json`. On the companion stack that backend is **openbq-api**, with the **`openbq-eodhd`** provider extension installed in its image; openbq-docker v9 carries it, ported from the openbb-docker v9.6 line's `openbb-eodhd/` and released as `openbq-eodhd`. The key is the stack's `EODHD_API_KEY`, set in its `credentials.env`.

## The widgets

The extension mounts an EODHD namespace inside openbq-api, one command for each OpenBB standard model it implements, so each becomes a widget with an id of the form `eodhd_<route>_eodhd_obb`:

| Widget id | What it returns |
|---|---|
| `eodhd_equity_price_historical_eodhd_obb` | Price bars: `1d`, `1W`, `1M` from the end-of-day endpoint, `1m`, `5m`, `1h` intraday |
| `eodhd_equity_fundamental_income_eodhd_obb` (also `…_balance_…`, `…_cash_…`) | The three financial statements, `annual` or `quarter`, `limit` periods |
| `eodhd_economy_calendar_eodhd_obb` | Economic events, each with its publisher and release |
| `eodhd_equity_calendar_earnings_eodhd_obb` | Earnings dates by symbol |

The same namespace carries quotes, profiles, dividends and splits, ownership, estimates, IPO and split calendars, ETF, index, crypto and currency data, news and Treasury rates. BDOBB lists whatever the backend's `widgets.json` declares; nothing in the app names EODHD widgets one by one, so the [[widget-library|widget library]] shows them as soon as the backend serves them. A dashboard that names one on a backend without the extension shows *Widget … is not on any connected backend.*

EODHD symbols are `TICKER.EXCHANGE` — `AAPL.US`, `VOD.LSE`. The extension qualifies a bare ticker to the US exchange, so `AAPL` works in a **Symbol** parameter or group.

## The key

`EODHD_API_KEY` is set on the stack, in its `credentials.env` (or through **Settings ▸ Provider API Keys**), never in BDOBB. A missing or refused key is an error from the backend, and the card shows it like any other backend error. **Settings ▸ Provider API Keys** lists EODHD only when a connected backend runs key-maint and reports that key (see [[provider-keys|Provider Keys]]). EODHD's public `demo` token answers for a few symbols, `AAPL.US` among them, which is enough to see the path work.

The extension also adds an **EODHD** app to the backend's `/apps.json` (Company, Ownership & Dividends and Markets tabs, eight cards), which the rail's Apps list shows next to the BDOBB examples.

## Calendars

EODHD's calendars are tables with a date column, so they offer **Calendar** in the card's **View** control, and every [[calendar-view|Calendar View]] mode works on them. Paged, Vertical and Horizontal set the widget's `start_date` and `end_date` to the window you scroll to, so the card fetches the dates on screen.

- **The economic calendar.** Each row carries its publisher in `source` and its release in `category`, which the extension resolves from a fixed index of EODHD's event names. A calendar whose rows carry a `source` filters with the three-level **Source → Release → Statistic** tree instead of Type and Series; a row the index does not know sits under **Other**, so nothing disappears from the tree. The rules are saved as paths, so a statistic EODHD adds under a release you kept appears without an edit.
- **The earnings calendar.** Its rows are titled by `symbol`, so the filter is **Type** and **Series**: choose `symbol` and type the tickers you follow, separated by commas. A bare ticker keeps the exchange-suffixed symbol (`AAPL` keeps `AAPL.US`), and only a dotted suffix counts, so `BRK` does not claim `BRK-B`. An event titled with a `TICKER.EXCHANGE` symbol is led by that company's logo, loaded from EODHD's public logo files; one that fails to load hides itself. The desktop app draws them; the [[web-preview|web preview]] admits no outside images, so it draws none.

## Statements and fiscal labels

The extension maps EODHD's statement line items to OpenBB's usual names — `revenue`, `net_income`, `total_assets`, `free_cash_flow` and so on — and passes every other line item through under a snake_case name. A statement card whose rows carry recognised fields offers the [[statement-view|Statement View]], whose period headers come from each row's `fiscal_year` and `fiscal_period`. In this line's openbq-eodhd 9.0.1 those two fields follow the company's own fiscal year-end as EODHD reports it, so a September year-end company's quarter ending in June reads `Q3`. BDOBB displays the labels the backend sends and does not re-derive them; the card's **FY ends** control governs period *parameters*, not these labels (see [[card-parameters|Card Parameters]]).

## Aggregation hints

The extension can attach a per-column aggregation hint to a statement or price-history column — the operator a rule suggests over time (`last` for a closing balance, `sum` for a flow), the frequencies it was reviewed at, and a ruleset version. BDOBB 9.0.0 reads that hint from `widgets.json` and keeps it with the column; a hint with an operator, status or shape it does not recognise is dropped and the column kept. In the Pivot drawer's **Measures** tab, a measure on a hinted column that has no aggregation yet shows **Use suggested** with the provider's operator (for example **Use suggested Last**) when the arrangement meets its rule; one click applies it, and nothing is applied until you click, so a pivot over an EODHD table still starts on the aggregations you choose (see [[tables|Tables]]). A backend table too large for the worker opens the older Pivot panel instead, where a data field's menu offers the same **Use suggested**. Rita reads it: on an EODHD backend table, a linked table fed by one, `describe_table` reports each hinted field's hint and whether it applies to the table's current arrangement, Rita prefers it, and `arrange_table` warns when a chosen aggregation contradicts it (see [[rita-chat|Rita (AI Chat)]]). On a backend table, a linked table or a managed table, when Rita leaves aggregation out, `arrange_table` applies the provider's operator and returns a `provider-aggregation-applied` note, except where it would combine instruments (see [[tables|Tables]]).

## Limits worth knowing

- Fundamentals cost EODHD credits per call. The extension fetches one bundle per symbol and caches it for a short while, so several statement cards for one symbol share one call, and a **Refresh** soon after can return the same data.
- Intraday history is capped per request by EODHD (roughly 120 days of one-minute bars). Narrow the date range for fine intervals.
- The exchange calendars behind date expressions such as `T-1bd` use EODHD's trading-calendar *format* but not its data: they come from the backend's own `api/v1/calendar/trading` route or the NYSE calendar bundled with the app, and need no EODHD key (see [[date-expression|Date Expressions]]).
- EODHD's live streaming quotes are not part of 9.0.0. From 10.0.0 they reach BDOBB as a live grid served by the stack's live-grid backend, not through openbq-api — see [[tables|Tables]] (Live grids) and the 10.0.0 example in [[example-dashboards|Example Dashboards]].

---
*Source: BDOBB 9.0.0 `src/lib/aggregationHint.ts` (`toAggregationHint`, called from `src/lib/widgetsJson.ts`), `src/lib/calendarView.ts` (`filterSeries`, `eventPath`, `eodhdLogoUrl`), `src/components/renderers/CalendarRenderer.tsx`, `src/lib/statementTaxonomy.ts`, `src/lib/statementRows.ts`, `src/lib/calendar.ts`, `src/lib/dataClient.ts` and `web/server.mjs`; `openbb-eodhd/README.md`, `openbb_eodhd/eodhd_router.py`, `openbb_eodhd/aggregation.py`, `models/_fundamentals.py`, `models/fundamental.py` and `models/calendar.py` in openbq-eodhd 9.0.1 (ported from the openbb-docker v9.6 line); the development line's `eodhd-data-provider` page at bdobb-v2 v9.6.3, checked against this line.*
*See also: [[calendar-view|Calendar View]] · [[statement-view|Statement View]] · [[provider-keys|Provider Keys]] · [[openbq-docker-stack|The openbq-docker Stack]] · [[example-dashboards|Example Dashboards]]*
