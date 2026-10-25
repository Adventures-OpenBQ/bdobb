// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useMemo, useRef, useState } from "react";
import { fetch } from "@tauri-apps/plugin-http";
import { logError } from "../lib/logger";
import { useReconnectingSocket, type SocketConnection } from "./useReconnectingSocket";
import {
  RECONNECT_MS,
  canonicalFeedUrl,
  mergeArticles,
  parseArticle,
  parseFeedRecords,
  seedUrl,
  wireUrl,
  type NewsArticle,
  type NewsFeedRecord,
} from "../lib/news";
import type { NewsFeed } from "../lib/types";

export type WireStatus = "idle" | "connecting" | "live" | "error";

/** An article joined to the widget's own feed and the server's record for it. */
export type NewsRow = { article: NewsArticle; feed: NewsFeed; record: NewsFeedRecord };

type Subscription = Map<number, { feed: NewsFeed; record: NewsFeedRecord }>;

/** Seed pages in flight at once per connection; half the gateway's maxConcurrent of 8. */
const SEED_CONCURRENCY = 4;
/** The most feeds one subscribe frame may name (web/policy.mjs newsSubscription). */
const MAX_SUBSCRIBE = 50;
/** Web build only: the shortest hide after which a return to the tab reconnects. */
const FOREGROUND_RECONNECT_WEB_MS = 60_000;
/**
 * While a subscribed feed's favicon is still null, re-ask for the records
 * after each of these delays (ms), then stop. rss-ticker fetches an icon only
 * after it first sees a feed, so a first reply often carries null; the only
 * way to ask again that both doors pass is a fresh connection's subscribe (a
 * second frame on an open socket closes it -- web/server.mjs, funnel-gateway).
 * A feed with no usable icon (over the 16 KiB cap) costs these three and no more.
 */
const ICON_RETRY_MS = [10_000, 30_000, 90_000];

/**
 * One widget, one socket (spec, "Wire contract"). Connect, send the feed
 * list as the first frame, map the reply to feed ids, seed over REST, then
 * stream; any close or error retries the whole sequence after RECONNECT_MS.
 * Rows survive a reconnect — mergeArticles dedups the overlap.
 *
 * The loop is the shared useReconnectingSocket in its "reconnect" mode (v8
 * port, user ruling): the wire takes ONE subscribe frame per connection --
 * the gateway closes a socket that sends a second (openbb-docker
 * funnel-gateway, server.mjs) -- so a changed feed list, a Refresh and a
 * return to the foreground each open a new connection; each connection's
 * REST seed runs against that connection's handle and is dropped once it
 * goes stale; and a malformed subscribe reply fails the connection, which
 * retries.
 */
