// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Page } from "@playwright/test";
import { dashboardSeed, memfs, seedApp } from "./fixtures";

/** One card, the columnsDefs `screener` fixture, filling the grid. */
function screenerSeed(extra: Record<string, string> = {}) {
  return {
    ...dashboardSeed([
      {
        id: "c-screener",
        widgetId: "screener",
        backendId: "b1",
        params: {},
        // Narrow, so the declared column widths overflow and the pinned column
        // has somewhere to stay put against. See scripts/browser-fixtures.mjs.
        layout: { x: 0, y: 0, w: 14, h: 16 },
      },
    ]),
    ...extra,
  };
}

const card = (page: Page) => page.locator(".widget-card").filter({ hasText: "Screener" });

test("columnsDefs reach the browser: header names, a hidden column, formatting and colours", async ({
  page,
}) => {
  await seedApp(page, screenerSeed());
  const c = card(page);
  await c.locator("tbody tr[data-index]").first().waitFor();

  // headerName, and the suffix wrapped around it. toHaveCount, not
  // toBeVisible: the card is narrow enough to scroll sideways, so the
  // right-hand headers start off past its edge.
  await expect(c.getByRole("columnheader", { name: /Ticker/ })).toHaveCount(1);
  await expect(c.getByRole("columnheader", { name: /Company/ })).toHaveCount(1);
  await expect(c.getByRole("columnheader", { name: /Change \(d\)/ })).toHaveCount(1);
  // The raw field names are gone.
  await expect(c.getByRole("columnheader", { name: "symbol" })).toHaveCount(0);
  // hide: true starts hidden, header and body alike.
  await expect(c.locator('th[data-field="internal_id"]')).toHaveCount(0);
  await expect(c.locator('td[data-field="internal_id"]')).toHaveCount(0);

  // normalizedPercent: 0.001 -> "0.1 %".
  await expect(c.locator('td[data-field="chg"]').first()).toHaveText("0.1 %");

  // greenRed: alternating rows, and the classes resolve to different colours.
  const cells = c.locator('td[data-field="chg"]');
  await expect(cells.nth(0)).toHaveClass(/cell-pos/);
  await expect(cells.nth(1)).toHaveClass(/cell-neg/);
  const [pos, neg] = await Promise.all([
    cells.nth(0).evaluate((el) => getComputedStyle(el).color),
    cells.nth(1).evaluate((el) => getComputedStyle(el).color),
  ]);
  expect(pos).not.toBe(neg);
});

test("a pinned column stays put while the rest of the table scrolls sideways", async ({ page }) => {
  await seedApp(page, screenerSeed());
  const c = card(page);
  const scroll = c.locator(".table-scroll");
  await c.locator("tbody tr[data-index]").first().waitFor();

  // The fixture's declared widths exceed the card, so there is somewhere to go.
  expect(await scroll.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

  const pinned = c.locator('td[data-field="symbol"]').first();
  const moving = c.locator('td[data-field="sector"]').first();
  const before = {
    pinned: (await pinned.boundingBox())!.x,
    moving: (await moving.boundingBox())!.x,
  };

  await scroll.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await expect.poll(() => scroll.evaluate((el) => el.scrollLeft)).toBeGreaterThan(50);

  const after = {
    pinned: (await pinned.boundingBox())!.x,
    moving: (await moving.boundingBox())!.x,
  };
  const box = (await scroll.boundingBox())!;

  // The pinned cell has not moved, and sits flush with the scroll container,
  // right of the worker table's selection gutter.
  const gutter = (await c.locator("thead th[data-selection-gutter]").boundingBox())?.width ?? 0;
  expect(Math.abs(after.pinned - before.pinned)).toBeLessThan(1);
  expect(Math.abs(after.pinned - box.x - gutter)).toBeLessThan(1);
  // Its unpinned neighbour did move — otherwise the assertion above is
  // vacuous. Measured at 254px in Chromium and 253px in WebKit.
  expect(before.moving - after.moving).toBeGreaterThan(50);

  // And it paints over the scrolling cells rather than under them.
  const onTop = await page.evaluate(() => {
    const cell = document.querySelector('td[data-field="symbol"]') as HTMLElement;
    const r = cell.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + 4, r.top + r.height / 2);
    return cell.contains(hit);
  });
  expect(onTop).toBe(true);
});

