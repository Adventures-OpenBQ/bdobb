// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from "@playwright/test";
import { seedCards } from "./fixtures";

// HEADER_WEBKIT=1 runs the same layout contract in the iPadOS rendering engine.
test.use({ browserName: process.env.HEADER_WEBKIT ? "webkit" : "chromium", viewport: { width: 1024, height: 768 }, hasTouch: true });

test("header parameters scroll without wrapping or moving the title and actions", async ({ page }) => {
  await seedCards(page, [{
    id: "c-cal", widgetId: "calendar_table", backendId: "b1",
    params: { symbol: "AAPL", trade: "T-1bd" },
    layout: { x: 0, y: 0, w: 20, h: 12 },
  }]);
  const card = page.locator('[data-card-id="c-cal"]');
  const chips = card.locator(".card-chips");
  await expect(chips.locator(".param-field")).toHaveCount(2);
  await expect.poll(() => chips.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await expect(card.locator("tbody tr[data-index]").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const title = await card.locator(".card-title").boundingBox();
  const actions = await card.locator(".card-controls").boundingBox();
  const fields = await chips.locator(".param-field").evaluateAll(els => els.map(el => el.getBoundingClientRect().top));
  expect(Math.abs(fields[0]! - fields[1]!)).toBeLessThan(10);
  await chips.evaluate(el => { el.scrollLeft = el.scrollWidth; });
  expect(await chips.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  expect(await card.locator(".card-title").boundingBox()).toEqual(title);
  const after = await card.locator(".card-controls").boundingBox();
  expect(Math.abs(after!.x + after!.width - actions!.x - actions!.width)).toBeLessThanOrEqual(1);
  expect(after!.y).toBe(actions!.y);
  // A picker opened from the scroller must escape its clipping boundary.
  await chips.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("declared parameter rows remain separate inside the scroller", async ({ page }) => {
  await page.route("**/widgets.json", async route => {
    const response = await route.fetch();
    const widgets = await response.json();
    widgets.calendar_table.params = [widgets.calendar_table.params[0], [widgets.calendar_table.params[1]]];
    await route.fulfill({ response, json: widgets });
  });
  await seedCards(page, [{
    id: "c-cal", widgetId: "calendar_table", backendId: "b1",
    params: { symbol: "AAPL", trade: "T-1bd" },
    layout: { x: 0, y: 0, w: 20, h: 12 },
  }]);
  const chips = page.locator('[data-card-id="c-cal"] .card-chips');
  const fields = chips.locator(".param-field");
  await expect(fields).toHaveCount(2);
  const first = await fields.nth(0).boundingBox();
  const second = await fields.nth(1).boundingBox();
  expect(second!.y).toBeGreaterThanOrEqual(first!.y + first!.height);
  expect(second!.x).toBe(first!.x);
  await chips.getByRole("button", { name: "Group Symbol", exact: true }).click();
  await expect(page.getByRole("menu")).toBeVisible();
});
