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

for (const width of [1440, 390]) {
  test(`Day Chart quote typography fits a compact tile at ${width}px`, async ({ page }) => {
    await page.setViewportSize({width,height:850});
    await page.route('http://127.0.0.1:4174/**', async route => {
      const path = new URL(route.request().url()).pathname;
      const tile = {symbol:'AAPL',name:'Apple Inc.',logo_path:null,
        session:{date:'2026-11-20',timezone:'America/New_York',label:'Regular session',status:'closed'},
        price:342.75,change:-6.46,change_percent:-1.85,previous_close:349.21,
        points:[{time:'2026-11-20T14:30:00Z',value:349.21},{time:'2026-11-20T14:31:00Z',value:342.75}],
        status:'ok',source:'eodhd'};
      const json = path === '/widgets.json' ? {day_quote:{name:'Day Chart',type:'day_chart',endpoint:'day_charts',params:[{paramName:'symbol',type:'text',default:'AAPL'}]}}
        : path === '/day_charts' ? {schema_version:1,tiles:[tile]} : {};
      await route.fulfill({json});
    });
    await seedApp(page,dashboardSeed([{id:'day-quote',widgetId:'day_quote',backendId:'b1',params:{symbol:'AAPL'},layout:{x:0,y:0,w:16,h:12}}]));
    const tile=page.locator('.day-chart-tile').first();
    await expect(tile.locator('.day-chart-price')).toHaveText('342.75');
    await expect(tile.locator('.day-chart-change')).toHaveText('-6.46 (-1.85%)');
    await expect(tile.locator('.day-chart-price')).toHaveCSS('font-size','20px');
    await expect(tile.locator('.day-chart-change')).toHaveCSS('font-size','12px');
    await expect(tile.locator('.day-chart-axis-high')).toHaveCSS('font-size','9px');
    const metrics=await tile.evaluate(el=>{
      const top=el.querySelector('.day-chart-top')!;
      const heading=el.querySelector('.day-chart-heading')!.getBoundingClientRect();
      const quote=el.querySelector('.day-chart-quote')!.getBoundingClientRect();
      const change=el.querySelector('.day-chart-change')!;
      return {tileWidth:el.getBoundingClientRect().width,topOverflow:top.scrollWidth>top.clientWidth,
        changeOverflow:change.scrollWidth>change.clientWidth,overlap:heading.right>quote.left};
    });
    expect(metrics.tileWidth).toBeLessThanOrEqual(310);
    expect(metrics.topOverflow).toBe(false);
    expect(metrics.changeOverflow).toBe(false);
    expect(metrics.overlap).toBe(false);
    await expect(tile.getByRole('img',{name:'AAPL intraday prices'})).toBeVisible();
  });
}
