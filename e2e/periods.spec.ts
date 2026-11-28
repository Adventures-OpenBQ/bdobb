// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Locator, type Page } from "@playwright/test";
import { dashboardSeed, read, seedApp, type SeedCard, type SeedFiles } from "./fixtures";

/**
 * Every `T` below resolves against this instant: Wednesday 26 Aug 2026,
 * 09:30:00 in New York — the same fixed time scripts/help-shots.mjs uses.
 * Under a December year end that is 2026-Q3 / FY2026 / 2026-W35; under
 * September (AAPL) it is FY2026-Q4; under June (MSFT) FY2027-Q1.
 */
const NOW = new Date("2026-08-26T13:30:00Z");

test.use({ timezoneId: "America/New_York" });

/** seedApp with the clock pinned first: the install must precede the app's first Date read. */
async function seedAt(page: Page, files: SeedFiles): Promise<void> {
  await page.clock.install();
  await page.clock.setFixedTime(NOW);
  await seedApp(page, files);
}

/** Every request to `pathname`, in order, as its query string. */
function trackQueries(page: Page, pathname: string): string[] {
  const seen: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname === pathname && req.method() === "GET") seen.push(url.search);
  });
  return seen;
}

type Binding = { groupId: string; paramName: string };

function echoCard(id: string, fyEnd: string, over: Record<string, string> = {}, bindings?: Binding[]): SeedCard {
  return {
    id,
    widgetId: "period_echo",
    backendId: "builtin",
    params: {
      fy_end: fyEnd,
      quarter: "T",
      fiscal_year: "T",
      week: "T",
      asof: "T",
      start_date: "2026-01-01/T",
      session: "09:30:00",
      ...over,
    },
    layout: { x: 0, y: 0, w: 20, h: 8 },
    ...(bindings ? { bindings } : {}),
  };
}

/**
 * The echo's value for `name`: the `<dd>` ParamEchoRenderer labels with the
 * param's name. By attribute rather than by role: Playwright computes no
 * accessible name for a `definition` from its aria-label (the aria snapshot
 * lists these rows as bare `definition: 2026-Q3`), so getByRole's `name`
 * filter never matches, though jsdom's does in the renderer's unit test.
 */
const echo = (card: Locator, name: string) => card.locator(`dd[aria-label="${name}"]`);
const trigger = (card: Locator, label: string) => card.getByRole("button", { name: label, exact: true });

