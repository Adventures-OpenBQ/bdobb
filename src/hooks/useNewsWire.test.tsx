// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const httpFetch = vi.fn();
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: (...args: unknown[]) => httpFetch(...args) }));

import type { NewsFeed } from "../lib/types";
import { useNewsWire } from "./useNewsWire";
// The real policy the web door and the gateway apply to the first frame.
// @ts-expect-error -- plain node .mjs with no declaration file.
import { newsSubscription } from "../../web/policy.mjs";

/**
 * The browser's WebSocket as far as the hook uses it: a constructor, send,
 * close, and the four handlers. Three test-only helpers drive the far end.
 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readonly url: string;
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  // Far end.
  open() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  receive(payload: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(payload) }));
  }
  drop() {
    this.readyState = 3;
    this.onclose?.(new Event("close"));
  }
}

const BASE = "https://ticker.example";
const FEEDS: NewsFeed[] = [
  { url: "https://a.example/feed", name: "A", tab: "Wires" },
  { url: "https://b.example/feed/", name: "", tab: "" },
];
const REPLY = {
  feeds: [
    { id: 1, url: "https://a.example/feed", title: "A wire", favicon: null },
    // The server's canonical form: the widget's trailing slash is gone.
    { id: 2, url: "https://b.example/feed", title: "B", favicon: "data:image/png;base64,AA==" },
  ],
};
const seedArticle = (id: number, feed_id: number, title: string, sort_at = id) => ({
  id,
  feed_id,
  title,
  link: null,
  published_at: null,
  sort_at,
});

const last = () => FakeWebSocket.instances.at(-1)!;

/** A promise this test resolves by hand, to control seed ordering across cycles. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const seedReply = (articles: unknown[]) => ({
  ok: true,
  status: 200,
  json: async () => ({ articles, next_cursor: null }),
});

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  httpFetch.mockReset();
  httpFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ articles: [seedArticle(10, 1, "Seeded A"), seedArticle(11, 2, "Seeded B")], next_cursor: null }),
  });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Mounts, opens the socket and answers the subscribe; returns the hook result. */
async function connected(feeds = FEEDS) {
  const hook = renderHook((p: { feeds: NewsFeed[]; refreshKey: number }) => useNewsWire({ base: BASE, ...p }), {
    initialProps: { feeds, refreshKey: 0 },
  });
  await act(async () => {
    last().open();
    last().receive(REPLY);
  });
  return hook;
}

