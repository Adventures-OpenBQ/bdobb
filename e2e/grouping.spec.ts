// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Page } from "@playwright/test";
import { dashboardSeed, read, seedApp } from "./fixtures";

/** Every request the page made to `pathname`, in order, as its `symbol` value. */
function trackSymbols(page: Page, pathname: string): string[] {
  const seen: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname === pathname && req.method() === "GET") {
      seen.push(url.searchParams.get("symbol") ?? "");
    }
  });
  return seen;
}

/**
 * The default dashboard, with `widgetId` added as a second card in one
 * ParamGroup on `symbol` alongside the seed's existing `c-quote` card -- which
 * is the sibling: the `quote` fixture widget already declares `symbol`.
 */
function groupedSeed(widgetId: string, value: string) {
  return dashboardSeed(
    [
      {
        id: "c-quote",
        widgetId: "quote",
        backendId: "b1",
        params: { symbol: value },
        bindings: [{ groupId: "g1", paramName: "symbol" }],
        layout: { x: 0, y: 0, w: 20, h: 9 },
      },
      {
        id: "c-grouped",
        widgetId,
        backendId: "b1",
        params: { symbol: value },
        bindings: [{ groupId: "g1", paramName: "symbol" }],
        layout: { x: 0, y: 9, w: 20, h: 9 },
      },
    ],
    { groups: [{ id: "g1", name: "Ticker", paramName: "symbol", groupType: "symbol", value }] },
  );
}

test("clicking a cellOnClick cell moves the group, and the sibling card refetches with it", async ({
  page,
}) => {
  const quotes = trackSymbols(page, "/quote");
  await seedApp(page, groupedSeed("grouped_table", "AAPL"));
  const card = page.locator(".widget-card").filter({ hasText: "Grouped Table" });

  // The declared column is a button; the one beside it is not.
  const cell = card.locator('td[data-field="symbol"] button.cell-link', { hasText: "MSFT" });
  await expect(cell).toBeVisible();
  await expect(card.locator('td[data-field="price"] button')).toHaveCount(0);
  await expect.poll(() => quotes.length).toBeGreaterThan(0);

  await cell.click();

  // The sibling was never touched: its params moved because the GROUP did.
  await expect.poll(() => quotes.at(-1)).toBe("MSFT");
});

test("the moved group value is written to the dashboard file", async ({ page }) => {
  await seedApp(page, groupedSeed("grouped_table", "AAPL"));
  const card = page.locator(".widget-card").filter({ hasText: "Grouped Table" });

  await card.locator('td[data-field="symbol"] button.cell-link', { hasText: "NVDA" }).click();

  // Read back out of memfs rather than reloading the page: the browser shim
  // re-seeds memfs from window.__bdobbSeed on every navigation, so a reload
  // would restore the seed and prove nothing. This read IS the write.
  await expect
    .poll(async () => {
      const raw = await read(page, "dashboards/d1.json");
      return raw ? JSON.parse(raw).groups[0].value : null;
    })
    .toBe("NVDA");
  // The card's own stored param is untouched -- the group owns the value.
  const dash = JSON.parse((await read(page, "dashboards/d1.json"))!);
  expect(dash.tabs[0].cards[1].params.symbol).toBe("AAPL");
});

test("forceUpdate refetches the source table even when its own params did not move", async ({
  page,
}) => {
  const requests = trackSymbols(page, "/grouped_force");
  await seedApp(page, groupedSeed("grouped_table_force", "AAPL"));
  const card = page.locator(".widget-card").filter({ hasText: "Grouped Table Force" });
  const cell = card.locator('td[data-field="symbol"] button.cell-link', { hasText: "AAPL" });

  // The mount tally is taken, not assumed: `pnpm e2e` drives the vite dev
  // server, where React.StrictMode double-invokes the fetch effect, so a card
  // mounts with TWO identical requests. Both are issued in the same synchronous
  // remount, before any response can arrive -- so once a row is on screen the
  // tally has settled. It is still asserted non-empty, so a card that never
  // fetched at all cannot be mistaken below for a card that never retried.
  await expect(cell).toBeVisible();
  const mounted = requests.length;
  expect(mounted).toBeGreaterThan(0);

  // The group already holds AAPL, so clicking AAPL changes no effective param
  // on any card: splitParamEdit reports no group edit and the params key does
  // not move. retry() is the only thing that can produce a further request.
  await cell.click();

  await expect.poll(() => requests.length, { timeout: 5000 }).toBe(mounted + 1);
  expect(new Set(requests)).toEqual(new Set(["AAPL"]));
});

