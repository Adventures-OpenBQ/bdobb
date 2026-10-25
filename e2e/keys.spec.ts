// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Page } from "@playwright/test";
import { openSettings, openSettingsTab, seedApp } from "./fixtures";

/** Every request the page makes to the mock's /keys endpoint, in order, as its run_tests value. */
function trackKeysRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname === "/keys" && req.method() === "GET") seen.push(url.searchParams.get("run_tests") ?? "");
  });
  return seen;
}

test("opening Settings issues no /keys request; selecting Provider keys fetches status; Refresh probes once; leaving and returning to Provider keys re-fetches nothing", async ({
  page,
}) => {
  const keys = trackKeysRequests(page);
  await seedApp(page);

  // KeysPanel only mounts once its tab is selected, so landing on Settings
  // (General by default) must not touch /keys at all. Waiting for the
  // General panel itself (rather than jumping straight to the timeout) is
  // the positive signal that the dialog has actually rendered before the
  // negative (no-/keys-request) assertion below is trusted.
  await openSettings(page);
  await expect(page.getByRole("tabpanel", { name: "General" })).toBeVisible();
  await page.waitForTimeout(300);
  expect(keys).toHaveLength(0);

  await page.getByRole("tab", { name: "Provider API Keys" }).click();
  await expect(page.getByText("Own key")).toBeVisible();
  // Selecting the tab = status only. Under the dev server React StrictMode
  // double-invokes the mount effect, so the COUNT of status fetches is an
  // environment detail; the invariant is that none of them probed vendors.
  expect(keys.length).toBeGreaterThan(0);
  expect(keys.every((v) => v === "false")).toBe(true);

  // "Refresh key status" was the old keys-table's button; ProviderDashboard
  // (B9) renamed it "Check all providers" -- see KeysPanel.test.tsx.
  await page.getByRole("button", { name: "Check all providers" }).click();
  // Check all = exactly one vendor probe, and nothing else changes.
  await expect.poll(() => keys.filter((v) => v === "true")).toHaveLength(1);
  // Settle: a late second probe would show up here.
  await page.waitForTimeout(500);
  expect(keys.filter((v) => v === "true")).toHaveLength(1);
  expect(keys.filter((v) => v !== "true").every((v) => v === "false")).toBe(true);

  // KeysPanel now stays mounted (hidden, not torn down) once visited, so a
  // Layout -> Provider keys round trip must not issue any further /keys
  // request at all.
  const countAfterRefresh = keys.length;
  await page.getByRole("tab", { name: "Layout" }).click();
  await page.getByRole("tab", { name: "Provider API Keys" }).click();
  await expect(page.getByText("Own key")).toBeVisible();
  await page.waitForTimeout(300);
  expect(keys).toHaveLength(countAfterRefresh);
});

test("Escape with a provider's Details dialog open closes only Details, not Settings", async ({ page }) => {
  // ProviderDashboard's cards replaced the old keys-table + row context menu
  // this test used to exercise; Details is now its own child dialog opened
  // over Settings (useChildDialog), so this is the current DOM's version of
  // the same one-Escape-closes-only-the-top-layer invariant.
  await seedApp(page);
  await openSettingsTab(page, "Provider API Keys");
  await page.getByRole("button", { name: "Details for FMP" }).click();
  await expect(page.getByRole("dialog", { name: "FMP" })).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(page.getByRole("dialog", { name: "FMP" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
});
