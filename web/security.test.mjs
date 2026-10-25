// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request } from "node:http";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { encode } from "@auth/core/jwt";
import { WebSocket, WebSocketServer } from "ws";
import { readConfig, SESSION_COOKIE } from "./config.mjs";
import { authConfig, identity } from "./auth.mjs";
import { newsSubscription, refSubscription, socketTarget, socketTicket, socketTicketNonce, socketTicketValid, upstreamPath } from "./policy.mjs";
import * as vendoredPolicy from "./policy.mjs";
import { bootstrap } from "./bootstrap.mjs";
import { createPreviewServer, gridSocketServed } from "./server.mjs";

const env = {
  APP_ORIGIN: "https://preview.example.com",
  AUTH_SECRET: "test-only-secret-never-use-in-production-123",
  AUTH_GITHUB_ID: "test-client", AUTH_GITHUB_SECRET: "test-client-secret",
  SESSION_EPOCH: "test-1", GITHUB_ALLOWED_USER_IDS: "42",
  BACKEND_GATEWAY_ORIGIN: "https://gateway.example.com",
  BACKEND_GATEWAY_TOKEN: "test-only-gateway-token-not-a-real-credential",
  NEWS_APPROVED_FEEDS_JSON: '{"https://feeds.example.com/news.xml":7}',
};
const configuration = () => readConfig(env);
async function cookie(patch = {}, secret = env.AUTH_SECRET) {
  return `${SESSION_COOKIE}=${await encode({
    token: { githubId: "42", epoch: "test-1", deadline: Date.now() / 1000 + 3600, ...patch },
    secret, salt: SESSION_COOKIE, maxAge: 3600,
  })}`;
}
// A request that keeps the raw bytes (no decoding) and reports a response cut off mid-body --
// or reset before any of it, which is the same refusal.
function raw(port, path, headers) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, headers: { host: "preview.example.com", ...headers } }, res => {
      const chunks = []; let aborted = false;
      res.on("data", chunk => chunks.push(chunk));
      res.on("error", () => { aborted = true; });
      res.on("close", () => resolve({ status: res.statusCode, headers: res.headers,
        body: Buffer.concat(chunks), aborted: aborted || !res.complete }));
    });
    req.on("error", error => error.code === "ECONNRESET"
      ? resolve({ status: 0, headers: {}, body: Buffer.alloc(0), aborted: true }) : reject(error));
    req.end();
  });
}
async function fixture(t, options = {}) {
  const assets = await mkdtemp(join(tmpdir(), "bdobb-auth-"));
  await mkdir(join(assets, "assets"));
  await writeFile(join(assets, "index.html"), "<html>private dashboard</html>");
  await writeFile(join(assets, "assets", "private.js"), "private bundle");
  await writeFile(join(assets, "assets", "worker.mjs"), "private worker");
  await writeFile(join(assets, "assets", "pivot-test.wasm"), Buffer.from([0,97,115,109,1,0,0,0]));
  await writeFile(join(assets, "favicon.ico"), "icon bytes");
  for (const name of ["favicon.svg", "favicon-16.png", "favicon-32.png", "favicon-48.png",
    "apple-touch-icon.png", "safari-pinned-tab.svg", "icon-192.png", "icon-512.png",
    "icon-maskable-192.png", "icon-maskable-512.png"]) {
    await writeFile(join(assets, name), `branding ${name}`);
  }
  await writeFile(join(assets, "site.webmanifest"), '{"name":"BDOBB","icons":[]}');
  const cfg = options.config ?? configuration();
  const server = createPreviewServer({ config: cfg, assets, ...options });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await rm(assets, { recursive: true, force: true });
  });
  const port = server.address().port;
  function call(path, { headers = {}, method = "GET", body } = {}) {
    return new Promise((resolve, reject) => {
      const req = request({ hostname: "127.0.0.1", port, path, method,
        headers: { host: "preview.example.com", ...headers } }, res => {
        const chunks = [];
        res.on("data", chunk => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers,
          body: Buffer.concat(chunks).toString() }));
      });
      req.on("error", reject); req.end(body);
    });
  }
  return { call, port, cfg };
}

test("configuration: empty allowlist grants nobody, malformed config fails closed", () => {
  assert.equal(readConfig({ ...env, GITHUB_ALLOWED_USER_IDS: "" }).allowedIds.size, 0);
  for (const patch of [
    { AUTH_SECRET: "" }, { AUTH_GITHUB_ID: "" }, { SESSION_EPOCH: "" },
    { GITHUB_ALLOWED_USER_IDS: "owner" }, { APP_ORIGIN: "http://preview.example.com" },
    { APP_ORIGIN: "https://preview.example.com/path" },
    { BACKEND_GATEWAY_ORIGIN: "https://gateway.example.com/path" },
    { BACKEND_GATEWAY_TOKEN: "" },
    // The approved feeds fail closed too: not JSON, not an object, a key that is not a
    // bare HTTPS URL, an id that is not a positive integer, more than fifty.
    { NEWS_APPROVED_FEEDS_JSON: "{" }, { NEWS_APPROVED_FEEDS_JSON: "[]" }, { NEWS_APPROVED_FEEDS_JSON: "7" },
    { NEWS_APPROVED_FEEDS_JSON: '{"http://feeds.example.com/news.xml":7}' },
    { NEWS_APPROVED_FEEDS_JSON: '{"https://u:p@feeds.example.com/news.xml":7}' },
    { NEWS_APPROVED_FEEDS_JSON: '{"https://feeds.example.com/news.xml#x":7}' },
    { NEWS_APPROVED_FEEDS_JSON: '{"not a url":7}' },
    { NEWS_APPROVED_FEEDS_JSON: '{"https://feeds.example.com/news.xml":0}' },
    { NEWS_APPROVED_FEEDS_JSON: '{"https://feeds.example.com/news.xml":"7"}' },
    { NEWS_APPROVED_FEEDS_JSON: JSON.stringify(Object.fromEntries(
      Array.from({ length: 51 }, (_, i) => [`https://feeds.example.com/${i}.xml`, i + 1]))) },
  ]) assert.throws(() => readConfig({ ...env, ...patch }));
  // Two approved feeds that share one id are refused, as the gateway refuses them:
  // the id is what /news/api/news admits, so it must name exactly one URL.
  assert.throws(() => readConfig({ ...env,
    NEWS_APPROVED_FEEDS_JSON: '{"https://feeds.example.com/a.xml":7,"https://feeds.example.com/b.xml":7}' }),
  e => e.message === "NEWS_APPROVED_FEEDS_JSON: two feeds share one id" && !e.message.includes("feeds.example.com"));
  // Distinct ids for distinct URLs are fine.
  assert.equal(Object.keys(readConfig({ ...env,
    NEWS_APPROVED_FEEDS_JSON: '{"https://feeds.example.com/a.xml":7,"https://feeds.example.com/b.xml":8}' }).feeds).length, 2);
  // No approved feeds is a valid configuration: the news family is simply off.
  assert.deepEqual(readConfig({ ...env, NEWS_APPROVED_FEEDS_JSON: "" }).feeds, {});
  // The rejection names the variable and never carries its value.
  assert.throws(() => readConfig({ ...env, BACKEND_GATEWAY_TOKEN: "hunter2" }),
    e => e.message.startsWith("BACKEND_GATEWAY_TOKEN") && !e.message.includes("hunter2"));
});

test("an unconfigured server answers 503 and logs which variable failed", async t => {
  const logged = [];
  const { error } = console;
  console.error = (...args) => logged.push(args.join(" "));
  t.after(() => { console.error = error; });
  // fixture() always supplies a config; this server reads process.env. That
  // env is NOT reliably unconfigured: a Vercel build of the v12.4 project
  // carries the full preview configuration, readConfig then succeeds, and the
  // request below is answered 421 (not the canonical host) instead of 503
  // (2026-09-24, v12.4.13's release/v12.4 build). Blank one required variable
  // for the duration so the read fails the same way everywhere.
  const saved = process.env.AUTH_GITHUB_ID;
  process.env.AUTH_GITHUB_ID = "";
  t.after(() => { if (saved === undefined) delete process.env.AUTH_GITHUB_ID; else process.env.AUTH_GITHUB_ID = saved; });
  const server = createPreviewServer({ config: null, assets: tmpdir() });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const status = await new Promise((resolve, reject) => {
    request({ hostname: "127.0.0.1", port: server.address().port, path: "/" }, res => resolve(res.statusCode))
      .on("error", reject).end();
  });
  assert.equal(status, 503);
  assert.match(logged.join("\n"), /^Private preview is not configured: [A-Z_]+/m);
});

test("GitHub callbacks bind admission to immutable provider ID and never expose tokens", async () => {
  const auth = authConfig(configuration());
  assert.equal(auth.callbacks.signIn({ account: { provider: "github", providerAccountId: "42" } }), true);
  assert.equal(auth.callbacks.signIn({ account: { provider: "github", providerAccountId: "99" } }), false);
  assert.equal(auth.callbacks.signIn({ account: { provider: "other", providerAccountId: "42" } }), false);
  const token = auth.callbacks.jwt({ account: { providerAccountId: "42", access_token: "not-returned" } });
  assert.equal(token.githubId, "42");
  assert.ok(!JSON.stringify(token).includes("not-returned"));
  assert.equal(auth.callbacks.jwt({ token }).deadline, token.deadline);
  assert.deepEqual(auth.callbacks.session({ session: { expires: "tomorrow" }, token }),
    { expires: "tomorrow", user: { id: "42" } });
  assert.equal(auth.callbacks.redirect({ url: "https://evil.example.com" }), env.APP_ORIGIN + "/");
  assert.deepEqual(auth.providers[0].options.checks, ["pkce", "state"]);
});

test("encrypted sessions require valid cookie, current ID, epoch and strict expiry", async () => {
  const cfg = configuration();
  assert.equal((await identity({ cookie: await cookie() }, cfg)).id, "42");
  for (const patch of [{ githubId: "99" }, { epoch: "old" }, { deadline: 0 }, { deadline: "forever" }]) {
    assert.equal(await identity({ cookie: await cookie(patch) }, cfg), null);
  }
  assert.equal(await identity({ cookie: await cookie({}, "a-different-encryption-secret-32-chars") }, cfg), null);
  const valid = await cookie();
  assert.equal(await identity({ authorization: "Bearer " + valid.split("=")[1] }, cfg), null);
  assert.equal(await identity({ cookie: valid + "tampered" }, cfg), null);
  cfg.allowedIds.clear();
  assert.equal(await identity({ cookie: valid }, cfg), null);
});

