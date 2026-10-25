// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_CARDS, defaultSeed, memfs, openRail, read, seedApp, type SeedFiles } from "./fixtures";

/** The rail is collapsed at rest; every row below needs it expanded first, same as dashboards.spec.ts. */
const row = (page: Page, name: string) =>
  page.locator("nav.left-rail button.rail-item", { hasText: name });

const library = (page: Page) => page.getByRole("dialog", { name: "Widget library" });

/** Same shape as library.spec.ts's own helper: the aria-label gains a suffix when the widget is already on the target tab. */
const libraryCard = (page: Page, name: string) =>
  library(page).getByRole("button", { name: new RegExp(`^Add ${name}\\b`) });

/**
 * Two dashboards -- "Main" (the default seed's d1, carrying its usual quote
 * and prices cards) and "Beta" (an empty second tab, so a widget added to it
 * during the test is the only card there) -- plus one Laptop-preset
 * workspace with both slots already filled.
 *
 * Seeding the workspace file directly, the way defaultSeed seeds
 * dashboards/backends, is what the task brief asks for: it is faster and
 * less brittle than driving the "New workspace" context-menu path, which is
 * already covered by LeftRail.test.tsx and railMenu.test.tsx. Activating it
 * still has to go through the rail, though -- activeWorkspaceId lives only in
 * workspacesStore's in-memory state (see workspacesStore.ts), not in any
 * seeded file, so there is nothing to seed for "this workspace is the one
 * open."
 */
function laptopWorkspaceSeed(): SeedFiles {
  const seed = defaultSeed();
  seed["dashboards/d2.json"] = JSON.stringify({
    id: "d2",
    name: "Beta",
    tabs: [{ id: "t2", name: "Second", cards: [] }],
  });
  seed["workspaces/w1.json"] = JSON.stringify({
    id: "w1",
    name: "Laptop",
    preset: "laptop",
    slots: [
      { slot: "a", dashboardId: "d1" },
      { slot: "b", dashboardId: "d2" },
    ],
  });
  return seed;
}