describe("useNewsWire", () => {
  it("opens no socket and stays idle with no feeds", () => {
    const { result } = renderHook(() => useNewsWire({ base: BASE, feeds: [], refreshKey: 0 }));
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(result.current.status).toBe("idle");
    expect(httpFetch).not.toHaveBeenCalled();
  });

  it("opens no socket for a base that is not http(s)", () => {
    const { result } = renderHook(() => useNewsWire({ base: "ftp://x", feeds: FEEDS, refreshKey: 0 }));
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(result.current.status).toBe("idle");
  });

  it("connects to /ws/news and sends the feed list as the first frame, omitting blank names", () => {
    const { result } = renderHook(() => useNewsWire({ base: BASE, feeds: FEEDS, refreshKey: 0 }));
    expect(result.current.status).toBe("connecting");
    expect(last().url).toBe("wss://ticker.example/ws/news");
    expect(last().sent).toEqual([]);
    act(() => last().open());
    expect(JSON.parse(last().sent[0])).toEqual({
      subscribe: [{ url: "https://a.example/feed", name: "A" }, { url: "https://b.example/feed/" }],
    });
  });

  it("sends each URL once and at most 50, so the web door's policy accepts the frame", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ url: `https://f${i}.example/feed`, name: "", tab: "T" }));
    const feeds = [{ url: many[0].url, name: "Dup", tab: "Other" }, ...many];
    renderHook(() => useNewsWire({ base: BASE, feeds, refreshKey: 0 }));
    act(() => last().open());
    const sent = JSON.parse(last().sent[0]) as { subscribe: { url: string }[] };
    expect(sent.subscribe).toHaveLength(50);
    expect(new Set(sent.subscribe.map((f) => f.url)).size).toBe(50);
    expect(sent.subscribe[0]).toEqual({ url: many[0].url, name: "Dup" });
    const approved = Object.fromEntries(many.map((f, i) => [f.url, i + 1]));
    expect(newsSubscription(last().sent[0], { feeds: approved })).not.toBeNull();
  });

  it("maps the reply to its feeds by canonical URL, then seeds and goes live", async () => {
    const { result } = await connected();
    // One page per subscribed feed, never a pool-wide page.
    expect(httpFetch.mock.calls.map((c) => c[0]).sort()).toEqual([
      "https://ticker.example/api/news?limit=50&feed_id=1",
      "https://ticker.example/api/news?limit=50&feed_id=2",
    ]);
    expect(result.current.status).toBe("live");
    expect(result.current.rows.map((r) => [r.article.title, r.feed.name, r.record.id])).toEqual([
      ["Seeded B", "", 2],
      ["Seeded A", "A", 1],
    ]);
  });

  it("seeds at most 4 feeds at a time, so 12 feeds stay under the gateway's concurrency cap, and seeds all 12", async () => {
    const feeds: NewsFeed[] = Array.from({ length: 12 }, (_, i) => ({ url: `https://f${i + 1}.example/feed`, name: "", tab: "" }));
    const reply = { feeds: feeds.map((f, i) => ({ id: i + 1, url: f.url, title: `F${i + 1}`, favicon: null })) };
    let inFlight = 0;
    let peak = 0;
    const pending: { resolve: () => void }[] = [];
    httpFetch.mockImplementation((url: string) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      const feedId = Number(new URL(url).searchParams.get("feed_id"));
      return new Promise((resolve) => {
        pending.push({
          resolve: () => {
            inFlight -= 1;
            resolve(seedReply([seedArticle(100 + feedId, feedId, `Seeded ${feedId}`)]));
          },
        });
      });
    });
    const { result } = renderHook(() => useNewsWire({ base: BASE, feeds, refreshKey: 0 }));
    await act(async () => {
      last().open();
      last().receive(reply);
    });
    // Resolve whatever is in flight, one round at a time, until all are done.
    while (pending.length > 0) {
      await act(async () => {
        pending.splice(0).forEach((p) => p.resolve());
      });
    }
    expect(peak).toBe(4);
    expect(httpFetch).toHaveBeenCalledTimes(12);
    expect(result.current.rows).toHaveLength(12);
    expect(result.current.status).toBe("live");
  });

  it("streams articles for subscribed feeds and drops the rest", async () => {
    const { result } = await connected();
    act(() => {
      last().receive(seedArticle(20, 1, "Breaking", 100));
      last().receive(seedArticle(21, 99, "Not mine", 101));
      last().receive({ garbage: true });
    });
    expect(result.current.rows.map((r) => r.article.title)).toEqual(["Breaking", "Seeded B", "Seeded A"]);
  });

  it("reports error and keeps the rows on a failed seed", async () => {
    httpFetch.mockResolvedValue({ ok: false, status: 502, json: async () => ({}) });
    const { result } = await connected();
    expect(result.current.status).toBe("error");
    act(() => last().receive(seedArticle(20, 1, "Still streams", 100)));
    expect(result.current.rows.map((r) => r.article.title)).toEqual(["Still streams"]);
  });

  it("reconnects 3000 ms after a close, re-sending the subscribe, and keeps its rows", async () => {
    const { result } = await connected();
    act(() => last().drop());
    expect(result.current.status).toBe("error");
    expect(FakeWebSocket.instances).toHaveLength(1);

    act(() => void vi.advanceTimersByTime(2999));
    expect(FakeWebSocket.instances).toHaveLength(1);
    act(() => void vi.advanceTimersByTime(1));
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(result.current.status).toBe("connecting");
    expect(result.current.rows).toHaveLength(2);

    await act(async () => {
      last().open();
      last().receive(REPLY);
    });
    expect(JSON.parse(last().sent[0])).toHaveProperty("subscribe");
    expect(result.current.status).toBe("live");
  });

  it("closes the errored socket before retrying, so it cannot linger open", async () => {
    const { result } = await connected();
    const first = last();
    act(() => first.onerror?.(new Event("error")));
    expect(first.closed).toBe(true);
    expect(result.current.status).toBe("error");
    expect(FakeWebSocket.instances).toHaveLength(1);

    act(() => void vi.advanceTimersByTime(3000));
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("treats an invalid subscribe reply as a protocol error and retries, instead of sitting on connecting forever", async () => {
    const { result } = renderHook(() => useNewsWire({ base: BASE, feeds: FEEDS, refreshKey: 0 }));
    act(() => last().open());
    act(() => last().receive({ feeds: "no" }));
    expect(result.current.status).toBe("error");
    expect(FakeWebSocket.instances).toHaveLength(1);

    act(() => void vi.advanceTimersByTime(3000));
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(result.current.status).toBe("connecting");
  });

  it("reconnects immediately when the feed list or refreshKey changes, and closes the old socket", async () => {
    const { rerender } = await connected();
    const first = last();
    rerender({ feeds: [FEEDS[0]], refreshKey: 0 });
    expect(first.closed).toBe(true);
    expect(FakeWebSocket.instances).toHaveLength(2);

    rerender({ feeds: [FEEDS[0]], refreshKey: 1 });
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it("reconnects when the document becomes visible again, re-sending the subscribe, and keeps its rows", async () => {
    const setHidden = (hidden: boolean) =>
      Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    try {
      const { result } = await connected();
      const first = last();
      act(() => {
        setHidden(true);
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(FakeWebSocket.instances).toHaveLength(1);

      act(() => {
        setHidden(false);
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(first.closed).toBe(true);
      expect(FakeWebSocket.instances).toHaveLength(2);
      expect(result.current.rows).toHaveLength(2);

      await act(async () => {
        last().open();
        last().receive(REPLY);
      });
      expect(JSON.parse(last().sent[0])).toHaveProperty("subscribe");
      expect(result.current.status).toBe("live");
    } finally {
      // Restores the real `hidden` getter Document.prototype provides.
      delete (document as unknown as Record<string, unknown>).hidden;
    }
  });

  it("in the web build, keeps the socket across a short tab switch and reconnects after a hide of more than 60 s", async () => {
    vi.stubEnv("MODE", "browser");
    const setHidden = (hidden: boolean) =>
      Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    const flip = (hidden: boolean) =>
      act(() => {
        setHidden(hidden);
        document.dispatchEvent(new Event("visibilitychange"));
      });
    try {
      await connected();
      const first = last();
      flip(true);
      act(() => void vi.advanceTimersByTime(5_000));
      flip(false);
      expect(first.closed).toBe(false);
      expect(FakeWebSocket.instances).toHaveLength(1);

      flip(true);
      act(() => void vi.advanceTimersByTime(61_000));
      flip(false);
      expect(first.closed).toBe(true);
      expect(FakeWebSocket.instances).toHaveLength(2);
    } finally {
      delete (document as unknown as Record<string, unknown>).hidden;
      vi.unstubAllEnvs();
    }
  });

  it("closes the socket and cancels the retry on unmount", async () => {
    const { unmount } = await connected();
    act(() => last().drop());
    unmount();
    expect(last().closed).toBe(true);
    act(() => void vi.advanceTimersByTime(3000));
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("ignores a stale seed from a connect cycle superseded by an internal reconnect", async () => {
    // Two REST calls happen: cycle 1's seed, then (after the internal
    // reconnect) cycle 2's seed. Each is held open until this test resolves
    // it, so the interleave from the finding can be reproduced on purpose.
    const seed1 = deferred<unknown>();
    const seed2 = deferred<unknown>();
    httpFetch.mockReset();
    // Two feeds per cycle: cycle 1's two page fetches share seed1, cycle 2's share seed2.
    let calls = 0;
    httpFetch.mockImplementation(() => (++calls <= 2 ? seed1.promise : seed2.promise));

    const { result } = renderHook((p: { feeds: NewsFeed[]; refreshKey: number }) => useNewsWire({ base: BASE, ...p }), {
      initialProps: { feeds: FEEDS, refreshKey: 0 },
    });
    // Cycle 1: subscribe reply arrives, its seed fetch is issued and left pending.
    await act(async () => {
      last().open();
      last().receive(REPLY);
    });
    expect(result.current.status).toBe("connecting");

    // Cycle 1's socket drops before its seed ever resolves.
    act(() => last().drop());
    expect(result.current.status).toBe("error");
    act(() => void vi.advanceTimersByTime(3000));
    expect(FakeWebSocket.instances).toHaveLength(2);

    // Cycle 2: subscribe reply arrives, its seed fetch is issued and left pending too.
    await act(async () => {
      last().open();
      last().receive(REPLY);
    });

    // Cycle 2's seed resolves first: the hook goes live on cycle 2's rows.
    await act(async () => {
      seed2.resolve(seedReply([seedArticle(30, 1, "Cycle 2 only")]));
      await seed2.promise;
      await Promise.resolve();
    });
    expect(result.current.status).toBe("live");
    expect(result.current.rows.map((r) => r.article.title)).toEqual(["Cycle 2 only"]);

    // Cycle 1's stale seed resolves last: it must not clobber cycle 2's
    // status or inject its own (now-orphaned) rows.
    await act(async () => {
      seed1.resolve(seedReply([seedArticle(10, 1, "Seeded A")]));
      await seed1.promise;
      await Promise.resolve();
    });
    expect(result.current.status).toBe("live");
    expect(result.current.rows.map((r) => r.article.title)).toEqual(["Cycle 2 only"]);
  });

  it("ignores a stale seed failure from a superseded cycle too", async () => {
    const seed1 = deferred<unknown>();
    const seed2 = deferred<unknown>();
    httpFetch.mockReset();
    // Two feeds per cycle: cycle 1's two page fetches share seed1, cycle 2's share seed2.
    let calls = 0;
    httpFetch.mockImplementation(() => (++calls <= 2 ? seed1.promise : seed2.promise));

    const { result } = renderHook((p: { feeds: NewsFeed[]; refreshKey: number }) => useNewsWire({ base: BASE, ...p }), {
      initialProps: { feeds: FEEDS, refreshKey: 0 },
    });
    await act(async () => {
      last().open();
      last().receive(REPLY);
    });
    act(() => last().drop());
    act(() => void vi.advanceTimersByTime(3000));
    await act(async () => {
      last().open();
      last().receive(REPLY);
    });
    await act(async () => {
      seed2.resolve(seedReply([seedArticle(30, 1, "Cycle 2 only")]));
      await seed2.promise;
      await Promise.resolve();
    });
    expect(result.current.status).toBe("live");

    // Cycle 1's seed rejects, arriving after cycle 2 is already live: must
    // not flip status back to "error".
    await act(async () => {
      seed1.resolve({ ok: false, status: 502, json: async () => ({}) });
      await seed1.promise;
      await Promise.resolve();
    });
    expect(result.current.status).toBe("live");
    expect(result.current.rows.map((r) => r.article.title)).toEqual(["Cycle 2 only"]);
  });

  describe("feed records (favicons)", () => {
    const ICON_A = "data:image/png;base64,QQ==";
    const ICON_B = REPLY.feeds[1].favicon;
    const reply = (a: string | null, b: string | null) => ({
      feeds: [
        { ...REPLY.feeds[0], favicon: a },
        { ...REPLY.feeds[1], favicon: b },
      ],
    });
    const icons = (rows: { article: { feed_id: number }; record: { favicon: string | null } }[]) =>
      Object.fromEntries(rows.map((r) => [r.article.feed_id, r.record.favicon]));
    const answer = (payload: unknown) =>
      act(async () => {
        last().open();
        last().receive(payload);
      });

    it("a reconnect after a drop refreshes the records, and a raced reply keeps the icons it lacks", async () => {
      const { result } = await connected(); // A: null, B: icon
      act(() => last().drop());
      act(() => void vi.advanceTimersByTime(3000));
      // The server has A's icon now, but this reply raced and lacks B's.
      await answer(reply(ICON_A, null));
      expect(icons(result.current.rows)).toEqual({ 1: ICON_A, 2: ICON_B });
    });

    it("re-asks on a fresh connection while a favicon is null, and shows the icon without a remount", async () => {
      const { result } = await connected(); // A: null
      const first = last();
      expect(icons(result.current.rows)[1]).toBeNull();

      act(() => void vi.advanceTimersByTime(9_999));
      expect(FakeWebSocket.instances).toHaveLength(1);
      act(() => void vi.advanceTimersByTime(1));
      expect(first.closed).toBe(true);
      expect(FakeWebSocket.instances).toHaveLength(2);
      // The rows stay up while it re-asks.
      expect(result.current.rows).toHaveLength(2);

      await answer(reply(ICON_A, ICON_B));
      expect(JSON.parse(last().sent[0])).toEqual(JSON.parse(first.sent[0]));
      expect(icons(result.current.rows)).toEqual({ 1: ICON_A, 2: ICON_B });
      expect(result.current.status).toBe("live");

      // Every icon present: no more re-asks.
      act(() => void vi.advanceTimersByTime(3_600_000));
      expect(FakeWebSocket.instances).toHaveLength(2);
    });

    it("stops re-asking after three tries, and a later null never wipes an icon", async () => {
      const { result } = await connected(); // A: null, B: icon
      for (const [i, wait] of [10_000, 30_000, 90_000].entries()) {
        act(() => void vi.advanceTimersByTime(wait));
        expect(FakeWebSocket.instances).toHaveLength(i + 2);
        await answer(reply(null, null)); // A never gets one; B's is not sent again
        expect(icons(result.current.rows)).toEqual({ 1: null, 2: ICON_B });
      }
      act(() => void vi.advanceTimersByTime(3_600_000));
      expect(FakeWebSocket.instances).toHaveLength(4);
    });
  });
});
