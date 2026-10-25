---
type: Note
tags: [bdobb, help, integrations, kdb, ticks, live-grid]
---

# kdb+ Tick Cache

From openbq-docker v10 the stack can run kdb+, the in-memory database the tick-data world treats as standard equipment, as a **tick cache** for the live grid. It is part of the opt-in `live` compose profile (`docker compose --profile live up -d`), next to the **live-grid** service that serves the [[tables|live grid]]: live-grid records every trade its EODHD websocket feeds receive into q, and reads them back for the tick widgets and the charts' newest bars. Plain `docker compose up -d` starts neither.

## Bring your own q and licence

KX's licence does not permit redistributing q, so openbq-docker ships no KX software and no licence. kdb+ runs as its own service, `openbq-kdb`, on a KDB-X image: the default `KDB_IMAGE` is the maintainer's private amd64 image, so anyone else sets `KDB_IMAGE` to their own, or builds one from their licensed KDB-X with `-f compose.kdb-build.yml` (the recipe is openbq-docker's `kdb-x/`). The licence, `kc.lic`, goes in `./kdb-license/` (git-ignored, mounted read-only), or in the directory `KDB_LICENSE_DIR` names.

`openbq-kdb` is the only owner of q's port 5000: live-grid runs with `KDB_EMBEDDED=false` and dials `openbq-kdb:5000`, never spawning a q of its own. live-grid's `GET /health` carries `ticks.endpoint`, the link that connected. Without a licence q exits, and live-grid runs on without it: quotes and history still work, `/ticks` answers an empty list, and charts are drawn from history alone. After kdb stops answering, live-grid retries after 1 s, doubling to at most 15 s (`KDB_RETRY_INITIAL_S`, `KDB_RETRY_MAX_S`).

## No read-through history cache

On this line kdb+ holds ticks only. Chart history is not cached: live-grid reads it from openbq-api's EODHD namespace (`/api/v1/eodhd/…/price/historical`, provider pinned to `eodhd`), so every chart request is an EODHD history call, and the `provider` parameter the chart widgets send is accepted and ignored. History is fetched only at an interval that divides the bar evenly: a day or more as asked, any multiple of five minutes (15m, 30m, 1h) from 5m and resampled, any other whole minute from 1m, and a bar under a minute from ticks alone.

## The tick recorder

Each trade is stamped with the feed's own trade time and buffered in live-grid, then written to q as one batch about five times a second. The buffer holds 100,000 ticks; past that the oldest is dropped and counted. Forex ticks are recorded without a size, since the forex feed carries quotes, not trades.

A batch kdb does not acknowledge is not lost: it is appended to a spool on live-grid's `live-grid-data` volume (`/data/spool`) and replayed into kdb, oldest first and before any newer tick, once kdb answers again, and also when live-grid restarts. A batch whose write failed after it was sent is checked against kdb before it is resent, so it never lands twice. The spool is capped at 256 MB (`LIVE_GRID_SPOOL_MAX_MB`); past that, new ticks are dropped.

Retention is a rolling window, pruned once a minute: 48 hours in the stack's compose file (`LIVE_TICK_WINDOW_SECONDS=172800`; live-grid's own default is a day). kdb itself survives a restart: q runs openbq-docker's `startup.q`, which loads `persist.q`, and every write is appended to a daily log on the `kdb-data` volume. On boot the last three days' logs are replayed, a torn tail cut back to its last whole chunk first; logs are kept 7 days. `docker compose down -v` deletes them.

`GET /health` on live-grid reports the recorder under `ticks`: `buffered`, `written`, `dropped`, `spooled`, `replayed`, `deduped` and `quarantined`, the last for spooled ticks set aside after the same write kept failing for over a minute.

## The seam

A chart request joins history to bars built from the cached ticks at the **first bar boundary at or after the first tick**, not at the first tick itself, so no bar mixes the two sources. Tick bars are used only when one bar fits inside the tick window, and never past the request's end. The response's `cache` block says what happened: `rows_from_ticks` and `seam`, the boundary's time.

