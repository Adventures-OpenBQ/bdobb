// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

/**
 * The arts-charts document API and its change feed, through the host's
 * `chartsFetch` (shared chart documents, step 1b). A rejected fetch -- the
 * server unreachable -- propagates as itself; an HTTP refusal is a
 * ChartServerError carrying the status and the server's reason.
 */
import type { ChartsFetch } from "../host";
import type { ChartBody, ChartDocument } from "./chartDocument";

export class ChartServerError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** One `/charts/events` message (step 1 ruling 3). Later steps add other kinds. */
export type ChartEvent = { kind: string; id: string; revision: number; by: string };

async function refusal(response: Response): Promise<ChartServerError> {
  let reason = `HTTP ${response.status}`;
  try {
    const data = (await response.json()) as { detail?: unknown };
    if (typeof data.detail === "string") reason = data.detail;
  } catch { /* no JSON body: the status says it */ }
  return new ChartServerError(response.status, reason);
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw await refusal(response);
  return (await response.json()) as T;
}

const JSON_HEADERS = { "content-type": "application/json" };

export const getChart = async (f: ChartsFetch, id: string): Promise<ChartDocument> =>
  json(await f(`/charts/${encodeURIComponent(id)}`));

export const listCharts = async (f: ChartsFetch): Promise<{ id: string; revision: number }[]> =>
  json(await f("/charts"));

export const createChart = async (f: ChartsFetch, title: string, body: ChartBody): Promise<ChartDocument> =>
  json(await f("/charts", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ title, body }) }));

/**
 * Save `body` over `base` (its revision and title): the saved document, or
 * `conflict` with the document that won -- a 409's body is the current
 * document itself (step 1 ruling 10).
 */
export async function saveChart(
  f: ChartsFetch, base: ChartDocument, body: ChartBody,
): Promise<{ saved: ChartDocument } | { conflict: ChartDocument }> {
  const response = await f(`/charts/${encodeURIComponent(base.id)}`, {
    method: "PUT",
    headers: { ...JSON_HEADERS, "If-Match": String(base.revision) },
    body: JSON.stringify({ title: base.title, body }),
  });
  if (response.status === 409) return { conflict: (await response.json()) as ChartDocument };
  return { saved: await json<ChartDocument>(response) };
}

type Listener = { onEvent: (event: ChartEvent) => void; onOpen: () => void };
type Feed = { listeners: Set<Listener>; reader: ReadableStreamDefaultReader<Uint8Array> | null };

/** Wait between a dropped or refused stream and the next attempt (the server's own `retry: 1000`). */
export const RETRY_MS = 1000;
/**
 * Silence on the feed (no event, no ping comment) for this long means the
 * connection is dead -- a laptop that slept leaves a read() that never
 * returns. 3x the server's `PING` (15 s, server/arts_charts/documents.py):
 * two missed pings are tolerated, the third is not.
 */
export const IDLE_MS = 45_000;
/**
 * One `/charts/events` stream per host fetch, shared by every card: a
 * browser allows six HTTP/1.1 connections per origin, and a dashboard of
 * chart cards each holding its own stream would starve every other request.
 */
const feeds = new Map<ChartsFetch, Feed>();

/**
 * Listen to the change feed. `onOpen` fires on every (re)connect -- the
 * cue to catch up from `GET /charts` (step 1 ruling 2); `onEvent` on every
 * message. Returns the unsubscribe; the stream closes with its last listener.
 */
export function watchCharts(f: ChartsFetch, listener: Listener): () => void {
  let feed = feeds.get(f);
  if (feed === undefined) {
    feed = { listeners: new Set(), reader: null };
    feeds.set(f, feed);
    void run(f, feed);
  }
  feed.listeners.add(listener);
  const mine = feed;
  return () => {
    mine.listeners.delete(listener);
    if (mine.listeners.size > 0) return;
    feeds.delete(f);
    void mine.reader?.cancel().catch(() => {});
  };
}

async function run(f: ChartsFetch, feed: Feed): Promise<void> {
  const live = () => feeds.get(f) === feed;
  while (live()) {
    try {
      const response = await f("/charts/events", { headers: { accept: "text/event-stream" } });
      if (!response.ok || response.body === null) throw new Error(`HTTP ${response.status}`);
      feed.reader = response.body.getReader();
      if (!live()) break;
      for (const l of [...feed.listeners]) l.onOpen();
      const decoder = new TextDecoder();
      let buffer = "";
      const reader = feed.reader;
      let idle: ReturnType<typeof setTimeout> | undefined;
      const watchdog = () => {
        clearTimeout(idle);
        idle = setTimeout(() => void reader.cancel().catch(() => {}), IDLE_MS); // ends read(); the retry below reconnects
      };
      watchdog();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          watchdog();
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue; // the retry hint, pings, blank separators
            let event: ChartEvent;
            try { event = JSON.parse(line.slice(6)) as ChartEvent; } catch { continue; }
            for (const l of [...feed.listeners]) l.onEvent(event);
          }
        }
      } finally { clearTimeout(idle); }
    } catch { /* unreachable, refused or dropped: retried below */ }
    feed.reader = null;
    if (live()) await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
  }
  void feed.reader?.cancel().catch(() => {});
}

