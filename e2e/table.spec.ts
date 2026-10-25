// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Page } from "@playwright/test";
import { read, seedApp, seedCards } from "./fixtures";

/**
 * A dashboard whose only card is the 5,000-row `bigtable` fixture widget.
 * `settings` merges over DEFAULT_SETTINGS, so a spec passes only what it needs.
 */
function seedBigTable(page: Page, settings: Record<string, unknown> = {}): Promise<void> {
  return seedCards(
    page,
    [{ id: "c-big", widgetId: "bigtable", backendId: "b1", params: {}, layout: { x: 0, y: 0, w: 20, h: 12 } }],
    { "settings.json": JSON.stringify(settings) },
  );
}

test("a 5,000-row table mounts promptly with only a window of rows in the DOM", async ({
  page,
}) => {
  await seedBigTable(page);
  const card = page.locator(".widget-card").filter({ hasText: "Big Table" });
  const rows = card.locator("tbody tr");

  await expect.poll(() => rows.count(), { timeout: 2000 }).toBeGreaterThan(0);

  expect(await rows.count()).toBeLessThan(100);
  await expect(card.getByText("row-0", { exact: true })).toBeVisible();
});

test("every row stays reachable by scrolling, under a header that stays put", async ({ page }) => {
  await seedBigTable(page);
  const card = page.locator(".widget-card").filter({ hasText: "Big Table" });
  const scroll = card.locator(".table-scroll");
  await card.locator("tbody tr").first().waitFor();

  // Rows are measured as they are rendered, so the total height settles over
  // a few frames: keep asking for the bottom until the last row is there.
  await expect(async () => {
    await scroll.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(card.getByText("row-4999", { exact: true })).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10_000 });

  // Still a window, not the whole set.
  expect(await card.locator("tbody tr").count()).toBeLessThan(100);

  // Sticky: the header is pinned to the top of the scroll container, not
  // scrolled away with the rows.
  const header = card.getByRole("columnheader", { name: "label" });
  await expect(header).toBeVisible();
  const headerBox = (await header.boundingBox())!;
  const scrollBox = (await scroll.boundingBox())!;
  expect(Math.round(headerBox.y)).toBe(Math.round(scrollBox.y));

  // The card itself does not scroll: .table-scroll fills .card-body exactly,
  // so there is one scrollbar, not two.
  const bodyOverflows = await card
    .locator(".card-body")
    .evaluate((el) => el.scrollHeight > el.clientHeight);
  expect(bodyOverflows).toBe(false);
});

test("the collapsed controls dropdown stays clickable above a table's sticky header", async ({
  page,
}) => {
  // Regression: `.widget-table th` once carried `z-index: 1`, which tied it
  // with `.card-header`'s own z-index 1. Later in the document, the sticky
  // header then painted over the dropdown and swallowed its clicks, so
  // Remove/Refresh/Parameters could not be used on any table card.
  await seedBigTable(page, { collapseWidgetControls: true });
  const card = page.locator(".widget-card").filter({ hasText: "Big Table" });
  await card.locator("tbody tr").first().waitFor();

  await card.getByRole("button", { name: "Show widget controls" }).click();

  // Not just present: the click has to land on the button, not on a <th>
  // stacked over it. Playwright's actionability check enforces exactly that.
  const remove = card.getByRole("button", { name: "Remove card" });
  await expect(remove).toBeVisible();
  await remove.click();

  await expect(page.locator(".widget-card")).toHaveCount(0);
});

test("the same dropdown stays clickable over a table with a PINNED column", async ({ page }) => {
  // The pinned header cells carry z-index 3 — higher than anything the
  // bigtable fixture puts on screen, and the reason .table-scroll has to be
  // its own stacking context. This exercises that path: the `screener`
  // fixture pins `symbol` left, and its declared widths overflow the card.
  await seedCards(
    page,
    [{ id: "c-screener", widgetId: "screener", backendId: "b1", params: {}, layout: { x: 0, y: 0, w: 14, h: 16 } }],
    { "settings.json": JSON.stringify({ collapseWidgetControls: true }) },
  );

  const card = page.locator(".widget-card").filter({ hasText: "Screener" });
  await card.locator("tbody tr[data-index]").first().waitFor();
  expect(
    await card.locator('th[data-field="symbol"]').evaluate((el) => getComputedStyle(el).zIndex),
  ).toBe("3");

  await card.getByRole("button", { name: "Show widget controls" }).click();

  const remove = card.getByRole("button", { name: "Remove card" });
  await expect(remove).toBeVisible();
  await remove.click();

  await expect(page.locator(".widget-card")).toHaveCount(0);
});

test("Transposed turns the quote table on its side and persists to the dashboard file", async ({
  page,
}) => {
  // The default seed's first card is the `quote` widget: one row,
  // { symbol: "AAPL", price: 187.25, change_percent: 1.23 }.
  await seedApp(page);
  const card = page.locator(".widget-card").filter({ hasText: "Quote" });
  await expect(card.getByRole("columnheader", { name: "symbol" })).toBeVisible();

  await card.getByRole("combobox", { name: "View" }).selectOption("Transposed");

  await expect(card.getByRole("columnheader", { name: "Field" })).toBeVisible();
  await expect(card.getByRole("columnheader", { name: "AAPL" })).toBeVisible();
  await expect(card.getByRole("cell", { name: "price" })).toBeVisible();
  await expect(card.getByRole("cell", { name: "change_percent" })).toBeVisible();
  // Toolkit is off: the ⌕ filter toggle is gone.
  await expect(card.getByRole("button", { name: "Filter rows" })).toHaveCount(0);

  // Read back out of memfs rather than reloading: the browser shim re-seeds
  // memfs from window.__bdobbSeed on every navigation, so a reload would
  // restore the seed and prove nothing (see card.spec.ts, grouping.spec.ts).
  // This read IS the write a real reload would come back to.
  await expect
    .poll(async () => {
      const raw = await read(page, "dashboards/d1.json");
      return raw ? JSON.parse(raw).tabs[0].cards[0].view : null;
    })
    .toBe("transposed");
});
