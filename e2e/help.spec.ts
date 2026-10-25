// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Page } from "@playwright/test";
import { memfs, openRail, seedApp } from "./fixtures";

const opened = (page: Page) => memfs(page).opened();

test("Quick Help opens from the rail, searches, and shows a topic with its screenshot", async ({
  page,
}) => {
  await seedApp(page);

  await openRail(page);
  await page.getByRole("button", { name: "Help" }).click();
  await page.getByRole("menuitem", { name: /quick help/i }).click();

  const dialog = page.getByRole("dialog", { name: "Quick Help" });
  await expect(dialog).toBeVisible();
  // Focused after showModal() has run: React's autoFocus fired while the
  // dialog was still closed, and the real showModal() then focused the ✕.
  await expect(dialog.getByLabel("Search help")).toBeFocused();
  await expect(dialog.getByRole("heading", { level: 1, name: "Getting started" })).toBeVisible();

  const nav = dialog.getByRole("navigation", { name: "Help topics" });
  const before = await nav.getByRole("button").count();

  await dialog.getByLabel("Search help").fill("pinning");
  await expect
    .poll(async () => nav.getByRole("button").count())
    .toBeLessThan(before);
  await expect(nav.getByRole("button", { name: /^Tables/ })).toBeVisible();

  await nav.getByRole("button", { name: /^Tables/ }).click();
  await expect(dialog.getByRole("heading", { level: 1, name: "Tables" })).toBeVisible();

  // naturalWidth > 0 is what proves the bundled asset actually resolved rather
  // than 404ing -- a broken <img> still has a src attribute and still passes a
  // toHaveAttribute assertion.
  const shot = dialog.getByRole("img").first();
  await expect(shot).toBeVisible();
  await expect
    .poll(async () => shot.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("Reference Manual opens from the rail, filters its sections, and follows a wikilink", async ({
  page,
}) => {
  await seedApp(page);

  await openRail(page);
  await page.getByRole("button", { name: "Help" }).click();
  await page.getByRole("menuitem", { name: /reference manual/i }).click();

  const dialog = page.getByRole("dialog", { name: "Reference Manual" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { level: 1, name: "BDOBB Help" })).toBeVisible();

  const nav = dialog.getByRole("navigation", { name: "Help topics" });
  const before = await nav.getByRole("button").count();

  await dialog.getByLabel("Search help").fill("chart");
  await expect
    .poll(async () => nav.getByRole("button").count())
    .toBeLessThan(before);
  await expect(nav.getByRole("button", { name: /^Charts/ })).toBeVisible();

  await dialog.getByLabel("Search help").fill("");
  // The front page links every page; following one stays inside the dialog.
  await dialog.getByRole("link", { name: "Keyboard Shortcuts" }).first().click();
  await expect(dialog.getByRole("heading", { level: 1, name: "Keyboard Shortcuts" })).toBeVisible();
  // That page's shortcut table: GFM tables render, which the quick set never needed.
  await expect(dialog.getByRole("table").first()).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("Help menu items open exactly their destinations", async ({ page }) => {
  await seedApp(page);
  // window.open would spawn a real tab per click; swallow it so the test stays on one page.
  await page.evaluate(() => { window.open = () => null; });

  await openRail(page);
  await page.getByRole("button", { name: "Help" }).click();
  await page.getByRole("menuitem", { name: /report a bug/i }).click();
  expect(await opened(page)).toEqual(["https://github.com/Adventures-OpenBQ/bdobb/issues"]);

  await openRail(page);
  await page.getByRole("button", { name: "Help" }).click();
  await page.getByRole("menuitem", { name: /request a feature/i }).click();
  expect(await opened(page)).toEqual([
    "https://github.com/Adventures-OpenBQ/bdobb/issues",
    "https://artcashin.canny.io/bdobb",
  ]);
});
