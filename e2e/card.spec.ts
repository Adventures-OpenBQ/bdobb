// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Locator, type Page } from "@playwright/test";
import { read, seedApp, seedCards } from "./fixtures";

/** Every card's persisted grid slot on the seed's only tab, in card order. */
async function layouts(page: Page) {
  const raw = await read(page, "dashboards/d1.json");
  return JSON.parse(raw!).tabs[0].cards.map((c: { layout: unknown }) => c.layout);
}

/**
 * The box, once it has stopped moving. WidthProvider measures the grid
 * container only after the first paint, so every item is nudged from its
 * first-paint position to its real one, and .cssTransforms transitions that
 * correction over 200ms — a box read during those 200ms is a couple of pixels
 * short of where the card ends up. Two identical reads a poll apart is the
 * condition; no fixed wait.
 */
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

test("renaming a card from the ⋯ menu shows the new title and writes it to the dashboard", async ({
  page,
}) => {
  await seedApp(page);
  // The seed's first card is the quote card, and it is located by position
  // rather than by its text: the rename replaces the title with an input,
  // whose VALUE is not text content, so a hasText filter would match the card
  // before the field opened and nothing after it.
  const card = page.locator(".widget-card").first();
  await expect(card.locator(".card-title")).toHaveText("Quote");
  await card.locator("table").waitFor();

  await card.getByRole("button", { name: "Card menu" }).click();
  // The ⋯ menu is portalled to <body>, so its items are the page's, not the card's.
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  const field = card.getByRole("textbox", { name: "Card title" });
  await expect(field).toHaveValue("Quote");
  await field.fill("AAPL daily");
  await field.press("Enter");

  const title = card.locator(".card-title");
  await expect(title).toHaveText("AAPL daily");
  await expect(title).toHaveClass(/card-title-custom/);
  // The widget's own name is still reachable, so a renamed card does not
  // become a mystery about what it is showing.
  await expect(title).toHaveAttribute("title", "Quote");

  // Read back out of memfs rather than reloading: the browser shim re-seeds
  // memfs from window.__bdobbSeed on every navigation, so a reload would
  // restore the seed and prove nothing. This read IS the write.
  await expect
    .poll(async () => {
      const raw = await read(page, "dashboards/d1.json");
      return raw ? JSON.parse(raw).tabs[0].cards[0].title : null;
    })
    .toBe("AAPL daily");
});

test("double-clicking the title of a normal card renames it, without dragging it", async ({
  page,
}) => {
  await seedApp(page);
  // Deliberately NOT maximized: .card-title is react-grid-layout's drag
  // handle, so on a normal card the press that starts the double-click also
  // inserts .react-grid-placeholder over the title. Unless that placeholder
  // is out of hit-testing (styles.css), the mouseup retargets to it, no
  // dblclick is fired on the title at all, and this gesture does nothing --
  // which is the only way to rename a card whose type has no ⋯ menu.
  const card = page.locator(".widget-card").first();
  const item = page.locator(".react-grid-item").first();
  await expect(item).not.toHaveClass(/card-maximized/);
  await expect(card.locator(".card-title")).toHaveText("Quote");
  await card.locator("table").waitFor();
  const layoutsBefore = await layouts(page);

  await card.locator(".card-title").dblclick();

  const field = card.getByRole("textbox", { name: "Card title" });
  await expect(field).toHaveValue("Quote");
  await field.fill("Renamed by dblclick");
  await field.press("Enter");

  const title = card.locator(".card-title");
  await expect(title).toHaveText("Renamed by dblclick");
  await expect(title).toHaveClass(/card-title-custom/);
  await expect
    .poll(async () => {
      const raw = await read(page, "dashboards/d1.json");
      return raw ? JSON.parse(raw).tabs[0].cards[0].title : null;
    })
    .toBe("Renamed by dblclick");

  // The gesture pressed the drag handle, so it must also be proved NOT to
  // have moved anything: a drag that ended where it began would still have
  // written a layout through onDragStop.
  expect(await layouts(page)).toEqual(layoutsBefore);
});

test("maximizing fills the dashboard area below the tab bar, and Escape puts the card back", async ({
  page,
}) => {
  await seedApp(page);
  const card = page.locator(".widget-card").first();
  await card.locator("table").waitFor();
  // The seed's first card is the quote card, so the first grid item is its
  // wrapper -- the element react-grid-layout turns into the .react-grid-item.
  const item = page.locator(".react-grid-item").first();
  await expect(item.locator(".card-title")).toHaveText("Quote");
  const before = await settledBox(item);

  const area = (await page.locator(".dashboard-area").boundingBox())!;
  const bar = (await page.locator(".tab-bar").boundingBox())!;
  await card.getByRole("button", { name: "Maximize" }).click();

  await expect(item).toHaveClass(/card-maximized/);
  // The maximized item's own transition is none, but settle on the left edge
  // before reading the box for the other three: the class and the layout are
  // separate frames.
  await expect.poll(async () => Math.round((await item.boundingBox())!.x)).toBe(Math.round(area.x));
  const box = (await item.boundingBox())!;
  expect(
    Math.abs(box.y - (bar.y + bar.height)),
    `top ${box.y} vs tab bar bottom ${bar.y + bar.height}`,
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(box.x + box.width - (area.x + area.width)),
    `right ${box.x + box.width} vs area right ${area.x + area.width}`,
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(box.y + box.height - (area.y + area.height)),
    `bottom ${box.y + box.height} vs area bottom ${area.y + area.height}`,
  ).toBeLessThanOrEqual(1);
  // The tab bar is still on screen above it, not covered.
  expect(box.y, `top ${box.y} vs tab bar top ${bar.y}`).toBeGreaterThan(bar.y);

  await page.keyboard.press("Escape");

  await expect(item).not.toHaveClass(/card-maximized/);
  await expect
    .poll(async () => {
      const b = (await item.boundingBox())!;
      return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)];
    })
    .toEqual([
      Math.round(before.x),
      Math.round(before.y),
      Math.round(before.width),
      Math.round(before.height),
    ]);
});

// .widget-card clips its overflow, and the ⋯ menu is absolute inside the
// header, so on a short card the menu's lower items were cut off by the card's
// own edge (and, below it, covered by the next card) -- there, but unclickable.
// It is portalled to <body> now, so its items are found on the page.
test("a short card's ⋯ menu is reachable past the card's own bottom edge", async ({ page }) => {
  await seedCards(page, [
    { id: "c-a", widgetId: "quote", backendId: "b1", params: { symbol: "AAPL" }, layout: { x: 0, y: 0, w: 20, h: 3 } },
    { id: "c-b", widgetId: "quote", backendId: "b1", params: { symbol: "MSFT" }, layout: { x: 0, y: 3, w: 20, h: 9 } },
  ]);
  const card = page.locator(".widget-card").first();
  await card.locator(".card-title").waitFor();

  await card.getByRole("button", { name: "Card menu" }).click();
  const items = page.getByRole("menu").getByRole("menuitem");
  const last = items.last();
  await expect(last).toBeVisible();
  const label = (await last.textContent()) ?? "";
  // Hit-tested, not toBeVisible(): a clipped item still has a box.
  const hit = await last.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const at = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return at !== null && el.contains(at);
  });
  expect(hit, `"${label}" is under something else`).toBe(true);
});
