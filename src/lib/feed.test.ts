// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { FeedError, parseFeed, relativeTime } from "./feed";

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example Wire</title>
    <link>https://wire.example/</link>
    <item>
      <title>Rates hold &amp; steady</title>
      <link>https://wire.example/rates</link>
      <pubDate>Tue, 25 Aug 2026 14:30:00 GMT</pubDate>
    </item>
    <item>
      <title><![CDATA[Second story]]></title>
      <link>https://wire.example/second</link>
      <pubDate>not a date at all</pubDate>
    </item>
    <item>
      <link>https://wire.example/untitled</link>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Journal</title>
  <entry>
    <title>Alternate wins</title>
    <link rel="edit" href="https://journal.example/edit/1"/>
    <link rel="alternate" href="https://journal.example/1"/>
    <updated>2026-08-25T14:30:00Z</updated>
  </entry>
  <entry>
    <title>First href otherwise</title>
    <link href="https://journal.example/2"/>
    <published>2026-08-24T09:00:00Z</published>
  </entry>
</feed>`;

describe("parseFeed on RSS 2.0", () => {
  it("reads title, link, date and the channel title as source", () => {
    const [first] = parseFeed(RSS);
    expect(first).toEqual({
      // The parser decoded &amp; — the item carries text, never markup.
      title: "Rates hold & steady",
      link: "https://wire.example/rates",
      date: Date.parse("Tue, 25 Aug 2026 14:30:00 GMT"),
      source: "Example Wire",
    });
  });

  it("unwraps CDATA and leaves the date absent when pubDate is unparsable", () => {
    const second = parseFeed(RSS)[1]!;
    expect(second.title).toBe("Second story");
    // Absent, not NaN and not 0: a bad date must never render as 1970.
    expect(second.date).toBeUndefined();
  });

  it("drops an item with no title and keeps document order for the rest", () => {
    expect(parseFeed(RSS).map((i) => i.title)).toEqual(["Rates hold & steady", "Second story"]);
  });

  it("refuses a javascript: link, leaving the item present but inert", () => {
    const xml = `<rss version="2.0"><channel><title>T</title><item>` +
      `<title>Trap</title><link>javascript:alert(1)</link></item></channel></rss>`;
    expect(parseFeed(xml)).toEqual([{ title: "Trap", source: "T" }]);
  });

  it("takes the CHANNEL title as source, not the first item's", () => {
    const xml = `<rss version="2.0"><channel><item><title>Story</title></item>` +
      `<title>Channel Name</title></channel></rss>`;
    expect(parseFeed(xml)[0]!.source).toBe("Channel Name");
  });
});

describe("parseFeed on Atom", () => {
  it("prefers link[rel=alternate] and reads updated as the date", () => {
    const [first] = parseFeed(ATOM);
    expect(first).toEqual({
      title: "Alternate wins",
      link: "https://journal.example/1",
      date: Date.parse("2026-08-25T14:30:00Z"),
      source: "Example Journal",
    });
  });

  it("falls back to the first href and to published when updated is absent", () => {
    const second = parseFeed(ATOM)[1]!;
    expect(second.link).toBe("https://journal.example/2");
    expect(second.date).toBe(Date.parse("2026-08-24T09:00:00Z"));
  });

  it("reads a prefixed Atom document, whose nodeName carries the prefix", () => {
    const xml = `<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">` +
      `<atom:title>Prefixed</atom:title><atom:entry><atom:title>Story</atom:title>` +
      `</atom:entry></atom:feed>`;
    expect(parseFeed(xml)).toEqual([{ title: "Story", source: "Prefixed" }]);
  });
});

describe("parseFeed on things that are not feeds", () => {
  it("throws on an HTML page, which parses as XML but has no feed root", () => {
    // Well-formed XHTML: the XML parser accepts it and reports no
    // parsererror, so the root-element check is the only thing that catches
    // a user who pasted a site's home page instead of its feed.
    expect(() => parseFeed("<html><body><h1>Hello</h1></body></html>")).toThrow(FeedError);
  });

  it("throws on malformed XML, which the parser reports as a parsererror document", () => {
    expect(() => parseFeed("<rss><channel><title>x</title>")).toThrow(FeedError);
  });

  it("throws on an rss document with no channel", () => {
    expect(() => parseFeed(`<rss version="2.0"></rss>`)).toThrow(FeedError);
  });

  it("throws on an empty body", () => {
    expect(() => parseFeed("")).toThrow(FeedError);
  });
});

describe("relativeTime", () => {
  const NOW = Date.parse("2026-08-25T12:00:00Z");
  // Compared against Intl's own wording for the SAME value and unit, so the
  // assertion pins what this function decides (which unit, which sign) and
  // not what Intl decides (the locale's phrasing) — these tests must pass
  // under any LC_ALL, and src/test/setup.ts pins only Intl.NumberFormat.
  const say = (value: number, unit: Intl.RelativeTimeFormatUnit) =>
    new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(value, unit);

  it("uses hours for a gap of hours", () => {
    expect(relativeTime(NOW - 3 * 60 * 60_000, NOW)).toBe(say(-3, "hour"));
  });

  it("uses minutes below an hour", () => {
    expect(relativeTime(NOW - 90_000, NOW)).toBe(say(-1, "minute"));
  });

  it("uses seconds below a minute", () => {
    expect(relativeTime(NOW - 5_000, NOW)).toBe(say(-5, "second"));
  });

  it("uses days, months and years as the gap grows", () => {
    expect(relativeTime(NOW - 3 * 24 * 60 * 60_000, NOW)).toBe(say(-3, "day"));
    expect(relativeTime(NOW - 60 * 24 * 60 * 60_000, NOW)).toBe(say(-2, "month"));
    expect(relativeTime(NOW - 730 * 24 * 60 * 60_000, NOW)).toBe(say(-2, "year"));
  });

  it("says 'in' rather than 'ago' for a feed whose clock runs ahead", () => {
    expect(relativeTime(NOW + 2 * 60 * 60_000, NOW)).toBe(say(2, "hour"));
  });
});
