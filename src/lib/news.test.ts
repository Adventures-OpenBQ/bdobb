// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it } from "vitest";
import {
  ALL_TAB,
  canonicalFeedUrl,
  defaultNewsBase,
  headline,
  iconUrl,
  isHighlighted,
  mergeArticles,
  moveTab,
  parseArticle,
  parseFeedRecords,
  rowTime,
  seedUrl,
  splitKeywords,
  tabsOf,
  trimBase,
  wireUrl,
  type NewsArticle,
  daysAgo,
  decodeEntities,
  isVideo,
} from "./news";

const article = (over: Partial<NewsArticle> = {}): NewsArticle => ({
  id: 1,
  feed_id: 7,
  title: "Rates hold steady",
  link: "https://wire.example/1",
  author: null,
  published_at: 1_756_800_000,
  sort_at: 1_756_800_000,
  ...over,
});

describe("URLs", () => {
  it("derives the websocket URL from an http or https base, with or without a trailing slash", () => {
    expect(wireUrl("https://ticker.tail.ts.net")).toBe("wss://ticker.tail.ts.net/ws/news");
    expect(wireUrl("http://127.0.0.1:8088/")).toBe("ws://127.0.0.1:8088/ws/news");
    expect(wireUrl("ftp://x")).toBeNull();
    expect(wireUrl("not a url")).toBeNull();
  });

  it.each([
    ["https://gateway.example/news", "wss://gateway.example/news/ws/news"],
    ["https://gateway.example/news/", "wss://gateway.example/news/ws/news"],
    ["  https://gateway.example/news///  ", "wss://gateway.example/news/ws/news"],
    ["http://127.0.0.1:8088/services/news", "ws://127.0.0.1:8088/services/news/ws/news"],
    ["https://gateway.example/News%20Wire/", "wss://gateway.example/News%20Wire/ws/news"],
  ])("preserves the gateway prefix in %s", (base, expected) => {
    expect(wireUrl(base)).toBe(expected);
    // REST and WS must address the same service under a path-routed gateway.
    const rest = new URL(seedUrl(base, 7));
    expect(rest.pathname.replace(/\/api\/news$/, "/ws/news")).toBe(new URL(expected).pathname);
  });

  it("strips query and fragment without losing the websocket path prefix", () => {
    expect(wireUrl("https://gateway.example/news/?ignored=1#section")).toBe(
      "wss://gateway.example/news/ws/news",
    );
  });

  it("trims the base and strips trailing slashes, and builds the seed URL from it", () => {
    expect(trimBase("  https://t.example//  ")).toBe("https://t.example");
    expect(seedUrl("https://t.example", 7)).toBe("https://t.example/api/news?limit=50&feed_id=7");
  });

  it("canonicalises a feed URL by scheme and host case and a trailing slash, nothing more", () => {
    expect(canonicalFeedUrl("HTTPS://Feeds.Bloomberg.com/markets/news.rss/")).toBe(
      "https://feeds.bloomberg.com/markets/news.rss",
    );
    // The path keeps its case, and a query string is untouched.
    expect(canonicalFeedUrl("https://x.example/Feed?A=1")).toBe("https://x.example/Feed?A=1");
    // Unparseable input comes back trimmed, so two typos still match each other.
    expect(canonicalFeedUrl(" nope ")).toBe("nope");
  });
});

describe("frames", () => {
  it("accepts an article with the fields the wire promises and rejects anything else", () => {
    const raw = { ...article(), summary: "ignored", cursor: "x", highlighted: true };
    expect(parseArticle(raw)).toEqual(article());
    expect(parseArticle({ ...raw, id: "1" })).toBeNull();
    expect(parseArticle({ ...raw, title: 3 })).toBeNull();
    expect(parseArticle({ ...raw, sort_at: null })).toBeNull();
    expect(parseArticle(null)).toBeNull();
    expect(parseArticle("[]")).toBeNull();
  });

  it("tolerates a missing author and a null link", () => {
    const { author: _a, ...noAuthor } = article({ link: null });
    expect(parseArticle(noAuthor)).toEqual(article({ link: null, author: null }));
  });

  it("recognises the subscribe reply by its feeds key and validates every record", () => {
    const reply = {
      feeds: [
        { id: 7, url: "https://a.example/feed", title: "A", favicon: "data:image/png;base64,AA==" },
        { id: 8, url: "https://b.example/feed", title: null, favicon: null },
      ],
    };
    expect(parseFeedRecords(reply)).toEqual(reply.feeds);
    expect(parseFeedRecords({ feeds: [{ id: "7", url: "x" }] })).toBeNull();
    expect(parseFeedRecords(article())).toBeNull();
    expect(parseFeedRecords({ feeds: "no" })).toBeNull();
  });
});

