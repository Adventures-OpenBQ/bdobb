// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from "@playwright/test";
import { openSettings, seedApp } from "./fixtures";

test("a backend's settings widgets are Settings sections: a form reads, refuses a bad value by its field, saves and shows the notice", async ({
  page,
}) => {
  await seedApp(page);
  await openSettings(page);

  // Service sections sit between Layout and Logs, sorted by widget name on
  // the one mock backend; key-maint's settings entry binds to its keys
  // widget, so there is exactly one Keys tab, named by that entry.
  await expect(page.getByRole("tablist", { name: "Settings sections" }).getByRole("tab")).toHaveText([
    "General",
    "Widget",
    "Layout",
    "Fixture service",
    "Provider API Keys",
    "Logs",
  ]);

  await page.getByRole("tab", { name: "Fixture service" }).click();
  const panel = page.getByRole("tabpanel", { name: "Fixture service" });
  const poll = panel.getByLabel("Poll interval");
  await expect(poll).toBeVisible();
  await expect(panel.getByLabel("Uploads")).toBeDisabled();
  await expect(panel.getByText("Uploads are off on this server.")).toBeVisible();

  await poll.fill("5");
  await panel.getByRole("button", { name: "Save" }).click();
  await expect(panel.getByText("At least 10 seconds.")).toBeVisible();
  await expect(poll).toHaveValue("5");

  // The service normalises 125 to 120: the field showing 120 afterwards can
  // only come from the 200 body, not from what was typed.
  await poll.fill("125");
  await panel.getByRole("button", { name: "Save" }).click();
  await expect(panel.getByText("Takes effect on restart.")).toBeVisible();
  await expect(poll).toHaveValue("120");
});
