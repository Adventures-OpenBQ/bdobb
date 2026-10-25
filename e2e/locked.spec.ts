// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// v8 locked widgets, ported from the donor's e2e/locked.spec.ts (5ee2e8b4:
// 71841667, 1fe4ecc0) onto clean's chrome: the card menu is the portalled
// MenuPanel (its items are on the page, not in the card), the rail's
// Parameters item is clean's docked panel, and Settings closes with Cancel.
import { expect, test, type Page } from "@playwright/test";
import { MOCK_URL, openRail, openSettingsTab, read, seedApp, type SeedFiles } from "./fixtures";

/** Two dashboards, each one empty tab, so switching proves the band is app-wide. */
function twoDashboards(): SeedFiles {
  const backends = [{ id: "b1", name: "Mock", baseUrl: MOCK_URL, authLocation: "header", validateWidgets: false }];
  const d = (id: string, name: string) => JSON.stringify({ id, name, tabs: [{ id: `${id}-t1`, name: "Main", cards: [] }] });
  return {
    "settings.json": "{}",
    "backends.json": JSON.stringify(backends),
    "dashboards/d1.json": d("d1", "Alpha"),
    "dashboards/d2.json": d("d2", "Beta"),
  };
}

const article = (id: number, feed_id: number, title: string) => ({
  id,
  feed_id,
  title,
  link: `https://story.example/${id}`,
  author: null,
  published_at: null,
  sort_at: 1_756_800_000 + id,
});

/**
 * The ticker, faked at the page's edge as e2e/news.spec.ts does. The counter
 * is the remount detector: useNewsWire opens one socket per mount, so a band
 * that survived the dashboard switch never opened a second one.
 */
async function fakeTicker(page: Page): Promise<{ count: number }> {
  const connections = { count: 0 };
  await page.routeWebSocket(`${MOCK_URL.replace(/^http/, "ws")}/ws/news`, (ws) => {
    connections.count += 1;
    ws.onMessage((raw) => {
      const frame = JSON.parse(String(raw)) as { subscribe?: { url: string; name?: string }[] };
      if (!frame.subscribe) return;
      ws.send(JSON.stringify({ feeds: frame.subscribe.map((f, i) => ({ id: i + 1, url: f.url, title: f.name ?? null, favicon: null })) }));
      ws.send(JSON.stringify(article(3, 1, "Pushed: Fed holds")));
    });
  });
  await page.route(`${MOCK_URL}/api/news*`, (route) =>
    route.fulfill({ json: { articles: [article(1, 1, "Rates hold steady")], next_cursor: null } }),
  );
  return connections;
}

