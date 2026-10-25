// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
    // Added v4 Calendar and v5 Workspace/Statement pages, v6's three Rita/AI pages, v7's two iPad pages, and v8's News and Locked and Pinned Widgets pages, are deliberate; so is v4's Linked Widgets page.
    expect(GUIDE_PAGES).toHaveLength(46);
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
    expect(setup).toMatch(/18 local tools/);
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
  it("guide pages mention v10.0.0 consistently", () => {
    expect(body("home")).toMatch(/version 10\.0\.0/);
    expect(body("about-this-guide")).toMatch(/clean BDOBB \*\*v10\.0\.0\*\*/);
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

describe("v7 example dashboard in the guide", () => {
  const body = GUIDE_PAGES.find((p) => p.slug === `${GUIDE_PREFIX}example-dashboards`)!.body;
  it("documents the v7.0.0 touch example", () => {
    expect(body).toContain("Example Dashboard - Version 7.0.0");
    expect(body).toContain("v7.0.0-touch.apps.json");
  });

  // bdobb#42: the example's gesture note and the iPad topic restore a card the same way.
  it("restores a maximized card the way the iPad topic does", () => {
    const ipad = TOPICS.find((t) => t.slug === "ipad")!.body;
    const example = readFileSync(resolve(__dirname, "../../docs/examples/v7.0.0-touch.apps.json"), "utf8");
    // U5: a double-tap on the TITLE renames (WidgetCard); the header's empty
    // background, or ⤢, is what maximizes. The old assertions locked in the
    // sentence that said otherwise.
    expect(ipad).toContain("**Double-tap** the empty background of a card's header, or tap `⤢`, to maximize the card; double-tap again, or tap `⤡`, to restore it.");
    expect(example).toContain("**Double-tap** a card header's empty background, or tap ⤢, to maximize, and again to restore.");
    expect(example).not.toContain("**Escape**");
  });
});

describe("v7 iPad guide pages", () => {
  const page = (slug: string) => GUIDE_PAGES.find((p) => p.slug === `${GUIDE_PREFIX}${slug}`);
  it("lists both pages under the guide's iPad section", () => {
    expect(page("installing-on-ipad")?.title).toBe("Installing on iPad");
    expect(page("ipad-interface-differences")?.title).toBe("iPad interface differences");
    const ipad = GUIDE_SECTIONS.find((s) => s.title === "iPad");
    expect(ipad?.pages.map((p) => p.slug)).toEqual([`${GUIDE_PREFIX}installing-on-ipad`, `${GUIDE_PREFIX}ipad-interface-differences`]);
  });
  it("covers the gates, the free tier and the device push with clean's names", () => {
    const install = page("installing-on-ipad")?.body ?? "";
    const ui = page("ipad-interface-differences")?.body ?? "";
    expect(install).toContain("Developer Mode");
    expect(install).toMatch(/free Apple ID/i);
    expect(install).toMatch(/7 days/);
    expect(install).toContain("pnpm ios:sim");
    expect(ui).toContain("xcrun devicectl device copy to");
    expect(ui).toContain("com.artcashin.bdobb");
    expect(ui).toMatch(/not supported/);
    expect(ui).toContain("**Double-tap** the empty background of a card's header, or tap `⤢`, to maximize the card; double-tap again, or tap `⤡`, to restore it.");
    for (const body of [install, ui]) {
      expect(body).not.toMatch(/\bBDOBB2\b|bdobb-v2|com\.artcashin\.bdobb2/);
      expect(body).not.toMatch(/Escape/);
    }
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

// v8: News (desktop and the web relay), pinned cards, locked widgets and the
// docks sync, Rita's pin_card, openbq-docker v8's web profile, and the rail's
// "Add widget (⌘K)" row gone (R5).
describe("v8 guide pages", () => {
  const page = (slug: string) => GUIDE_PAGES.find((p) => p.slug === `${GUIDE_PREFIX}${slug}`)?.body ?? "";
  it("lists the News and the locked-and-pinned pages under Widgets", () => {
    const widgets = GUIDE_SECTIONS.find((s) => s.title === "Widgets");
    const slugs = widgets?.pages.map((p) => p.slug) ?? [];
    expect(slugs).toContain(`${GUIDE_PREFIX}news-widget`);
    expect(slugs).toContain(`${GUIDE_PREFIX}locked-and-pinned-widgets`);
  });
  it("covers the News card, its server and the preview's relay", () => {
    const news = page("news-widget");
    for (const s of ["**RSS Aggregator Server**", "**Configure feeds…**", "`rss-agg.json`", "rss-ticker", "8088", "`/news`", "ticket"]) expect(news).toContain(s);
    // A desktop-only card starts rss-ticker alone: the web profile needs the door's files.
    for (const s of ["`cp rss-ticker-config/config.yaml.example rss-ticker-config/config.yaml`", "`docker compose up -d rss-ticker`", "`serve-v3-keys.json`", "at most the first 50", "**starts empty**"]) expect(news).toContain(s);
    expect(news).not.toContain("wrapping back to the start at the end");
  });
  it("covers pinning, the Locked Widgets editor, the docks sync and the import guard", () => {
    const body = page("locked-and-pinned-widgets");
    expect(body).toContain("**up to 40% of the dashboard area**");
    expect(body).not.toContain("The band starts exactly as tall");
    for (const s of ["**Pin widget ▸**", "**Settings ▸ Locked Widgets**", "**OK**", "**Cancel**", "/pro/dash/sync/system/docks", "**Replace**", "**Keep mine**", "no shared example dashboard carries locked widgets", "`pin_card`"]) {
      expect(body).toContain(s);
    }
  });
  it("lists Live TV under Widgets and covers turning it on, connecting and off-air", () => {
    const widgets = GUIDE_SECTIONS.find((s) => s.title === "Widgets");
    expect(widgets?.pages.map((p) => p.slug)).toContain(`${GUIDE_PREFIX}live-tv`);
    const body = page("live-tv");
    for (const s of ["`live_tv:`", "`rss-ticker-config/config.yaml`", "8088", "**Channel**", "*Select a video in the widget's parameters.*", "`127.0.0.1`"]) expect(body).toContain(s);
  });
  it("lists pin_card among Rita's tools", () => {
    expect(page("rita-ai-agent-setup")).toContain("| `pin_card` |");
  });
  it("describes openbq-docker v8's web profile and the vendoring source", () => {
    const stack = page("openbq-docker-stack");
    for (const s of ["openbq-docker v8.0.0", "`web` compose profile", "funnel-gateway", "rss-ticker", "**`/api`**", "**`/news`**", "**`/state`**", "no `/ai`", "`OPENBQ_DOCKER_DIR`", "`openbqDocker`"]) {
      expect(stack).toContain(s);
    }
    expect(stack).toContain("`docker compose up -d rss-ticker`");
    expect(stack).toContain("`serve-v3-keys.json`");
    expect(stack).toContain("**`/ref`**");
    expect(page("about-this-guide")).toContain("`scripts/gateway-vendor.mjs`");
    expect(page("about-this-guide")).not.toContain("There is no news wire");
    const preview = page("web-preview");
    expect(preview).toContain("openbq-docker v8.0.0");
    expect(preview).not.toContain("no socket route yet");
    expect(preview).not.toContain("exactly one origin");
    expect(preview).not.toContain("openbb-api");
  });
  it("no longer describes the rail's Add widget (⌘K) row", () => {
    for (const p of GUIDE_PAGES) expect(p.body, p.slug).not.toContain("Add widget (⌘K)");
  });
});

describe("example dashboards guide documents the v8.0.0 examples", () => {
  const body = GUIDE_PAGES.find((p) => p.slug === `${GUIDE_PREFIX}example-dashboards`)!.body;
  it("names both v8 files, the minimum version, and why no example carries locked widgets", () => {
    for (const s of ["## Example Dashboard - Version 8.0.0", "v8.0.0-news.apps.json", "v8.0.0-pinned.apps.json", "BDOBB 8.0.0 or later", "**No example carries locked widgets.**"]) {
      expect(body).toContain(s);
    }
  });
});

describe("example dashboards guide documents the v9.0.0 example", () => {
  const body = GUIDE_PAGES.find((p) => p.slug === `${GUIDE_PREFIX}example-dashboards`)!.body;
  it("names the v9 file, its widgets, its key and the minimum version", () => {
    for (const s of [
      "## Example Dashboard - Version 9.0.0 - Calendars",
      "v9.0.0-calendars.apps.json",
      "BDOBB 9.0.0 or later",
      "`EODHD_API_KEY`",
      "`eodhd_economy_calendar_eodhd_obb`",
      "`ustreasury_auction_results_us_treasury_obb`",
    ]) {
      expect(body).toContain(s);
    }
    // Up to 8.0.0 every example opened keyless; 9.0.0 is the first that does not.
    expect(body).not.toContain("each opens with nothing entered");
  });
});

describe("the v9 EODHD guide page", () => {
  const page = (slug: string) => GUIDE_PAGES.find((p) => p.slug === `${GUIDE_PREFIX}${slug}`)!.body;
  it("is listed under Integrations and states what BDOBB does with EODHD data", () => {
    const body = page("eodhd-data-provider");
    // REVIEW (user ruling 2026-10-14): the extension is openbq-eodhd (Adventures-OpenBQ/openbq-eodhd), was `openbb-eodhd`; same pin, new name.
    for (const s of ["# EODHD Data", "`openbq-eodhd`", "`EODHD_API_KEY`", "`eodhd_equity_price_historical_eodhd_obb`", "**Source → Release → Statistic**", "`fiscal_year`", "**Use suggested**", "nothing is applied until you click", "not part of 9.0.0", "Rita reads it"]) {
      expect(body).toContain(s);
    }
    // V9-P2 (ruled 2026-10-15): Rita's table tools report the hint and warn on a contradiction.
    for (const s of ["provider's aggregation hint", "`provider-aggregation-hint`", "`provider-aggregation-applied`"]) expect(page("tables")).toContain(s);
    expect(page("home")).toContain("[EODHD Data](#guide/eodhd-data-provider)");
    expect(page("calendar-view")).toContain("(#guide/eodhd-data-provider)");
    expect(page("example-dashboards")).toContain("(#guide/eodhd-data-provider)");
  });
});

describe("the v10 live grid in the guide", () => {
  const page = (slug: string) => GUIDE_PAGES.find((p) => p.slug === `${GUIDE_PREFIX}${slug}`)!.body;
  it("Tables documents the live grid and the three new declarations as this line behaves", () => {
    const body = page("tables");
    for (const s of ["## Live grids", "`wsRowIdColumn`", "`wsEndpoint`", '`{"params": {"symbol": "…"}}`', "one row object or a list of row objects",
      "0.5, 1, 2, 4, 8, 16, 32 and then 60 seconds", "*websocket dropped:*", "*symbol_meta unavailable*", "`logo`", "`rangeBar`", "`percentKey`",
      "its `price` when the column names none", "`align`"]) {
      expect(body).toContain(s);
    }
  });
  it("Troubleshooting, Refresh, Connections and the web preview say what a live grid does", () => {
    expect(page("troubleshooting-using-bdobb")).toContain("**A Live Grid card shows its first snapshot and never ticks.**");
    expect(page("running-and-refreshing")).toContain("The automatic refresh below does not re-fetch a live grid at all.");
    expect(page("backends-and-connections")).toContain("does not reach a live grid's socket at all");
    expect(page("backends-and-connections")).toContain("single-use socket ticket (`ws_ticket`, sent with the header) before every connect");
    expect(page("web-preview")).toContain("`/grid/live_grid_ws`");
    expect(page("web-preview")).toContain("**Live quotes**");
  });
  it("the web preview and the stack page describe the openbq-docker v10.0.0 pairing as served, not pending", () => {
    const preview = page("web-preview");
    for (const s of ["openbq-docker v10.0.0", "- **`/grid`**", "`/grid/ticks`", "`/grid/series`", "`/grid/chart`", "after 60 frames", "used once already"]) {
      expect(preview).toContain(s);
    }
    expect(preview).not.toMatch(/stays off until|not yet at this version's pairing|still v8\.0\.0's/);
    // REVIEW (rebase onto release/v8): the v7 rebuild replaced the openbb-docker-stack
    // page with openbq-docker-stack, so the same three strings are pinned there.
    const stack = page("openbq-docker-stack");
    // REVIEW (user, 2026-10-14: openbq-docker v10.0.0 is tagged): the pin is the tag, not the branch commit `45c6ae1`
    // (same policy bytes), so the page names the tag and the tag-only vendor command, as at 9.0.0.
    // REVIEW (SSRM walk, user rulings 2026-10-15): each walked line pairs openbqDocker with its X commit until the tags are
    // re-cut, so the page names the commit pin and the vendor command with the commit; it names the tag form again on re-tag.
    for (const s of ["**BDOBB 10.0.0 pairs with openbq-docker v10.0.0**", "`openbqDocker` names the openbq-docker commit that the v10.0.0 tag points at", "`pnpm gateway:vendor v10.0.0`"]) expect(stack).toContain(s);
    expect(stack).not.toContain("until the `v10.0.0` tag is cut");
    expect(stack).not.toContain("Until the stack's tag is cut");
    // Review B9: the example has no ta_chart card, and the preview's CSP keeps eodhd.com's logos out.
    expect(preview).toContain("`/grid/chart` — and the tick chart's `/grid/ta_chart`");
    expect(preview).toContain("The preview shows no logos even when `symbol_meta` answers");
    // Review R2's per-user daily symbol share was removed (user ruling 2026-10-17).
    expect(preview).not.toContain("daily share");
    expect(preview).toContain("No daily or per-viewer quota applies (removed 2026-10-17)");
  });
  it("Example Dashboards names the v10 file, its five widgets, its backend and the minimum version", () => {
    const body = page("example-dashboards");
    for (const s of ["## Example Dashboard - Version 10.0.0 - Live Grid", "v10.0.0-live-grid.apps.json", "10.0.0 or later", "**live-grid**",
      "`live_grid`", "`subscriptions`", "`kdb_ticks`", "`live_chart`", "`kdb_cache_chart`", "then each trade folded into the newest bar"]) {
      expect(body).toContain(s);
    }
  });
});
