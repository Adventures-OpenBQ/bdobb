// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Page } from "@playwright/test";
import { MOCK_URL, seedApp, type SeedFiles } from "./fixtures";

/** One live_grid card on its own backend. The backend is faked at the page's edge. */
function seed(symbol: string): SeedFiles {
  const backends = [{ id: "lg", name: "Live", baseUrl: `${MOCK_URL}/lg`, authLocation: "header", validateWidgets: false }];
  const card = { id: "c-grid", widgetId: "live_grid", backendId: "lg", params: { symbol }, layout: { x: 0, y: 0, w: 40, h: 12 } };
  return {
    "settings.json": "{}",
    "backends.json": JSON.stringify(backends),
    "dashboards/d1.json": JSON.stringify({ id: "d1", name: "Main", tabs: [{ id: "t1", name: "Main", cards: [card] }] }),
  };
}

/** A live_grid widget the way OpenBB's reference backend declares one, plus whatever columns a test adds. */
function widgetsJson(columns: Record<string, unknown>[]) {
  return {
    live_grid: {
      name: "Live Grid",
      description: "Streaming quotes",
      category: "Live",
      type: "live_grid",
      endpoint: "live_grid",
      wsEndpoint: "live_grid_ws",
      gridData: { w: 40, h: 12 },
      data: { wsRowIdColumn: "symbol", table: { columnsDefs: columns } },
      params: [{ paramName: "symbol", type: "text", value: "TSLA", label: "Symbol", multiSelect: true }],
    },
  };
}

type Wire = { urls: string[]; frames: string[]; meta: string[] };

/**
 * The backend at the page's edge: widgets.json, the REST snapshot, an optional
 * symbol_meta, and a socket that answers the subscription with one row object
 * per frame -- the shape OpenBB's reference /live_grid_ws sends.
 */
async function fakeBackend(page: Page, columns: Record<string, unknown>[], meta?: unknown): Promise<Wire> {
  const wire: Wire = { urls: [], frames: [], meta: [] };
  await page.route(`${MOCK_URL}/lg/widgets.json`, (route) => route.fulfill({ json: widgetsJson(columns) }));
  await page.route(`${MOCK_URL}/lg/apps.json`, (route) => route.fulfill({ status: 404, body: "" }));
  await page.route(`${MOCK_URL}/lg/live_grid*`, (route) =>
    route.fulfill({ json: [{ symbol: "TSLA", price: 10, change: 0 }] }),
  );
  await page.route(`${MOCK_URL}/lg/symbol_meta*`, (route) => {
    wire.meta.push(route.request().url());
    return meta === undefined ? route.fulfill({ status: 404, body: "" }) : route.fulfill({ json: meta });
  });
  await page.routeWebSocket(/\/lg\/live_grid_ws/, (ws) => {
    wire.urls.push(ws.url());
    ws.onMessage((raw) => {
      wire.frames.push(String(raw));
      ws.send(JSON.stringify({ symbol: "TSLA", price: 11.5, change: 1.5 }));
    });
  });
  return wire;
}

test("v3 reference compatibility: snapshot, an unauthenticated socket, the params frame, one row per frame", async ({ page }) => {
  const wire = await fakeBackend(page, [{ field: "symbol" }, { field: "price" }]);
  await seedApp(page, seed("TSLA"));

  const card = page.locator(".widget-card").first();
  // The snapshot, then the streamed row merged over it.
  await expect(card.locator('td[data-field="price"]')).toHaveText("11.5");
  // No credential and no params on the socket's address (every socket: React's
  // development StrictMode mounts the card's effects twice).
  expect(new Set(wire.urls)).toEqual(new Set([`${MOCK_URL.replace(/^http/, "ws")}/lg/live_grid_ws`]));
  expect(new Set(wire.frames)).toEqual(new Set([JSON.stringify({ params: { symbol: "TSLA" } })]));
  // A grid that reads no symbol_meta field asks for none and grows no columns.
  expect(wire.meta).toEqual([]);
  await expect(card.locator('th[data-field="logo_url"]')).toHaveCount(0);
});

test("v10: symbol_meta decorates a grid that reads it, with a logo and a 52-week bar at the row's price", async ({ page }) => {
  const wire = await fakeBackend(
    page,
    [
      { field: "logo_url", renderFn: ["logo"], width: 40 },
      { field: "symbol" },
      { field: "price" },
      { field: "week52_low", align: "right" },
      { field: "week52_range", renderFn: ["rangeBar"], renderFnParams: { lowKey: "week52_low", highKey: "week52_high" } },
      { field: "week52_high", align: "left" },
    ],
    [{ symbol: "TSLA", logo_url: `${MOCK_URL}/lg/static/TSLA.png`, week52_low: 1, week52_high: 21 }],
  );
  await page.route(`${MOCK_URL}/lg/static/TSLA.png`, (route) => route.fulfill({ status: 404, body: "" }));
  await seedApp(page, seed("TSLA"));

  const card = page.locator(".widget-card").first();
  await expect(card.locator("img.cell-logo")).toHaveAttribute("src", `${MOCK_URL}/lg/static/TSLA.png`);
  await expect(card.locator('td[data-field="week52_low"]')).toHaveClass(/align-right/);
  await expect(card.locator('td[data-field="price"]')).toHaveText("11.5");
  // 11.5 between 1 and 21 is just past half-way along the track.
  await expect(card.locator(".cell-range-marker")).toHaveAttribute("style", /52\.5%/);
  expect(new URL(wire.meta[0]).searchParams.get("symbol")).toBe("TSLA");
});
