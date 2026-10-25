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
    // Added v4 Calendar and Linked Widgets, v5 Workspace/Statement pages, and v6's three Rita/AI pages, are deliberate.
    expect(GUIDE_PAGES).toHaveLength(39);
  });

  it("gives every page a title from its own H1, with the frontmatter gone", () => {
    for (const page of GUIDE_PAGES) {
      expect(page.title, page.slug).not.toBe("");
      expect(page.body.startsWith(`# ${page.title}`), page.slug).toBe(true);
      expect(page.body.startsWith("---"), page.slug).toBe(false);
    }
  });

  // Review P3: Help describes released tags only, never a working branch.
  it("cites no working branch", () => {
    for (const page of GUIDE_PAGES) expect(page.body, page.slug).not.toMatch(/`claude\/|on `[a-z]+\/[\w.-]+` branch/);
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

describe("v6 Rita pages", () => {
  const page = (slug: string) => GUIDE_PAGES.find(p => p.slug === `${GUIDE_PREFIX}${slug}`)?.body ?? "";
  it("lists the three Rita/AI pages", () => {
    for (const slug of ["rita-ai-agent-setup", "rita-chat", "ai-library"]) expect(page(slug)).not.toBe("");
  });
  it("states the real tool surface and limits", () => {
    const setup = page("rita-ai-agent-setup");
    expect(setup).toMatch(/17 local tools/);
    expect(setup).not.toMatch(/four tools/i);
    expect(setup).toMatch(/default 40/);
    expect(setup).toMatch(/1.{1,3}40/);
    expect(setup).toContain("server-execution-pending");
    expect(setup).toContain("<your-tailnet>");
    expect(setup).not.toMatch(/\.ts\.net/);
  });
  it("explains MCP 2.0.1 proxying and per-tool disable", () => {
    const ai = page("ai-library");
    expect(ai).toContain("call_tool");
    expect(ai).toMatch(/disabl\w+ `?call_tool`? or `?run_pipeline`? itself disables that proxy wholesale/i);
    expect(ai).toContain("run_pipeline");
    expect(ai).toMatch(/Tools called through proxies/);
    expect(ai).not.toMatch(/only (the )?advertised/i);
    expect(ai).not.toMatch(/activate_(category|tools)/);
  });
  it("covers context sharing, Stop and Undo in the chat page", () => {
    const chat = page("rita-chat");
    for (const s of ["Context sharing", "Stop", "Undo", "what is sent"]) expect(chat).toContain(s);
  });
  it("never names the product BDOBB2 in reader text", () => {
    for (const slug of ["rita-ai-agent-setup", "rita-chat", "ai-library"]) expect(page(slug)).not.toMatch(/\bBDOBB2\b|bdobb-v2/);
  });
  it("names managed server tables wherever Rita's table tools are scoped (since v6), and the LIVE refusal", () => {
    const all = [...GUIDE_PAGES, ...TOPICS].map((p) => `${p.slug}\n${p.body}`).join("\n====\n");
    expect(all).not.toMatch(/CSV\/XLS (tables )?and linked tables/);
    expect(all).not.toMatch(/a CSV\/XLS table or a linked table/);
    for (const slug of ["rita-ai-agent-setup", "tables", "troubleshooting-using-bdobb", "about-this-guide"]) expect(page(slug), slug).toMatch(/managed server/);
    const rita = TOPICS.find((t) => t.slug === "rita")!.body;
    expect(rita).toMatch(/managed server/);
    for (const body of [page("rita-ai-agent-setup"), page("tables"), page("troubleshooting-using-bdobb"), rita]) expect(body).toMatch(/standard LIVE\s+table answers `?server-execution-pending/);
  });
  it("makes no stale claim anywhere in the guide or the manual", () => {
    const all = [...GUIDE_PAGES, ...TOPICS].map((p) => `${p.slug}\n${p.body}`).join("\n====\n");
    expect(all).not.toMatch(/activate_(category|tools)/);
    expect(all).not.toMatch(/four tools/i);
    expect(all).not.toMatch(/only (the )?advertised/i);
    expect(all).not.toMatch(/advertises? only|covers only (the )?advertised/i);
  });
});

describe("v6 troubleshooting and guide hunks", () => {
  const body = (slug: string) => GUIDE_PAGES.find((p) => p.slug === `${GUIDE_PREFIX}${slug}`)!.body;
  it("troubleshooting covers the v6 Rita failure modes", () => {
    const t = body("troubleshooting-using-bdobb") + body("troubleshooting-infrastructure");
    for (const s of ["fresh chat", "rejected", "round limit", "keepalive", "MCP", "private network", "server-execution-pending"]) expect(t).toContain(s);
  });
  it("guide pages mention v6.0.0 consistently", () => {
    expect(body("home")).toMatch(/version 6\.0\.0/);
  });
  it("no longer claims the app has no AI side", () => {
    const all = GUIDE_PAGES.map((p) => p.body).join("\n");
    expect(all).not.toMatch(/no chat pane in the app|has no chat pane|There is no AI side/i);
  });
  it("lists the AI Library and the chat file beside the other app data", () => {
    const data = body("app-data-and-settings");
    expect(data).toContain("chat.json");
    expect(data).toContain("mcpTokens.json");
    expect(data).toContain("ai-library.json");
  });
  it("keeps the Rita shortcut in the shortcut table", () => {
    expect(body("keyboard-shortcuts")).toContain("⌘⇧A");
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
