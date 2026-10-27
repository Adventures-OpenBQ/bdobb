// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import { useEffect, useRef, useState } from "react";
import type { ChartsFetch } from "../host";
import { getSeries } from "../lib/chartServer";
import { fetchWidgetPath } from "../lib/dataClient";
import { isRecord } from "../lib/isRecord";
import type { BackendConfig } from "../lib/types";
import type { Candle, TickStatus } from "./useTickCache";

const POLL_MS = 60_000;
/** The longest wait between polls while they keep failing. */
export const MAX_ERROR_POLL_MS = 15 * 60_000;

/** The wait before the next poll after `failures` failures in a row: `base`, doubling per failure, capped. */
export function pollDelay(base: number, failures: number): number {
  return Math.min(base * 2 ** failures, Math.max(base, MAX_ERROR_POLL_MS));
}

/**
 * One bar's `date` as unix seconds. `/series` sends `2026-09-14T08:00:00Z`
 * for an intraday bar and `2026-09-14` for a daily one; a naked datetime
 * (no `Z`, no offset) is read as UTC -- the same rule useTickCache applies
 * to kdb's stamps, and the only reading that keeps two providers' intraday
 * bars on one axis.
 */
function seconds(date: string): number {
  const naked = date.includes("T") && !/([Zz]|[+-]\d\d:?\d\d)$/.test(date);
  return Math.floor(Date.parse(naked ? `${date}Z` : date) / 1000);
}

/**
 * The `/series` envelope's `bars` as candles: ascending, one per bar time.
 * A row whose date will not parse, or whose open/high/low/close is not a
 * finite number, is dropped rather than drawn at NaN or blanking the chart
 * (volume stays lenient); a duplicate time keeps the LAST row --
 * lightweight-charts needs the times unique and ascending, the same
 * discipline the tick cache follows.
 */
