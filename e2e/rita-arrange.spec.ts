// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from "@playwright/test";
import { MOCK_URL, defaultSeed, seedCards } from "./fixtures";

const FILE = "00000000-0000-0000-0000-0000000000a1.csv";

test("Rita arranges a CSV table through the real runtime; one Undo restores it", async ({ page }) => {
  await seedCards(
    page,
    [{ id: "csv1", widgetId: "local_table", backendId: "builtin", params: { file: FILE }, layout: { x: 0, y: 0, w: 40, h: 20 } }],
    {
      [`files/${FILE}`]: "Region,Revenue\nA,10\nA,20\nB,90\n",
      "settings.json": JSON.stringify({ ...JSON.parse(defaultSeed()["settings.json"]!), ritaUrl: `${MOCK_URL}/rita-arrange`, contextSharing: true }),
    },
  );
  const card = page.locator(".widget-card").first();
  await expect(card.getByRole("columnheader", { name: "Revenue" })).toBeVisible();
  await expect(card.getByRole("cell", { name: "20", exact: true })).toBeVisible();

  const pane = page.getByRole("complementary", { name: "Rita AI pane" });
  await pane.hover();
  await page.getByRole("button", { name: "Lock" }).click();
  await page.getByRole("textbox", { name: "Message Rita" }).fill("Total revenue by region");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  await expect(card.getByRole("cell", { name: "30", exact: true })).toBeVisible(); // A = 10 + 20, worker-computed
  await expect(card.getByRole("cell", { name: "90", exact: true })).toBeVisible();
  const bar = page.locator(".agent-edit-bar");
  await expect(bar.getByRole("status")).toContainText("Rita arranged");
  await expect(bar.getByRole("alert")).toHaveCount(0);
  await expect(bar.locator(".agent-edit-count")).toHaveText("1 change");

  await bar.getByRole("button", { name: "Undo" }).click();
  await expect(card.getByRole("cell", { name: "30", exact: true })).toHaveCount(0);
  await expect(card.getByRole("cell", { name: "20", exact: true })).toBeVisible(); // raw rows are back
  await expect(bar.getByRole("alert")).toHaveCount(0);
});
