// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Page } from "@playwright/test";
import {
  DEFAULT_CARDS,
  defaultSeed,
  openRail,
  openSettingsTab,
  read,
  seedApp,
  seedCards,
} from "./fixtures";

type Rect = { x: number; y: number; width: number; height: number };
const center = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** What actually receives a click at a point: the deepest element there, then whether `selector` contains it. */
async function hitTest(page: Page, point: { x: number; y: number }, selector: string): Promise<boolean> {
  return page.evaluate(
    ({ x, y, sel }) => {
      const el = document.elementFromPoint(x, y);
      return el !== null && Array.from(document.querySelectorAll(sel)).some((n) => n === el || n.contains(el));
    },
    { x: point.x, y: point.y, sel: selector },
  );
}

test.describe("corner drag handles", () => {
  test.beforeEach(async ({ page }) => {
    await seedApp(page, { ...defaultSeed(), "settings.json": JSON.stringify({ cornerDragHandles: true }) });
    await page.locator(".widget-card").first().waitFor();
  });

  for (const corner of ["se", "sw"]) {
    test(`the ${corner} handle is hit-testable`, async ({ page }) => {
      const handle = page.locator(".react-grid-item").first().locator(`.react-resizable-handle-${corner}`);
      const box = (await handle.boundingBox())!;
      expect(await hitTest(page, center(box), `.react-resizable-handle-${corner}`)).toBe(true);
    });
  }

  test(`the nw handle is hit-testable`, async ({ page }) => {
    const handle = page.locator(".react-grid-item").first().locator(".react-resizable-handle-nw");
    const box = (await handle.boundingBox())!;
    expect(await hitTest(page, center(box), ".react-resizable-handle-nw")).toBe(true);
  });

  test(`the ne handle is hit-testable`, async ({ page }) => {
    const handle = page.locator(".react-grid-item").first().locator(".react-resizable-handle-ne");
    const box = (await handle.boundingBox())!;
    expect(await hitTest(page, center(box), ".react-resizable-handle-ne")).toBe(true);
  });
});

test.describe("quick add button", () => {
  test(`does not cover a bottom-right card's se resize handle`, async ({ page }) => {
    // Vertical compaction (RGL default) would float a lone card to the top; a
    // blocker card in the same columns pins the target at the bottom.
    await seedCards(page, [
      ...DEFAULT_CARDS,
      { id: "c-blocker", widgetId: "quote", backendId: "b1", params: { symbol: "AAPL" }, layout: { x: 30, y: 0, w: 10, h: 13 } },
      { id: "c-target", widgetId: "quote", backendId: "b1", params: { symbol: "AAPL" }, layout: { x: 30, y: 13, w: 10, h: 8 } },
    ]);

    // The card id is not carried onto the grid item, so find the target by
    // geometry: after compaction it's whichever item sits lowest on the page.
    const items = page.locator(".react-grid-item");
    const boxes = await items.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    );
    let lowest = 0;
    for (let i = 1; i < boxes.length; i++) {
      if (boxes[i].y + boxes[i].height > boxes[lowest].y + boxes[lowest].height) lowest = i;
    }
    const handle = items.nth(lowest).locator(".react-resizable-handle-se");
    await handle.scrollIntoViewIfNeeded();
    const button = page.locator(".quick-add-button");
    const h = (await handle.boundingBox())!;
    const b = (await button.boundingBox())!;

    // Guard: the setup is only meaningful if the handle actually sits in the
    // bottom band the button occupies.
    const viewport = page.viewportSize()!;
    expect(
      h.y + h.height,
      `handle ${JSON.stringify(h)} not in bottom band of viewport height ${viewport.height}`,
    ).toBeGreaterThanOrEqual(viewport.height - 100);

    expect(intersects(h, b), `handle ${JSON.stringify(h)} vs button ${JSON.stringify(b)}`).toBe(false);
  });
});