/** The default dashboard's two cards, ungrouped. `quote` and `prices` both declare `symbol`. */
function ungroupedSeed() {
  return dashboardSeed([
    { id: "c-quote", widgetId: "quote", backendId: "b1", params: { symbol: "AAPL" }, layout: { x: 0, y: 0, w: 20, h: 9 } },
    { id: "c-prices", widgetId: "prices", backendId: "b1", params: { symbol: "AAPL" }, layout: { x: 20, y: 0, w: 20, h: 12 } },
  ]);
}

test("a group created from one card's control, joined from another, moves both on an edit", async ({ page }) => {
  const prices = trackSymbols(page, "/prices");
  await seedApp(page, ungroupedSeed());
  const quote = page.locator(".widget-card").filter({ hasText: "Quote" });
  const priceCard = page.locator(".widget-card").filter({ hasText: "Price History" });

  await quote.getByRole("button", { name: "Group Symbol" }).click();
  await page.getByRole("menuitem", { name: "New group" }).click();
  await expect(quote.getByRole("button", { name: "Group 1: Group 1 — shared across grouped cards" })).toBeVisible();
  await expect(page.getByText("Group 1 · AAPL")).toBeVisible();

  await priceCard.getByRole("button", { name: "Group Symbol" }).click();
  await page.getByRole("menuitemcheckbox", { name: "1 Group 1 · AAPL" }).click();
  await expect(priceCard.getByRole("button", { name: /^Group 1:/ })).toBeVisible();

  const symbol = quote.getByLabel("Symbol", { exact: true });
  await symbol.fill("MSFT");
  await symbol.press("Enter");
  await expect.poll(() => prices.at(-1)).toBe("MSFT");
  await expect(page.getByText("Group 1 · MSFT")).toBeVisible();
});

test("leaving a group keeps the value the control was showing, and the file records it", async ({ page }) => {
  await seedApp(page, groupedSeed("grouped_table", "AAPL"));
  const card = page.locator(".widget-card").filter({ hasText: "Grouped Table" });
  await card.getByRole("button", { name: /^Group 1:/ }).click();
  await page.getByRole("menuitemcheckbox", { name: "1 Ticker · AAPL" }).click();
  await expect(card.getByRole("button", { name: "Group Symbol" })).toBeVisible();
  await expect(card.getByLabel("Symbol", { exact: true })).toHaveValue("AAPL");
  await expect
    .poll(async () => JSON.parse((await read(page, "dashboards/d1.json"))!).tabs[0].cards[1])
    .toMatchObject({ params: { symbol: "AAPL" } });
  const dash = JSON.parse((await read(page, "dashboards/d1.json"))!);
  expect(dash.tabs[0].cards[1].bindings).toBeUndefined();
});

test("a chip renames inline and deletes after the confirmation", async ({ page }) => {
  await seedApp(page, groupedSeed("grouped_table", "AAPL"));
  await page.getByText("Ticker · AAPL").dblclick();
  const field = page.getByRole("textbox", { name: "Rename group" });
  await field.fill("Watchlist");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Watchlist · AAPL")).toBeVisible();

  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Delete group Watchlist" }).click();
  await expect(page.getByText("Watchlist · AAPL")).toHaveCount(0);
  await expect
    .poll(async () => JSON.parse((await read(page, "dashboards/d1.json"))!).groups)
    .toEqual([]);
});

test("a dashboard file written with groupIds still groups", async ({ page }) => {
  const seed = dashboardSeed(
    [
      { id: "c-quote", widgetId: "quote", backendId: "b1", params: { symbol: "AAPL" }, layout: { x: 0, y: 0, w: 20, h: 9 }, groupIds: ["g1"] },
      { id: "c-grouped", widgetId: "grouped_table", backendId: "b1", params: { symbol: "AAPL" }, layout: { x: 0, y: 9, w: 20, h: 9 }, groupIds: ["g1"] },
    ],
    { groups: [{ id: "g1", name: "Ticker", paramName: "symbol", value: "AAPL" }] },
  );
  const quotes = trackSymbols(page, "/quote");
  await seedApp(page, seed);
  const card = page.locator(".widget-card").filter({ hasText: "Grouped Table" });
  await card.locator('td[data-field="symbol"] button.cell-link', { hasText: "MSFT" }).click();
  await expect.poll(() => quotes.at(-1)).toBe("MSFT");
});
