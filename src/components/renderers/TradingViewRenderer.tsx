// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { fetchWidgetData } from "../../lib/dataClient";
import { logOnce } from "../../lib/logger";
import {
  mountCandleChart,
  TRADINGVIEW_CREDIT_LABEL,
  TRADINGVIEW_CREDIT_URL,
  type CandleChartHandle,
} from "../../lib/lwChart";
import type { BackendConfig, UdfChartSpec, WidgetDef } from "../../lib/types";
import { parseUdfHistory, udfHistoryEndpoint, udfHistoryParams, type UdfBar } from "../../lib/udf";
import { useSettingsStore } from "../../stores/settingsStore";
import { ErrorState } from "./ErrorState";

type Props = {
  widget: WidgetDef;
  backend: BackendConfig;
  spec: UdfChartSpec;
  /** How the header's Refresh and ⌘R reach this card, exactly as for RssRenderer: any change refetches. */
  refreshKey: number;
};

/**
 * Never lets the webview navigate: the opener hands the page to the system
 * browser. A plain browser build whose opener is missing or refuses falls back
 * to a new tab, with no opener reference back into the app.
 */
function openCredit(event: MouseEvent<HTMLAnchorElement>): void {
  event.preventDefault();
  openUrl(TRADINGVIEW_CREDIT_URL).catch(() => {
    window.open(TRADINGVIEW_CREDIT_URL, "_blank", "noopener,noreferrer");
  });
}

/**
 * OpenBB's `advanced_charting` widget -- the reference backend's "TradingView
 * Chart" -- drawn as daily candles and volume for its `defaultSymbol` on
 * lightweight-charts. Not TradingView's proprietary Charting Library: no
 * drawing tools, indicators, symbol search or resolution picker.
 *
 * This renderer owns its request, like LiveGridRenderer: fetchesData is false
 * for the type, so the card's generic fetch never asks `/udf` itself (which
 * is what used to produce "HTTP 404: Not Found"). The request still goes
 * through fetchWidgetData -- a copy of the widget pointed at
 * `{endpoint}/history` -- so the backend's credential, the connect timeout
 * and describeHttpError's wording apply exactly as on every other card.
 *
 * Refetches every `updateFrequency`, armed only once the previous request has
 * finished (the RssRenderer rule), so one card never has two in flight. A
 * refetch that fails while bars are on screen keeps them and logs once; only
 * a card with nothing to show turns into an error.
 */
export function TradingViewRenderer({ widget, backend, spec, refreshKey }: Props) {
  const theme = useSettingsStore((s) => s.settings.theme);
  const [bars, setBars] = useState<UdfBar[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by Retry and by the refetch timer, to re-run the fetch effect. */
  const [attempt, setAttempt] = useState(0);
  const [plotEl, setPlotEl] = useState<HTMLDivElement | null>(null);
  const [chart, setChart] = useState<CandleChartHandle | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  /** Whether bars are on screen -- read by a failed refetch, which must not replace them. */
  const hasBars = useRef(false);
  /**
   * The theme to create the chart in. A ref, not a mount dependency: a theme
   * flip re-themes the live chart (the effect below) instead of remounting
   * it, which would throw away the reader's zoom and pan.
   */
  const themeRef = useRef(theme);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const history = { ...widget, endpoint: udfHistoryEndpoint(widget.endpoint) };

    void (async () => {
      try {
        const payload = await fetchWidgetData(backend, history, udfHistoryParams(spec.defaultSymbol, Date.now()));
        const next = parseUdfHistory(payload);
        if (cancelled) return;
        hasBars.current = next.length > 0;
        setBars(next);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        if (hasBars.current) {
          void logOnce(
            `tradingview-refetch:${widget.id}`,
            `TradingView ${spec.defaultSymbol}: refetch failed, keeping the last bars: ${message}`,
          );
        } else {
          setError(message);
        }
      } finally {
        if (!cancelled) timer = setTimeout(() => setAttempt((n) => n + 1), spec.updateFrequency);
      }
    })();

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [widget, backend, spec, refreshKey, attempt]);

  useEffect(() => {
    themeRef.current = theme;
    chart?.applyTheme(theme);
  }, [chart, theme]);

  // Mounted on the plot element itself (a callback ref into state), so the
  // chart exists exactly while there are bars to draw. `disposed` covers the
  // library chunk arriving after the card has gone: that late chart is
  // removed at once rather than left on a detached node.
  useEffect(() => {
    if (!plotEl) return;
    let disposed = false;
    let handle: CandleChartHandle | null = null;
    mountCandleChart(plotEl, { theme: themeRef.current, colors: spec.colors, showVolume: spec.showVolume }).then(
      (h) => {
        if (disposed) {
          h.dispose();
          return;
        }
        handle = h;
        setChart(h);
      },
      (err: unknown) => {
        void logOnce(
          "lightweight-charts-load",
          `chart library failed to load: ${err instanceof Error ? err.message : String(err)}`,
        );
        if (!disposed) setLoadFailed(true);
      },
    );
    return () => {
      disposed = true;
      handle?.dispose();
      setChart(null);
    };
  }, [plotEl, spec]);

  useEffect(() => {
    if (chart && bars) chart.setBars(bars);
  }, [chart, bars]);

  if (loadFailed) return <ErrorState message="chart library failed to load" onRetry={() => setLoadFailed(false)} />;
  if (error !== null) return <ErrorState message={error} onRetry={() => setAttempt((n) => n + 1)} />;
  if (bars === null) return <p className="empty-state">Loading…</p>;
  if (bars.length === 0) return <p className="empty-state">{`No bars for ${spec.defaultSymbol}`}</p>;
  return (
    <div className="tv-chart">
      <div className="tv-chart-plot" ref={setPlotEl} data-testid="tv-chart-plot" />
      <a className="tv-credit" href={TRADINGVIEW_CREDIT_URL} onClick={openCredit}>
        {TRADINGVIEW_CREDIT_LABEL}
      </a>
    </div>
  );
}
