// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Page } from "@playwright/test";
import { defaultSeed, openRail, seedApp, type SeedFiles } from "./fixtures";

// Spec 2026-10-12 §4 and §7 in a real engine: the Workspaces dialog's cards
// and notice strip, and the grid's CSS zoom on a screen smaller than the
// workspace's minimum. window.screen is the logical screen the zoom reads.
// Headless Chromium reports the viewport as window.screen, so the viewport
// is the 1080p screen here.
test.use({ viewport: { width: 1920, height: 1080 } });

const row = (page: Page, name: string) => page.locator("nav.left-rail button.rail-item", { hasText: name });

const SIX = [0, 4, 8].flatMap((x) => [0, 6].map((y) => ({ x, y, w: 4, h: 6 })));

function seed(): SeedFiles {
  const files = defaultSeed();
  files["dashboards/d2.json"] = JSON.stringify({ id: "d2", name: "Beta", tabs: [{ id: "t2", name: "Second", cards: [] }] });
  files["workspaces/w1.json"] = JSON.stringify({
    id: "w1",
    name: "Desk 1080",
    preset: "laptop",
    slots: [
      { slot: "a", dashboardId: "d1" },
      { slot: "b", dashboardId: "d2" },
    ],
    minResolution: { width: 1920, height: 1080 },
    openAtLaunch: true,
  });
  files["workspaces/w2.json"] = JSON.stringify({
    id: "w2",
    name: "Trading 4K",
    preset: "full-screen",
    layout: SIX.map((t, n) => ({ slot: String.fromCharCode(97 + n), ...t })),
    slots: [
      { slot: "a", dashboardId: "d1" },
      { slot: "b", dashboardId: "d2" },
    ],
    minResolution: { width: 3840, height: 2160 },
    openAtLaunch: true,
  });
  files["workspaces/w3.json"] = JSON.stringify({ id: "w3", name: "Research", preset: "full-screen", slots: [] });
  return files;
}

