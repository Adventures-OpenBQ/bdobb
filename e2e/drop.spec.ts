// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Page } from "@playwright/test";
import { defaultSeed, openRail, read, seedApp, seedCards } from "./fixtures";

const CSV = "symbol,close\nAAPL,190.5\nMSFT,410.25\n";

/** The stored name of the seeded file: a uuid, exactly as saveLocalFile writes. */
const STORED = "11111111-1111-4111-8111-111111111111.csv";

/**
 * Dispatches a real drag-and-drop of one file onto the dashboard area.
 * Playwright cannot drag from outside the page, so the DataTransfer is built
 * in the page and the two events are dispatched by hand -- which is exactly
 * what the browser delivers, and what React's onDragOver/onDrop see.
 */
async function dropFile(page: Page, name: string, text: string): Promise<void> {
  await page.evaluate(
    ([fileName, body]) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([body!], fileName!, { type: "text/plain" }));
      const area = document.querySelector("main.dashboard-area")!;
      const at = area.getBoundingClientRect();
      const init = {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
        clientX: Math.round(at.left + at.width / 2),
        clientY: Math.round(at.top + at.height / 2),
      };
      area.dispatchEvent(new DragEvent("dragover", init));
      area.dispatchEvent(new DragEvent("drop", init));
    },
    [name, text] as const,
  );
}

test("dropping a CSV on the dashboard adds a table card of its rows", async ({ page }) => {
  // An empty tab, so the only card on screen is the dropped one.
  await seedCards(page, []);
  await page.locator(".dashboard-grid").waitFor();

  await dropFile(page, "prices.csv", CSV);

  const card = page.locator(".widget-card").filter({ hasText: "prices.csv" });
  await expect(card).toHaveCount(1);
  await expect(card.getByRole("cell", { name: "AAPL", exact: true })).toBeVisible();
  await expect(card.getByRole("columnheader", { name: /Symbol/i })).toBeVisible();

  // The bytes went to the app's own files/ directory, under a uuid -- never
  // under the name the file was dropped with.
  const raw = await read(page, "dashboards/d1.json");
  const stored = JSON.parse(raw!).tabs[0].cards[0].params.file as string;
  expect(stored).toMatch(/^[0-9a-f-]{36}\.csv$/);
});

test("a card whose file was stored in an earlier session reads it back at boot", async ({
  page,
}) => {
  // What the app finds on disk after a restart: the card, and the file it
  // names. A reload starts memfs over from the seed, so seeding both IS the
  // restart -- the same technique e2e/table-toolkit.spec.ts uses for state.
  await seedCards(
    page,
    [
      {
        id: "c-local",
        widgetId: "local_table",
        backendId: "builtin",
        title: "prices.csv",
        params: { file: STORED },
        layout: { x: 0, y: 0, w: 24, h: 14 },
      },
    ],
    { [`files/${STORED}`]: CSV },
  );

  const card = page.locator(".widget-card").filter({ hasText: "prices.csv" });
  await expect(card.getByRole("cell", { name: "MSFT", exact: true })).toBeVisible();
});

test("a dropped dashboard named like one of yours asks first, and Replace keeps its place", async ({
  page,
}) => {
  const seed = defaultSeed();
  seed["dashboards/d2.json"] = JSON.stringify({
    id: "d2",
    name: "Second",
    tabs: [{ id: "t2", name: "Main", cards: [] }],
  });
  await seedApp(page, seed);
  await page.locator(".dashboard-grid").waitFor();

  const file = JSON.stringify([
    {
      name: "Main",
      tabs: { t1: { id: "t1", name: "From file", layout: [{ i: "quote", x: 0, y: 0, w: 20, h: 9 }] } },
    },
  ]);
  await dropFile(page, "main.apps.json", file);

  const dialog = page.getByRole("dialog", { name: 'A dashboard named "Main" already exists' });
  await expect(dialog).toBeVisible();
  // showModal() would otherwise focus Replace, the first button.
  await expect(dialog.getByRole("button", { name: /^Keep both/ })).toBeFocused();
  await dialog.getByRole("button", { name: /^Replace/ }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByRole("status")).toContainText("(1 replaced)");
  // Labels show on the expanded rail, as e2e/rail.spec.ts reads them.
  await openRail(page);
  const labels = page.locator("nav.left-rail [data-testid='rail-dashboards'] .rail-item-label");
  await expect(labels).toHaveText(["Main", "Second"]);
  await expect
    .poll(async () => JSON.parse((await read(page, "dashboards/d1.json")) ?? "{}"))
    .toMatchObject({ id: "d1", name: "Main", tabs: [{ name: "From file" }] });
});
