// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from "@playwright/test";
import { MOCK_URL, openAILibrary, read, seedApp } from "./fixtures";

test("Rita tool rounds save with Done, survive reopening and discard with Cancel", async ({ page }) => {
  await seedApp(page);
  await openAILibrary(page);
  const dialog = page.getByRole("dialog", { name: "AI Library" });
  const rounds = dialog.getByRole("combobox", { name: "Maximum tool rounds" });
  await expect(rounds).toHaveValue("40");
  await expect(rounds.locator("option")).toHaveCount(40);
  await rounds.selectOption("20");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toHaveCount(0);
  expect(JSON.parse((await read(page, "settings.json"))!).ritaMaxFunctionRounds).toBe(20);
  await openAILibrary(page);
  await expect(rounds).toHaveValue("20");
  await rounds.selectOption("1");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await openAILibrary(page);
  await expect(rounds).toHaveValue("20");
  await rounds.selectOption("40");
  await dialog.getByRole("button", { name: "Done" }).click();
  expect(JSON.parse((await read(page, "settings.json"))!).ritaMaxFunctionRounds).toBe(40);
});

test("the AI Library opens from the rail with its five tabs, Agents first", async ({ page }) => {
  await seedApp(page);
  await openAILibrary(page);
  const dialog = page.getByRole("dialog", { name: "AI Library" });
  await expect(dialog.getByRole("tab")).toHaveText(["Agents", "MCP Servers", "Send chat to…", "Skills", "Appearance"]);
  await expect(dialog.getByRole("tab", { name: "Agents" })).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByRole("status")).toHaveText("Not checked");
});

test("entering the mock backend as the Rita URL discovers Agent Rita, and Done persists it", async ({ page }) => {
  await seedApp(page);
  await openAILibrary(page);
  const dialog = page.getByRole("dialog", { name: "AI Library" });
  await dialog.getByRole("textbox", { name: "Rita URL" }).fill(MOCK_URL);
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("status")).toHaveText("Online");
  await expect(dialog.getByRole("heading", { name: "Agent Rita" })).toBeVisible();
  await expect(dialog.getByText("Model: openai:nemotron-3.5-lightning")).toBeVisible();

  // The Rita URL is only staged until Done commits the draft -- Done closes
  // the dialog and settings.json is what proves the commit actually ran.
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog", { name: "AI Library" })).toHaveCount(0);
  await expect
    .poll(async () => JSON.parse((await read(page, "settings.json"))!).ritaUrl)
    .toBe(MOCK_URL);
});

test("Escape closes the AI Library and discards the draft", async ({ page }) => {
  await seedApp(page);
  await openAILibrary(page);
  const dialog = page.getByRole("dialog", { name: "AI Library" });
  await dialog.getByRole("textbox", { name: "Rita URL" }).fill(MOCK_URL);
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("status")).toHaveText("Online");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "AI Library" })).toHaveCount(0);
  await expect.poll(async () => JSON.parse((await read(page, "settings.json"))!).ritaUrl).toBeUndefined();
});

test("the Skills tab lists the five bundled skills on a fresh install", async ({ page }) => {
  await seedApp(page);
  await openAILibrary(page);
  const dialog = page.getByRole("dialog", { name: "AI Library" });
  await dialog.getByRole("tab", { name: "Skills" }).click();
  // One .bd-list-row per skill: the Skill editor fold-back's list (main's
  // SkillsTab) draws rows, not list items.
  await expect(dialog.locator(".bd-list-row")).toHaveCount(5);
  await expect(dialog.getByText("openbb-html-report")).toBeVisible();
  await expect(dialog.getByText("arrange-table")).toBeVisible();
  // build-dashboard is this project's second own skill, from the Episode-6
  // authoring toolset; getByText would also match "build-dashboard" inside
  // another row's description, so this asserts the row's own name cell.
  await expect(dialog.locator(".bd-list-row").filter({ hasText: "build-dashboard" })).toHaveCount(1);
});
