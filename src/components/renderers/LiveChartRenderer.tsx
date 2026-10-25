// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildWidgetWsUrl, fetchWidgetData, stripQuery, ticketedWsUrl, wantsSocketTicket } from "../../lib/dataClient";
import { useReconnectingSocket, type SocketStatus } from "../../hooks/useReconnectingSocket";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";
import { foldTick, intervalSeconds, rowTick, seriesBars, volumeStep, type VolumeCounter } from "../../lib/liveChart";
import { logOnce } from "../../lib/logger";
import { mountCandleChart, TRADINGVIEW_CREDIT_LABEL, TRADINGVIEW_CREDIT_URL, type CandleChartHandle } from "../../lib/lwChart";
import type { BackendConfig, WidgetDef } from "../../lib/types";
import type { UdfBar } from "../../lib/udf";
import { ErrorState } from "./ErrorState";
import { frameRows } from "./LiveGridRenderer";
import { openCredit } from "./TradingViewRenderer";

/**
 * live-grid's Live Chart (`type: "live_chart"`, V10-P4): candles and volume
 * for one symbol, seeded from the widget's `/series` and then extended tick
 * by tick from the same quote socket the live grid reads. Drawn on
 * lightweight-charts through lwChart, as the TradingView card is (user
 * direction: "shouldnt it be using lightweight-charts like we added for v3"),
 * so the theme, the volume pane and the TradingView credit are that card's.
 *
 * The seed: this renderer owns its request, like the TradingView card and
 * the live grid (fetchesData is false for the type), because the card's own
 * GET would send the whole `symbol` param and `/series` charts one symbol.
 * Only the FIRST symbol in the param is charted, and the card says so.
 * Refresh (`refreshKey`) and Retry re-fetch it; a symbol or interval change
 * blanks the chart and seeds it again.
 *
 * The stream: the live grid's socket path exactly -- buildWidgetWsUrl,
 * a fresh gateway ticket per (re)connect for a header credential
 * (ticketedWsUrl, V10-P1), the reconnecting hook's backoff, and the grid's
 * `{"params":{"symbol":…}}` subscription frame, re-sent on the open socket
 * when the symbol changes. Frames are read with the grid's frameRows (a row
 * object or an array of them). Each row for the charted symbol is folded into
 * the newest bar with the series' incremental update, never a full redraw.
 * A widget with no wsEndpoint (OpenBB's v3 reference has no live_chart, but a
 * backend may declare one without a socket) opens nothing and shows the seed.
 *
 * onLive and onStatus are the live grid's, so the card's refresh control
 * gets the same tooltip and the same stale tone while the socket is down.
 */
