// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from "@playwright/test";
import { defaultSeed, read, seedApp } from "./fixtures";

test("boots against the mock backend, discovers widgets, and renders the seeded dashboard", async ({ page }) => {
  const seed = defaultSeed();
  delete seed["settings.json"];
  await seedApp(page, seed);

  // Rail lists the seeded dashboard.
  await expect(page.locator("nav.left-rail").getByRole("button", { name: /Main/ })).toBeVisible();

  // Both seeded cards render with their discovered widget names.
  await expect(page.locator(".widget-card")).toHaveCount(2);
  await expect(page.getByText("Quote", { exact: true })).toBeVisible();
  await expect(page.getByText("Price History", { exact: true })).toBeVisible();

  // Data actually arrived through the http shim: the table shows the fixture row,
  // and Plotly drew the chart (it attaches .js-plotly-plot to the node it owns).
  await expect(page.getByText("AAPL")).toBeVisible();
  await expect(page.locator(".chart-plot.js-plotly-plot")).toHaveCount(1);

  // The fs shim persisted a write the app itself made: settings.json was NOT
  // seeded, so its presence -- with the loader's defaults -- proves the
  // loader ran and the shim stored what it wrote.
  const saved = await read(page, "settings.json");
  expect(saved).toBeDefined();
  expect(JSON.parse(saved!)).toMatchObject({ theme: "dark", fontSize: "medium" });
});