test("the filter row narrows the rows and keeps the count honest", async ({ page }) => {
  await seedApp(page, screenerSeed());
  const c = card(page);
  await c.locator("tbody tr[data-index]").first().waitFor();

  await expect(c.locator("tr.filter-row")).toHaveCount(0);
  await c.getByRole("button", { name: "Filter rows" }).click();
  await expect(c.locator("tr.filter-row")).toHaveCount(1);
  await expect(c.locator(".filter-count")).toHaveText("120 of 120 rows");

  // Regression: the pinned-cell rule re-set `position: sticky` without a
  // `top`, so the pinned filter cell inherited `top: 0` from
  // `.widget-table th` and stuck under the header row while the rest of the
  // filter row scrolled away with the body. Horizontal stickiness only.
  const pinnedFilter = c.locator("tr.filter-row th.pin-left").first();
  const plainFilter = c.locator("tr.filter-row th:not(.pin-left):not(.pin-right)").first();
  expect(await pinnedFilter.evaluate((el) => getComputedStyle(el).top)).toBe("auto");

  // Measured on a header CELL, not on its <tr>: only the cells are sticky, so
  // the row's own box keeps scrolling while they stay put.
  const headerCell = c.locator("thead tr").first().locator("th[data-field]").first();
  const headerBox = (await headerCell.boundingBox())!;
  // At rest it sits below the sticky header row, not over it.
  const restY = (await pinnedFilter.boundingBox())!.y;
  expect(restY).toBeGreaterThan(headerBox.y + headerBox.height - 1);

  const scroll = c.locator(".table-scroll");
  await scroll.evaluate((el) => {
    el.scrollTop = 40;
  });
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBe(40);

  // Scrolled: the header row is still pinned at the top, so anything that
  // stuck to it would not have moved. This cell moved with its own row, in
  // step with its unpinned neighbours.
  const movedY = (await pinnedFilter.boundingBox())!.y;
  expect(Math.abs(movedY - (await plainFilter.boundingBox())!.y)).toBeLessThan(1);
  expect(restY - movedY).toBeGreaterThan(30);
  // Stuck to the scroll box's top (a worker table's selection bar above it scrolls away).
  expect(Math.abs((await headerCell.boundingBox())!.y - (await scroll.boundingBox())!.y)).toBeLessThan(2);

  await scroll.evaluate((el) => {
    el.scrollTop = 0;
  });

  // 4 sectors x 30.
  await c.getByLabel("Filter Sector").fill("Energy");
  await expect(c.locator(".filter-count")).toHaveText("30 of 120 rows");
  await expect(c.locator('td[data-field="sector"]').first()).toHaveText("Energy");

  // A second filter, at the same time. "Number 1 " — with the trailing space —
  // occurs in exactly one name, row 1, which is an Energy row.
  await c.getByLabel("Filter Company").fill("Number 1 ");
  await expect(c.locator(".filter-count")).toHaveText("1 of 120 rows");
  await expect(c.locator('td[data-field="symbol"]').first()).toHaveText("S001");

  await c.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(c.locator(".filter-count")).toHaveText("120 of 120 rows");

  // The number control, on the RAW value: chg is a fraction, and every even
  // row is positive, so ">= 0" is the 60 even rows.
  await c.getByLabel("Minimum Change (d)").fill("0");
  await expect(c.locator(".filter-count")).toHaveText("60 of 120 rows");
});

test("a sort and a filter survive a reload", async ({ page }) => {
  await seedApp(page, screenerSeed());
  const c = card(page);
  await c.locator("tbody tr[data-index]").first().waitFor();

  // Descending by Ticker, so the last symbol comes first.
  await c.getByRole("columnheader", { name: /Ticker/ }).click();
  await c.getByRole("columnheader", { name: /Ticker/ }).click();
  await expect(c.locator('td[data-field="symbol"]').first()).toHaveText("S119");

  await c.getByRole("button", { name: "Filter rows" }).click();
  await c.getByLabel("Filter Sector").fill("Energy");
  await expect(c.locator(".filter-count")).toHaveText("30 of 120 rows");

  // The write is the persistence guarantee at this layer.
  await expect
    .poll(async () => {
      const raw = await memfs(page).read("dashboards/d1.json");
      const table = raw ? JSON.parse(raw).tabs[0].cards[0].table : undefined;
      return Boolean(table?.columnFilters?.length && table?.sorting?.length);
    })
    .toBe(true);
  const written = (await memfs(page).read("dashboards/d1.json")) as string;

  // A reload starts memfs over from the seed, so the restore is exercised by
  // seeding the file the app just wrote and booting again.
  await seedApp(page, screenerSeed({ "dashboards/d1.json": written }));
  const reloaded = card(page);
  await reloaded.locator("tbody tr[data-index]").first().waitFor();

  // S117, not the S119 of the unfiltered sort above: the reload restores the
  // filter as well as the sort, and the highest Energy ticker is row 117
  // (sector is SECTORS[i % 4], so Energy is every i where i % 4 === 1).
  expect(await reloaded.locator('td[data-field="symbol"]').first().textContent()).toBe("S117");
  await expect(reloaded.getByRole("columnheader", { name: /Ticker/ }).locator(".sort-marker")).toHaveText(
    "▼",
  );
  // The filter row is transient, but the filter itself is not: turning the row
  // back on shows the persisted value, and the rows are already narrowed.
  await expect(reloaded.locator('td[data-field="sector"]').first()).toHaveText("Energy");
  await reloaded.getByRole("button", { name: "Filter rows" }).click();
  await expect(reloaded.getByLabel("Filter Sector")).toHaveValue("Energy");
  await expect(reloaded.locator(".filter-count")).toHaveText("30 of 120 rows");
});