async function openDialog(page: Page, name: string) {
  await openRail(page);
  await row(page, name).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit…" }).click();
  const dialog = page.getByRole("dialog", { name: "Workspaces" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("the Workspaces dialog lists every workspace with its minimum, fit and launch", async ({ page }, info) => {
  await seedApp(page, seed());
  const dialog = await openDialog(page, "Desk 1080");
  const rail = dialog.getByRole("navigation", { name: "Workspaces" });
  await expect(rail.getByRole("button", { name: /^Desk 1080,/ })).toHaveAccessibleName("Desk 1080, at least 1920 × 1080, Fits, opens at launch");
  await expect(rail.getByRole("button", { name: /^Trading 4K,/ })).toHaveAccessibleName("Trading 4K, at least 3840 × 2160, Zoom 50%");
  await expect(rail.getByRole("button", { name: /^Research,/ })).toHaveAccessibleName("Research, Any size, Fits");
  await expect(dialog.getByTestId("workspace-dialog-fit")).toHaveText("Fits · 100%");
  await page.screenshot({ path: info.outputPath("dialog-desk.png") });

  await rail.getByRole("button", { name: /^Trading 4K,/ }).click();
  await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue("Trading 4K");
  await expect(dialog.getByTestId("workspace-dialog-fit")).toHaveText("Zoom 50%");
  await expect(dialog.getByRole("combobox", { name: /Minimum resolution/ })).toHaveValue("3840x2160");
  await page.screenshot({ path: info.outputPath("dialog-trading.png") });

  // An edit, then a switch: the dirty bar asks first.
  await dialog.getByRole("textbox", { name: "Name" }).fill("Trading 4K desk");
  await rail.getByRole("button", { name: /^Research,/ }).click();
  await expect(dialog.getByText('Save changes to "Trading 4K desk" before switching?')).toBeVisible();
  await page.screenshot({ path: info.outputPath("dialog-dirty.png") });
  await dialog.getByRole("button", { name: "Discard" }).click();
  await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue("Research");
});

test("a workspace whose minimum is larger than the screen opens zoomed, filling the window", async ({ page }, info) => {
  await seedApp(page, seed());
  const dialog = await openDialog(page, "Trading 4K");
  await dialog.getByRole("button", { name: "Open", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const area = page.locator(".workspace-grid");
  await expect(area).toHaveAttribute("data-zoom", "50");
  const grid = page.locator(".workspace-grid > .react-grid-layout");
  expect(await grid.evaluate((el) => getComputedStyle(el).zoom)).toBe("0.5");
  // Laid out at twice the area and drawn at half: it fills the area exactly.
  const [outer, inner] = await Promise.all([area.boundingBox(), grid.boundingBox()]);
  expect(Math.abs((inner?.width ?? 0) - (outer?.width ?? 0))).toBeLessThan(2);
  expect(Math.abs((inner?.height ?? 0) - (outer?.height ?? 0))).toBeLessThan(2);
  await expect(page.getByTestId("workspace-tile-f")).toBeVisible();
  await page.screenshot({ path: info.outputPath("grid-zoomed.png") });

  // Desk 1080 fits: no zoom at all.
  await openRail(page);
  await row(page, "Desk 1080").click();
  await expect(area).toHaveAttribute("data-zoom", "100");
  expect(await grid.evaluate((el) => getComputedStyle(el).zoom)).toBe("1");
});

test("Arrange mode shows a zoomed workspace at 100%", async ({ page }) => {
  await seedApp(page, seed());
  await openRail(page);
  await row(page, "Trading 4K").click();
  await expect(page.locator(".workspace-grid")).toHaveAttribute("data-zoom", "50");
  await openRail(page);
  await row(page, "Trading 4K").click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Arrange/ }).click();
  await expect(page.locator(".workspace-grid")).toHaveAttribute("data-zoom", "100");
});

// Spec 2026-10-12 §9 "watch for": CSS zoom and pointer hit-testing. Each
// engine must draw a zoomed tile where it receives events, or clicks, hovers
// and drops land on the wrong thing. Every step goes through raw mouse
// coordinates taken from the drawn boxes, so an engine that hit-tests
// against the unzoomed layout fails here.
test("under 50% zoom, the pointer lands on what is drawn under it", async ({ page }) => {
  await seedApp(page, seed());
  await openRail(page);
  await row(page, "Trading 4K").click();
  await page.mouse.move(1200, 600);
  const area = page.locator(".workspace-grid");
  await expect(area).toHaveAttribute("data-zoom", "50");

  // 1. The element under the middle of each drawn tile is inside that tile.
  for (const slot of ["a", "b", "c", "d", "e", "f"]) {
    const tile = page.getByTestId(`workspace-tile-${slot}`);
    const box = (await tile.boundingBox())!;
    const inside = await page.evaluate(
      ({ x, y, id }) => {
        const hit = document.elementFromPoint(x, y);
        return hit !== null && hit.closest(`[data-testid="${id}"]`) !== null;
      },
      { x: box.x + box.width / 2, y: box.y + box.height / 2, id: `workspace-tile-${slot}` },
    );
    expect(inside, `middle of tile ${slot} hit-tests to tile ${slot}`).toBe(true);
  }

  // 2. Hover focus follows the drawn tiles.
  const tileA = page.getByTestId("workspace-tile-a");
  const tileB = page.getByTestId("workspace-tile-b");
  const center = async (l: ReturnType<typeof page.locator>) => {
    const b = (await l.boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  let p = await center(tileB);
  await page.mouse.move(p.x, p.y);
  await expect(tileB).toHaveAttribute("data-focused", "true");
  p = await center(tileA);
  await page.mouse.move(p.x, p.y);
  await expect(tileA).toHaveAttribute("data-focused", "true");

  // 3. A click on a small control inside a zoomed card: Maximize, then the
  // maximized card sits inside its drawn tile.
  const item = tileA.locator(".react-grid-item").first();
  p = await center(item.getByRole("button", { name: "Maximize" }));
  await page.mouse.click(p.x, p.y);
  await expect(item).toHaveClass(/card-maximized/);
  const tile = (await tileA.boundingBox())!;
  await expect
    .poll(async () => {
      const box = (await item.boundingBox())!;
      return Math.max(
        Math.abs(box.x - tile.x),
        Math.abs(box.x + box.width - (tile.x + tile.width)),
        Math.abs(box.y + box.height - (tile.y + tile.height)),
      );
    })
    .toBeLessThanOrEqual(2);

  // 4. A drop from the (unzoomed) rail onto a zoomed tile lands on that tile.
  await openRail(page);
  const tileC = page.getByTestId("workspace-tile-c");
  await row(page, "Beta").dragTo(tileC);
  await expect(tileC.locator('[role="tab"]', { hasText: "Second" })).toHaveCount(1);
});
