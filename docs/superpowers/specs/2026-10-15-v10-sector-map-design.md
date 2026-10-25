# v10 Sector Map — design

**Date:** 2026-10-15 · **Line:** v10.0.0 (folds into the v10.0.0 re-cut; OpenBQ lines take no point releases)
**Repos:** Adventures-OpenBQ/openbq-docker (live-grid) + Adventures-OpenBQ/bdobb (client + example)
**Branches:** `claude/v10-sector-map` off `release/v10` in both. Local until the user rules on placement and re-cut.

## Goal

A v10 example card that shows the S&P 500 as a live Finviz-style map: one tile
per sector, **tile area = the sector's weight in the index**, **tile colour =
the day's % change of that sector's SPDR ETF**. Data comes through the live
grid, so the colours move with the websocket feed.

## Decisions (user, 2026-10-15)

| Question | Ruling |
| --- | --- |
| Trace | Plotly `treemap`, not `heatmap` (a heatmap cannot size cells) |
| Weights | EODHD `SPY.US` fundamentals, `ETF_Data::Sector_Weights` |
| Freshness | `chart` widget polling the live-grid quote table; no new socket |
| Version | v10.0.0, both repos |

## openbq-docker: live-grid

**Route `GET /sector_map`** returns Plotly figure JSON (`{data, layout}`), like
`/chart`.

1. **Renew leases** on the 11 ETFs via the existing `LeaseRegistry.renew`, so
   the shared `FeedManager` keeps them subscribed. The service stays the single
   EODHD websocket consumer per key. With a 15 s poll and the 300 s default TTL,
   the leases never lapse while a card is open, and they are swept once it closes.
2. **Read % change** from `QuoteTable.rows[sym]["change_percent"]`. If any ETF
   has no row yet (cold process, or market closed before the first tick), seed
   it once with `quotes.seed(missing, _seed_client())`, the same REST path
   `/snapshot` uses.
3. **Weights**: call `client.get_fundamentals_data(ticker="SPY.US",
   filter="ETF_Data::Sector_Weights")` and read `float(v["Equity_%"])` per
   sector. Cache it in-process for 24 h. If the fetch fails or returns fewer than
   11 known sectors, respond **502** with the reason. There are no hard-coded
   fallback weights.
4. **Sector → ETF map**, a fixed module constant (EODHD uses Morningstar names,
   checked against the live response on 2026-10-15):

   | EODHD sector | ETF | EODHD sector | ETF |
   | --- | --- | --- | --- |
   | Technology | XLK | Industrials | XLI |
   | Financial Services | XLF | Consumer Defensive | XLP |
   | Healthcare | XLV | Energy | XLE |
   | Consumer Cyclicals | XLY | Utilities | XLU |
   | Communication Services | XLC | Real Estate | XLRE |
   | Basic Materials | XLB | | |

5. **Figure**: one `treemap` trace.
   - `labels` = sector names; `parents` = `""`; `values` = weights;
     `branchvalues: "total"`.
   - `marker.colors` = % change, colorscale red → grey → green,
     symmetric `cmin`/`cmax` = ±max(|change|, 1), which centres grey on 0.
   - `text` = `"XLK<br>41.2% · +0.84%"`; `textinfo: "label+text"`.
   - An ETF with no price yet is drawn grey with the text "n/a". It is never
     dropped, because dropping it would change the other tiles' sizes.
   - Layout: title "S&P 500 sectors — weight × day change", `template:
     plotly_dark`, tight margins (same style as `figure.py`).

**Widget `sector_map`** in `live-grid/widgets.json`: `type: "chart"`, `endpoint:
"sector_map"`, no params, `refetchInterval: 15000`, `gridData {w: 20, h: 12}` (the example card's size),
category "Equity".

**Known limitation** (stated in the widget description): weights use EODHD's
Morningstar classification, and the ETFs follow GICS. The 11 buckets line up by
name, but individual names can sit in different sectors (Morningstar
Technology is 41% vs a lower GICS IT weight). This is fine for a teaching
example; the description says so.

**Test** `live-grid/tests/test_sector_map.py`: a stub quote table plus a stub
fundamentals client. It asserts 11 tiles, that values equal the weights, that a
missing price renders grey/"n/a", that a weights failure returns 502, and that
the leases were renewed for all 11 ETFs.

## bdobb: client + example

- `src/lib/plotly.ts`: import `plotly.js/lib/treemap` and add it to
  `REGISTERED_TRACES`. plotly.js 3.7.0 ships the module. The extra test asserts
  `REGISTERED_TRACE_TYPES.has("treemap")`.
- `docs/examples/v10.0.0-live-grid.apps.json`: add a `sector_map` card beside
  `kdb_cache_chart` (`x: 20, y: 42, w: 20, h: 12`), `params: {}`.

## Verification

1. od pytest green (new test and existing suite); bdobb `pnpm test` for the
   plotly test.
2. Run live-grid locally against the real key, `curl /sector_map`: 11 tiles,
   weights summing to ~100, % changes matching `/snapshot` for two ETFs.
3. bdobb in browser mode against that live-grid, using the v10 example: the
   treemap renders, and the colours change across two refetches during market
   hours. Outside market hours only the static render can be checked; I will say
   so in the report.

## Out of scope

Drill-down to constituents, user-chosen index/ETF set, websocket push, carrying
treemap into v11+ (that is a separate carry after placement).
