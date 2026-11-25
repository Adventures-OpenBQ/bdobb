// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_CARDS, defaultSeed, read, seedCards } from "./fixtures";

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

async function putFieldsInPanel(page: Page, widget: string) {
  await page.route('**/widgets.json', async route => {
    const response = await route.fetch();
    const widgets = await response.json();
    widgets[widget].params = [[], widgets[widget].params];
    await route.fulfill({ response, json: widgets });
  });
}

/** Put row-zero controls in the opened panel before testing its layout. */
async function openParametersPanel(page: Page, title: string) {
  const card = page.locator(".widget-card").filter({ hasText: title });
  await expect(card.getByRole("region", { name: "Parameters", exact: true })).toHaveCount(0);
  await card.getByRole("button", { name: "Show parameters", exact: true }).click();
  const panel = card.getByRole("region", { name: "Parameters", exact: true });
  await expect(panel).toBeVisible();
  await panel.getByRole("checkbox", { name: "Display on title bar", exact: true }).uncheck();
  await expect(panel.locator(".param-field").first()).toBeVisible();
  return panel;
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
  await putFieldsInPanel(page, 'congress');
  await seedCards(page, [
    {
      id: "c-congress",
      widgetId: "congress",
      backendId: "b1",
      params: { chamber: "house", committee: "wm" },
      layout: { x: 0, y: 0, w: 40, h: 12 },
    },
  ]);
  const panel = await openParametersPanel(page, "Congress Committees");
  const fields = panel.locator(".param-field");
  await expect(fields).toHaveCount(2);
  const [a, b] = [await fields.nth(0).boundingBox(), await fields.nth(1).boundingBox()];
  // Side by side, not stacked: the one-column form put the second field under the first.
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
  expect(b!.x).toBeGreaterThan(a!.x + a!.width);
});

test("in the Parameters panel a date's box, picker chip and ◷ badge stay on one line", async ({ page }) => {
  await putFieldsInPanel(page, 'calendar_table');
  await seedCards(page, [
    {
      id: "c-cal",
      widgetId: "calendar_table",
      backendId: "b1",
      params: { symbol: "AAPL", trade: "T-1bd" },
      layout: { x: 0, y: 0, w: 20, h: 12 },
    },
  ]);
  const panel = await openParametersPanel(page, "Calendar Table");
  const entry = panel.locator(".param-entry").filter({ has: page.locator(".param-badge-expr") });
  const input = await entry.locator(".param-expr-input").boundingBox();
  const badge = await entry.locator(".param-badge-expr").boundingBox();
  // Beside the box, on its line -- not dropped under it or under the resolution.
  expect(badge!.x).toBeGreaterThan(input!.x + input!.width);
  expect(badge!.y).toBeLessThan(input!.y + input!.height);
});

test("on a narrow card no Parameters panel entry spills out of its cell or the panel", async ({ page }) => {
  await putFieldsInPanel(page, 'calendar_table');
  await seedCards(page, [
    {
      id: "c-cal",
      widgetId: "calendar_table",
      backendId: "b1",
      params: { symbol: "AAPL", trade: "T-1bd" },
      layout: { x: 0, y: 0, w: 9, h: 12 },
    },
  ]);
  const panel = await openParametersPanel(page, "Calendar Table");
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

test("only row zero stays on the title while later parameter rows persist in the panel", async ({ page }, info) => {
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
  const title = card.locator(".card-chips");
  const panel = card.getByRole("region", { name: "Parameters", exact: true });
  const savedCard = async () => JSON.parse((await read(page, "dashboards/d1.json"))!).tabs[0].cards.find((c: { id: string }) => c.id === "c-congress");
  await expect(title.getByLabel("Chamber", { exact: true })).toHaveValue("house");
  await expect(title.getByLabel("Committee", { exact: true })).toHaveCount(0);
  await expect(panel).toHaveCount(0);
  await card.getByRole("button", { name: "Show parameters", exact: true }).click();
  await expect(panel.getByLabel("Committee", { exact: true })).toHaveValue("wm");
  await expect(panel.getByLabel("Chamber", { exact: true })).toHaveCount(0);
  await expect(card.getByLabel("Chamber", { exact: true })).toHaveCount(1);
  await expect(card.getByLabel("Committee", { exact: true })).toHaveCount(1);
  const chamber = (await title.getByLabel("Chamber", { exact: true }).boundingBox())!;
  const committee = (await panel.getByLabel("Committee", { exact: true }).boundingBox())!;
  expect(committee.y).toBeGreaterThanOrEqual(chamber.y + chamber.height);
  await expect.poll(async () => (await savedCard()).paramsOpen).toBe(true);
  await card.getByRole("button", { name: "Hide parameters", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(title.getByLabel("Chamber", { exact: true })).toHaveValue("house");
  await expect.poll(async () => (await savedCard()).paramsOpen).toBeUndefined();
  await card.getByRole("button", { name: "Show parameters", exact: true }).click();
  await expect.poll(async () => (await savedCard()).paramsOpen).toBe(true);
  const persisted = (await read(page, "dashboards/d1.json"))!;
  await page.addInitScript(seed => { window.__bdobbSeed = seed; }, { ...defaultSeed(), "dashboards/d1.json": persisted });
  await page.reload();
  await expect(card.getByRole("button", { name: "Hide parameters", exact: true })).toBeVisible();
  await expect(panel.getByLabel("Committee", { exact: true })).toHaveValue("wm");
  await expect(panel.getByLabel("Chamber", { exact: true })).toHaveCount(0);
  await expect(title.getByLabel("Chamber", { exact: true })).toHaveValue("house");
  await card.screenshot({ path: info.outputPath("parameter-rows-persisted.png") });
});
