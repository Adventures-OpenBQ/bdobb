// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { safeUrl } from "./safeUrl";
import type { NewsFeed } from "./types";

/** The tab that is always present and always first: every subscribed feed. */
export const ALL_TAB = "All";
/**
 * What a News card reads when it has no title of its own: its vertical strip
 * on the dashboard. The widget is "News" in the library; on the dashboard it
 * is a rail.
 */
export const NEWS_RAIL_TITLE = "RSS Aggregator";
/** Rows kept in memory per widget; deeper history is the server's. */
const NEWS_CAP = 300;
/** Retry after any close or error. There is no terminal state. */
export const RECONNECT_MS = 3000;
/**
 * The first page asked for, PER FEED, after every (re)connect. Per feed and
 * not pool-wide: a pool-wide "newest 100" is all wires, and a newsletter
 * that posts weekly would never make the page at all.
 */
const SEED_LIMIT = 50;

/**
 * One article as the wire promises it (spec, "Wire contract" 5). `sort_at`
 * and `published_at` are epoch SECONDS. `author` is the contract addition the
 * server cycle implements; until then it is absent and reads as null.
 */
export type NewsArticle = {
  id: number;
  feed_id: number;
  title: string;
  link: string | null;
  author: string | null;
  published_at: number | null;
  sort_at: number;
};

/** One feed record from the subscribe reply. `favicon` is a data URI or null. */
export type NewsFeedRecord = {
  id: number;
  url: string;
  title: string | null;
  favicon: string | null;
};

