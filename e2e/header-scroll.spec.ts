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

test("Live TV keeps its channel and mute control on the same scrolling row", async ({ page }) => {
  await page.route("**/widgets.json", async route => {
    const response = await route.fetch();
    const widgets = await response.json();
    widgets.live_tv = {
      name: "Live TV", description: "Header layout fixture", type: "youtube",
      endpoint: "live_video", category: "Fixture", source: [],
      params: [{ paramName: "channel", type: "text", value: "bloomberg-tv",
        options: [{ label: "YouTube - Bloomberg Live", value: "bloomberg-tv" }] }],
    };
    await route.fulfill({ response, json: widgets });
  });
  await page.route("**/live_video?*", route => route.fulfill({
    contentType: "text/plain", body: "https://youtu.be/QB5BNdBFujE",
  }));
  await page.route("**/www.youtube.com/**", route => route.abort());
  await seedCards(page, [{ id: "tv-header", widgetId: "live_tv", backendId: "b1",
    params: { channel: "bloomberg-tv" }, layout: { x: 0, y: 0, w: 20, h: 12 } }]);
  const card = page.locator('.widget-card').first();
  const chips = card.locator('.card-chips');
  const channel = chips.locator('select');
  const mute = chips.getByRole('button', { name: 'Mute', exact: true });
  await expect(mute).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  for (const width of [1024, 640]) {
    await page.setViewportSize({ width, height: 768 });
    // react-grid-layout responds after the viewport resize. Wait for its
    // card width to settle before scrolling against the final clip width.
    let lastWidth = -1, stableWidths = 0;
    await expect.poll(async () => {
      const next = (await card.boundingBox())!.width;
      stableWidths = next === lastWidth ? stableWidths + 1 : 0;
      lastWidth = next;
      return stableWidths;
    }, { intervals: [100] }).toBeGreaterThanOrEqual(2);
    await expect.poll(async () => {
      const a = await channel.boundingBox(), b = await mute.boundingBox();
      return Math.abs(a!.y + a!.height / 2 - b!.y - b!.height / 2);
    }).toBeLessThanOrEqual(3);
    await expect.poll(() => chips.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    await chips.evaluate(el => { el.scrollLeft = el.scrollWidth; });
    await expect(mute).toBeInViewport();
    await expect(card.getByRole('button', { name: 'Show parameters', exact: true })).toHaveAttribute('aria-expanded', 'false');
  }

  // The Live TV flex layout must not override the global collapse setting.
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.locator("nav.left-rail").getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("dialog", { name: "Settings", exact: true }).getByRole("tab", { name: "Widget", exact: true }).click();
  await page.getByRole("switch", { name: "Collapse widget controls", exact: true }).click();
  await page.getByRole("dialog", { name: "Settings", exact: true }).getByRole("button", { name: "Done", exact: true }).click();
  const chevron = card.getByRole("button", { name: "Show widget controls", exact: true });
  await expect(chevron).toHaveAttribute("aria-expanded", "false");
  await expect(chips).toBeHidden();
  await chevron.click();
  await expect(chips).toBeVisible();
  await expect(channel).toHaveCount(1);
  await expect(mute).toHaveCount(1);
  await card.getByRole("button", { name: "Show parameters", exact: true }).click();
  const panel = card.getByRole("region", { name: "Parameters", exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.locator('.param-field select')).toHaveCount(0);
  await chevron.click();
  await expect(chips).toBeHidden();
  await expect(panel.locator('.param-field select')).toBeVisible();
});
