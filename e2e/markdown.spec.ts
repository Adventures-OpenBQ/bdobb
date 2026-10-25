// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Page } from "@playwright/test";
import { MOCK_URL, read, seedApp, type SeedFiles } from "./fixtures";

/** An empty tab, so the card added from the library is the only one and lands at the top. */
function emptySeed(extra: SeedFiles = {}): SeedFiles {
  const backends = [
    { id: "b1", name: "Mock", baseUrl: MOCK_URL, authLocation: "header", validateWidgets: false },
  ];
  const dashboard = { id: "d1", name: "Main", tabs: [{ id: "t1", name: "Main", cards: [] }] };
  return {
    "settings.json": "{}",
    "backends.json": JSON.stringify(backends),
    "dashboards/d1.json": JSON.stringify(dashboard),
    ...extra,
  };
}

async function addMarkdownCard(page: Page) {
  await page.keyboard.press("Meta+k");
  const overlay = page.getByRole("dialog", { name: "Widget library" });
  await overlay.waitFor();
  await overlay.getByRole("button", { name: /^Add Markdown\b/ }).dblclick();
  const card = page.locator(".widget-card").filter({ hasText: "Markdown" });
  await card.waitFor();
  return card;
}

/** The stored text of the only card on the only tab, as the dashboard file holds it. */
async function storedText(page: Page): Promise<string | undefined> {
  const raw = await read(page, "dashboards/d1.json");
  if (raw === undefined) return undefined;
  const dashboard = JSON.parse(raw) as { tabs: { cards: { params: { text?: string } }[] }[] };
  return dashboard.tabs[0]?.cards[0]?.params.text;
}

test("typing in the editor persists as markdown, and a heading picked from the toolbar persists as one", async ({
  page,
}) => {
  await seedApp(page, emptySeed());
  const card = await addMarkdownCard(page);
  const editor = card.locator('[contenteditable="true"]').first();
  await editor.click();
  await page.keyboard.type("Desk notes");

  // The debounce is 500 ms; the store write follows.
  await expect.poll(() => storedText(page), { timeout: 5000 }).toBe("Desk notes");

  // Select the line: the formatting toolbar appears, with the block type
  // picker showing the current type. Pick Heading 1 from it.
  // ControlOrMeta, not Meta: select-all inside the editor is the BROWSER's
  // own binding, and on Linux that is Ctrl+A -- a bare Meta+a selects
  // nothing there, the formatting toolbar never opens, and the wait below
  // times out on CI while passing on a Mac. (The Meta+k presses elsewhere
  // are fine: those reach the app's own handler, which takes either
  // modifier.) Ported from release/v6 (PR #121).
  await page.keyboard.press("ControlOrMeta+a");
  const toolbar = page.locator(".bn-formatting-toolbar");
  await toolbar.waitFor();
  await toolbar.getByRole("button", { name: /Paragraph/ }).click();
  await page.getByRole("menuitem", { name: "Heading 1", exact: true }).click();

  await expect(card.getByRole("heading", { level: 1 })).toHaveText("Desk notes");
  await expect.poll(() => storedText(page), { timeout: 5000 }).toBe("# Desk notes");
});

test("Save as… writes the note's markdown, and Open file… replaces it after a confirm", async ({
  page,
}) => {
  await seedApp(page, emptySeed({ "imports/pick.md": "## From disk\n\nA line." }));
  const card = await addMarkdownCard(page);
  const editor = card.locator('[contenteditable="true"]').first();
  await editor.click();
  await page.keyboard.type("Keep me");
  await expect.poll(() => storedText(page), { timeout: 5000 }).toBe("Keep me");

  await card.getByRole("button", { name: "Card menu" }).click();
  await page.getByRole("menuitem", { name: "Save as…" }).click();
  await expect.poll(async () => {
    const files = await page.evaluate(() => window.__bdobb!.list!());
    return files.find((f) => f.startsWith("exports/") && f.endsWith(".md"));
  }).toBeDefined();
  const saved = (await page.evaluate(() => window.__bdobb!.list!())).find((f) => f.startsWith("exports/"))!;
  expect(await read(page, saved)).toBe("Keep me\n");

  // The shim's open() answers /imports/pick.md for a Markdown filter, and the
  // shim's confirm() is window.confirm, which Playwright answers here.
  page.once("dialog", (d) => void d.accept());
  await card.getByRole("button", { name: "Card menu" }).click();
  await page.getByRole("menuitem", { name: "Open file…" }).click();

  await expect(card.getByRole("heading", { level: 2 })).toHaveText("From disk");
  await expect.poll(() => storedText(page), { timeout: 5000 }).toBe("## From disk\n\nA line.");
});
