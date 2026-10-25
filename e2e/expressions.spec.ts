// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Locator, type Page } from "@playwright/test";
import { dashboardSeed, read, seedApp, type SeedCard, type SeedFiles } from "./fixtures";

/**
 * Wednesday 26 Aug 2026, 09:30 New York — the clock every other period spec
 * runs under. The mock's XNYS calendar closes Tuesday the 25th, so one
 * business day back from T is Monday the 24th on the backend's calendar and
 * Tuesday the 25th on the bundled NYSE file.
 */
const NOW = new Date("2026-08-26T13:30:00Z");

test.use({ timezoneId: "America/New_York" });

async function seedAt(page: Page, files: SeedFiles): Promise<void> {
  await page.clock.install();
  await page.clock.setFixedTime(NOW);
  await seedApp(page, files);
}

/** Every GET to `pathname`, in order, as its query string. */
function trackQueries(page: Page, pathname: string): string[] {
  const seen: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname === pathname && req.method() === "GET") seen.push(url.search);
  });
  return seen;
}

const calendarCard: SeedCard = {
  id: "c-cal",
  widgetId: "calendar_table",
  backendId: "b1",
  params: { symbol: "AAPL", trade: "T-1bd" },
  layout: { x: 0, y: 0, w: 20, h: 9 },
};

const echoCard: SeedCard = {
  id: "c-echo",
  widgetId: "period_echo",
  backendId: "builtin",
  params: { fy_end: "December", quarter: "T", fiscal_year: "T", week: "T", asof: "T", start_date: "2026-01-01/T", session: "09:30:00" },
  layout: { x: 0, y: 0, w: 24, h: 8 },
};

const echo = (card: Locator, name: string) => card.locator(`dd[aria-label="${name}"]`);
const trigger = (card: Locator, label: string) => card.getByRole("button", { name: label, exact: true });
/**
 * The badges by accessible-name prefix: each badge's name is its whole
 * tooltip ("Expression <expr>, resolves now to …" / "Fallback calendar:
 * <reason>"), so an exact name would pin the resolved value and the reason
 * into every lookup. The full text is asserted separately where it matters.
 */
const exprBadge = (card: Locator) => card.getByRole("img", { name: /^Expression / });
const warnBadge = (card: Locator) => card.getByRole("img", { name: /^Fallback calendar/ });

test("a bd expression steps over the backend calendar's closure, with no fallback badge", async ({ page }) => {
  const calendars = trackQueries(page, "/api/v1/calendar/trading");
  const rows = trackQueries(page, "/calendar_rows");
  await seedAt(page, dashboardSeed([calendarCard]));
  const card = page.locator(".widget-card").filter({ hasText: "Calendar Table" });

  await expect(card.getByRole("cell", { name: "2026-08-24", exact: true })).toBeVisible();
  // Every send waited for the calendar: none went out with the weekday-only 2026-08-25.
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.map((q) => new URLSearchParams(q).get("trade"))).toEqual(rows.map(() => "2026-08-24"));
  // The current and previous year were asked for up front, on the card's own backend.
  expect(calendars).toContain("?exchange=XNYS&year=2026");
  expect(calendars).toContain("?exchange=XNYS&year=2025");
  await expect(exprBadge(card)).toBeVisible();
  await expect(exprBadge(card)).toHaveAttribute(
    "title",
    "Expression T-1bd, resolves now to 2026-08-24, updates when the card refreshes",
  );
  await expect(warnBadge(card)).toHaveCount(0);
});

test("a backend without the calendar route falls back to the bundled NYSE file and shows the ⚠ badge", async ({ page }) => {
  // The same backend, with the route taken away: what a backend that never
  // had it looks like from the card. Installed before seedApp, since the
  // hook asks during the card's first render.
  await page.route("**/api/v1/calendar/trading*", (route) => route.fulfill({ status: 404, contentType: "application/json", body: '{"detail":"Not Found"}' }));
  const rows = trackQueries(page, "/calendar_rows");
  await seedAt(page, dashboardSeed([calendarCard]));
  const card = page.locator(".widget-card").filter({ hasText: "Calendar Table" });

  await expect(card.getByRole("cell", { name: "2026-08-25", exact: true })).toBeVisible();
  expect(new URLSearchParams(rows.at(-1)).get("trade")).toBe("2026-08-25");
  const warn = warnBadge(card);
  await expect(warn).toBeVisible();
  await expect(warn).toHaveAttribute("title", "Fallback calendar: No trading calendar for XNYS on this backend; using the bundled NYSE calendar");
});

