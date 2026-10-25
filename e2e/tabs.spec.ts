// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Page } from "@playwright/test";
import { defaultSeed, read, seedApp } from "./fixtures";

/**
 * The tab strip's create/rename/delete, end to end. These are the three
 * actions that were dead in the shipped app (WKWebView implements neither
 * window.prompt nor window.confirm): creation now generates the name,
 * renaming happens in an inline field, and the delete confirmation is the
 * platform dialog — which in browser mode is the browser's own confirm, so
 * page.on("dialog") drives it.
 */

/** The tab names as the dashboard file on memfs holds them. */
async function persistedTabNames(page: Page): Promise<string[]> {
  const raw = await read(page, "dashboards/d1.json");
  return raw ? (JSON.parse(raw) as { tabs: { name: string }[] }).tabs.map((t) => t.name) : [];
}

const tabNames = (page: Page) => page.locator(".tab-bar [role='tab']");
const addTab = (page: Page) => page.getByRole("button", { name: "Add tab" });

test.beforeEach(async ({ page }) => {
  await seedApp(page, defaultSeed());
  await page.getByRole("tab", { name: "Main" }).waitFor();
});

test("＋ creates Untitled, then Untitled 2, asking nothing", async ({ page }) => {
  await addTab(page).click();
  await addTab(page).click();

  await expect(tabNames(page)).toHaveText(["Main", "Untitled", "Untitled 2"]);
  await expect.poll(() => persistedTabNames(page)).toEqual(["Main", "Untitled", "Untitled 2"]);
});

test("double-click renames a tab in place and persists the new name", async ({ page }) => {
  await addTab(page).click();
  await addTab(page).click();

  await page.getByRole("tab", { name: "Untitled 2", exact: true }).dblclick();
  const field = page.getByRole("textbox", { name: "Rename tab" });
  await expect(field).toBeFocused();
  // The field opens with its text selected, so typing replaces it.
  await page.keyboard.type("Macro");
  await page.keyboard.press("Enter");

  await expect(tabNames(page)).toHaveText(["Main", "Untitled", "Macro"]);
  await expect.poll(() => persistedTabNames(page)).toEqual(["Main", "Untitled", "Macro"]);
});

test("✕ deletes the tab once the confirmation is accepted", async ({ page }) => {
  let asked = "";
  page.on("dialog", (d) => {
    asked = d.message();
    void d.accept();
  });
  await addTab(page).click();
  await expect(tabNames(page)).toHaveText(["Main", "Untitled"]);

  await page.getByRole("button", { name: "Delete tab Untitled", exact: true }).click();

  await expect.poll(() => asked).toBe('Delete tab "Untitled"?');
  await expect(tabNames(page)).toHaveText(["Main"]);
  await expect.poll(() => persistedTabNames(page)).toEqual(["Main"]);
});

test("✕ leaves the tab alone when the confirmation is dismissed", async ({ page }) => {
  let asked = "";
  page.on("dialog", (d) => {
    asked = d.message();
    void d.dismiss();
  });
  await addTab(page).click();
  await expect(tabNames(page)).toHaveText(["Main", "Untitled"]);

  await page.getByRole("button", { name: "Delete tab Untitled", exact: true }).click();

  // Wait for the dialog to have been answered before asserting nothing
  // happened — otherwise the assertion could pass ahead of the decision.
  await expect.poll(() => asked).toBe('Delete tab "Untitled"?');
  await expect(tabNames(page)).toHaveText(["Main", "Untitled"]);
  await expect.poll(() => persistedTabNames(page)).toEqual(["Main", "Untitled"]);
});

/**
 * Page-level only, exactly as e2e/rail.spec.ts' dashboard-reorder test:
 * Chromium proves the tab strip's drag handlers reorder and persist. Whether
 * the drop reaches the page inside the Tauri window is a separate layer
 * (tauri.conf.json `dragDropEnabled: false` — with Tauri's native handler
 * armed, wry answers performDragOperation itself and WKWebView never sees the
 * drop) and stays a human check in the desktop app.
 *
 * The two extra tabs come from ＋ rather than from a second seed: the
 * file-level beforeEach above has already seeded and navigated, and the two
 * tests above prove that ＋ appends "Untitled" then "Untitled 2" and persists
 * them. No tab name here is load-bearing; the drag is.
 */
test("dragging a tab onto another reorders the strip and persists the order", async ({ page }) => {
  await addTab(page).click();
  await addTab(page).click();
  await expect(tabNames(page)).toHaveText(["Main", "Untitled", "Untitled 2"]);

  // The wrapper is what carries `draggable`, not the [role='tab'] button. It
  // is located by an exact role match rather than by hasText, because the
  // "Untitled 2" wrapper's own text also contains "Untitled".
  const tabWrapper = (name: string) =>
    page.locator(".tab-bar-tab").filter({ has: page.getByRole("tab", { name, exact: true }) });

  await tabWrapper("Untitled 2").dragTo(tabWrapper("Main"));

  // The target's index is read BEFORE the dragged tab is removed, so a
  // leftward drag lands before its target.
  await expect(tabNames(page)).toHaveText(["Untitled 2", "Main", "Untitled"]);
  await expect.poll(() => persistedTabNames(page)).toEqual(["Untitled 2", "Main", "Untitled"]);
});