test("path and parameter allowlist blocks writes, admin surfaces and URL injection", () => {
  const cfg = configuration();
  const allowed = "/api/api/v1/equity/price/quote?symbol=AAPL&provider=eodhd";
  assert.equal(upstreamPath(new URL(allowed, cfg.origin), cfg), allowed);
  // The REST half of the news family: the headline seed a card fetches before
  // the socket streams. Bounded to an approved feed id and the client's limit.
  assert.equal(upstreamPath(new URL("/news/api/news?feed_id=7&limit=50", cfg.origin), cfg),
    "/news/api/news?feed_id=7&limit=50");
  // The client's own seed URL (src/lib/news.ts seedUrl: limit first) is admitted too.
  assert.equal(upstreamPath(new URL("/news/api/news?limit=50&feed_id=7", cfg.origin), cfg),
    "/news/api/news?limit=50&feed_id=7");
  for (const path of [
    "/tick", "/mcp", "/keys", "/news/admin", "/live/widgets.json", "/api/admin",
    // A duplicated key is refused for every route, the generic rule included:
    // the client sets each key once (searchParams.set), so a repeat is never its work.
    "/api/api/v1/equity/price/quote?symbol=AAPL&provider=eodhd&symbol=MSFT",
    // An unapproved feed id, a limit past the client's, no feed id at all, a key the
    // route does not take, a repeated id, and anything else under /news/.
    "/news/api/news?feed_id=8&limit=50", "/news/api/news?feed_id=7&limit=500",
    "/news/api/news?feed_id=7&limit=0", "/news/api/news?limit=50", "/news/api/news?feed_id=7",
    "/news/api/news?feed_id=7&limit=50&url=https://evil.example.com",
    "/news/api/news?feed_id=7&feed_id=7&limit=50", "/news/api/feeds", "/news/ws/news",
  ]) assert.equal(upstreamPath(new URL(path, cfg.origin), cfg), null, path);
  // With no approved feeds, no id is approved.
  const off = configuration(); off.feeds = {};
  assert.equal(upstreamPath(new URL("/news/api/news?feed_id=7&limit=50", off.origin), off), null);
});

test("the /api root documents are forwarded; nothing else at the /api root is", () => {
  const cfg = configuration();
  // dataClient.ts fetches exactly two root documents from a backend --
  // fetchWidgetsJson and fetchAppsJson. openbb-api answers 404 for
  // templates.json, and agents.json is Rita's document, not a backend's.
  for (const allowed of ["/api/widgets.json", "/api/apps.json"]) {
    assert.equal(upstreamPath(new URL(allowed, cfg.origin), cfg), allowed);
  }
  for (const path of [
    "/api/widgets.json?x=1", "/api/apps.json?x=1",
    // openbb-api's own interactive surfaces sit OUTSIDE /api/api/v1/ and stay
    // refused by omission, exactly as when the /api side was curated.
    "/api/docs", "/api/openapi.json", "/api/redoc",
    "/api/templates.json", "/api/agents.json", "/api/", "/api/api/v2/equity/price/quote",
  ]) assert.equal(upstreamPath(new URL(path, cfg.origin), cfg), null, path);
});

test("calendar/trading keeps its own narrow grammar, matched before the generic rule", () => {
  const cfg = configuration();
  // The one /api route that kept a narrow grammar after the catalogue was
  // opened up: no widget calls it, so dataClient.ts' own calendar fetch is its
  // only caller and a four-letter MIC plus a year in the client's 1990-2040
  // window is the whole legitimate parameter space.
  const allowed = "/api/api/v1/calendar/trading?exchange=XNYS&year=2026";
  assert.equal(upstreamPath(new URL(allowed, cfg.origin), cfg), allowed);
  for (const path of [
    // Not the generic rule's business: this block refuses definitively rather
    // than falling through, so each of these is null and not a forwarded path.
    "/api/api/v1/calendar/trading",
    "/api/api/v1/calendar/trading?exchange=XNYS",
    "/api/api/v1/calendar/trading?year=2026",
    "/api/api/v1/calendar/trading?exchange=xnys&year=2026",
    "/api/api/v1/calendar/trading?exchange=XNYSE&year=2026",
    "/api/api/v1/calendar/trading?exchange=XNYS&year=1989",
    "/api/api/v1/calendar/trading?exchange=XNYS&year=2041",
    "/api/api/v1/calendar/trading?exchange=XNYS&year=2026&provider=eodhd",
  ]) assert.equal(upstreamPath(new URL(path, cfg.origin), cfg), null, path);
});

test("the policy serves no /ai family: Rita is not a route of openbq-docker (R3a)", () => {
  const cfg = configuration();
  for (const path of ["/ai/agents.json", "/ai/agents.json?x=1", "/ai/v1/query", "/ai/", "/ai/v1/agents.json"]) {
    assert.equal(upstreamPath(new URL(path, cfg.origin), cfg), null, path);
  }
});

test("the generic api/v1 rule admits the whole catalogue inside structural bounds", () => {
  const cfg = configuration();
  // Sampled from the live v12.4 catalogue (331 widgets over 181 distinct
  // endpoints): several provider variants of one route, a parameterised economy
  // route, and an optionsEndpoint sitting behind a parameter dropdown.
  for (const allowed of [
    "/api/api/v1/equity/price/quote?symbol=AAPL&provider=eodhd",
    "/api/api/v1/equity/price/quote?symbol=AAPL&provider=fmp",
    "/api/api/v1/equity/price/quote?symbol=AAPL&exchange=US&provider=kdb",
    "/api/api/v1/economy/fred_series?symbol=GDP&start_date=2020-01-01&provider=fred",
    "/api/api/v1/federal_reserve/fomc_documents_choices",
    "/api/api/v1/fixedincome/government/treasury_auctions?provider=government_us",
  ]) assert.ok(upstreamPath(new URL(allowed, cfg.origin), cfg), allowed);
  // The query that leaves is RE-SERIALISED from the parsed pairs, never the raw
  // string the caller wrote: a lowercase %2c comes back canonically encoded.
  assert.equal(
    upstreamPath(new URL("/api/api/v1/equity/price/quote?symbol=AAPL%2cMSFT&provider=eodhd", cfg.origin), cfg),
    "/api/api/v1/equity/price/quote?symbol=AAPL%2CMSFT&provider=eodhd");
  const symbol = value => `/api/api/v1/equity/price/quote?symbol=${value}`;
  for (const path of [
    // Uppercase, a dot and a percent are all outside the path class. A literal
    // ".." never reaches the rule (new URL folds it away), so the guard that
    // does the work is the one on "%", which is how %2e%2e would arrive.
    "/api/api/v1/Equity/price/quote", "/api/api/v1/equity/price/quote.json",
    "/api/api/v1/equity/%2e%2e/%2e%2e/admin", "/api/api/v1/equity/price/quote%3Fx",
    "/api/api/v1/" + "a".repeat(201),
    // The bounds: 4096 characters forwarded, 40 pairs, 64-character names,
    // 1024-character values, no control character, CR or LF in a value.
    symbol("A".repeat(4100)), symbol("A".repeat(1025)),
    "/api/api/v1/equity/price/quote?" + Array.from({ length: 41 }, (_, i) => `p${i}=1`).join("&"),
    "/api/api/v1/equity/price/quote?1symbol=AAPL", "/api/api/v1/equity/price/quote?sym%20bol=AAPL",
    "/api/api/v1/equity/price/quote?" + "s".repeat(65) + "=AAPL",
    symbol("AAPL%0d%0aX-Injected:%201"), symbol("AAPL%00"),
  ]) assert.equal(upstreamPath(new URL(path, cfg.origin), cfg), null, path);
});

test("News subscriptions strip renames and refuse arbitrary feeds or control frames", () => {
  const cfg = configuration();
  assert.equal(newsSubscription(JSON.stringify({ subscribe: [
    { url: "https://feeds.example.com/news.xml", name: "rename", admin: true },
  ] }), cfg), '{"subscribe":[{"url":"https://feeds.example.com/news.xml"}]}');
  for (const frame of ["bad", "null", '{"subscribe":[]}', '{"admin":true}',
    '{"subscribe":[{"url":"https://evil.example.com"}]}',
    '{"subscribe":[{"url":"https://feeds.example.com/news.xml"}],"delete":true}',
  ]) assert.equal(newsSubscription(frame, cfg), null);
  // One stray feed does not blank the card: it is dropped, never forwarded, and the
  // approved ones go through. Malformed is still refused.
  assert.equal(newsSubscription(JSON.stringify({ subscribe: [
    { url: "https://evil.example.com/feed" }, { url: "https://feeds.example.com/news.xml" }, { url: "https://other.example.com/rss" },
  ] }), cfg), '{"subscribe":[{"url":"https://feeds.example.com/news.xml"}]}');
  for (const frame of [
    '{"subscribe":[{"url":"https://feeds.example.com/news.xml"},{"url":7}]}',
    '{"subscribe":[{"url":"https://feeds.example.com/news.xml"},{"url":"https://feeds.example.com/news.xml"}]}',
    '{"subscribe":[{"url":"https://feeds.example.com/news.xml"},null]}',
    '{"subscribe":[{"url":"__proto__"}]}',
  ]) assert.equal(newsSubscription(frame, cfg), null, frame);
});

test("bootstrap contains only same-origin routes, never server configuration or credentials, and needs no backend", () => {
  const text = bootstrap(configuration());
  for (const forbidden of [env.AUTH_SECRET, env.AUTH_GITHUB_SECRET, env.BACKEND_GATEWAY_TOKEN,
    env.BACKEND_GATEWAY_ORIGIN]) assert.ok(!text.includes(forbidden));
  assert.ok(text.includes("/api"));
  assert.ok(text.includes("OpenBB API (preview)"));
  // The seeded dashboard is the built-ins example: every card is a builtin
  // widget id, needs no key and no backend -- true even with no gateway
  // configured, which the second call below proves.
  // The seed is JSON.stringify'd twice (the dashboard file's own text, then
  // the outer window.__bdobbSeed literal), so a widgetId shows up escaped.
  for (const id of ["note", "markdown", "clock", "website", "rss", "param_echo"]) {
    assert.ok(text.includes(`\\"widgetId\\":\\"${id}\\"`), id);
  }
  // With approved feeds and a gateway, the seed gains the News tab, the ticket
  // flag socket.ts reads, and the one server an empty News card may fall back to.
  assert.ok(text.includes('\\"widgetId\\":\\"news\\"'));
  assert.ok(text.includes('\\"url\\":\\"https://feeds.example.com/news.xml\\"'));
  assert.ok(text.includes("window.__bdobbSocketTickets=true;"));
  assert.ok(text.includes('window.__bdobbNewsServer="https://preview.example.com/news"'));
  const cfg = configuration(); cfg.backend = null; cfg.token = null;
  const noBackend = bootstrap(cfg);
  assert.ok(noBackend.includes("preview-api"));
  assert.ok(noBackend.includes('\\"widgetId\\":\\"param_echo\\"'));
  // No gateway, no socket to ticket -- the flag is what turns socket.ts on.
  assert.ok(!noBackend.includes("__bdobbSocketTickets"));
  // Approved feeds but no gateway: no News tab either, since its card could only
  // show an error. The other built-in tabs are still seeded.
  assert.ok(!noBackend.includes('\\"widgetId\\":\\"news\\"'));
  assert.ok(noBackend.includes('\\"widgetId\\":\\"rss\\"'));
  // Nor a fallback server: an empty News card would only get the relay's 503.
  assert.ok(!noBackend.includes("__bdobbNewsServer"));
  // No approved feeds, no News tab and no fallback server to name.
  const noFeeds = configuration(); noFeeds.feeds = {};
  const bare = bootstrap(noFeeds);
  assert.ok(!bare.includes('\\"widgetId\\":\\"news\\"'));
  assert.ok(!bare.includes("__bdobbNewsServer"));
});

