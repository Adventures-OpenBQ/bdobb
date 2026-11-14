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
import { encode } from "@auth/core/jwt";
import { WebSocket } from "ws";
import { readConfig, SESSION_COOKIE } from "./config.mjs";
import { chartsRoute } from "./charts-policy.mjs";
import { bootstrap } from "./bootstrap.mjs";
import { createPreviewServer } from "./server.mjs";
import { authConfig } from "./auth.mjs";

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


const charts = { ...env, PREVIEW_CHARTS: "true" };
const ID = "0b5d6f3e-1c2a-4b7e-9a0d-3e2f1a0b9c8d";
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Set-Cookie": "leak=1", ...extra } });
const png = () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "Content-Type": "image/png" } });

test("PREVIEW_CHARTS is true/false and needs the gateway", () => {
  assert.throws(() => readConfig({ ...env, PREVIEW_CHARTS: "yes" }));
  assert.throws(() => readConfig({ ...charts, BACKEND_GATEWAY_ORIGIN: "", BACKEND_GATEWAY_TOKEN: "" }));
  assert.equal(readConfig(charts).charts, true);
  assert.equal(readConfig(env).charts, false);
});

test("the relay admits exactly what the vendored policy admits, prefix stripped, token added server-side", async (t) => {
  const calls = [];
  const { call } = await fixture(t, { config: readConfig(charts), fetchUpstream: async (url, o) => { calls.push({ url, o }); return json({ ok: true }); } });
  const headers = { Cookie: await cookie(), Authorization: "Bearer browser-secret" };
  for (const path of ["/charts", `/charts/${ID}`, `/charts/${ID}/history`, "/ta_registry", "/inbox?limit=20", "/watches?chart_id=" + ID, "/schedules"]) {
    const want = chartsRoute(new URL(path, "https://x"), "GET");
    const res = await call("/arts" + path, { headers });
    assert.equal(res.status, want ? 200 : 404, path);
  }
  assert.equal(calls[0].url, env.BACKEND_GATEWAY_ORIGIN + "/charts");
  assert.equal(calls[0].o.headers.Authorization, "Bearer " + env.BACKEND_GATEWAY_TOKEN);
  assert.equal(calls[0].o.headers.Cookie, undefined);
});

test("refuses every path trick and every unlisted route", async (t) => {
  const calls = [];
  const { call } = await fixture(t, { config: readConfig(charts), fetchUpstream: async (url) => { calls.push(url); return json({}); } });
  const headers = { Cookie: await cookie() };
  for (const path of ["/arts/charts/", "/arts//charts", "/arts///charts", "/arts/charts/%2e%2e/state", "/arts/../state/x", "/arts/charts?x=1", "/arts/state/42/settings.json",
    "/arts/inbox/" + ID + "?t=abc", "/arts/watches/action", "/arts/ta_series_ws", "/arts", "/artsy/charts", "/arts/charts/mcp"]) {
    assert.notEqual((await call(path, { headers })).status, 200, path);
  }
  // The protocol-relative trick specifically: reaches the relay and is refused there (404), not by luck upstream.
  assert.equal((await call("/arts//charts", { headers })).status, 404);
  assert.deepEqual(calls, []);
});

test("off (PREVIEW_CHARTS unset) /arts is a 404", async (t) => {
  const { call } = await fixture(t, { fetchUpstream: async () => json({}) });
  assert.equal((await call("/arts/charts", { headers: { Cookie: await cookie() } })).status, 404);
});

test("snapshot PNGs are the only non-JSON bodies; bodies are capped at the door's 8 MiB JSON / 16 MiB PNG", async (t) => {
  let make = png;
  const { call } = await fixture(t, { config: readConfig(charts), fetchUpstream: async () => make() });
  const headers = { Cookie: await cookie() };
  assert.equal((await call(`/arts/charts/${ID}/snapshot.png`, { headers })).headers["content-type"], "image/png");
  assert.equal((await call(`/arts/inbox/${ID}/snapshots/0.png`, { headers })).headers["content-type"], "image/png");
  assert.equal((await call("/arts/charts", { headers })).status, 502);
  const MiB = 1024 * 1024;
  const sized = (bytes, type) => () => new Response(Buffer.alloc(bytes, 120), { headers: { "Content-Type": type } });
  make = sized(2 * MiB + 1, "application/json");     // a large chart document still passes
  assert.equal((await call("/arts/charts", { headers })).status, 200);
  make = sized(8 * MiB + 1, "application/json");
  assert.equal((await call("/arts/charts", { headers })).status, 502);
  make = sized(2 * MiB + 1, "image/png");            // a dense snapshot still passes
  assert.equal((await call(`/arts/charts/${ID}/snapshot.png`, { headers })).status, 200);
  make = sized(16 * MiB + 1, "image/png");
  assert.equal((await call(`/arts/charts/${ID}/snapshot.png`, { headers })).status, 502);
});

