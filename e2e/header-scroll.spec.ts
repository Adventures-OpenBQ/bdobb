// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// PR #88 port: V3 has native date inputs rather than main's later calendar picker.
import { expect, test } from "@playwright/test";
import { dashboardSeed, seedApp, seedCards } from "./fixtures";

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


test("overflowing ordinary title controls accept mouse focus and persist select edits", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 844 });
  const seed = dashboardSeed([{
    id: "c-echo", widgetId: "param_echo", backendId: "builtin",
    params: { ticker: "AAPL", date: "2026-10-03", year: "2023" },
    layout: { x: 0, y: 0, w: 20, h: 8 },
  }]);
  seed["backends.json"] = "[]";
  await seedApp(page, seed);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const card = page.locator(".widget-card");
  const strip = card.locator(".card-chips");
  await card.evaluate(async el => {
    await Promise.all((el.closest(".react-grid-item") ?? el).getAnimations({subtree: true})
      .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => undefined)));
  });
  const year = strip.getByRole("combobox", { name: "Year", exact: true });
  await expect(year).toHaveValue("2023");
  await expect(strip).toHaveClass(/card-chips-overflowing/);
  await year.evaluate(el => {
    const strip = el.closest(".card-chips") as HTMLElement;
    const view = strip.getBoundingClientRect(), box = el.getBoundingClientRect();
    strip.scrollLeft += box.left + box.width / 2 - (view.left + view.width / 2);
  });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await test.info().attach("ordinary-control-hit", {contentType: "application/json", body: JSON.stringify(await year.evaluate(el => {
    const strip = el.closest(".card-chips") as HTMLElement, box = el.getBoundingClientRect(), view = strip.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {box: box.toJSON(), viewport: view.toJSON(), scrollLeft: strip.scrollLeft, clientWidth: strip.clientWidth,
      clientHeight: strip.clientHeight, offsetHeight: strip.offsetHeight, paddingBottom: getComputedStyle(strip).paddingBottom,
      hitTag: hit?.tagName, hitClass: hit?.getAttribute("class"), containsHit: el.contains(hit)};
  }))});
  await expect.poll(() => year.evaluate(el => {
    const box = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
  })).toBe(true);
  const box = (await year.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(year).toBeFocused();
  // WebKit's native SELECT menu keyboard behavior differs in headless runs.
  // Use its select driver only after the actual mouse hit/focus has succeeded.
  await page.keyboard.press("Escape");
  await year.selectOption("2024");
  await expect(card.locator('dd[aria-label="year"]')).toHaveText("2024");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.__bdobb!.read!("dashboards/d1.json")!).tabs[0].cards[0].params.year)).toBe("2024");
  await page.setViewportSize({ width: 1920, height: 844 });
  await expect(strip).not.toHaveClass(/card-chips-overflowing/);
  expect(await strip.evaluate(el => getComputedStyle(el).paddingBottom)).toBe("0px");
});
