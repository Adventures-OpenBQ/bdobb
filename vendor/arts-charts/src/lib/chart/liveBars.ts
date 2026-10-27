// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

/**
 * A live card (live composed bars §5, a card the host added with
 * `{ live: true }`): its completed bars come from the chart server's composed
 * `/series`, the same bars Rita and the watches read, and on a tick backend
 * only the forming bar from the stream (with none, /series' forming bar is
 * drawn as it stands). Stitching history to the session is the server's (L7);
 * the card only lays the stream's newest bars over its answer.
 */
import type { Candle } from "../../hooks/useTickCache";
import type { SeriesMeta } from "../../hooks/useSeriesBars";

/** `/series`' `cache.live`, or null when the answer does not say. */
export type LiveState = true | "partial" | false | null;

/**
 * Whether the tick stream's bars fall on the chart server's grid. The stream
 * buckets from the epoch; the server buckets each session segment from its own
 * start (04:00, 09:30, 16:00 New York; 00:00 UTC) -- the same instants for a
 * width that divides 30 minutes, not for 1h (13:00 vs 13:30 UTC) or a day (the
 * UTC day vs the regular session).
 * ponytail: off the grid the forming bar refreshes at the live poll, not per
 * trade. Upgrade path: fold the stream's minutes into the server's forming bar
 * if a 1h live chart's few seconds of lag is ever minded.
 */
export const streamOnGrid = (seconds: number): boolean => seconds < 86_400 && 1800 % seconds === 0;

/**
 * The live card's bars: the server's, with the stream's bars at or after the
 * cut laid over them -- the cut is the forming bar's time when the server names
 * one, else just past its last bar. At a bar's close the stream's new bar shows
 * at once and the bar that closed stays the stream's until the next poll hands
 * it over as completed: no time drawn twice, none skipped. A gap the server
 * left (`live: "partial"`) stays a gap, as stream bars before the cut are
 * dropped. Nothing from the server yet, or it is down: the stream alone, as a
 * tick card draws today. Off the stream's grid: the server's bars alone.
 */
export function liveCandles(series: Candle[], forming: number | null, stream: Candle[], onGrid: boolean): Candle[] {
  if (series.length === 0) return stream;
  if (!onGrid) return series;
  const cut = forming ?? series[series.length - 1].time + 1;
  const tail = stream.filter((c) => c.time >= cut);
  if (tail.length === 0) return series;
  const byTime = new Map(series.map((c) => [c.time, c]));
  for (const c of tail) byTime.set(c.time, c);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/**
 * The live card's note, or null, worded from the server's `live_reason`
 * (composed.py): nothing for `no_session` (today is not a session this chart
 * shows live: a weekend, a holiday, a window without today), nor when the
 * answer gives no reason.
 */
export function liveNote(symbol: string, live: LiveState, reason: SeriesMeta["liveReason"]): string | null {
  if (live === "partial") return `Partly live: ${symbol}'s live data starts after today's open, so earlier bars today are missing`;
  if (live !== false) return null;
  if (reason === "not_covered") return `Not live: ${symbol} isn't on the live watchlist`;
  if (reason === "unavailable") return `Not live: live data is unavailable right now, so ${symbol} shows history only`;
  return null;
}

/**
 * The live card's volume line, or null: live-grid's feed is one venue's
 * trades, so today's volume reads low against history's consolidated volume.
 * The bars keep it; the card says so (user ruling 2026-10-26).
 */
export function volumeNote(liveVolume: SeriesMeta["liveVolume"]): string | null {
  return liveVolume === "venue" ? "Today's volume counts one venue's trades only, so it reads low against earlier days" : null;
}
