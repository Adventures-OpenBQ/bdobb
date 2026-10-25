// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// #24: browser mode has no Tauri menu, so starting up must not log a failed
// subscription to File ▸ New Workspace… (menu://new-workspace).
import { expect, test } from "@playwright/test";
import { defaultSeed, openRail, read, seedApp } from "./fixtures";

test("browser start-up logs no menu subscription error (#24)", async ({ page }) => {
  await seedApp(page, defaultSeed());
  await openRail(page);
  await page.waitForTimeout(500);
  expect((await read(page, "logs/bdobb.log")) ?? "").not.toContain("menu://new-workspace");
});
