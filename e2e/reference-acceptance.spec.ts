// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from "@playwright/test";
import { memfs, openRail, seedApp } from "./fixtures";

const reference = process.env.OPENBQ_REFERENCE_URL;
test.skip(!reference, "Opt-in: requires the pinned, separately running reference backend.");

// Detach the CORS route before the page closes, so teardown errors cannot be
// attributed to the next unrelated test. #30: "wait" blocked for as long as an
// in-flight route.fetch() hung (>90 s on a slow reference request); "ignoreErrors"
// detaches at once and drops only errors raised after teardown. Failures during
// the test still fail.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test("reference Apps, grouped company controls and analytical migration", async ({ page, request }) => {
  test.setTimeout(90_000);
  const manifest = await request.get(`${reference}/apps.json`);
  expect(manifest.ok()).toBe(true);
  const apps = await manifest.json() as Array<{name: string; tabs: Record<string, unknown>}>;
  const referenceApp = apps.find((a) => a.name === "Onboarding App for Devs");
  expect(referenceApp).toBeDefined();
  const companyRequests: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (["/company_details", "/company_performance"].includes(url.pathname)) companyRequests.push(url.searchParams.get("company") ?? "");
  });
  // Match the earlier reference rehearsal: real backend responses, test-only browser CORS adapter.
  await page.route(`${reference}/**`, async (route) => {
    // #30: one request can reach this handler twice (a regression trace showed two
    // fulfills of the same response); whichever fetch finishes second finds the
    // route settled. Only that, or a closed page, is ignored; any other error fails.
    try {
      const response = await route.fetch();
      await route.fulfill({response, headers: {...response.headers(), "access-control-allow-origin": "*"}});
    } catch (error) {
      if (!/Route is already handled|has been closed/.test(String(error))) throw error;
    }
  });
  await seedApp(page, {
    "settings.json": JSON.stringify({collapseWidgetControls: false}),
    "backends.json": JSON.stringify([{id: "reference", name: "Reference", baseUrl: reference, authLocation: "header", validateWidgets: true}]),
    "dashboards/empty.json": JSON.stringify({id: "empty", name: "Empty", tabs: [{id: "empty-tab", name: "Empty", cards: []}]}),
  });
  await openRail(page);
  await page.getByRole("button", {name: "Apps", exact: true}).click();
  await page.getByRole("button", {name: `Open ${referenceApp!.name}`, exact: true}).click();
  await expect(page.getByRole("dialog", {name: "Apps", exact: true})).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(Object.keys(referenceApp!.tabs).length);
  await page.getByRole("tab", {name: "Grouping", exact: true}).click();
  await expect.poll(() => companyRequests.filter((v) => v === "TM").length).toBeGreaterThanOrEqual(2);
  await expect(page.locator(".widget-card table").first()).toBeVisible();
  await page.getByLabel("Manufacturer", {exact: true}).first().selectOption("TSLA");
  await expect.poll(() => companyRequests.filter((v) => v === "TSLA").length).toBeGreaterThanOrEqual(2);
  await page.screenshot({path: "e2e-results/reference-grouping-tesla.png", fullPage: true});
  const analytical = apps.find((a) => a.name.includes("Pivot"));
  if (analytical) {
    const filesBefore = await memfs(page).list();
    await openRail(page);
    await page.getByRole("button", {name: "Apps", exact: true}).click();
    await page.getByRole("button", {name: `Open ${analytical.name}`, exact: true}).click();
    await expect(page.getByRole("dialog", {name: "Apps", exact: true})).toHaveCount(0);
    const before = filesBefore.filter((f) => f.startsWith("dashboards/"));
    await expect.poll(async () => (await memfs(page).list()).filter((f) => f.startsWith("dashboards/")).length).toBe(before.length + 1);
    const added = (await memfs(page).list()).find((f) => f.startsWith("dashboards/") && !before.includes(f));
    const saved = JSON.parse((await memfs(page).read(added!))!);
    // D-007: a curated pivot-v1 overlay imports as the backend table's own pivot.
    expect(saved.tabs.flatMap((t: {cards: Array<{table?: {pivot?: object}}>}) => t.cards).some((c: {table?: {pivot?: object}}) => c.table?.pivot)).toBe(true);
    await expect(page.locator('.widget-card')).not.toHaveCount(0);
    await page.screenshot({path: "e2e-results/reference-pivot-v4.png", fullPage: true});
  }
  // Card polls are still in flight through the CORS adapter when the test ends.
  await page.unrouteAll({behavior: "ignoreErrors"});
});