test("the reference backend is seeded only with a gateway, and tickets turn on with it", () => {
  const withGw = bootstrap(configuration());
  assert.ok(withGw.includes("OpenBQ Reference (preview)"));
  // Double-encoded like every seeded value (see the widgetId assertions above).
  assert.ok(withGw.includes('\\"id\\":\\"preview-ref\\"'));
  assert.ok(withGw.includes("https://preview.example.com/ref"));
  assert.match(withGw, /window\.__bdobbSocketTickets=true;/);
  const cfg = configuration(); cfg.backend = null; cfg.token = null;
  const noGw = bootstrap(cfg);
  assert.ok(!noGw.includes("preview-ref"));
  assert.doesNotMatch(noGw, /__bdobbSocketTickets/);
});

test("anonymous visitors see login, not UI, metadata, JavaScript or data", async t => {
  const { call } = await fixture(t);
  const root = await call("/");
  assert.equal(root.status, 200); assert.match(root.body, /Continue with GitHub/);
  assert.ok(!root.body.includes("private dashboard"));
  for (const path of ["/index.html", "/assets/private.js", "/preview-bootstrap.js",
    "/api/widgets.json", "/socket-ticket?for=%2Fnews%2Fws%2Fnews", "/preview-feeds.json",
    "/news/api/news?feed_id=7&limit=50", "/tick"]) {
    assert.equal((await call(path)).status, 401, path);
  }
});

test("authorized files work; aliases, traversal, source maps, cross-origin and writes fail", async t => {
  // widgets.json is a proxied route now, so this fixture needs an upstream: the
  // header assertions below are about the response envelope, not the manifest.
  const { call } = await fixture(t, { fetchUpstream: async () =>
    new Response("{}", { headers: { "content-type": "application/json" } }) });
  const headers = { cookie: await cookie() };
  assert.equal((await call("/", { headers })).body, "<html>private dashboard</html>");
  assert.equal((await call("/assets/private.js", { headers })).body, "private bundle");
  assert.equal((await call("/assets/worker.mjs", { headers })).status, 200);
  assert.equal((await call("/", { headers: { ...headers, host: "alias.vercel.app" } })).status, 421);
  assert.equal((await call("/", { headers: { ...headers, "x-forwarded-host": "evil.example.com" } })).status, 200);
  for (const path of ["/.env", "/assets/private.js.map", "/mcp", "/keys", "/tick", "/news/admin", "/live/widgets.json"]) {
    assert.equal((await call(path, { headers })).status, 404, path);
  }
  for (const path of ["/assets/../index.html", "/assets/%2e%2e/index.html", "//evil.example.com"]) {
    assert.equal((await call(path, { headers })).status, 421, path);
  }
  assert.equal((await call("/api/widgets.json", { headers, method: "POST" })).status, 405);
  assert.equal((await call("/api/widgets.json", { headers: { ...headers, origin: "https://evil.example.com" } })).status, 403);
  const response = await call("/api/widgets.json", { headers });
  assert.equal(response.headers["cache-control"], "private, no-store");
  assert.equal(response.headers["vercel-cdn-cache-control"], "no-store");
  assert.equal(response.headers["referrer-policy"], "same-origin");
  // The seeded RSS card reads the NYT Business feed (it sends CORS *); no other feed origin.
  assert.match(response.headers["content-security-policy"], /connect-src 'self'[^;]* https:\/\/rss\.nytimes\.com;/);
  // The YouTube card frames https://www.youtube.com/embed/<id>, and the seeded Website
  // card frames docs.openbb.co: those two origins are admitted and nothing else.
  assert.deepEqual(
    response.headers["content-security-policy"].split(";").map(value => value.trim().split(/\s+/))
      .filter(([name]) => name === "frame-src"),
    [["frame-src", "https://www.youtube.com", "https://docs.openbb.co"]]);
  // The sign-in form POSTs to /auth/signin/github, which 302s to GitHub; Chromium
  // and WebKit enforce form-action on that redirect, so the allowlist must name it.
  assert.match(response.headers["content-security-policy"], /form-action 'self' https:\/\/github\.com$/);
});

