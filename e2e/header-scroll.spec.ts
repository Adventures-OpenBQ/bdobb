// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// PR #88 port: V3 has native date inputs rather than main's later calendar picker.
import { expect, test } from "@playwright/test";
import { seedCards } from "./fixtures";

test.use({ browserName: process.env.HEADER_WEBKIT ? "webkit" : "chromium", viewport: { width: 1280, height: 800 }, hasTouch: true });

async function header(page: import("@playwright/test").Page, rows: boolean | "deferred" = false, collapsed = false) {
  await page.route("**/widgets.json", async route => {
    const response = await route.fetch();
    const widgets = await response.json();
    const params = Array.from({length: 6}, (_, i) => ({paramName: `field${i}`, label: `Field ${i}`, type: "text", value: `Value ${i}`}));
    widgets.quote.params = rows === "deferred" ? [[], params] : rows ? [params[0], params.slice(1)] : params;
    await route.fulfill({response, json: widgets});
  });
  await seedCards(page, [{id: "c-scroll", widgetId: "quote", backendId: "b1", params: {}, layout: {x: 0, y: 0, w: 24, h: 12}}], {"settings.json": JSON.stringify({collapseWidgetControls: collapsed})});
  const card = page.locator('.widget-card');
  await expect(card.locator("tbody tr[data-index]").first()).toBeVisible();
  return card;
}

test("PR88: compact header scrolls without moving title or actions", async ({page}) => {
  const card = await header(page);
  const chips = card.locator(".card-chips");
  await expect(chips.locator(".param-field")).toHaveCount(6);
  await expect.poll(() => chips.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await card.evaluate(async el => { await Promise.all((el.closest(".react-grid-item") ?? el).getAnimations({subtree: true}).filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => undefined))); });
  const title = await card.locator(".card-title").boundingBox();
  const textWidth = await card.locator('.card-title').evaluate(el => { const range=document.createRange();range.selectNodeContents(el);return range.getBoundingClientRect().width; });
  expect(title!.width).toBeLessThanOrEqual(textWidth + 2);
  const close = card.getByRole("button", {name: "Remove card", exact: true});
  const action = await close.boundingBox();
  expect((await card.locator(".card-header").boundingBox())!.height).toBeLessThanOrEqual(48);
  await chips.evaluate(el => {el.scrollLeft = el.scrollWidth;});
  expect(await chips.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  for (const [before, after] of [[title, await card.locator(".card-title").boundingBox()], [action, await close.boundingBox()]]) {
    for (const key of ["x", "y", "width", "height"] as const) expect(Math.abs(after![key] - before![key])).toBeLessThanOrEqual(1);
  }
  const group = chips.getByRole("button", {name: "Group Field 5", exact: true});
  if (process.env.HEADER_WEBKIT) await group.tap(); else await group.click();
  await expect(page.getByRole("menu")).toBeVisible();
});

test("PR88: rows above zero are deferred to the parameter card", async ({page}) => {
  const card = await header(page, true);
  await expect(card.locator(".card-header .param-field")).toHaveCount(1);
  await expect(card.locator(".card-header").getByLabel("Field 1", {exact: true})).toHaveCount(0);
  expect((await card.locator(".card-header").boundingBox())!.height).toBeLessThanOrEqual(48);
  await card.getByRole("button", {name: "Show parameters", exact: true}).click();
  const panel = card.getByRole("region", {name: "Parameters", exact: true});
  await expect(panel.getByLabel("Field 1", {exact: true})).toBeVisible();
  await panel.getByLabel("Field 1", {exact: true}).fill("changed");
  await panel.getByLabel("Field 1", {exact: true}).press("Enter");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.__bdobb!.read!("dashboards/d1.json")!).tabs[0].cards[0].params.field1)).toBe("changed");
  await card.getByRole("button", {name: "Hide parameters", exact: true}).click();
  await expect(panel).toHaveCount(0);
});

test("PR88: collapsed controls hide the parameter strip until opened", async ({page}) => {
  const card = await header(page, false, true);
  await expect(card.locator(".card-chips")).toBeHidden();
  await card.getByRole("button", {name: "Show widget controls", exact: true}).click();
  await expect(card.locator(".card-chips")).toBeVisible();
});

test("a widget with no row zero keeps every field in the parameter card", async ({page}) => {
  const card = await header(page, "deferred");
  await expect(card.locator(".card-header .param-field")).toHaveCount(0);
  await card.getByRole("button", {name: "Show parameters", exact: true}).click();
  await expect(card.getByRole("region", {name: "Parameters", exact: true}).locator(".param-field")).toHaveCount(6);
});