test.describe("provider details dialog inside the Settings modal", () => {
  test("has height and lays out the New value field with no stray margin", async ({ page }) => {
    // Task B9 replaced the old .keys-wrap / .keys-table Settings UI with
    // ProviderDashboard (tiles + provider cards) and a per-provider
    // ProviderDetailsDialog child dialog; the masked-key editor now lives
    // there, behind "Manage key" (tier 3 only). The mock backend's /keys
    // fixture (scripts/browser-fixtures.mjs) always answers tier: 3, so no
    // extra seeding is needed to reach it -- the same route keys.spec.ts's
    // "Details for FMP" test already uses.
    await seedApp(page);
    await openSettingsTab(page, "Provider API Keys");
    const dashboard = page.locator(".bd-provider");
    await dashboard.waitFor();
    expect((await dashboard.boundingBox())!.height).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Details for FMP" }).click();
    await page.getByRole("dialog", { name: "FMP" }).waitFor();
    await page.getByRole("button", { name: "Manage key" }).click();

    const label = page.getByText("New value", { exact: true });
    const input = page.locator("#provider-new-value");
    const l = (await label.boundingBox())!;
    const i = (await input.boundingBox())!;
    // .bd-field is `display: grid; gap: var(--bd-s2)` (8px), a single
    // column -- unlike the old .keys-wrap edit row, the label sits directly
    // ABOVE its input here, not beside it. The layout bug this guards is the
    // same kind (a stray margin from an overly-broad selector widening the
    // gap or pushing the rows apart), just checked against the new stacked
    // shape: the label must end, and the input must start, within one
    // `--bd-s2` of each other, with the input immediately below.
    expect(l.y + l.height <= i.y, `label ${JSON.stringify(l)} should sit above input ${JSON.stringify(i)}`).toBe(true);
    expect(i.y - (l.y + l.height), `gap between label ${JSON.stringify(l)} and input ${JSON.stringify(i)}`).toBeLessThanOrEqual(9);
    // Left edges line up: nothing has nudged the input out from under its label.
    expect(Math.abs(l.x - i.x)).toBeLessThanOrEqual(1);

    // The old `.settings-section > label` descendant-selector bug (margin:
    // 4px 0 reaching a nested label it shouldn't) has no equivalent in the
    // new dialog architecture: `.settings-section` no longer exists at all
    // (removed by this same task), and `.bd-field > label` is the only rule
    // that targets this label. This assertion is what proves that stays
    // true rather than assuming it.
    expect(await label.evaluate((el) => getComputedStyle(el).marginTop)).toBe("0px");
  });
});

test.describe("quick add toolbar setting", () => {
  test("turning the toggle off removes the Add widget button and leaves Add tab in place", async ({ page }) => {
    await seedApp(page, defaultSeed());
    // exact: true, a habit from when the rail had its own "Add widget (⌘K)"
    // button (removed in v8, R5), which would have been a second match.
    const addWidget = page.getByRole("button", { name: "Add widget", exact: true });
    const addTab = page.getByRole("button", { name: "Add tab" });
    await expect(addWidget).toBeVisible();

    // quickAddToolbar is not one of the three live-previewed fields (only
    // theme/fontSize/railWidth preview before Done -- see Task B2's brief),
    // so it only stages into the draft here; nothing on the dashboard or on
    // disk changes until Done commits it.
    await openSettingsTab(page, "Layout");
    await page.getByLabel("Quick add toolbar").uncheck();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toHaveCount(0);

    await expect(addWidget).toHaveCount(0);
    await expect(addTab).toBeVisible();
    await expect
      .poll(async () => JSON.parse((await read(page, "settings.json"))!).quickAddToolbar)
      .toBe(false);

    // The dialog closed after the first Done, so reaching the toggle again
    // means reopening Settings -> Layout from scratch.
    await openSettingsTab(page, "Layout");
    await page.getByLabel("Quick add toolbar").check();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toHaveCount(0);
    await expect(addWidget).toBeVisible();
  });
});

