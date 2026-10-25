// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { buildWidgetWsUrl, fetchWidgetData, fetchWidgetPath, stripQuery, ticketedWsUrl, wantsSocketTicket } from "../../lib/dataClient";
import { useReconnectingSocket, type SocketStatus } from "../../hooks/useReconnectingSocket";
import { isRecord } from "../../lib/isRecord";
import { logOnce } from "../../lib/logger";
import { rangeBarOf, tableRows, type Row } from "../../lib/tableColumns";
import { ErrorState } from "./ErrorState";
import { TableRenderer } from "./TableRenderer";
import type { BackendConfig, TableSpec, WidgetDef } from "../../lib/types";

/** What the card hands on to the table: everything a table card has, except the rows and the spec. */
type TableViewProps = Omit<ComponentProps<typeof TableRenderer>, "data" | "plain" | "columns" | "spec" | "rowIdColumn">;

/**
 * The rows one streamed frame carries. Two shapes, both read:
 *
 * - one row object per frame -- OpenBB's reference `/live_grid_ws` (the v3
 *   reference-compatibility target, no auth) and the stack's live-grid
 *   (`ws.send_json(row)`, openbb-docker v10.1.7) both send this;
 * - an array of row objects -- the donor's v10 client read only this shape.
 *
 * Anything else (a scalar, an array holding a non-object) is dropped in
 * silence: one frame the grid cannot trust must never blank it.
 */
export function frameRows(message: unknown): Row[] {
  if (Array.isArray(message)) return tableRows(message) ?? [];
  return isRecord(message) ? [message as Row] : [];
}

/** The `symbol_meta` fields this renderer knows: a logo and the 52-week range. */
type Meta = { logo_url?: string; week52_high?: number; week52_low?: number };
const META_KEYS: ReadonlySet<string> = new Set(["logo_url", "week52_high", "week52_low"]);

/**
 * The `symbol_meta` fields this grid's table reads -- as columns, or as a
 * range bar's ends. Only those are asked for and added to the rows: a grid
 * reading none (OpenBB's reference among them) makes no extra request and
 * gains no columns, and one reading only the logo gains no 52-week columns.
 * tableColumns shows every field a row carries, so any other key added here
 * would appear as a column nobody declared.
 */
export function symbolMetaRead(spec: TableSpec | undefined): string[] {
  const read = new Set<string>();
  for (const c of spec?.columns ?? []) {
    const bar = rangeBarOf(c);
    for (const key of [c.field, bar?.lowKey, bar?.highKey]) if (key !== undefined && META_KEYS.has(key)) read.add(key);
  }
  return [...read].sort();
}

/**
 * symbol_meta's answer: a LIST of rows, each carrying its own `symbol` (not an
 * object keyed by symbol -- the donor learned that against the real service).
 * `logo_url` is kept verbatim, never derived from the symbol, and the literal
 * "NA" (forex and crypto) is no logo. Anything malformed is skipped.
 */
export function normaliseMeta(payload: unknown): Map<string, Meta> {
  const out = new Map<string, Meta>();
  if (!Array.isArray(payload)) return out;
  for (const raw of payload) {
    if (!isRecord(raw)) continue;
    const { symbol, logo_url, week52_high, week52_low } = raw;
    if (typeof symbol !== "string" || symbol === "") continue;
    out.set(symbol, {
      ...(typeof logo_url === "string" && logo_url !== "" && logo_url !== "NA" ? { logo_url } : {}),
      ...(typeof week52_high === "number" && Number.isFinite(week52_high) ? { week52_high } : {}),
      ...(typeof week52_low === "number" && Number.isFinite(week52_low) ? { week52_low } : {}),
    });
  }
  return out;
}

/**
 * The comma list in a `symbol` param, trimmed and upper-cased, as a set. Upper
 * case because a symbol is matched case-insensitively, as the statement fiscal
 * code does, and the param keeps what was typed: "aapl" names the "AAPL" a
 * backend streams. Compare a row's id through the same upper-casing.
 */
function symbolSet(raw: string | undefined): Set<string> {
  return new Set((raw ?? "").split(",").map((s) => s.trim().toUpperCase()).filter((s) => s !== ""));
}

/**
 * A table seeded from the widget's HTTP snapshot that then updates over a
 * WebSocket. Each streamed row is merged into the row whose wsRowIdColumn
 * matches, field by field (a tick does not erase what the seed carried and the
 * tick did not), and a row the seed never had is appended. The symbol
 * selection is sent as the subscription frame, `{"params":{"symbol":...}}`,
 * not as a URL param -- the reference backend streams nothing until it
 * arrives -- and an edit re-sends it over the socket already open
 * (useReconnectingSocket's default "resubscribe" mode).
 *
 * The renderer, not the card, fetches the snapshot (builtins.ts leaves a
 * live_grid to it), so a failed snapshot is this renderer's to show, with a
 * Retry; the header's Refresh reaches it as `refreshKey`.
 */
