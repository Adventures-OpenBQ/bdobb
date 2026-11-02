// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from "@playwright/test";
import { read, seedApp, seedCards } from "./fixtures";

test.use({ hasTouch: true });

test("touch editing a loaded markdown note persists across blur and reload", async ({ page }) => {
  await seedCards(page, [{ id: "markdown", widgetId: "markdown", backendId: "builtin", params: { text: "# QA heading\n\nOriginal text." }, layout: { x: 0, y: 0, w: 40, h: 16 } }]);
  const editor = page.locator('.markdown-editor [contenteditable="true"]').first();
  await expect(editor).toBeVisible();
  const box = await editor.boundingBox();
  expect(box).not.toBeNull();
  await editor.tap({ position: { x: box!.width * 0.8, y: box!.height * 0.9 } });
  await expect(editor).toBeFocused();
  await page.keyboard.type(" QA rich touch durable");
  await page.getByRole("button", { name: "Settings", exact: true }).tap();
  await expect.poll(() => read(page, "dashboards/d1.json")).toContain("QA rich touch durable");
  // Reload the stored dashboard rather than the original seed.
  const persisted = await read(page, "dashboards/d1.json");
  const fresh = await page.context().newPage();
  await seedApp(fresh, { "settings.json": "{}", "backends.json": "[]", "dashboards/d1.json": persisted! });
  await expect(fresh.locator(".markdown-editor")).toContainText("QA rich touch durable");
  await fresh.close();
});

for (const inset of [24, 32]) {
  test(`locked-editor Cancel stays below a ${inset}px iPad status bar`, async ({ page }) => {
    await seedCards(page, []);
    await page.addStyleTag({ content: `:root { --safe-top: ${inset}px; }` });
    await page.evaluate((height) => {
      const bar = document.createElement("div");
      bar.setAttribute("aria-hidden", "true");
      Object.assign(bar.style, { position: "fixed", left: "0", top: "0", width: "100%", height: `${height}px`, zIndex: "2147483647" });
      document.body.append(bar);
    }, inset);
    await page.getByRole("button", { name: "Settings", exact: true }).tap();
    await page.getByRole("tab", { name: "Locked Widgets", exact: true }).tap();
    await page.getByRole("button", { name: "Locked at Top…", exact: true }).tap();
    const cancel = page.getByRole("dialog", { name: "Editing Locked at Top", exact: true }).getByRole("button", { name: "Cancel", exact: true });
    await expect(cancel).toBeVisible();
    expect((await cancel.boundingBox())!.y).toBeGreaterThanOrEqual(inset);
    await cancel.tap();
    await expect(page.getByRole("button", { name: "Locked at Top…", exact: true })).toBeVisible();
  });
}
