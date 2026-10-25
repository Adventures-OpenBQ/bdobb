// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Page } from "@playwright/test";
import { dashboardSeed, seedApp } from "./fixtures";

/** Every GET the page made to `pathname`, as the value of one query param. */
function trackQuery(page: Page, pathname: string, param: string): string[] {
  const seen: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname === pathname && req.method() === "GET") {
      seen.push(url.searchParams.get(param) ?? "");
    }
  });
  return seen;
}

/** Every POST the page made to `pathname`, as its raw JSON body. */
function trackPosts(page: Page, pathname: string): string[] {
  const bodies: string[] = [];
  page.on("request", (req) => {
    if (new URL(req.url()).pathname === pathname && req.method() === "POST") {
      bodies.push(req.postData() ?? "");
    }
  });
  return bodies;
}

/** The two fixture cards, in place of the default dashboard's own. */
const seedWithCards = () =>
  dashboardSeed([
    {
      id: "c-tabs",
      widgetId: "tabs_table",
      backendId: "b1",
      params: { period: "d" },
      layout: { x: 0, y: 0, w: 20, h: 9 },
    },
    {
      id: "c-form",
      widgetId: "form_table",
      backendId: "b1",
      params: { symbol: "AAPL", "order.symbol": "AAPL", "order.qty": "10" },
      layout: { x: 20, y: 0, w: 20, h: 12 },
    },
  ]);

test("a tabs param is a visible segmented control, and selecting one re-asks the question", async ({
  page,
}) => {
  const periods = trackQuery(page, "/tabbed", "period");
  await seedApp(page, seedWithCards());
  const card = page.locator(".widget-card").filter({ hasText: "Tabbed Table" });

  // The mount tally is taken, not assumed: `pnpm e2e` drives the vite dev
  // server, where React.StrictMode double-invokes the fetch effect, so a card
  // mounts with TWO identical requests. Both go out in the same synchronous
  // remount, before any response can land, so once a row is on screen the
  // tally has settled.
  await expect(card.getByRole("cell", { name: "d", exact: true })).toBeVisible();
  const mounted = periods.length;
  expect(mounted).toBeGreaterThan(0);
  expect(new Set(periods)).toEqual(new Set(["d"]));

  // In the BODY, not behind the parameter toggle: the tabs are the control,
  // so the card offers no parameter panel at all.
  await expect(card.locator(".card-body").getByRole("tablist", { name: "Period" })).toBeVisible();
  await expect(card.getByRole("button", { name: /Parameters/ })).toHaveCount(0);

  await card.getByRole("tab", { name: "Weekly" }).click();

  await expect.poll(() => periods.at(-1), { timeout: 5000 }).toBe("w");
  await expect(card.getByRole("tab", { name: "Weekly" })).toHaveAttribute("aria-selected", "true");
  // /tabbed echoes the period it was asked for, so the rows are direct
  // evidence of which tab this card is actually showing.
  await expect(card.getByRole("cell", { name: "w", exact: true })).toBeVisible();
});

test("a form field asks nothing, and its button POSTs once and refetches the card", async ({
  page,
}) => {
  const symbols = trackQuery(page, "/formed", "symbol");
  const posts = trackPosts(page, "/orders/submit");
  await seedApp(page, seedWithCards());
  const card = page.locator(".widget-card").filter({ hasText: "Form Table" });

  await expect(card.getByRole("cell", { name: "AAPL", exact: true })).toBeVisible();
  const mounted = symbols.length;
  expect(mounted).toBeGreaterThan(0);
  expect(posts).toEqual([]);

  await card.getByLabel("Order symbol", { exact: true }).fill("MSFT");

  // The edit is committed and nothing was requested for it. The wait gives a
  // wrongly-keyed effect time to fire before the absence is asserted.
  await expect(card.getByLabel("Order symbol", { exact: true })).toHaveValue("MSFT");
  await page.waitForTimeout(500);
  expect(symbols.length).toBe(mounted);

  await card.getByRole("button", { name: "Send" }).click();

  await expect.poll(() => posts.length, { timeout: 5000 }).toBe(1);
  // Bare field names, typed as the manifest declared them, plus the button.
  expect(JSON.parse(posts[0])).toEqual({ symbol: "MSFT", qty: 10, submit: true });

  // A 2xx refetches the card's own GET -- with the card's params, never the
  // form's: `symbol` is still AAPL even though the form's field says MSFT.
  await expect.poll(() => symbols.length, { timeout: 5000 }).toBe(mounted + 1);
  expect(symbols.at(-1)).toBe("AAPL");
});