For the Live Chart, minutes live-grid did not hear (it was down, or restarting) are filled at query time: US equities from EODHD's recent minute bars, crypto from 1m history; forex is left unfilled. Ticks win wherever they exist, a filled minute serves 1m and wider bars only, and Tick History keeps the hole.

The two sides are different data. History is EODHD's bars; tick bars are aggregated from the prints one websocket connection received. Closes track closely; volume can differ visibly.

## The Delta Lake store

The same profile adds an S3 store: `rustfs` (RustFS, on the internal network only), the one-shot `rustfs-init`, which creates the bucket, and `eod-dump`, which at 00:05 UTC reads the UTC day that just ended out of kdb and writes it as one Delta Lake table per symbol and day to the `ticks_live` library. With `LIVE_GRID_LAKE_READBACK` on and the store configured, an intraday chart whose bars tile a day (1m, 5m, 15m, 1h) builds whole past days, up to 10, from those tables instead of history, and the `cache` block adds `rows_from_lake` and `lake_days`. The tier needs `rustfs.env` (`cp rustfs.env.example rustfs.env`, with a non-default root pair); without it RustFS refuses to start, eod-dump never runs, and kdb and live-grid carry on without the store. With read-back on, a chart takes this path and minutes live-grid missed are not filled.

## The widgets it serves

All from the live-grid connection:

- **Tick History** (`kdb_ticks`) — the newest trades for one symbol out of kdb, newest first, as a table; **limit** defaults to 200 and is capped at 1000. With no kdb it reads as an empty table, not an error.
- **Cached Price Chart** (`kdb_cache_chart`) — history joined to tick bars at the seam, as a Plotly figure, at 1d, 1h or 5m. Its widget description says *read-through cache*; on this line the history behind it is EODHD's, uncached.
- **Live Chart** (`live_chart`) — candles seeded from live-grid's `/series`, extended tick by tick over the live grid's socket. See [[charts|Charts]].
- **S&P 500 Sector Map** (`sector_map`) — the S&P 500's sectors sized by their weight in SPY and coloured by the day change of each sector's SPDR fund, live from the grid's feed, as a Plotly treemap; it refreshes every 15 seconds and takes no parameters.
- **Technical Chart** (`ta_chart`) — indicators in stacked panes over the same bars, as a Plotly figure; its **source** is `local` (computed in live-grid) or `eodhd` (EODHD's indicators, cached and refetched at most once a minute).

## Reaching it

Neither `openbq-kdb` nor live-grid has a host port or a Tailscale Serve entry. BDOBB reaches live-grid through the gateway's `/grid` family: run the `web` and `live` profiles together and set `"liveGrid": true` in `gateway-config/settings.json` (see [[web-preview|Web Preview]]). q executes arbitrary code and authenticates nothing, so it sits only on the internal `live-private` network, which only live-grid and the store's jobs join.

## Gotchas

- **Tick History's widget description** says the cache is in-memory and a restarted kdb reads as empty. With `persist.q` always loaded, a restarted kdb replays its logs and comes back with the window.
- **q prints floats at display precision** unless told otherwise; `startup.q` sets `\P 17` so prices are not truncated.
- **The kdb image is architecture-specific.** The default is amd64 only; on an arm64 host, build your own with `compose.kdb-build.yml`.

---
*Source: openbq-docker `docker-compose.yml`, `README.md`, `live-grid/app/main.py`, `live-grid/app/recorder.py`, `live-grid/app/feeds.py`, `live-grid/app/quotes.py`, `live-grid/app/series.py`, `live-grid/app/spool.py`, `live-grid/app/lake.py`, `live-grid/widgets.json`, `v10/kdb/source/openbq_kdb/session.py`, `v10/kdb/source/q/startup.q`, `v10/kdb/source/q/persist.q` and `docs/v10/live-grid-kdb-port.md` at `v10.0.0`; the development line's `kdb-tick-cache` page, checked against this line.*
*See also: [[tables|Tables]] · [[charts|Charts]] · [[eodhd-data-provider|EODHD Data]] · [[openbq-docker-stack|The openbq-docker Stack]] · [[web-preview|Web Preview]] · [[example-dashboards|Example Dashboards]]*