export function LiveChartRenderer({
  widget,
  backend,
  params,
  refreshKey = 0,
  onLive,
  onStatus,
}: {
  widget: WidgetDef;
  backend: BackendConfig;
  params: Record<string, string>;
  refreshKey?: number;
  onLive?: (at: number) => void;
  onStatus?: (status: SocketStatus) => void;
}) {
  const theme = useResolvedTheme();
  const symbols = (params.symbol ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "");
  const symbol = symbols[0] ?? "";
  const interval = params.interval ?? "";
  const bucket = intervalSeconds(interval);
  const [bars, setBars] = useState<UdfBar[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [plotEl, setPlotEl] = useState<HTMLDivElement | null>(null);
  const [chart, setChart] = useState<CandleChartHandle | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  /** Read by the socket's onMessage, which must not be re-created per tick. */
  const chartRef = useRef<CandleChartHandle | null>(null);
  /** The newest bar on screen: what the next tick folds into. */
  const last = useRef<UdfBar | undefined>(undefined);
  /** The previous tick's volume counter (volumeStep); none until the first after a seed or a reconnect. */
  const volumeBase = useRef<VolumeCounter | undefined>(undefined);
  /**
   * Whether bars are on screen, from the seed OR from ticks over an empty seed:
   * a failed Refresh must keep either (review F5).
   */
  const hasBars = useRef(false);
  /** A tick has drawn a bar since the seed: the empty-seed note goes (review F5). */
  const [ticked, setTicked] = useState(false);
  /** Socket opens on this mount; every one after the first re-seeds (review F1). */
  const opens = useRef(0);
  /** Created in this theme; a flip re-themes the live chart instead (TradingViewRenderer's rule). */
  const themeRef = useRef(theme);

  // At most once a second, as the live grid reports it: the card re-renders on each.
  const liveReported = useRef(0);
  const reportLive = useCallback(
    (force = false) => {
      const now = Date.now();
      if (onLive === undefined || (!force && now - liveReported.current < 1000)) return;
      liveReported.current = now;
      onLive(now);
    },
    [onLive],
  );

  // A different symbol or interval is a different chart: blank it, so no tick
  // folds into the old one's bars while the new seed is in flight -- the old
  // chart's handle included, which a row could otherwise reach in the moment
  // before the plot unmounts -- and drop the old one's error, which is not the
  // new one's (review F7).
  useEffect(() => {
    setBars(null);
    setError(null);
    setTicked(false);
    hasBars.current = false;
    last.current = undefined;
    chartRef.current = null;
  }, [symbol, interval]);

  useEffect(() => {
    if (symbol === "") return;
    let cancelled = false;
    void (async () => {
      try {
        const next = seriesBars(await fetchWidgetData(backend, widget, { ...params, symbol }));
        if (cancelled) return;
        hasBars.current = next.length > 0;
        setBars(next);
        setError(null);
        reportLive(true);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        // A Refresh that fails with bars on screen keeps them (the TradingView rule).
        if (hasBars.current) void logOnce(`live-chart-refetch:${widget.id}`, `Live Chart ${symbol}: refetch failed, keeping the last bars: ${message}`);
        else setError(message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Keyed on symbol and interval, not `params` (a fresh object each render),
    // as the live grid keys its snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, widget, symbol, interval, attempt, refreshKey]);

  useEffect(() => {
    themeRef.current = theme;
    chart?.applyTheme(theme);
  }, [chart, theme]);

  // TradingViewRenderer's mount: on the plot element itself, disposed with it,
  // and a library chunk that lands after the card has gone is removed at once.
  useEffect(() => {
    if (!plotEl) return;
    let disposed = false;
    let handle: CandleChartHandle | null = null;
    mountCandleChart(plotEl, { theme: themeRef.current, colors: {}, showVolume: true, barSeconds: bucket }).then(
      (h) => {
        if (disposed) {
          h.dispose();
          return;
        }
        handle = h;
        setChart(h);
      },
      (err: unknown) => {
        void logOnce("lightweight-charts-load", `chart library failed to load: ${err instanceof Error ? err.message : String(err)}`);
        if (!disposed) setLoadFailed(true);
      },
    );
    return () => {
      disposed = true;
      handle?.dispose();
      chartRef.current = null;
      setChart(null);
    };
    // An interval change blanks the bars, which unmounts the plot, so a new
    // bucket always arrives with a new plotEl; listing it costs nothing.
  }, [plotEl, bucket]);

  // The seed is the only full redraw; every tick after it is updateBar.
  useEffect(() => {
    if (!chart || !bars) return;
    chart.setBars(bars);
    last.current = bars.at(-1);
    volumeBase.current = undefined;
    chartRef.current = chart;
    setTicked(false);
  }, [chart, bars]);

  // No symbol, or an interval this chart cannot bucket, means no socket: every
  // tick would be dropped, and opening it would still spend a frame and the
  // relay's share for nothing while the card read "live" (review F6).
  const streams = symbol !== "" && bucket !== null;
  const url = useMemo(() => (streams ? buildWidgetWsUrl(backend, widget) : null), [backend, widget, streams]);
  // The charted symbol only: subscribing the rest would stream (and, through
  // the gateway, spend quota on) rows this card drops. Keyed on the symbol
  // alone, deliberately: the frame carries no interval (the socket streams
  // quotes, and the bucketing is this card's), so an interval change re-seeds
  // the chart but re-sends nothing -- the same frame again would only spend
  // another frame (coordinator ruling, round 2).
  const subscribe = useMemo(() => ({ params: { symbol } }), [symbol]);

  const onMessage = useCallback(
    (message: unknown) => {
      // Until the seed is drawn there is nothing to fold into: such a tick is
      // dropped, and the seed (which already holds the recent bars) wins.
      const drawn = chartRef.current;
      if (drawn === null || bucket === null) return;
      let moved = false;
      for (const row of frameRows(message)) {
        const tick = rowTick(row, symbol, Date.now());
        if (!tick) continue;
        const step = volumeStep(volumeBase.current, tick);
        volumeBase.current = step.prev;
        const bar = foldTick(last.current, { ...tick, size: step.add }, bucket);
        if (!bar) continue;
        drawn.updateBar(bar);
        last.current = bar;
        moved = true;
      }
      if (!moved) return;
      reportLive();
      if (!hasBars.current) {
        hasBars.current = true;
        setTicked(true);
      }
    },
    [symbol, bucket, reportLive],
  );

  const status = useReconnectingSocket(url, subscribe, onMessage, {
    // The live grid's options, for the same reasons (LiveGridRenderer).
    resolveUrl: wantsSocketTicket(backend) ? (plain) => ticketedWsUrl(backend, plain) : undefined,
    // A REopen re-seeds (review F1): the bars the outage missed come from
    // /series, not from one tick, and the volume baseline goes with the old
    // connection, so the first row after the gap cannot credit the whole
    // outage's volume to one bar. The seed effect clears the baseline too;
    // clearing it here as well covers the ticks that land before the seed.
    onOpen: () => {
      opens.current += 1;
      if (opens.current === 1) return;
      volumeBase.current = undefined;
      setAttempt((n) => n + 1);
    },
    onDrop: () => {
      if (url !== null) void logOnce(`widget-socket:${widget.id}`, `websocket dropped: ${stripQuery(url)}`);
    },
  });
  useEffect(() => onStatus?.(status), [status, onStatus]);
  useEffect(() => () => onStatus?.("idle"), [onStatus]);

  if (symbol === "") return <p className="empty-state">Choose a symbol to chart.</p>;
  if (loadFailed) return <ErrorState message="chart library failed to load" onRetry={() => setLoadFailed(false)} />;
  if (error !== null) return <ErrorState message={error} onRetry={() => setAttempt((n) => n + 1)} />;
  if (bars === null) return <p className="empty-state">Loading…</p>;
  const note = [
    symbols.length > 1 ? `Charting ${symbol} only: this card draws the first symbol.` : "",
    bars.length === 0 && !ticked ? `No bars for ${symbol} yet.` : "",
    bucket === null
      ? interval === ""
        ? "Live updates are off: no interval is set."
        : `Live updates are off: "${interval}" is not an interval this chart reads.`
      : "",
  ].filter((s) => s !== "").join(" ");
  return (
    <div className="tv-chart" data-status={status}>
      {note !== "" ? <p className="live-chart-note">{note}</p> : null}
      <div className="tv-chart-plot" ref={setPlotEl} data-testid="live-chart-plot" />
      <a className="tv-credit" href={TRADINGVIEW_CREDIT_URL} onClick={openCredit}>
        {TRADINGVIEW_CREDIT_LABEL}
      </a>
    </div>
  );
}
