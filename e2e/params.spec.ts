// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_CARDS, read, seedCards } from "./fixtures";

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
      hideTitleParams: true,
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
      hideTitleParams: true,
    },
  ]);
  const panel = page.locator(".widget-card").filter({ hasText: "Calendar Table" }).getByRole("region", { name: "Parameters" });
  const entry = panel.locator(".param-entry").filter({ has: page.locator(".param-badge-expr") });
  const input = await entry.locator(".param-expr-input").boundingBox();
  const picker = entry.getByTestId("param-picker-chip");
  const chip = await picker.boundingBox();
  const badge = await entry.locator(".param-badge-expr").boundingBox();
  // Beside the box, on its line -- not dropped under it or under the resolution.
  expect(chip!.x).toBeGreaterThanOrEqual(input!.x + input!.width);
  expect(Math.abs(chip!.y + chip!.height / 2 - input!.y - input!.height / 2)).toBeLessThan(2);
  expect(badge!.x).toBeGreaterThanOrEqual(chip!.x + chip!.width);
  expect(badge!.y).toBeLessThan(input!.y + input!.height);
  await picker.click();
  await expect(page.getByRole("dialog", { name: "Trade date calendar", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
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
      hideTitleParams: true,
    },
  ]);
  const panel = page.locator(".widget-card").filter({ hasText: "Calendar Table" }).getByRole("region", { name: "Parameters" });
  await expect(panel.locator(".param-field")).toHaveCount(2);
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

test("only row zero appears on the title line and later parameter rows stay editable in Parameters", async ({ page }) => {
  // The mock backend's congress widget declares a flat list; here its second
  // param is moved into a nested array, which is row 1.
  await page.route("**/widgets.json", async (route) => {
    const response = await route.fetch();
    const widgets = (await response.json()) as Record<string, { params?: unknown[] }>;
    const [chamber, ...rest] = widgets.congress.params ?? [];
    widgets.congress.params = [chamber, rest];
    await route.fulfill({ response, json: widgets });
  });
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
  const titleParams = card.locator(".card-chips");
  const panel = card.getByRole("region", { name: "Parameters" });
  await expect(titleParams.getByLabel("Chamber", { exact: true })).toBeVisible();
  await expect(titleParams.getByLabel("Committee", { exact: true })).toHaveCount(0);
  await expect(panel).toHaveCount(0);
  await card.getByRole("button", { name: "Show parameters", exact: true }).click();
  await expect(panel.getByLabel("Chamber", { exact: true })).toHaveCount(0);
  const committee = panel.getByLabel("Committee", { exact: true });
  await expect(committee).toBeVisible();
  const chamberBox = (await titleParams.getByLabel("Chamber", { exact: true }).boundingBox())!;
  expect((await committee.boundingBox())!.y).toBeGreaterThanOrEqual(chamberBox.y + chamberBox.height);
  await committee.selectOption("fs");
  await expect(committee).toHaveValue("fs");
  await expect.poll(async () => JSON.parse((await read(page, "dashboards/d1.json"))!).tabs[0].cards
    .find((entry: { id: string }) => entry.id === "c-congress").params.committee).toBe("fs");

  // Hiding row zero moves it into the panel without duplicating later rows.
  const showTitle = panel.getByRole("checkbox", { name: "Display on title bar" });
  await showTitle.uncheck();
  await expect(titleParams.getByLabel("Chamber", { exact: true })).toHaveCount(0);
  await expect(panel.getByLabel("Chamber", { exact: true })).toBeVisible();
  await expect(panel.getByLabel("Committee", { exact: true })).toHaveCount(1);
  await showTitle.check();
  await expect(titleParams.getByLabel("Chamber", { exact: true })).toBeVisible();
  await expect(panel.getByLabel("Chamber", { exact: true })).toHaveCount(0);
  await expect(panel.getByLabel("Committee", { exact: true })).toHaveValue("fs");
  await card.screenshot({ path: test.info().outputPath("param-rows.png") });
});