test("POST, PUT and DELETE ask what /state's writes ask", async (t) => {
  const seen = [];
  const { call } = await fixture(t, { config: readConfig(charts), fetchUpstream: async (url, o) => { seen.push(o.method); return o.method === "DELETE" ? new Response(null, { status: 204 }) : json({ id: ID }, o.method === "POST" ? 201 : 200); } });
  const ok = { Cookie: await cookie(), Origin: env.APP_ORIGIN, "Content-Type": "application/json" };
  const one = `/arts/charts/${ID}`;
  assert.equal((await call("/arts/charts", { method: "POST", headers: ok, body: "{}" })).status, 201);
  assert.equal((await call(one, { method: "PUT", headers: ok, body: "{}" })).status, 200);
  assert.equal((await call(one, { method: "DELETE", headers: { Cookie: ok.Cookie, Origin: ok.Origin } })).status, 204);
  assert.deepEqual(seen, ["POST", "PUT", "DELETE"]);
  for (const [method, path] of [["POST", "/arts/charts"], ["PUT", one], ["DELETE", one]]) {
    assert.equal((await call(path, { method, headers: { ...ok, Origin: "https://evil.example.com" }, body: method === "DELETE" ? undefined : "{}" })).status, 403, method);
    assert.equal((await call(path, { method, headers: { Cookie: ok.Cookie } })).status, 403, method + " no origin");
  }
  assert.equal((await call("/arts/charts", { method: "POST", headers: { ...ok, "Content-Type": "text/plain" }, body: "{}" })).status, 415);
  assert.deepEqual(seen, ["POST", "PUT", "DELETE"], "refused writes never go upstream");
});

test("a 409's JSON body passes through; an upstream 401 never does (it would sign the user out)", async (t) => {
  let status = 409;
  const { call } = await fixture(t, { config: readConfig(charts), fetchUpstream: async () => json({ id: ID, version: 3 }, status) });
  const headers = { Cookie: await cookie() };
  const conflict = await call(`/arts/charts/${ID}`, { headers });
  assert.equal(conflict.status, 409);
  assert.equal(JSON.parse(conflict.body).version, 3);
  status = 401;
  assert.equal((await call(`/arts/charts/${ID}`, { headers })).status, 502);
  assert.equal((await call("/arts/charts", { method: "POST", headers: { ...headers, Origin: env.APP_ORIGIN, "Content-Type": "application/json" }, body: "{}" })).status, 502);
});

test("the SSE deadline default sits under the function's 300 s maxDuration", () => {
  const server = readFileSync(new URL("./server.mjs", import.meta.url), "utf8");
  const build = readFileSync(new URL("../scripts/build-web.mjs", import.meta.url), "utf8");
  const deadline = Number(/sseDeadlineMs = (\d+)/.exec(server)[1]);
  const max = Number(/maxDuration: (\d+)/.exec(build)[1]) * 1000;
  assert.ok(deadline <= max - 5000, `${deadline} vs ${max}`);
});

test("SSE passes through as it arrives", async (t) => {
  const { call } = await fixture(t, { config: readConfig(charts), fetchUpstream: async () => new Response(new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode("event: chart\ndata: {}\n\n")); c.close(); } }), { headers: { "Content-Type": "text/event-stream" } }) });
  const res = await call("/arts/charts/events", { headers: { Cookie: await cookie() } });
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /^text\/event-stream/);
  assert.equal(res.body, "event: chart\ndata: {}\n\n");
});

test("the SSE relay ends the stream at the deadline", async (t) => {
  let aborted = false;
  const { call } = await fixture(t, { config: readConfig(charts), sseDeadlineMs: 50, fetchUpstream: async (_u, o) => {
    o.signal.addEventListener("abort", () => { aborted = true; });
    return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(": hi\n\n")); } }), { headers: { "Content-Type": "text/event-stream" } });
  } });
  const res = await call("/arts/charts/events", { headers: { Cookie: await cookie() } });
  assert.equal(res.status, 200);
  assert.equal(res.body, ": hi\n\n");
  assert.equal(aborted, true);
});

