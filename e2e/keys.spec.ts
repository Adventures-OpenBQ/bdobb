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

/**
 * Boot itself now asks key-maint for probed rows -- that is what colours the
 * Library's badges with nothing clicked (design D4) -- so a test about what
 * OPENING something costs has to start from what boot already spent.
 *
 * Waits for that first probe and then for the list to stop growing, rather
 * than for a fixed number of requests: the dev server runs under React
 * StrictMode, so whether bootstrap's second pass joins the first refresh or
 * starts its own is an environment detail.
 */
async function keysAtBoot(keys: string[]): Promise<number> {
  await expect.poll(() => keys.filter((v) => v === "true").length).toBeGreaterThan(0);
  let previous = -1;
  await expect
    .poll(
      () => {
        const settled = keys.length === previous;
        previous = keys.length;
        return settled;
      },
      { intervals: [200, 200, 200, 200, 200, 200] },
    )
    .toBe(true);
  return keys.length;
}

/**
 * The startup branch of providerKeysStore, end to end: a key-maint backend
 * is discovered, asked ONCE for probed rows, and its answer is what the
 * Library's provider badge shows -- before anything has been opened or
 * clicked. The mock rejects FMP on purpose, and this app's own start-up probe
 * would have turned that same badge GREEN (see library.spec.ts), so amber
 * here can only have come from key-maint.
 */
test("the Library's provider badge is coloured by key-maint at boot, with nothing clicked", async ({
  page,
}) => {
  const keys = trackKeysRequests(page);
  await seedApp(page);

  await expect.poll(() => keys.filter((v) => v === "true").length).toBeGreaterThan(0);

  await page.keyboard.press("Meta+k");
  const library = page.getByRole("dialog", { name: "Widget library" });
  await library.waitFor();
  const badge = library
    .getByRole("button", { name: /^Add Quote\b/ })
    .getByTestId("source-badge");

  await expect.poll(() => badge.getAttribute("data-tone")).toBe("amber");
});

// "Provider keys" in this title is the Keys tab, labelled "Provider API Keys"
// since v3.0.3.
test("opening Settings issues no /keys request; selecting Provider keys fetches status; Check all probes once; leaving and returning to Provider keys re-fetches nothing", async ({
  page,
}) => {
  const keys = trackKeysRequests(page);
  await seedApp(page);
  // Everything below is measured against what boot already spent, not
  // against zero: the store's own key-maint read happens before any of this.
  const atBoot = await keysAtBoot(keys);
  const since = () => keys.slice(atBoot);

  // KeysPanel only mounts once its tab is selected, so landing on Settings
  // (General by default) must not touch /keys at all. Waiting for the
  // General panel itself (rather than jumping straight to the timeout) is
  // the positive signal that the dialog has actually rendered before the
  // negative (no-/keys-request) assertion below is trusted.
  await openSettings(page);
  await expect(page.getByRole("tabpanel", { name: "General" })).toBeVisible();
  await page.waitForTimeout(300);
  expect(since()).toEqual([]);

  await page.getByRole("tab", { name: "Provider API Keys" }).click();
  await expect(page.getByRole("heading", { name: "FMP" })).toBeVisible();
  // Selecting the tab = status only. Under the dev server React StrictMode
  // double-invokes the mount effect, so the COUNT of status fetches is an
  // environment detail; the invariant is that none of them probed vendors.
  expect(since().length).toBeGreaterThan(0);
  expect(since().every((v) => v === "false")).toBe(true);

  await page.getByRole("button", { name: "Check all providers" }).click();
  // Check all = exactly one vendor probe, and nothing else changes.
  await expect.poll(() => since().filter((v) => v === "true")).toHaveLength(1);
  // Settle: a late second probe would show up here.
  await page.waitForTimeout(500);
  expect(since().filter((v) => v === "true")).toHaveLength(1);
  expect(since().filter((v) => v !== "true").every((v) => v === "false")).toBe(true);

  // KeysPanel now stays mounted (hidden, not torn down) once visited, so a
  // Layout -> Provider keys round trip must not issue any further /keys
  // request at all. Since v3.0.3 that tab is labelled "Provider API Keys".
  const countAfterRefresh = keys.length;
  await page.getByRole("tab", { name: "Layout" }).click();
  await page.getByRole("tab", { name: "Provider API Keys" }).click();
  await expect(page.getByRole("heading", { name: "FMP" })).toBeVisible();
  await page.waitForTimeout(300);
  expect(keys).toHaveLength(countAfterRefresh);
});

test("Escape with Details open closes only Details, not Settings", async ({ page }) => {
  await seedApp(page);
  await openSettingsTab(page, "Provider API Keys");
  await page.getByRole("heading", { name: "FMP" }).waitFor();
  await page.getByRole("button", { name: "Details for FMP" }).click();
  await expect(page.getByRole("dialog", { name: "FMP" })).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(page.getByRole("dialog", { name: "FMP" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
});
