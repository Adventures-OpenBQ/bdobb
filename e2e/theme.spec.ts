// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from "@playwright/test";
import { openSettings, read, seedApp } from "./fixtures";

const rootVar = (page: import("@playwright/test").Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

test("switching to Light re-themes the page, the tokens, and the live Plotly chart", async ({ page }) => {
  await seedApp(page);
  await page.locator(".chart-plot.js-plotly-plot").waitFor();

  const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const darkPaper = await page.evaluate(
    () => (document.querySelector(".chart-plot") as unknown as { _fullLayout: { paper_bgcolor: string } })._fullLayout.paper_bgcolor,
  );
  expect(darkPaper).toBe("#1e242e");

  await openSettings(page);
  await page.getByRole("radio", { name: "Light" }).check();

  // Task B2's draft transaction wired ONLY App.tsx's three readers (theme,
  // fontSize, railWidth) to selectEffective -- dataset.theme and the CSS
  // custom properties below update live, before Done, straight off the
  // draft patch.
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("light");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(darkBg);
  expect(await rootVar(page, "--clock-green")).toBe("#1a9e4a");
  expect(await rootVar(page, "--error")).toBe("#c0392b");

  // ChartRenderer's own theme reader was NOT part of that switch (confirmed
  // against Task B2's report: "No other line in App.tsx was touched", and
  // ChartRenderer.tsx isn't even in App.tsx) -- it still reads the
  // COMMITTED `s.settings.theme`, not selectEffective. So unlike the four
  // assertions above, the chart stays dark until Done commits the draft;
  // close the dialog first, the same idiom e2e/settings.spec.ts uses, before
  // checking the chart or settings.json.
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toHaveCount(0);

  // The chart is re-rendered through the theme-aware buildFigure, not left dark.
  await expect
    .poll(() =>
      page.evaluate(
        () => (document.querySelector(".chart-plot") as unknown as { _fullLayout: { paper_bgcolor: string } })._fullLayout.paper_bgcolor,
      ),
    )
    .toBe("#ffffff");

  // And the choice persisted through the fs shim.
  const saved = await read(page, "settings.json");
  expect(JSON.parse(saved!).theme).toBe("light");
});
