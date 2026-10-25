// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { GLOBBED_SLUGS, TOPIC_ORDER, TOPICS } from "./index";

describe("the help topic index", () => {
  // D13: "a new topic file that nobody listed is as much a bug as a listed
  // slug with no file". Both directions, because either one alone lets the
  // manual and the directory drift apart silently.
  it("lists exactly the files that exist, in both directions", () => {
    expect([...TOPIC_ORDER].sort()).toEqual(GLOBBED_SLUGS);
  });

  it("builds TOPICS in TOPIC_ORDER's order, not the glob's alphabetical one", () => {
    expect(TOPICS.map((t) => t.slug)).toEqual([...TOPIC_ORDER]);
  });

  it("gives every topic a non-empty title taken from its own first H1", () => {
    for (const topic of TOPICS) {
      expect(topic.title, topic.slug).not.toBe("");
      // The H1 stays in the body: the content pane renders it through
      // .markdown-body h1 and the nav list labels itself from the same string.
      expect(topic.body.startsWith(`# ${topic.title}`), topic.slug).toBe(true);
    }
  });

  it("gives every topic a body with something in it", () => {
    for (const topic of TOPICS) {
      expect(topic.body.trim().length, topic.slug).toBeGreaterThan(200);
    }
  });

  // D4, kept as a house rule after remark-gfm arrived with the guide: the
  // reference manual reads as prose and lists, and a table here would be a
  // table nobody reviewed against the narrow dialog column.
  it("has no GFM table anywhere, by convention", () => {
    for (const topic of TOPICS) {
      expect(/^\s*\|.*\|\s*$/m.test(topic.body), topic.slug).toBe(false);
    }
  });

  // D10: MarkdownLink runs every href through safeUrl, which refuses
  // anything that is not http/https, so a relative link silently degrades to
  // unlinked text. Better to have none than to have some that do not work.
  it("has no relative or fragment links", () => {
    for (const topic of TOPICS) {
      const hrefs = [...topic.body.matchAll(/(?<!!)\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]);
      for (const href of hrefs) {
        expect(href.startsWith("https://"), `${topic.slug}: ${href}`).toBe(true);
      }
    }
  });

  it("starts the reading order at getting-started", () => {
    expect(TOPIC_ORDER[0]).toBe("getting-started");
  });

  // The topic list is deliberate and must be updated with each new walkthrough.
  it("is the v9 topic set, in the design's reading order", () => {
    expect(TOPIC_ORDER).toEqual([
      "getting-started",
      "the-left-rail",
      "dashboards-and-folders",
      "dashboard-tabs",
      "workspaces",
      "widget-library",
      "widget-cards",
      "pinned-cards",
      "locked-widgets",
      "card-parameters",
      "running-and-refreshing",
      "tables",
      "statement-view",
      "charts",
      "calendar-view",
      "linked-widgets",
      "documents-pdf-and-files",
      "built-in-widgets",
      "news",
      "html-and-iframe-widgets",
      "connections",
      "provider-keys",
      "eodhd",
      "settings-and-logs",
      "rita",
      "ai-library",
      "import-and-export",
      "troubleshooting",
      "keyboard-shortcuts",
      "ipad",
      "credits",
    ]);
  });

  it("orders the v6 Rita topics after settings and keeps the tables cross-reference honest", () => {
    expect(TOPIC_ORDER).toContain("rita");
    expect(TOPIC_ORDER).toContain("ai-library");
    expect(TOPIC_ORDER.indexOf("rita")).toBe(TOPIC_ORDER.indexOf("settings-and-logs") + 1);
    const tables = TOPICS.find((t) => t.slug === "tables")!.body;
    expect(tables).toMatch(/Rita/);
    expect(tables).toMatch(/CSV\/XLS, managed server and linked tables/);
    expect(tables).toContain("server-execution-pending");
  });
});

// The dashboard sync (2026-10-11) made "does not synchronize dashboards" false.
describe("settings help covers dashboard sync", () => {
  const body = TOPICS.find((t) => t.slug === "settings-and-logs")!.body;
  it("no longer says dashboards are not synchronized", () => {
    expect(body).not.toMatch(/does not synchroni[sz]e dashboards/i);
  });
  it("describes the two-way sync, its questions and the server delete", () => {
    for (const s of ["dashboards and apps", "Keep local", "Keep both", "Keep as local", "here and on", "shared"]) expect(body).toContain(s);
  });
});

// Workspaces and layouts stay local, but dashboards now sync (2026-10-11).
describe("workspaces help matches the dashboard sync", () => {
  const body = TOPICS.find((t) => t.slug === "workspaces")!.body;
  it("says dashboards sync while workspaces, layouts and dropped files do not", () => {
    expect(body).not.toMatch(/does not synchroni[sz]e these dashboards/i);
    expect(body).toMatch(/dashboards sync/i);
    expect(body).toMatch(/workspaces, saved layouts and dropped files are not synchroni[sz]ed/i);
  });
});

// v7: the iPad touch dialect and iPadOS layout are features, so the manual covers them.
describe("iPad topic", () => {
  const body = TOPICS.find((t) => t.slug === "ipad")?.body ?? "";
  it("covers the touch gestures, the rail, saving files and the v7 example", () => {
    for (const s of ["Long-press", "Tap the rail", "tap outside", "Files", "Save to", "home indicator", "v7.0.0-touch.apps.json"]) expect(body).toContain(s);
  });
});

