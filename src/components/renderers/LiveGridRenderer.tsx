// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useMemo, useState } from "react";
import { buildWidgetWsUrl, fetchWidgetData } from "../../lib/dataClient";
import { useReconnectingSocket } from "../../hooks/useReconnectingSocket";
import { ErrorState } from "./ErrorState";
import { TableRenderer } from "./TableRenderer";
import type { BackendConfig, WidgetDef } from "../../lib/types";

type Row = Record<string, unknown>;

/**
 * A table seeded from the widget's HTTP snapshot that then updates over a
 * WebSocket. Each streamed message is one row, merged into the row whose
 * wsRowIdColumn matches (appended if new). The symbol selection is sent as the
 * subscription message, not a URL param -- the reference backend streams
 * nothing until it arrives.
 */
export function LiveGridRenderer({
  widget,
  backend,
  params,
  refreshKey = 0,
}: {
  widget: WidgetDef;
  backend: BackendConfig;
  params: Record<string, string>;
  refreshKey?: number;
}) {
  const idColumn = widget.wsRowIdColumn ?? "symbol";
  const symbol = params.symbol ?? "";
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Only the snapshot depends on Refresh. The socket stays subscribed.
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void fetchWidgetData(backend, widget, params, undefined, { signal }).then(
      (data) => {
        if (signal.aborted) return;
        setError(null);
        if (Array.isArray(data)) setRows(data as Row[]);
      },
      (err: unknown) => {
        // The card does not fetch a live_grid (builtins.ts leaves it to this
        // renderer), so nothing else would show the failure: without this the
        // card reads "No rows." as if the snapshot were empty.
        if (!signal.aborted) setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => controller.abort();
    // For query params the dependency is the symbol: params is a fresh
    // object each render, and the backend/widget identities do not change
    // while a card is mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, widget, symbol, attempt, refreshKey]);

  const url = useMemo(() => buildWidgetWsUrl(backend, widget), [backend, widget]);
  const subscribe = useMemo(() => ({ params: { symbol } }), [symbol]);

  const status = useReconnectingSocket(url, subscribe, (message) => {
    const row = message as Row;
    const id = row?.[idColumn];
    if (id === undefined) return;
    setRows((current) => {
      const i = current.findIndex((r) => r[idColumn] === id);
      if (i === -1) return [...current, row];
      const next = current.slice();
      next[i] = { ...next[i], ...row };
      return next;
    });
  });

  if (error !== null) return <ErrorState message={error} onRetry={() => setAttempt((n) => n + 1)} />;

  return (
    <div className="live-grid" data-status={status}>
      <TableRenderer data={rows} spec={widget.table} rowIdColumn={idColumn} />
    </div>
  );
}