/**
 * Keep `load` current with the feed (step 3b): run it now, on every
 * (re)connect and on every event of `kind`, one run at a time -- a burst of
 * events while one runs costs one more run, not one each. `load` reports its
 * own failures; a rejection here is swallowed. Returns the stop.
 */
export function followFeed(f: ChartsFetch, kind: string, load: () => Promise<void>): () => void {
  let stopped = false;
  let running = false;
  let again = false;
  const run = async () => {
    if (running) { again = true; return; }
    running = true;
    try {
      do { again = false; await load().catch(() => {}); } while (again && !stopped);
    } finally { running = false; }
  };
  const stop = watchCharts(f, { onOpen: () => void run(), onEvent: (event) => { if (event.kind === kind) void run(); } });
  void run();
  return () => { stopped = true; stop(); };
}

/** One inbox item (step 3a, server/arts_charts/inbox.py). `title` and `body` are Rita's or the worker's text: untrusted. */
export type InboxItem = {
  id: string;
  kind: "watch" | "schedule" | "system";
  created_at: string;
  title: string;
  body: string;
  chart_ids: string[];
  snapshots: { chart_id: string; url: string }[];
  read_at: string | null;
};

/** One page of the inbox, newest first. `unread` counts the WHOLE table; `next` is the opaque `before` of the following page, null on the last. */
export type InboxPage = { items: InboxItem[]; unread: number; next: string | null };

/** `GET /inbox?limit=<1..200>&before=<cursor>`. The cursor is the server's: pass `next` back unchanged, never parse it. */
export const listInbox = async (f: ChartsFetch, page: { limit?: number; before?: string } = {}): Promise<InboxPage> => {
  const q = new URLSearchParams();
  if (page.limit !== undefined) q.set("limit", String(page.limit));
  if (page.before !== undefined) q.set("before", page.before);
  return json(await f(q.size === 0 ? "/inbox" : `/inbox?${q}`));
};

/** `GET /inbox/<id>`: one item wherever it sits in the list (a link's, C-3); a 404 is a ChartServerError with status 404. */
export const getInboxItem = async (f: ChartsFetch, id: string): Promise<InboxItem> =>
  json(await f(`/inbox/${encodeURIComponent(id)}`));

export const markInboxRead = async (f: ChartsFetch, id: string): Promise<InboxItem> =>
  json(await f(`/inbox/${encodeURIComponent(id)}/read`, { method: "POST" }));

export async function deleteInboxItem(f: ChartsFetch, id: string): Promise<void> {
  const response = await f(`/inbox/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw await refusal(response);
}

/**
 * A snapshot PNG as a `data:` URL -- an `<img src>` cannot carry the host's
 * credentials, so the bytes come through `chartsFetch` -- or null once the
 * server no longer keeps it (the 30-day purge). `url` is
 * server-relative: an inbox item's own (`/inbox/<id>/snapshots/<n>.png`) or a
 * kept chat snapshot's (`/charts/<id>/snapshots/<snapshot>.png`, built by
 * ArtsChartsSnapshot).
 */
export async function snapshotDataUrl(f: ChartsFetch, url: string): Promise<string | null> {
  const response = await f(url);
  if (response.status === 404) return null;
  if (!response.ok) throw await refusal(response);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(binary)}`;
}

/** A watch as `GET /watches` serves it (server/arts_charts/watches.py), the fields the card reads. */
export type Watch = { id: string; chart_id: string; condition: string; enabled: boolean; muted_until: string | null; state: string };

export const listWatches = async (f: ChartsFetch, chartId: string): Promise<Watch[]> =>
  (await json<{ watches: Watch[] }>(await f(`/watches?chart_id=${encodeURIComponent(chartId)}`))).watches;

/**
 * `GET /series`: the chart server's composed bars (live composed bars §1), the
 * envelope the backend's own `/series` sends -- `{symbol, interval, start, end,
 * bars, cache}` -- with `cache.live` and `cache.forming`. Empty values are left
 * out, as fetchWidgetPath leaves them out: no provider means the server's default.
 */
export async function getSeries(f: ChartsFetch, query: Record<string, string>): Promise<unknown> {
  const q = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== ""));
  return json(await f(`/series?${q}`));
}

/** The query parameters `/ta_series_ws` reads (server/arts_charts/router.py). */
const STUDY_SOCKET_KEYS = ["symbol", "interval", "source", "macro", "indicators", "anchor", "start", "end", "provider", "basis", "session", "warmup"];

/**
 * A live card's study socket on the chart server: `base` (the host's
 * `chartsSocketUrl("/ta_series_ws")`) with the card's study parameters that
 * the route reads. Empty values are left out, so no provider means the
 * server's default; card-only parameters (`chart_id`, `live`) never go.
 */
export function studySocketUrl(base: string, params: Record<string, string>): string {
  const url = new URL(base);
  for (const key of STUDY_SOCKET_KEYS) {
    const value = params[key];
    if (value !== undefined && value !== "") url.searchParams.set(key, value);
  }
  return url.toString();
}
