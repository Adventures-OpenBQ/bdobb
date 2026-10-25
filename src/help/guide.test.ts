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
    // The v3.1 snapshot is thirty-one pages (v3.0's twenty-eight, plus
    // Reference Validation, Example Dashboards and Web Preview). A
    // thirty-second is a deliberate act in the help repo and should have to
    // edit this line after a sync.
    expect(GUIDE_PAGES).toHaveLength(31);
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
