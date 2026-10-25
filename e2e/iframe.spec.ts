// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Page } from "@playwright/test";
import { dashboardSeed, MOCK_URL, seedApp } from "./fixtures";

/** Every request the page made to `pathname`, in order, as its `symbol` value. */
function trackSymbols(page: Page, pathname: string): string[] {
  const seen: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname === pathname && req.method() === "GET") {
      seen.push(url.searchParams.get("symbol") ?? "");
    }
  });
  return seen;
}

/**
 * The default dashboard with the `embed` iframe card and the seed's own
 * `c-quote` card in ONE ParamGroup on `symbol`, over a backend that actually
 * carries a credential -- authHeaders answers {} without one, and an empty
 * map is on its own enough to stop openbb-auth ever being sent, which would
 * make the auth assertion below prove nothing.
 */
function iframeSeed() {
  const backends = [
    {
      id: "b1",
      name: "Mock",
      baseUrl: MOCK_URL,
      headerName: "X-Fixture-Key",
      headerValue: "fixture-token",
      authLocation: "header",
      validateWidgets: false,
    },
  ];
  const seed = dashboardSeed(
    [
      {
        id: "c-quote",
        widgetId: "quote",
        backendId: "b1",
        params: { symbol: "AAPL" },
        groupIds: ["g1"],
        layout: { x: 0, y: 0, w: 20, h: 9 },
      },
      {
        id: "c-embed",
        widgetId: "embed",
        backendId: "b1",
        params: { symbol: "AAPL" },
        groupIds: ["g1"],
        layout: { x: 0, y: 9, w: 20, h: 12 },
      },
      // The srcdoc half of the split, on the same dashboard and the same
      // backend: same credential available, opposite sandbox, opposite outcome.
      {
        id: "c-embed-html",
        widgetId: "embed_html",
        backendId: "b1",
        params: { symbol: "AAPL" },
        groupIds: ["g1"],
        layout: { x: 0, y: 21, w: 20, h: 12 },
      },
    ],
    { groups: [{ id: "g1", name: "Ticker", paramName: "symbol", value: "AAPL" }] },
  );
  return { ...seed, "backends.json": JSON.stringify(backends) };
}

/** The framed fixture page. One iframe card on this dashboard, so no filter. */
const embed = (page: Page) => page.frameLocator('iframe[title="Embedded page"]');

/** The srcdoc HTML widget's frame. One html card on this dashboard. */
const embedHtml = (page: Page) => page.frameLocator('iframe[title="Widget content"]');

test("the framed page is answered with the card's current params when it connects", async ({
  page,
}) => {
  await seedApp(page, iframeSeed());

  // The page posted openbb-connect on load; this is bdobb's reply. Its
  // arrival is also what proves the listener was registered before the frame
  // finished loading, and that event.source matched.
  await expect(embed(page).locator("#got")).toContainText("openbb-params-update");
  await expect(embed(page).locator("#got")).toContainText('"symbol":"AAPL"');
});

test("a params update from the framed page moves the group, and the sibling table refetches", async ({
  page,
}) => {
  const quotes = trackSymbols(page, "/quote");
  await seedApp(page, iframeSeed());
  const button = embed(page).locator("#set-msft");
  await expect(button).toBeVisible();
  await expect.poll(() => quotes.length).toBeGreaterThan(0);

  await button.click();

  // The sibling card was never touched: its params moved because the GROUP
  // did, exactly as a parameter-panel edit or a cell click moves it.
  await expect.poll(() => quotes.at(-1)).toBe("MSFT");
  // ...and the page is told what it changed things to, on the params effect.
  await expect(embed(page).locator("#got")).toContainText('"symbol":"MSFT"');
});

test("the cross-origin src frame receives the backend's credential, and it never reaches the DOM", async ({
  page,
}) => {
  await seedApp(page, iframeSeed());

  // SRC_FRAME_SANDBOX grants allow-same-origin, so this frame keeps its own
  // real origin (the mock backend's) and its openbb-connect arrives with that
  // origin named. It matches originOf(src), the backend does carry a
  // credential, so bdobb replies -- targeted at that origin and at nothing
  // else. This is the whole point of the split.
  await expect(embed(page).locator("#got")).toContainText("openbb-auth");

  // What arrived, proven WITHOUT rendering it: the header name, and the length
  // of its value. "fixture-token" is 13 characters. The fixture page is built
  // never to put a header VALUE in its DOM (see EMBED_PAGE), so no credential
  // sits in a page a screenshot or a Playwright trace can read.
  await expect(embed(page).locator("#auth")).toHaveText("X-Fixture-Key:13");

  // Belt and braces, on the frame's whole body and on the app's own page: the
  // value itself is nowhere in either document.
  await expect(embed(page).locator("body")).not.toContainText("fixture-token");
  await expect(page.locator("body")).not.toContainText("fixture-token");
});

test("the app document refuses to be framed", async ({ page, baseURL }) => {
  // SRC_FRAME_SANDBOX keeps allow-same-origin, and that grant survives the
  // framed page navigating ITSELF -- including to this app's own http origin
  // (localhost:1420 in dev, tauri.localhost for Tauri on Windows), which would
  // put a widget page inside the app's origin with the app's DOM and stores in
  // reach. frame-ancestors 'none' is what makes that navigation render
  // nothing. Asserted on the served response, because the sandbox attribute
  // cannot express it and the header is the only thing that does.
  const res = await page.request.get(baseURL ?? "/");
  expect(res.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
});

test("auth is never sent to a srcdoc html widget", async ({ page }) => {
  await seedApp(page, iframeSeed());

  // Waited for first: this is the connect REPLY, so the listener demonstrably
  // ran, identified this frame and evaluated the auth branch. Asserting the
  // absence of openbb-auth without it would pass on a listener that never
  // fired at all.
  await expect(embedHtml(page).locator("#got")).toContainText("openbb-params-update");

  // Same dashboard, same backend, same credential in hand -- and no auth,
  // because this frame is sandboxed with FRAME_SANDBOX and has no origin of
  // its own. `src` is absent, so the hook never even computes an origin to
  // match. bdobb refuses to hand a credential to a frame that cannot say
  // which origin it is: the design's rule, working.
  const got = embedHtml(page).locator("#got");
  await expect(got).not.toContainText("openbb-auth");
  await expect(embedHtml(page).locator("body")).not.toContainText("X-Fixture-Key");
  await expect(embedHtml(page).locator("body")).not.toContainText("fixture-token");
});
