// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Page } from "@playwright/test";
import { defaultSeed, memfs, openRail, seedApp } from "./fixtures";

/**
 * Apps discovery, end to end: the mock backend serves an apps.json
 * (scripts/browser-fixtures.mjs — one app, "Macro", two tabs, one card each
 * naming a widget that same backend's widgets.json serves), discovery picks
 * it up alongside widgets.json, and the rail's Apps row is where it surfaces.
 *
 * What only this layer can prove: that discovery really fetched a document
 * nothing seeded, that the dashboard Open creates is a working one whose
 * cards bind to the registry and go out over the network, and that the copy
 * reaches disk. The unit tests own the dialog's grouping, search and image
 * rules; none of that is re-asserted here.
 */

/** The rail row for a dashboard. aria-label is the plain name, collapsed or not. */
const dashboardRow = (page: Page, name: string) =>
  page.locator(`nav.left-rail button.rail-item[aria-label="${name}"]`);

/** The dashboard files on memfs, other than the seeded d1. */
async function importedDashboardIds(page: Page): Promise<string[]> {
  const files = await memfs(page).list();
  return files
    .filter((p) => p.startsWith("dashboards/") && p !== "dashboards/d1.json")
    .map((p) => p.slice("dashboards/".length, -".json".length));
}

async function openAppsDialog(page: Page) {
  await openRail(page);
  await page.locator("nav.left-rail").getByRole("button", { name: "Apps" }).click();
  const dialog = page.getByRole("dialog", { name: "Apps" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("the rail's Apps row opens a backend's app as a dashboard of its own", async ({ page }) => {
  // Installed BEFORE seedApp, which is fixtures.ts's explicit contract: the
  // seeded dashboard's cards can fetch before seedApp returns, and this
  // test's whole point is a DELTA against what the seed asked for.
  const quotes: string[] = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (url.pathname === "/quote") quotes.push(url.search);
  });

  await seedApp(page);
  // The seeded dashboard has settled: everything counted from here is the
  // app copy's doing.
  await page.locator(".widget-card table").first().waitFor();
  const beforeOpen = quotes.length;

  const dialog = await openAppsDialog(page);

  // Under the backend's DISPLAY name ("Mock"), not its id or its URL.
  await expect(dialog.getByRole("heading", { name: "Mock" })).toBeVisible();
  const card = dialog.getByTestId("app-card").filter({ hasText: "Macro" });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Quote and price history");
  await expect(card).toContainText("2 tabs");

  await dialog.getByRole("button", { name: "Open Macro" }).click();

  // The dialog is done: a second Open would ask about the name, not retry.
  await expect(page.getByRole("dialog", { name: "Apps" })).toHaveCount(0);

  // The copy is the active dashboard, and the seeded one is not.
  await expect(dashboardRow(page, "Macro")).toHaveAttribute("aria-current", "true");
  await expect(dashboardRow(page, "Main")).toHaveAttribute("aria-current", "false");

  // Both of the app's tabs are on the strip, in the app's order, with the
  // first one active.
  await expect(page.locator(".tab-bar [role='tab']")).toHaveText(["Overview", "History"]);
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");

  // The card on that tab resolved against the registry and fetched — which
  // is the part no unit test can reach.
  await expect(page.locator(".widget-card").filter({ hasText: "Quote" }).locator("table")).toBeVisible();
  await expect.poll(() => quotes.length).toBeGreaterThan(beforeOpen);
  expect(quotes.slice(beforeOpen).some((s) => s.includes("symbol=AAPL"))).toBe(true);

  // And it is on disk, with both tabs and the app's own card in each.
  await expect.poll(() => importedDashboardIds(page)).toHaveLength(1);
  const [id] = await importedDashboardIds(page);
  const written = JSON.parse((await memfs(page).read(`dashboards/${id}.json`)) as string) as {
    name: string;
    tabs: { name: string; cards: { widgetId: string }[] }[];
  };
  expect(written.name).toBe("Macro");
  expect(written.tabs.map((t) => t.name)).toEqual(["Overview", "History"]);
  expect(written.tabs.map((t) => t.cards.map((c) => c.widgetId))).toEqual([["quote"], ["prices"]]);
});

/** The conflict dialog the rail's Import and a dropped file use (v3.0.8), here for an Open. */
const conflictDialog = (page: Page) =>
  page.getByRole("dialog", { name: 'A dashboard named "Macro" already exists' });

// v4.0.5: Open no longer opens a silently renamed copy when the name is
// taken; it asks through the import-conflict dialog, as Import does.
test("opening the same app again asks first: Skip leaves the Apps dialog open, Keep both opens Macro (2)", async ({
  page,
}) => {
  await seedApp(page);
  await page.locator(".widget-card table").first().waitFor();

  const first = await openAppsDialog(page);
  await first.getByRole("button", { name: "Open Macro" }).click();
  await expect(dashboardRow(page, "Macro")).toHaveAttribute("aria-current", "true");

  const second = await openAppsDialog(page);
  await second.getByRole("button", { name: "Open Macro" }).click();
  const ask = conflictDialog(page);
  await expect(ask).toBeVisible();
  // The safe answer is the focused one, as for a file.
  await expect(ask.getByRole("button", { name: /^Keep both/ })).toBeFocused();
  await expect(ask.getByRole("button", { name: /^Keep both/ })).toContainText('Adds it as "Macro (2)"');

  // Skip: nothing written, and the catalogue is still there for another pick.
  await ask.getByRole("button", { name: /^Skip/ }).click();
  await expect(ask).toHaveCount(0);
  await expect(second).toBeVisible();
  await expect.poll(() => importedDashboardIds(page)).toHaveLength(1);

  // Keep both: the renamed copy, opened.
  await second.getByRole("button", { name: "Open Macro" }).click();
  await conflictDialog(page).getByRole("button", { name: /^Keep both/ }).click();
  await expect(page.getByRole("dialog", { name: "Apps" })).toHaveCount(0);
  await expect(dashboardRow(page, "Macro (2)")).toHaveAttribute("aria-current", "true");
  await expect(dashboardRow(page, "Macro")).toHaveAttribute("aria-current", "false");
  await expect.poll(() => importedDashboardIds(page)).toHaveLength(2);
});

test("opening an app whose name is taken asks, and Replace swaps the app into yours", async ({
  page,
}) => {
  const seed = defaultSeed();
  seed["dashboards/d2.json"] = JSON.stringify({
    id: "d2",
    name: "Macro",
    tabs: [{ id: "t2", name: "Mine", cards: [] }],
  });
  await seedApp(page, seed);
  // Booted once both dashboards are in the rail. Not the seeded table: the
  // dashboard that opens first may be the empty "Macro", which has none.
  await expect(dashboardRow(page, "Main")).toHaveCount(1);
  await expect(dashboardRow(page, "Macro")).toHaveCount(1);

  const dialog = await openAppsDialog(page);
  await dialog.getByRole("button", { name: "Open Macro" }).click();
  const ask = conflictDialog(page);
  await expect(ask).toBeVisible();
  await expect(ask).toContainText("Yours: 1 tabs, 0 cards");
  await expect(ask).toContainText("In the file: 2 tabs, 2 cards");
  await ask.getByRole("button", { name: /^Replace/ }).click();

  await expect(page.getByRole("dialog", { name: "Apps" })).toHaveCount(0);
  // Yours keeps its id and its name, and is the one opened.
  await expect(dashboardRow(page, "Macro")).toHaveCount(1);
  await expect(dashboardRow(page, "Macro")).toHaveAttribute("aria-current", "true");
  await expect(page.locator(".tab-bar [role='tab']")).toHaveText(["Overview", "History"]);
  await expect
    .poll(async () => JSON.parse((await memfs(page).read("dashboards/d2.json")) as string))
    .toMatchObject({ id: "d2", name: "Macro", tabs: [{ name: "Overview" }, { name: "History" }] });
  expect(await importedDashboardIds(page)).toEqual(["d2"]);
});