// Back-port of dev's Workspaces help, checked against clean v5's code.
describe("Quick Help covers workspaces in full", () => {
  const topic = (slug: string) => TOPICS.find((t) => t.slug === slug)!.body;
  it("names tile names, Put in panel and the Option-number setting", () => {
    const body = topic("workspaces");
    for (const s of ["**Show dashboard names**", "**Put in panel**", "Settings ▸ Layout ▸ Option-number shortcuts", "`⌥N`"]) {
      expect(body).toContain(s);
    }
  });
  it("gives ⌥N an entry, Arrange mode a section, and names the Workspaces dialog in Escape's rule", () => {
    const body = topic("keyboard-shortcuts");
    expect(body).toMatch(/^- `⌥N` —/m);
    expect(body).toContain("## While arranging a workspace");
    expect(body).toMatch(/An open dialog closes\*\* —[\s\S]*?\*\*Workspaces\*\* dialog[\s\S]*?\*\*Save layout\*\*[\s\S]*?\n4\./);
  });
  it("gives the left rail a Workspaces section", () => {
    expect(topic("the-left-rail")).toContain("## Workspaces");
  });
});

// v8: News, pinned cards and locked widgets are features, so the manual covers
// them; the rail's "Add widget (⌘K)" row is gone (R5), so no topic names it.
describe("v8 topics", () => {
  const topic = (slug: string) => TOPICS.find((t) => t.slug === slug)?.body ?? "";
  it("covers the News card, its menu, its feeds file and the web relay", () => {
    for (const s of ["**RSS Aggregator Server**", "**Configure feeds…**", "**Export feeds…**", "`rss-agg.json`", "Double-click", "rss-ticker", "`/news`", "ticket", "v8.0.0-news.apps.json"]) {
      expect(topic("news")).toContain(s);
    }
  });
  it("covers pinning, the band, the swap, and what carries a pin", () => {
    for (const s of ["**Pin widget ▸**", "**Pin to top**", "**Pin to bottom**", "**Unpin**", "swap", "`pin_card`", "v8.0.0-pinned.apps.json"]) {
      expect(topic("pinned-cards")).toContain(s);
    }
  });
  it("covers the Locked Widgets editor, the sync and the import guard", () => {
    for (const s of ["**Settings ▸ Locked Widgets**", "**Locked at Top…**", "**OK**", "**Cancel**", "`dashboards/docks.json`", "/pro/dash/sync/system/docks", "**Replace**", "**Keep mine**", "**Export all dashboards…**"]) {
      expect(topic("locked-widgets")).toContain(s);
    }
  });
  it("gives Rita's pin_card its place among 18 tools", () => {
    expect(topic("rita")).toContain("18 tools");
    expect(topic("rita")).toContain("`pin_card`");
  });
  it("no longer describes the rail's Add widget (⌘K) row", () => {
    for (const t of TOPICS) expect(t.body, t.slug).not.toContain("Add widget (⌘K)");
  });
});

// v9: EODHD data is how Episode 9's widgets and calendars reach BDOBB, so the
// manual covers it -- and says only what this line does: the hint is offered,
// never applied by itself, the key lives on the stack, and the logos are desktop-only.
describe("v9 topics", () => {
  const topic = (slug: string) => TOPICS.find((t) => t.slug === slug)?.body ?? "";
  it("covers the EODHD widgets, the stack's key and EODHD's calendars", () => {
    // REVIEW (user ruling 2026-10-14): the extension is openbq-eodhd (Adventures-OpenBQ/openbq-eodhd), was `openbb-eodhd`; same pin, new name.
    for (const s of ["`openbq-eodhd`", "`EODHD_API_KEY`", "`eodhd_economy_calendar_eodhd_obb`", "**Source → Release → Statistic**", "**Type** and **Series**", "`AAPL` keeps `AAPL.US`", "logo", "**Statement**"]) {
      expect(topic("eodhd")).toContain(s);
    }
    expect(topic("eodhd")).toContain("**Use suggested**");
    expect(topic("eodhd")).toContain("nothing is applied until you click");
    // V9-P2 (ruled 2026-10-15): Rita reads the hint on a linked table and prefers it.
    expect(topic("eodhd")).toContain("Rita reads it");
    expect(topic("rita")).toContain("provider's aggregation hint");
  });
  it("is found by searching for EODHD, and the Calendar view topic points to it", async () => {
    const { searchTopics } = await import("./search");
    expect(searchTopics(TOPICS, "EODHD").map((h) => h.slug)[0]).toBe("eodhd");
    expect(topic("calendar-view")).toContain("See EODHD data.");
  });
});

// v10: the live grid is a table card with a socket behind it, so Quick Help
// covers it in Tables (donor 7876c86a did the same) and in Troubleshooting --
// written for this line: one row per frame IS read here, and a header
// credential does not ride the socket.
describe("v10 topics", () => {
  const topic = (slug: string) => TOPICS.find((t) => t.slug === slug)?.body ?? "";
  it("Tables covers the live grid and the logo, rangeBar and percentKey declarations", () => {
    for (const s of ["## Live grids", "`live_grid`", "`symbol_meta`", "**Refresh** re-fetches the snapshot", "one row at a time or as a list of rows",
      "`logo`", "`NA`", "`rangeBar`", "`lowKey`", "`highKey`", "`valueKey`", "`price`", "`week52`", "`day`", "`percentKey`", "`1.24 (3.4%)`", "`align`",
      "`enableCellChangeWs: false`"]) {
      expect(topic("tables")).toContain(s);
    }
  });
  it("Troubleshooting says why a live grid holds its snapshot", () => {
    expect(topic("troubleshooting")).toContain("## A live grid shows its first snapshot and never ticks");
    expect(topic("troubleshooting")).toContain("A browser websocket cannot carry a header.");
    expect(topic("troubleshooting")).toContain("single-use socket ticket before every connect");
  });
});