test.describe("collapsed rail width and icons", () => {
  test("a seeded railWidth sizes the collapsed rail, which shows icons and badges but no labels", async ({
    page,
  }) => {
    // A second dashboard, one folder deep, so the collapsed rail has a NESTED
    // row in it: the rail is `overflow: hidden` at 80px, so an indent that
    // survived collapsing would push that row's badge off the icon column and
    // then clip it away entirely.
    const nested = {
      id: "d2",
      name: "Nested",
      tabs: [{ id: "t2", name: "Main", cards: [] }],
    };
    const folders = {
      folders: [{ id: "f1", name: "Macro", parentId: null }],
      folderOrder: ["f1"],
      placement: { d2: "f1" },
      collapsed: [],
    };
    await seedApp(page, {
      ...defaultSeed(),
      "settings.json": JSON.stringify({ railWidth: 80 }),
      "dashboards/d2.json": JSON.stringify(nested),
      "folders.json": JSON.stringify(folders),
    });
    const rail = page.locator("nav.left-rail");
    await rail.waitFor();

    // Collapsed: the setting drives the width, not the stylesheet's 48px.
    await expect
      .poll(async () => Math.round((await rail.boundingBox())!.width))
      .toBe(80);
    await expect(rail).not.toHaveAttribute("data-expanded", "true");

    const settingsButton = page.getByRole("button", { name: "Settings" });
    // The accessible name survives the label being display: none -- that is
    // what the aria-label is for, and openSettings() in fixtures.ts depends
    // on it.
    await expect(settingsButton).toBeVisible();
    await expect(settingsButton.locator("svg.rail-icon")).toBeVisible();
    await expect(settingsButton.locator(".rail-item-label")).toBeHidden();
    // Hidden means out of the layout, not merely clipped.
    expect(await settingsButton.locator(".rail-item-label").boundingBox()).toBeNull();

    // REVIEW (v8 Part C, C4): the rail's only accented icon was the plus on
    // its own "Add widget (⌘K)" row, which v8 removes (ruling R5, donor
    // 0d25ee2b); no icon in the rail is accented now, and the green + lives
    // on the tab bar.
    await expect(page.locator(".rail-icon-accent")).toHaveCount(0);

    // The first dashboard's badge reads the same collapsed as expanded --
    // it is the same node in both states, never a second element.
    const badge = page.getByText("⌥1");
    await expect(badge).toBeVisible();

    // The nested dashboard's badge sits in the SAME column as the top-level
    // one: collapsed, the rail is one icon column and the nesting indent is
    // off. Both halves matter -- a surviving indent shifts the badge off the
    // column, and a large enough one puts it outside the rail's own box,
    // where `overflow: hidden` erases it.
    const nestedBadge = page.getByText("⌥2");
    await expect(nestedBadge).toBeVisible();
    const railBox = (await rail.boundingBox())!;
    const first = (await badge.boundingBox())!;
    const deeper = (await nestedBadge.boundingBox())!;
    expect(
      Math.abs(center(deeper).x - center(first).x),
      `nested badge ${JSON.stringify(deeper)} vs first ${JSON.stringify(first)}`,
    ).toBeLessThanOrEqual(1);
    expect(deeper.x, `nested badge ${JSON.stringify(deeper)} vs rail ${JSON.stringify(railBox)}`)
      .toBeGreaterThanOrEqual(railBox.x);
    expect(
      deeper.x + deeper.width,
      `nested badge ${JSON.stringify(deeper)} vs rail ${JSON.stringify(railBox)}`,
    ).toBeLessThanOrEqual(railBox.x + railBox.width);

    await openRail(page);

    await expect
      .poll(async () => Math.round((await rail.boundingBox())!.width))
      .toBe(240);
    await expect(settingsButton.locator(".rail-item-label")).toBeVisible();
    await expect(settingsButton.locator("svg.rail-icon")).toBeVisible();
    await expect(badge).toBeVisible();
  });
});
