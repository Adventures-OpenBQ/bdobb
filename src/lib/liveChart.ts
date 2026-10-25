// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord } from "./isRecord";
import type { UdfBar } from "./udf";

/**
 * The pure half of the Live Chart (`type: "live_chart"`, live-grid's widget):
 * what its `/series` answer means as bars, and how one streamed quote row
 * folds into the newest bar. LiveChartRenderer owns the request, the socket
 * and the chart; nothing here touches any of them.
 *
 * Bars are UdfBars (unix SECONDS) because that is what lwChart draws -- the
 * same type the TradingView card's UDF history becomes, so the one chart
 * module serves both cards.
 */

const NOT_SERIES = "not a series payload";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * An ISO date as unix seconds, always read as UTC. live-grid's bars are UTC,
 * but not every one says so: a daily bar is a bare `YYYY-MM-DD` (which JS
 * already reads as UTC) and an upstream intraday row can arrive with no zone
 * at all, which `Date.parse` would read as LOCAL time and shift by the
 * reader's offset. A zoneless time gets a `Z`. NaN when it does not parse.
 */
function isoSeconds(date: string): number {
  let iso = date.trim().replace(" ", "T");
  if (iso.includes("T") && !/(Z|[+-]\d\d:?\d\d)$/i.test(iso)) iso += "Z";
  return Date.parse(iso) / 1000;
}

/**
 * live-grid's `/series` answer -- `{symbol, interval, start, end, bars, cache}`
 * with each bar `{date, open, high, low, close, volume, ...}` -- as UdfBars.
 * A bare array of bars is read too. A row whose date or OHLC does not read as
 * a number is dropped rather than failing the series, a missing volume is 0,
 * and the result is sorted with a repeated time collapsed to its LAST row:
 * lightweight-charts asserts strictly ascending times (the parseUdfHistory
 * rule). Anything that is not a series at all throws, so the card shows an
 * error, never a blank chart.
 */
export function seriesBars(payload: unknown): UdfBar[] {
  const rows = Array.isArray(payload) ? payload : isRecord(payload) && Array.isArray(payload.bars) ? payload.bars : null;
  if (rows === null) throw new Error(NOT_SERIES);
  const byTime = new Map<number, UdfBar>();
  for (const row of rows) {
    if (!isRecord(row) || typeof row.date !== "string") continue;
    const { open, high, low, close, volume } = row;
    const time = isoSeconds(row.date);
    if (!isNum(time) || !isNum(open) || !isNum(high) || !isNum(low) || !isNum(close)) continue;
    byTime.set(time, { time, open, high, low, close, volume: isNum(volume) ? volume : 0 });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/**
 * The card's `interval` param as a bucket width in seconds: live-grid offers
 * 1s, 1m, 5m, 15m, 30m, 1h and 1d. Anything else is null, and the chart then
 * stays on its seed (no bucket to fold a tick into is better than a guessed one).
 */
export function intervalSeconds(interval: string): number | null {
  const m = /^(\d+)([smhd])$/.exec(interval.trim());
  if (!m || Number(m[1]) === 0) return null;
  return Number(m[1]) * UNIT_SECONDS[m[2]];
}

/**
 * A running volume counter a row carries, and which one it is: `stream_volume`
 * (what live-grid's stream has seen, never reset by a re-seed; openbq-docker
 * c813dd4 on) or `volume` (the day's cumulative volume, which a re-seed
 * overwrites from the REST snapshot -- review F2). Deltas are only ever taken
 * between two readings of the SAME counter.
 */
export type VolumeCounter = { key: "stream_volume" | "volume"; value: number };

/**
 * One trade as the chart folds it: unix seconds, price, the size it adds to
 * volume, and the row's running counter (null when the row has neither).
 * rowTick sets `size` from `last_size`; LiveChartRenderer replaces it with
 * volumeStep's answer before folding.
 */
export type Tick = { time: number; price: number; size: number; counter: VolumeCounter | null };

const DAY_S = 86400;
/** A stamp further ahead of this clock than this is clock skew or a mis-scaled feed time (review F8). */
const FUTURE_SLACK_S = 60;

/**
 * One streamed quote row as a tick for `symbol`, or null when the row is for
 * another symbol (the socket carries every symbol the subscription named) or
 * has no usable price. Matched case-insensitively, as the live grid does.
 *
 * The time is the trade's own, so that a row the socket replays on subscribe
 * (minutes or days old) folds into the bar it belongs to, or is ignored as
 * older than the newest bar, and never opens a bar at the moment it arrived:
 *
 * - `updated_ts` first: the full UTC instant, ISO with an offset, which
 *   live-grid sends from openbq-docker 84f88eb on. A weekend replay carries
 *   Friday's date and is placed on Friday.
 * - else `updated_at`, the fallback for an older live-grid: `HH:MM:SS` UTC with
 *   no date, so today's UTC date is put in front -- and a result more than an
 *   hour later than now (a trade from just before UTC midnight, heard just
 *   after) is moved back a day. ponytail: undated, so an older live-grid's
 *   weekend replay still reads as today; `updated_ts` is the fix, and the
 *   reason it exists.
 * - else (OpenBB's reference stream) the moment it arrived.
 *
 * Whatever the source, a time more than a minute ahead of now is clamped to
 * now: one future-stamped tick would otherwise open a bar in the future, and
 * every real tick after it would read as older than the newest bar and be
 * dropped -- a frozen chart until the next seed. A few seconds of server
 * clock lead stay as sent.
 */
export function rowTick(row: Record<string, unknown>, symbol: string, nowMs: number): Tick | null {
  if (String(row.symbol ?? "").toUpperCase() !== symbol.toUpperCase()) return null;
  if (!isNum(row.price)) return null;
  const now = nowMs / 1000;
  let time = typeof row.updated_ts === "string" ? isoSeconds(row.updated_ts) : NaN;
  if (!Number.isFinite(time)) {
    time = now;
    const hms = typeof row.updated_at === "string" ? /^(\d\d):(\d\d):(\d\d)$/.exec(row.updated_at) : null;
    if (hms) {
      time = Math.floor(now / DAY_S) * DAY_S + Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]);
      if (time > now + 3600) time -= DAY_S;
    }
  }
  if (time > now + FUTURE_SLACK_S) time = now;
  const counter: VolumeCounter | null = isNum(row.stream_volume)
    ? { key: "stream_volume", value: row.stream_volume }
    : isNum(row.volume)
      ? { key: "volume", value: row.volume }
      : null;
  return { time, price: row.price, size: isNum(row.last_size) ? row.last_size : 0, counter };
}

