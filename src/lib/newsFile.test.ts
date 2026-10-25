// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { NEWS_FILE_NAME, parseNewsFile, serializeNewsState } from "./newsFile";

const STATE = {
  feeds: [
    { url: "https://a.example/feed", name: "A", tab: "Wires" },
    { url: "https://b.example/feed", name: "", tab: "" },
  ],
  highlights: ["fed"],
  tabOrder: ["Wires"],
};

describe("rss-agg.json", () => {
  it("is named rss-agg.json and round-trips the card state", () => {
    expect(NEWS_FILE_NAME).toBe("rss-agg.json");
    const text = serializeNewsState(STATE);
    expect(text.endsWith("\n")).toBe(true);
    expect(parseNewsFile(text)).toEqual({ ok: true, state: STATE });
  });

  it("trims, defaults a missing name and tab, and drops empty highlights and order", () => {
    const text = JSON.stringify({ feeds: [{ url: " https://a.example/feed " }], highlights: [" ", "x"], tabOrder: [""] });
    expect(parseNewsFile(text)).toEqual({
      ok: true,
      state: { feeds: [{ url: "https://a.example/feed", name: "", tab: "" }], highlights: ["x"] },
    });
  });

  it("refuses what is not a configuration, naming the reason", () => {
    expect(parseNewsFile("nope")).toEqual({ ok: false, refusal: "Not a JSON file." });
    expect(parseNewsFile("[]").ok).toBe(false);
    expect(parseNewsFile('{"feeds": []}').ok).toBe(false);
    expect(parseNewsFile(JSON.stringify({ feeds: [{ url: "javascript:alert(1)" }] }))).toEqual({
      ok: false,
      refusal: "Feed 1 has no http or https URL.",
    });
    expect(parseNewsFile(JSON.stringify({ feeds: [{ url: "https://a.example/f", name: 3 }] })).ok).toBe(false);
    expect(parseNewsFile(JSON.stringify({ feeds: [{ url: "https://a.example/f" }], highlights: "fed" })).ok).toBe(false);
    expect(parseNewsFile(JSON.stringify({ feeds: [{ url: "https://a.example/f" }], tabOrder: [1] })).ok).toBe(false);
    const many = { feeds: Array.from({ length: 201 }, (_, i) => ({ url: `https://h${i}.example/f` })) };
    expect(parseNewsFile(JSON.stringify(many)).ok).toBe(false);
  });
});
