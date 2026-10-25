// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { TOPICS, type Topic } from "./index";
import { searchTopics } from "./search";

/** Hand-built topics, so the assertions do not move when the manual is edited. */
const FIXTURES: Topic[] = [
  { slug: "alpha", title: "Refreshing", body: "# Refreshing\n\nrefetchInterval decides.\n" },
  { slug: "beta", title: "Tables", body: "# Tables\n\nPin a column. Refreshing a table keeps the scroll. ssrm_table is served.\n" },
  { slug: "gamma", title: "Charts", body: "# Charts\n\nZoom and pan a plot.\n" },
];

describe("searchTopics", () => {
  it("returns nothing for an empty or whitespace-only query", () => {
    expect(searchTopics(FIXTURES, "")).toEqual([]);
    expect(searchTopics(FIXTURES, "   \t ")).toEqual([]);
  });

  it("returns nothing when no topic matches", () => {
    expect(searchTopics(FIXTURES, "zzzznothing")).toEqual([]);
  });

  it("ranks a title hit above a body hit", () => {
    const hits = searchTopics(FIXTURES, "refreshing");
    expect(hits.map((h) => h.slug)).toEqual(["alpha", "beta"]);
  });

  it("matches case-insensitively", () => {
    expect(searchTopics(FIXTURES, "TABLES").map((h) => h.slug)).toEqual(["beta"]);
  });

  it("ANDs every term, so a topic matching only one is excluded", () => {
    expect(searchTopics(FIXTURES, "pin column").map((h) => h.slug)).toEqual(["beta"]);
    expect(searchTopics(FIXTURES, "pin zoom")).toEqual([]);
  });

  // D3, as a regression test against someone "improving" this into stemmed
  // tokenisation later: a word-boundary index misses both of these.
  it("matches on substrings, so refet finds refetchInterval", () => {
    expect(searchTopics(FIXTURES, "refet").map((h) => h.slug)).toEqual(["alpha"]);
  });

  it("matches on substrings, so ssrm finds ssrm_table", () => {
    expect(searchTopics(FIXTURES, "ssrm").map((h) => h.slug)).toEqual(["beta"]);
  });

  it("caps a term's body contribution so repetition cannot bury a title hit", () => {
    const repeated: Topic[] = [
      { slug: "a", title: "Zoom", body: "# Zoom\n\nnothing else.\n" },
      { slug: "b", title: "Other", body: `# Other\n\n${"zoom ".repeat(50)}\n` },
    ];
    // 10 (title) + 1 (body) beats 0 + 5 (capped), so the topic ABOUT zoom wins.
    expect(searchTopics(repeated, "zoom").map((h) => h.slug)).toEqual(["a", "b"]);
  });

  it("breaks equal scores by position in the list it was given", () => {
    const tied: Topic[] = [
      { slug: "first", title: "One", body: "# One\n\nshared\n" },
      { slug: "second", title: "Two", body: "# Two\n\nshared\n" },
    ];
    expect(searchTopics(tied, "shared").map((h) => h.slug)).toEqual(["first", "second"]);
  });

  it("builds a snippet that contains the term and is at most 100 characters", () => {
    const [hit] = searchTopics(FIXTURES, "pin");
    expect(hit.snippet.toLowerCase()).toContain("pin");
    expect(hit.snippet.replace(/…/g, "").length).toBeLessThanOrEqual(100);
  });

  it("marks only the side it actually cut", () => {
    const long: Topic[] = [
      { slug: "x", title: "X", body: `# X\n\n${"aaaa ".repeat(60)}needle ${"bbbb ".repeat(60)}` },
    ];
    const [hit] = searchTopics(long, "needle");
    expect(hit.snippet.startsWith("…")).toBe(true);
    expect(hit.snippet.endsWith("…")).toBe(true);

    const short: Topic[] = [{ slug: "y", title: "Y", body: "# Y\n\nneedle here\n" }];
    const [tiny] = searchTopics(short, "needle");
    expect(tiny.snippet.startsWith("…")).toBe(false);
    expect(tiny.snippet.endsWith("…")).toBe(false);
  });

  it("skips the leading H1 when building the snippet, so a title-word query does not start with #", () => {
    const [hit] = searchTopics(FIXTURES, "tables");
    expect(hit.slug).toBe("beta");
    expect(hit.snippet.startsWith("#")).toBe(false);
  });

  it("carries the topic's own title through, so the list can label itself", () => {
    const [hit] = searchTopics(FIXTURES, "charts");
    expect(hit).toMatchObject({ slug: "gamma", title: "Charts" });
  });

  it("finds something in the real manual for a word the manual actually uses", () => {
    // Guards against a topic set that search cannot reach at all.
    expect(searchTopics(TOPICS, "dashboard").length).toBeGreaterThan(0);
  });

  // The e2e (Task 10) and HelpDialog's "narrows the list" test both type
  // exactly this and expect the Tables topic. Pinning it here means a topic
  // edit that removes the word fails in milliseconds rather than in Chromium.
  it("finds the Tables topic for \"pinning\", and does not match everything", () => {
    const hits = searchTopics(TOPICS, "pinning");
    expect(hits.map((h) => h.slug)).toContain("tables");
    expect(hits.length).toBeLessThan(TOPICS.length);
    expect(hits[0].slug).toBe("tables");
  });
});
