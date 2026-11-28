// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// See-through locked bands (docs/superpowers/specs/2026-11-12-see-through-locked-bands-design.md):
// the geometry jsdom cannot lay out -- the scroll region under the band, the
// room at each end, the opening scroll under a top band, the pointer through
// empty band space, a pinned card beside the band, and the capped fallback.
import { expect, test, type Page } from "@playwright/test";
import { MOCK_URL, seedApp, type SeedFiles } from "./fixtures";

type Card = Record<string, unknown>;
const note = (id: string, y: number, over: Card = {}): Card => ({
  id, widgetId: "note", backendId: "builtin", params: {}, title: id, layout: { x: 0, y, w: 40, h: 10 }, ...over,
});
/** 30 rows of cards: taller than the 720px window, so the region scrolls. */
const tall = (p: string) => [note(`${p}-first`, 0), note(`${p}-middle`, 10), note(`${p}-last`, 20)];
/** A locked card on the band's right half; the left half is the empty space. */
const locked = (id: string, h: number): Card => ({
  id, widgetId: "note", backendId: "builtin", params: {}, title: "Locked", layout: { x: 20, y: 0, w: 20, h },
});

type Locked = { top?: Card[]; bottom?: Card[]; dockRows?: { top: number; bottom: number }; dockSeeThrough?: { top?: true; bottom?: true } };
function seed(bands: Locked, t1: Card[] = tall("a"), t2: Card[] = tall("b")): SeedFiles {
  const { top = [], bottom = [], dockRows = { top: 6, bottom: 8 }, dockSeeThrough } = bands;
  return {
    "settings.json": "{}",
    "backends.json": JSON.stringify([{ id: "b1", name: "Mock", baseUrl: MOCK_URL, authLocation: "header", validateWidgets: false }]),
    "dashboards/d1.json": JSON.stringify({ id: "d1", name: "Alpha", tabs: [{ id: "t1", name: "Main", cards: t1 }, { id: "t2", name: "Other", cards: t2 }] }),
    "dashboards/docks.json": JSON.stringify({
      id: "docks", name: "Locked widgets", hidden: true, dockRows,
      ...(dockSeeThrough ? { dockSeeThrough } : {}),
      tabs: [{ id: "top", name: "Locked at Top", cards: top }, { id: "bottom", name: "Locked at Bottom", cards: bottom }],
    }),
  };
}

const scroll = (page: Page) => page.locator("main.dashboard-area > .dashboard-scroll");
const card = (page: Page, title: string) => page.locator(".dashboard-scroll .react-grid-item", { hasText: title });
/** Whether the point hits the dashboard's scroll region rather than a band. */
const hitsDashboard = (page: Page, x: number, y: number) =>
  page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest(".dashboard-scroll, .dock-band")?.classList.contains("dashboard-scroll") ?? false, [x, y] as const);

test("a see-through bottom band floats over the dashboard: the region runs under it, empty space reaches the dashboard, the last card scrolls clear", async ({ page }) => {
  await seedApp(page, seed({ bottom: [locked("pip", 8)], dockSeeThrough: { bottom: true } }));
  const band = page.locator(".dock-band-bottom");
  await expect(band).toHaveClass(/dock-band-float/);
  const b = (await band.boundingBox())!;
  const s = (await scroll(page).boundingBox())!;
  expect(Math.round(s.y + s.height)).toBe(Math.round(b.y + b.height));
  expect(await band.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  expect(await hitsDashboard(page, b.x + 40, b.y + b.height / 2)).toBe(true);
  expect(await hitsDashboard(page, b.x + b.width * 0.75, b.y + b.height / 2)).toBe(false);
  await scroll(page).evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const last = (await card(page, "a-last").boundingBox())!;
  expect(last.y + last.height).toBeLessThanOrEqual(b.y + 1);
});

test("a see-through top band sits under the tab bar, the dashboard opens past its room, and scrolling up clears the first card", async ({ page }) => {
  await seedApp(page, seed({ top: [locked("pip", 6)], dockSeeThrough: { top: true } }));
  const band = page.locator(".dock-band-top");
  await expect(band).toHaveClass(/dock-band-float/);
  const b = (await band.boundingBox())!;
  const bar = (await page.locator("main.dashboard-area > .tab-bar").boundingBox())!;
  expect(bar.y + bar.height).toBeLessThanOrEqual(b.y + 1);
  expect(Math.round((await scroll(page).boundingBox())!.y)).toBe(Math.round(b.y));
  await expect.poll(() => scroll(page).evaluate((el) => Math.round(el.scrollTop))).toBe(Math.round(b.height));
  await scroll(page).evaluate((el) => { el.scrollTop = 0; });
  expect((await card(page, "a-first").boundingBox())!.y).toBeGreaterThanOrEqual(b.y + b.height - 1);
  await page.getByRole("tab", { name: "Other" }).click();
  await expect.poll(() => scroll(page).evaluate((el) => Math.round(el.scrollTop))).toBe(Math.round(b.height));
});

test("a short tab under a see-through top band still opens past the room", async ({ page }) => {
  await seedApp(page, seed({ top: [locked("pip", 6)], dockSeeThrough: { top: true } }, [note("only", 0, { layout: { x: 0, y: 0, w: 40, h: 4 } })]));
  const b = (await page.locator(".dock-band-top.dock-band-float").boundingBox())!;
  await expect.poll(() => scroll(page).evaluate((el) => Math.round(el.scrollTop))).toBe(Math.round(b.height));
});

test("a tab's pinned bottom card stays below a see-through bottom band, uncovered", async ({ page }) => {
  const cards = [...tall("a"), note("pinned", 30, { pinned: "bottom", layout: { x: 0, y: 30, w: 40, h: 4 } })];
  await seedApp(page, seed({ bottom: [locked("pip", 8)], dockSeeThrough: { bottom: true } }, cards));
  const b = (await page.locator(".dock-band-bottom.dock-band-float").boundingBox())!;
  const pinned = (await page.locator("main.dashboard-area > .card-dock-bottom").boundingBox())!;
  expect(Math.round(b.y + b.height)).toBe(Math.round(pinned.y));
});

test("a see-through band the window caps is an ordinary band until it fits; switched off, nothing floats", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 500 });
  await seedApp(page, seed({ bottom: [locked("pip", 8)], dockRows: { top: 6, bottom: 24 }, dockSeeThrough: { bottom: true } }));
  const band = page.locator(".dock-band-bottom");
  await expect(band).not.toHaveClass(/dock-band-float/);
  await page.setViewportSize({ width: 1280, height: 1200 });
  await expect(band).toHaveClass(/dock-band-float/);
  await seedApp(page, seed({ bottom: [locked("pip", 8)] }));
  await expect(page.locator(".dock-band-bottom")).not.toHaveClass(/dock-band-float/);
  expect(await page.locator("main.dashboard-area").evaluate((el) => el.style.getPropertyValue("--dock-room-bottom"))).toBe("");
});
