// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import { useEffect, useMemo, useState } from "react";
import { logError } from "../lib/logger";
import { useReconnectingSocket } from "./useReconnectingSocket";
import type { TickStatus } from "./useTickCache";

export type StudyPoint = { time: number; value: number | null };
export type StudySeries = {
  column: string; label: string; render: Record<string, unknown>; data: StudyPoint[];
  /**
   * The request this series answered (openbb-docker's v12.3.0 studies work:
   * every series names its request). `source` is what was ASKED for -- null
   * means "the chart's default" -- while `render.source` is what actually
   * SERVED it; the two differ on exactly the fallback paths the strip marks
   * as `local`. Absent for a hand-built series with no request behind it.
   */
  req?: { name: string; params: Record<string, unknown>; source: string | null };
  /** Why this line is partial or empty, in the server's words (a gap, a vs it could not serve; plan R8). */
  note?: string;
};
export type StudyPane = {
  id: string; height: number; guides: number[]; series: StudySeries[];
};

/** The server sends naive ISO in the bars' own timezone, UTC for tick bars. */
function seconds(stamp: string): number {
  return Math.floor(Date.parse(stamp.endsWith("Z") ? stamp : `${stamp}Z`) / 1000);
}

function parsePanes(raw: unknown): StudyPane[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((pane) => {
    const p = pane as Record<string, unknown>;
    return {
      id: String(p.id ?? ""),
      height: Number(p.height ?? 1),
      guides: Array.isArray(p.guides) ? (p.guides as number[]).map(Number) : [],
      series: (Array.isArray(p.series) ? p.series : []).map((entry) => {
        const s = entry as Record<string, unknown>;
        const req = s.req as { name?: unknown; params?: unknown; source?: unknown } | null | undefined;
        return {
          column: String(s.column ?? ""),
          label: String(s.label ?? ""),
          render: (s.render ?? {}) as Record<string, unknown>,
          // Only a request with a name is one: the server sends `req: null`
          // for a series nothing asked for, and that stays absent here.
          ...(req && typeof req.name === "string"
            ? { req: {
                name: req.name,
                params: (req.params ?? {}) as Record<string, unknown>,
                source: typeof req.source === "string" ? req.source : null,
              } }
            : {}),
          ...(typeof s.note === "string" ? { note: s.note } : {}),
          data: (Array.isArray(s.data) ? s.data : []).map((point) => {
            const d = point as { time: string; value: number | null };
            return { time: seconds(String(d.time)), value: d.value === null ? null : Number(d.value) };
          }),
        };
      }),
    };
  });
}

/**
 * Splice a delta's tail onto the standing series, matched by column.
 *
 * Ordering/uniqueness is safe by construction: `series.data` is already
 * ascending and unique (either freshly installed by a `series` frame, or
 * the result of a previous, equally-safe splice), and the server guarantees
 * each frame's own `data` is ascending and unique too. Filtering to
 * `p.time < from` keeps a strict prefix of that sorted array -- every
 * retained point is < the tail's first time, so appending the tail (whose
 * own times are >= its first time) cannot produce a duplicate or a
 * regression, regardless of what `from` is relative to the retained data
 * (a `from` before the standing series' start keeps nothing and just
 * replaces; a `from` past its end keeps everything and just appends).
 */
function applyDelta(current: StudyPane[], incoming: StudyPane[]): StudyPane[] {
  const byColumn = new Map<string, StudySeries>();
  for (const pane of incoming) for (const s of pane.series) byColumn.set(s.column, s);
  return current.map((pane) => ({
    ...pane,
    series: pane.series.map((series) => {
      const tail = byColumn.get(series.column);
      if (tail === undefined) return series;
      if (tail.data.length === 0 && tail.note === series.note) return series;
      // The tail's note is the line's standing note: present replaces, absent clears (plan R8).
      const { note: _standing, ...rest } = series;
      const noted = tail.note === undefined ? rest : { ...rest, note: tail.note };
      if (tail.data.length === 0) return noted;
      const from = tail.data[0].time;
      return { ...noted, data: [...series.data.filter((p) => p.time < from), ...tail.data] };
    }),
  }));
}