test("a ticket is issued for /ta_series_ws only, under its grammar, and opens on the gateway", async (t) => {
  const { call } = await fixture(t, { config: readConfig(charts) });
  const ok = "/arts/ta_series_ws?symbol=AAPL&interval=1d";
  const res = await call("/socket-ticket?for=" + encodeURIComponent(ok), { headers: { Cookie: await cookie() } });
  assert.equal(res.status, 200);
  const url = new URL(JSON.parse(res.body).url);
  assert.equal(url.origin, env.BACKEND_GATEWAY_ORIGIN.replace("https:", "wss:"));
  assert.equal(url.pathname, "/ta_series_ws");
  assert.ok(url.searchParams.get("ticket"));
  for (const bad of ["/arts/ta_series_ws?symbol=AAPL&evil=1", "/arts/charts/events", "/ta_series_ws?symbol=AAPL"]) {
    assert.equal((await call("/socket-ticket?for=" + encodeURIComponent(bad), { headers: { Cookie: await cookie() } })).status, 404, bad);
  }
});

async function rejectedWs(port, path, headers) {
  const client = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: { host: "preview.example.com", ...headers } });
  client.on("error", () => {});
  return new Promise((resolve, reject) => {
    client.on("unexpected-response", (_req, res) => { res.resume(); resolve(res.statusCode); client.terminate(); });
    client.on("open", () => { client.terminate(); reject(new Error("Unexpected upgrade")); });
  });
}
test("the study socket is never relayed by the door: the upgrade is a 404", async (t) => {
  const { port } = await fixture(t, { config: readConfig(charts), connectUpstream: () => { throw new Error("no refused upgrade may dial the gateway"); } });
  assert.equal(await rejectedWs(port, "/arts/ta_series_ws?symbol=AAPL&interval=1d", { origin: env.APP_ORIGIN, cookie: await cookie() }), 404);
});

// The seed carries each file as an escaped JSON string; run it to get the files back.
const seeded = js => { const w = {}; new Function("window", "document", js)(w, { addEventListener() {} }); return w.__bdobbSeed; };
const arts = js => JSON.parse(seeded(js)["backends.json"]).filter(b => b.kind === "arts-charts");

test("the seed adds the connection and one AAPL chart tab only when the policy serves the family", () => {
  const on = bootstrap(readConfig(charts), null, { charts: true });
  assert.deepEqual(arts(on), [{ id: "preview-arts", name: "Art's Charts", baseUrl: "https://preview.example.com/arts", kind: "arts-charts", authLocation: "header", validateWidgets: false }]);
  const tab = JSON.parse(seeded(on)["dashboards/preview.json"]).tabs.find(x => x.id === "charts");
  assert.equal(tab.name, "Art's Charts");
  assert.equal(tab.cards.length, 1);
  assert.equal(tab.cards[0].widgetId, "arts_chart");
  assert.equal(tab.cards[0].backendId, "preview-arts");
  assert.equal(tab.cards[0].params.symbol, "AAPL");
  assert.doesNotMatch(on, new RegExp(env.BACKEND_GATEWAY_TOKEN));
  assert.deepEqual(arts(bootstrap(readConfig(charts), null, { charts: false })), []);
  assert.deepEqual(arts(bootstrap(readConfig(env), null, { charts: true })), []);
  assert.equal(JSON.parse(seeded(bootstrap(readConfig(env), null, { charts: true }))["dashboards/preview.json"]).tabs.some(x => x.id === "charts"), false);
});

test("the vendored charts policy matches its receipt and the paired commit", () => {
  const receipt = JSON.parse(readFileSync(new URL("./charts-policy.vendored.json", import.meta.url), "utf8"));
  const source = readFileSync(new URL("./charts-policy.mjs", import.meta.url), "utf8");
  assert.equal(receipt.interfaceVersion, 12);
  assert.equal(receipt.path, "funnel-gateway/charts-policy.mjs");
  assert.equal(source.split("\n")[0], `// vendored from openbq-docker ${receipt.commit} ${receipt.path} sha256:${receipt.sha256}`);
  assert.equal(createHash("sha256").update(source.slice(source.indexOf("\n") + 1)).digest("hex"), receipt.sha256);
});

