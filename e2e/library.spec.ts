// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from "@playwright/test";
import { seedApp } from "./fixtures";

/**
 * Regression for two Widget Library card defects seen in the Tauri app: a
 * long unbroken URL in a description ran out of the card, and a card stretched
 * to its grid row's tallest neighbour spread the spare height between title,
 * badges and description so the badges floated mid-card.
 */
test("a library card keeps its description inside and its badges under the title", async ({ page }) => {
  await seedApp(page);
  await page.keyboard.press("Meta+k");
  const overlay = page.getByRole("dialog", { name: "Widget library" });
  await overlay.waitFor();

  const card = overlay.locator(".library-card", { hasText: "fails to deliver" });
  await card.waitFor();
  const cardBox = (await card.boundingBox())!;
  const title = (await card.locator(".library-card-title").boundingBox())!;
  const badges = (await card.locator(".library-card-badges").boundingBox())!;
  const description = (await card.locator(".library-card-description").boundingBox())!;

  // The description wraps: its box ends inside the card, not past its right edge.
  expect(description.x + description.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 0.5);
  // The badges sit directly under the title (within the card's 4px gap), and
  // the description directly under the badges — no spare height in between.
  expect(badges.y - (title.y + title.height)).toBeLessThan(10);
  expect(description.y - (badges.y + badges.height)).toBeLessThan(10);
});

test("only the widget list scrolls: the search and the filters stay at the top", async ({ page }) => {
  // Short enough that the fixture's widgets overflow the list.
  await page.setViewportSize({ width: 900, height: 420 });
  await seedApp(page);
  await page.keyboard.press("Meta+k");
  const overlay = page.getByRole("dialog", { name: "Widget library" });
  const search = overlay.getByRole("searchbox", { name: "Search widgets" });
  const backend = overlay.getByRole("combobox", { name: "Backend" });
  const list = overlay.locator(".library-scroll");
  await list.locator(".library-card").first().waitFor();
  const before = { search: (await search.boundingBox())!.y, backend: (await backend.boundingBox())!.y };

  await list.hover();
  await page.mouse.wheel(0, 2000);

  // The list itself scrolled, and the header and filters did not move.
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect((await search.boundingBox())!.y).toBe(before.search);
  expect((await backend.boundingBox())!.y).toBe(before.backend);
  // The list starts below the filters.
  const filtersBottom = await overlay.locator(".library-filters").evaluate((el) => el.getBoundingClientRect().bottom);
  expect((await list.boundingBox())!.y).toBeGreaterThanOrEqual(filtersBottom);
});
