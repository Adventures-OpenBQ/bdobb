// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { GUIDE_PAGES, GUIDE_PREFIX, GUIDE_SECTIONS, rewriteImages, rewriteWikilinks, stripFrontmatter } from "./guide";
import { TOPICS } from "./index";
import { shotUrl } from "./shots";

describe("the help guide", () => {
  it("starts at home and lists every page in exactly one section", () => {
    expect(GUIDE_PAGES[0].slug).toBe(`${GUIDE_PREFIX}home`);
    const slugs = GUIDE_SECTIONS.flatMap((s) => s.pages.map((p) => p.slug));
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).toEqual(GUIDE_PAGES.map((p) => p.slug));
    // Added v4 Calendar and Linked Widgets, and v5 Workspace/Statement pages, are deliberate.
    expect(GUIDE_PAGES).toHaveLength(36);
  });

  it("gives every page a title from its own H1, with the frontmatter gone", () => {
    for (const page of GUIDE_PAGES) {
      expect(page.title, page.slug).not.toBe("");
      expect(page.body.startsWith(`# ${page.title}`), page.slug).toBe(true);
      expect(page.body.startsWith("---"), page.slug).toBe(false);
    }
  });

  it("never shares a slug with the reference manual", () => {
    const manual = new Set(TOPICS.map((t) => t.slug));
    for (const page of GUIDE_PAGES) expect(manual.has(page.slug), page.slug).toBe(false);
  });

  it("resolves every internal link to a page", () => {
    const known = new Set(GUIDE_PAGES.map((p) => p.slug));
    for (const page of GUIDE_PAGES) {
      expect(page.body.includes("[["), `${page.slug} still holds a wikilink`).toBe(false);
      for (const m of page.body.matchAll(/\]\(#(guide\/[a-z0-9-]+)\)/g)) {
        expect(known.has(m[1]), `${page.slug} -> ${m[1]}`).toBe(true);
      }
    }
  });

  it("resolves every image to a shot in both themes", () => {
    for (const page of GUIDE_PAGES) {
      for (const m of page.body.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
        expect(m[1].startsWith("./shots/"), `${page.slug}: ${m[1]}`).toBe(true);
        expect(shotUrl(m[1], "light"), `${page.slug}: ${m[1]} (light)`).not.toBeNull();
        expect(shotUrl(m[1], "dark"), `${page.slug}: ${m[1]} (dark)`).not.toBeNull();
      }
    }
  });

  it("links only to https, or to a guide page", () => {
    for (const page of GUIDE_PAGES) {
      for (const m of page.body.matchAll(/(?<!!)\[[^\]]*\]\(([^)]+)\)/g)) {
        const href = m[1];
        expect(href.startsWith("https://") || href.startsWith(`#${GUIDE_PREFIX}`), `${page.slug}: ${href}`).toBe(true);
      }
    }
  });
});

describe("the guide rewrites", () => {
  it("turns every wikilink form into a fragment link", () => {
    expect(rewriteWikilinks("see [[tables|Tables]] and [[charts]]")).toBe(
      "see [Tables](#guide/tables) and [charts](#guide/charts)",
    );
    expect(rewriteWikilinks("| [[a-b\\|A B]] |")).toBe("| [A B](#guide/a-b) |");
  });

  it("points both attachment paths at the shots folder", () => {
    expect(rewriteImages("![x](../attachments/tables.png) ![y](attachments/home.png)")).toBe(
      "![x](./shots/tables.png) ![y](./shots/home.png)",
    );
  });

  it("drops a leading frontmatter block and nothing else", () => {
    expect(stripFrontmatter("---\ntype: Note\n---\n\n# T\n\n---\nrule\n")).toBe("# T\n\n---\nrule\n");
    expect(stripFrontmatter("# T\n")).toBe("# T\n");
  });
});

// The dashboard sync (2026-10-11) made "does not synchronize dashboards" false.
describe("settings guide covers dashboard sync", () => {
  const body = GUIDE_PAGES.find((p) => p.slug === `${GUIDE_PREFIX}settings-and-logs`)!.body;
  it("no longer says dashboards are not synchronized, and describes the sync", () => {
    expect(body).not.toMatch(/does not synchroni[sz]e dashboards/i);
    for (const s of ["dashboards and apps", "Keep both", "here and on"]) expect(body).toContain(s);
  });
});

// Back-port of dev's Workspaces help, checked against clean v5's code.
describe("guide covers workspaces in full", () => {
  const page = (slug: string) => GUIDE_PAGES.find((p) => p.slug === `${GUIDE_PREFIX}${slug}`)!.body;
  it("names the dialog's ways in, tile names, arranging, Put in panel and the Option-number setting", () => {
    const body = page("workspaces");
    for (const s of [
      "**File ▸ New Workspace…**",
      "`⌥N`",
      "**Show dashboard names**",
      "12 × 12",
      "not shown in this layout",
      "**Put in panel**",
      "Settings ▸ Layout ▸ Option-number shortcuts",
      "A workspace stays on this machine",
    ]) expect(body).toContain(s);
    expect(body).not.toMatch(/Before v5\.\d/);
  });
  it("gives ⌥N a row, Arrange mode a section, and names the Workspaces dialog in Escape's rule", () => {
    const body = page("keyboard-shortcuts");
    expect(body).toMatch(/^\| `⌥N` \|/m);
    expect(body).toContain("## While arranging a workspace");
    expect(body).toMatch(/An open dialog closes\*\* —[^\n]*\*\*Workspaces\*\* dialog[^\n]*\*\*Save layout\*\*/);
  });
});

// Episode 5 introduces the Calendar view through its example dashboard.
describe("example dashboards guide documents the v5.0.0 Treasury calendar example", () => {
  const body = GUIDE_PAGES.find((p) => p.slug === `${GUIDE_PREFIX}example-dashboards`)!.body;
  it("names the file, the Calendar view and that no key is needed", () => {
    for (const s of ["## Version 5.0.0", "v5.0.0-treasury-calendar.apps.json", "**Calendar**", "no API key"]) expect(body).toContain(s);
  });
});

// The Calendar view moves a date-range widget's start/end as you page (only
// Static draws the widget's own range), so it must not claim it never fetches.
describe("the Calendar view pages say when it changes a card's date range", () => {
  for (const body of [
    GUIDE_PAGES.find((p) => p.slug === `${GUIDE_PREFIX}calendar-view`)!.body,
    TOPICS.find((t) => t.slug === "calendar-view")!.body,
  ]) {
    it("explains Static versus the paging modes", () => {
      expect(body).not.toContain("it does not acquire additional history");
      expect(body).toContain("`start_date` and `end_date`");
      expect(body).toMatch(/\*\*Static\*\* draws the widget's own range/);
    });
  }
  it("documents @ and (MIC) on the Date Expression page with the spec's examples", () => {
    const page = GUIDE_PAGES.find((p) => p.slug === `${GUIDE_PREFIX}date-expression`)!;
    for (const example of ["T-1bd(XLON)", "T-1bd@close(XNYS)", "T@09:30(XTKS)", "FQ0@open(XHKG)", "T-5bd(XLON)..T(XLON)", "Unknown calendar XNYZ"]) {
      expect(page.body, example).toContain(example);
    }
  });
});
