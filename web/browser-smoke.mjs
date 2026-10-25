// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Real HTTPS/browser auth smoke test. Synthetic identities and quote data only.
 * Requires the web build, Playwright Chromium and openssl; never calls GitHub.
 *
 * It drives what this line's policy admits (web/policy.mjs, vendored from
 * openbq-docker v10.0.0): the `/api` family, the `/news` family and its socket,
 * live-grid's `/grid` family and its socket (Ep. 10, donor c183f880), `/state`,
 * `/preview-bootstrap.js`, `/socket-ticket` (which issues for the policy's
 * socket targets and 404s for anything else), the static bundle and, with
 * PREVIEW_RITA, `/ai` (Rita's document and one streamed turn) and with PREVIEW_MCP, `/mcp`. The gateway is faked at the page's edge: it admits a socket only on
 * a ticket that verifies for exactly its target, once (the gateway's single
 * use), and re-validates every grid frame as the gateway does.
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
import { liveGridSubscription, socketTicketNonce } from "./policy.mjs";
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
    PREVIEW_RITA: "true",
    PREVIEW_MCP: "true",
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
  // live-grid's quote grid, cut down from its widgets.json (openbq-docker v10.0.0
  // live-grid/widgets.json `live_grid`): the identity column and the price.
  const gridCatalogue = {
    live_grid: {
      name: "Live quotes", description: "Real-time prices.", category: "Live",
      type: "live_grid", endpoint: "live_grid", wsEndpoint: "live_grid_ws",
      gridData: { w: 40, h: 12 },
      data: { wsRowIdColumn: "symbol", table: { showAll: false, columnsDefs: [
        { field: "symbol", headerName: "Symbol", pinned: "left" },
        { field: "price", headerName: "Last" }] } },
      params: [{ paramName: "symbol", label: "Symbols", type: "text", value: "AAPL" }],
    },
  };
  // Every upstream path the relay actually asked for, in order.
  const forwarded = [];
  // The socket targets a verifying ticket was presented for, and the nonces the fake
  // gateway has admitted (single use, as the gateway's own `admitted` map).
  const ticketed = [];
  const admitted = new Set();
  // Every grid frame the fake gateway received, rebuilt as the gateway rebuilds it.
  const gridFrames = [];
  // Every JSON-RPC message that reached the door's /mcp, with its session and principal.
  const mcpMessages = [];
  // What reached the door's /ai/v1/query: the gateway headers and the body the page sent.
  const ritaQueries = [];
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
    // live-grid's own documents and its snapshot, through the door's /grid family.
    if (parsed.pathname === "/grid/widgets.json") return json(gridCatalogue);
    // Rita through the door's /ai: her document, then her streamed answer to the one query.
    if (parsed.pathname === "/ai/agents.json") {
      return json({ openbb_agent_rita: { name: "Agent Rita", endpoints: { query: "/v1/query" }, features: { streaming: true } } });
    }
    if (parsed.pathname === "/ai/v1/query") {
      ritaQueries.push({ headers: init.headers, body: JSON.parse(init.body.toString()) });
      return new Response('event: copilotMessageChunk\ndata: {"delta":"Rita answered through the door."}\n\n',
        { headers: { "content-type": "text/event-stream" } });
    }
    // openbq-mcp through the door's /mcp: a session on initialize, then one read-only tool.
    if (parsed.pathname === "/mcp") {
      const message = JSON.parse(init.body.toString());
      mcpMessages.push({ method: message.method, session: init.headers["Mcp-Session-Id"], principal: init.headers["X-Preview-Principal"] });
      if (message.id === undefined) return new Response(null, { status: 202 });
      const result = message.method === "initialize"
        ? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "OpenBB MCP", version: "test" } }
        : message.method === "tools/list" ? { tools: [{ name: "search_tools", description: "Search for tools.", inputSchema: { type: "object", properties: {} } }] } : {};
      return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n\n`,
        { headers: { "content-type": "text/event-stream", ...(message.method === "initialize" ? { "mcp-session-id": "smoke-session" } : {}) } });
    }
    if (parsed.pathname === "/grid/live_grid") {
      return json(parsed.searchParams.get("symbol").split(",").map((symbol, i) => ({ symbol, price: 123.45 + i })));
    }
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
    const nonce = cut < 0 ? null : socketTicketNonce(config.token, target, ws.url().slice(cut + 8));
    if (!nonce || admitted.has(nonce)) return ws.close({ code: 1008 });
    admitted.add(nonce);
    ticketed.push(target);
    if (target === "/grid/live_grid_ws") {
      // Every grid frame is re-validated (policy.mjs liveGridSubscription) and answered
      // with one tick for the first symbol it names.
      ws.onMessage(frame => {
        const rebuilt = liveGridSubscription(frame);
        if (!rebuilt) return ws.close({ code: 1008 });
        gridFrames.push(rebuilt);
        ws.send(JSON.stringify({ symbol: JSON.parse(rebuilt).params.symbol.split(",")[0], price: 234.56 }));
      });
      return;
    }
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
  // The headline can arrive over the socket before the history page is relayed: wait for it, bounded.
  for (let i = 0; i < 50 && !forwarded.includes("/news/api/news"); i++) await new Promise(r => setTimeout(r, 100));
  assert.ok(forwarded.includes("/news/api/news"), JSON.stringify(forwarded));
  // The seeded Live quotes tab (the vendored v10.0.0 policy serves the grid socket): the
  // snapshot over /grid/live_grid, then a tick over a socket the shim opened on the
  // GATEWAY on a ticket that verified for /grid/live_grid_ws, with a frame the gateway's
  // own rule accepts.
  await page.getByRole("tab", { name: "Live quotes", exact: true }).click();
  await page.getByText("BTC-USD", { exact: true }).first().waitFor();
  await page.getByText(/234\.56/).first().waitFor();
  assert.ok(forwarded.includes("/grid/widgets.json"), JSON.stringify(forwarded));
  assert.ok(forwarded.includes("/grid/live_grid"), JSON.stringify(forwarded));
  assert.deepEqual(ticketed, ["/news/ws/news", "/grid/live_grid_ws"], JSON.stringify(ticketed));
  assert.deepEqual(gridFrames, ['{"params":{"symbol":"AAPL,MSFT,NVDA,BTC-USD,EURUSD"}}']);
  // The ticket route issues for the policy's targets and nothing else.
  for (const target of ["/news/ws/news", "/grid/live_grid_ws"]) {
    const issued = await context.request.get(origin + "/socket-ticket?for=" + encodeURIComponent(target));
    assert.equal(issued.status(), 200, target);
    assert.ok((await issued.json()).url.startsWith(`wss://gateway.example.com${target}?ticket=`), target);
  }
  for (const asked of ["/grid/live_grid_ws?token=x", "/grid/live_grid_ws?symbol=AAPL", "/news/ws/news?x=1", "/ai/v1/query", "/"]) {
    assert.equal((await context.request.get(origin + "/socket-ticket?for=" + encodeURIComponent(asked))).status(), 404, asked);
  }
  // Rita (PREVIEW_RITA): the seed points the Agents URL at this origin's /ai, so the pane is
  // there, her document is found through the relay, and a turn streams back from the door.
  const rita = page.getByRole("complementary", { name: "Rita AI pane" });
  await rita.hover();
  // Lock only once the hover has opened it (e2e/rita.spec.ts): locking a closed pane keeps it closed.
  await page.locator('[aria-label="Rita AI pane"][data-open="true"]').waitFor();
  await rita.getByRole("button", { name: "Lock", exact: true }).click();
  await page.getByRole("img", { name: "Rita online" }).waitFor();
  await page.getByRole("textbox", { name: "Message Rita" }).fill("Are you there?");
  await page.keyboard.press("Enter");
  await page.getByText("Rita answered through the door.").waitFor();
  assert.ok(forwarded.includes("/ai/agents.json"), JSON.stringify(forwarded));
  assert.equal(ritaQueries.length, 1);
  assert.equal(ritaQueries[0].headers["X-Rita-Principal"], "github:42");
  assert.equal(ritaQueries[0].body.messages.at(-1).content, "Are you there?");
  await rita.getByRole("button", { name: "Lock", exact: true }).click();
  await page.mouse.move(10, 500);
  // The AI Library's seeded MCP server (PREVIEW_MCP) at this origin's /mcp: Check runs the
  // app's own MCP client through the relay -- initialize, its session on the next call, the tools.
  await page.getByRole("button", { name: "AI Library", exact: true }).click();
  const library = page.getByRole("dialog", { name: "AI Library" });
  await library.getByRole("tab", { name: "MCP Servers" }).click();
  await library.getByRole("button", { name: `Check ${origin}/mcp` }).click();
  await library.getByText("1 tools", { exact: true }).waitFor();
  assert.equal(mcpMessages[0].method, "initialize");
  assert.ok(mcpMessages.some(m => m.method === "tools/list" && m.session === "smoke-session"), JSON.stringify(mcpMessages));
  assert.ok(mcpMessages.every(m => m.principal === "github:42"), JSON.stringify(mcpMessages));
  await page.keyboard.press("Escape");
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
  // AMZN, not NVDA: the seeded Live quotes grid names NVDA in its symbols, so NVDA in the
  // saved store would no longer say anything about this edit. AMZN is in no seed.
  assert.ok(!saved.get("dashboards/preview.json").includes("AMZN"));
  const signedOut = page.waitForURL(/\/auth\/signin/);
  await echoCard.getByRole("textbox", { name: "Ticker" }).fill("AMZN", { timeout: 5000 })
    .then(() => echoCard.getByRole("textbox", { name: "Ticker" }).press("Enter", { timeout: 5000 }))
    .catch(() => {});
  await signedOut;

  await context.addCookies(session);
  await page.goto(origin);
  await grouping.click();
  await echoed("MSFT");
  assert.ok(!saved.get("dashboards/preview.json").includes("AMZN"));
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
  console.log("PASS: HTTPS login form, private assets, forwarded /api catalogue, seeded built-ins dashboard, per-user state saved + reseeded on reload, the News card's wire over a ticketed gateway socket plus its /news/api/news seed, the Live quotes grid's /grid/live_grid snapshot and a tick over a ticketed, single-use gateway socket, the ticket route refusing every other target, a Rita turn streamed through /ai with the session's principal, the AI Library's seeded MCP server checked through /mcp, lapsed session goes to sign-in, CSRF logout, mobile login; no external requests.");
} finally {
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await rm(dir, { recursive: true, force: true });
}
