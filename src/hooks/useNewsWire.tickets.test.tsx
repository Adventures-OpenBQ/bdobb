// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const httpFetch = vi.fn();
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: (...args: unknown[]) => httpFetch(...args) }));

import { FakeSocket } from "../test/fakeSocket";
import { RECONNECT_MS, defaultNewsBase } from "../lib/news";
import type { NewsFeed } from "../lib/types";
import { useNewsWire } from "./useNewsWire";

/**
 * The News wire on the web preview: an empty card's server is the preview's own
 * /news relay (defaultNewsBase), and the socket shim (src/browser-shim/socket.ts)
 * turns the same-origin socket useReconnectingSocket constructs into a ticketed one
 * on the gateway. The hook's reconnect loop is the shared one: nothing here is a
 * second loop, so each retry, Refresh or feed change is one new socket on one new
 * ticket that carries exactly one subscribe frame (the gateway closes a second).
 */
const FEED = "https://feeds.example.com/news.xml";
const FEEDS: NewsFeed[] = [{ url: FEED, name: "Wire", tab: "" }];
const GATEWAY = "wss://gateway.example.com/news/ws/news?ticket=";
const REPLY = { feeds: [{ id: 7, url: FEED, title: "Example wire", favicon: null }] };

let tickets: ReturnType<typeof vi.fn>;
let issued = 0;
const ticketOk = async () => new Response(JSON.stringify({ url: GATEWAY + ++issued }), { status: 200 });

beforeEach(async () => {
  vi.resetModules();
  issued = 0;
  FakeSocket.last = null;
  FakeSocket.all = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  tickets = vi.fn().mockImplementation(ticketOk);
  vi.stubGlobal("fetch", tickets);
  httpFetch.mockReset();
  httpFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ articles: [{ id: 1, feed_id: 7, title: "Seeded", link: null, published_at: null, sort_at: 1 }] }),
  });
  // What the preview's bootstrap sets (web/bootstrap.mjs), then the shim as the bundle
  // loads it: it captures the stubbed constructor as the native one.
  window.__bdobbSocketTickets = true;
  window.__bdobbNewsServer = `${window.location.origin}/news`;
  await import("../browser-shim/socket");
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete window.__bdobbSocketTickets;
  delete window.__bdobbNewsServer;
});

const flush = () => act(async () => {
  await vi.advanceTimersByTimeAsync(0);
});

function mount() {
  return renderHook((p: { feeds: NewsFeed[]; refreshKey: number }) => useNewsWire({ base: defaultNewsBase(), ...p }), {
    initialProps: { feeds: FEEDS, refreshKey: 0 },
  });
}

describe("useNewsWire on the web preview (socket tickets)", () => {
  it("an empty card subscribes over a ticketed gateway socket and seeds through the relay", async () => {
    const hook = mount();
    await flush();
    expect(tickets).toHaveBeenCalledTimes(1);
    expect(tickets.mock.calls[0][0]).toBe("/socket-ticket?for=" + encodeURIComponent("/news/ws/news"));
    const real = FakeSocket.last!;
    expect(real.url).toBe(GATEWAY + 1);
    await act(async () => {
      real.open();
      real.emit(REPLY);
    });
    await flush();
    expect(real.sent).toEqual([JSON.stringify({ subscribe: [{ url: FEED, name: "Wire" }] })]);
    expect(httpFetch).toHaveBeenCalledWith(`${window.location.origin}/news/api/news?limit=50&feed_id=7`, { method: "GET" });
    await act(async () => {
      real.emit({ id: 2, feed_id: 7, title: "Off the wire", link: null, published_at: null, sort_at: 2 });
    });
    expect(hook.result.current.status).toBe("live");
    expect(hook.result.current.rows.map((r) => r.article.title)).toEqual(["Off the wire", "Seeded"]);
    hook.unmount();
  });

  it("a refused ticket is a drop: the shared loop retries after RECONNECT_MS on a fresh ticket", async () => {
    tickets.mockImplementationOnce(async () => new Response("x", { status: 503 }));
    const hook = mount();
    await flush();
    expect(FakeSocket.all).toHaveLength(0); // no socket without a ticket
    expect(hook.result.current.status).toBe("error");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECONNECT_MS - 1);
    });
    expect(tickets).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(tickets).toHaveBeenCalledTimes(2);
    expect(FakeSocket.all.map((s) => s.url)).toEqual([GATEWAY + 1]);
    await act(async () => {
      FakeSocket.last!.open();
    });
    expect(FakeSocket.last!.sent).toHaveLength(1);
    hook.unmount();
  });

  it("a Refresh is a new socket on a new ticket; neither socket ever gets a second frame", async () => {
    const hook = mount();
    await flush();
    await act(async () => {
      FakeSocket.last!.open();
      FakeSocket.last!.emit(REPLY);
    });
    hook.rerender({ feeds: FEEDS, refreshKey: 1 });
    await flush();
    expect(tickets).toHaveBeenCalledTimes(2);
    const [first, second] = FakeSocket.all;
    expect(first.closed).toBe(true);
    expect(second.url).toBe(GATEWAY + 2);
    await act(async () => {
      second.open();
    });
    expect(first.sent).toHaveLength(1);
    expect(second.sent).toHaveLength(1);
    hook.unmount();
  });

  it("on the desktop an empty card has no server: no ticket, no socket", async () => {
    delete window.__bdobbNewsServer;
    const hook = mount();
    await flush();
    expect(hook.result.current.status).toBe("idle");
    expect(tickets).not.toHaveBeenCalled();
    expect(FakeSocket.all).toHaveLength(0);
    hook.unmount();
  });
});