/**
 * What a tick adds to its bar's volume, and the baseline the next tick for
 * the symbol is measured from (`prev`, undefined until the first).
 *
 * A counter only grows between readings, so a bar gains the change in it --
 * every trade counted, unlike `last_size`, which is only the last trade
 * before the server's ~250 ms coalesced flush. Nothing is added, and the
 * reading becomes the baseline, when:
 * - there is no baseline yet: the first tick after a seed or a reconnect (the
 *   seed's bars already hold the volume before it);
 * - the counter dropped: a new day's reset of `volume`, or a re-seed of it;
 * - the row switched counters (its `stream_volume` appeared after a run of
 *   `volume` readings): two counters' values are not comparable.
 * A row with neither counter (an older backend, OpenBB's reference) falls
 * back to its `last_size`, and leaves the baseline alone.
 */
export function volumeStep(prev: VolumeCounter | undefined, tick: Tick): { add: number; prev: VolumeCounter | undefined } {
  const now = tick.counter;
  if (now === null) return { add: tick.size, prev };
  if (prev === undefined || prev.key !== now.key || now.value < prev.value) return { add: 0, prev: now };
  return { add: now.value - prev.value, prev: now };
}

/**
 * The bar a tick makes, to hand to the chart's incremental update, or null
 * when the tick is older than the newest bar (ignored: lightweight-charts
 * cannot update a bar behind the last one, and a late trade is not news).
 *
 * - In the newest bar's bucket: that bar, with high, low and close moved to
 *   the price and the tick's size added to volume.
 * - Past it: a new bar, open = high = low = close = price, volume = size. Its
 *   time is on the SEED's bucket grid (the newest bar's time plus whole
 *   intervals), not floored to the epoch, because a backend's hourly bars
 *   can start at :30 and a tick must not open a bar between two of them.
 * - Nothing seeded yet: a new bar on the epoch grid.
 */
export function foldTick(last: UdfBar | undefined, tick: Pick<Tick, "time" | "price" | "size">, intervalS: number): UdfBar | null {
  const { time, price, size } = tick;
  if (last !== undefined && time < last.time) return null;
  if (last !== undefined && time < last.time + intervalS) {
    return { ...last, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price, volume: last.volume + size };
  }
  const start = last === undefined ? Math.floor(time / intervalS) * intervalS : last.time + Math.floor((time - last.time) / intervalS) * intervalS;
  return { time: start, open: price, high: price, low: price, close: price, volume: size };
}
