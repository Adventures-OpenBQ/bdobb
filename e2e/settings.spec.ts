// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from "@playwright/test";
import { defaultSeed, openSettingsTab, seedApp } from "./fixtures";

test("the Settings modal is centered and sized to min(1040px, 100vw-48px) x min(800px, 100dvh-48px)", async ({
  page,
}) => {
  await seedApp(page, { ...defaultSeed(), "settings.json": JSON.stringify({ theme: "dark" }) });
  await openSettingsTab(page, "General");

  const viewport = page.viewportSize();
  if (!viewport) throw new Error("no viewport size");

  // .modal-settings' fixed 60vw x 60vh is gone -- every bd-* dialog now sizes
  // off the shared .bd-dialog rule in src/styles/dialogs.css.
  const modalBox = await page.locator(".bd-dialog").boundingBox();
  if (!modalBox) throw new Error("modal did not render");

  const expectedWidth = Math.min(1040, viewport.width - 48);
  const expectedHeight = Math.min(800, viewport.height - 48);
  expect(Math.abs(modalBox.width - expectedWidth)).toBeLessThanOrEqual(2);
  expect(Math.abs(modalBox.height - expectedHeight)).toBeLessThanOrEqual(2);

  const modalCenterX = modalBox.x + modalBox.width / 2;
  const modalCenterY = modalBox.y + modalBox.height / 2;
  expect(Math.abs(modalCenterX - viewport.width / 2)).toBeLessThanOrEqual(2);
  expect(Math.abs(modalCenterY - viewport.height / 2)).toBeLessThanOrEqual(2);
});

test("on the Logs tab, the log view fills the remaining modal height", async ({ page }) => {
  // Seeded so .bd-log actually renders (an empty log shows "No log entries
  // yet." instead), and long enough that a small fixed cap would visibly
  // clip it if the CSS regressed back to that.
  const lines =
    Array.from({ length: 60 }, (_, i) => `2026-08-24T00:00:${String(i).padStart(2, "0")}Z INFO line ${i}`).join(
      "\n",
    ) + "\n";
  await seedApp(page, { ...defaultSeed(), "logs/bdobb.log": lines });
  await openSettingsTab(page, "Logs");

  const footerBox = await page.locator(".bd-footer").boundingBox();
  const logBox = await page.locator(".bd-log").boundingBox();
  if (!footerBox || !logBox) throw new Error("footer or log view did not render");

  // .bd-log sits inside .bd-body, whose own padding is 24px top/bottom
  // (var(--bd-s6)), directly above .bd-footer -- so its bottom edge should
  // land within that 24px inset of the footer's top edge, not clipped to a
  // small fixed height the way the old .log-view (240px max-height) would
  // have left a visible gap.
  expect(footerBox.y - (logBox.y + logBox.height)).toBeLessThanOrEqual(25);
  expect(logBox.height).toBeGreaterThan(200);
});

test("staging a theme change previews immediately; Cancel discards it", async ({ page }) => {
  await seedApp(page, { ...defaultSeed(), "settings.json": JSON.stringify({ theme: "dark" }) });
  await openSettingsTab(page, "General");

  // Start from an explicitly committed Dark preference; v4 defaults to System.
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");

  await page.getByRole("radio", { name: "Light" }).click();
  // Draft edits preview live: selectEffective merges the pending patch, and
  // App.tsx writes it straight to document.documentElement.dataset.theme --
  // before Done, and before the dialog even closes.
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("light");

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toHaveCount(0);
  // Cancel discards the draft, so selectEffective falls back to the
  // committed settings, which never left "dark".
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
});
