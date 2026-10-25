// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Page } from "@playwright/test";
import { MOCK_URL, memfs, seedApp, type SeedFiles } from "./fixtures";

/** An empty tab so the added card lands at the top of the grid (see rss.spec). */
function emptySeed(): SeedFiles {
  const backends = [
    { id: "b1", name: "Mock", baseUrl: MOCK_URL, authLocation: "header", validateWidgets: false },
  ];
  const dashboard = { id: "d1", name: "Main", tabs: [{ id: "t1", name: "Main", cards: [] }] };
  return {
    "settings.json": "{}",
    "backends.json": JSON.stringify(backends),
    "dashboards/d1.json": JSON.stringify(dashboard),
  };
}

const article = (id: number, feed_id: number, title: string) => ({
  id,
  feed_id,
  title,
  link: `https://story.example/${id}`,
  author: null,
  published_at: null,
  sort_at: 1_756_800_000 + id,
});

/**
 * The ticker, faked at the page's edge: the websocket answers the first
 * frame with feed records (ids in subscribe order) and then pushes one
 * article; the REST seed serves two. No real server is involved.
 */
async function fakeTicker(page: Page): Promise<void> {
  await page.routeWebSocket(`${MOCK_URL.replace(/^http/, "ws")}/ws/news`, (ws) => {
    ws.onMessage((raw) => {
      const frame = JSON.parse(String(raw)) as { subscribe?: { url: string; name?: string }[] };
      if (!frame.subscribe) return;
      ws.send(
        JSON.stringify({
          feeds: frame.subscribe.map((f, i) => ({ id: i + 1, url: f.url, title: f.name ?? null, favicon: null })),
        }),
      );
      ws.send(JSON.stringify(article(3, 1, "Pushed: Fed holds")));
    });
  });
  await page.route(`${MOCK_URL}/api/news*`, (route) =>
    route.fulfill({ json: { articles: [article(1, 1, "Rates hold steady"), article(2, 2, "A Substack note")], next_cursor: null } }),
  );
}

test("a News card is configured from the card menu, filters by tab, and opens a story on double-click", async ({ page }) => {
  await fakeTicker(page);
  await seedApp(page, emptySeed());

  await page.keyboard.press("Meta+k");
  const overlay = page.getByRole("dialog", { name: "Widget library" });
  await overlay.waitFor();
  await overlay.getByRole("button", { name: "Add News" }).dblclick();

  const card = page.locator(".widget-card.card-rail");
  await card.waitFor();
  await expect(card.getByText("Enter the RSS Aggregator server in Parameters.")).toBeVisible();

  // The ⋯ menu is portalled into <body> (MenuPanel), so its items are found
  // on the page, not inside the card.
  await card.getByRole("button", { name: "Card menu" }).click();
  await page.getByRole("menuitem", { name: "Parameters" }).click();
  // exact: the carry's ParamControls renders a group chain-link beside the
  // field, labelled "Group RSS Aggregator Server", which a loose match takes too.
  const server = card.getByLabel("RSS Aggregator Server", { exact: true });
  await server.fill(MOCK_URL);
  // Enter, not an Apply button: v5.5.0's chips row committed every typed
  // control on blur or Enter and dropped the panel's Apply, so there is no
  // longer a button to press. Same as e2e/card.spec.ts and grouping.spec.ts.
  await server.press("Enter");
  await expect(card.getByRole("button", { name: "Configure feeds…" })).toBeVisible();

  // The panel closes from the same menu item, which says so while it is open:
  // it is clean's docked, saved Parameters panel, toggled by hand.
  await card.getByRole("button", { name: "Card menu" }).click();
  await page.getByRole("menuitem", { name: "Hide parameters" }).click();
  await expect(card.getByLabel("RSS Aggregator Server", { exact: true })).toHaveCount(0);

  await card.getByRole("button", { name: "Card menu" }).click();
  await expect(page.getByRole("menuitem", { name: "Parameters" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Configure feeds…" }).click();
  const dialog = page.getByRole("dialog", { name: "Configure feeds" });
  await dialog.getByRole("button", { name: "Add feed" }).click();
  await dialog.getByRole("textbox", { name: "Feed 1 source" }).fill("https://a.example/feed");
  await dialog.getByRole("textbox", { name: "Feed 1 name" }).fill("Wire");
  await dialog.getByRole("textbox", { name: "Feed 1 tab" }).fill("Wires");
  await dialog.getByRole("button", { name: "Add feed" }).click();
  await dialog.getByRole("textbox", { name: "Feed 2 source" }).fill("https://s.example/feed");
  await dialog.getByRole("textbox", { name: "Feed 2 tab" }).fill("Substack");
  await dialog.getByRole("button", { name: "Done" }).click();

  // All: the pushed article and both seeded ones, newest first.
  await expect(card.getByRole("tab")).toHaveText(["All", "Wires", "Substack"]);
  await expect(card.locator(".news-title")).toHaveText(["Pushed: Fed holds", "A Substack note", "Rates hold steady"]);
  await expect(card.getByRole("img", { name: "live" })).toBeVisible();

  await card.getByRole("tab", { name: "Substack" }).click();
  await expect(card.locator(".news-title")).toHaveText(["A Substack note"]);

  // The feed list is on the card, in the dashboard file, not anywhere else.
  const stored = JSON.parse((await memfs(page).read("dashboards/d1.json"))!);
  expect(stored.tabs[0].cards[0].news.feeds).toEqual([
    { url: "https://a.example/feed", name: "Wire", tab: "Wires" },
    { url: "https://s.example/feed", name: "", tab: "Substack" },
  ]);

  await card.locator(".news-row").first().dblclick();
  await expect.poll(() => memfs(page).opened()).toEqual(["https://story.example/2"]);
});