export function trimBase(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

/**
 * The server an EMPTY News card uses. "" everywhere but the web preview, whose
 * bootstrap (web/bootstrap.mjs) names the one server that page can reach -- its
 * own /news relay, which the CSP and the gateway's approved feeds bound. On the
 * desktop an empty card still asks for a server.
 */
export function defaultNewsBase(): string {
  return (typeof window !== "undefined" && window.__bdobbNewsServer) || "";
}

/** `http` → `ws`, `https` → `wss`, append `/ws/news` to the base path; null unless http(s). */
export function wireUrl(base: string): string | null {
  const safe = safeUrl(trimBase(base));
  if (safe === null) return null;
  const url = new URL(safe);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  // Preserve a reverse proxy's service prefix, just as seedUrl does for REST.
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/ws/news`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function seedUrl(base: string, feedId: number): string {
  return `${trimBase(base)}/api/news?limit=${SEED_LIMIT}&feed_id=${feedId}`;
}

/**
 * The server's own canonical form, applied locally only to MATCH its reply
 * against the widget's list: scheme and host lowercased, one trailing slash
 * stripped. Nothing cleverer, by design (addendum).
 */
export function canonicalFeedUrl(raw: string): string {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }
  // URL already lowercases scheme and host; only the slash is ours.
  return url.toString().replace(/\/$/, "");
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";

/** A frame or REST row that is an article, or null for anything else. */
export function parseArticle(v: unknown): NewsArticle | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!isInt(o.id) || !isInt(o.feed_id) || typeof o.title !== "string") return null;
  if (!isInt(o.sort_at)) return null;
  const link = o.link ?? null;
  const author = o.author ?? null;
  const published = o.published_at ?? null;
  if (!isStrOrNull(link) || !isStrOrNull(author)) return null;
  if (published !== null && !isInt(published)) return null;
  return {
    id: o.id,
    feed_id: o.feed_id,
    title: o.title,
    link,
    author,
    published_at: published,
    sort_at: o.sort_at,
  };
}

/** The subscribe reply — a frame carrying `feeds` — or null for any other frame. */
export function parseFeedRecords(v: unknown): NewsFeedRecord[] | null {
  if (typeof v !== "object" || v === null || !("feeds" in v)) return null;
  const feeds = (v as { feeds: unknown }).feeds;
  if (!Array.isArray(feeds)) return null;
  const out: NewsFeedRecord[] = [];
  for (const f of feeds) {
    if (typeof f !== "object" || f === null) return null;
    const o = f as Record<string, unknown>;
    const title = o.title ?? null;
    const favicon = o.favicon ?? null;
    if (!isInt(o.id) || typeof o.url !== "string" || !isStrOrNull(title) || !isStrOrNull(favicon)) return null;
    out.push({ id: o.id, url: o.url, title, favicon });
  }
  return out;
}

/** Newest first by (sort_at, id), incoming wins a duplicate id, capped. */
export function mergeArticles(current: NewsArticle[], incoming: NewsArticle[]): NewsArticle[] {
  const byId = new Map<number, NewsArticle>();
  for (const a of current) byId.set(a.id, a);
  for (const a of incoming) byId.set(a.id, a);
  // ponytail: a full re-sort per frame; O(n log n) at n<=300 is nothing.
  return Array.from(byId.values())
    .sort((a, b) => b.sort_at - a.sort_at || b.id - a.id)
    .slice(0, NEWS_CAP);
}

/**
 * All first, then the feeds' distinct tabs: those the user has ordered (by
 * dragging) in that order, then any others in first-use order. A name in
 * `order` that no feed uses any more is skipped, not shown.
 */
export function tabsOf(feeds: NewsFeed[], order: string[] = []): string[] {
  const used: string[] = [];
  for (const f of feeds) {
    const tab = f.tab.trim();
    if (tab !== "" && !used.includes(tab)) used.push(tab);
  }
  const ordered = order.filter((t) => t !== ALL_TAB && used.includes(t));
  return [ALL_TAB, ...ordered, ...used.filter((t) => !ordered.includes(t))];
}

/**
 * The tab list with `dragged` dropped on `target`: moving right lands it
 * after the target, moving left before it — no geometry needed. All is
 * pinned first and cannot move or be a target. Returns the new order WITHOUT
 * All (what NewsCardState.tabOrder stores); unchanged input comes back null.
 */
export function moveTab(tabs: string[], dragged: string, target: string): string[] | null {
  const list = tabs.filter((t) => t !== ALL_TAB);
  const from = list.indexOf(dragged);
  const to = list.indexOf(target);
  if (from < 0 || to < 0 || from === to || dragged === ALL_TAB || target === ALL_TAB) return null;
  const next = list.filter((t) => t !== dragged);
  next.splice(to, 0, dragged);
  return next;
}

export function splitKeywords(text: string): string[] {
  return text
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k !== "");
}

export function isHighlighted(title: string, keywords: string[]): boolean {
  const lower = title.toLowerCase();
  return keywords.some((k) => k !== "" && lower.includes(k.toLowerCase()));
}

/** Google News writes the publisher's domain after the title: "… - reuters.com". */
const SOURCE_SUFFIX = /\s+-\s+[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i;

/**
 * A story that is a video clip, by its link: Bloomberg files them under
 * /news/videos/, and a `video` or `videos` path segment is how most
 * publishers mark one. The row shows a ▶ after the headline for it.
 */
export function isVideo(a: Pick<NewsArticle, "link">): boolean {
  const link = a.link;
  if (link === null) return false;
  try {
    return /(^|\/)videos?(\/|$)/i.test(new URL(link).pathname);
  } catch {
    return false;
  }
}

/**
 * Some publishers escape their titles twice (PR Newswire: `&amp;` inside
 * CDATA), so an entity survives the feed parser and would render literally.
 * One decode fixes it; a title that legitimately contains "&amp;" is not a
 * headline anyone writes. The parser is the browser's own, so every named
 * and numeric entity is covered without a table here.
 */
export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  if (typeof DOMParser === "undefined") return text;
  return new DOMParser().parseFromString(text, "text/html").documentElement.textContent ?? text;
}

export function headline(a: Pick<NewsArticle, "title" | "author">): string {
  const title = decodeEntities(a.title).replace(SOURCE_SUFFIX, "");
  const author = a.author?.trim() ?? "";
  if (author === "" || title.includes(author)) return title;
  return `${title} - ${author}`;
}

const TIME = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

/** HH:MM local, from sort_at (seconds), falling back to published_at. */
export function rowTime(a: Pick<NewsArticle, "sort_at" | "published_at">): string {
  const seconds = a.sort_at || a.published_at || 0;
  return TIME.format(new Date(seconds * 1000));
}

/**
 * How many calendar days (local) before `now` the article is dated: 0 for
 * today, 1 for yesterday. A quiet feed (a Substack that posts weekly) keeps
 * old posts in the rail beside today's wires; the row shows "[-N]" after the
 * time so a reader knows the time is not today's.
 */
export function daysAgo(a: Pick<NewsArticle, "sort_at" | "published_at">, now: Date = new Date()): number {
  const seconds = a.sort_at || a.published_at || 0;
  const then = new Date(seconds * 1000);
  const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.max(0, Math.round((dayOf(now) - dayOf(then)) / 86_400_000));
}

/** A favicon an <img> may be pointed at: a data:image URI or an http(s) URL. */
export function iconUrl(favicon: string | null): string | null {
  if (favicon === null) return null;
  if (/^data:image\//i.test(favicon)) return favicon;
  return safeUrl(favicon);
}
