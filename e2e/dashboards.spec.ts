// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Page } from "@playwright/test";
import { defaultSeed, memfs, openRail, read, seedApp } from "./fixtures";

/** The rail is collapsed at rest; every row below needs it expanded first. */
const row = (page: Page, name: string) =>
  page.locator("nav.left-rail button.rail-item", { hasText: name });

function twoDashboards() {
  const seed = defaultSeed();
  seed["dashboards/d2.json"] = JSON.stringify({
    id: "d2",
    name: "Second",
    tabs: [{ id: "t2", name: "Main", cards: [] }],
  });
  return seed;
}

/** One known widget id (the mock backend serves `quote`) and one that no backend does. */
const APPS_FIXTURE = JSON.stringify([
  {
    name: "Imported",
    description: "",
    img: "",
    img_dark: "",
    img_light: "",
    allowCustomization: true,
    tabs: {
      "tab-1": {
        id: "tab-1",
        name: "Main",
        layout: [
          {
            i: "quote",
            x: 0,
            y: 0,
            w: 20,
            h: 9,
            state: { params: { symbol: "AAPL" }, chartView: { enabled: false, chartType: "line" } },
          },
          { i: "nowhere", x: 20, y: 0, w: 20, h: 9 },
        ],
      },
    },
    groups: [],
    prompts: [],
  },
]);

test("a folder takes a dragged dashboard, and the tree survives a reload", async ({ page }) => {
  await seedApp(page, twoDashboards());
  await openRail(page);

  await page.locator("nav.left-rail [data-testid='rail-section-label']", { hasText: "My Dashboards" })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "New folder" }).click();
  await page.getByRole("textbox", { name: "Rename folder" }).fill("Macro");
  await page.getByRole("textbox", { name: "Rename folder" }).press("Enter");

  const folder = page.locator("nav.left-rail button.rail-folder-row", { hasText: "Macro" });
  await expect(folder).toBeVisible();

  await row(page, "Second").dragTo(folder);

  // The write is the persistence guarantee at this layer.
  const fs = memfs(page);
  await expect
    .poll(async () => {
      const raw = await fs.read("folders.json");
      return raw ? (JSON.parse(raw) as { placement: Record<string, string> }).placement : undefined;
    })
    .toEqual({ d2: expect.any(String) });

  // A reload starts memfs over from the seed, so the restore is exercised by
  // seeding the file the app just wrote and booting again.
  const written = (await fs.read("folders.json")) as string;
  await seedApp(page, { ...twoDashboards(), "folders.json": written });
  await openRail(page);

  const reloaded = page.locator("nav.left-rail button.rail-folder-row", { hasText: "Macro" });
  await expect(reloaded).toBeVisible();
  await expect(reloaded).toHaveAttribute("aria-expanded", "true");
  // Nested: the row inside the folder is indented past the top-level rows.
  const nested = await row(page, "Second").boundingBox();
  const top = await row(page, "Main").boundingBox();
  if (!nested || !top) throw new Error("rail not laid out");
  expect(nested.x).toBeGreaterThan(top.x);

  await reloaded.click();
  await expect(row(page, "Second")).toHaveCount(0);
});

test("Duplicate adds a copy directly after the original and persists the flat order", async ({ page }) => {
  await seedApp(page, twoDashboards());
  await openRail(page);

  await row(page, "Main").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Duplicate" }).click();

  // Scoped to the dashboards group: .rail-item-label is on the fixed rows too
  // now, so a rail-wide query by that class also picks up Add widget,
  // Widget Library, Connections, Settings and Help.
  const labels = page.locator("nav.left-rail [data-testid='rail-dashboards'] .rail-item-label");
  await expect(labels).toHaveText(["Main", "Main copy", "Second"]);

  await expect
    .poll(async () => {
      const raw = await read(page, "settings.json");
      return raw ? (JSON.parse(raw) as { dashboardOrder?: string[] }).dashboardOrder?.length : undefined;
    })
    .toBe(3);
});

test("importing an apps.json creates its cards, one of them unresolved", async ({ page }) => {
  await seedApp(page, { ...defaultSeed(), "imports/apps.json": APPS_FIXTURE });
  await page.locator(".widget-card").first().waitFor();
  await openRail(page);

  await page.locator("nav.left-rail [data-testid='rail-section-label']", { hasText: "My Dashboards" })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Import apps.json…" }).click();

  await expect(page.getByRole("status")).toHaveText("Imported 1 dashboards, 2 cards (1 unresolved)");

  // The imported dashboard is activated, so its cards are what is on screen.
  await expect(page.locator(".widget-card")).toHaveCount(2);
  await expect(
    page.getByText("Widget nowhere is not on any connected backend."),
  ).toBeVisible();
  // The resolved one really did bind to the mock backend and fetch.
  await expect(page.locator(".widget-card").filter({ hasText: "Quote" }).locator("table")).toBeVisible();
});

test("Save… as Strict OpenBB Workspace writes the documented shape", async ({ page }) => {
  await seedApp(page);
  await page.locator(".widget-card").first().waitFor();
  await openRail(page);

  await row(page, "Main").click({ button: "right" });
  // Browser mode has no native Save panel, so the format comes from Save…'s flyout.
  await page.getByRole("menuitem", { name: "Save…" }).click();
  await page.getByRole("menuitem", { name: "Strict OpenBB Workspace" }).click();

  const fs = memfs(page);
  await expect.poll(() => fs.read("exports/Main.apps.json")).toBeDefined();
  const written = JSON.parse((await fs.read("exports/Main.apps.json")) as string);

  expect(Array.isArray(written)).toBe(true);
  expect(written[0]).toMatchObject({
    name: "Main",
    description: "",
    img: "",
    img_dark: "",
    img_light: "",
    allowCustomization: true,
    groups: [],
    prompts: [],
  });
  expect(Object.keys(written[0].tabs)).toEqual(["t1"]);
  expect(written[0].tabs.t1).toMatchObject({ id: "t1", name: "Main" });
  expect(written[0].tabs.t1.layout.map((l: { i: string }) => l.i)).toEqual(["quote", "prices"]);
  expect(written[0].tabs.t1.layout[0]).toMatchObject({
    i: "quote",
    x: 0,
    y: 0,
    w: 20,
    h: 9,
    state: { params: { symbol: "AAPL" }, chartView: { enabled: false, chartType: "line" } },
  });
});

test("?viewer=<id> shows one dashboard, read-only", async ({ page }) => {
  await seedApp(page, defaultSeed(), "/?viewer=d1");
  await page.locator(".widget-card").first().waitFor();

  await expect(page.locator("nav.left-rail")).toHaveCount(0);
  await expect(page.locator("main.dashboard-area-viewer")).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove card" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add tab" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add widget" })).toHaveCount(0);

  // The parts that must still work.
  await expect(page.getByRole("tab", { name: "Main" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh all" })).toBeVisible();
  await expect(page.locator(".widget-card").filter({ hasText: "Quote" }).locator("table")).toBeVisible();

  // And the guarantee: nothing the viewer window does reaches the file.
  const before = await read(page, "dashboards/d1.json");
  await page.getByRole("button", { name: "Refresh all" }).click();
  await page.waitForTimeout(500);
  expect(await read(page, "dashboards/d1.json")).toBe(before);
});
