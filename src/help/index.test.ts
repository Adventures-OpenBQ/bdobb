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
  it("is the v5 topic set, in the design's reading order", () => {
    expect(TOPIC_ORDER).toEqual([
      "getting-started",
      "the-left-rail",
      "dashboards-and-folders",
      "dashboard-tabs",
      "workspaces",
      "widget-library",
      "widget-cards",
      "card-parameters",
      "running-and-refreshing",
      "tables",
      "statement-view",
      "charts",
      "calendar-view",
      "linked-widgets",
      "documents-pdf-and-files",
      "built-in-widgets",
      "html-and-iframe-widgets",
      "connections",
      "provider-keys",
      "settings-and-logs",
      "import-and-export",
      "troubleshooting",
      "keyboard-shortcuts",
      "credits",
    ]);
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
