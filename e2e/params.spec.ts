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
