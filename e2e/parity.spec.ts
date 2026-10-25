// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from "@playwright/test";
import { dashboardSeed, defaultSeed, memfs, seedApp } from "./fixtures";

test("⌘K opens the widget library", async ({ page }) => {
  await seedApp(page);
  await page.locator(".widget-card").first().waitFor();
  await expect(page.getByRole("dialog", { name: "Widget Library" })).toHaveCount(0);

  await page.keyboard.press("Meta+k");

  await expect(page.getByRole("dialog", { name: "Widget Library" })).toBeVisible();
});

test("Export → CSV writes RFC-4180 text carrying the raw values", async ({ page }) => {
  await seedApp(page);
  const card = page.locator(".widget-card").filter({ hasText: "Quote" });
  await card.locator("table").waitFor();

  await card.getByRole("button", { name: "Card menu" }).click();
  await page.getByRole("menuitem", { name: /^Export/ }).click();
  await page.getByRole("menuitem", { name: "CSV" }).click();

  // The shim's save() answers /exports/<the suggested name>, which carries
  // today's date — so find it rather than spelling it out.
  const fs = memfs(page);
  await expect.poll(() => fs.list().then((f) => f.filter((p) => p.startsWith("exports/")))).toHaveLength(1);
  const [written] = (await fs.list()).filter((p) => p.startsWith("exports/"));
  expect(written).toMatch(/^exports\/Quote symbol=AAPL \d{4}-\d{2}-\d{2}\.csv$/);
});

test("↻ refetches every card on the active tab and nothing on any other tab", async ({ page }) => {
  const seed = dashboardSeed([], {
    tabs: [
      {
        id: "t1",
        name: "First",
        cards: [
          { id: "c-a", widgetId: "quote", backendId: "b1", params: { symbol: "AAPL" }, layout: { x: 0, y: 0, w: 20, h: 9 } },
        ],
      },
      {
        id: "t2",
        name: "Second",
        cards: [
          { id: "c-b", widgetId: "quote", backendId: "b1", params: { symbol: "MSFT" }, layout: { x: 0, y: 0, w: 20, h: 9 } },
        ],
      },
    ],
  });

  let quoteRequests = 0;
  await page.route("**/quote*", async (route) => {
    quoteRequests += 1;
    await route.continue();
  });

  await seedApp(page, seed);
  await page.locator(".widget-card table").first().waitFor();

  // Only the active tab's one card is mounted, so only it fetches — but
  // React 18 StrictMode (which this harness's dev server runs under) mounts
  // every component twice, so the settled count for that one card is 2 real
  // requests, not 1. Assert the delta the refresh-all click causes, not an
  // absolute count, so this stays correct if that mount behavior changes.
  await expect.poll(() => quoteRequests).toBe(2);
  const afterMount = quoteRequests;

  await page.getByRole("button", { name: "Refresh all" }).click();

  await expect.poll(() => quoteRequests).toBe(afterMount + 1);
  // Give a wrongly-scoped bump a chance to reach the other tab's card before
  // asserting it did not.
  await page.waitForTimeout(500);
  expect(quoteRequests).toBe(afterMount + 1);
});

test("↻ sits at the right end of the tab bar, immediately left of the quick-add +", async ({ page }) => {
  // Pure CSS placement (.tab-bar .refresh-all takes the flex row's auto
  // margin), so jsdom -- which computes no layout -- cannot assert it. Real
  // Chromium can.
  await seedApp(page, { ...defaultSeed(), "settings.json": JSON.stringify({ quickAddToolbar: true }) });
  await page.locator(".widget-card").first().waitFor();

  // Scoped to the tab bar: the rail carries an "Add widget" button of its
  // own, so a page-wide locator is a strict-mode violation.
  const tabBar = page.locator(".tab-bar");
  const bar = await tabBar.boundingBox();
  const lastTab = await tabBar.getByRole("tab").last().boundingBox();
  const refresh = await tabBar.getByRole("button", { name: "Refresh all" }).boundingBox();
  const quickAdd = await tabBar.getByRole("button", { name: "Add widget" }).boundingBox();
  if (!bar || !lastTab || !refresh || !quickAdd) throw new Error("tab bar not laid out");

  // Right of the last tab, and left of the +.
  expect(refresh.x).toBeGreaterThan(lastTab.x + lastTab.width);
  expect(refresh.x + refresh.width).toBeLessThanOrEqual(quickAdd.x + 1);

  // The point of the auto margin: ↻ is pushed to the RIGHT END, adjacent to
  // the +, not left stranded in the middle of the bar next to the tabs.
  const gapToPlus = quickAdd.x - (refresh.x + refresh.width);
  expect(gapToPlus).toBeLessThan(24);
  expect(refresh.x).toBeGreaterThan(bar.x + bar.width / 2);
});
