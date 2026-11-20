// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from "@playwright/test";
import { seedApp, seedCards } from "./fixtures";

// HEADER_WEBKIT=1 runs the same layout contract in the iPadOS rendering engine.
test.use({ browserName: process.env.HEADER_WEBKIT ? "webkit" : "chromium", viewport: { width: 1024, height: 768 }, hasTouch: true });

test("header parameters scroll without wrapping or moving the title and actions", async ({ page }) => {
  await seedCards(page, [{
    id: "c-cal", widgetId: "calendar_table", backendId: "b1",
    params: { symbol: "AAPL", trade: "T-1bd" },
    layout: { x: 0, y: 0, w: 20, h: 12 },
  }]);
  const card = page.locator('.widget-card').first();
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

test("only row zero stays in the title strip; later rows use the persisted panel", async ({ page }) => {
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
  const chips = page.locator('.widget-card').first().locator('.card-chips');
  const fields = chips.locator(".param-field");
  await expect(fields).toHaveCount(1);
  const card=page.locator('.widget-card').first();
  await expect(chips.getByRole('textbox', { name: 'Trade date', exact: true })).toHaveCount(0);
  await card.getByRole('button',{name:'Show parameters',exact:true}).click();
  const panel=card.getByRole('region',{name:'Parameters',exact:true});
  await expect(panel.getByRole('textbox',{name:'Trade date',exact:true})).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.__bdobb!.read!('dashboards/d1.json')!).tabs[0].cards[0].paramsOpen)).toBe(true);
  const saved=await page.evaluate(() => Object.fromEntries(window.__bdobb!.list!().map(path => [path,window.__bdobb!.read!(path)!])));
  const restored=await page.context().newPage();
  await seedApp(restored,saved);
  await expect(restored.locator('.widget-card').first().getByRole('region',{name:'Parameters',exact:true})).toBeVisible();
  await restored.close();
  await chips.getByRole("button", { name: "Group Symbol", exact: true }).click();
  await expect(page.getByRole("menu")).toBeVisible();
});