describe("mergeArticles", () => {
  it("orders newest first by sort_at then id, dedups by id, and caps at 300", () => {
    const merged = mergeArticles(
      [article({ id: 1, sort_at: 100 }), article({ id: 2, sort_at: 200 })],
      [article({ id: 2, sort_at: 200, title: "updated" }), article({ id: 3, sort_at: 200 }), article({ id: 4, sort_at: 50 })],
    );
    expect(merged.map((a) => a.id)).toEqual([3, 2, 1, 4]);
    // The incoming copy of a duplicate wins.
    expect(merged[1].title).toBe("updated");

    const many = Array.from({ length: 320 }, (_, i) => article({ id: i + 1, sort_at: i }));
    const capped = mergeArticles([], many);
    expect(capped).toHaveLength(300);
    expect(capped[0].id).toBe(320);
    expect(capped.at(-1)!.id).toBe(21);
  });
});

describe("tabsOf", () => {
  it("puts All first, then distinct non-empty tabs in first-use order", () => {
    expect(
      tabsOf([
        { url: "a", name: "", tab: "Wires" },
        { url: "b", name: "", tab: "" },
        { url: "c", name: "", tab: "Substack" },
        { url: "d", name: "", tab: "Wires" },
      ]),
    ).toEqual([ALL_TAB, "Wires", "Substack"]);
    expect(tabsOf([])).toEqual([ALL_TAB]);
  });
});

describe("highlight and byline", () => {
  it("splits comma-separated keywords, trimming and dropping blanks", () => {
    expect(splitKeywords(" fed , ,Rates,")).toEqual(["fed", "Rates"]);
    expect(splitKeywords("")).toEqual([]);
  });

  it("matches a title case-insensitively and ignores empty keywords", () => {
    expect(isHighlighted("Fed holds rates", ["RATES"])).toBe(true);
    expect(isHighlighted("Fed holds rates", ["", "gold"])).toBe(false);
    expect(isHighlighted("Fed holds rates", [])).toBe(false);
  });

  it("appends the author only when present, non-blank and not already in the title", () => {
    expect(headline({ title: "On rates", author: "Jane Doe" })).toBe("On rates - Jane Doe");
    // A video clip is told by its link's path, never by its title.
    expect(isVideo({ link: "https://www.bloomberg.com/news/videos/2026-09-04/toyota-s-sato-video" })).toBe(true);
    expect(isVideo({ link: "https://example.com/video/123" })).toBe(true);
    expect(isVideo({ link: "https://www.bloomberg.com/news/articles/2026-09-04/videogames-rally" })).toBe(false);
    expect(isVideo({ link: "https://example.com/story?ref=videos" })).toBe(false);
    expect(isVideo({ link: null })).toBe(false);
    expect(isVideo({ link: "not a url" })).toBe(false);
    // A twice-escaped title (PR Newswire) decodes once; text without an
    // ampersand is untouched, and markup is text, never elements.
    expect(headline({ title: "Unlocking Ancient &amp; Modern &#39;Tech&#39; of Jinci Temple", author: null })).toBe(
      "Unlocking Ancient & Modern 'Tech' of Jinci Temple",
    );
    expect(decodeEntities("A &lt;b&gt; tag &quot;quoted&quot;")).toBe('A <b> tag "quoted"');
    expect(decodeEntities("plain")).toBe("plain");
    expect(headline({ title: "On rates", author: "  " })).toBe("On rates");
    expect(headline({ title: "On rates", author: null })).toBe("On rates");
    expect(headline({ title: "On rates - Jane Doe", author: "Jane Doe" })).toBe("On rates - Jane Doe");
    // Google News appends the publisher's domain; a dash inside a title stays.
    expect(headline({ title: "Fed holds rates - reuters.com", author: null })).toBe("Fed holds rates");
    expect(headline({ title: "Fed holds - again - www.reuters.com", author: "Jane Doe" })).toBe("Fed holds - again - Jane Doe");
    expect(headline({ title: "Stocks up 2% - but bonds fall", author: null })).toBe("Stocks up 2% - but bonds fall");
  });
});

