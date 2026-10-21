// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Locator, type Page } from "@playwright/test";
import { MOCK_URL, defaultSeed, openRail, read, seedApp, seedCards, type SeedCard } from "./fixtures";

/** Twelve tall cards: far more than a 720px viewport shows, so the grid scrolls. */
function tallTab(): SeedCard[] {
  return Array.from({ length: 12 }, (_, i) => ({
    id: `c${i + 1}`,
    widgetId: "quote",
    backendId: "b1",
    params: { symbol: "AAPL" },
    layout: { x: 0, y: i * 9, w: 20, h: 9 },
  }));
}

async function settledBox(item: Locator) {
  let last = "";
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await item.boundingBox());
        const settled = now === last;
        last = now;
        return settled;
      },
      { intervals: [250] },
    )
    .toBe(true);
  return (await item.boundingBox())!;
}

async function pin(card: Locator, item: "Pin to top" | "Pin to bottom" | "Unpin") {
  await card.getByRole("button", { name: "Card menu" }).click();
  // The menu is portalled into <body>, so it is found on the page, not in the card.
  const page = card.page();
  await page.getByRole("menuitem", { name: /^Pin widget/ }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

const area = (page: Page) => page.locator("main.dashboard-area");
/** The grid's own scroll region, between the bands. */
const scroller = (page: Page) => page.locator(".dashboard-scroll");

test("a card pinned to the bottom holds the bottom edge while the tab scrolls, and Unpin returns it", async ({ page }) => {
  await seedCards(page, tallTab());
  const first = page.locator(".widget-card").first();
  const before = await settledBox(first);
  // ".widget-card" is a live locator, and the bottom band renders AFTER the
  // grid in document order -- once pinned, ".first()" would re-resolve to
  // the new first GRID card, not the one that left it. Count the grid items
  // instead of re-querying "first" post-pin.
  const gridCountBefore = await page.locator(".react-grid-item").count();

  await pin(first, "Pin to bottom");
  const dock = page.locator(".card-dock-bottom");
  await dock.waitFor();
  const areaBox = (await area(page).boundingBox())!;
  const docked = await settledBox(dock);
  expect(Math.round(docked.y + docked.height)).toBe(Math.round(areaBox.y + areaBox.height));

  await scroller(page).evaluate((el) => el.scrollTo(0, 800));
  const after = await settledBox(dock);
  expect(Math.round(after.y)).toBe(Math.round(docked.y));
  // The grid no longer lists it, and its slot is remembered.
  await expect(page.locator(".react-grid-item")).toHaveCount(gridCountBefore - 1);
  const stored = JSON.parse((await read(page, "dashboards/d1.json"))!);
  expect(stored.tabs[0].cards[0]).toMatchObject({ pinned: "bottom", layout: { x: 0, y: 0, w: 20, h: 9 } });

  await pin(dock.locator(".widget-card"), "Unpin");
  await expect(dock).toHaveCount(0);
  await scroller(page).evaluate((el) => el.scrollTo(0, 0));
  const restored = await settledBox(page.locator(".widget-card").first());
  expect(Math.round(restored.y)).toBe(Math.round(before.y));
});

test("pinning a second card to an occupied edge swaps, and a top pin holds the top", async ({ page }) => {
  await seedCards(page, tallTab());
  const cards = page.locator(".widget-card");
  await pin(cards.nth(0), "Pin to top");
  await pin(cards.nth(1), "Pin to top");
  await expect(page.locator(".card-dock-top")).toHaveCount(1);
  await expect
    .poll(async () => {
      const stored = JSON.parse((await read(page, "dashboards/d1.json"))!);
      return stored.tabs[0].cards.filter((c: { pinned?: string }) => c.pinned === "top").map((c: { id: string }) => c.id);
    })
    .toEqual(["c2"]);

  const dock = page.locator(".card-dock-top");
  // The top band sits directly under the tab bar, above the scroll region.
  const tabBarBox = (await page.locator(".tab-bar").boundingBox())!;
  await scroller(page).evaluate((el) => el.scrollTo(0, 800));
  const box = await settledBox(dock);
  expect(Math.round(box.y)).toBe(Math.round(tabBarBox.y + tabBarBox.height));
});

test("a locked Rita pane narrows the band with the dashboard area", async ({ page }) => {
  // e2e/rita.spec.ts seeds the pane the same way: a ritaUrl makes App mount it.
  await seedCards(page, tallTab(), { "settings.json": JSON.stringify({ ritaUrl: MOCK_URL }) });
  await pin(page.locator(".widget-card").first(), "Pin to bottom");
  const dock = page.locator(".card-dock-bottom");
  const wide = await settledBox(dock);

  // The Lock button only renders once the pane is open (RitaPane.tsx). It is
  // Lock, not Pin: Rita's pane control was renamed, and this line's own "Pin"
  // is the card's Pin widget ▸.
  await page.getByRole("complementary", { name: "Rita AI pane" }).hover();
  await page.getByRole("button", { name: "Lock" }).click();
  const areaBox = (await area(page).boundingBox())!;
  const narrow = await settledBox(dock);
  expect(narrow.width).toBeLessThan(wide.width);
  // Edge to edge: flush with the area's right edge, not under the pane.
  expect(Math.round(narrow.x + narrow.width)).toBe(Math.round(areaBox.x + areaBox.width));

  // Maximized, the pinned card stops at the pane too.
  await dock.getByRole("button", { name: "Maximize" }).click();
  await expect(dock).toHaveClass(/card-maximized/);
  const max = await settledBox(dock);
  expect(Math.abs(max.x + max.width - (areaBox.x + areaBox.width))).toBeLessThanOrEqual(1);
});

test("a short tab still shows the bottom band at the bottom of the area", async ({ page }) => {
  await seedCards(page, tallTab().slice(0, 1));
  await pin(page.locator(".widget-card").first(), "Pin to bottom");
  const dock = page.locator(".card-dock-bottom");
  const areaBox = (await area(page).boundingBox())!;
  const box = await settledBox(dock);
  expect(Math.round(box.y + box.height)).toBe(Math.round(areaBox.y + areaBox.height));
});

test("a maximized pinned card fills the area below the tab bar, covering the bands, and Escape puts it back", async ({ page }) => {
  await seedCards(page, tallTab());
  await pin(page.locator(".widget-card").nth(1), "Pin to top");
  await pin(page.locator(".react-grid-item .widget-card").first(), "Pin to bottom");
  const top = page.locator(".card-dock-top");
  const banded = await settledBox(top);
  const areaBox = (await area(page).boundingBox())!;
  const bar = (await page.locator(".tab-bar").boundingBox())!;

  await top.getByRole("button", { name: "Maximize" }).click();
  await expect(top).toHaveClass(/card-maximized/);
  await expect.poll(async () => Math.round((await top.boundingBox())!.x)).toBe(Math.round(areaBox.x));
  const box = await settledBox(top);
  expect(Math.abs(box.y - (bar.y + bar.height))).toBeLessThanOrEqual(1);
  expect(Math.abs(box.x + box.width - (areaBox.x + areaBox.width))).toBeLessThanOrEqual(1);
  expect(Math.abs(box.y + box.height - (areaBox.y + areaBox.height))).toBeLessThanOrEqual(1);
  // It covers the bottom band: the topmost element at the bottom band's middle is the maximized card.
  const bottom = (await page.locator(".card-dock-bottom").boundingBox())!;
  const hit = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest(".card-dock")?.className ?? "",
    [bottom.x + bottom.width / 2, bottom.y + bottom.height / 2],
  );
  expect(hit).toContain("card-dock-top");

  await page.keyboard.press("Escape");
  await expect(top).not.toHaveClass(/card-maximized/);
  const back = await settledBox(top);
  expect(Math.round(back.height)).toBe(Math.round(banded.height));
});

test("a pinned band in a workspace tile holds while the tile's grid scrolls, and maximized it fills only its tile, with the rail pinned open", async ({ page }) => {
  const seed = defaultSeed();
  const d1 = JSON.parse(seed["dashboards/d1.json"]!);
  d1.tabs[0].cards = tallTab().map((c, i) => (i === 0 ? { ...c, pinned: "bottom" } : c));
  seed["dashboards/d1.json"] = JSON.stringify(d1);
  seed["dashboards/d2.json"] = JSON.stringify({ id: "d2", name: "Beta", tabs: [{ id: "t2", name: "Second", cards: [] }] });
  seed["workspaces/w1.json"] = JSON.stringify({
    id: "w1", name: "Laptop", preset: "laptop", railsOpen: { left: true },
    slots: [{ slot: "a", dashboardId: "d1" }, { slot: "b", dashboardId: "d2" }],
  });
  await seedApp(page, seed);
  await openRail(page);
  await page.locator("nav.left-rail button.rail-item", { hasText: "Laptop" }).click();
  const tileA = page.getByTestId("workspace-tile-a");
  await expect(tileA).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-rail-pinned", "true");

  const dock = tileA.locator(".card-dock-bottom");
  const tile = await settledBox(tileA);
  const docked = await settledBox(dock);
  // Inside the tile, at its bottom (the tile's 1px border aside).
  expect(Math.abs(docked.y + docked.height - (tile.y + tile.height))).toBeLessThanOrEqual(2);
  await tileA.locator(".dashboard-scroll").evaluate((el) => el.scrollTo(0, 800));
  expect(Math.round((await settledBox(dock)).y)).toBe(Math.round(docked.y));

  const bar = (await tileA.locator(".tab-bar").boundingBox())!;
  const other = (await page.getByTestId("workspace-tile-b").boundingBox())!;
  await dock.getByRole("button", { name: "Maximize" }).click();
  await expect(dock).toHaveClass(/card-maximized/);
  await expect
    .poll(async () => {
      const box = (await dock.boundingBox())!;
      return Math.abs(box.x + box.width - (tile.x + tile.width));
    })
    .toBeLessThanOrEqual(2);
  const box = (await dock.boundingBox())!;
  expect(Math.abs(box.x - tile.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.y - (bar.y + bar.height))).toBeLessThanOrEqual(1);
  expect(Math.abs(box.y + box.height - (tile.y + tile.height))).toBeLessThanOrEqual(2);
  expect(box.x + box.width).toBeLessThanOrEqual(other.x);
});

// The v8 Pinned Cards example with its h-40 Markdown card pinned to the top
// (docs/examples/v8.0.0-pinned.apps.json, step 1 of its own "Try"), plus a
// locked band at the bottom: uncapped, the top band alone was ~1190px and
// pushed the grid, the other band, its grips and the locked band off screen.
test("a pinned band takes at most 40% of the area, so the grid, the other band, the locked band and the grips stay on screen", async ({ page }) => {
  const seed = defaultSeed();
  const d1 = JSON.parse(seed["dashboards/d1.json"]!);
  const quote = (id: string, y: number, h: number, pinned?: "top" | "bottom"): SeedCard => ({
    id, widgetId: "quote", backendId: "b1", params: { symbol: "AAPL" }, layout: { x: 0, y, w: 20, h }, ...(pinned ? { pinned } : {}),
  });
  d1.tabs[0].cards = [quote("note", 0, 7), quote("markdown", 7, 40, "top"), quote("clock", 47, 7, "bottom")];
  seed["dashboards/d1.json"] = JSON.stringify(d1);
  seed["dashboards/docks.json"] = JSON.stringify({
    id: "docks", name: "Locked widgets", hidden: true, dockRows: { top: 6, bottom: 8 },
    tabs: [{ id: "top", name: "Locked at Top", cards: [] }, { id: "bottom", name: "Locked at Bottom", cards: [quote("locked", 0, 8)] }],
  });
  await seedApp(page, seed);

  const areaBox = await settledBox(area(page));
  const top = await settledBox(page.locator(".card-dock-top"));
  expect(top.height).toBeLessThanOrEqual(areaBox.height * 0.4 + 1);
  // The card fills the capped band rather than overflowing it; its body scrolls.
  expect((await page.locator(".card-dock-top .widget-card").boundingBox())!.height).toBeLessThanOrEqual(top.height + 1);
  expect((await scroller(page).boundingBox())!.height).toBeGreaterThan(0);
  const onScreen = async (l: Locator) => {
    const b = (await l.boundingBox())!;
    expect(b.height).toBeGreaterThan(0);
    expect(b.y).toBeGreaterThanOrEqual(areaBox.y - 1);
    expect(b.y + b.height).toBeLessThanOrEqual(areaBox.y + areaBox.height + 1);
  };
  await onScreen(page.locator(".card-dock-bottom"));
  await onScreen(page.locator(".dock-band-bottom"));
  for (const grip of await page.getByRole("separator", { name: "Resize pinned card" }).all()) await onScreen(grip);

  // Only the band is capped: the card keeps its 40 rows, and Unpin returns it at that size.
  const stored = JSON.parse((await read(page, "dashboards/d1.json"))!);
  expect(stored.tabs[0].cards.find((c: { id: string }) => c.id === "markdown").layout.h).toBe(40);
});

test("a band under its cap keeps its full height while the tab below it scrolls", async ({ page }) => {
  // The scroll region's content is far taller than the area; it must take
  // only what the bands leave, not shrink them alongside itself.
  await seedCards(page, [
    ...tallTab(),
    { id: "c-top", widgetId: "quote", backendId: "b1", params: { symbol: "AAPL" }, layout: { x: 20, y: 0, w: 20, h: 5 }, pinned: "top" },
    { id: "c-bottom", widgetId: "quote", backendId: "b1", params: { symbol: "AAPL" }, layout: { x: 20, y: 5, w: 20, h: 4 }, pinned: "bottom" },
  ]);
  for (const edge of ["top", "bottom"]) {
    const band = page.locator(`.card-dock-${edge}`);
    const wanted = parseFloat(await band.evaluate((el) => el.style.height));
    expect((await settledBox(band)).height).toBeCloseTo(wanted, 0);
  }
});
