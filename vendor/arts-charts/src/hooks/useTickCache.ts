// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import { useEffect, useRef, useState } from "react";
import { logError } from "../lib/logger";
import { useReconnectingSocket, type SocketStatus } from "./useReconnectingSocket";

export type Candle = {
  time: number; open: number; high: number; low: number; close: number; volume: number;
};
export type AvwapSeries = { anchor: string; points: { time: number; value: number }[] };
export type TickStatus = SocketStatus;

const LATENCY_WINDOW_MS = 5000;

/** kdb serialises timestamps as nanosecond ISO; the chart wants unix seconds. */
function seconds(stamp: string): number {
  return Math.floor(Date.parse(stamp.slice(0, 23) + "Z") / 1000);
}

function bucket(time: number, size: number): number {
  return Math.floor(time / size) * size;
}

/**
 * The kdb+ tick cache, over its own websocket (useReconnectingSocket owns the
 * connect/retry cycle and the status).
 *
 * An anchored VWAP is NOT recomputed here. kdb holds the trades and answers
 * with the running totals pv and vol, so the client extends the line per tick
 * as avwap = (pv += p*s)/(vol += s). Recomputing client-side would mean
 * shipping every tick since the anchor on every refresh.
 */
export function useTickCache({
  url, symbol, intervalSeconds, anchors, relay = false,
}: {
  url: string | null;
  symbol: string;
  intervalSeconds: number;
  anchors: string[];
  relay?: boolean;
}): { status: TickStatus; candles: Candle[]; last: Candle | null; avwaps: AvwapSeries[]; latencyMs: number | null } {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [avwaps, setAvwaps] = useState<AvwapSeries[]>([]);
  // Tick latency (spec §10.1): how far behind the wire each trade arrives,
  // as receipt time minus the trade's own stamp, kept for five seconds and
  // reported as the median so one late batch does not swing the number.
  // A ref for the samples (they are not rendered) and state for the median
  // (it is), set once per message rather than once per trade.
  const samples = useRef<{ at: number; ms: number }[]>([]);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  // Running totals per anchor, and whether the reply has landed. A tick that
  // beats the reply must be DROPPED: the server's sums already include it.
  const totals = useRef(new Map<string, { pv: number; vol: number }>());
  const seeded = useRef(false);
  const anchorStarts = useRef(new Map<string, string | null>());
  const anchorsKey = JSON.stringify(anchors);
  // The symbol and interval the current candles and avwaps were built for.
  const stream = useRef<string | null>(null);

  useEffect(() => {
    // Candles and avwaps belong to ONE symbol at ONE interval. On a change
    // of either they are cleared here, not left for the new bars reply to
    // replace: until it lands, new trades would fold into the previous
    // symbol's candles -- and stay there if that connection errored. An
    // anchor edit or a url change keeps them; the fresh replies overwrite
    // them in place, with no empty-chart flash in between.
    const key = `${symbol} ${intervalSeconds}`;
    if (stream.current !== null && stream.current !== key) {
      setCandles([]);
      setAvwaps([]);
      // The latency belongs to the stream that measured it: MSFT's status bar
      // must not keep reporting how far behind AAPL's ticks were.
      samples.current = [];
      setLatencyMs(null);
    }
    stream.current = key;
    // A discarded anchor's series goes too. Nothing else ever removes one --
    // an avwap reply only replaces its own anchor's series -- so after
    // Discard or clear the chart kept drawing it as a frozen line.
    const wanted = new Set(JSON.parse(anchorsKey) as string[]);
    setAvwaps((current) => {
      const next = current.filter((s) => wanted.has(s.anchor));
      return next.length === current.length ? current : next;
    });

    return () => {
      // Nothing but a message ever touched these, so a teardown -- an error,
      // a url change, an unmount -- left the last median standing for as long
      // as the status bar cared to show it. The samples are this connection's
      // and go with it.
      samples.current = [];
      setLatencyMs(null);
    };
  }, [url, symbol, intervalSeconds, anchorsKey]);

  let socketUrl = url;
  if (relay && url !== null) {
    const target = new URL(url);
    target.search = new URLSearchParams({
      symbol, interval: String(intervalSeconds), anchors: anchorsKey,
    }).toString();
    socketUrl = target.href;
  }
  const { status } = useReconnectingSocket(
    socketUrl === null || symbol === "" ? null : socketUrl,
    {
      onOpen: ({ socket: ws }) => {
        // The totals belong to THIS connection, not to the hook: a
        // reconnect must re-gate every anchor until its own fresh avwap
        // reply lands, rather than reusing pre-drop pv/vol the server has no
        // memory of extending.
        totals.current = new Map();
        seeded.current = false;
        anchorStarts.current = new Map();
        // The relay's URL is the signed subscription. It sends one atomic
        // seed, then ONLY subsequent trades; never send legacy bars/sub here.
        if (relay) return;
        ws.send(JSON.stringify({ type: "bars", sym: symbol, interval: intervalSeconds }));
        ws.send(JSON.stringify({ type: "sub", syms: [symbol] }));
        for (const anchor of JSON.parse(anchorsKey) as string[]) {
          ws.send(JSON.stringify({ type: "avwap", sym: symbol, anchor, interval: intervalSeconds }));
        }
      },
      onClose: () => { seeded.current = false; },
      onMessage: (event, cycle) => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(String(event.data));
        } catch (err) {
          void logError(`tick cache sent unparseable JSON: ${err}`);
          return;
        }
        if (relay && message.table === "chart_snapshot") {
          if (seeded.current || message.sym !== symbol || message.interval !== intervalSeconds ||
              message.version !== 1 || !Array.isArray(message.bars) || !Array.isArray(message.anchors)) {
            cycle.retry(); return;
          }
          const bars = message.bars as Record<string, number | string>[];
          const seeds = message.anchors as {
            anchor: string; from: string | null; pv: number; vol: number;
            data: { time: string; avwap: number }[];
          }[];
          totals.current = new Map(seeds.map(a => [a.anchor, { pv: a.pv, vol: a.vol }]));
          anchorStarts.current = new Map(seeds.map(a => [a.anchor, a.from]));
          setCandles(bars.map(b => ({
            time: seconds(String(b.barTime)), open: Number(b.open), high: Number(b.high),
            low: Number(b.low), close: Number(b.close), volume: Number(b.volume),
          })));
          setAvwaps(seeds.map(a => ({
            anchor: a.anchor,
            points: a.data.map(p => ({ time: bucket(seconds(p.time), intervalSeconds), value: p.avwap })),
          })));
          seeded.current = true;
          return;
        }
        if (relay && (!seeded.current || message.table !== "trades")) {
          cycle.retry(); return;
        }
        if (message.table === "bars") {
          const rows = (message.data ?? []) as Record<string, number | string>[];
          setCandles(rows.map((r) => ({
            time: seconds(String(r.barTime)),
            open: Number(r.open), high: Number(r.high),
            low: Number(r.low), close: Number(r.close),
            volume: Number(r.volume),
          })));
          return;
        }
        if (message.table === "avwap") {
          const anchor = String(message.anchor);
          totals.current.set(anchor, {
            pv: Number(message.pv), vol: Number(message.vol),
          });
          const rows = (message.data ?? []) as Record<string, number | string>[];
          // Onto the bar grid, like the live ticks below. kdb stamps each row
          // with the LAST TRADE's time in its bar (08:06:59.182, not 08:06),
          // and a line point between two bars is a new slot on the chart's
          // one shared time scale: an anchor's ~200 points re-spaced the whole
          // x axis the moment it was added (2026-09-15). At a wider interval
          // bucketing can land two rows in one bar, and lightweight-charts
          // needs unique ascending times, so the later row wins -- the same
          // rule the live-tick fold below uses.
          const points: { time: number; value: number }[] = [];
          for (const r of rows) {
            const point = { time: bucket(seconds(String(r.time)), intervalSeconds), value: Number(r.avwap) };
            const last = points.at(-1);
            if (last !== undefined && last.time === point.time) points[points.length - 1] = point;
            else if (last === undefined || point.time > last.time) points.push(point);
          }
          setAvwaps((current) => {
            const rest = current.filter((s) => s.anchor !== anchor);
            return [...rest, { anchor, points }];
          });
          return;
        }
        if (message.table !== "trades") return;
        const trades = ((message.data ?? []) as Record<string, number | string>[])
          .filter((t) => String(t.sym) === symbol);
        if (trades.length === 0) return;

        const now = Date.now();
        for (const trade of trades) {
          // kdb's stamp is nanosecond ISO with no zone; `seconds()` above
          // truncates to the second, which is too coarse for a latency, so
          // the millisecond parse is done here from the first 23 characters.
          const stamp = Date.parse(`${String(trade.time).slice(0, 23)}Z`);
          if (Number.isFinite(stamp)) samples.current.push({ at: now, ms: now - stamp });
        }
        samples.current = samples.current.filter((sample) => now - sample.at <= LATENCY_WINDOW_MS);
        const sorted = samples.current.map((sample) => sample.ms).sort((a, b) => a - b);
        setLatencyMs(sorted.length === 0 ? null : sorted[Math.floor(sorted.length / 2)]);

        setCandles((current) => {
          const next = [...current];
          for (const trade of trades) {
            const at = bucket(seconds(String(trade.time)), intervalSeconds);
            const price = Number(trade.price);
            const size = Number(trade.size);
            const open = next.at(-1);
            if (open !== undefined && open.time === at) {
              next[next.length - 1] = {
                ...open,
                high: Math.max(open.high, price),
                low: Math.min(open.low, price),
                close: price,
                volume: open.volume + size,
              };
            } else if (open === undefined || at > open.time) {
              next.push({ time: at, open: price, high: price, low: price, close: price, volume: size });
            }
          }
          return relay ? next.slice(-10000) : next;
        });

        // Fold every trade into `totals.current` HERE, once per message --
        // not inside the setAvwaps updater below. React can invoke a
        // functional state update more than once for the same commit
        // (StrictMode's double-render is the one that bites in dev, but a
        // bailout-and-replay can too), and an updater that both reads and
        // writes the same ref would double-count every trade on a replay.
        // Precomputing each anchor's new points here keeps the updater a
        // pure function of `current` and this already-settled result.
        const deltas = new Map<string, { time: number; value: number }[]>();
        for (const [anchor, running] of totals.current) {
          let { pv, vol } = running;
          const points: { time: number; value: number }[] = [];
          for (const trade of trades) {
            if (relay) {
              const from = anchorStarts.current.get(anchor);
              // q timestamps have fixed nanosecond precision on both sides.
              // Future anchors and late trades before an anchor cannot enter its sum.
              if (from == null || String(trade.time) < from) continue;
            }
            const price = Number(trade.price);
            const size = Number(trade.size);
            // pv/vol are a running SUM: order doesn't matter, and every
            // tick folds in regardless of what happens to `points` below --
            // that's what keeps the *next* point's value correct even when
            // this tick's own point gets dropped.
            pv += price * size;
            vol += size;
            if (vol <= 0) continue;
            points.push({ time: bucket(seconds(String(trade.time)), intervalSeconds), value: pv / vol });
          }
          totals.current.set(anchor, { pv, vol });
          deltas.set(anchor, points);
        }

        setAvwaps((current) => current.map((series) => {
          // No reply yet: the server's sums will already include this tick.
          const newPoints = deltas.get(series.anchor);
          if (newPoints === undefined) return series;
          const points = [...series.points];
          for (const point of newPoints) {
            // `points` is a TIME SERIES: lightweight-charts needs it
            // ascending and unique, so an out-of-order tick's point is
            // dropped here -- same discipline as the candle loop above --
            // even though it already counted toward pv/vol above.
            const last = points.at(-1);
            if (last !== undefined && last.time === point.time) points[points.length - 1] = point;
            else if (last === undefined || point.time > last.time) points.push(point);
          }
          return { ...series, points: relay ? points.slice(-10000) : points };
        }));
      },
    },
    // Symbol, interval and anchors ride in frames sent after open, not in the
    // url, so a change to any of them needs a fresh connection to re-send.
    { reconnectKey: `${symbol} ${intervalSeconds} ${anchorsKey}` },
  );

  return { status, candles, last: candles.at(-1) ?? null, avwaps, latencyMs };
}
