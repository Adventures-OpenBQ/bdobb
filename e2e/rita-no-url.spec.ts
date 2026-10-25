// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// D-009: with no Rita URL there is no Rita pane, so Keep Rita Open must not reserve a strip for one.
import { expect, test } from "@playwright/test";
import { seedCards } from "./fixtures";

test("D-009: with no Rita URL, Keep Rita Open reserves no strip", async ({ page }) => {
  await seedCards(page, [], {}); // the default seed's settings.json is "{}", so ritaUrl is ""
  const shell = page.locator(".app-shell");
  await expect(shell).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Rita AI pane" })).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Shift+KeyA"); // the browser build's Keep Rita Open
  await expect(shell).not.toHaveClass(/rita-pinned/);
  expect(await page.locator(".dashboard-area").evaluate((el) => getComputedStyle(el).marginRight)).toBe("0px");
});
