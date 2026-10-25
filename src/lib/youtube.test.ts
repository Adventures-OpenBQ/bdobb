// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { isYouTubeEmbed, youtubeEmbedUrl } from "./youtube";

const ID = "uYyhswnZkSw"; // 11 chars, includes an underscore-free real id
const EMBED = `https://www.youtube.com/embed/${ID}`;

describe("youtubeEmbedUrl", () => {
  it("maps a watch URL to an embed URL", () => {
    expect(youtubeEmbedUrl(`https://www.youtube.com/watch?v=${ID}`)).toBe(EMBED);
  });

  it("keeps only the id, dropping extra query params like a timestamp", () => {
    expect(youtubeEmbedUrl(`https://www.youtube.com/watch?v=${ID}&t=30s`)).toBe(EMBED);
  });

  it("handles a youtu.be short link, with or without params", () => {
    expect(youtubeEmbedUrl(`https://youtu.be/${ID}`)).toBe(EMBED);
    expect(youtubeEmbedUrl(`https://youtu.be/${ID}?t=30`)).toBe(EMBED);
  });

  it("handles an already-embed URL and a shorts URL", () => {
    expect(youtubeEmbedUrl(`https://www.youtube.com/embed/${ID}`)).toBe(EMBED);
    expect(youtubeEmbedUrl(`https://www.youtube.com/shorts/${ID}`)).toBe(EMBED);
  });

  it("accepts a bare 11-char id", () => {
    expect(youtubeEmbedUrl(ID)).toBe(EMBED);
  });

  it("trims surrounding whitespace (a text/plain body may end in a newline)", () => {
    expect(youtubeEmbedUrl(`  https://www.youtube.com/watch?v=${ID}\n`)).toBe(EMBED);
  });

  it("returns null for empty, whitespace, non-youtube, or malformed input", () => {
    expect(youtubeEmbedUrl("")).toBeNull();
    expect(youtubeEmbedUrl("   ")).toBeNull();
    expect(youtubeEmbedUrl("https://example.com/watch?v=" + ID)).toBeNull();
    expect(youtubeEmbedUrl("https://www.youtube.com/watch?v=tooShort")).toBeNull();
    expect(youtubeEmbedUrl("not a url at all")).toBeNull();
  });

  it("builds the loopback wrapper URL when given a port", () => {
    expect(youtubeEmbedUrl(`https://www.youtube.com/watch?v=${ID}`, 50123)).toBe(`http://127.0.0.1:50123/yt?id=${ID}`);
    expect(youtubeEmbedUrl(`https://youtu.be/${ID}?t=30`, 50123)).toBe(`http://127.0.0.1:50123/yt?id=${ID}`);
  });

  it("keeps youtube.com's embed when there is no port", () => {
    expect(youtubeEmbedUrl(`https://www.youtube.com/watch?v=${ID}`, undefined)).toBe(EMBED);
  });

  it("never yields a loopback URL for an invalid payload", () => {
    for (const bad of ["", "https://example.com/watch?v=" + ID, "https://www.youtube.com/watch?v=tooShort", "not a url at all"]) {
      expect(youtubeEmbedUrl(bad, 50123)).toBeNull();
    }
  });
});

describe("isYouTubeEmbed", () => {
  it("returns true for youtube.com embed URLs and false for loopback URLs", () => {
    expect(isYouTubeEmbed(`https://www.youtube.com/embed/${ID}`)).toBe(true);
    expect(isYouTubeEmbed(`http://127.0.0.1:50123/yt?id=${ID}`)).toBe(false);
  });
});