test("the Relative tab applies a preset, the echo shows it, the badge appears, and a saved preset persists", async ({ page }) => {
  await seedAt(page, dashboardSeed([echoCard]));
  const card = page.locator(".widget-card").filter({ hasText: "Period echo" });
  await expect(echo(card, "start_date")).toHaveText("2026-01-01");

  await trigger(card, "Range").click();
  const dialog = page.getByRole("dialog", { name: "Range" });
  // The seeded "2026-01-01/T" is itself an expression (its end is T), so the
  // popover opens on Relative (spec §4: "Opening a control whose value is an
  // expression lands on Relative"), not on Absolute.
  await expect(dialog.getByRole("tab", { name: "Relative" })).toHaveAttribute("aria-selected", "true");
  await dialog.getByRole("button", { name: "Last 7 days" }).click();
  await expect(dialog.getByText("resolves now to 2026-08-19 – 2026-08-26")).toBeVisible();
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(dialog).toHaveCount(0);

  await expect(echo(card, "start_date")).toHaveText("2026-08-19");
  await expect(echo(card, "end_date")).toHaveText("2026-08-26");
  await expect(trigger(card, "Range")).toHaveText("2026-08-19 – 2026-08-26");
  // Narrowed to this expression: every `T` param on the echo carries its own ◷.
  const badge = card.getByRole("img", { name: /^Expression \$currentDate-7d\/\$currentDate, / });
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute(
    "title",
    "Expression $currentDate-7d/$currentDate, resolves now to 2026-08-19/2026-08-26, updates when the card refreshes",
  );
  await expect
    .poll(async () => JSON.parse((await read(page, "dashboards/d1.json"))!).tabs[0].cards[0].params.start_date)
    .toBe("$currentDate-7d/$currentDate");

  // Reopening lands on Relative with the rows loaded; save it under a name.
  await trigger(card, "Range").click();
  await expect(dialog.getByRole("tab", { name: "Relative" })).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByLabel("Range start offset 1 amount")).toHaveValue("7");
  await dialog.getByRole("button", { name: "Save as preset" }).click();
  await dialog.getByLabel("Preset name").fill("Week back");
  await dialog.getByLabel("Preset name").press("Enter");
  // exact: the chip's × is "Delete preset Week back", which a substring match also finds.
  const saved = dialog.getByRole("button", { name: "Week back", exact: true });
  await expect(saved).toBeVisible();
  await expect
    .poll(async () => JSON.parse((await read(page, "dashboards/d1.json"))!).presets)
    .toEqual([{ name: "Week back", expr: "$currentDate-7d/$currentDate" }]);
  await dialog.getByRole("button", { name: "Delete preset Week back" }).click();
  await expect(saved).toHaveCount(0);
  await expect
    .poll(async () => JSON.parse((await read(page, "dashboards/d1.json"))!).presets ?? [])
    .toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("a quarter's Relative tab under a June year end: FQ-4 reads as the same quarter a year earlier", async ({ page }) => {
  await seedAt(page, dashboardSeed([{ ...echoCard, params: { ...(echoCard.params as Record<string, string>), fy_end: "June" } }]));
  const card = page.locator(".widget-card").filter({ hasText: "Period echo" });
  // 26 Aug 2026 under a June year end is FY2027-Q1.
  await expect(trigger(card, "Quarter")).toHaveText("FY2027-Q1");
  await trigger(card, "Quarter").click();
  const dialog = page.getByRole("dialog", { name: "Quarter" });
  await dialog.getByRole("tab", { name: "Relative" }).click();
  await dialog.getByRole("button", { name: "Fiscal YoY" }).click();
  await expect(dialog.getByText("resolves now to 2026-Q1")).toBeVisible();
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(echo(card, "quarter")).toHaveText("2026-Q1");
  await expect(trigger(card, "Quarter")).toHaveText("FY2026-Q1");
});
