// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// #26: after Edit workspace… ▸ Done (a mouse click), the hover rail collapses
// once the pointer is away. WebKit (the desktop app's engine) marks the focus
// the dialog hands back to the rail row as :focus-visible, which Chromium does
// not, so this file runs in WebKit. Keyboard reach is unchanged: a keyboard
// close still leaves the rail open around the focused row.
import { expect, test, type Page } from "@playwright/test";
import { defaultSeed, openRail, seedApp } from "./fixtures";

test.use({ browserName: "webkit" });

const row = (page: Page, name: string) => page.locator("nav.left-rail button.rail-item", { hasText: name });
const railWidth = (page: Page) => page.locator("nav.left-rail").evaluate((el) => el.getBoundingClientRect().width);

async function editLaptop(page: Page) {
  const seed = defaultSeed();
  seed["dashboards/d2.json"] = JSON.stringify({ id: "d2", name: "Beta", tabs: [{ id: "t2", name: "Second", cards: [] }] });
  seed["workspaces/w1.json"] = JSON.stringify({ id: "w1", name: "Laptop", preset: "laptop", slots: [{ slot: "a", dashboardId: "d1" }, { slot: "b", dashboardId: "d2" }] });
  await seedApp(page, seed);
  await openRail(page);
  await row(page, "Laptop").click();
  await expect(page.getByTestId("workspace-tile-a")).toBeVisible();
  await openRail(page);
  await row(page, "Laptop").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit…" }).click();
  const dialog = page.getByRole("dialog", { name: "Workspaces" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("#26: the rail collapses after Edit… ▸ Open with the mouse", async ({ page }) => {
  const dialog = await editLaptop(page);
  await dialog.getByRole("button", { name: "Open", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.mouse.move(1100, 400);
  await page.mouse.move(1150, 420);
  await expect.poll(() => railWidth(page)).toBeLessThan(80);
  await expect(page.locator("nav.left-rail")).toHaveAttribute("data-expanded", "false");
});

test("#26: a keyboard close still leaves the rail open around the focused row", async ({ page }) => {
  const dialog = await editLaptop(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.mouse.move(1100, 400);
  await expect(row(page, "Laptop")).toBeFocused();
  await expect.poll(() => railWidth(page)).toBeGreaterThan(160);
});