// The rail expands only under the mouse, and collapsed it hides the lock, so
// the lock must show while keyboard focus is inside the rail -- but not after
// a mouse click that merely leaves focus on a row (Chromium focuses a clicked
// button), or the lock would sit in the collapsed rail until focus moved.
test("the rail lock is reachable by keyboard, and a mouse click does not keep it on screen", async ({ page }) => {
  await openLaptopWorkspace(page);
  await page.mouse.move(640, 400);
  await expect(page.locator("nav.left-rail[data-expanded='true']")).toHaveCount(0);
  const lock = page.getByRole("button", { name: "Pin the rail open" });
  // Collapsed, the lock is clipped away (focusable, not display: none), which
  // Playwright counts as visible; the computed clip-path is what tells the two
  // states apart.
  const clipped = () => lock.evaluate((el) => getComputedStyle(el).clipPath !== "none");
  expect(await clipped()).toBe(true);

  // Real key presses, not locator.focus(): :focus-visible follows the last
  // interaction, and a programmatic focus after the mouse above would not
  // count as keyboard use. The row click left focus on the Laptop row, and the
  // lock sits above the rows in the LIBRARY header, so walk backwards to it.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Shift+Tab");
    if (await lock.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(lock).toBeFocused();
  expect(await clipped()).toBe(false);

  // A mouse click on a row leaves focus there without :focus-visible. This
  // used to be a dashboard row, not the active workspace's, which would leave
  // the workspace -- but since issue #320 a dashboard row's click leaves it
  // too, and the lock exists only inside one. So the workspace's own row,
  // clicked twice: out, then back in, focus left on it by the mouse.
  await page.keyboard.press("Escape");
  await openRail(page);
  await row(page, "Laptop").click();
  await expect(page.getByTestId("workspace-tile-a")).toHaveCount(0);
  await row(page, "Laptop").click();
  await expect(page.getByTestId("workspace-tile-a")).toBeVisible();
  await page.mouse.move(640, 400);
  await expect(page.locator("nav.left-rail[data-expanded='true']")).toHaveCount(0);
  await expect.poll(clipped).toBe(true);
});

// The rail expands only under the mouse, and collapsed it clips the Workspaces
// "+" away, so the "+" must still take keyboard focus (which then expands the
// rail) -- but a mouse click that merely leaves focus on a row must not keep
// it on screen in the collapsed rail.
test("the Workspaces + is reachable by keyboard, and a mouse click does not keep it on screen", async ({ page }) => {
  await openLaptopWorkspace(page);
  await page.mouse.move(640, 400);
  await expect(page.locator("nav.left-rail[data-expanded='true']")).toHaveCount(0);
  const add = page.getByRole("button", { name: "New workspace", exact: true });
  // Clipped away (focusable, not display: none) counts as visible to
  // Playwright; the computed clip-path tells the two states apart.
  const clipped = () => add.evaluate((el) => getComputedStyle(el).clipPath !== "none");
  expect(await clipped()).toBe(true);

  // Real key presses, not locator.focus(): :focus-visible follows the last
  // interaction. The row click left focus on the Laptop row; the "+" sits in
  // the WORKSPACES header just above it.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Shift+Tab");
    if (await add.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(add).toBeFocused();
  expect(await clipped()).toBe(false);

  // A mouse click on a dashboard row (not the active workspace's row, which
  // would leave the workspace) leaves focus there without :focus-visible.
  await page.keyboard.press("Escape");
  await openRail(page);
  await page.getByRole("button", { name: "Main", exact: true }).click();
  await page.mouse.move(640, 400);
  await expect(page.locator("nav.left-rail[data-expanded='true']")).toHaveCount(0);
  await expect.poll(clipped).toBe(true);
});

/** Seeds the fixture above, boots the app, and activates the one workspace it seeds. */
async function openLaptopWorkspace(page: Page): Promise<void> {
  await seedApp(page, laptopWorkspaceSeed());
  await openRail(page);
  await row(page, "Laptop").click();
  await expect(page.getByTestId("workspace-tile-a")).toBeVisible();
}

test("a Laptop workspace tiles two dashboards, each showing its own tab bar", async ({ page }) => {
  await openLaptopWorkspace(page);

  // Both dashboards are on screen at once, not one replacing the other.
  const tileA = page.getByTestId("workspace-tile-a");
  const tileB = page.getByTestId("workspace-tile-b");
  await expect(tileA).toBeVisible();
  await expect(tileB).toBeVisible();

  // Each tile runs its OWN DashboardGrid/TabBar pair (see WorkspaceTile.tsx),
  // so the tab name proves which dashboard is actually rendered where, not
  // just that two boxes exist. d1's seeded tab is "Main", d2's is "Second".
  await expect(tileA.getByRole("tab", { name: "Main" })).toBeVisible();
  await expect(tileB.getByRole("tab", { name: "Second" })).toBeVisible();

  // And it really is two independent tab bars, not one shared across tiles.
  await expect(page.getByRole("tablist")).toHaveCount(2);
});

test("hovering a tile focuses it and un-focuses the other", async ({ page }) => {
  await openLaptopWorkspace(page);
  const tileA = page.getByTestId("workspace-tile-a");
  const tileB = page.getByTestId("workspace-tile-b");

  // WorkspaceTile's data-focused tracks dashboardStore.activeId, which the
  // tile's own onMouseEnter sets (see WorkspaceTile.tsx) -- so entering tile
  // b is what has to move it, not just seeding order.
  await tileB.hover();
  await expect(tileB).toHaveAttribute("data-focused", "true");
  // toHaveAttribute with no value would also pass on data-focused="false";
  // the component only ever sets the attribute to "true" or omits it
  // entirely (`data-focused={focused ? "true" : undefined}`), so "not
  // present at all" is the actual un-focused shape to assert.
  await expect(tileA).not.toHaveAttribute("data-focused");

  // And it follows the mouse back, rather than latching permanently to b.
  await tileA.hover();
  await expect(tileA).toHaveAttribute("data-focused", "true");
  await expect(tileB).not.toHaveAttribute("data-focused");
});

test("⌘K adds a widget to the hovered tile, not the other one", async ({ page }) => {
  await openLaptopWorkspace(page);
  const tileA = page.getByTestId("workspace-tile-a");
  const tileB = page.getByTestId("workspace-tile-b");

  // Focus tile b: d2's tab starts empty, so its grid-item count is
  // unambiguous, and it is a different dashboard than a's -- proving the
  // library targets the FOCUSED tile's dashboard (App.tsx's openLibrary
  // reads dashboardStore's activeId, which the hover above set) rather than
  // always the first slot.
  await tileB.hover();
  await expect(tileB).toHaveAttribute("data-focused", "true");

  const beforeA = await tileA.locator(".react-grid-item").count();
  const beforeB = await tileB.locator(".react-grid-item").count();

  await page.keyboard.press("Meta+k");
  await library(page).waitFor();
  await libraryCard(page, "Quote").click();

  // The hovered tile gained a card...
  await expect(tileB.locator(".react-grid-item")).toHaveCount(beforeB + 1);
  // ...and the other tile did not.
  await expect(tileA.locator(".react-grid-item")).toHaveCount(beforeA);
});

test("a card maximized in a tile fills that tile's dashboard, not the whole workspace", async ({ page }) => {
  await openLaptopWorkspace(page);
  const tileA = page.getByTestId("workspace-tile-a");
  const tileB = page.getByTestId("workspace-tile-b");
  const item = tileA.locator(".react-grid-item").first();

  const tile = (await tileA.boundingBox())!;
  const bar = (await tileA.locator(".tab-bar").boundingBox())!;
  const other = (await tileB.boundingBox())!;
  await item.getByRole("button", { name: "Maximize" }).click();
  await expect(item).toHaveClass(/card-maximized/);

  // Settle on the right edge first: the class and the layout are separate
  // frames. Unfixed, the card runs to the window's right edge, over tile b.
  // 2px of slack on the tile's sides is its 1px border, which the card sits
  // inside.
  await expect
    .poll(async () => {
      const box = (await item.boundingBox())!;
      return Math.abs(box.x + box.width - (tile.x + tile.width));
    })
    .toBeLessThanOrEqual(2);
  const box = (await item.boundingBox())!;
  expect(Math.abs(box.x - tile.x), `left ${box.x} vs tile left ${tile.x}`).toBeLessThanOrEqual(2);
  expect(
    Math.abs(box.y - (bar.y + bar.height)),
    `top ${box.y} vs the tile's tab bar bottom ${bar.y + bar.height}`,
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(box.y + box.height - (tile.y + tile.height)),
    `bottom ${box.y + box.height} vs tile bottom ${tile.y + tile.height}`,
  ).toBeLessThanOrEqual(2);
  // The other tile is left in view: the card stops short of it.
  expect(box.x + box.width).toBeLessThanOrEqual(other.x);

  // ...and usable: moving into it gives it the focus without restoring the
  // card. Focus follows the mouse, and a tile taking focus is not a dashboard
  // being left.
  await tileB.hover();
  await expect(tileB).toHaveAttribute("data-focused", "true");
  await expect(item).toHaveClass(/card-maximized/);
});

// A dashboard taller than its tile scrolls inside it, below its own tab bar.
// The tile clips, so before tiles scrolled its lower cards could not be
// reached at all.
test("a dashboard taller than its tile scrolls inside it, under its own tab bar", async ({ page }) => {
  const seed = laptopWorkspaceSeed();
  // Stacked in one column: the grid compacts upward, so only height puts a
  // card below the tile's bottom edge.
  const stacked = [0, 1, 2].map((n) => ({ ...DEFAULT_CARDS[0], id: `c-${n}`, layout: { x: 0, y: n * 20, w: 20, h: 20 } }));
  seed["dashboards/d2.json"] = JSON.stringify({ id: "d2", name: "Beta", tabs: [{ id: "t2", name: "Second", cards: stacked }] });
  await seedApp(page, seed);
  await openRail(page);
  await row(page, "Laptop").click();
  const tileB = page.getByTestId("workspace-tile-b");
  const last = tileB.locator(".react-grid-item").last();
  await expect(last).toBeAttached();
  const tile = (await tileB.boundingBox())!;
  const bar = (await tileB.locator(".tab-bar").boundingBox())!;
  expect((await last.boundingBox())!.y).toBeGreaterThan(tile.y + tile.height);

  await tileB.hover();
  await page.mouse.wheel(0, 5000);

  await expect
    .poll(async () => {
      const box = (await last.boundingBox())!;
      return box.y + box.height <= tile.y + tile.height + 1;
    })
    .toBe(true);
  // The tab bar is not part of what scrolls.
  expect((await tileB.locator(".tab-bar").boundingBox())!.y).toBe(bar.y);
});

test("clicking the active workspace row returns to single-dashboard mode", async ({ page }) => {
  await openLaptopWorkspace(page);

  await expect(page.getByTestId("workspace-tile-a")).toBeVisible();
  await expect(page.getByTestId("workspace-tile-b")).toBeVisible();

  // Clicking the workspace you are already on is the documented way to leave
  // it (LeftRail.tsx: `onClick={() => setActiveWorkspace(active ? null : w.id)}`).
  await openRail(page);
  await row(page, "Laptop").click();

  // The tiled grid is gone, replaced by exactly one dashboard...
  await expect(page.getByTestId("workspace-tile-a")).toHaveCount(0);
  await expect(page.getByTestId("workspace-tile-b")).toHaveCount(0);
  await expect(page.locator(".workspace-grid")).toHaveCount(0);
  await expect(page.locator(".dashboard-grid")).toHaveCount(1);
  // ...one tab bar, not two.
  await expect(page.getByRole("tablist")).toHaveCount(1);
});

// Spec 2026-09-30 §6 e2e: the dialog end to end in a real engine.

test("the dialog creates a Laptop workspace with two dashboards and switches into it", async ({ page }) => {
  // The fixture's two dashboards, with no workspace seeded at all: the
  // Workspaces header and its + must be there regardless.
  const seed = laptopWorkspaceSeed();
  delete seed["workspaces/w1.json"];
  await seedApp(page, seed);
  await openRail(page);
  await page.getByRole("button", { name: "New workspace" }).click();

  const dialog = page.getByRole("dialog", { name: "Workspaces" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Name" }).fill("Desk");
  await dialog.getByRole("group", { name: "Layout" }).getByRole("button", { name: "Laptop" }).click();
  const tree = dialog.getByRole("group", { name: "Dashboards" });
  // A selects first; each click moves the selection on to the next empty tile.
  await tree.getByRole("button", { name: "Main", exact: true }).click();
  await tree.getByRole("button", { name: "Beta", exact: true }).click();
  await dialog.getByRole("button", { name: "Open", exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("workspace-tile-a").getByRole("tab", { name: "Main" })).toBeVisible();
  await expect(page.getByTestId("workspace-tile-b").getByRole("tab", { name: "Second" })).toBeVisible();
  await openRail(page);
  await expect(row(page, "Desk")).toHaveAttribute("aria-current", "true");
});

test("Edit… reopens the workspace, previews the swap on the grid behind, and Open keeps it", async ({ page }) => {
  await openLaptopWorkspace(page);
  await openRail(page);
  await row(page, "Laptop").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit…" }).click();

  const dialog = page.getByRole("dialog", { name: "Workspaces" });
  await expect(dialog).toBeVisible();
  const tree = dialog.getByRole("group", { name: "Dashboards" });
  // Both tiles are full, so A is selected. Beta moves from B into A (B is
  // left empty and selected next), then Main goes into B.
  await tree.getByRole("button", { name: /^Beta/ }).click();
  await tree.getByRole("button", { name: /^Main/ }).click();

  // The live preview: the real grid behind the modal has already swapped.
  // CSS locators, because the page behind a modal is inert to role queries.
  await expect(page.getByTestId("workspace-tile-a").locator('[role="tab"]', { hasText: "Second" })).toHaveCount(1);
  await expect(page.getByTestId("workspace-tile-b").locator('[role="tab"]', { hasText: "Main" })).toHaveCount(1);

  await dialog.getByRole("button", { name: "Open", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("workspace-tile-a").getByRole("tab", { name: "Second" })).toBeVisible();
  await expect(page.getByTestId("workspace-tile-b").getByRole("tab", { name: "Main" })).toBeVisible();
});

test("⌥N opens the New workspace dialog, and Escape closes it having created nothing", async ({ page }) => {
  await seedApp(page, defaultSeed());
  await page.keyboard.press("Alt+KeyN");
  const dialog = page.getByRole("dialog", { name: "Workspaces" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  // Nothing was written: no "Untitled" workspace row appeared in the rail.
  await openRail(page);
  await expect(row(page, "Untitled")).toHaveCount(0);
});

// Issue #320: a rail click opens a dashboard ALONE; placing one is a drag
// onto a tile or the row menu's Put in panel ▸. The issue's acceptance checks
// 1-4, with a click where it asked for a double-click (the ruling on #320).
// "Gamma" sits in neither tile of the Laptop workspace.
function laptopWithGammaSeed(): SeedFiles {
  return {
    ...laptopWorkspaceSeed(),
    "dashboards/d3.json": JSON.stringify({ id: "d3", name: "Gamma", tabs: [{ id: "t3", name: "Third", cards: [] }] }),
  };
}

async function openLaptopWithGamma(page: Page): Promise<void> {
  await seedApp(page, laptopWithGammaSeed());
  await openRail(page);
  await row(page, "Laptop").click();
  await expect(page.getByTestId("workspace-tile-a")).toBeVisible();
}

test("a click on a dashboard in neither tile opens it alone, and the workspace comes back as it was", async ({ page }) => {
  await openLaptopWithGamma(page);
  const before = await read(page, "workspaces/w1.json");

  await openRail(page);
  await row(page, "Gamma").click();

  // Only Gamma: no workspace grid, one dashboard, one tab bar -- Gamma's.
  await expect(page.locator(".workspace-grid")).toHaveCount(0);
  await expect(page.locator(".dashboard-grid")).toHaveCount(1);
  await expect(page.getByRole("tablist")).toHaveCount(1);
  await expect(page.getByRole("tab", { name: "Third" })).toBeVisible();
  // The first click persisted no tile replacement: the file is as it was.
  expect(await read(page, "workspaces/w1.json")).toBe(before);

  await row(page, "Laptop").click();
  await expect(page.getByTestId("workspace-tile-a").getByRole("tab", { name: "Main" })).toBeVisible();
  await expect(page.getByTestId("workspace-tile-b").getByRole("tab", { name: "Second" })).toBeVisible();
  expect(await read(page, "workspaces/w1.json")).toBe(before);
});

test("dragging a rail row onto tile B changes only B", async ({ page }) => {
  await openLaptopWithGamma(page);
  const tileA = page.getByTestId("workspace-tile-a");
  const tileB = page.getByTestId("workspace-tile-b");

  await openRail(page);
  await row(page, "Gamma").dragTo(tileB);

  await expect(tileB.getByRole("tab", { name: "Third" })).toBeVisible();
  await expect(tileA.getByRole("tab", { name: "Main" })).toBeVisible();
  await expect
    .poll(async () => JSON.parse((await read(page, "workspaces/w1.json"))!).slots)
    .toEqual([
      { slot: "a", dashboardId: "d1" },
      { slot: "b", dashboardId: "d3" },
    ]);
});

test("Put in panel ▸ A on a row's menu puts the dashboard in tile A", async ({ page }) => {
  await openLaptopWithGamma(page);
  const tileA = page.getByTestId("workspace-tile-a");
  const tileB = page.getByTestId("workspace-tile-b");

  await openRail(page);
  await row(page, "Gamma").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Put in panel" }).click();
  await page.getByRole("menuitemcheckbox", { name: "A", exact: true }).click();

  await expect(tileA.getByRole("tab", { name: "Third" })).toBeVisible();
  await expect(tileB.getByRole("tab", { name: "Second" })).toBeVisible();
  await expect
    .poll(async () => JSON.parse((await read(page, "workspaces/w1.json"))!).slots)
    .toEqual([
      { slot: "a", dashboardId: "d3" },
      { slot: "b", dashboardId: "d2" },
    ]);
});

// Issue #23, the issue's own steps: tile B on Beta's second tab, Put in
// panel ▸ B with Gamma, then with Beta again: Beta comes back on that tab.
test("Put in panel brings a dashboard back on the tab it was on (#23)", async ({ page }) => {
  const seed = laptopWithGammaSeed();
  seed["dashboards/d2.json"] = JSON.stringify({ id: "d2", name: "Beta", tabs: [{ id: "t2", name: "Second", cards: [] }, { id: "t2b", name: "B2", cards: [] }] });
  await seedApp(page, seed);
  await openRail(page);
  await row(page, "Laptop").click();
  const tileB = page.getByTestId("workspace-tile-b");
  await tileB.getByRole("tab", { name: "B2" }).click();
  await expect(tileB.getByRole("tab", { name: "B2" })).toHaveAttribute("aria-selected", "true");
  for (const name of ["Gamma", "Beta"]) {
    await openRail(page);
    await row(page, name).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Put in panel" }).click();
    await page.getByRole("menuitemcheckbox", { name: "B", exact: true }).click();
  }
  await expect(tileB.getByRole("tab", { name: "B2" })).toHaveAttribute("aria-selected", "true");
});

// Spec 2026-10-01 §8: arranging, end to end.

type Box = { x: number; y: number; width: number; height: number };

/** A tile's react-grid-layout item: the element its corner handles hang off. */
const gridItem = (page: Page, slot: string) =>
  page.locator(".workspace-grid .react-grid-item", { has: page.getByTestId(`workspace-tile-${slot}`) });

/** One of a tile's corner handles. */
const corner = (page: Page, slot: string, which: "nw" | "ne" | "sw" | "se") =>
  gridItem(page, slot).locator(`:scope > .react-resizable-handle-${which}`);

/** A tile's Arrange face, the drag handle. */
const face = (page: Page, slot: string) => page.getByTestId(`workspace-tile-${slot}`).locator(".workspace-arrange-cover");

/** Presses at the middle of `box` and moves by (dx, dy) in steps, as react-draggable needs to see a drag. */
async function dragBy(page: Page, box: Box, dx: number, dy: number): Promise<void> {
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
}

/** One column's pitch in px: 12 columns and 13 gaps of 8px across the workspace area. */
async function columnPitch(page: Page): Promise<number> {
  const area = (await page.locator(".workspace-grid").boundingBox())!;
  return (area.width - 8) / 12;
}

/** A tile's share of the workspace area's width. */
async function widthShare(page: Page, slot: string): Promise<number> {
  const area = (await page.locator(".workspace-grid").boundingBox())!;
  const tile = (await page.getByTestId(`workspace-tile-${slot}`).boundingBox())!;
  return tile.width / area.width;
}

/** Opens Arrange mode on a workspace from its row's menu. */
async function arrange(page: Page, name: string): Promise<void> {
  await openRail(page);
  await row(page, name).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Arrange…" }).click();
  await expect(page.getByRole("toolbar", { name: `Arranging ${name}` })).toBeVisible();
}

/** Laptop, with tile A shrunk from 6 columns to 4 by its bottom-right corner. */
async function shrinkA(page: Page): Promise<void> {
  const pitch = await columnPitch(page);
  await dragBy(page, (await corner(page, "a", "se").boundingBox())!, -2 * pitch, 0);
}

test("a tile resized in Arrange mode keeps its size after Done, and in a fresh load of the file Done wrote", async ({ page }) => {
  await openLaptopWorkspace(page);
  await arrange(page, "Laptop");
  await shrinkA(page);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("toolbar", { name: /^Arranging/ })).toHaveCount(0);

  const written = JSON.parse((await read(page, "workspaces/w1.json"))!);
  expect(written.layout).toEqual([
    { slot: "a", x: 0, y: 0, w: 4, h: 12 },
    { slot: "b", x: 6, y: 0, w: 6, h: 12 },
  ]);

  // main's ruling R15: browser mode's reload re-runs the seed, so "reload" is
  // a fresh load of the file Done wrote.
  await seedApp(page, { ...laptopWorkspaceSeed(), "workspaces/w1.json": JSON.stringify(written) });
  await openRail(page);
  await row(page, "Laptop").click();
  await expect(page.getByTestId("workspace-tile-a")).toBeVisible();
  // 4 of 12 columns, less the gaps' share: within a few hundredths of a third.
  expect(Math.abs((await widthShare(page, "a")) - 4 / 12)).toBeLessThan(0.03);
});

test("Cancel puts the arrangement back and writes nothing", async ({ page }) => {
  await openLaptopWorkspace(page);
  const before = await widthShare(page, "a");
  await arrange(page, "Laptop");
  await shrinkA(page);
  expect(await widthShare(page, "a")).toBeLessThan(before - 0.1);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect.poll(() => widthShare(page, "a")).toBeCloseTo(before, 2);
  expect(JSON.parse((await read(page, "workspaces/w1.json"))!)).not.toHaveProperty("layout");
});

test("a push off the bottom is refused and nothing moves", async ({ page }) => {
  await openLaptopWorkspace(page);
  await arrange(page, "Laptop");
  const a = (await page.getByTestId("workspace-tile-a").boundingBox())!;
  const b = (await page.getByTestId("workspace-tile-b").boundingBox())!;
  // Growing A two columns into B pushes B down its own height, off the grid.
  const pitch = await columnPitch(page);
  await dragBy(page, (await corner(page, "a", "se").boundingBox())!, 2 * pitch, 0);

  await expect
    .poll(async () => Math.abs((await page.getByTestId("workspace-tile-a").boundingBox())!.width - a.width))
    .toBeLessThanOrEqual(1);
  const b2 = (await page.getByTestId("workspace-tile-b").boundingBox())!;
  expect(Math.abs(b2.x - b.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(b2.y - b.y)).toBeLessThanOrEqual(1);
});

test("resizing the window keeps each tile's share", async ({ page }) => {
  await openLaptopWorkspace(page);
  const before = await widthShare(page, "a");
  await arrange(page, "Laptop");
  await shrinkA(page);
  // The shrink must have registered, or the share compared below is just the preset's.
  expect(await widthShare(page, "a")).toBeLessThan(0.45);
  expect(before).toBeGreaterThan(0.45);
  await page.getByRole("button", { name: "Done" }).click();
  const share = await widthShare(page, "a");
  await page.setViewportSize({ width: 1000, height: 640 });
  await expect.poll(() => widthShare(page, "a")).toBeCloseTo(share, 1);
});

// Spec §3 "Swapping": on a full layout, a tile dropped onto another trades
// places with it rather than pushing it off the grid.
test("on Laptop, dragging the left tile onto the right swaps them", async ({ page }) => {
  await openLaptopWorkspace(page);
  await arrange(page, "Laptop");
  const a = (await page.getByTestId("workspace-tile-a").boundingBox())!;
  const b = (await page.getByTestId("workspace-tile-b").boundingBox())!;
  // Six columns right: A's centre, at column 3, lands at column 9, B's middle.
  const pitch = await columnPitch(page);
  await dragBy(page, (await face(page, "a").boundingBox())!, 6 * pitch, 0);

  await expect
    .poll(async () => Math.abs((await page.getByTestId("workspace-tile-a").boundingBox())!.x - b.x))
    .toBeLessThanOrEqual(1);
  const b2 = (await page.getByTestId("workspace-tile-b").boundingBox())!;
  expect(Math.abs(b2.x - a.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(b2.y - a.y)).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Done" }).click();
  expect(JSON.parse((await read(page, "workspaces/w1.json"))!).layout).toEqual([
    { slot: "a", x: 6, y: 0, w: 6, h: 12 },
    { slot: "b", x: 0, y: 0, w: 6, h: 12 },
  ]);
  // Each tile keeps its dashboard: Main is now on the right.
  await expect(page.getByTestId("workspace-tile-a").getByRole("tab", { name: "Main" })).toBeVisible();
});

test("Add tile fills the free space", async ({ page }) => {
  await openLaptopWorkspace(page);
  await arrange(page, "Laptop");
  await expect(page.getByRole("button", { name: "Add tile" })).toBeDisabled();
  await shrinkA(page);
  await page.getByRole("button", { name: "Add tile" }).click();

  const a = (await page.getByTestId("workspace-tile-a").boundingBox())!;
  const b = (await page.getByTestId("workspace-tile-b").boundingBox())!;
  const c = (await page.getByTestId("workspace-tile-c").boundingBox())!;
  expect(c.x).toBeGreaterThanOrEqual(a.x + a.width);
  expect(c.x + c.width).toBeLessThanOrEqual(b.x);
  await expect(face(page, "c")).toContainText("Empty");
});

test("a card maximized after its tile has moved fills the tile where it now is", async ({ page }) => {
  await openLaptopWorkspace(page);
  await arrange(page, "Laptop");
  await shrinkA(page);
  // Move A right by two columns, into the space it freed: same size, new
  // place. Its centre ends at column 4, in free space or on its own old
  // edge, never inside B (6–12), so this is a move and not a swap.
  const pitch = await columnPitch(page);
  await dragBy(page, (await face(page, "a").boundingBox())!, 2 * pitch, 0);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("toolbar", { name: /^Arranging/ })).toHaveCount(0);

  const tileA = page.getByTestId("workspace-tile-a");
  const tile = (await tileA.boundingBox())!;
  const item = tileA.locator(".react-grid-item").first();
  await item.getByRole("button", { name: "Maximize" }).click();
  await expect(item).toHaveClass(/card-maximized/);
  await expect
    .poll(async () => Math.abs((await item.boundingBox())!.x - tile.x))
    .toBeLessThanOrEqual(2);
  const box = (await item.boundingBox())!;
  expect(Math.abs(box.x + box.width - (tile.x + tile.width))).toBeLessThanOrEqual(2);
});

test("the dashboard in a resized tile lays its cards out to the tile's new width", async ({ page }) => {
  await openLaptopWorkspace(page);
  const inner = page.getByTestId("workspace-tile-a").locator(".react-grid-layout");
  const before = (await inner.boundingBox())!;
  await arrange(page, "Laptop");
  await shrinkA(page);
  await page.getByRole("button", { name: "Done" }).click();
  const pitch = await columnPitch(page);

  await expect.poll(async () => (await inner.boundingBox())!.width).toBeLessThan(before.width - pitch);
  const tile = (await page.getByTestId("workspace-tile-a").boundingBox())!;
  const after = (await inner.boundingBox())!;
  expect(after.x + after.width).toBeLessThanOrEqual(tile.x + tile.width + 1);
  // The grid element's own box follows its CSS width whatever its cards were
  // laid out to; the cards themselves must also end inside the tile.
  await expect
    .poll(() =>
      page
        .getByTestId("workspace-tile-a")
        .locator(".react-grid-item")
        .evaluateAll((els, limit) => Math.max(...els.map((e) => e.getBoundingClientRect().right)) <= limit, tile.x + tile.width + 1),
    )
    .toBe(true);
});

// Review Focus 2, in a real browser. WorkspaceArrangeBar's unit tests drive
// two clicks with fireEvent; only Chromium moves the tiles up under the
// pointer once the bar has unmounted, so only here can the second click of a
// double click land on tile B's clear ✕. dblclick() carries the click
// counts (detail 1, then 2) that the ✕'s guard reads; two plain clicks would
// both carry detail 1.
test("Done double-clicked writes once, flashes no error and clears no dashboard", async ({ page }) => {
  await openLaptopWorkspace(page);
  await arrange(page, "Laptop");
  await shrinkA(page);
  const workspaceWrites = () =>
    page.evaluate(async () => {
      // The same module instance the browser shim's fs is built on
      // (src/browser-shim/fs.ts imports ../test/memfs).
      const path = "/src/test/memfs.ts";
      const fs = await import(/* @vite-ignore */ path);
      return (fs.__writes() as string[]).filter((w) => w.includes("workspaces/w1.json")).length;
    });
  expect(await workspaceWrites()).toBe(0);

  await page.getByRole("button", { name: "Done" }).dblclick();
  await expect(page.getByRole("toolbar", { name: /^Arranging/ })).toHaveCount(0);
  await expect(page.getByText(/^Could not save/)).toHaveCount(0);
  // One save, and not a second one from a click that cleared a slot.
  expect(await workspaceWrites()).toBe(1);

  const written = JSON.parse((await read(page, "workspaces/w1.json"))!);
  expect(written.slots).toEqual([
    { slot: "a", dashboardId: "d1" },
    { slot: "b", dashboardId: "d2" },
  ]);
  await expect(page.getByTestId("workspace-tile-b").getByRole("tab", { name: "Second" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Clear .* from this slot$/ })).toHaveCount(2);
});

// The face's ✕ sits in the top-right corner, where the ne resize handle (20px,
// z-index 11, above the face's 10) is. A mouse press there must reach the ✕:
// locator.click() would wait out an interception, so this presses at the
// button's centre and asks what is under it first.
// Spec 2026-10-01 §6: a layout saved while arranging one workspace is applied
// to another from its row's Layout submenu.
test("a layout saved from one workspace can be applied to another", async ({ page }) => {
  const seed = laptopWorkspaceSeed();
  seed["workspaces/w2.json"] = JSON.stringify({
    id: "w2",
    name: "Desk",
    preset: "full-screen",
    slots: [{ slot: "a", dashboardId: "d2" }],
  });
  await seedApp(page, seed);
  await openRail(page);
  await row(page, "Laptop").click();
  await expect(page.getByTestId("workspace-tile-a")).toBeVisible();

  await arrange(page, "Laptop");
  await shrinkA(page);
  await page.getByRole("button", { name: "Save layout as…" }).click();
  const save = page.getByRole("dialog", { name: "Save layout" });
  await save.getByRole("textbox", { name: "Name" }).fill("Narrow");
  await save.getByRole("button", { name: "Save" }).click();
  await expect(save).toHaveCount(0);
  // Saved, though Cancel now discards the arrangement itself.
  await page.getByRole("button", { name: "Cancel" }).click();
  expect((await memfs(page).list()).filter((p: string) => p.startsWith("layouts/"))).toHaveLength(1);

  await openRail(page);
  await row(page, "Desk").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Layout" }).click();
  await page.getByRole("menuitem", { name: "Narrow" }).click();
  await expect
    .poll(async () => JSON.parse((await read(page, "workspaces/w2.json"))!).layout)
    .toEqual([
      { slot: "a", x: 0, y: 0, w: 4, h: 12 },
      { slot: "b", x: 6, y: 0, w: 6, h: 12 },
    ]);

  await openRail(page);
  await row(page, "Desk").click();
  await expect(page.getByTestId("workspace-tile-a").getByRole("tab", { name: "Second" })).toBeVisible();
  await expect(page.getByTestId("workspace-tile-b")).toContainText(/drag a dashboard here/i);
});

test("a mouse click on a face's ✕ removes the tile, and Cancel puts it back", async ({ page }) => {
  await openLaptopWorkspace(page);
  await arrange(page, "Laptop");
  const remove = page.getByRole("button", { name: "Remove tile B" });
  const box = (await remove.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  expect(await remove.evaluate((el, [cx, cy]) => document.elementFromPoint(cx, cy) === el, [x, y])).toBe(true);

  await page.mouse.click(x, y);
  await expect(page.getByTestId("workspace-tile-b")).toHaveCount(0);

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("workspace-tile-b")).toBeVisible();
});

// The ✕ clears the ne handle rather than covering it: the handle still resizes.
test("the ne handle still resizes a tile beside its ✕", async ({ page }) => {
  await openLaptopWorkspace(page);
  await arrange(page, "Laptop");
  const before = await widthShare(page, "b");
  const pitch = await columnPitch(page);
  await dragBy(page, (await corner(page, "b", "ne").boundingBox())!, -2 * pitch, 0);
  await expect.poll(() => widthShare(page, "b")).toBeLessThan(before - 0.1);
});