test("every period control resolves T per type, and each popover pick reaches the echo", async ({ page }) => {
  await seedAt(page, dashboardSeed([echoCard("c-echo", "December")]));
  const card = page.locator(".widget-card").filter({ hasText: "Period echo" });

  await expect(echo(card, "quarter")).toHaveText("2026-Q3");
  await expect(echo(card, "fiscal_year")).toHaveText("2026");
  await expect(echo(card, "week")).toHaveText("2026-W35");
  await expect(echo(card, "asof")).toHaveText("2026-08-26T09:30:00-04:00");
  await expect(echo(card, "start_date")).toHaveText("2026-01-01");
  await expect(echo(card, "end_date")).toHaveText("2026-08-26");
  await expect(echo(card, "session")).toHaveText("09:30:00");
  await expect(trigger(card, "Quarter")).toHaveText("FY2026-Q3");
  await expect(trigger(card, "As of")).toHaveText("2026-08-26 09:30:00 EDT");
  await expect(trigger(card, "Week")).toHaveText("W35 2026 · Aug 24–30");

  // Since v5.3.0 a popover whose value is an expression (the seeded `T`s,
  // `2026-01-01/T`) opens on Relative (spec §4), so each pick selects Absolute first.
  await trigger(card, "Quarter").click();
  await page.getByRole("dialog", { name: "Quarter" }).getByRole("tab", { name: "Absolute" }).click();
  await page.getByRole("dialog", { name: "Quarter" }).getByRole("button", { name: "FY2026-Q1 (Jan–Mar 2026)" }).click();
  await expect(echo(card, "quarter")).toHaveText("2026-Q1");
  await expect(trigger(card, "Quarter")).toHaveText("FY2026-Q1");

  await trigger(card, "Fiscal year").click();
  await page.getByRole("dialog", { name: "Fiscal year" }).getByRole("tab", { name: "Absolute" }).click();
  await page.getByRole("dialog", { name: "Fiscal year" }).getByRole("button", { name: "FY2024 (Jan–Dec 2024)" }).click();
  await expect(echo(card, "fiscal_year")).toHaveText("2024");

  await trigger(card, "Week").click();
  await page.getByRole("dialog", { name: "Week" }).getByRole("tab", { name: "Absolute" }).click();
  await page.getByRole("dialog", { name: "Week" }).getByRole("button", { name: /August 12, 2026/ }).click();
  await expect(echo(card, "week")).toHaveText("2026-W33");

  await trigger(card, "As of").click();
  await page.getByRole("dialog", { name: "As of" }).getByRole("tab", { name: "Absolute" }).click();
  await page.getByRole("dialog", { name: "As of" }).getByRole("button", { name: /August 20, 2026/ }).click();
  await expect(echo(card, "asof")).toHaveText("2026-08-20T09:30:00-04:00");

  await trigger(card, "Range").click();
  const range = page.getByRole("dialog", { name: "Range" });
  await range.getByRole("tab", { name: "Absolute" }).click();
  await range.getByRole("button", { name: /January 5, 2026/ }).click();
  await range.getByRole("button", { name: /January 9, 2026/ }).click();
  await expect(echo(card, "start_date")).toHaveText("2026-01-05");
  await expect(echo(card, "end_date")).toHaveText("2026-01-09");

  // The time field is inline: an edited segment commits when focus leaves.
  const hour = card.getByRole("spinbutton", { name: /hour/i });
  await hour.click();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(echo(card, "session")).toHaveText("10:30:00");

  // Escape closes without writing.
  await trigger(card, "Quarter").click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Quarter" })).toHaveCount(0);
  await expect(echo(card, "quarter")).toHaveText("2026-Q1");

  // The write is async; poll the file as the group test below does.
  await expect
    .poll(async () => JSON.parse((await read(page, "dashboards/d1.json"))!).tabs[0].cards[0].params)
    .toMatchObject({
    quarter: "2026-Q1",
    fiscal_year: "2024",
    week: "2026-W33",
    asof: "2026-08-20T09:30:00-04:00",
    start_date: "2026-01-05/2026-01-09",
    session: "10:30:00",
  });
});

test("a date_range arrives at the backend as two query params", async ({ page }) => {
  const rows = trackQueries(page, "/period_rows");
  await seedAt(
    page,
    dashboardSeed([
      {
        id: "c-period",
        widgetId: "period_table",
        backendId: "b1",
        params: { symbol: "AAPL", quarter: "T", start_date: "2026-01-01/2026-03-31" },
        layout: { x: 0, y: 0, w: 20, h: 9 },
      },
    ]),
  );
  const card = page.locator(".widget-card").filter({ hasText: "Period Table" });
  await expect.poll(() => rows.length).toBeGreaterThan(0);
  let q = new URLSearchParams(rows.at(-1));
  expect(q.get("start_date")).toBe("2026-01-01");
  expect(q.get("end_date")).toBe("2026-03-31");
  // Exactly the widget's three params with the range expanded into its two
  // keys: no composite `start_date/end_date` value and no third range key.
  expect([...q.keys()].sort()).toEqual(["end_date", "quarter", "start_date", "symbol"]);

  await trigger(card, "Range").click();
  const range = page.getByRole("dialog", { name: "Range" });
  await range.getByRole("button", { name: /January 12, 2026/ }).click();
  await range.getByRole("button", { name: /January 16, 2026/ }).click();
  await expect.poll(() => new URLSearchParams(rows.at(-1)).get("start_date")).toBe("2026-01-12");
  q = new URLSearchParams(rows.at(-1));
  expect(q.get("end_date")).toBe("2026-01-16");
});

