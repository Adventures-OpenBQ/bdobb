// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from "react";
import { fetch } from "@tauri-apps/plugin-http";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useMinuteTick } from "../../hooks/useMinuteTick";
import { RSS_DEFAULT_LIMIT } from "../../lib/builtins";
import { FeedError, parseFeed, relativeTime, type FeedItem } from "../../lib/feed";
import { safeUrl } from "../../lib/safeUrl";
import { ErrorState } from "./ErrorState";

type Props = {
  /** The card's `url` param, verbatim. Empty until the user types one. */
  url: string;
  /** The card's `limit` param: how many headlines to show. */
  limit: number;
  /**
   * Bumped by the card's Refresh button and by ⌘R (WidgetCard passes
   * `attempt + refreshEpoch`). This type fetches nothing through
   * useWidgetData — it is a built-in, so fetchesData is false — so this is
   * the only way a manual refresh can reach it.
   */
  refreshKey: number;
  /**
   * The card's RESOLVED auto-refresh interval, in milliseconds, or undefined
   * for "do not poll". WidgetCard computes it with the same
   * refreshIntervalMs() every backend card uses, so the user's auto-refresh
   * setting governs this widget exactly as it governs the others.
   */
  intervalMs?: number;
};

/**
 * What this app can read, in preference order. Some feed hosts content-
 * negotiate on it, and some answer 406 without it.
 */
const ACCEPT = "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9";

/**
 * Bounds only the connect phase (DNS + TCP/TLS handshake) — a host that
 * accepts the connection and then stalls mid-response is not caught by this
 * timeout. Longer than dataClient's 10 s: a public feed is not a LAN backend.
 */
const CONNECT_TIMEOUT_MS = 30_000;

/**
 * A host that accepts the connection and then trickles or floods bytes has no
 * timeout to catch it (see CONNECT_TIMEOUT_MS above) — this caps the feed
 * instead. Measured on the DECODED body, which is the one number that is
 * always true: a `content-length` precheck stood here once and enforced
 * nothing, because a header that is absent, wrong or chunked-away lets any
 * size through, and `res.text()` had already read the whole response by the
 * time the cap could have mattered. Checked here, an oversized feed is never
 * parsed and never rendered, whatever the host claimed.
 */
const MAX_FEED_CHARS = 5 * 1024 * 1024;

/**
 * Deliberately fixed strings, not the underlying error's message.
 *
 * A feed URL is typed by the user and routinely carries a token in its query
 * string (many services publish personal feeds that way). tauri-plugin-http
 * wraps reqwest, whose error Display appends the full request URL — so
 * rendering that message would print the user's token into the card, and
 * logging it would write it to disk. Neither is worth the extra detail: the
 * status line and these two sentences already say which of the two things
 * went wrong.
 */
const UNREACHABLE = "Could not reach the feed.";
const NOT_A_FEED = "Not an RSS or Atom feed";
const TOO_LARGE = "Feed is too large to show.";

/**
 * A finite integer of at least 1, falling back to the built-in's own default
 * param value for NaN, Infinity, zero or negative values; a fractional value
 * is truncated. A persisted card can carry any string in `limit` (or none at
 * all), and `Number()` on `""`/garbage produces `NaN` -- `items.slice(0, NaN)`
 * silently slices to zero, rendering a blank card instead of an error.
 */
function sanitizeLimit(limit: number): number {
  return Number.isFinite(limit) && limit >= 1 ? Math.trunc(limit) : RSS_DEFAULT_LIMIT;
}

/** `source · 3 hours ago`, with whichever halves the item actually has. */
function meta(item: FeedItem, now: number): string {
  const when = item.date === undefined ? "—" : relativeTime(item.date, now);
  return item.source ? `${item.source} · ${when}` : when;
}

/**
 * Headlines from any RSS 2.0 or Atom feed. Owns its own request: this is a
 * built-in, so fetchesData is false and the card issues none.
 *
 * Nothing the feed carries is ever rendered as markup. `parseFeed` hands back
 * plain text and http/https links only, and this component puts the text in a
 * text node and the link nowhere but `openUrl` — no innerHTML, no href, no
 * dangerouslySetInnerHTML anywhere in this file.
 */
export function RssRenderer({ url, limit, refreshKey, intervalMs }: Props) {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by Retry and by the interval timer, to re-run the effect. */
  const [attempt, setAttempt] = useState(0);
  // Ticks once a minute so "n min ago" keeps advancing even when auto-refresh
  // is off and nothing else re-renders this card.
  const now = useMinuteTick();

  const typed = url.trim();
  // The address is handed to the HTTP client, so it passes the app's own
  // boundary first: `file:` and `data:` are refused here rather than relying
  // on the Tauri capability scope, which the browser-mode shim does not have.
  const feedUrl = safeUrl(typed);

  useEffect(() => {
    if (feedUrl === null) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    void (async () => {
      try {
        const res = await fetch(feedUrl, {
          method: "GET",
          headers: { Accept: ACCEPT },
          connectTimeout: CONNECT_TIMEOUT_MS,
        });
        if (cancelled) return;
        if (!res.ok) {
          setItems(null);
          setError(`HTTP ${res.status}`);
          return;
        }
        const body = await res.text();
        if (cancelled) return;
        if (body.length > MAX_FEED_CHARS) {
          setItems(null);
          setError(TOO_LARGE);
          return;
        }
        setItems(parseFeed(body));
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setItems(null);
        setError(err instanceof FeedError ? NOT_A_FEED : UNREACHABLE);
      } finally {
        // Armed only once the request has FINISHED, success or failure, so
        // this card can never have two of its own requests in flight.
        if (!cancelled && intervalMs !== undefined) {
          timer = setTimeout(() => setAttempt((n) => n + 1), intervalMs);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
    // Not `limit`: it only slices what is already loaded (below), so an edit
    // to it re-renders and must not ask the feed host again.
  }, [feedUrl, refreshKey, attempt, intervalMs]);

  if (!typed) return <p className="empty-state">Enter a feed URL above.</p>;
  if (feedUrl === null) return <p className="empty-state">Enter an http or https feed URL.</p>;
  if (error !== null) {
    return <ErrorState message={error} onRetry={() => setAttempt((n) => n + 1)} />;
  }
  if (items === null) return <p className="empty-state">Loading…</p>;
  if (items.length === 0) return <p className="empty-state">No headlines in this feed.</p>;

  // The same instant for every row on screen, and re-read once a minute (via
  // useMinuteTick above) so a relative time keeps advancing while this card
  // sits idle.
  const nowMs = now.getTime();
  return (
    <ul className="rss-list">
      {items.slice(0, sanitizeLimit(limit)).map((item, i) => (
        <li key={`${i}:${item.link ?? item.title}`}>
          <button
            type="button"
            className="rss-item"
            // An item the feed gave no usable link for has nothing to open.
            // Disabled rather than silently doing nothing on click, and out
            // of the tab order for the same reason.
            disabled={item.link === undefined}
            onClick={() => {
              if (item.link !== undefined) void openUrl(item.link);
            }}
          >
            <span className="rss-title">{item.title}</span>
            <span className="rss-meta">{meta(item, nowMs)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
