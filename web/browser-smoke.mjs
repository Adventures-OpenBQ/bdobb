// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Real HTTPS/browser auth smoke test. Synthetic identities and quote data only.
 * Requires the web build, Playwright Chromium and openssl; never calls GitHub.
 *
 * It drives what this line's policy admits (web/policy.mjs, vendored from
 * openbq-docker v8.0.0): the `/api` family, the `/news` family and its one
 * socket, `/state`, `/preview-bootstrap.js`, `/socket-ticket` (which issues for
 * `/news/ws/news` and 404s for anything else) and the static bundle. There is
 * no `/ai` and no `/grid` family, so nothing below fakes one.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { createServer } from "node:https";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { encode } from "@auth/core/jwt";
import { createPreviewServer } from "./server.mjs";
import { socketTicketValid } from "./policy.mjs";
import { readConfig, SESSION_COOKIE } from "./config.mjs";

/** The one approved feed this run is configured with, and the id it maps to. */
const FEED_URL = "https://feeds.example.com/news.xml";
const FEED_ID = 7;

const dir = await mkdtemp(join(tmpdir(), "bdobb-browser-"));
let server, browser;
try {
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"), "-days", "1",
    "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"], { stdio: "ignore" });
  server = createServer({ key: await readFile(join(dir, "key.pem")), cert: await readFile(join(dir, "cert.pem")) });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const origin = `https://localhost:${server.address().port}`;
  const config = readConfig({
    APP_ORIGIN: origin, AUTH_SECRET: randomBytes(32).toString("hex"),
    AUTH_GITHUB_ID: "synthetic-client", AUTH_GITHUB_SECRET: "synthetic-secret",
    SESSION_EPOCH: "browser-test", GITHUB_ALLOWED_USER_IDS: "42",
    BACKEND_GATEWAY_ORIGIN: "https://gateway.example.com",
    BACKEND_GATEWAY_TOKEN: randomBytes(32).toString("base64url"),
    NEWS_APPROVED_FEEDS_JSON: JSON.stringify({ [FEED_URL]: FEED_ID }),
  });
  /** The subscribe reply and one article, in the shapes src/lib/news.ts parses. */
  const feedRecords = { feeds: [{ id: FEED_ID, url: FEED_URL, title: "Example wire", favicon: null }] };
  const article = { id: 1, feed_id: FEED_ID, title: "A headline off the wire",
    link: null, author: null, published_at: null, sort_at: 1_758_000_000 };
  // One /api widget, copied in shape from the live catalogue. No seeded card names it:
  // it is here because `widgets.json` is what the backend is discovered by.
  const quoteCatalogue = {
    equity_price_quote_eodhd_obb: {
      name: "Quote", description: "Current quote for a ticker.", category: "Equity",
      type: "table", endpoint: "/api/v1/equity/price/quote", runButton: false,
      gridData: { w: 40, h: 15 },
      data: { dataKey: "results", table: { showAll: true, columnsDefs: [
        { field: "symbol", headerName: "Symbol", pinned: "left" },
        { field: "price", headerName: "Last" }] } },
      params: [
        { paramName: "symbol", label: "Symbol", type: "text", optional: false, value: null },
        { paramName: "exchange", label: "Exchange", type: "text", optional: true, value: "US" },
        { paramName: "provider", value: "eodhd", show: false },
      ],
    },
  };
  // Every upstream path the relay actually asked for, in order.
  const forwarded = [];
  // The /news/ws/news targets a verifying ticket was presented for.
  const ticketed = [];
  // The gateway's per-user state store, in memory: what the page saves, and is seeded from.
  const saved = new Map();
  const app = createPreviewServer({ config, fetchUpstream: async (url, init = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith("/state/")) {
      const name = parsed.pathname.split("/").slice(3).join("/");
      if (!name) return json({ files: Object.fromEntries(saved) });
      if (init.method === "PUT") saved.set(name, init.body.toString()); else saved.delete(name);
      return new Response(null, { status: 204 });
    }
    forwarded.push(parsed.pathname);
    // The wire's history page, which seeds the card before the socket streams.
    if (parsed.pathname === "/news/api/news") return json({ articles: [article] });
    // The /api manifests are openbq-api's own documents, forwarded as-is.
    if (parsed.pathname === "/api/apps.json") return json([]);
    if (parsed.pathname === "/api/widgets.json") return json(quoteCatalogue);
    return new Response("unrouted", { status: 404 });
  }, connectUpstream: () => {
    // The page's news socket opens on the GATEWAY, on a ticket (the shim), so this
    // same-origin relay is not the path under test here. Fail loudly rather than
    // silently dialling a real wss:// if anything ever reaches it.
    throw new Error("the same-origin relay must not be used: the shim tickets the gateway");
  } });
  function json(body) {
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  }
  server.on("request", (req, res) => app.emit("request", req, res));
  server.on("upgrade", (req, socket, head) => app.emit("upgrade", req, socket, head));
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
  // A mistaken external request must never reach GitHub or a live provider.
  const external = [];
  await context.route("**/*", route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  // The page's news socket does not come back to this server: the socket shim fetches
  // a ticket and opens it on the gateway. This stands in for the gateway -- it admits a
  // socket only on a ticket that verifies against the machine token for exactly the
  // target asked -- and answers with the subscribe reply and one article.
  await context.routeWebSocket(/^wss:\/\/gateway\.example\.com\//, ws => {
    const cut = ws.url().search(/[?&]ticket=/);
    const target = ws.url().slice("wss://gateway.example.com".length, cut);
    if (cut < 0 || !socketTicketValid(config.token, target, ws.url().slice(cut + 8))) return ws.close({ code: 1008 });
    ticketed.push(target);
    ws.onMessage(frame => {
      // The gateway rebuilds the frame from the approved urls (policy.mjs
      // newsSubscription); this checks the page sent exactly one, for the approved feed.
      const sent = JSON.parse(frame);
      if (sent.subscribe?.length !== 1 || sent.subscribe[0].url !== FEED_URL) return ws.close({ code: 1008 });
      ws.send(JSON.stringify(feedRecords));
      ws.send(JSON.stringify(article));
    });
  });
  const page = await context.newPage();
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto(origin);
  assert.equal((await context.request.get(origin + "/api/widgets.json")).status(), 401);
  await page.getByRole("link", { name: "Continue with GitHub" }).click();
  await page.getByRole("button", { name: /Sign in with GitHub/ }).waitFor();
  const value = await encode({
    token: { githubId: "42", epoch: config.epoch, deadline: Date.now() / 1000 + 3600 },
    secret: config.secret, salt: SESSION_COOKIE, maxAge: 3600,
  });
  await context.addCookies([{ name: SESSION_COOKIE, value, domain: "localhost", path: "/",
    secure: true, httpOnly: true, sameSite: "Lax" }]);
  await page.goto(origin);
  // The seed at this line is the built-ins dashboard (web/bootstrap.mjs): no /api
  // card, so the edit-save-reseed round trip runs on the Grouping tab's Parameter
  // echo card (found by its Ticker field: the Note above it names the card in its
  // text), whose Ticker starts at the group's AAPL.
  const grouping = page.getByRole("tab", { name: "Grouping" });
  const echoCard = page.locator(".widget-card")
    .filter({ has: page.getByRole("textbox", { name: "Ticker" }) }).first();
  const echoed = text => echoCard.getByRole("definition").filter({ hasText: new RegExp(`^${text}$`) }).waitFor();
  await grouping.click();
  await echoed("AAPL");
  // The backend was discovered through the relay, the only way the catalogue reaches the page.
  assert.ok(forwarded.includes("/api/widgets.json"), JSON.stringify(forwarded));
  // The notice bar takes 28px off the top of the page, and the app shell is sized
  // from the VIEWPORT (100dvh), not from #root -- so unless the web build gives
  // those 28px back, the shell runs past the bottom and carries the rail's last
  // bottom-pinned row, Help, below the fold. Found 2026-09-20 ("no help on the app").
  const helpBox = await page.getByRole("button", { name: "Help", exact: true }).boundingBox();
  assert.ok(helpBox && helpBox.y + helpBox.height <= page.viewportSize().height,
    `Help is below the fold: ${JSON.stringify(helpBox)} in ${JSON.stringify(page.viewportSize())}`);
  await echoCard.getByRole("textbox", { name: "Ticker" }).fill("MSFT");
  await echoCard.getByRole("textbox", { name: "Ticker" }).press("Enter");
  await echoed("MSFT");
  // "vercel is not saving the configuration" (2026-09-20): the change is mirrored to the
  // signed-in user's state -- the whole store on this first save, the seeded dashboard included.
  for (let i = 0; i < 50 && !saved.get("dashboards/preview.json")?.includes("MSFT"); i++) await new Promise(r => setTimeout(r, 100));
  assert.ok(saved.get("dashboards/preview.json")?.includes("MSFT"), JSON.stringify([...saved.keys()]));
  assert.ok(saved.has("backends.json"), JSON.stringify([...saved.keys()]));
  // The seeded News tab: the approved feed's headline, arriving over a socket the shim
  // opened on the GATEWAY on a ticket that verified, seeded over /news/api/news.
  /* eslint-disable-next-line no-undef */
  assert.equal(await page.evaluate(() => window.__bdobbNewsServer), origin + "/news");
  await page.getByRole("tab", { name: "News", exact: true }).click();
  await page.getByText("A headline off the wire").first().waitFor();
  assert.deepEqual(ticketed, ["/news/ws/news"], JSON.stringify(ticketed));
  assert.ok(forwarded.includes("/news/api/news"), JSON.stringify(forwarded));
  // /news/ws/news is the ONLY target this line will ticket.
  const issued = await context.request.get(origin + "/socket-ticket?for=" + encodeURIComponent("/news/ws/news"));
  assert.equal(issued.status(), 200);
  assert.ok((await issued.json()).url.startsWith("wss://gateway.example.com/news/ws/news?ticket="));
  for (const asked of ["/grid/live_grid_ws", "/news/ws/news?x=1", "/ai/v1/query", "/"]) {
    assert.equal((await context.request.get(origin + "/socket-ticket?for=" + encodeURIComponent(asked))).status(), 404, asked);
  }
  // Back to Grouping: only the ACTIVE tab's cards are mounted.
  await grouping.click();
  await echoed("MSFT");
  // A session that lapses while the app is open (it is a hard one-hour deadline): the next
  // request to this origin answers 401, and the app goes to the sign-in page rather than
  // reporting every backend offline, which is what it did until 2026-09-20.
  const session = await context.cookies();
  await context.clearCookies();
  // Whichever request meets the lapsed session first sends the app to sign-in:
  // usually the refetch this edit triggers, but a debounced state save still
  // pending from the edit above can beat it, and then the page is already
  // leaving while the fill waits on its input. Either way is the behaviour
  // under test, so the edit is best-effort and the sign-in page is the assertion.
  const signedOut = page.waitForURL(/\/auth\/signin/);
  await echoCard.getByRole("textbox", { name: "Ticker" }).fill("NVDA", { timeout: 5000 })
    .then(() => echoCard.getByRole("textbox", { name: "Ticker" }).press("Enter", { timeout: 5000 }))
    .catch(() => {});
  await signedOut;
  await context.addCookies(session);
  await page.goto(origin);
  await grouping.click();
  await echoed("MSFT");
  assert.ok(!saved.get("dashboards/preview.json").includes("NVDA"));
  await page.getByRole("link", { name: "Sign out", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("link", { name: "Continue with GitHub" }).waitFor();
  assert.equal((await context.cookies()).filter(c => c.name === SESSION_COOKIE).length, 0);
  assert.equal((await context.request.get(origin + "/api/widgets.json")).status(), 401);
  await page.setViewportSize({ width: 375, height: 812 });
  // Runs in the page's browser context, not this Node process: window is a
  // page global there, not a lint violation.
  /* eslint-disable no-undef */
  assert.equal(await page.evaluate(
    () => window.document.documentElement.scrollWidth > window.innerWidth), false);
  /* eslint-enable no-undef */
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log("PASS: HTTPS login form, private assets, forwarded /api catalogue, seeded built-ins dashboard, per-user state saved + reseeded on reload, the News card's wire over a ticketed gateway socket plus its /news/api/news seed, the ticket route refusing every other target, lapsed session goes to sign-in, CSRF logout, mobile login; no external requests.");
} finally {
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await rm(dir, { recursive: true, force: true });
}