describe("daysAgo", () => {
  it("counts local calendar days before now, never negative", () => {
    const now = new Date(2026, 8, 5, 9, 0); // 5 Sep 2026, 09:00 local
    const at = (d: Date) => d.getTime() / 1000;
    expect(daysAgo({ sort_at: at(new Date(2026, 8, 5, 0, 30)), published_at: null }, now)).toBe(0);
    expect(daysAgo({ sort_at: at(new Date(2026, 8, 4, 23, 59)), published_at: null }, now)).toBe(1);
    expect(daysAgo({ sort_at: at(new Date(2026, 8, 2, 12, 0)), published_at: null }, now)).toBe(3);
    expect(daysAgo({ sort_at: at(new Date(2026, 8, 6, 1, 0)), published_at: null }, now)).toBe(0);
    expect(daysAgo({ sort_at: 0, published_at: at(new Date(2026, 8, 4, 8, 0)) }, now)).toBe(1);
  });
});

describe("rowTime", () => {
  it("formats sort_at as HH:MM in the local zone, falling back to published_at", () => {
    const at = Date.UTC(2026, 8, 3, 13, 5) / 1000;
    const expected = new Date(at * 1000).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    expect(rowTime({ sort_at: at, published_at: null })).toBe(expected);
    expect(rowTime({ sort_at: 0, published_at: at })).toBe(expected);
  });
});

describe("iconUrl", () => {
  it("admits a data:image URI and an http(s) URL, and nothing else", () => {
    expect(iconUrl("data:image/png;base64,AA==")).toBe("data:image/png;base64,AA==");
    expect(iconUrl("https://a.example/favicon.ico")).toBe("https://a.example/favicon.ico");
    expect(iconUrl("data:text/html,<script>")).toBeNull();
    expect(iconUrl("javascript:alert(1)")).toBeNull();
    expect(iconUrl(null)).toBeNull();
  });
});

describe("tab order", () => {
  const feeds = [
    { url: "a", name: "", tab: "Wires" },
    { url: "b", name: "", tab: "Substack" },
    { url: "c", name: "", tab: "Seeking Alpha" },
  ];

  it("puts the saved order after All, then the rest in first-use order, ignoring stale names", () => {
    expect(tabsOf(feeds, ["Seeking Alpha", "Gone", "All"])).toEqual([ALL_TAB, "Seeking Alpha", "Wires", "Substack"]);
    expect(tabsOf(feeds)).toEqual([ALL_TAB, "Wires", "Substack", "Seeking Alpha"]);
  });

  it("drops a tab after the target when moving right and before it when moving left", () => {
    const tabs = [ALL_TAB, "Wires", "Substack", "Seeking Alpha"];
    expect(moveTab(tabs, "Wires", "Seeking Alpha")).toEqual(["Substack", "Seeking Alpha", "Wires"]);
    expect(moveTab(tabs, "Seeking Alpha", "Wires")).toEqual(["Seeking Alpha", "Wires", "Substack"]);
  });

  it("refuses All as either end, an unknown tab, and a no-op drop", () => {
    const tabs = [ALL_TAB, "Wires", "Substack"];
    expect(moveTab(tabs, ALL_TAB, "Wires")).toBeNull();
    expect(moveTab(tabs, "Wires", ALL_TAB)).toBeNull();
    expect(moveTab(tabs, "Nope", "Wires")).toBeNull();
    expect(moveTab(tabs, "Wires", "Wires")).toBeNull();
  });
});

describe("defaultNewsBase (web preview)", () => {
  // The preview seeds its News card with no server, for the page has exactly one it
  // can reach -- its own /news relay -- and the preview's bootstrap names it. On the
  // desktop there is no such server and an empty card asks for one.
  afterEach(() => {
    delete window.__bdobbNewsServer;
  });
  it("is empty everywhere but the web preview", () => {
    expect(defaultNewsBase()).toBe("");
  });
  it("is the server the preview's bootstrap named, and reaches the gateway's two news routes", () => {
    window.__bdobbNewsServer = "https://preview.example.com/news";
    expect(defaultNewsBase()).toBe("https://preview.example.com/news");
    // The wire is the one socket target the gateway tickets; the seed is its approved-id
    // history route with a limit inside 1..50 (web/policy.mjs upstreamPath).
    expect(wireUrl(defaultNewsBase())).toBe("wss://preview.example.com/news/ws/news");
    expect(seedUrl(defaultNewsBase(), 7)).toBe("https://preview.example.com/news/api/news?limit=50&feed_id=7");
  });
});
