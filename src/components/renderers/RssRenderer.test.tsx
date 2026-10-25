// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A hand-rolled fetch, not the real one over mockServer: these tests are
// about what the RENDERER does with a status, a body and a clock, and a
// stubbed fetch is the only way to hand it a 500 and a non-feed body on demand.
const httpFetch = vi.fn();
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: (...args: unknown[]) => httpFetch(...args) }));
const openUrl = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (u: string) => openUrl(u) }));

import { RssRenderer } from "./RssRenderer";

const FEED_URL = "https://wire.example/rss";

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Example Wire</title>
  <item><title>First story</title><link>https://wire.example/1</link>
    <pubDate>Tue, 25 Aug 2026 09:00:00 GMT</pubDate></item>
  <item><title>Second story</title><link>https://wire.example/2</link></item>
  <item><title>Third story</title><link>https://wire.example/3</link></item>
</channel></rss>`;

/** A Response as much as this component uses of one. */
function reply(body: string, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  };
}

beforeEach(() => {
  httpFetch.mockReset();
  openUrl.mockReset();
  httpFetch.mockResolvedValue(reply(RSS));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RssRenderer", () => {
  it("asks for a URL and issues no request until it has one", () => {
    render(<RssRenderer url="   " limit={20} refreshKey={0} />);
    expect(screen.getByText("Enter a feed URL above.")).toBeInTheDocument();
    expect(httpFetch).not.toHaveBeenCalled();
  });

  it("refuses a non-http address rather than handing it to the HTTP client", () => {
    render(<RssRenderer url="file:///etc/passwd" limit={20} refreshKey={0} />);
    expect(screen.getByText("Enter an http or https feed URL.")).toBeInTheDocument();
    expect(httpFetch).not.toHaveBeenCalled();
  });

  it("renders the headlines, with the channel title and a relative time", async () => {
    render(<RssRenderer url={FEED_URL} limit={20} refreshKey={0} />);
    expect(await screen.findByText("First story")).toBeInTheDocument();
    expect(screen.getByText("Third story")).toBeInTheDocument();
    // Every row is stamped with the channel title, and the two items with no
    // pubDate show the em dash rather than an epoch date. The dated item's
    // own wording is not asserted here: it would drift with the wall clock.
    // relativeTime has its own tests in src/lib/feed.test.ts.
    const metas = screen.getAllByText(/^Example Wire · /);
    expect(metas.map((el) => el.textContent)).toEqual([
      expect.not.stringContaining("—"),
      "Example Wire · —",
      "Example Wire · —",
    ]);
  });

  it("sends the Accept header and a connect timeout", async () => {
    render(<RssRenderer url={FEED_URL} limit={20} refreshKey={0} />);
    await screen.findByText("First story");
    expect(httpFetch).toHaveBeenCalledWith(FEED_URL, {
      method: "GET",
      headers: {
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9",
      },
      connectTimeout: 30_000,
    });
  });

  it("shows at most `limit` headlines", async () => {
    render(<RssRenderer url={FEED_URL} limit={2} refreshKey={0} />);
    await screen.findByText("First story");
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.queryByText("Third story")).not.toBeInTheDocument();
  });

  it("falls back to the default count for a NaN/garbage limit, rather than a blank card", async () => {
    // `Math.max(1, NaN)` is NaN, and `items.slice(0, NaN)` silently slices to
    // zero -- a persisted card's limit param routes through `Number()`
    // before it gets here, and a stray value must not blank the card.
    render(<RssRenderer url={FEED_URL} limit={NaN} refreshKey={0} />);
    expect(await screen.findByText("First story")).toBeInTheDocument();
    // All three items in the fixture feed show: the default (20) exceeds it.
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("shows an error card naming the status on a non-2xx answer", async () => {
    httpFetch.mockResolvedValue(reply("nope", 500));
    render(<RssRenderer url={FEED_URL} limit={20} refreshKey={0} />);
    expect(await screen.findByText("HTTP 500")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("shows an error card when the body is not a feed", async () => {
    httpFetch.mockResolvedValue(reply("<html><body><h1>Hello</h1></body></html>"));
    render(<RssRenderer url={FEED_URL} limit={20} refreshKey={0} />);
    expect(await screen.findByText("Not an RSS or Atom feed")).toBeInTheDocument();
  });

  it("never renders the failing URL, which may carry the user's feed token", async () => {
    httpFetch.mockRejectedValue(new Error(`error sending request for url (${FEED_URL}?token=sekrit)`));
    render(<RssRenderer url={`${FEED_URL}?token=sekrit`} limit={20} refreshKey={0} />);
    expect(await screen.findByText("Could not reach the feed.")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("sekrit");
  });

  it("opens a headline's link in the system browser", async () => {
    const user = userEvent.setup();
    render(<RssRenderer url={FEED_URL} limit={20} refreshKey={0} />);
    await user.click(await screen.findByRole("button", { name: /First story/ }));
    expect(openUrl).toHaveBeenCalledWith("https://wire.example/1");
  });

  it("leaves an item with no usable link inert", async () => {
    httpFetch.mockResolvedValue(
      reply(`<rss version="2.0"><channel><title>T</title>` +
        `<item><title>Trap</title><link>javascript:alert(1)</link></item></channel></rss>`),
    );
    render(<RssRenderer url={FEED_URL} limit={20} refreshKey={0} />);
    const button = await screen.findByRole("button", { name: /Trap/ });
    expect(button).toBeDisabled();
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("refetches exactly once when refreshKey changes", async () => {
    const { rerender } = render(<RssRenderer url={FEED_URL} limit={20} refreshKey={0} />);
    await screen.findByText("First story");
    expect(httpFetch).toHaveBeenCalledTimes(1);

    rerender(<RssRenderer url={FEED_URL} limit={20} refreshKey={1} />);
    await waitFor(() => expect(httpFetch).toHaveBeenCalledTimes(2));

    // A re-render that changes nothing must not be a third request.
    rerender(<RssRenderer url={FEED_URL} limit={20} refreshKey={1} />);
    await waitFor(() => expect(httpFetch).toHaveBeenCalledTimes(2));
  });

  // `limit` only slices what is already loaded; it was in the fetch effect's
  // deps, so every edit to it asked the feed host again.
  it("re-slices a changed limit without asking the feed again", async () => {
    const { rerender } = render(<RssRenderer url={FEED_URL} limit={3} refreshKey={0} />);
    await screen.findByText("Third story");
    expect(httpFetch).toHaveBeenCalledTimes(1);

    rerender(<RssRenderer url={FEED_URL} limit={1} refreshKey={0} />);

    expect(screen.queryByText("Second story")).not.toBeInTheDocument();
    expect(httpFetch).toHaveBeenCalledTimes(1);
  });

  it("refetches on the card's interval, and only after the last request landed", async () => {
    vi.useFakeTimers();
    render(<RssRenderer url={FEED_URL} limit={20} refreshKey={0} intervalMs={60_000} />);
    // Let the first request resolve: the timer is armed on completion, so
    // nothing is scheduled until this flush has run.
    await act(async () => {});
    expect(httpFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(httpFetch).toHaveBeenCalledTimes(2);
  });

  it("does not poll when the card resolved no interval", async () => {
    vi.useFakeTimers();
    render(<RssRenderer url={FEED_URL} limit={20} refreshKey={0} />);
    await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(httpFetch).toHaveBeenCalledTimes(1);
  });

  it("refuses an oversized feed on the body it actually read, not on a header", async () => {
    // A content-length precheck stood here once and enforced nothing: this
    // response declares a small body and delivers a 5 MB one, exactly what an
    // absent, wrong or chunked-away header lets through.
    const huge = `${RSS}${"<!--x-->".repeat(700_000)}`;
    httpFetch.mockResolvedValue(reply(huge, 200, { "content-length": "1000" }));
    render(<RssRenderer url={FEED_URL} limit={20} refreshKey={0} />);
    expect(await screen.findByText("Feed is too large to show.")).toBeInTheDocument();
  });

  it("keeps a headline's relative time ticking when auto-refresh is off", async () => {
    vi.useFakeTimers();
    const mount = new Date("2026-01-15T17:30:00.000Z");
    vi.setSystemTime(mount);
    const pub = new Date(mount.getTime() - 10_000); // 10s before mount
    const tickingRss =
      `<rss version="2.0"><channel><title>T</title>` +
      `<item><title>Ticker</title><link>https://wire.example/t</link>` +
      `<pubDate>${pub.toUTCString()}</pubDate></item></channel></rss>`;
    httpFetch.mockResolvedValue(reply(tickingRss));

    render(<RssRenderer url={FEED_URL} limit={20} refreshKey={0} />);
    await act(async () => {});

    const before = screen.getByText(/^T · /).textContent;

    // No auto-refresh: intervalMs is undefined, so only the minute tick can
    // move the clock this component reads its relative times from.
    await act(async () => {
      vi.advanceTimersByTime(61_000);
    });

    const after = screen.getByText(/^T · /).textContent;
    expect(after).not.toBe(before);
  });
});