test("two echoes with different year ends share one quarter group and label one stored value two ways", async ({ page }) => {
  const binding = [{ groupId: "g-q", paramName: "quarter" }];
  const seed = dashboardSeed(
    [
      { ...echoCard("c-dec", "December", { quarter: "2026-Q3" }, binding), layout: { x: 0, y: 0, w: 20, h: 8 } },
      { ...echoCard("c-sep", "September", { quarter: "2026-Q3" }, binding), layout: { x: 20, y: 0, w: 20, h: 8 } },
    ],
    { groups: [{ id: "g-q", name: "Quarter", paramName: "quarter", groupType: "quarter", value: "2026-Q3" }] },
  );
  await seedAt(page, seed);
  const cards = page.locator(".widget-card").filter({ hasText: "Period echo" });
  const dec = cards.nth(0);
  const sep = cards.nth(1);

  await expect(trigger(dec, "Quarter")).toHaveText("FY2026-Q3");
  await expect(trigger(sep, "Quarter")).toHaveText("FY2026-Q4");
  await expect(echo(dec, "quarter")).toHaveText("2026-Q3");
  await expect(echo(sep, "quarter")).toHaveText("2026-Q4");
  await expect(page.getByText("Quarter · 2026-Q3")).toBeVisible();

  // The September member picks its FY2027-Q1 = Oct–Dec 2026 = calendar 2026-Q4.
  await trigger(sep, "Quarter").click();
  const dialog = page.getByRole("dialog", { name: "Quarter" });
  await dialog.getByRole("button", { name: "Next fiscal year" }).click();
  await dialog.getByRole("button", { name: "FY2027-Q1 (Oct–Dec 2026)" }).click();
  await expect(page.getByText("Quarter · 2026-Q4")).toBeVisible();
  await expect(trigger(dec, "Quarter")).toHaveText("FY2026-Q4");
  await expect(trigger(sep, "Quarter")).toHaveText("FY2027-Q1");
  await expect
    .poll(async () => JSON.parse((await read(page, "dashboards/d1.json"))!).groups[0].value)
    .toBe("2026-Q4");
});

test("a seeded T-1q shows last quarter, and a group holding it gives each member its own", async ({ page }) => {
  const binding = [{ groupId: "g-q", paramName: "quarter" }];
  await seedAt(
    page,
    dashboardSeed(
      [
        { ...echoCard("c-dec", "December", {}, binding), layout: { x: 0, y: 0, w: 20, h: 8 } },
        { ...echoCard("c-jun", "June", {}, binding), layout: { x: 20, y: 0, w: 20, h: 8 } },
      ],
      { groups: [{ id: "g-q", name: "Quarter", paramName: "quarter", groupType: "quarter", value: "T-1q" }] },
    ),
  );
  const cards = page.locator(".widget-card").filter({ hasText: "Period echo" });
  // 26 May 2026: calendar Q2; under June, FY2026-Q4.
  await expect(echo(cards.nth(0), "quarter")).toHaveText("2026-Q2");
  await expect(echo(cards.nth(1), "quarter")).toHaveText("2026-Q4");
  await expect(page.getByText("Quarter · T-1q")).toBeVisible();
});

test("the endpoint source drives a quarter's label, and follows the symbol", async ({ page }) => {
  const lookups = trackQueries(page, "/fiscal_year_end");
  await seedAt(
    page,
    dashboardSeed([
      {
        id: "c-period",
        widgetId: "period_table",
        backendId: "b1",
        params: { symbol: "AAPL", quarter: "T", start_date: "2026-01-01/2026-03-31" },
        layout: { x: 0, y: 0, w: 20, h: 9 },
      },
    ]),
  );
  const card = page.locator(".widget-card").filter({ hasText: "Period Table" });
  await expect(trigger(card, "Quarter")).toHaveText("FY2026-Q4");
  expect(lookups).toContain("?symbol=AAPL");

  const symbol = card.getByLabel("Symbol", { exact: true });
  await symbol.fill("MSFT");
  await symbol.press("Enter");
  await expect(trigger(card, "Quarter")).toHaveText("FY2027-Q1");
  expect(lookups.at(-1)).toBe("?symbol=MSFT");
});