export function useNewsWire({
  base,
  feeds,
  refreshKey,
}: {
  base: string;
  feeds: NewsFeed[];
  refreshKey: number;
}): { status: WireStatus; rows: NewsRow[] } {
  const [phase, setPhase] = useState<Exclude<WireStatus, "idle">>("connecting");
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [subscription, setSubscription] = useState<Subscription>(() => new Map());
  // The ids the current connection subscribed, by feed id, filled from its
  // reply; a fresh map on every connection.
  const subscribed = useRef<{ conn: SocketConnection | null; ids: Subscription }>({ conn: null, ids: new Map() });
  // Every record a reply has carried, by canonical URL: a later reply's null
  // title or favicon never wipes one an earlier reply had.
  const known = useRef(new Map<string, NewsFeedRecord>());
  // The favicon re-ask: a counter that joins reconnectKey, the attempts spent
  // for the current feed list and Refresh, and the pending timer.
  const [iconRetry, setIconRetry] = useState(0);
  const iconAttempts = useRef({ key: "", spent: 0 });
  const iconTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearIconTimer = () => {
    if (iconTimer.current !== null) clearTimeout(iconTimer.current);
    iconTimer.current = null;
  };
  useEffect(() => clearIconTimer, []);

  const wire = wireUrl(base);
  const url = wire === null || feeds.length === 0 ? null : wire;
  // One entry per URL, at most 50: the web door and the gateway refuse the
  // WHOLE frame otherwise (web/policy.mjs newsSubscription), and the card would
  // sit blank, retrying. A second entry for a URL adds nothing: the reply is
  // joined back to the feeds by URL below, not by position.
  const frame = {
    subscribe: feeds
      .filter((f, i) => feeds.findIndex((g) => g.url === f.url) === i)
      .slice(0, MAX_SUBSCRIBE)
      .map((f) => (f.name.trim() === "" ? { url: f.url } : { url: f.url, name: f.name })),
  };
  // The connection is renewed when the LIST changes, not when the array
  // identity does (WidgetCard hands a fresh `?? []` on every render), and on
  // every Refresh. The whole list counts, tabs included: the reply joins each
  // record to its feed, and a row's tab comes from that join.
  const listKey = `${refreshKey}\u0000${JSON.stringify(feeds)}`;
  const reconnectKey = `${listKey}\u0000${iconRetry}`;

  /** After a reply: re-ask on a fresh connection while any favicon is missing, at most ICON_RETRY_MS.length times. */
  const scheduleIconRetry = (conn: SocketConnection, ids: Subscription) => {
    if (iconAttempts.current.key !== listKey) iconAttempts.current = { key: listKey, spent: 0 };
    const delay = ICON_RETRY_MS[iconAttempts.current.spent];
    if (delay === undefined || ![...ids.values()].some((s) => s.record.favicon === null)) return;
    const fire = () => {
      iconTimer.current = null;
      if (conn.stale()) return;
      // Hidden: wait, unspent -- the return to the foreground may reconnect anyway.
      if (document.hidden) {
        iconTimer.current = setTimeout(fire, delay);
        return;
      }
      iconAttempts.current.spent += 1;
      setIconRetry((n) => n + 1);
    };
    iconTimer.current = setTimeout(fire, delay);
  };

  /** One feed's first page; null when it failed (logged, not thrown). */
  const seedOne = async (feedId: number): Promise<NewsArticle[] | null> => {
    try {
      const res = await fetch(seedUrl(base, feedId), { method: "GET" });
      if (!res.ok) return null;
      const body: unknown = await res.json();
      const rows = (body as { articles?: unknown[] }).articles;
      return (Array.isArray(rows) ? rows : [])
        .map(parseArticle)
        .filter((a): a is NewsArticle => a !== null && a.feed_id === feedId);
    } catch (err) {
      await logError(`news seed failed for feed ${feedId}: ${err}`);
      return null;
    }
  };

  /**
   * The per-connection REST seed: every subscribed feed, one page each -- a
   * pool-wide page would be all wires and a quiet feed's tab would sit
   * empty. At most SEED_CONCURRENCY pages are in flight at once: the web
   * preview's gateway answers 429 past 8 concurrent requests per client
   * (funnel-gateway maxConcurrent), so seeding 13 feeds all at once lost
   * five of them on every reconnect. The rows that did arrive are shown
   * even when one feed's page failed; that failure shows as `error` (the
   * socket stays open and streams). A seed whose connection went stale
   * meanwhile stops asking and is dropped.
   */
  const seed = async (conn: SocketConnection, ids: Subscription) => {
    const feedIds = Array.from(ids.keys());
    const pages: (NewsArticle[] | null)[] = [];
    let next = 0;
    const worker = async () => {
      while (next < feedIds.length && !conn.stale()) {
        const i = next++;
        pages[i] = await seedOne(feedIds[i]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(SEED_CONCURRENCY, feedIds.length) }, worker));
    if (conn.stale()) return;
    const parsed = pages.flatMap((p) => p ?? []).filter((a) => ids.has(a.feed_id));
    setArticles((current) => mergeArticles(current, parsed));
    setPhase(pages.some((p) => p === null) ? "error" : "live");
  };

  const onMessage = (frame: unknown) => {
    // Messages arrive only from the current connection (the hook drops a
    // stale socket's), and onConnect recorded it.
    const { conn } = subscribed.current;
    if (conn === null) return;
    const records = parseFeedRecords(frame);
    if (records !== null) {
      const byUrl = new Map(records.map((r) => [canonicalFeedUrl(r.url), r]));
      const next: Subscription = new Map();
      for (const [key, r] of byUrl) {
        const prev = known.current.get(key);
        known.current.set(key, { ...r, title: r.title ?? prev?.title ?? null, favicon: r.favicon ?? prev?.favicon ?? null });
      }
      for (const feed of feeds) {
        const key = canonicalFeedUrl(feed.url);
        const record = byUrl.has(key) ? known.current.get(key) : undefined;
        if (record !== undefined) next.set(record.id, { feed, record });
      }
      subscribed.current = { conn, ids: next };
      setSubscription(next);
      void seed(conn, next);
      scheduleIconRetry(conn, next);
      return;
    }
    // A frame carrying `feeds` IS the subscribe reply (spec §3); an invalid
    // one is a protocol error, not "not a reply yet" — without this the
    // widget sits on "connecting" forever instead of retrying.
    if (typeof frame === "object" && frame !== null && "feeds" in frame) {
      conn.fail();
      return;
    }
    const article = parseArticle(frame);
    if (article !== null && subscribed.current.ids.has(article.feed_id)) {
      setArticles((current) => mergeArticles(current, [article]));
    }
  };

  useReconnectingSocket(url, frame, onMessage, {
    mode: "reconnect",
    reconnectKey,
    // Feed records (title, favicon) arrive only in the subscribe reply, and
    // the subscribe is sent only when a socket opens. On iOS the webview is
    // suspended with the app; after a resume the socket can sit OPEN with
    // nothing live behind it, so no close ever fires, nothing reconnects, and
    // the records stay whatever the last reply carried (seen 2026-09-19: an
    // iPad with headlines but no favicons until the app was relaunched). A
    // return to the foreground therefore forces a fresh connection, which
    // re-sends the subscribe; the rows survive it (mergeArticles dedups).
    reconnectOnForeground: true,
    // The web preview (vite mode "browser") is a browser tab, not a suspended
    // webview: a tab switch leaves the socket alive, and every reconnect
    // costs a fresh socket ticket (a Vercel invocation), a gateway upgrade
    // and a seed page per feed. There, only a hide of over a minute (or a
    // socket that is not open) reconnects; the native app keeps 0, every return.
    foregroundMinHiddenMs: import.meta.env.MODE === "browser" ? FOREGROUND_RECONNECT_WEB_MS : 0,
    retryMs: RECONNECT_MS,
    onConnect: (conn) => {
      clearIconTimer();
      subscribed.current = { conn, ids: new Map() };
      setPhase("connecting");
    },
    onDrop: () => setPhase("error"),
  });

  const rows = useMemo<NewsRow[]>(() => {
    const out: NewsRow[] = [];
    for (const article of articles) {
      const sub = subscription.get(article.feed_id);
      if (sub !== undefined) out.push({ article, feed: sub.feed, record: sub.record });
    }
    return out;
  }, [articles, subscription]);

  return { status: url === null ? "idle" : phase, rows };
}
