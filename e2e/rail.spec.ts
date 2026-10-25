// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from "@playwright/test";
import { defaultSeed, openRail, read, seedApp } from "./fixtures";

// Page-level only: Chromium proves the rail's drag handlers reorder and
// persist. Whether the drop reaches the page inside the Tauri window is a
// separate layer (tauri.conf.json `dragDropEnabled: false` — with Tauri's
// native handler armed, wry answers performDragOperation itself and WKWebView
// never sees the drop) and stays a human check in the desktop app.
test("dragging a dashboard row onto another reorders the rail and persists the order", async ({ page }) => {
  const seed = defaultSeed();
  seed["dashboards/d2.json"] = JSON.stringify({ id: "d2", name: "Second", tabs: [{ id: "t2", name: "Main", cards: [] }] });
  await seedApp(page, seed);
  await openRail(page);

  // Scoped to the dashboards group: .rail-item-label is on the fixed rows too
  // now, so a rail-wide query by that class also picks up Add widget,
  // Widget Library, Connections, Settings and Help.
  const labels = page.locator("nav.left-rail [data-testid='rail-dashboards'] .rail-item-label");
  await expect(labels).toHaveText(["Main", "Second"]);

  const row = (name: string) => page.locator("nav.left-rail button.rail-item", { hasText: name });
  await row("Second").dragTo(row("Main"));

  await expect(labels).toHaveText(["Second", "Main"]);
  await expect
    .poll(async () => {
      const raw = await read(page, "settings.json");
      return raw ? (JSON.parse(raw) as { dashboardOrder?: string[] }).dashboardOrder : undefined;
    })
    .toEqual(["d2", "d1"]);
});

/**
 * The bottom group survives a dashboard list that is taller than the rail.
 * `.left-rail` is a fixed-height `overflow: hidden` flex column, so with no
 * scroll container in it a long `.rail-top` pushes Connections/Settings/Help
 * clean off the bottom edge and they are clipped away -- and only while
 * expanded, because the collapsed rail drops every label and section label
 * and so fits far more rows in the same height.
 *
 * Fourteen is the first count that overflows the 1280x720 viewport expanded
 * (top group 656px + bottom group 108px = 764 > 720) while still fitting
 * collapsed (512 + 108 = 620). Real installs have many more.
 */
test("the bottom group stays visible when the dashboard list outgrows the expanded rail", async ({ page }) => {
  const seed = defaultSeed();
  for (let i = 2; i <= 14; i++) {
    seed[`dashboards/d${i}.json`] = JSON.stringify({
      id: `d${i}`,
      name: `Dashboard ${i}`,
      tabs: [{ id: `t${i}`, name: "Main", cards: [] }],
    });
  }
  await seedApp(page, seed);
  await openRail(page);

  const help = page.getByRole("button", { name: "Help" });
  // Not toBeVisible(): a row clipped by an ancestor's `overflow: hidden` still
  // has a non-empty box and still passes that check. What breaks is where the
  // box lands -- below the rail's bottom edge, where nothing can hit it.
  await expect(help).toBeInViewport();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const button = document.querySelector<HTMLElement>('nav.left-rail button[aria-label="Help"]');
        if (!button) return "no Help button";
        const box = button.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return hit && button.contains(hit) ? "Help" : `${hit?.tagName ?? "nothing"} at the Help row's centre`;
      }),
    )
    .toBe("Help");

  // And it still works as a button, which is the whole point of it being there.
  await help.click();
  await expect(page.getByRole("menuitem", { name: /report a bug/i })).toBeVisible();
});

// The import notice is a third child of the rail's space-between column, so it
// pulled the bottom controls up to the middle and left a gap above itself
// (Codex measured 191px in the v3.1 rehearsal); collapsed, it wrapped into a
// one-word-wide column.
test("import feedback sits directly under the bottom controls and hides when the rail collapses", async ({ page }) => {
  const seed = defaultSeed();
  seed["imports/apps.json"] = JSON.stringify([{ name: "Imported", tabs: { t: { id: "t", name: "Main", layout: [] } } }]);
  await seedApp(page, seed);
  await openRail(page);

  await page.locator("nav.left-rail [data-testid='rail-section-label']", { hasText: "My Dashboards" })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Import apps.json…" }).click();
  await expect(page.getByRole("status")).toContainText("Imported 1 dashboards");

  await openRail(page);
  const help = await page.getByRole("button", { name: "Help", exact: true }).boundingBox();
  const status = await page.getByRole("status").boundingBox();
  expect(status!.y - (help!.y + help!.height)).toBeLessThan(24);

  await page.mouse.move(640, 400);
  await expect(page.locator(".rail-notice")).toBeHidden();
});

// Hover is mouse-only, and collapsed the rail hides every label and the import
// notice, so a keyboard user could reach the rows but never open the rail.
// Keyboard focus inside it now expands it, as it does the file rail.
test("keyboard focus inside the rail expands it", async ({ page }) => {
  await seedApp(page);

  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate(() => document.activeElement?.closest("nav.left-rail") !== null)) break;
  }

  const restWidth = await page.evaluate(
    () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--rail-width")) || 48,
  );
  await expect
    .poll(async () => (await page.locator("nav.left-rail").boundingBox())?.width ?? 0)
    .toBeGreaterThan(restWidth);
  await expect(page.locator("nav.left-rail [data-testid='rail-dashboards'] .rail-item-label")).toHaveText(["Main"]);
});
