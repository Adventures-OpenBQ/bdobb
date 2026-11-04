// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// The base button reset (appearance: none; color: inherit) out-ranks the
// browser's own greyed :disabled text, so a disabled button must be muted by
// the stylesheet itself or it reads as clickable.
import { expect, test } from "@playwright/test";
import { seedCards } from "./fixtures";

test("a disabled button's label is muted, an enabled one's is not", async ({ page }) => {
  await seedCards(page, [{ id: "c-screener", widgetId: "screener", backendId: "b1", params: {}, layout: { x: 0, y: 0, w: 40, h: 14 } }]);
  const clear = page.getByRole("button", { name: "Clear selection" });
  await expect(clear).toBeDisabled();
  const muted = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--text-muted)";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await expect(clear).toHaveCSS("color", muted);
  await page.getByRole("checkbox", { name: /^Select row / }).first().click();
  await expect(clear).toBeEnabled();
  await expect(clear).not.toHaveCSS("color", muted);
});
