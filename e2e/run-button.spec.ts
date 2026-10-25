// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_CARDS, seedCards } from "./fixtures";

/** Every GET the page made to /run, in order, as its `symbol` value. */
function trackRuns(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname === "/run" && req.method() === "GET") {
      seen.push(url.searchParams.get("symbol") ?? "");
    }
  });
  return seen;
}

/** The default dashboard plus one run_table card, storing symbol=AAPL. */
function seedRunCard(page: Page): Promise<void> {
  return seedCards(page, [
    ...DEFAULT_CARDS,
    { id: "c-run", widgetId: "run_table", backendId: "b1", params: { symbol: "AAPL" }, layout: { x: 0, y: 12, w: 20, h: 9 } },
  ]);
}

const runCard = (page: Page) => page.locator(".widget-card").filter({ hasText: "Run Table" });

/**
 * Commit an edit exactly as a user would. The control lives in the card's
 * header row, always on screen, and a typed control commits on Enter -- so
 * there is no panel to open and no Apply button to press.
 *
 * `exact` is not decoration: the group link sitting beside every control is
 * named "Group <Label>", so a substring match on the label finds the button
 * too and the locator is ambiguous. Every param control in e2e/ is addressed
 * exactly for that reason.
 */
async function applySymbol(page: Page, value: string): Promise<void> {
  const symbol = runCard(page).getByLabel("Symbol", { exact: true });
  await symbol.fill(value);
  await symbol.press("Enter");
}

test("fetches once on load, and a parameter edit alone fetches nothing", async ({ page }) => {
  const runs = trackRuns(page);
  await seedRunCard(page);
  const card = runCard(page);

  // The mount tally is taken, not assumed: `pnpm e2e` drives the vite dev
  // server, where React.StrictMode double-invokes the fetch effect, so a card
  // mounts with TWO identical requests. Both go out in the same synchronous
  // remount, before any response can arrive, so once a row is on screen the
  // tally has settled. It is asserted non-empty so a card that never fetched
  // cannot be mistaken below for a card that correctly declined to.
  await expect(card.getByRole("cell", { name: "AAPL", exact: true })).toBeVisible();
  const mounted = runs.length;
  expect(mounted).toBeGreaterThan(0);
  expect(new Set(runs)).toEqual(new Set(["AAPL"]));

  await applySymbol(page, "MSFT");

  // The edit is committed and the card says so...
  await expect(card.locator(".card-stale")).toBeVisible();
  await expect(card.getByLabel("Symbol", { exact: true })).toHaveValue("MSFT");
  // ...and nothing was requested for it. The wait gives a wrongly-keyed effect
  // time to fire before the absence is asserted.
  await page.waitForTimeout(500);
  expect(runs.length).toBe(mounted);
  // /run echoes the symbol it was asked for, so the rows are direct evidence
  // of which question this card last ran.
  await expect(card.getByRole("cell", { name: "AAPL", exact: true })).toBeVisible();
});

test("Run adopts the edited parameters, and a Cmd-click on Run re-asks the armed ones while stale", async ({ page }) => {
  const runs = trackRuns(page);
  await seedRunCard(page);
  const card = runCard(page);

  await expect(card.getByRole("cell", { name: "AAPL", exact: true })).toBeVisible();
  const mounted = runs.length;
  expect(mounted).toBeGreaterThan(0);

  await applySymbol(page, "MSFT");
  await expect(card.locator(".card-stale")).toBeVisible();

  await card.getByRole("button", { name: "Run" }).click();

  await expect.poll(() => runs.length, { timeout: 5000 }).toBe(mounted + 1);
  expect(runs.at(-1)).toBe("MSFT");
  // Armed and live agree again: the marker is gone and the rows moved.
  await expect(card.locator(".card-stale")).toHaveCount(0);
  await expect(card.getByRole("cell", { name: "MSFT", exact: true })).toBeVisible();

  // Edit again, but do NOT press Run: the card is stale, armed on MSFT while
  // the live params say NVDA. This is the state a Cmd-click must be tested
  // in -- if it were tested with nothing edited (armed == live), `retry` and
  // `run` collapse to the same call and the modifier can't be distinguished.
  await applySymbol(page, "NVDA");
  await expect(card.locator(".card-stale")).toBeVisible();

  // ControlOrMeta, not Meta: Playwright maps it to the platform's own
  // modifier, which is why the handler tests metaKey || ctrlKey.
  await card.getByRole("button", { name: "Run" }).click({ modifiers: ["ControlOrMeta"] });

  // A hard refresh of the ARMED params, not an adoption of the pending edit:
  // one more request, and it re-asks MSFT, not NVDA.
  await expect.poll(() => runs.length, { timeout: 5000 }).toBe(mounted + 2);
  expect(runs.at(-1)).toBe("MSFT");
  // The edit was never adopted, so the card is still stale.
  await expect(card.locator(".card-stale")).toBeVisible();
  await expect(card.getByLabel("Symbol", { exact: true })).toHaveValue("NVDA");

  // A plain Run, by contrast, does adopt the pending edit and clears the marker.
  await card.getByRole("button", { name: "Run" }).click();

  await expect.poll(() => runs.length, { timeout: 5000 }).toBe(mounted + 3);
  expect(runs.at(-1)).toBe("NVDA");
  await expect(card.locator(".card-stale")).toHaveCount(0);
  await expect(card.getByRole("cell", { name: "NVDA", exact: true })).toBeVisible();
});
