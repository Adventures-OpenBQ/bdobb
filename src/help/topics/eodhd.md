# EODHD data

EODHD is a paid market-data vendor. BDOBB never calls EODHD's data API itself
and holds no EODHD key: EODHD data reaches a card the way every provider's
does, as widgets a connected OpenBB backend serves. On the companion stack
that backend is **openbq-api with the `openbq-eodhd` extension** in its image,
and the key is the stack's `EODHD_API_KEY`, set in its `credentials.env`.

## Where the widgets come from

The extension adds an EODHD namespace to openbq-api, so its widgets arrive in
the backend's `widgets.json` like any other and appear in the widget library
with nothing to configure in BDOBB. Their ids read
`eodhd_<route>_eodhd_obb` -- for example
`eodhd_equity_price_historical_eodhd_obb`,
`eodhd_equity_fundamental_income_eodhd_obb`,
`eodhd_economy_calendar_eodhd_obb` and
`eodhd_equity_calendar_earnings_eodhd_obb`. A dashboard that names one of them
on a backend without the extension shows the card as unresolved: *Widget …
is not on any connected backend.*

EODHD symbols are `TICKER.EXCHANGE` (`AAPL.US`, `VOD.LSE`). The extension
qualifies a bare ticker to the US exchange, so `AAPL` works in a Symbol
parameter.

A missing or rejected key is the backend's answer, not BDOBB's: the card shows
the error the backend returns. **Settings ▸ Provider API Keys** lists EODHD only
when a connected backend runs key-maint and reports it (see Provider keys).

## In the Calendar view

EODHD's calendars are tables with a date column, so they offer **Calendar** in
the card's **View** control (see Calendar view). Two things are specific to
EODHD's rows:

![The Calendar view's toolbar and grid, where EODHD's calendars are drawn](./shots/calendar-view.png)

- The **economic calendar**'s rows carry their publisher (`source`) and
  release (`category`), so the calendar's filter is the three-level
  **Source → Release → Statistic** tree. A row the extension could not
  classify sits under **Other**.
- The **earnings calendar**'s rows are titled by symbol, so the filter is
  **Type** and **Series**: pick `symbol` and type the tickers you follow,
  comma-separated. `AAPL` keeps `AAPL.US`; `BRK` does not claim `BRK-B`.
  Each event that is a `TICKER.EXCHANGE` symbol is led by that company's
  logo from EODHD's public logo files. The desktop app shows them; a logo
  that does not load hides itself, and the web preview, which admits no
  outside images, shows none.

## In tables, charts and the Statement view

EODHD price histories are ordinary tables with a date column, so they also
offer **Chart**. The extension maps the three financial statements to
OpenBB's usual field names (`revenue`, `net_income`, `total_assets` and so on)
and gives each row a fiscal year and period, so an income, balance-sheet or
cash-flow card can offer the **Statement** view.

The extension can also put an aggregation hint on a statement or price
column (`last` for a closing balance, `sum` for a flow). BDOBB 9.0.0 keeps
that hint with the column when it reads `widgets.json`. In the Pivot drawer's
**Measures** tab, a measure on a hinted column that has no aggregation yet
offers **Use suggested** with the provider's operator when the arrangement
meets its rule; nothing is applied until you click it. A backend table too
large for the worker opens the older Pivot panel, whose data-field menu offers
the same **Use suggested**. Rita reads it:
on an EODHD backend table or a linked table fed by one she prefers the hint, and
`arrange_table` warns when an aggregation contradicts it. On a backend,
linked or managed table, when Rita leaves aggregation out, `arrange_table` applies the
provider's operator with a `provider-aggregation-applied` note, except where it
would combine instruments. See **Rita** and **Tables**.

## Not EODHD data

The exchange calendars behind date expressions such as `T-1bd` use EODHD's
trading-calendar *format*, but they come from the backend's own
`api/v1/calendar/trading` route (openbq-docker computes them itself) or from
the NYSE calendar bundled with the app; neither needs an EODHD key. Live
streaming quotes from EODHD are not part of this version.

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v10.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