test("Columns hides a column and Reset table puts everything back", async ({ page }) => {
  await seedApp(page, screenerSeed());
  const c = card(page);
  await c.locator("tbody tr[data-index]").first().waitFor();

  await c.getByRole("button", { name: "Card menu" }).click();
  await page.getByRole("menuitem", { name: /^Columns/ }).click();
  await page.getByRole("menuitemcheckbox", { name: /Sector/ }).click();

  await expect(c.locator('th[data-field="sector"]')).toHaveCount(0);
  // The spec-hidden column is still offered in the list.
  await expect(page.getByRole("menuitemcheckbox", { name: /Internal id/ })).toHaveAttribute(
    "aria-checked",
    "false",
  );

  await page.getByRole("menuitem", { name: "Quick actions ▸" }).click();
  await page.getByRole("menuitem", { name: "Reset columns" }).click();

  await expect(c.locator('th[data-field="sector"]')).toHaveCount(1);
  await expect(c.locator('th[data-field="internal_id"]')).toHaveCount(0);
  await expect
    .poll(async () => {
      const raw = await memfs(page).read("dashboards/d1.json");
      return raw ? "table" in JSON.parse(raw).tabs[0].cards[0] : true;
    })
    .toBe(false);
});

test("a widget table's border-collapse and cell borders are unchanged by the switch", async ({ page }) => {
  // .widget-table had to become `border-collapse: separate; border-spacing: 0`
  // for a sticky pinned cell to have any visible edge at all (see the plan's
  // note (a)). This guards that the switch cost an ordinary, nothing-pinned
  // table nothing.
  //
  // This test used to reach `.widget-table` through `table.keys-table`
  // (KeysRenderer, opened via Settings -> Provider keys) on the theory that
  // KeysRenderer shares the class with the screener table this file already
  // seeds. That path predates this dialog-redesign branch: WidgetCard.tsx's
  // `widget?.type === "keys"` branch has unconditionally shown a "Provider
  // keys moved to Settings" placeholder instead of KeysRenderer since before
  // this branch started (confirmed at the branch's own base commit), and
  // Task B9 additionally replaced Settings' own Provider-keys tab render
  // with ProviderDashboard -- so `.keys-table` is dead markup with no
  // reachable UI path at all now, on either surface. Retargeted onto the
  // screener card `screenerSeed()` already puts on the dashboard, which
  // exercises the exact same shared `.widget-table` CSS this test cares
  // about, through UI that is actually live.
  await seedApp(page, screenerSeed());
  const table = card(page).locator("table.widget-table");
  await table.locator("tbody tr").first().waitFor();

  // Chromium serialises the computed border-spacing as ONE length when the
  // horizontal and vertical values are equal, so zero spacing reads "0px".
  expect(
    await table.evaluate((el) => {
      const s = getComputedStyle(el);
      return { collapse: s.borderCollapse, spacing: s.borderSpacing };
    }),
  ).toEqual({ collapse: "separate", spacing: "0px" });

  // Zero spacing: adjacent cells in a row abut exactly, with no gap where a
  // collapsed border used to be shared.
  const cells = table.locator("tbody tr").first().locator("td");
  const first = (await cells.nth(1).boundingBox())!;
  const second = (await cells.nth(2).boundingBox())!;
  expect(Math.abs(second.x - (first.x + first.width))).toBeLessThan(1);

  // And the row rule is still one 1px line, not two stacked borders.
  expect(await cells.nth(1).evaluate((el) => getComputedStyle(el).borderBottomWidth)).toBe("1px");
  expect(await cells.nth(1).evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("0px");

  // (The old .keys-table version of this test also asserted that no
  // `.pin-left`/`.pin-right` class reached an unpinned table -- but this
  // screener fixture's columnsDefs bakes in a pinned column on purpose (see
  // screenerSeed's own comment, and "a pinned column stays put" above), so
  // that assertion doesn't translate here: the pin classes are SUPPOSED to
  // be present on this card. Border-collapse/spacing/border-width above are
  // the properties this test actually owns; pinning itself is covered by
  // the dedicated pinned-column tests elsewhere in this file.)
});

test("a column pinned from the header menu survives a reload, and Reset table unpins it", async ({
  page,
}) => {
  await seedApp(page, screenerSeed());
  const c = card(page);
  const scroll = c.locator(".table-scroll");
  await c.locator("tbody tr[data-index]").first().waitFor();

  // The fixture pins `symbol` left and nothing right, so `sector` starts
  // unpinned and the assertion below cannot pass by accident.
  await expect(c.locator('th[data-field="sector"].pin-right')).toHaveCount(0);

  await c.locator('th[data-field="sector"]').click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Pin right" }).click();

  await expect(c.locator('th[data-field="sector"].pin-right')).toHaveCount(1);
  await expect(page.getByRole("menu")).toHaveCount(0);

  /** The right edge of the scroll container's CONTENT box. */
  const contentRight = () =>
    scroll.evaluate((el) => {
      const r = el.getBoundingClientRect();
      // clientLeft + clientWidth rather than the border box: a classic
      // scrollbar would sit inside the border box and a sticky right column
      // stops at the content edge, not at it. On macOS overlay scrollbars the
      // two are the same number, so this is correct either way.
      return r.left + el.clientLeft + el.clientWidth;
    });

  await scroll.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await expect.poll(() => scroll.evaluate((el) => el.scrollLeft)).toBeGreaterThan(50);

  const header = (await c.locator('th[data-field="sector"]').boundingBox())!;
  expect(Math.abs(header.x + header.width - (await contentRight()))).toBeLessThan(1);

  // The write is the persistence guarantee at this layer.
  await expect
    .poll(async () => {
      const raw = await memfs(page).read("dashboards/d1.json");
      return raw ? JSON.parse(raw).tabs[0].cards[0].table?.pinned : undefined;
    })
    .toEqual({ sector: "right" });
  const written = (await memfs(page).read("dashboards/d1.json")) as string;

  // A reload starts memfs over from the seed, so the restore is exercised by
  // seeding the file the app just wrote and booting again.
  await seedApp(page, screenerSeed({ "dashboards/d1.json": written }));
  const reloaded = card(page);
  await reloaded.locator("tbody tr[data-index]").first().waitFor();

  await expect(reloaded.locator('th[data-field="sector"].pin-right')).toHaveCount(1);
  // The widget's own pin is still honoured alongside the user's.
  await expect(reloaded.locator('th[data-field="symbol"].pin-left')).toHaveCount(1);

  await reloaded.getByRole("button", { name: "Card menu" }).click();
  await page.getByRole("menuitem", { name: "Quick actions ▸" }).click();
  await page.getByRole("menuitem", { name: "Reset columns" }).click();

  await expect(reloaded.locator('th[data-field="sector"].pin-right')).toHaveCount(0);
  await expect(reloaded.locator('th[data-field="symbol"].pin-left')).toHaveCount(1);
  await expect
    .poll(async () => {
      const raw = await memfs(page).read("dashboards/d1.json");
      return raw ? "table" in JSON.parse(raw).tabs[0].cards[0] : true;
    })
    .toBe(false);
});

test("Clear and the count sit after the last column, on one line, in no column's filter cell", async ({ page }) => {
  // The screener is pinned left and wider than its card.
  await seedApp(page, screenerSeed());
  const c = card(page);
  await c.locator("tbody tr[data-index]").first().waitFor();
  await c.getByRole("button", { name: "Filter rows" }).click();

  const clear = c.getByRole("button", { name: "Clear", exact: true });
  const count = c.locator(".filter-count");
  await expect(count).toHaveText("120 of 120 rows");
  for (const el of [clear, count]) {
    expect(await el.evaluate((e) => e.closest("th[data-filter-for]") === null)).toBe(true);
  }
  // Right of the last column's right edge, one line, right-aligned.
  const lastColumnRight = await c
    .locator("tr.filter-row th[data-filter-for]")
    .last()
    .evaluate((e) => e.getBoundingClientRect().right);
  const clearBox = (await clear.boundingBox())!;
  const countBox = (await count.boundingBox())!;
  expect(clearBox.x).toBeGreaterThanOrEqual(lastColumnRight);
  expect(Math.abs(clearBox.y + clearBox.height / 2 - (countBox.y + countBox.height / 2))).toBeLessThan(3);
  // The filter row is no taller than one control: nothing stacked under min/max.
  const rowHeight = (await c.locator("tr.filter-row").boundingBox())!.height;
  expect(rowHeight).toBeLessThan(clearBox.height * 2);

  // Behaviour unchanged: Clear resets every filter.
  await c.getByLabel("Filter Sector").fill("Energy");
  await expect(count).toHaveText("30 of 120 rows");
  await clear.click();
  await expect(count).toHaveText("120 of 120 rows");
});
