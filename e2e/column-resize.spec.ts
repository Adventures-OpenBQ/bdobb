// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Locator, type Page } from "@playwright/test";
import { seedCards } from "./fixtures";

/**
 * bdobb#10: a column resize moves one edge by the pointer's travel and leaves
 * the other columns alone. The data table is as wide as its columns, so a
 * table wider than the card scrolls sideways, and a narrower one leaves the
 * spare space empty on the right instead of stretching the columns.
 */
function seedQuote(page: Page, w: number): Promise<void> {
  return seedCards(page, [
    { id: "c-quote", widgetId: "quote", backendId: "b1", params: { symbol: "AAPL" }, layout: { x: 0, y: 0, w, h: 9 } },
  ]);
}

async function widths(headers: Locator): Promise<number[]> {
  return headers.evaluateAll((ths) => ths.map((th) => th.getBoundingClientRect().width));
}

/** Drags column `index`'s right-edge resizer by `dx` pixels with a real pointer. */
async function dragEdge(page: Page, card: Locator, index: number, dx: number): Promise<void> {
  const resizer = card.locator("thead th").nth(index).locator(".column-resizer");
  const box = (await resizer.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 12 });
  await page.mouse.up();
}

test("a 60 px drag grows that column by 60 px; the others keep their widths; spare space stays on the right", async ({
  page,
}) => {
  await seedQuote(page, 20);
  const card = page.locator(".widget-card").first();
  const headers = card.locator("thead th");
  await expect(card.locator("tbody tr").first()).toBeVisible();
  await expect(headers).toHaveCount(3);

  const before = await widths(headers);
  await dragEdge(page, card, 1, 60);
  const after = await widths(headers);

  expect(after[1] - before[1]).toBeGreaterThan(56);
  expect(after[1] - before[1]).toBeLessThan(64);
  expect(Math.abs(after[0] - before[0])).toBeLessThanOrEqual(1);
  expect(Math.abs(after[2] - before[2])).toBeLessThanOrEqual(1);

  // Narrower than the card: the table ends before the scroll box does.
  const table = (await card.locator("table.widget-table").boundingBox())!;
  const scroll = (await card.locator(".table-scroll").boundingBox())!;
  expect(table.x + table.width).toBeLessThan(scroll.x + scroll.width - 20);
});

test("columns wider than the card scroll sideways instead of squeezing", async ({ page }) => {
  await seedQuote(page, 10);
  const card = page.locator(".widget-card").first();
  const headers = card.locator("thead th");
  await expect(card.locator("tbody tr").first()).toBeVisible();

  const scrollWidth = (await card.locator(".table-scroll").boundingBox())!.width;
  const before = await widths(headers);
  await dragEdge(page, card, 0, 500);
  const after = await widths(headers);
  expect(after[0] - before[0]).toBeGreaterThan(480);
  expect(Math.abs(after[1] - before[1])).toBeLessThanOrEqual(1);
  expect(Math.abs(after[2] - before[2])).toBeLessThanOrEqual(1);
  expect(after.reduce((a, b) => a + b, 0)).toBeGreaterThan(scrollWidth);

  const scroll = card.locator(".table-scroll");
  const overflow = await scroll.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeGreaterThan(100);
  await scroll.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  expect(await scroll.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
});
