// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from "@playwright/test";
import { dashboardSeed, seedApp } from "./fixtures";

test.use({ browserName: process.env.HEADER_WEBKIT ? "webkit" : "chromium" });

for (const width of [1440, 768, 390]) {
  test(`dashboard parameter groups scroll independently at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await seedApp(page, dashboardSeed([], {
      tabs: Array.from({ length: 10 }, (_, i) => ({ id: `t${i + 1}`, name: `Dashboard tab ${i + 1}`, cards: [] })),
      groups: Array.from({ length: 8 }, (_, i) => ({
        id: `g${i}`, name: `Group ${i + 1}`, paramName: "symbol", groupType: "symbol",
        value: "AAPL,MSFT,NVDA,BAC,JPM,AMZN,TSLA",
      })),
    }));
    const bar = page.locator('.dashboard-area > .tab-bar').first();
    const groups = bar.locator('.tab-bar-groups');
    const tabs = bar.getByRole('tablist', { name: 'Tabs', exact: true });
    await expect(groups.locator('.group-chip')).toHaveCount(8);
    await page.evaluate(() => document.fonts.ready);
    // A real scroll range is required: wrapping all chips into a tall header fails.
    await expect.poll(() => groups.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    const before = await bar.boundingBox();
    expect(before!.height).toBeLessThan(70);
    const tabsBefore = await tabs.boundingBox();
    const actionsBefore = await bar.getByRole('button', { name: 'Refresh all', exact: true }).boundingBox();
    await expect(bar.getByRole('button', { name: 'Add widget', exact: true })).toBeInViewport();
    await groups.evaluate(el => { el.scrollLeft = el.scrollWidth; });
    await expect.poll(() => groups.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    await expect(groups.getByRole('button', { name: 'Delete group Group 8', exact: true })).toBeInViewport();
    expect(await bar.boundingBox()).toEqual(before);
    expect(await tabs.boundingBox()).toEqual(tabsBefore);
    expect(await tabs.evaluate(el => el.scrollLeft)).toBe(0);
    expect(await bar.getByRole('button', { name: 'Refresh all', exact: true }).boundingBox()).toEqual(actionsBefore);
    const rows = await groups.locator('.group-chip').evaluateAll(els => els.map(el => el.getBoundingClientRect().top));
    expect(Math.max(...rows) - Math.min(...rows)).toBeLessThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const scrolledToEnd = await groups.evaluate(el => el.scrollLeft);
    const firstDelete = groups.getByRole('button', { name: 'Delete group Group 1', exact: true });
    await firstDelete.focus();
    await expect(firstDelete).toBeInViewport();
    await expect.poll(() => groups.evaluate(el => el.scrollLeft)).toBeLessThan(scrolledToEnd);
  });
}

test('parameter groups use spare header width before scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  await seedApp(page, dashboardSeed([], {
    groups: [{ id: 'wide', name: 'Ticker', paramName: 'symbol', groupType: 'symbol', value: 'AAPL,'.repeat(28) }],
  }));
  const groups = page.locator('.dashboard-area > .tab-bar .tab-bar-groups').first();
  await expect(groups.locator('.group-chip')).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(() => groups.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Add widget', exact: true })).toBeInViewport();
});
