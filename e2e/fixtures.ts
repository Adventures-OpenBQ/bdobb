// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, type Page } from "@playwright/test";

export const MOCK_URL = `http://127.0.0.1:${process.env.BDOBB_MOCK_PORT ?? 4174}`;

/**
 * A request to the mock backend that only discovers it -- widgets.json,
 * apps.json, the GET / service probe and the provider-key status -- rather
 * than fetching a widget's data. "No source acquisition" assertions skip
 * these (#11): discovery runs whenever the app boots or refreshes.
 */
export function isDiscoveryRequest(url: string): boolean {
  return ["/", "/widgets.json", "/apps.json", "/keys"].includes(new URL(url).pathname);
}

/** Files as the app would find them under its app-data dir. Keys are memfs paths. */
export type SeedFiles = Record<string, string>;

/**
 * The app reads settings/backends/dashboards from memfs at boot, so the seed
 * must land before any app module evaluates -- addInitScript runs on every
 * navigation before the page's own scripts. settings.json seeds as "{}"
 * because the loader merges a partial file over DEFAULT_SETTINGS; a spec
 * overrides only the fields it needs.
 */
export function defaultSeed(): SeedFiles {
  const backends = [
    { id: "b1", name: "Mock", baseUrl: MOCK_URL, authLocation: "header", validateWidgets: false },
  ];
  const dashboard = {
    id: "d1",
    name: "Main",
    tabs: [{ id: "t1", name: "Main", cards: [...DEFAULT_CARDS] }],
  };
  return {
    "settings.json": "{}",
    "backends.json": JSON.stringify(backends),
    "dashboards/d1.json": JSON.stringify(dashboard),
  };
}

/**
 * One card as the dashboard file holds it. Deliberately loose: a seed is
 * what the app will FIND on disk, including shapes an older version wrote,
 * so it is not a type-checked DashboardCard.
 */
export type SeedCard = Record<string, unknown>;

/** The two cards the default dashboard's only tab carries. */
export const DEFAULT_CARDS: SeedCard[] = [
  { id: "c-quote", widgetId: "quote", backendId: "b1", params: { symbol: "AAPL" }, layout: { x: 0, y: 0, w: 20, h: 9 } },
  { id: "c-prices", widgetId: "prices", backendId: "b1", params: { symbol: "AAPL" }, layout: { x: 20, y: 0, w: 20, h: 12 } },
];

/**
 * The default seed with the dashboard's only tab holding exactly `cards`.
 * `over` patches the dashboard itself (`groups`, or a whole `tabs` array) and
 * is applied last, so it wins over the tab this builds.
 *
 * Spread `[...DEFAULT_CARDS, extra]` to ADD a card to the default pair — the
 * seeded `c-quote` is the control several specs measure their card against.
 */
export function dashboardSeed(cards: SeedCard[], over: Record<string, unknown> = {}): SeedFiles {
  const seed = defaultSeed();
  const base = JSON.parse(seed["dashboards/d1.json"]!) as {
    tabs: { id: string; name: string; cards: SeedCard[] }[];
  };
  const dashboard = { ...base, tabs: [{ ...base.tabs[0], cards }], ...over };
  return { ...seed, "dashboards/d1.json": JSON.stringify(dashboard) };
}

/** dashboardSeed, seeded and navigated to. `extraFiles` may override a seeded file. */
export function seedCards(
  page: Page,
  cards: SeedCard[],
  extraFiles: SeedFiles = {},
): Promise<void> {
  return seedApp(page, { ...dashboardSeed(cards), ...extraFiles });
}

/**
 * memfs, as the page's own shim sees it: what the app actually wrote, read
 * back from inside the browser. `opened` is every url the opener shim was
 * asked for. Window.__bdobb is declared by src/browser-shim/registry.ts.
 */
export function memfs(page: Page) {
  return {
    read: (path: string) => page.evaluate((p) => window.__bdobb!.read!(p), path),
    list: () => page.evaluate(() => window.__bdobb!.list!()),
    opened: () => page.evaluate(() => window.__bdobb!.opened),
  };
}

/** The one memfs call most specs want. */
export const read = (page: Page, path: string): Promise<string | undefined> =>
  memfs(page).read(path);

export async function seedApp(
  page: Page,
  files: Record<string, string | number[]> = defaultSeed(),
  path = "/",
): Promise<void> {
  await page.addInitScript((seed) => {
    // Window.__bdobbSeed is declared by src/browser-shim/registry.ts.
    window.__bdobbSeed = seed;
  }, files);
  // `path` is how the viewer route is reached: the second window is the same
  // bundle at `/?viewer=<id>`, and browser mode honours the same query string.
  // Headless Chromium on Linux puts the pointer at (0,0) on every new
  // document — over the rail — so the rail hover-expands as it mounts and,
  // with no pointer movement, never collapses; its expanded width then
  // intercepts every click near the left edge.
  //
  // seedApp's real contract: it returns after `load`, after the pointer has
  // been parked away from the rail, and — on routes that have a rail — only
  // once the rail has actually finished collapsing to its rest width. The
  // rail's hover-out is not instant: a 300ms `useHoverPanel` delay plus a
  // 120ms width transition, so `data-expanded="false"` can be true for
  // ~110ms before the measured width is. Waiting on the *width* is what
  // makes the wait real.
  //
  // Because of that, seedApp is NOT safe to treat as returning at `load`.
  // Any request tracker (`page.on("request"|"response")`, `trackSymbols`, …)
  // MUST be installed BEFORE calling seedApp, not on the line after it — the
  // card's first mount fetch can and does go out before this function
  // returns.
  await page.goto(path);
  await page.mouse.move(640, 400);
  if (await page.locator("nav.left-rail").count()) {
    // The rest width is `--rail-width`, which App.tsx sets from the
    // (user-configurable) `railWidth` setting -- not always the stylesheet's
    // 48px default (layout.spec.ts seeds 80). Read it live rather than
    // hardcoding 48, so a spec's own custom rail width isn't fought here.
    const restWidth = await page.evaluate(
      () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--rail-width")) || 48,
    );
    await expect
      .poll(
        async () => (await page.locator("nav.left-rail").boundingBox())?.width ?? restWidth,
        { timeout: 5000 },
      )
      .toBeLessThanOrEqual(restWidth);
  }
}

/** The rail is 48px wide at rest and expands on hover; its buttons are clickable once expanded. */
export async function openRail(page: Page): Promise<void> {
  await page.hover("nav.left-rail");
  await page.locator("nav.left-rail[data-expanded='true']").waitFor();
}

export async function openSettings(page: Page): Promise<void> {
  await openRail(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("dialog", { name: "Settings" }).waitFor();
}

export async function openSettingsTab(
  page: Page,
  name: "General" | "Widget" | "Layout" | "Provider API Keys" | "Logs",
): Promise<void> {
  await openSettings(page);
  await page.getByRole("tab", { name }).click();
}

export async function openAILibrary(page: Page): Promise<void> {
  await openRail(page);
  await page.getByRole("button", { name: "AI Library" }).click();
  await page.getByRole("dialog", { name: "AI Library" }).waitFor();
}