export function LiveGridRenderer({
  widget,
  backend,
  params,
  refreshKey = 0,
  tableKey,
  onLive,
  onStatus,
  ...table
}: {
  widget: WidgetDef;
  backend: BackendConfig;
  params: Record<string, string>;
  /** The header's Refresh (and a refresh-all): re-fetches the snapshot. The socket carries on. */
  refreshKey?: number;
  /** The card's Reset table: remounts the table under the same socket. */
  tableKey?: number;
  /**
   * When the grid last took data -- a snapshot or a streamed row -- for the
   * card's refresh tooltip, which otherwise reads "Not fetched yet" because
   * the card never fetches a live_grid itself. At most once a second.
   */
  onLive?: (at: number) => void;
  /**
   * The socket's state, for the card's refresh tone: a feed that is
   * reconnecting is not fresh, however recent its last row.
   */
  onStatus?: (status: SocketStatus) => void;
} & TableViewProps) {
  const idColumn = widget.wsRowIdColumn ?? "symbol";
  const symbol = params.symbol ?? "";
  const [seed, setSeed] = useState<Row[]>([]);
  const [live, setLive] = useState<Map<string, Row>>(() => new Map());
  // Every streamed row's arrival number, so a snapshot can tell which rows are
  // older than itself: the count when its request went out is its timestamp.
  const arrivals = useRef(0);
  const arrivedAt = useRef(new Map<string, number>());
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const liveReported = useRef(0);
  const reportLive = useCallback(
    (force = false) => {
      if (onLive === undefined) return;
      const now = Date.now();
      if (!force && now - liveReported.current < 1000) return;
      liveReported.current = now;
      onLive(now);
    },
    [onLive],
  );

  // Snapshot, re-fetched when the symbol selection changes, on Retry and on Refresh.
  useEffect(() => {
    let current = true;
    const asked = arrivals.current;
    void fetchWidgetData(backend, widget, params).then(
      (data) => {
        if (!current) return;
        setError(null);
        reportLive(true);
        if (Array.isArray(data)) {
          setSeed(data as Row[]);
          // A new snapshot is the floor again, as the v3 renderer's replace
          // was: a streamed row that arrived before it was asked for must not
          // override it. One that arrived while it was in flight is newer and
          // stays -- a backend that answers the subscription at once (the
          // reference does) would otherwise lose its first tick to the seed.
          setLive((prev) => {
            const next = new Map([...prev].filter(([id]) => (arrivedAt.current.get(id) ?? 0) > asked));
            return next.size === prev.size ? prev : next;
          });
        }
      },
      (err: unknown) => {
        // The card does not fetch a live_grid (builtins.ts leaves it to this
        // renderer), so nothing else would show the failure: without this the
        // card reads "No rows." as if the snapshot were empty.
        if (current) setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      current = false;
    };
    // Keyed on the symbol only (and Retry's and Refresh's counts): params is a
    // fresh object each render, and the backend/widget identities do not
    // change while a card is mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, widget, symbol, attempt, refreshKey]);

  // A symbol removed from the param loses its streamed row instead of
  // freezing on screen at its last price (donor fa96f72c). Only when rows are
  // keyed by the symbol itself: a grid keyed by another column cannot be
  // pruned by a symbol list. The refetched snapshot drops it from the seed.
  // The prune runs once, at the edit, but a tick already in flight lands
  // after it: onMessage drops every symbol an edit removed (until one adds it
  // back), so that tick cannot put the row back. A row the backend sends
  // unasked, before any edit, is still appended, as the v3 renderer did.
  const subscribed = useMemo(() => symbolSet(symbol), [symbol]);
  const previous = useRef(subscribed);
  const removed = useRef(new Set<string>());
  useEffect(() => {
    if (idColumn !== "symbol") return;
    for (const s of previous.current) if (!subscribed.has(s)) removed.current.add(s);
    for (const s of subscribed) removed.current.delete(s);
    previous.current = subscribed;
    setLive((prev) => {
      const next = new Map([...prev].filter(([id]) => subscribed.has(id.toUpperCase())));
      return next.size === prev.size ? prev : next;
    });
  }, [subscribed, idColumn]);

  const metaRead = useMemo(() => symbolMetaRead(widget.table), [widget.table]);
  const withMeta = metaRead.length > 0;
  const [meta, setMeta] = useState<Map<string, Meta>>(() => new Map());

  const rows = useMemo<Row[]>(() => {
    const byId = new Map<string, Row>();
    // A seed row without the identity column keeps its own place (keyed by
    // its index, which no streamed id can match) instead of collapsing into
    // one "undefined" row: the v3 renderer showed the snapshot as delivered.
    seed.forEach((row, i) => byId.set(row[idColumn] === undefined || row[idColumn] === null ? `\u0000${i}` : String(row[idColumn]), row));
    for (const [id, row] of live) byId.set(id, { ...(byId.get(id) ?? {}), ...row });
    const merged = [...byId.values()];
    if (!withMeta) return merged;
    // The keys it reads, absent, FIRST, so those columns are there from the
    // first render instead of popping in when symbol_meta answers; the real
    // values land over them.
    return merged.map((row) => {
      const found: Partial<Record<string, unknown>> = meta.get(String(row[idColumn])) ?? {};
      const out: Row = {};
      for (const key of metaRead) out[key] = null;
      Object.assign(out, row);
      for (const key of metaRead) if (Object.hasOwn(found, key)) out[key] = found[key];
      return out;
    });
  }, [seed, live, idColumn, withMeta, metaRead, meta]);

  // The symbol SET, not the rows: a tick replaces row objects several times a
  // second, and an effect keyed on `rows` would refetch symbol_meta as often.
  // Sorted and comma-joined so the dependency is membership, not order.
  const metaSymbols = useMemo(
    () => (withMeta ? [...new Set(rows.map((r) => String(r[idColumn])))].sort().join(",") : ""),
    [withMeta, rows, idColumn],
  );
  useEffect(() => {
    if (metaSymbols === "") return;
    let current = true;
    fetchWidgetPath(backend, "symbol_meta", { symbol: metaSymbols }).then(
      (payload) => {
        if (current) setMeta(normaliseMeta(payload)); // a stale answer never decorates another set
      },
      (err: unknown) => {
        // Not an error state: a backend without this endpoint 404s into
        // here, and the grid is complete without logos. Once per card.
        void logOnce(`symbol_meta:${widget.id}`, `symbol_meta unavailable: ${err instanceof Error ? err.message : String(err)}`);
      },
    );
    return () => {
      current = false;
    };
  }, [metaSymbols, backend, widget.id]);

  const url = useMemo(() => buildWidgetWsUrl(backend, widget), [backend, widget]);
  const subscribe = useMemo(() => ({ params: { symbol } }), [symbol]);

  const onMessage = useCallback(
    (message: unknown) => {
      const batch = frameRows(message).filter(
        (row) =>
          Object.hasOwn(row, idColumn) &&
          row[idColumn] !== undefined &&
          row[idColumn] !== null &&
          !(idColumn === "symbol" && removed.current.has(String(row[idColumn]).toUpperCase())),
      );
      if (batch.length === 0) return;
      setLive((prev) => {
        const next = new Map(prev);
        for (const row of batch) {
          const id = String(row[idColumn]);
          next.set(id, { ...(next.get(id) ?? {}), ...row });
        }
        return next;
      });
      arrivals.current += 1;
      for (const row of batch) arrivedAt.current.set(String(row[idColumn]), arrivals.current);
      reportLive();
    },
    [idColumn, reportLive],
  );

  const status = useReconnectingSocket(url, subscribe, onMessage, {
    // A fresh gateway ticket for every (re)connect when the backend's
    // credential is a header (V10-P1); otherwise the plain URL, opened at once.
    resolveUrl: wantsSocketTicket(backend) ? (plain) => ticketedWsUrl(backend, plain) : undefined,
    // Written once per card per session, never per retry: a socket that keeps
    // being refused otherwise retries with nothing rendered and nothing logged,
    // indistinguishable from a quiet market. The query is stripped, because a
    // query-placed credential rides this URL (donor 65f9b782). `url` is the
    // plain one, so a socket ticket never reaches the log either.
    onDrop: () => {
      if (url !== null) void logOnce(`widget-socket:${widget.id}`, `websocket dropped: ${stripQuery(url)}`);
    },
  });

  useEffect(() => onStatus?.(status), [status, onStatus]);
  // Unmounted (a minimised card), the socket is closed: say so, or the card
  // keeps the last "live" it heard.
  useEffect(() => () => onStatus?.("idle"), [onStatus]);

  if (error !== null) return <ErrorState message={error} onRetry={() => setAttempt((n) => n + 1)} />;

  return (
    <div className="live-grid" data-status={status}>
      <TableRenderer key={tableKey} data={rows} spec={widget.table} rowIdColumn={idColumn} {...table} />
    </div>
  );
}