export function parseBars(payload: unknown): Candle[] {
  const bars = isRecord(payload) ? payload.bars : null;
  if (!Array.isArray(bars)) return [];
  const byTime = new Map<number, Candle>();
  for (const bar of bars) {
    if (!isRecord(bar)) continue;
    const time = seconds(String(bar.date));
    if (!Number.isFinite(time)) continue;
    const open = Number(bar.open), high = Number(bar.high), low = Number(bar.low), close = Number(bar.close);
    if (![open, high, low, close].every(Number.isFinite)) continue;
    byTime.set(time, { time, open, high, low, close, volume: Number(bar.volume) });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/**
 * The `/series` envelope's `cache` object (v12.4.2): how much of the answer
 * the tick vault served versus EODHD's own history, for the status bar's
 * `barsSource`. `rows_from_vault` and `vault_days` are read loosely --
 * `Number(... ?? 0)` and an array check -- because a backend a version
 * behind this client simply omits `cache` altogether, and an absent field
 * must read as "the vault served nothing" rather than throw.
 */
export type SeriesMeta = {
  rowsFromVault: number; vaultRefused: boolean; vaultDays: string[];
  /**
   * The chart server's composition (live composed bars §1): `live` whether
   * live-grid served the current session (`"partial"`: from after the open,
   * a gap before it), null when the answer does not say -- a backend's own
   * `/series`; `forming` the forming bar's time (unix seconds), else null.
   */
  live: true | "partial" | false | null;
  /** Why `live` is false (user ruling 2026-10-26), null when it is not or the answer does not say. */
  liveReason: "not_covered" | "unavailable" | "no_session" | null;
  /** `"venue"`: today's bars are live and their volume is one venue's trades only (user ruling 2026-10-26). */
  liveVolume: "venue" | null;
  forming: number | null;
};

function parseMeta(payload: unknown): SeriesMeta {
  const cache = isRecord(payload) ? payload.cache : null;
  const c = isRecord(cache) ? cache : {};
  // Naive UTC with a space ("2026-10-14 15:05:00"), as the server spells a candle time.
  const forming = typeof c.forming === "string" ? seconds(c.forming.replace(" ", "T")) : NaN;
  return {
    rowsFromVault: Number(c.rows_from_vault ?? 0),
    vaultRefused: c.vault_refused === true,
    vaultDays: Array.isArray(c.vault_days) ? c.vault_days : [],
    live: c.live === true || c.live === false || c.live === "partial" ? c.live : null,
    liveReason: c.live_reason === "not_covered" || c.live_reason === "unavailable" || c.live_reason === "no_session" ? c.live_reason : null,
    liveVolume: c.live_volume === "venue" ? "venue" : null,
    forming: Number.isFinite(forming) ? forming : null,
  };
}

/**
 * The chart's bars over the live-grid's `/series`, which proxies
 * openbb-api's history for the named provider (v12.3.1 ruling: a chart has
 * ONE source, and EODHD means the bars as well as the indicators).
 *
 * REST, not a socket: `/series` is a plain GET and EODHD's history is not a
 * live feed, so the plane is polled rather than subscribed. `enabled` is
 * false in local mode and nothing is fetched at all -- the kdb tick socket
 * is the chart's plane there, and this hook stays idle beside it.
 *
 * A failed poll KEEPS the last candles: a chart that empties itself on one
 * bad minute is worse than a chart carrying a stale last bar and saying so
 * through `error` and the status dot.
 *
 * `meta` mirrors `error`: null on error, and before the first response
 * lands -- there is no vault coverage to report yet either way.
 *
 * ponytail: a fixed 60s poll, not a conditional one that stops outside the
 * session. Upgrade path: gate it on the exchange calendar once someone
 * counts the requests and minds.
 */
export function useSeriesBars({
  backend, symbol, interval, provider, start, end, enabled, pollMs = POLL_MS, chartsFetch, session,
}: {
  backend: BackendConfig;
  symbol: string;
  interval: string;
  provider: string;
  start: string;
  end: string;
  enabled: boolean;
  pollMs?: number;
  /** Ask the chart server's composed `/series` through the host's `chartsFetch` instead of the backend's (a live card, §5). */
  chartsFetch?: ChartsFetch;
  /** The card's session, sent when given: the chart server's seam depends on it (step 1 ruling 2). */
  session?: string;
}): { candles: Candle[]; status: TickStatus; error: string | null; meta: SeriesMeta | null } {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [status, setStatus] = useState<TickStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  // The vault/history split off the last successful response's `cache`;
  // null on error or before the first response, same as `error` reads null
  // on a plane that has never spoken -- there is no coverage to report yet.
  const [meta, setMeta] = useState<SeriesMeta | null>(null);
  // The symbol and interval the current candles were fetched for, so a
  // switch clears them instead of leaving AAPL's bars under MSFT's header
  // for as long as the new request takes (useTickCache's own rule).
  const stream = useRef<string | null>(null);
  // The latest `backend`, read by `load` without being an effect dep (see
  // below). Assigning a ref on every render is safe outside an effect: it
  // never schedules work, so it cannot race the read.
  const backendRef = useRef(backend);
  backendRef.current = backend;
  // Bumped once per `load` call; a response is applied only if it is still
  // the newest one in flight. Without this, poll N+1 landing before poll N
  // (a slow request overtaken by a faster later one) would let N overwrite
  // it with older bars.
  const seq = useRef(0);

  useEffect(() => {
    const key = `${symbol} ${interval}`;
    if (stream.current !== null && stream.current !== key) setCandles([]);
    stream.current = key;

    if (!enabled || symbol === "") {
      setStatus("idle");
      // An idle plane reports nothing: a card that errored under EODHD and
      // then switched back to local must not carry that message into the
      // status dot's tooltip for the rest of its life.
      setError(null);
      return;
    }
    let cancelled = false;
    setStatus("connecting");

    // Resolves true on success, false on failure; a superseded or cancelled
    // response counts as success, so it never stretches the next wait.
    const load = async (): Promise<boolean> => {
      const id = ++seq.current;
      try {
        const query = { symbol, interval, provider, start, end, ...(session === undefined ? {} : { session }) };
        const payload = chartsFetch ? await getSeries(chartsFetch, query) : await fetchWidgetPath(backendRef.current, "series", query);
        if (cancelled || id !== seq.current) return true;
        setCandles(parseBars(payload));
        setMeta(parseMeta(payload));
        setError(null);
        setStatus("live");
        return true;
      } catch (err) {
        if (cancelled || id !== seq.current) return true;
        setError(err instanceof Error ? err.message : String(err));
        setMeta(null);
        setStatus("error");
        return false;
      }
    };

    // Backoff on failure (2026-09-30): the interval still ticks every pollMs,
    // but after a failed poll the next ones are skipped until pollDelay has
    // passed -- doubling per failure up to MAX_ERROR_POLL_MS -- and a success
    // returns to every pollMs. A fixed poll meant a board whose backend was
    // failing (an EODHD key over quota) asked again every minute per card for
    // as long as it stayed open. The interval, not a chain of timeouts, so a
    // request that never answers cannot stop the polling.
    let failures = 0;
    let nextAt = 0;
    const poll = async () => {
      const startedAt = Date.now();
      if (startedAt < nextAt) return;
      const ok = await load();
      if (cancelled) return;
      failures = ok ? 0 : failures + 1;
      // From when this poll STARTED, which is on the interval's own grid, so
      // the next allowed poll lands on a tick rather than one tick late.
      nextAt = failures === 0 ? 0 : startedAt + pollDelay(pollMs, failures);
    };
    void poll();
    const timer = setInterval(() => void poll(), pollMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // `backend` itself is deliberately NOT a dep: Connections can hand this
    // hook a freshly-allocated but equal `BackendConfig` on every render,
    // and keying on its identity would refetch and restart the poll timer
    // on every such render instead of once a minute. The primitives below
    // are what fetchWidgetPath actually reads off it -- baseUrl for the
    // request, the rest for auth -- so those are what should restart the
    // request; `backendRef` carries the current object into `load` without
    // being in the dep array.
  }, [
    backend.id, backend.baseUrl, backend.headerName, backend.headerValue, backend.authLocation,
    symbol, interval, provider, start, end, enabled, pollMs, chartsFetch, session,
  ]);

  return { candles, status, error, meta };
}
