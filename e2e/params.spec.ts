// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_CARDS, seedCards } from "./fixtures";

/** Every /committees request the page made, in order, as its chamber value. */
function trackCommitteeRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname === "/committees" && req.method() === "GET") {
      seen.push(url.searchParams.get("chamber") ?? "");
    }
  });
  return seen;
}

test("the committee options follow the chamber selection, fetched exactly once per chamber", async ({
  page,
}) => {
  const committees = trackCommitteeRequests(page);
  await seedCards(page, [
    ...DEFAULT_CARDS,
    {
      id: "c-congress",
      widgetId: "congress",
      backendId: "b1",
      params: { chamber: "house", committee: "wm" },
      layout: { x: 0, y: 12, w: 20, h: 9 },
    },
  ]);

  const card = page.locator(".widget-card").filter({ hasText: "Congress Committees" });

  const chamber = card.getByLabel("Chamber", { exact: true });
  const committee = card.getByLabel("Committee", { exact: true });

  // The stored chamber templates the committee request, and the list that
  // comes back is what the select offers.
  await expect(committee.locator("option")).toHaveText(["Ways and Means", "Financial Services"]);

  await chamber.selectOption("senate");

  // The key moved, the dependent refetched, and the stored "wm" — which the
  // Senate list does not offer — was cleared rather than shown as a Senate
  // committee. The cleared "" is itself an endpoint value the offered list
  // doesn't carry, so it renders as its own blank option row (ParamControls'
  // unofferedValues) alongside the two Senate committees.
  await expect(committee.locator("option")).toHaveText(["Finance", "Banking", ""]);
  await expect(committee).toHaveValue("");

  // Exactly two requests: one per chamber. The module-level in-flight map in
  // useParamOptions is what makes this stable under React StrictMode, which
  // the dev server enables and which double-invokes the mount effect.
  await page.waitForTimeout(500);
  expect(committees).toEqual(["house", "senate"]);
});

test("the Parameters panel lays its fields out as a grid on a wide card", async ({ page }) => {
  await seedCards(page, [
    {
      id: "c-congress",
      widgetId: "congress",
      backendId: "b1",
      params: { chamber: "house", committee: "wm" },
      layout: { x: 0, y: 0, w: 40, h: 12 },
      paramsOpen: true,
    },
  ]);
  const panel = page.locator(".widget-card").filter({ hasText: "Congress Committees" }).getByRole("region", { name: "Parameters" });
  const fields = panel.locator(".param-field");
  await expect(fields).toHaveCount(2);
  const [a, b] = [await fields.nth(0).boundingBox(), await fields.nth(1).boundingBox()];
  // Side by side, not stacked: the one-column form put the second field under the first.
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
  expect(b!.x).toBeGreaterThan(a!.x + a!.width);
});

test("in the Parameters panel a date's box, picker chip and ◷ badge stay on one line", async ({ page }) => {
  await seedCards(page, [
    {
      id: "c-cal",
      widgetId: "calendar_table",
      backendId: "b1",
      params: { symbol: "AAPL", trade: "T-1bd" },
      layout: { x: 0, y: 0, w: 20, h: 12 },
      paramsOpen: true,
    },
  ]);
  const panel = page.locator(".widget-card").filter({ hasText: "Calendar Table" }).getByRole("region", { name: "Parameters" });
  const entry = panel.locator(".param-entry").filter({ has: page.locator(".param-badge-expr") });
  const input = await entry.locator(".param-expr-input").boundingBox();
  const badge = await entry.locator(".param-badge-expr").boundingBox();
  // Beside the box, on its line -- not dropped under it or under the resolution.
  expect(badge!.x).toBeGreaterThan(input!.x + input!.width);
  expect(badge!.y).toBeLessThan(input!.y + input!.height);
});

test("on a narrow card no Parameters panel entry spills out of its cell or the panel", async ({ page }) => {
  await seedCards(page, [
    {
      id: "c-cal",
      widgetId: "calendar_table",
      backendId: "b1",
      params: { symbol: "AAPL", trade: "T-1bd" },
      layout: { x: 0, y: 0, w: 9, h: 12 },
      paramsOpen: true,
    },
  ]);
  const panel = page.locator(".widget-card").filter({ hasText: "Calendar Table" }).getByRole("region", { name: "Parameters" });
  const box = await panel.boundingBox();
  for (const field of await panel.locator(".param-field").all()) {
    const cell = await field.boundingBox();
    // The rightmost thing drawn inside the entry -- box, picker chip or badge --
    // not the entry's own box, which a flex item can shrink below its content.
    const right = await field.locator(".param-entry").evaluate((el) =>
      Math.max(...[...el.querySelectorAll("*")].map((c) => c.getBoundingClientRect().right)),
    );
    expect(right).toBeLessThanOrEqual(cell!.x + cell!.width + 1);
    expect(cell!.x + cell!.width).toBeLessThanOrEqual(box!.x + box!.width + 1);
  }
});