test("the RSS Aggregator locked at the bottom stays there across dashboards; Cancel undoes an edit; the viewer shows it", async ({ page }) => {
  const connections = await fakeTicker(page);
  await seedApp(page, twoDashboards());

  await openSettingsTab(page, "Locked Widgets");
  await expect(page.getByText("No widgets")).toHaveCount(2);
  await page.getByRole("button", { name: "Locked at Bottom…" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toHaveCount(0);
  // A panel over the dashboard with a blank, band-sized canvas; the live band
  // itself is not shown while its edge is being edited.
  const editor = page.getByRole("dialog", { name: "Editing Locked at Bottom" });
  await expect(editor).toBeVisible();
  await expect(page.locator(".dock-band-bottom")).toHaveCount(0);
  await expect(editor.locator(".dock-canvas-bottom").getByText("Add a widget with ⌘K.")).toBeVisible();

  // ⌘K adds to the band being edited, as the editor's + does.
  await page.keyboard.press("Meta+k");
  const overlay = page.getByRole("dialog", { name: "Widget library" });
  await overlay.waitFor();
  // The second click of a double-click adds and closes the library, back to
  // the editor, which is still open.
  await overlay.getByRole("button", { name: "Add News" }).dblclick();
  await expect(overlay).toHaveCount(0);
  await expect(page.locator(".dock-edit-bar")).toHaveCount(1);
  const rail = page.locator(".widget-card.card-rail").first();
  await expect(rail).toBeVisible();
  await expect(editor.locator(".widget-card.card-rail")).toHaveCount(1);

  // Full chrome while editing: Parameters is on the menu.
  await rail.getByRole("button", { name: "Card menu" }).click();
  await page.getByRole("menuitem", { name: "Parameters" }).click();
  const server = rail.getByLabel("RSS Aggregator Server", { exact: true });
  await server.fill(MOCK_URL);
  await server.press("Enter");

  // One feed, so the wire connects -- that socket is what proves below that
  // the switch did not remount the card.
  await rail.getByRole("button", { name: "Card menu" }).click();
  await page.getByRole("menuitem", { name: "Configure feeds…" }).click();
  const feeds = page.getByRole("dialog", { name: "Configure feeds" });
  await feeds.getByRole("button", { name: "Add feed" }).click();
  await feeds.getByRole("textbox", { name: "Feed 1 source" }).fill("https://a.example/feed");
  await feeds.getByRole("textbox", { name: "Feed 1 name" }).fill("Wire");
  await feeds.getByRole("button", { name: "Done" }).click();
  await expect(rail.locator(".news-title")).toHaveText(["Pushed: Fed holds", "Rates hold steady"]);

  // Escape belongs to the innermost thing open: dismissing the card's menu
  // must not also reach the editor's Cancel and end the edit.
  await rail.getByRole("button", { name: "Card menu" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.locator(".dock-edit-bar")).toHaveCount(1);

  await editor.getByRole("button", { name: "Taller" }).click();
  await editor.getByRole("button", { name: "OK" }).click();
  await expect(page.locator(".dock-edit-bar")).toHaveCount(0);
  // OK hands the card from the canvas to the live band (a remount, so one
  // more socket); from here on it must never remount again.
  await expect(page.locator(".dock-band-bottom .widget-card.card-rail")).toBeVisible();
  await expect(page.locator(".dock-band-bottom .news-title").first()).toBeVisible();
  const opened = connections.count;

  const docksFile = async () => JSON.parse((await read(page, "dashboards/docks.json")) ?? "null");
  await expect.poll(docksFile).toMatchObject({ hidden: true, dockRows: { bottom: 9 } });
  const docks = await docksFile();
  expect(docks.tabs[1].id).toBe("bottom");
  expect(docks.tabs[1].cards[0].params.url).toBe(MOCK_URL);
  expect(docks.tabs[1].cards[0].news.feeds).toEqual([{ url: "https://a.example/feed", name: "Wire", tab: "" }]);
  // Never a rail dashboard.
  await expect(page.locator("nav.left-rail button.rail-item", { hasText: "Locked widgets" })).toHaveCount(0);

  // Locked chrome: no Parameters, Configure feeds… or Close.
  await rail.getByRole("button", { name: "Card menu" }).click();
  await expect(page.getByRole("menuitem", { name: /^Parameters|^Hide parameters/ })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Configure feeds…" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Close" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Maximize" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: "Maximize" })).toHaveCount(0);

  // Switch dashboards: the same band, never remounted -- its articles are
  // still there and no further socket was opened.
  await openRail(page);
  const beta = page.locator("nav.left-rail button.rail-item", { hasText: "Beta" });
  await beta.click();
  await expect(beta).toHaveAttribute("aria-current", "true");
  await page.mouse.move(640, 400);
  await expect(rail).toBeVisible();
  await expect(rail.locator(".news-title")).toHaveText(["Pushed: Fed holds", "Rates hold steady"]);
  expect(connections.count).toBe(opened);

  // Cancel undoes: remove the card in the editor, Cancel, it is back.
  await openSettingsTab(page, "Locked Widgets");
  await expect(page.getByText("1 widget: RSS Aggregator")).toBeVisible();
  await page.getByRole("button", { name: "Locked at Bottom…" }).click();
  await rail.getByRole("button", { name: "Card menu" }).click();
  await page.getByRole("menuitem", { name: "Close" }).click();
  await expect(page.locator(".dock-canvas-bottom").getByText("Add a widget with ⌘K.")).toBeVisible();
  await page.locator(".dock-edit-bar").getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".dock-edit-bar")).toHaveCount(0);
  // Cancel goes back to Settings, on the Locked Widgets section.
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("tab", { name: "Locked Widgets" })).toHaveAttribute("aria-selected", "true");
  await settings.getByRole("button", { name: "Cancel" }).click();
  await expect(settings).toHaveCount(0);
  await expect(rail).toBeVisible();
  await expect.poll(async () => (await docksFile()).tabs[1].cards.length).toBe(1);

  // No top band, and the viewer shows the bottom one read-only.
  await expect(page.locator(".dock-band-top")).toHaveCount(0);
  await seedApp(page, { ...twoDashboards(), "dashboards/docks.json": (await read(page, "dashboards/docks.json")) ?? "" }, "/?viewer=d1");
  const viewed = page.locator("main.dashboard-area-viewer .dock-band-bottom .widget-card.card-rail");
  await expect(viewed).toBeVisible();
  await viewed.getByRole("button", { name: "Card menu" }).click();
  await expect(page.getByRole("menuitem", { name: /^Parameters/ })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Close" })).toHaveCount(0);
  await expect(page.locator(".dock-edit-bar")).toHaveCount(0);
});

// Donor 55fe838f's round trip, through clean's runAppsImport: Export all
// dashboards… carries the docks in the v8 envelope; importing it where the
// docks are empty brings them back without asking.
test("Export all dashboards… carries the locked widgets, and Import apps.json… brings them back", async ({ page }) => {
  const docks = {
    id: "docks",
    name: "Locked widgets",
    hidden: true,
    tabs: [
      { id: "top", name: "Locked at Top", cards: [{ id: "n1", widgetId: "note", backendId: "builtin", params: {}, title: "Pinned note", layout: { x: 0, y: 0, w: 10, h: 4 } }] },
      { id: "bottom", name: "Locked at Bottom", cards: [] },
    ],
    dockRows: { top: 5, bottom: 8 },
  };
  await seedApp(page, { ...twoDashboards(), "dashboards/docks.json": JSON.stringify(docks) });
  await expect(page.locator(".dock-band-top .widget-card")).toHaveCount(1);

  const section = page.locator("nav.left-rail [data-testid='rail-section-label']", { hasText: "My Dashboards" });
  await openRail(page);
  await section.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Export all dashboards…" }).click();
  await expect(page.getByRole("status")).toContainText("Exported 2 dashboards and the locked widgets.");
  // The browser save shim answers /exports/<suggested name>.
  const file = await read(page, "exports/All dashboards.apps.json");
  expect(file).toBeDefined();
  const apps = JSON.parse(file!);
  expect(apps.map((a: { name: string }) => a.name)).toEqual(["Alpha", "Beta", "Locked widgets"]);
  expect(apps[2].extensions.bdobb).toMatchObject({ profile: "v8", docks: { rows: { top: 5, bottom: 8 } } });

  // A fresh install with no locked widgets and no dashboard of those names:
  // import the file back.
  const fresh = twoDashboards();
  delete fresh["dashboards/d1.json"];
  delete fresh["dashboards/d2.json"];
  await seedApp(page, { ...fresh, "imports/apps.json": file! });
  await expect(page.locator(".dock-band-top")).toHaveCount(0);
  await openRail(page);
  await section.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Import apps.json…" }).click();
  await expect(page.getByRole("status")).toHaveText("Imported 2 dashboards, 0 cards, and replaced your locked widgets");
  await expect(page.locator(".dock-band-top .widget-card")).toHaveCount(1);
  await expect(page.locator(".dock-band-top .card-title")).toHaveText("Pinned note");
});