test("POST /arts/charts/mcp relays one JSON-RPC message with the session headers and the principal", async (t) => {
  const calls = [];
  const { call } = await fixture(t, { config: readConfig({ ...charts, PREVIEW_RITA: "true" }), fetchUpstream: async (url, o) => { calls.push({ url, o });
    return new Response('{"jsonrpc":"2.0","id":1,"result":{}}', { headers: { "Content-Type": "application/json", "Mcp-Session-Id": "s-1" } }); } });
  const res = await call("/arts/charts/mcp", { method: "POST", body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
    headers: { Cookie: await cookie(), Origin: env.APP_ORIGIN, "Content-Type": "application/json", "Mcp-Session-Id": "s-1", "MCP-Protocol-Version": "2025-06-18" } });
  assert.equal(res.status, 200);
  assert.equal(res.headers["mcp-session-id"], "s-1");
  assert.equal(calls[0].url, env.BACKEND_GATEWAY_ORIGIN + "/charts/mcp");
  assert.equal(calls[0].o.headers["X-Preview-Principal"], "github:42");
  assert.equal(calls[0].o.headers.Authorization, "Bearer " + env.BACKEND_GATEWAY_TOKEN);
});

test("the preview CSP keeps img-src data: blob: and gains only the gateway's wss: origin in connect-src", async (t) => {
  const { call } = await fixture(t);
  const response = await call("/", { headers: { cookie: await cookie() } });
  const csp = response.headers["content-security-policy"];
  assert.match(csp, /img-src 'self' data: blob:;/);
  assert.match(csp, /connect-src 'self' wss:\/\/preview\.example\.com wss:\/\/gateway\.example\.com https:\/\/rss\.nytimes\.com;/);
});

test("the seed registers Art's Charts MCP only with PREVIEW_CHARTS and PREVIEW_RITA both on", () => {
  const both = bootstrap(readConfig({ ...charts, PREVIEW_RITA: "true" }), null, { charts: true });
  assert.match(both, /preview\.example\.com\/arts\/charts\/mcp/);
  assert.doesNotMatch(bootstrap(readConfig(charts), null, { charts: true }), /\/arts\/charts\/mcp/);
});

test("the page is served at /?inbox=<uuid> and /?chart=<uuid>, and no other query", async (t) => {
  const { call } = await fixture(t, { config: readConfig(charts) });
  const headers = { Cookie: await cookie() };
  assert.equal((await call(`/?inbox=${ID}`, { headers })).status, 200);
  assert.equal((await call(`/?chart=${ID}`, { headers })).status, 200);
  for (const q of [`/?inbox=${ID}&x=1`, "/?inbox=nope", `/?viewer=${ID}`]) assert.equal((await call(q, { headers })).status, 404, q);
});

test("the link survives GitHub sign-in: the login page carries it, and the redirect returns only that exact form", async (t) => {
  const { call } = await fixture(t, { config: readConfig(charts) });
  const page = await call(`/?inbox=${ID}`);
  assert.match(page.body, new RegExp(`/auth/signin\\?callbackUrl=${encodeURIComponent(env.APP_ORIGIN + "/?inbox=" + ID).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  const redirect = authConfig(readConfig(charts)).callbacks.redirect;
  assert.equal(redirect({ url: `${env.APP_ORIGIN}/?inbox=${ID}`, baseUrl: env.APP_ORIGIN }), `${env.APP_ORIGIN}/?inbox=${ID}`);
  for (const u of [`https://evil.example.com/?inbox=${ID}`, `${env.APP_ORIGIN}/?inbox=${ID}&x=1`, `${env.APP_ORIGIN}/state`,
    `${env.APP_ORIGIN}/?inbox=${ID.toUpperCase()}`, `${env.APP_ORIGIN}/?inbox=${ID}&`]) {
    assert.equal(redirect({ url: u, baseUrl: env.APP_ORIGIN }), env.APP_ORIGIN + "/");
  }
  // A fragment or userinfo on an otherwise exact link is dropped, not carried through.
  assert.equal(redirect({ url: `${env.APP_ORIGIN}/?inbox=${ID}#x`, baseUrl: env.APP_ORIGIN }), `${env.APP_ORIGIN}/?inbox=${ID}`);
  assert.equal(redirect({ url: `https://user:pw@preview.example.com/?inbox=${ID}`, baseUrl: env.APP_ORIGIN }), `${env.APP_ORIGIN}/?inbox=${ID}`);
});

test("only the canonical link query is admitted: upper case, a trailing &, or a percent-encoded value get the usual 404", async (t) => {
  const { call } = await fixture(t, { config: readConfig(charts) });
  const headers = { Cookie: await cookie() };
  for (const q of [`/?inbox=${ID.toUpperCase()}`, `/?inbox=${ID}&`, `/?inbox=%30${ID.slice(1)}`]) assert.equal((await call(q, { headers })).status, 404, q);
});