test("a top-level cross-site navigation is the OAuth landing, not a forgeable request", async t => {
  const { call } = await fixture(t);
  const navHeaders = { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };
  // The GitHub redirect chain ends with Sec-Fetch-Site: cross-site even though it is a
  // same-origin GET the browser is making of its own accord; a plain visitor link from
  // another site (email, chat) looks identical. Neither should be turned away.
  const anonymous = await call("/", { headers: navHeaders });
  assert.equal(anonymous.status, 200); assert.match(anonymous.body, /Continue with GitHub/);
  const authed = await call("/", { headers: { ...navHeaders, cookie: await cookie() } });
  assert.equal(authed.status, 200); assert.equal(authed.body, "<html>private dashboard</html>");
  // Everything that is not a genuine top-level document navigation stays refused.
  assert.equal((await call("/", { headers: { ...navHeaders, "sec-fetch-mode": "cors" } })).status, 403);
  assert.equal((await call("/", { headers: { ...navHeaders, "sec-fetch-dest": "iframe" } })).status, 403);
  assert.equal((await call("/some/asset.js", { headers: { "sec-fetch-site": "cross-site", "sec-fetch-dest": "script" } })).status, 403);
  assert.equal((await call("/api/widgets.json", { method: "POST",
    headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" } })).status, 403);
});

test("empty allowlist cannot start OAuth or accept even a correctly signed session", async t => {
  const cfg = configuration(); cfg.allowedIds.clear();
  const { call } = await fixture(t, { config: cfg });
  assert.equal((await call("/auth/signin")).status, 403);
  assert.equal((await call("/assets/private.js", { headers: { cookie: await cookie() } })).status, 401);
});

test("Auth.js issues CSRF cookie; missing CSRF and wrong Origin cannot start OAuth", async t => {
  const { call } = await fixture(t);
  const csrf = await call("/auth/csrf");
  assert.equal(csrf.status, 200);
  assert.ok(JSON.parse(csrf.body).csrfToken);
  assert.match(csrf.headers["set-cookie"].join(), /HttpOnly/);
  assert.match(csrf.headers["set-cookie"].join(), /Secure/);
  const denied = await call("/auth/signin/github", {
    method: "POST", headers: { origin: env.APP_ORIGIN, "content-type": "application/x-www-form-urlencoded" },
    body: "callbackUrl=https%3A%2F%2Fevil.example.com",
  });
  assert.ok(!denied.headers.location?.startsWith("https://github.com"));
  assert.equal((await call("/auth/signin/github", { method: "POST",
    headers: { origin: "https://evil.example.com" } })).status, 403);
  const cookies = csrf.headers["set-cookie"].map(v => v.split(";")[0]).join("; ");
  const good = await call("/auth/signin/github", {
    method: "POST", headers: { origin: env.APP_ORIGIN, cookie: cookies, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken: JSON.parse(csrf.body).csrfToken }).toString(),
  });
  assert.equal(good.status, 302);
  const location = new URL(good.headers.location);
  assert.equal(location.origin, "https://github.com");
  assert.equal(location.searchParams.get("redirect_uri"), env.APP_ORIGIN + "/auth/callback/github");
  assert.equal(location.searchParams.get("scope"), "read:user");
  assert.ok(location.searchParams.get("state"));
  assert.ok(location.searchParams.get("code_challenge"));
  // The redirect the sign-in form's POST actually takes must be inside the
  // response's own form-action allowlist, or Chromium/WebKit block the hop.
  const formAction = good.headers["content-security-policy"].match(/form-action ([^;]+)/)[1];
  assert.ok(formAction.split(" ").includes(location.origin));
});

test("valid CSRF sign-out expires the browser session cookie", async t => {
  const { call } = await fixture(t);
  const csrf = await call("/auth/csrf");
  const cookies = [await cookie(), ...csrf.headers["set-cookie"].map(v => v.split(";")[0])].join("; ");
  const response = await call("/auth/signout", {
    method: "POST", headers: { origin: env.APP_ORIGIN, cookie: cookies,
      "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken: JSON.parse(csrf.body).csrfToken }).toString(),
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, env.APP_ORIGIN + "/");
  assert.ok(response.headers["set-cookie"].some(c =>
    c.startsWith(SESSION_COOKIE + "=;") && c.includes("Max-Age=0")));
});

test("proxy uses dedicated server token, bounded fetch, and never forwards browser credentials", async t => {
  let observed;
  const { call } = await fixture(t, { fetchUpstream: async (url, init) => {
    observed = { url, init };
    return new Response('{"results":[{"symbol":"AAPL","price":100}]}', {
      headers: { "content-type": "application/json", "set-cookie": "private=value", "www-authenticate": "private" },
    });
  } });
  const response = await call("/api/api/v1/equity/price/quote?symbol=AAPL&provider=eodhd", {
    headers: { cookie: await cookie(), authorization: "client-supplied", "x-api-key": "client-key" },
  });
  assert.equal(response.status, 200);
  assert.equal(observed.url, env.BACKEND_GATEWAY_ORIGIN + "/api/api/v1/equity/price/quote?symbol=AAPL&provider=eodhd");
  assert.deepEqual(observed.init.headers, { Authorization: "Bearer " + env.BACKEND_GATEWAY_TOKEN, Accept: "application/json" });
  assert.equal(observed.init.redirect, "error");
  assert.ok(observed.init.signal instanceof AbortSignal);
  assert.equal(response.headers["set-cookie"], undefined);
  assert.equal(response.headers["www-authenticate"], undefined);
});

test("unconfigured upstream, error bodies and unexpected content fail closed", async t => {
  const headers = { cookie: await cookie() };
  const path = "/api/api/v1/equity/price/quote?symbol=AAPL&provider=eodhd";
  const cfg = configuration(); cfg.backend = null; cfg.token = null;
  const noBackend = await fixture(t, { config: cfg });
  assert.equal((await noBackend.call(path, { headers })).status, 503);
  for (const response of [
    new Response("private backend error", { status: 401 }),
    new Response("<script>bad</script>", { headers: { "content-type": "text/html" } }),
    new Response("x".repeat(2 * 1024 * 1024 + 1), { headers: { "content-type": "application/json" } }),
  ]) {
    const f = await fixture(t, { fetchUpstream: async () => response });
    const result = await f.call(path, { headers });
    assert.equal(result.status, 502);
    assert.ok(!result.body.includes("private backend error"));
  }
});

test("a text/plain answer (the video routes) is relayed as text", async t => {
  const headers = { cookie: await cookie() };
  const f = await fixture(t, { fetchUpstream: async () =>
    new Response("https://www.youtube.com/embed/abc", { headers: { "content-type": "text/plain; charset=utf-8" } }) });
  const result = await f.call("/api/api/v1/videos/video?url=x", { headers });
  assert.equal(result.status, 200);
  assert.equal(result.body, "https://www.youtube.com/embed/abc");
  assert.equal(result.headers["content-type"], "text/plain; charset=utf-8");
});

async function rejectedWs(port, path, headers) {
  const client = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: { host: "preview.example.com", ...headers } });
  client.on("error", () => {});
  return new Promise((resolve, reject) => {
    client.on("unexpected-response", (_req, res) => { res.resume(); resolve(res.statusCode); client.terminate(); });
    client.on("open", () => { client.terminate(); reject(new Error("Unexpected upgrade")); });
  });
}
test("News upgrade authenticates cookies, exact Origin, exact path, no query token", async t => {
  const { port } = await fixture(t);
  const c = await cookie();
  // The auth rail runs before any route is matched, exactly like the HTTP
  // handler's: no cookie is 401, a wrong Origin is 403. Past both, only the
  // exact /news/ws/news path with no query is a route.
  assert.equal(await rejectedWs(port, "/news/ws/news", { origin: env.APP_ORIGIN }), 401);
  assert.equal(await rejectedWs(port, "/news/ws/news", { cookie: c, origin: "https://evil.example.com" }), 403);
  assert.equal(await rejectedWs(port, "/news/ws/news", { cookie: c }), 403); // Origin is required, not optional
  // /grid/live_grid_ws is a route from openbq-docker v10.0.0 (the grid tests below), so
  // it left this list at the re-vendor; its query, ticket and trailing-slash spellings
  // took its place, with the tick chart's socket, which this layer never relays.
  // /ref/live_grid_ws is a socket target, but this layer does not relay it: the browser
  // opens the reference's socket on the gateway with a ticket.
  for (const path of ["/news/ws/news?token=x", "/news/ws/news?ticket=1.n.s", "/news/ws/news/",
    "/grid/live_grid_ws?token=x", "/grid/live_grid_ws?ticket=1.n.s", "/grid/live_grid_ws/",
    "/grid/ta_chart_ws", "/grid/ta_chart_ws?symbol=AAPL&interval=5m", "/ref/live_grid_ws",
    "/grid/ta_series_ws", "/ai/v1/query", "/tick", "/"]) {
    assert.equal(await rejectedWs(port, path, { cookie: c, origin: env.APP_ORIGIN }), 404, path);
  }
});

test("the News upgrade is 503 without a gateway or without approved feeds", async t => {
  const c = await cookie();
  const noFeeds = configuration(); noFeeds.feeds = {};
  const noBackend = configuration(); noBackend.backend = null; noBackend.token = null;
  for (const config of [noFeeds, noBackend]) {
    const { port } = await fixture(t, { config });
    assert.equal(await rejectedWs(port, "/news/ws/news", { cookie: c, origin: env.APP_ORIGIN }), 503);
  }
});

test("the upgrade path never grants a navigation-shaped exemption; it only trusts Origin", async t => {
  const { port } = await fixture(t);
  const c = await cookie();
  // The HTTP handler's top-level-navigation exemption lives only in the HTTP request
  // handler; the upgrade path never inspects Sec-Fetch-Site at all, and a genuine WS
  // handshake carries Sec-Fetch-Mode: websocket (never "navigate") regardless. A
  // mismatched Origin refuses it either way.
  assert.equal(await rejectedWs(port, "/news/ws/news", { cookie: c, origin: "https://evil.example.com",
    "sec-fetch-site": "cross-site", "sec-fetch-mode": "websocket", "sec-fetch-dest": "websocket" }), 403);
});

async function newsRelay(t, onUpstreamMessage) {
  const upstream = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await once(upstream, "listening");
  t.after(() => { for (const client of upstream.clients) client.terminate(); upstream.close(); });
  const seen = { frames: [] };
  upstream.on("connection", (client, req) => {
    seen.headers = req.headers;
    client.on("message", data => { seen.frames.push(data.toString()); onUpstreamMessage(client, data); });
  });
  const { port } = await fixture(t, { connectUpstream: (url, options) => {
    seen.url = url; seen.options = options;
    return new WebSocket(`ws://127.0.0.1:${upstream.address().port}`, options);
  } });
  const client = new WebSocket(`ws://127.0.0.1:${port}/news/ws/news`, {
    headers: { host: "preview.example.com", origin: env.APP_ORIGIN, cookie: await cookie() },
  });
  t.after(() => client.terminate()); client.on("error", () => {});
  await once(client, "open");
  return { client, seen };
}

test("News relays approved subscription and text, with no arbitrary client frame forwarding", async t => {
  const { client, seen } = await newsRelay(t, upstream =>
    upstream.send('{"feeds":[{"id":7,"url":"https://feeds.example.com/news.xml","title":"News","favicon":null}]}'));
  client.send('{"subscribe":[{"url":"https://feeds.example.com/news.xml","name":"do-not-rename"}]}');
  const [message] = await once(client, "message");
  assert.equal(JSON.parse(message).feeds[0].id, 7);
  assert.deepEqual(seen.frames.map(f => JSON.parse(f)), [{ subscribe: [{ url: "https://feeds.example.com/news.xml" }] }]);
  assert.equal(seen.url, "wss://gateway.example.com/news/ws/news");
  assert.equal(seen.options.followRedirects, false);
  // The gateway's machine token and the gateway's own Origin go upstream; the browser's
  // cookie never does.
  assert.equal(seen.options.headers.Authorization, "Bearer " + env.BACKEND_GATEWAY_TOKEN);
  assert.equal(seen.options.headers.Origin, env.BACKEND_GATEWAY_ORIGIN);
  assert.equal(seen.headers.cookie, undefined);
  // A second frame -- any second frame, even a valid subscription -- closes the socket.
  client.send('{"subscribe":[{"url":"https://feeds.example.com/news.xml"}]}');
  await once(client, "close");
  assert.equal(seen.frames.length, 1);
});

test("a News client whose one frame is not a subscription is closed, and nothing is forwarded", async t => {
  for (const frame of ['{"admin":true}', '{"subscribe":[{"url":"https://evil.example.com/feed"}]}', Buffer.from("binary")]) {
    const { client, seen } = await newsRelay(t, () => {});
    client.send(frame);
    await once(client, "close");
    assert.deepEqual(seen.frames, [], String(frame));
  }
});

test("only the exact branding allowlist is public; nothing rides along with it", async t => {
  // Browsers ask for /favicon.ico unprompted on the login page and on Auth.js's
  // sign-in page, before any session exists. It is the desktop app's public
  // icon, not app content. Touch/PWA icons also need cookie-free GETs.
  const { call } = await fixture(t);
  const icon = await call("/favicon.ico");
  assert.equal(icon.status, 200); assert.equal(icon.headers["content-type"], "image/x-icon");
  assert.equal(icon.body, "icon bytes");
  assert.equal((await call("/favicon.ico?x=1")).status, 401);
  assert.equal((await call("/favicon.ico", { method: "POST" })).status, 401);
  assert.equal((await call("/assets/private.js")).status, 401);
  // Still not a cross-site subresource: another site's <img> is refused like any other.
  assert.equal((await call("/favicon.ico", { headers: { "sec-fetch-site": "cross-site",
    "sec-fetch-mode": "no-cors", "sec-fetch-dest": "image" } })).status, 403);
  for (const [name, type] of [
    ["favicon.svg", "image/svg+xml"], ["safari-pinned-tab.svg", "image/svg+xml"],
    ...["favicon-16.png", "favicon-32.png", "favicon-48.png", "apple-touch-icon.png",
      "icon-192.png", "icon-512.png", "icon-maskable-192.png", "icon-maskable-512.png"]
      .map(name => [name, "image/png"]),
    ["site.webmanifest", "application/manifest+json"],
  ]) {
    const asset = await call(`/${name}`);
    assert.equal(asset.status, 200, name);
    assert.equal(asset.headers["content-type"], type, name);
    assert.equal((await call(`/${name}?x=1`)).status, 401);
    assert.equal((await call(`/${name}`, { method: "POST" })).status, 401);
    assert.equal((await call(`/${name}`, { method: "HEAD" })).status, 401);
    assert.equal((await call(`/${name}`, { headers: { "sec-fetch-site": "cross-site",
      "sec-fetch-mode": "no-cors", "sec-fetch-dest": "image" } })).status, 403);
  }
  for (const name of ["/icon-secret.png", "/private.svg", "/manifest.json", "/index.html",
    "/assets/private.js", "/src/assets/branding/bdobb-mark-green.svg"]) {
    assert.equal((await call(name)).status, 401, name);
  }
  assert.equal((await call("/%66avicon.svg")).status, 421);
  assert.equal((await call("/assets/../favicon.svg")).status, 421);
});

test("the login surface carries the axes mark and installation icon links", async t => {
  const { call } = await fixture(t);
  const page = await call("/");
  assert.equal(page.status, 200);
  assert.match(page.body, /M4 4h2v22h22v2H4z/);
  assert.match(page.body, /fill="#22c99b"/);
  for (const name of ["favicon.svg", "apple-touch-icon.png", "site.webmanifest"]) {
    assert.ok(page.body.includes(`href="/${name}"`));
  }
});

test("branding assets retain their MIME types for authenticated requests too", async t => {
  const { call } = await fixture(t);
  const manifest = await call("/site.webmanifest", { headers: { cookie: await cookie() } });
  assert.equal(manifest.status, 200);
  assert.equal(manifest.headers["content-type"], "application/manifest+json");
  assert.equal(JSON.parse(manifest.body).name, "BDOBB");
});

test("the /api root documents come from openbb-api, not from this process", async t => {
  // Both were answered locally while the /api side was curated: widgets.json
  // from a one-widget manifest, apps.json from a hard-coded []. Since the
  // catalogue was opened up they are the backend's own documents, so the app's
  // Apps dialog lists the example dashboards openbb-api serves.
  const seen = [];
  const { call } = await fixture(t, { fetchUpstream: async url => {
    seen.push(new URL(url).pathname);
    return new Response(url.endsWith("/api/apps.json")
      ? '[{"name":"Example FRED App","tabs":{}}]'
      : '{"equity_price_quote_eodhd_obb":{"name":"Quote","endpoint":"/api/v1/equity/price/quote"}}',
      { headers: { "content-type": "application/json" } });
  } });
  const headers = { cookie: await cookie() };
  const widgets = await call("/api/widgets.json", { headers });
  assert.equal(widgets.status, 200);
  assert.ok(JSON.parse(widgets.body).equity_price_quote_eodhd_obb);
  // src/lib/appsJson.ts isAppsJson takes an ARRAY ([] = no apps). An object here
  // made the Apps dialog report "This connection's apps.json could not be read."
  const apps = await call("/api/apps.json", { headers });
  assert.equal(apps.status, 200);
  assert.equal(JSON.parse(apps.body)[0].name, "Example FRED App");
  assert.deepEqual(seen, ["/api/widgets.json", "/api/apps.json"]);
});

test("manifests stream at up to 16 MiB, gzipped on request; data routes keep 2 MiB", async t => {
  // openbq-api's widgets.json measured 5.0 MB (998 widgets) on 2026-10-15: past the 2 MiB
  // every other body is held to, and past a Vercel Function's ~4.5 MB response unless gzipped.
  const manifest = size => JSON.stringify(Object.fromEntries(
    Array.from({ length: 400 }, (_, i) => [`w${i}`, "x".repeat(Math.ceil(size / 400))])));
  const five = manifest(5_000_000);
  const headers = { cookie: await cookie() };
  const json = (text, extra = {}) => async () =>
    new Response(text, { headers: { "content-type": "application/json", "set-cookie": "private=value", ...extra } });
  const big = await fixture(t, { fetchUpstream: json(five) });
  for (const path of ["/api/widgets.json", "/api/apps.json", "/ref/widgets.json", "/ref/apps.json"]) {
    const ok = await big.call(path, { headers });
    assert.equal(ok.status, 200, path);
    assert.equal(ok.body, five);
    assert.equal(ok.headers["content-encoding"], undefined);
    assert.equal(ok.headers["content-length"], undefined);
    assert.equal(ok.headers.vary, "Accept-Encoding");
    assert.equal(ok.headers["x-content-type-options"], "nosniff");
    assert.equal(ok.headers["cache-control"], "private, no-store");
    assert.equal(ok.headers["set-cookie"], undefined);
  }
  // gzip on request: the same bytes after decompression, a fraction of them on the wire.
  const zipped = await raw(big.port, "/api/widgets.json", { ...headers, "accept-encoding": "gzip, deflate, br" });
  assert.equal(zipped.status, 200);
  assert.equal(zipped.headers["content-encoding"], "gzip");
  assert.equal(zipped.headers.vary, "Accept-Encoding");
  assert.equal(zipped.headers["content-length"], undefined);
  assert.ok(zipped.body.length < 1_000_000, String(zipped.body.length));
  assert.equal(gunzipSync(zipped.body).toString(), five);
  // The same 5 MB, and anything past 2 MiB, on a data route is still a 502.
  const quote = "/api/api/v1/equity/price/quote?symbol=AAPL&provider=eodhd";
  assert.equal((await big.call(quote, { headers })).status, 502);
  const two = await fixture(t, { fetchUpstream: json(manifest(2 * 1024 * 1024 + 1024)) });
  assert.equal((await two.call(quote, { headers })).status, 502);
  // Over 16 MiB: a declared length is refused before any byte; an undeclared one is cut off
  // mid-stream, so the client sees an aborted response, never a short manifest.
  const huge = manifest(16 * 1024 * 1024 + 1024);
  const declared = await fixture(t, { fetchUpstream: json(huge, { "content-length": String(huge.length) }) });
  assert.equal((await declared.call("/api/widgets.json", { headers })).status, 502);
  const undeclared = await fixture(t, { fetchUpstream: json(huge) });
  const cut = await raw(undeclared.port, "/api/widgets.json", headers);
  assert.equal(cut.aborted, true);
  assert.ok(cut.body.length <= 16 * 1024 * 1024);
  // The same, arriving in 1 MiB chunks: headers and the first 16 MiB go out, then it is cut.
  let sent = 0;
  const chunked = await fixture(t, { fetchUpstream: async () => new Response(new ReadableStream({
    pull(controller) { if (sent++ < 17) controller.enqueue(new Uint8Array(1024 * 1024).fill(32)); else controller.close(); },
  }), { headers: { "content-type": "application/json" } }) });
  const midway = await raw(chunked.port, "/api/widgets.json", headers);
  assert.equal(midway.aborted, true);
  assert.ok(midway.body.length <= 16 * 1024 * 1024, String(midway.body.length));
});

// ---- Socket tickets: a socket held open through a Vercel Function bills function time
// for as long as it is open, so the browser opens its sockets on the gateway itself and proves, with a short-lived signed ticket this
// layer issues to a signed-in user, that it was let in here first.
test("a socket ticket binds one target, expires, and needs the gateway token", () => {
  const token = env.BACKEND_GATEWAY_TOKEN, now = 1_800_000_000_000;
  const ticket = socketTicket(token, "/news/ws/news", now);
  assert.match(ticket, /^\d{13}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(ticket.split(".")[0], String(now + 30_000)); // thirty seconds, in epoch ms
  assert.equal(socketTicketValid(token, "/news/ws/news", ticket, now + 29_000), true);
  assert.equal(socketTicketValid(token, "/news/ws/news", ticket, now + 30_001), false);
  assert.equal(socketTicketValid(token, "/grid/live_grid_ws", ticket, now), false);
  assert.equal(socketTicketValid(token + "x", "/news/ws/news", ticket, now), false);
  // A forged far-future expiry breaks the signature; junk never throws.
  assert.equal(socketTicketValid(token, "/news/ws/news", ticket.replace(/^\d+/, "9999999999999"), now), false);
  for (const junk of ["", "a.b.c", "1.2", ticket + ".x", null, undefined, 7]) {
    assert.equal(socketTicketValid(token, "/news/ws/news", junk, now), false);
  }
  // The ticket never carries the token it is keyed with.
  assert.equal(ticket.includes(token), false);
});

test("the ticket route issues only to a session, and only for the vendored policy's socket targets", async t => {
  const { call, cfg } = await fixture(t);
  const c = await cookie();
  const ask = target => call("/socket-ticket?for=" + encodeURIComponent(target), { headers: { cookie: c } });
  assert.equal((await call("/socket-ticket?for=%2Fnews%2Fws%2Fnews")).status, 401); // session gate runs first

  const news = await ask("/news/ws/news");
  assert.equal(news.status, 200);
  const url = new URL(JSON.parse(news.body).url);
  assert.equal(url.protocol + "//" + url.host + url.pathname, "wss://gateway.example.com/news/ws/news");
  assert.equal(socketTicketValid(cfg.token, "/news/ws/news", url.searchParams.get("ticket"), Date.now()), true);
  assert.equal(news.body.includes(cfg.token), false);

  // socketTarget (policy.mjs, vendored from openbq-docker v10.0.0) names three sockets:
  // /news/ws/news and /grid/live_grid_ws with no query, and /grid/ta_chart_ws with the
  // query /grid/ta_chart's grammar admits, re-serialised. The grid's ticket is signed
  // over exactly its target.
  const grid = await ask("/grid/live_grid_ws");
  assert.equal(grid.status, 200);
  const gridUrl = new URL(JSON.parse(grid.body).url);
  assert.equal(gridUrl.protocol + "//" + gridUrl.host + gridUrl.pathname, "wss://gateway.example.com/grid/live_grid_ws");
  assert.deepEqual([...gridUrl.searchParams.keys()], ["ticket"]);
  assert.equal(socketTicketValid(cfg.token, "/grid/live_grid_ws", gridUrl.searchParams.get("ticket"), Date.now()), true);
  const ta = await ask("/grid/ta_chart_ws?symbol=AAPL&interval=5m");
  assert.equal(ta.status, 200);
  const taUrl = JSON.parse(ta.body).url;
  assert.ok(taUrl.startsWith("wss://gateway.example.com/grid/ta_chart_ws?symbol=AAPL&interval=5m&ticket="), taUrl);
  assert.equal(socketTicketValid(cfg.token, "/grid/ta_chart_ws?symbol=AAPL&interval=5m",
    new URL(taUrl).searchParams.get("ticket"), Date.now()), true);

  // Every other target 404s: the study sockets, any query on the grid socket (a token
  // or a ticket in it included), a tick-chart query its grammar refuses, and the rest.
  for (const target of ["/grid/ta_series_ws?symbol=AAPL&interval=5m",
    "/grid/live_grid_ws?symbol=AAPL", "/grid/live_grid_ws?token=x", "/grid/live_grid_ws?ticket=1.n.s",
    "/grid/live_grid_ws/", "/grid/ta_chart_ws?symbol=AAPL&provider=eodhd", "/grid/ta_chart_ws?symbol=AAPL&token=x",
    "/grid/ta_chart_ws?symbol=AAPL&interval=7m", "https://evil.example.com/grid/live_grid_ws",
    "//evil.example.com/grid/live_grid_ws",
    "/tick", "/news/ws/news?x=1", "https://evil.example.com/news/ws/news", "//evil.example.com/news/ws/news",
    "/api/api/v1/equity/price/quote", ""]) {
    assert.equal((await ask(target)).status, 404, target);
  }
  // Exactly one `for`, and nothing else on the query.
  assert.equal((await call("/socket-ticket?for=%2Fnews%2Fws%2Fnews&for=%2Ftick", { headers: { cookie: c } })).status, 404);
  assert.equal((await call("/socket-ticket?for=%2Fnews%2Fws%2Fnews&x=1", { headers: { cookie: c } })).status, 404);
  assert.equal((await call("/socket-ticket?for=%2Fnews%2Fws%2Fnews", { method: "POST", headers: { cookie: c } })).status, 405);
});

test("a news ticket is 503 without approved feeds or a gateway: the socket could only close", async t => {
  const c = await cookie();
  const noFeeds = configuration(); noFeeds.feeds = {};
  const noBackend = configuration(); noBackend.backend = null; noBackend.token = null;
  for (const config of [noFeeds, noBackend]) {
    const { call } = await fixture(t, { config });
    const res = await call("/socket-ticket?for=%2Fnews%2Fws%2Fnews", { headers: { cookie: c } });
    assert.equal(res.status, 503);
    assert.equal(res.body.includes("ticket"), false);
  }
});

test("/preview-feeds.json publishes the approved feeds as News card rows, names and tabs empty", async t => {
  const { call } = await fixture(t);
  const res = await call("/preview-feeds.json", { headers: { cookie: await cookie() } });
  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(res.body), { feeds: [{ url: "https://feeds.example.com/news.xml", name: "", tab: "" }] });
  // The ids are the gateway's business, not the page's.
  assert.equal(res.body.includes("7"), false);
});

// ---- Per-user state (owner's ruling 2026-09-20: on the NAS, behind the gateway).
function stateUpstream(files = {}) {
  const seen = [];
  const fetchUpstream = async (url, init = {}) => {
    seen.push({ url, method: init.method ?? "GET", body: init.body?.toString(), headers: init.headers });
    if ((init.method ?? "GET") === "GET") return new Response(JSON.stringify({ files }), { headers: { "content-type": "application/json" } });
    return new Response(null, { status: 204 });
  };
  return { seen, fetchUpstream };
}
const sameOrigin = c => ({ cookie: c, origin: env.APP_ORIGIN, "content-type": "application/json", "sec-fetch-site": "same-origin" });

test("a write goes to the signed-in user's own state, and only a write shaped like one", async t => {
  const { seen, fetchUpstream } = stateUpstream();
  const { call, cfg } = await fixture(t, { fetchUpstream });
  const c = await cookie(), body = '{"theme":"dark"}';
  const put = await call("/state/settings.json", { method: "PUT", headers: sameOrigin(c), body });
  assert.equal(put.status, 204);
  // The user in the path is the session's GitHub id -- never anything the browser sent.
  assert.deepEqual(seen.map(r => [r.method, r.url, r.body]), [["PUT", "https://gateway.example.com/state/42/settings.json", body]]);
  assert.equal(seen[0].headers.Authorization, `Bearer ${cfg.token}`);
  assert.equal((await call("/state/dashboards/preview.json", { method: "DELETE", headers: sameOrigin(c) })).status, 204);
  assert.deepEqual([seen[1].method, seen[1].url], ["DELETE", "https://gateway.example.com/state/42/dashboards/preview.json"]);

  const refused = async (status, path, options) => assert.equal((await call(path, options)).status, status, JSON.stringify([path, options.method]));
  await refused(401, "/state/settings.json", { method: "PUT", headers: { ...sameOrigin(c), cookie: "" }, body });
  await refused(403, "/state/settings.json", { method: "PUT", headers: { ...sameOrigin(c), origin: "https://evil.example.com" }, body });
  const noOrigin = sameOrigin(c); delete noOrigin.origin;
  await refused(403, "/state/settings.json", { method: "PUT", headers: noOrigin, body });
  await refused(403, "/state/settings.json", { method: "PUT", headers: { ...sameOrigin(c), "sec-fetch-site": "same-site" }, body });
  await refused(403, "/state/settings.json", { method: "PUT", headers: { ...sameOrigin(c), "sec-fetch-site": "cross-site" }, body });
  await refused(415, "/state/settings.json", { method: "PUT", headers: { ...sameOrigin(c), "content-type": "text/plain" }, body });
  await refused(400, "/state/settings.json", { method: "PUT", headers: sameOrigin(c), body: "not json" });
  await refused(413, "/state/settings.json", { method: "PUT", headers: sameOrigin(c), body: JSON.stringify("x".repeat(262145)) });
  for (const path of ["/state/files/a.pdf", "/state/settings.json.tmp", "/state/43/settings.json", "/state/settings.json?x=1", "/state/"]) {
    await refused(404, path, { method: "PUT", headers: sameOrigin(c), body });
  }
  await refused(405, "/state/settings.json", { method: "POST", headers: sameOrigin(c), body });
  await refused(405, "/state/settings.json", { method: "GET", headers: sameOrigin(c) });
  // Every other route is exactly as GET-only as it was.
  await refused(405, "/api/widgets.json", { method: "PUT", headers: sameOrigin(c), body });
  await refused(405, "/socket-ticket?for=%2Fnews%2Fws%2Fnews", { method: "PUT", headers: sameOrigin(c), body });
  assert.equal(seen.length, 2);
});

test("a gateway refusal of a write is relayed as a size or a failure, never its body", async t => {
  for (const [upstream, expected] of [[413, 413], [429, 502], [500, 502], [401, 502]]) {
    const { call } = await fixture(t, { fetchUpstream: async () => new Response("secret detail", { status: upstream }) });
    const res = await call("/state/settings.json", { method: "PUT", headers: sameOrigin(await cookie()), body: "{}" });
    assert.equal(res.status, expected); assert.equal(res.body.includes("secret"), false);
  }
});

test("the page is seeded from the user's saved state, and told it may save", async t => {
  const saved = { "settings.json": '{"theme":"dark"}', "dashboards/mine.json": '{"id":"mine","name":"Mine </script>","tabs":[]}' };
  const { seen, fetchUpstream } = stateUpstream(saved);
  const { call } = await fixture(t, { fetchUpstream });
  const js = (await call("/preview-bootstrap.js", { headers: { cookie: await cookie() } })).body;
  assert.deepEqual([seen[0].method, seen[0].url], ["GET", "https://gateway.example.com/state/42"]);
  assert.match(js, /window\.__bdobbPersist=true;/);
  assert.match(js, /"dashboards\/mine\.json"/);
  assert.doesNotMatch(js, /dashboards\/preview\.json/);      // saved state replaces the default seed, it is not merged into it
  assert.doesNotMatch(js, /<\/script>/);                     // still escaped
  assert.match(js, /Changes are saved to your account/);
});

test("nothing saved yet seeds the default dashboard and still saves; a store that cannot be read does not", async t => {
  const empty = stateUpstream();
  const first = await fixture(t, { fetchUpstream: empty.fetchUpstream });
  const js = (await first.call("/preview-bootstrap.js", { headers: { cookie: await cookie() } })).body;
  assert.match(js, /window\.__bdobbPersist=true;/); assert.match(js, /dashboards\/preview\.json/);

  // Saving over a store we could not read would replace the user's dashboards with the defaults.
  for (const fetchUpstream of [async () => new Response("x", { status: 502 }), async () => { throw new Error("down"); },
    async () => new Response("not json", { headers: { "content-type": "application/json" } }),
    async () => new Response('{"files":{"../evil":"{}","settings.json":7}}', { headers: { "content-type": "application/json" } })]) {
    const broken = await fixture(t, { fetchUpstream });
    const text = (await broken.call("/preview-bootstrap.js", { headers: { cookie: await cookie() } })).body;
    assert.doesNotMatch(text, /__bdobbPersist/); assert.match(text, /dashboards\/preview\.json/);
    assert.match(text, /Changes reset on reload/);
  }
});

test("the reference family is admitted under /ref and the live grid socket is a valid target", () => {
  const cfg = configuration();
  for (const ok of ["/ref/widgets.json", "/ref/apps.json", "/ref/metric_widget", "/ref/data/prices",
    "/ref/agents.json", "/ref/assets/bdobb-logo.svg"]) {
    assert.equal(upstreamPath(new URL(ok, cfg.origin), cfg), ok, ok);
  }
  for (const bad of ["/ref/widgets.json?x=1", "/ref/omni-sql-widget", "/ref/assets/other.svg", "/ref/Metric_Widget"]) {
    assert.equal(upstreamPath(new URL(bad, cfg.origin), cfg), null, bad);
  }
  assert.equal(socketTarget("/ref/live_grid_ws", cfg.origin), "/ref/live_grid_ws");
  assert.equal(socketTarget("/ref/live_grid_ws?x=1", cfg.origin), null);
  assert.equal(socketTarget("/news/ws/news", cfg.origin), "/news/ws/news"); // the wire joins it at v8
  // The live grid's frames: a symbol or a comma list, rebuilt; any other key or shape is refused.
  // (A binary frame is refused before this, by the gateway's message handler: its own tests.)
  assert.equal(refSubscription('{"params":{"symbol":"AAPL"}}'), '{"params":{"symbol":"AAPL"}}');
  assert.equal(refSubscription('{ "params": { "symbol": "AAPL,MSFT" } }'), '{"params":{"symbol":"AAPL,MSFT"}}');
  for (const bad of ['{"params":{"symbol":"AAPL"},"admin":1}', '{"params":{"symbol":"AAPL","x":1}}',
    '{"params":["AAPL"]}', '{"params":{"symbol":7}}', '"AAPL"', "not-json"]) assert.equal(refSubscription(bad), null, bad);
});

test("/ref paths that only a raw request can spell never reach the gateway", async t => {
  const seen = [];
  const { call } = await fixture(t, { fetchUpstream: async url => { seen.push(url);
    return new Response("{}", { headers: { "content-type": "application/json" } }); } });
  const headers = { cookie: await cookie() };
  assert.equal((await call("/ref//x", { headers })).status, 404); // an empty segment: no route
  assert.equal((await call("/ref/x/../y", { headers })).status, 421); // a URL would normalise it away
  assert.deepEqual(seen, []);
});

test("web/policy.mjs is the stack's contract, verbatim, at or below the paired stack tag", () => {
  const text = readFileSync(new URL("./policy.mjs", import.meta.url), "utf8");
  const pin = JSON.parse(readFileSync(new URL("./policy.vendored.json", import.meta.url), "utf8"));
  // The stack is Adventures-OpenBQ/openbq-docker from v8 (ruling R3b): the header names it.
  const header = /^\/\/ vendored from openbq-docker (v\d+\.\d+\.\d+) funnel-gateway\/policy\.mjs sha256:([0-9a-f]{64})\n/.exec(text);
  assert.ok(header, "first line names the tag and the hash");
  assert.equal(pin.repository, "https://github.com/Adventures-OpenBQ/openbq-docker");
  assert.equal(pin.path, "funnel-gateway/policy.mjs");
  assert.match(pin.commit, /^[0-9a-f]{40}$/);
  assert.equal(header[1], pin.tag);
  assert.equal(header[2], pin.sha256);
  assert.equal(createHash("sha256").update(text.slice(header[0].length)).digest("hex"), pin.sha256);
  const paired = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).openbqDocker;
  if (/^[0-9a-f]{40}$/.test(paired)) {
    // Paired with the stack's release branch before its tag is cut: the copy must come from
    // exactly that commit (scripts/gateway-vendor.mjs records it), not from anything newer.
    assert.equal(pin.commit, paired, `vendored from ${pin.commit}, paired with ${paired}`);
    return;
  }
  // The at-or-below rule: an app line never vendors a contract newer than the stack it pairs with.
  const num = v => v.replace(/^v/, "").split(".").map(Number);
  assert.ok(num(pin.tag).every((n, i) => n <= num(paired)[i] || num(pin.tag).slice(0, i).some((m, j) => m < num(paired)[j])),
    `${pin.tag} is above the paired stack tag ${paired}`);
});

// Portable Pivot is still private and never falls through to an HTML response.
test("private Wasm assets have streaming MIME, no-store cache and strict routes", async t => {
  const { call } = await fixture(t);
  assert.equal((await call("/assets/pivot-test.wasm")).status, 401);
  const headers = { cookie: await cookie() };
  const response = await call("/assets/pivot-test.wasm", { headers });
  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/wasm");
  assert.equal(response.headers["cache-control"], "private, no-store");
  assert.equal(response.headers["vercel-cdn-cache-control"], "no-store");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.doesNotMatch(response.headers["content-security-policy"], /(?:^| )'unsafe-eval'/);
  for (const path of ["/assets/missing.wasm", "/assets/pivot-test.wasm?x=1",
    "/assets/../pivot-test.wasm", "/pivot-test.wasm", "/assets/pivot-test.wasm.map"]) {
    const refused = await call(path, { headers });
    assert.equal(refused.status, path.includes("..") ? 421 : 404, path);
    assert.doesNotMatch(refused.headers["content-type"], /html/, path);
  }
  assert.equal(response.headers["cross-origin-embedder-policy"], undefined);
  assert.equal(response.headers["cross-origin-opener-policy"], undefined);
});

test("private web policy permits only Wasm compilation alongside self", async t => {
  const { call } = await fixture(t);
  const response = await call("/assets/pivot-test.wasm", { headers: { cookie: await cookie() } });
  assert.match(response.headers["content-security-policy"], /script-src 'self' 'wasm-unsafe-eval'/);
  assert.doesNotMatch(response.headers["content-security-policy"], /(?:^| )'unsafe-eval'/);
});

// ---- live-grid's /grid family (Ep. 10; donor c183f880) ----------------------
//
// The relay was written against openbb-docker v10.1.7's funnel-gateway contract and
// switches itself on only when the vendored policy serves the grid socket
// (gridSocketServed). The vendored policy is openbq-docker v10.0.0's (the bytes policy.vendored.json records, V10-P3
// resolved), which does. So the grid tests below run under the VENDORED policy, and the
// switch is still proved the other way with `withoutGrid`: the same policy with every
// /grid rule taken out, which is what openbq-docker v8.0.0's (cab61a9) admitted.
const withoutGrid = {
  ...vendoredPolicy,
  liveGridSubscription: undefined,
  upstreamPath(url, config) {
    return url.pathname.startsWith("/grid/") ? null : vendoredPolicy.upstreamPath(url, config);
  },
  socketTarget(raw, origin) {
    const target = vendoredPolicy.socketTarget(raw, origin);
    return target?.startsWith("/grid/") ? null : target;
  },
};
const jsonResponse = body => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

test("the vendored v10.0.0 policy serves the /grid family; a policy without the grid rules refuses all of it", async t => {
  assert.equal(gridSocketServed(vendoredPolicy, env.APP_ORIGIN), true);
  assert.equal(gridSocketServed(withoutGrid, env.APP_ORIGIN), false);
  const c = await cookie();
  const documents = ["/grid/widgets.json", "/grid/apps.json", "/grid/live_grid?symbol=AAPL", "/grid/symbol_meta?symbol=AAPL"];

  // Served: the four documents the grid card reads, its ticket and the seeded tab.
  const asked = [];
  const served = await fixture(t, { fetchUpstream: async url => { asked.push(url); return jsonResponse([]); } });
  for (const path of documents) assert.equal((await served.call(path, { headers: { cookie: c } })).status, 200, path);
  assert.deepEqual(asked, documents.map(p => env.BACKEND_GATEWAY_ORIGIN + p));
  assert.equal((await served.call("/socket-ticket?for=%2Fgrid%2Flive_grid_ws", { headers: { cookie: c } })).status, 200);
  assert.ok((await served.call("/preview-bootstrap.js", { headers: { cookie: c } })).body.includes("preview-grid"));

  // Without the grid rules: every route, the ticket and the socket refused, nothing asked
  // upstream, and the seed names no backend the door refuses.
  const { call, port } = await fixture(t, { policy: withoutGrid,
    fetchUpstream: async () => { throw new Error("nothing /grid may be asked for without the grid rules"); } });
  for (const path of documents) assert.equal((await call(path, { headers: { cookie: c } })).status, 404, path);
  assert.equal((await call("/socket-ticket?for=%2Fgrid%2Flive_grid_ws", { headers: { cookie: c } })).status, 404);
  assert.equal(await rejectedWs(port, "/grid/live_grid_ws", { cookie: c, origin: env.APP_ORIGIN }), 404);
  const seeded = await call("/preview-bootstrap.js", { headers: { cookie: c } });
  assert.ok(!seeded.body.includes("preview-grid"));
});

test("the example's /grid routes are relayed under their grammars, and nothing outside them is", async t => {
  const asked = [];
  const { call } = await fixture(t, { fetchUpstream: async url => { asked.push(url); return jsonResponse({}); } });
  const c = await cookie();
  // What docs/examples/v10.0.0-live-grid.apps.json's cards ask for: the tick history
  // (kdb_ticks), the cached chart with the theme every chart card carries
  // (kdb_cache_chart) and the series (live_chart).
  for (const path of ["/grid/ticks?symbol=AAPL&limit=200", "/grid/chart?symbol=AAPL&interval=1d&theme=dark",
    "/grid/series?symbol=AAPL&interval=1m", "/grid/series?symbol=AAPL&interval=1m&start=2026-10-01&end=2026-10-12&provider=kdb",
    "/grid/ta_chart?symbol=AAPL&interval=5m&source=local&macro=none&indicators=supertrend:period=10"]) {
    assert.equal((await call(path, { headers: { cookie: c } })).status, 200, path);
  }
  assert.equal(asked.length, 5);
  for (const path of ["/grid/ticks?symbol=AAPL&limit=1001", "/grid/ticks?symbol=AAPL&limit=0", "/grid/ticks?symbol=AAPL,MSFT",
    "/grid/series?symbol=AAPL&interval=7m", "/grid/series?symbol=AAPL&provider=yfinance", "/grid/series?symbol=AAPL&theme=dark",
    "/grid/chart?symbol=AAPL&theme=sepia", "/grid/series?symbol=AAPL&start=T-1d", "/grid/ta_chart?symbol=AAPL&provider=eodhd",
    "/grid/ta_chart?symbol=AAPL&macro=..%2Fx", "/grid/live_grid?symbol=AAPL&token=x", "/grid/widgets.json?token=x",
    "/grid/live_grid?symbol=AAPL;DROP", "/grid/live_grid?symbol=AAPL&symbol=MSFT", "/grid/subscriptions",
    "/grid/api/subscriptions", "/grid/health", "/grid/ta_registry", "/grid/"]) {
    assert.equal((await call(path, { headers: { cookie: c } })).status, 404, path);
  }
  assert.equal(asked.length, 5);
});

// `gateway` stands in for the gateway's side of the socket: by default it records each
// frame and answers with one row; a test may give it the gateway's own refusals.
async function gridRelay(t, { gateway, session = {}, ...options } = {}) {
  const upstream = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await once(upstream, "listening");
  t.after(() => { for (const client of upstream.clients) client.terminate(); upstream.close(); });
  const seen = { frames: [] };
  upstream.on("connection", (client, req) => {
    seen.headers = req.headers; seen.upstream = client;
    client.on("message", data => gateway ? gateway(client, data, seen)
      : (seen.frames.push(data.toString()), client.send('{"symbol":"AAPL","price":1}')));
  });
  const { port } = await fixture(t, { ...options, connectUpstream: (url, opts) => {
    seen.url = url; seen.options = opts;
    return new WebSocket(`ws://127.0.0.1:${upstream.address().port}`, opts);
  } });
  const client = new WebSocket(`ws://127.0.0.1:${port}/grid/live_grid_ws`, {
    headers: { host: "preview.example.com", origin: env.APP_ORIGIN, cookie: await cookie(session) },
  });
  t.after(() => client.terminate()); client.on("error", () => {});
  await once(client, "open");
  return { client, seen };
}

// Review F11: since the no-relay-socket-timer ruling (b9b1c965) the session's deadline is
// a relayed socket's ONLY lifetime -- it must still close both ends when the session ends.
test("a relayed grid socket closes, both ends, when its session expires", async t => {
  const config = configuration(); config.feeds = {};
  const { client, seen } = await gridRelay(t, { config, session: { deadline: Date.now() / 1000 + 1.5 } });
  client.send('{"params":{"symbol":"AAPL"}}');
  await once(client, "message");
  assert.equal(client.readyState, WebSocket.OPEN);
  const upstreamClosed = once(seen.upstream, "close");
  const started = Date.now();
  await once(client, "close");
  await upstreamClosed;
  // Closed by the session deadline, not by some later bound.
  assert.ok(Date.now() - started < 5000);
});

test("the grid relay forwards a REPEATING subscription, rebuilt, and stays open", async t => {
  // No approved feeds: a grid socket needs the gateway and nothing else.
  const config = configuration(); config.feeds = {};
  const { client, seen } = await gridRelay(t, { config });
  client.send('{"params":{"symbol":"AAPL,MSFT"}}');
  const [first] = await once(client, "message");
  assert.equal(JSON.parse(first).symbol, "AAPL");
  // A second frame is the grid's resubscribe on a param edit: forwarded, not a close.
  client.send('{"params":{"symbol":"AAPL"}}');
  await once(client, "message");
  assert.equal(client.readyState, WebSocket.OPEN);
  assert.deepEqual(seen.frames.map(f => JSON.parse(f)), [{ params: { symbol: "AAPL,MSFT" } }, { params: { symbol: "AAPL" } }]);
  assert.equal(seen.url, "wss://gateway.example.com/grid/live_grid_ws");
  // The gateway's Bearer and its own Origin go upstream; the browser's cookie never does.
  assert.equal(seen.options.headers.Authorization, "Bearer " + env.BACKEND_GATEWAY_TOKEN);
  assert.equal(seen.options.headers.Origin, env.BACKEND_GATEWAY_ORIGIN);
  assert.equal(seen.headers.cookie, undefined);
});

// The per-viewer budgets (240 requests a minute, GRID_DAILY_SYMBOLS) were removed (user
// ruling 2026-10-17): repeat grid frames are relayed, however many, and the socket stays open.
test("repeat grid frames are not metered: 300 frames relay and the socket stays open", async t => {
  const { client, seen } = await gridRelay(t, { gateway: (upstream, data, s) => {
    s.frames.push(data.toString());
    if (s.frames.length === 1) upstream.send('{"symbol":"AAPL","price":1}');
  } });
  client.send('{"params":{"symbol":"AAPL,MSFT"}}');
  await once(client, "message");
  for (let i = 0; i < 299; i++) client.send('{"params":{"symbol":"AAPL,MSFT"}}');
  while (seen.frames.length < 300) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(client.readyState, WebSocket.OPEN);
  assert.equal(readConfig({ ...env, GRID_DAILY_SYMBOLS: "5" }).gridDailySymbols, undefined);
});

test("a grid frame the contract refuses closes the socket, and nothing of it is forwarded", async t => {
  for (const frame of ['{"params":{"symbol":"AAPL","extra":1}}', '{"params":{"symbol":"AAPL"},"x":1}',
    '{"params":{"symbol":"AAPL;DROP"}}', '{"subscribe":[]}', "not json", Buffer.from("binary")]) {
    const { client, seen } = await gridRelay(t);
    client.send(frame);
    await once(client, "close");
    assert.deepEqual(seen.frames, [], String(frame));
  }
});

test("a grid ticket without feeds, 503 without a gateway, no query on the socket", async t => {
  const c = await cookie();
  const noFeeds = configuration(); noFeeds.feeds = {};
  const { call, cfg, port } = await fixture(t, { config: noFeeds });
  const res = await call("/socket-ticket?for=%2Fgrid%2Flive_grid_ws", { headers: { cookie: c } });
  assert.equal(res.status, 200);
  const url = new URL(JSON.parse(res.body).url);
  assert.equal(url.protocol + "//" + url.host + url.pathname, "wss://gateway.example.com/grid/live_grid_ws");
  assert.equal(socketTicketValid(cfg.token, "/grid/live_grid_ws", url.searchParams.get("ticket"), Date.now()), true);
  assert.equal(await rejectedWs(port, "/grid/live_grid_ws?symbol=AAPL", { cookie: c, origin: env.APP_ORIGIN }), 404);
  assert.equal(await rejectedWs(port, "/grid/live_grid_ws", { origin: env.APP_ORIGIN }), 401);
  const noBackend = configuration(); noBackend.backend = null; noBackend.token = null;
  const bare = await fixture(t, { config: noBackend });
  assert.equal(await rejectedWs(bare.port, "/grid/live_grid_ws", { cookie: c, origin: env.APP_ORIGIN }), 503);
  assert.equal((await bare.call("/socket-ticket?for=%2Fgrid%2Flive_grid_ws", { headers: { cookie: c } })).status, 503);
});

test("the gateway's bare 404 for an optional /grid document is relayed as a 404; any other failure is a 502", async t => {
  const asked = [];
  const { call } = await fixture(t, { fetchUpstream: async url => {
    asked.push(url);
    return new Response("not found: secret detail", { status: 404, headers: { "content-type": "text/plain" } });
  } });
  const c = await cookie();
  for (const path of ["/grid/apps.json", "/grid/symbol_meta?symbol=AAPL%2CMSFT"]) {
    const res = await call(path, { headers: { cookie: c } });
    assert.equal(res.status, 404, path);
    assert.ok(!res.body.includes("secret"), path);
  }
  assert.equal((await call("/grid/live_grid?symbol=AAPL", { headers: { cookie: c } })).status, 502);
  assert.equal((await call("/api/apps.json", { headers: { cookie: c } })).status, 502);
  assert.equal(asked[1], "https://gateway.example.com/grid/symbol_meta?symbol=AAPL%2CMSFT");
});

// What the gateway refuses on /grid, the preview refuses too, or carries to the
// gateway unchanged so it can (openbq-docker v10.0.0 funnel-gateway/server.mjs):
// a credential in the query, a foreign or missing Origin, an expired or reused
// ticket, and the 61st frame on one socket (FRAME_CAP).
test("the grid socket refuses a token or ticket in its query, a foreign or missing Origin, and no session", async t => {
  const { call, port } = await fixture(t, { connectUpstream: () => { throw new Error("no refused upgrade may dial the gateway"); } });
  const c = await cookie();
  const issued = new URL(JSON.parse((await call("/socket-ticket?for=%2Fgrid%2Flive_grid_ws", { headers: { cookie: c } })).body).url);
  // A ticket is for the gateway, on the gateway's own host: this relay is the Bearer
  // path and takes no credential in a query, the signed ticket included.
  for (const path of ["/grid/live_grid_ws?token=" + env.BACKEND_GATEWAY_TOKEN, "/grid/live_grid_ws?access_token=x",
    "/grid/live_grid_ws?apikey=x", "/grid/live_grid_ws" + issued.search, "/grid/live_grid_ws?symbol=AAPL&" + issued.search.slice(1)]) {
    assert.equal(await rejectedWs(port, path, { cookie: c, origin: env.APP_ORIGIN }), 404, path);
  }
  assert.equal(await rejectedWs(port, "/grid/live_grid_ws", { cookie: c, origin: "https://evil.example.com" }), 403);
  assert.equal(await rejectedWs(port, "/grid/live_grid_ws", { cookie: c, origin: env.BACKEND_GATEWAY_ORIGIN }), 403);
  assert.equal(await rejectedWs(port, "/grid/live_grid_ws", { cookie: c }), 403);
  assert.equal(await rejectedWs(port, "/grid/live_grid_ws", { origin: env.APP_ORIGIN }), 401);
  assert.equal(await rejectedWs(port, "/grid/live_grid_ws", { cookie: c, origin: "https://evil.example.com",
    "sec-fetch-site": "cross-site", "sec-fetch-mode": "websocket", "sec-fetch-dest": "websocket" }), 403);
  // The HTTP half: a foreign Origin is refused before any /grid route is matched.
  assert.equal((await call("/grid/live_grid?symbol=AAPL", { headers: { cookie: c, origin: "https://evil.example.com" } })).status, 403);
  assert.equal((await call("/grid/live_grid?symbol=AAPL", { headers: { authorization: "Bearer " + env.BACKEND_GATEWAY_TOKEN } })).status, 401);
});

test("a grid ticket lasts thirty seconds, names one target, and is single-use at the gateway", async t => {
  const { call, cfg } = await fixture(t);
  const c = await cookie();
  const ticketOf = async () => new URL(JSON.parse((await call("/socket-ticket?for=%2Fgrid%2Flive_grid_ws",
    { headers: { cookie: c } })).body).url).searchParams.get("ticket");
  const asked = Date.now();
  const first = await ticketOf(), second = await ticketOf();
  const now = Date.now(), expiry = Number(first.split(".")[0]);
  assert.ok(expiry >= asked + 30_000 && expiry <= now + 30_000, String(expiry - now));
  // The gateway's own check (the vendored socketTicketNonce): exactly this target, and
  // not once the expiry has passed.
  assert.ok(socketTicketNonce(cfg.token, "/grid/live_grid_ws", first, now));
  assert.equal(socketTicketNonce(cfg.token, "/grid/live_grid_ws", first, expiry + 1), null);
  for (const other of ["/news/ws/news", "/grid/ta_chart_ws", "/grid/live_grid_ws?symbol=AAPL"]) {
    assert.equal(socketTicketNonce(cfg.token, other, first, now), null, other);
  }
  assert.equal(socketTicketNonce("another-gateway-token", "/grid/live_grid_ws", first, now), null);
  // Single use: the gateway admits a nonce once (its `admitted` map, until the ticket's
  // expiry). Each ticket carries its own nonce, so a reconnect is a new ticket and a
  // replayed one is refused -- mirrored here exactly as the gateway's upgrade does it.
  const admitted = new Map();
  const admit = ticket => {
    const nonce = socketTicketNonce(cfg.token, "/grid/live_grid_ws", ticket, now);
    if (!nonce || admitted.has(nonce)) return false;
    admitted.set(nonce, Number(ticket.split(".")[0])); return true;
  };
  assert.notEqual(first, second);
  assert.equal(admit(first), true);
  assert.equal(admit(first), false);
  assert.equal(admit(second), true);
});

test("the gateway's 60-frame cap closes the browser's socket, and nothing past it is answered", async t => {
  const FRAME_CAP = 60; // openbq-docker v10.0.0 funnel-gateway/server.mjs
  let frames = 0;
  const { client, seen } = await gridRelay(t, { gateway: (upstream, data) => {
    if (++frames > FRAME_CAP) return upstream.close();
    seen.frames.push(data.toString());
    upstream.send(JSON.stringify({ symbol: "AAPL", price: frames }));
  } });
  const answers = [];
  client.on("message", m => answers.push(JSON.parse(m).price));
  client.send('{"params":{"symbol":"AAPL"}}');
  await once(client, "message");
  // The relay re-validates every frame; the cap is the gateway's, and its close
  // reaches the browser as a close.
  for (let i = 2; i <= FRAME_CAP + 1; i++) client.send('{"params":{"symbol":"AAPL"}}');
  await once(client, "close");
  assert.equal(seen.frames.length, FRAME_CAP);
  assert.equal(answers.length, FRAME_CAP);
  assert.equal(answers.at(-1), FRAME_CAP);
  assert.equal(client.readyState, WebSocket.CLOSED);
});

test("bootstrap seeds the Live quotes tab only with a gateway AND a policy that serves the grid socket", () => {
  const withGrid = bootstrap(configuration(), undefined, { grid: true });
  assert.ok(withGrid.includes("preview-grid"));
  assert.ok(withGrid.includes('\\"widgetId\\":\\"live_grid\\"'));
  assert.ok(withGrid.includes("https://preview.example.com/grid"));
  assert.ok(!withGrid.includes(env.BACKEND_GATEWAY_ORIGIN));
  const cfg = configuration(); cfg.backend = null; cfg.token = null;
  for (const text of [bootstrap(configuration()), bootstrap(configuration(), undefined, { grid: false }), bootstrap(cfg, undefined, { grid: true })]) {
    assert.ok(!text.includes("preview-grid"));
    assert.ok(!text.includes('\\"widgetId\\":\\"live_grid\\"'));
  }
});


test("managed table web relay derives owner from session, requires CSRF and strips spoofed credentials",async t=>{
  const calls=[];
  const cfg={...configuration(),tableRelayToken:"separate_private_relay_credential_12345",ssrmRoutes:["/api/api/v1/test/rows"]};
  const {call}=await fixture(t,{config:cfg,fetchUpstream:async(url,options)=>{calls.push({url,options});return new Response('{"sessionId":"session_test"}',{headers:{"Content-Type":"application/json","Set-Cookie":"bad=secret"}});}});
  const headers={cookie:await cookie(),Origin:cfg.origin,"Content-Type":"application/json","X-Table-Principal":"github:99","X-Table-Relay-Token":"forged","X-Table-Gateway-Token":"forged"};
  assert.equal((await call("/table/sessions",{method:"POST",headers:{...headers,Origin:"https://evil.example.com"},body:"{}"})).status,403);
  const result=await call("/table/sessions",{method:"POST",headers,body:"{}"});assert.equal(result.status,200);
  assert.equal(result.headers["set-cookie"],undefined);
  assert.equal(calls[0].options.headers["X-Table-Principal"],"github:42");
  assert.equal(calls[0].options.headers["X-Table-Relay-Token"],cfg.tableRelayToken);
  assert.equal(calls[0].options.headers["X-Table-Gateway-Token"],undefined);
  assert.equal((await call("/table/sessions/x/derive",{method:"POST",headers:{...headers,cookie:await cookie({deadline:Date.now()/1000+1800})},body:"{}"})).status,200);
  assert.equal(calls[1].options.headers["X-Table-Principal"],"github:42");
  assert.equal((await call("/api/api/v1/test/rows",{method:"POST",headers,body:"{}"})).status,200);
  assert.equal((await call("/api/api/v1/test/other",{method:"POST",headers,body:"{}"})).status,405);
  assert.equal((await call("/table/healthz",{headers:{}})).status,401);
  assert.equal((await call("/table/sessions",{method:"POST",headers:{...headers,"Content-Length":2097153},body:"{}"})).status,413);
});

test("table web refuses missing relay, failed batch streams, deadlines and discloses no secrets in discovery",async t=>{
  const headers={cookie:await cookie(),Origin:env.APP_ORIGIN,"Content-Type":"application/json"};
  const absent=await fixture(t);assert.equal((await absent.call("/table/healthz",{headers})).status,503);
  const cfg={...configuration(),tableRelayToken:"separate_private_relay_credential_12345",tableTimeoutMs:20};
  const bootstrapText=bootstrap(cfg,{});assert.ok(bootstrapText.includes("preview-table"));assert.ok(!bootstrapText.includes(cfg.tableRelayToken));
  for(const kind of ["broken","oversized","timeout","refused"]){
    const {call}=await fixture(t,{config:cfg,fetchUpstream:async(_url,options)=>{
      if(kind === "timeout")return new Promise((_,reject)=>options.signal.addEventListener("abort",()=>reject(new Error("secret failure")),{once:true}));
      if(kind === "refused")return new Response('{"error":"secret failure"}',{status:410,headers:{"Content-Type":"application/json"}});
      if(kind === "oversized")return new Response(JSON.stringify({text:"x".repeat(8388608)}),{headers:{"Content-Type":"application/json"}});
      return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{"partial":'));controller.error(new Error("secret failure"));}}),{headers:{"Content-Type":"application/json"}});
    }});
    const result=await call("/table/exports/export_1/batches?sequence=0",{headers});assert.equal(result.status,kind === "refused"?410:502);assert.doesNotMatch(result.body,/secret failure|partial|xxxxxxxx/);
  }
  assert.throws(()=>readConfig({...env,TABLE_RELAY_TOKEN:env.BACKEND_GATEWAY_TOKEN}));
  assert.throws(()=>readConfig({...env,SSRM_ROUTES_JSON:'["/api/api/v1/a/../b"]'}));
});

test("table upload relays a percent-encoded 255-byte filename (765 characters) and drops longer",async t=>{
  const calls=[];
  const cfg={...configuration(),tableRelayToken:"separate_private_relay_credential_12345"};
  const {call}=await fixture(t,{config:cfg,fetchUpstream:async(url,options)=>{calls.push(options.headers);return new Response('{"sourceId":"s_x"}',{headers:{"Content-Type":"application/json"}});}});
  const headers={cookie:await cookie(),Origin:cfg.origin,"Content-Type":"text/csv","Idempotency-Key":"k"};
  const name=encodeURIComponent("表".repeat(85));assert.equal(name.length,765);
  assert.equal((await call("/table/sources/uploads",{method:"POST",headers:{...headers,"X-Upload-Filename":name},body:"a\n1"})).status,200);
  assert.equal(calls[0]["x-upload-filename"],name);
  assert.equal((await call("/table/sources/uploads",{method:"POST",headers:{...headers,"X-Upload-Filename":name+"a"},body:"a\n1"})).status,200);
  assert.equal(calls[1]["x-upload-filename"],undefined);
});

test("SSRM relays get their own deadline (default 170 s, at most 300 s); managed table routes keep theirs",async t=>{
  assert.equal(configuration().ssrmTimeoutMs,170000);
  assert.equal(readConfig({...env,SSRM_TIMEOUT_MS:"300000"}).ssrmTimeoutMs,300000);
  for(const bad of ["300001","999","1.5","x"])assert.throws(()=>readConfig({...env,SSRM_TIMEOUT_MS:bad}),/SSRM_TIMEOUT_MS/);
  const cfg={...configuration(),tableRelayToken:"separate_private_relay_credential_12345",ssrmRoutes:["/api/api/v1/test/rows"],tableTimeoutMs:20,ssrmTimeoutMs:2000};
  const {call}=await fixture(t,{config:cfg,fetchUpstream:(_url,options)=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>resolve(new Response('{"rows":[]}',{headers:{"Content-Type":"application/json"}})),100);
    options.signal.addEventListener("abort",()=>{clearTimeout(timer);reject(new Error("aborted"));},{once:true});
  })});
  const headers={cookie:await cookie(),Origin:cfg.origin,"Content-Type":"application/json"};
  assert.equal((await call("/api/api/v1/test/rows",{method:"POST",headers,body:"{}"})).status,200);
  assert.equal((await call("/table/sessions",{method:"POST",headers,body:"{}"})).status,502);
});