/**
 * live-grid's series-mode study feed. A `series` frame REPLACES the standing
 * panes -- the server sends one whenever a delta could not carry the truth
 * (first frame, a repainting indicator, an error state) -- and a `delta`
 * frame splices its tail on.
 */
/**
 * What the standing panes are ABOUT. A change here makes them wrong for the
 * chart -- another symbol's levels, another interval's grid, a study the card
 * no longer carries (which the renderer would then draw as "unclaimed") --
 * so they are dropped. Everything else in the url (session, basis, the
 * window, the bar provider) re-computes the same lines for the same
 * instrument, and the old ones stay up until the replacement frame lands.
 *
 * Owner, 2026-09-27: "when I changed the session it did not redraw the
 * study". Blanking on EVERY url change deleted the study for the whole
 * reconnect and server recompute -- many seconds on an EODHD card -- and the
 * legend read "—" while the candles, fed by a different socket, sat there.
 *
 * A url this cannot read falls back to the url itself, which is the old
 * blank-on-any-change behaviour rather than a throw inside a render.
 */
function plotted(url: string | null): string {
  if (url === null) return "";
  try {
    const q = new URL(url).searchParams;
    return ["symbol", "interval", "indicators", "macro", "source"].map((k) => q.get(k) ?? "").join("|");
  } catch {
    return url;
  }
}

export type StudyFeed = { panes: StudyPane[]; note: string | null };

/** One study socket: its panes, and why it is not drawing when the server said (spec 2026-11-13 §2 Failures). */
function useFeed(url: string | null): { status: TickStatus; panes: StudyPane[]; note: string | null } {
  const [panes, setPanes] = useState<StudyPane[]>([]);
  const [note, setNote] = useState<string | null>(null);

  const identity = plotted(url);
  useEffect(() => {
    // Left standing across a SYMBOL change until the new url's first frame,
    // the previous symbol's lines stayed on the shared price scale, and
    // autoscale spanned Bitcoin's ~100k studies and AAPL's ~230 candles.
    // Keyed on what is plotted, not on the url: see `plotted`.
    setPanes([]);
    setNote(null);
  }, [identity]);

  const { status } = useReconnectingSocket(url, {
    onMessage: (event) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(String(event.data));
      } catch (err) {
        void logError(`study feed sent unparseable JSON: ${err}`);
        return;
      }
      const incoming = parsePanes(message.panes);
      if (message.type === "series") {
        setPanes(incoming);
        // live-grid names a bars failure in the frame's subtitle (router ta_series_ws).
        setNote(String(message.subtitle ?? "").includes("bars unavailable") ? "bars unavailable" : null);
      } else if (message.type === "delta") setPanes((current) => applyDelta(current, incoming));
    },
    onClose: (reason) => { if (reason !== undefined) setNote(reason); },
  });

  return { status, panes, note };
}

const NO_EXTRAS: readonly (string | null)[] = [];

/**
 * The card's study feeds: list:1's socket, and one per extra ticker that has a study
 * (spec 2026-11-13 §2, plan R3). Always four extra feeds -- MAX_EXTRA_SYMBOLS, fixed because
 * hooks cannot be called in a loop -- and a null url opens nothing.
 */
export function useStudySeries({ url, extraUrls = NO_EXTRAS }: { url: string | null; extraUrls?: readonly (string | null)[] }):
  { status: TickStatus; panes: StudyPane[]; extras: StudyFeed[] } {
  const main = useFeed(url);
  const a = useFeed(extraUrls[0] ?? null);
  const b = useFeed(extraUrls[1] ?? null);
  const c = useFeed(extraUrls[2] ?? null);
  const d = useFeed(extraUrls[3] ?? null);
  const extras = useMemo(
    () => [a, b, c, d].map(({ panes, note }) => ({ panes, note })),
    // The feeds are new objects every render; their panes and notes are what this is made of.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [a.panes, a.note, b.panes, b.note, c.panes, c.note, d.panes, d.note],
  );
  return { status: main.status, panes: main.panes, extras };
}
