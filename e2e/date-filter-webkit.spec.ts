// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Page } from "@playwright/test";
import { dashboardSeed, seedApp } from "./fixtures";

// The desktop app is WKWebView, so the date filter is driven in WebKit, by
// keystrokes. The boxes are text, prefilled with the column's first and last
// day: <input type=date> drew untyped segments as today's date and a
// half-typed date filtered nothing (V3-005). The fixture's date column is
// pinned left and declared cellDataType "date", as the card that failed.
test.use({ browserName: "webkit" });

async function openDatedFilters(page: Page) {
  await seedApp(page, dashboardSeed([
    { id: "c-dated", widgetId: "dated_table", backendId: "b1", params: {}, layout: { x: 0, y: 0, w: 40, h: 12 } },
  ]));
  const card = page.locator(".widget-card").filter({ hasText: "Dated Table" });
  await card.locator("tbody tr[data-index]").first().waitFor();
  await card.getByRole("button", { name: "Filter rows" }).click();
  await expect(card.getByText("5 of 5 rows")).toBeVisible();
  return card;
}

test("From and To start at the column's first and last day, whole and side by side", async ({ page }) => {
  const card = await openDatedFilters(page);
  const from = card.getByLabel("From Date");
  const to = card.getByLabel("To Date");
  await expect(from).toHaveValue("2026-01-02");
  await expect(to).toHaveValue("2026-01-08");

  const toTop = (await to.boundingBox())!.y;
  for (const field of [from, to]) {
    const fit = await field.evaluate((el) => {
      const input = el as HTMLInputElement;
      const box = el.getBoundingClientRect();
      const column = el.closest("th")!.getBoundingClientRect();
      return { whole: input.scrollWidth <= input.clientWidth, inside: box.right <= column.right };
    });
    expect(fit).toEqual({ whole: true, inside: true });
    expect((await field.boundingBox())!.y).toBe(toTop);
  }
});

test("editing only the year of From applies on Enter", async ({ page }) => {
  const card = await openDatedFilters(page);
  const from = card.getByLabel("From Date");
  await from.click();
  // Select just the year, as a double-click or a drag would (Home is not
  // start-of-line in a macOS text field).
  await from.evaluate((el) => (el as HTMLInputElement).setSelectionRange(0, 4));
  await page.keyboard.type("2027");
  await expect(card.getByText("5 of 5 rows")).toBeVisible();
  await page.keyboard.press("Enter");

  await expect(card.getByText("0 of 5 rows")).toBeVisible();
  await expect(from).toHaveValue("2027-01-02");
});

test("text that is neither YYYY-MM-DD nor a date expression is marked and changes no rows", async ({ page }) => {
  const card = await openDatedFilters(page);
  const from = card.getByLabel("From Date");
  await from.fill("01/05/2026");
  await from.press("Enter");

  await expect(from).toHaveAttribute("aria-invalid", "true");
  await expect(from).toHaveAttribute("title", "Use YYYY-MM-DD or a date expression such as T-1bd");
  await expect(card.getByText("5 of 5 rows")).toBeVisible();
});

test("leaving the To box applies it", async ({ page }) => {
  const card = await openDatedFilters(page);
  const to = card.getByLabel("To Date");
  await to.fill("2026-01-06");
  await to.press("Tab");

  await expect(card.getByText("3 of 5 rows")).toBeVisible();
});

test("the date column widens while the filter row is open, and returns to its width after", async ({ page }) => {
  const card = await openDatedFilters(page);
  const header = card.locator('thead th[data-field="date"]');
  const open = (await header.boundingBox())!.width;

  await card.getByRole("button", { name: "Filter rows" }).click();
  await expect(card.getByLabel("From Date")).toHaveCount(0);
  const closed = (await header.boundingBox())!.width;
  expect(closed).toBeLessThan(open);

  await card.getByRole("button", { name: "Filter rows" }).click();
  expect((await header.boundingBox())!.width).toBe(open);
});

// v4: the boxes take the date expressions params take. The expression is
// kept as text and resolved again on every refresh, so it moves with the day.
test("a date expression in To stays relative: a Refresh the next day moves it", async ({ page }) => {
  // Wednesday 7 January 2026: T-1bd is Tuesday the 6th.
  await page.clock.setFixedTime(new Date("2026-01-07T12:00:00"));
  const card = await openDatedFilters(page);
  const to = card.getByLabel("To Date");
  await to.fill("T-1bd");
  await to.press("Enter");

  await expect(card.getByText("3 of 5 rows")).toBeVisible();
  await expect(to).toHaveValue("T-1bd");
  await expect(to).toHaveAttribute("title", "T-1bd is 2026-01-06 today");

  // Thursday the 8th: T-1bd is the 7th. Refresh, and nothing is edited.
  await page.clock.setFixedTime(new Date("2026-01-08T12:00:00"));
  await card.getByRole("button", { name: "Refresh" }).click();

  await expect(card.getByText("4 of 5 rows")).toBeVisible();
  await expect(to).toHaveValue("T-1bd");
  await expect(to).toHaveAttribute("title", "T-1bd is 2026-01-07 today");
});
