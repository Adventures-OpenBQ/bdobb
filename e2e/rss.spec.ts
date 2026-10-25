// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Page } from "@playwright/test";
import { MOCK_URL, seedApp, type SeedFiles } from "./fixtures";

const FEED_URL = `${MOCK_URL}/feed.xml`;

/**
 * An empty tab, so the card added from the library is the only one on the
 * dashboard and lands at the top of the grid. defaultSeed's two cards would
 * push it below the fold, where a click has to scroll first.
 */
function emptySeed(): SeedFiles {
  const backends = [
    { id: "b1", name: "Mock", baseUrl: MOCK_URL, authLocation: "header", validateWidgets: false },
  ];
  const dashboard = {
    id: "d1",
    name: "Main",
    tabs: [{ id: "t1", name: "Main", cards: [] }],
  };
  return {
    "settings.json": "{}",
    "backends.json": JSON.stringify(backends),
    "dashboards/d1.json": JSON.stringify(dashboard),
  };
}

/** Every GET the page made for the feed, in order. */
function trackFeedRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname === "/feed.xml" && req.method() === "GET") seen.push(url.href);
  });
  return seen;
}

test("an RSS card added from the library renders the feed and re-requests on Refresh", async ({
  page,
}) => {
  const feed = trackFeedRequests(page);
  await seedApp(page, emptySeed());

  // Add the built-in. A double click adds immediately and closes the library;
  // a single click would wait out WidgetLibrary's 250 ms double-click window.
  await page.keyboard.press("Meta+k");
  const overlay = page.getByRole("dialog", { name: "Widget library" });
  await overlay.waitFor();
  await overlay.getByRole("button", { name: "Add RSS feed" }).dblclick();

  const card = page.locator(".widget-card").filter({ hasText: "RSS feed" });
  await card.waitFor();

  // Nothing is requested until the card has a URL to request.
  await expect(card.getByText("Enter a feed URL above.")).toBeVisible();
  expect(feed).toEqual([]);

  await card.getByLabel("Feed URL", { exact: true }).fill(FEED_URL);
  await card.getByLabel("Feed URL", { exact: true }).press("Enter");

  // The headlines are the feed's, in the feed's order, and the channel title
  // stamps every row.
  await expect(card.locator(".rss-title")).toHaveText([
    "Rates hold steady",
    "Second story",
    "Third story",
  ]);
  // The item with no <pubDate> shows the dash rather than an epoch date.
  await expect(card.locator(".rss-meta").nth(1)).toHaveText("Fixture Wire · —");

  // Measured, not assumed: `vite --mode browser` runs with React StrictMode
  // on, which double-invokes the mount effect (e2e/grouping.spec.ts documents
  // the same thing). What matters is that Refresh adds exactly one more.
  const before = feed.length;
  expect(before).toBeGreaterThan(0);

  await card.getByRole("button", { name: "Refresh" }).click();

  await expect.poll(() => feed.length, { timeout: 5000 }).toBe(before + 1);
  expect(feed.at(-1)).toBe(FEED_URL);
});

test("a card pointed at a body that is not a feed says so, and Retry re-requests", async ({
  page,
}) => {
  // /widgets.json is a real route serving real JSON -- the shortest way to
  // hand the renderer a 200 whose body is not XML at all.
  const notAFeed = `${MOCK_URL}/widgets.json`;
  const dashboard = {
    id: "d1",
    name: "Main",
    tabs: [
      {
        id: "t1",
        name: "Main",
        cards: [
          {
            id: "c-rss",
            widgetId: "rss",
            backendId: "builtin",
            params: { url: notAFeed, limit: "20" },
            layout: { x: 0, y: 0, w: 20, h: 12 },
          },
        ],
      },
    ],
  };
  await seedApp(page, { ...emptySeed(), "dashboards/d1.json": JSON.stringify(dashboard) });

  const card = page.locator(".widget-card").filter({ hasText: "RSS feed" });
  await expect(card.getByRole("alert")).toHaveText(/Not an RSS or Atom feed/);
  await expect(card.getByRole("button", { name: "Retry" })).toBeVisible();
});