// At 390 px the grid keeps two columns. Actions stay inside each card and
// row-zero controls remain reachable through their native horizontal scroller.
test("narrow viewer: header actions fit and every title control can scroll into view (#13)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install();
  await page.clock.setFixedTime(new Date("2026-10-03T16:00:00Z"));
  const cards: SeedCard[] = [
    echoCard("c-echo", "September"),
    // Date expression defaults to panel-only controls; opt in to its title row here.
    { id: "c-probe", widgetId: "date_probe", backendId: "builtin", params: { expr: "T-1bd", fy_end: "12", as_of: "T" }, hideTitleParams: false, layout: { x: 20, y: 0, w: 14, h: 7 } },
    { id: "c-cal", widgetId: "calendar_table", backendId: "b1", params: { symbol: "AAPL", trade: "T-1bd" }, layout: { x: 0, y: 8, w: 20, h: 9 } },
    { id: "c-fiscal", widgetId: "fiscal_table", backendId: "b1", params: { symbol: "AAPL", asof: "FQ0", quarter: "T", span: "FQ-4/FQ0" }, layout: { x: 20, y: 8, w: 24, h: 9 } },
    { id: "c-quote", widgetId: "quote", backendId: "b1", params: { symbol: "AAPL" }, layout: { x: 0, y: 17, w: 20, h: 9 } },
  ];
  await seedApp(page, dashboardSeed(cards), "/?viewer=d1");
  const echoed = page.locator(".widget-card").filter({ hasText: "Period echo" });
  await expect(trigger(echoed, "Week")).toBeVisible();
  await expect(page.locator(".widget-card")).toHaveCount(5);

  let scrollingCards = 0;
  for (const card of await page.locator(".widget-card").all()) {
    const edge = (await card.boundingBox())!;
    const insideCard = async (control: Locator) => {
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(edge.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(edge.x + edge.width + 1);
    };
    // Scrolled content may extend beyond its viewport, but actions and the
    // viewport itself must never extend outside the card.
    for (const el of await card
      .locator("header > button:visible, .card-controls :is(button, input, select):visible")
      .all()) {
      await insideCard(el);
    }
    const strip = card.locator(".card-chips");
    await expect(strip).toBeVisible();
    await insideCard(strip);
    const size = await strip.evaluate(el => ({ width: el.clientWidth, content: el.scrollWidth, overflow: getComputedStyle(el).overflowX }));
    expect(size.width).toBeGreaterThan(0);
    expect(size.overflow).toBe("auto");
    const controls = strip.locator(":is(button:enabled, input:enabled, select:enabled, [role=spinbutton]):visible");
    expect(await controls.count()).toBeGreaterThan(0);
    let scrolled = false;
    for (const control of await controls.all()) {
      // Native focus scrolls a keyboard user's next control into the strip.
      // Check the actual clipped intersection, not only DOM visibility.
      await control.focus();
      await expect(control).toBeFocused();
      const visible = await control.evaluate(el => {
        const parent = el.closest(".card-chips")!;
        const viewport = parent.getBoundingClientRect();
        const box = el.getBoundingClientRect();
        return { width: Math.min(box.right, viewport.right) - Math.max(box.left, viewport.left), scroll: parent.scrollLeft };
      });
      expect(visible.width).toBeGreaterThan(0);
      scrolled ||= visible.scroll > 0;
    }
    if (size.content > size.width) {
      expect(scrolled).toBe(true);
      scrollingCards++;
    }
  }
  expect(scrollingCards).toBeGreaterThan(0);
  // A long period control also opens its real picker after scrolling.
  await trigger(echoed, "Week").click();
  await expect(page.getByRole("dialog", { name: "Week", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Week", exact: true })).toHaveCount(0);
});
