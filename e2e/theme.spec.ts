// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from "@playwright/test";
import { defaultSeed, openSettings, read, seedApp } from "./fixtures";

const rootVar = (page: import("@playwright/test").Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

test("switching to Light re-themes the page, the tokens, and the live Plotly chart", async ({ page }) => {
  // The default is System, and headless Chromium reports a light scheme:
  // start from an explicit Dark so the switch below is a real change.
  await seedApp(page, { ...defaultSeed(), "settings.json": JSON.stringify({ theme: "dark" }) });
  await page.locator(".chart-plot.js-plotly-plot").waitFor();

  const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const darkPaper = await page.evaluate(
    () => (document.querySelector(".chart-plot") as unknown as { _fullLayout: { paper_bgcolor: string } })._fullLayout.paper_bgcolor,
  );
  expect(darkPaper).toBe("#1e242e");

  await openSettings(page);
  await page.getByRole("radio", { name: "Light" }).check();

  // Staged only, but previewed live through selectEffective -- see
  // useResolvedTheme -- so the document, tokens and chart below all update
  // before Done is ever clicked.
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("light");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(darkBg);
  expect(await rootVar(page, "--clock-green")).toBe("#1a9e4a");
  expect(await rootVar(page, "--error")).toBe("#c0392b");

  // The chart is re-rendered through the theme-aware buildFigure, not left dark.
  await expect
    .poll(() =>
      page.evaluate(
        () => (document.querySelector(".chart-plot") as unknown as { _fullLayout: { paper_bgcolor: string } })._fullLayout.paper_bgcolor,
      ),
    )
    .toBe("#ffffff");

  // Persisting to disk needs Done, same as any other staged Settings change.
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toHaveCount(0);
  const saved = await read(page, "settings.json");
  expect(JSON.parse(saved!).theme).toBe("light");
});

test.describe("System theme", () => {
  test("follows the OS appearance, and flips live when it changes", async ({ page }) => {
    // Emulated BEFORE the app boots, so the very first paint already resolves
    // "system" through prefers-color-scheme rather than settling afterwards.
    await page.emulateMedia({ colorScheme: "dark" });
    await seedApp(page, { ...defaultSeed(), "settings.json": JSON.stringify({ theme: "system" }) });

    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("dark");

    // A sentinel on the live document: if the flip below were a reload rather
    // than a re-render, this would be gone.
    await page.evaluate(() => {
      (window as unknown as { __liveSince?: number }).__liveSince = Date.now();
    });

    // The macOS auto-switch, as the page sees it: a `change` on the media
    // query, with no navigation and no restart.
    await page.emulateMedia({ colorScheme: "light" });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("light");
    expect(
      await page.evaluate(() => (window as unknown as { __liveSince?: number }).__liveSince),
    ).toBeGreaterThan(0);

    // Body tokens followed the flip, not just the attribute.
    expect(await rootVar(page, "--clock-green")).toBe("#1a9e4a");

    // And back again, so the subscription is not one-shot.
    await page.emulateMedia({ colorScheme: "dark" });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("dark");

    // The setting itself is untouched by any of this -- "system" is what
    // stays on disk.
    const saved = await read(page, "settings.json");
    expect(JSON.parse(saved!).theme).toBe("system");
  });

  test("an explicit theme ignores the OS appearance", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await seedApp(page, { ...defaultSeed(), "settings.json": JSON.stringify({ theme: "light" }) });

    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("light");

    await page.emulateMedia({ colorScheme: "light" });
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("light");
  });

  test("choosing System from the dialog switches the live app to the OS appearance", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    // An explicit Dark first: System is the default, so a bare seed would
    // already be light and the switch would prove nothing.
    await seedApp(page, { ...defaultSeed(), "settings.json": JSON.stringify({ theme: "dark" }) });
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");

    await openSettings(page);
    await page.getByRole("radio", { name: "System" }).check();

    // Previewed live through selectEffective, same as the Light case above.
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("light");

    // Persisting to disk needs Done, same as any other staged Settings change.
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toHaveCount(0);
    await expect
      .poll(async () => JSON.parse((await read(page, "settings.json"))!).theme)
      .toBe("system");
  });
});
