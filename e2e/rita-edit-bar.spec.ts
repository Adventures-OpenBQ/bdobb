// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// D-013: an open but unpinned Rita pane overlays the dashboard's right edge, where the agent edit bar ends with Undo and Dismiss.
import { expect, test, type Page } from "@playwright/test";
import { MOCK_URL, defaultSeed, seedCards } from "./fixtures";

const FILE = "00000000-0000-0000-0000-0000000000a1.csv";

async function arrange(page: Page, pin: boolean) {
  await page.setViewportSize({ width: 5120, height: 2160 });
  await seedCards(
    page,
    [{ id: "csv1", widgetId: "local_table", backendId: "builtin", params: { file: FILE }, layout: { x: 0, y: 0, w: 40, h: 20 } }],
    {
      [`files/${FILE}`]: "Region,Revenue\nA,10\nA,20\nB,90\n",
      "settings.json": JSON.stringify({ ...JSON.parse(defaultSeed()["settings.json"]!), ritaUrl: `${MOCK_URL}/rita-arrange`, contextSharing: true }),
    },
  );
  await expect(page.locator(".widget-card").getByRole("cell", { name: "20", exact: true })).toBeVisible();
  await page.getByRole("complementary", { name: "Rita AI pane" }).hover();
  if (pin) await page.getByRole("button", { name: "Lock" }).click();
  await page.getByRole("textbox", { name: "Message Rita" }).fill("Total revenue by region");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator(".agent-edit-bar").getByRole("status")).toContainText("Rita arranged");
  // Where the user is after sending: the message box keeps the pane open without pinning it.
  await page.getByRole("textbox", { name: "Message Rita" }).focus();
  await page.mouse.move(2000, 1500);
}

/** Whether the element at the centre of the edit bar's named button is that button. */
const onTop = (page: Page, name: string) =>
  page.evaluate((name) => {
    const b = [...document.querySelectorAll(".agent-edit-bar button")].find((x) => x.textContent === name || x.getAttribute("aria-label") === name)!;
    const r = b.getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return el === b || b.contains(el);
  }, name);

for (const pin of [false, true]) {
  test(`D-013: with the Rita pane open and ${pin ? "pinned" : "not pinned"}, Undo and Dismiss are on top at 5120x2160`, async ({ page }) => {
    await arrange(page, pin);
    await expect(page.locator(".app-shell")).toHaveClass(pin ? /rita-pinned/ : /rita-on(?!.*rita-pinned)/);
    // Open, not collapsed to its tab: otherwise nothing overlays the bar and the hit test proves nothing.
    await expect(page.getByRole("complementary", { name: "Rita AI pane" })).toHaveAttribute("data-open", "true");
    await expect.poll(() => onTop(page, "Undo")).toBe(true);
    await expect.poll(() => onTop(page, "Dismiss")).toBe(true);
  });
}
