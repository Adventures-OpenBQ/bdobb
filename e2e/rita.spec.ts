// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from "@playwright/test";
import { MOCK_URL, defaultSeed, read, seedApp } from "./fixtures";

test.describe("Rita pane", () => {
  test.beforeEach(async ({ page }) => {
    await seedApp(page, { ...defaultSeed(), "settings.json": JSON.stringify({ ritaUrl: MOCK_URL }) });
  });

  test("no tab without a Rita URL", async ({ page }) => {
    await seedApp(page, defaultSeed());
    await expect(page.getByRole("complementary", { name: "Rita AI pane" })).toHaveCount(0);
  });

  test("hover opens, the lock holds, a turn round-trips and persists", async ({ page }) => {
    const pane = page.getByRole("complementary", { name: "Rita AI pane" });
    await expect(pane).toHaveAttribute("data-open", "false");
    await pane.hover();
    await expect(pane).toHaveAttribute("data-open", "true");
    // "Lock" is the button's accessible name in both states (6.0.3 renamed
    // the pin to a lock); only its tooltip and glyph flip.
    await page.getByRole("button", { name: "Lock" }).click();
    await page.mouse.move(10, 10);
    await expect(pane).toHaveAttribute("data-open", "true");
    await expect(page.getByRole("img", { name: "Rita online" })).toBeVisible();

    await page.getByRole("textbox", { name: "Message Rita" }).fill("What is a ticker?");
    await page.keyboard.press("Enter");
    await expect(page.getByText("A stock ticker symbol")).toBeVisible();

    const written = (await read(page, "chat.json")) ?? "";
    const saved = JSON.parse(written);
    expect(saved.messages.map((m: { role: string }) => m.role)).toEqual(["human", "ai"]);

    // A reload starts memfs over from the seed, so the restore is exercised by
    // seeding the file the app just wrote and booting again.
    await seedApp(page, { ...defaultSeed(), "settings.json": JSON.stringify({ ritaUrl: MOCK_URL }), "chat.json": written });
    await page.getByRole("complementary", { name: "Rita AI pane" }).hover();
    await expect(page.getByText("A stock ticker symbol")).toBeVisible();
  });

  test("⌘⇧A toggles the lock", async ({ page }) => {
    const pane = page.getByRole("complementary", { name: "Rita AI pane" });
    await page.keyboard.press("Meta+Shift+KeyA");
    await expect(pane).toHaveAttribute("data-open", "true");
    await page.keyboard.press("Meta+Shift+KeyA");
    await page.mouse.move(10, 10);
    await expect(pane).toHaveAttribute("data-open", "false");
  });
});
