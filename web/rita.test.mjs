// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// /ai (Rita) through the preview: off unless PREVIEW_RITA=true, then her document and her one
// streamed query relayed to openbq-docker's door, which rewrites and limits the query itself.

import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encode } from "@auth/core/jwt";
import { readConfig, SESSION_COOKIE } from "./config.mjs";
import { bootstrap } from "./bootstrap.mjs";
import { createPreviewServer } from "./server.mjs";

const env = {
  APP_ORIGIN: "https://preview.example.com",
  AUTH_SECRET: "test-only-secret-never-use-in-production-123",
  AUTH_GITHUB_ID: "test-client", AUTH_GITHUB_SECRET: "test-client-secret",
  SESSION_EPOCH: "test-1", GITHUB_ALLOWED_USER_IDS: "42",
  BACKEND_GATEWAY_ORIGIN: "https://gateway.example.com",
  BACKEND_GATEWAY_TOKEN: "test-only-gateway-token-not-a-real-credential",
};
const RITA = { ...env, PREVIEW_RITA: "true" };
const QUERY = JSON.stringify({ messages: [{ role: "human", content: "hi" }] });
async function cookie() {
  return `${SESSION_COOKIE}=${await encode({
    token: { githubId: "42", epoch: "test-1", deadline: Date.now() / 1000 + 3600 },
    secret: env.AUTH_SECRET, salt: SESSION_COOKIE, maxAge: 3600,
  })}`;
}
async function fixture(t, { environment = RITA, fetchUpstream } = {}) {
  const assets = await mkdtemp(join(tmpdir(), "bdobb-rita-"));
  await writeFile(join(assets, "index.html"), "<html></html>");
  const calls = [];
  const server = createPreviewServer({ config: readConfig(environment), assets,
    fetchUpstream: async (url, init) => { calls.push({ url, init }); return fetchUpstream(url, init); } });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await rm(assets, { recursive: true, force: true });
  });
  const port = server.address().port;
  const call = (path, { method = "GET", headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const h = { host: "preview.example.com", ...headers };
    if (body !== undefined) { h["content-type"] ??= "application/json"; h["content-length"] = String(Buffer.byteLength(body)); }
    const req = request({ hostname: "127.0.0.1", port, path, method, headers: h }, res => {
      const parts = []; res.on("data", c => parts.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(parts).toString() }));
    });
    req.on("error", error => { if (error.code !== "EPIPE") reject(error); }); req.end(body);
  });
  return { call, calls, port };
}
const signedIn = async (extra = {}) => ({ cookie: await cookie(), origin: env.APP_ORIGIN, ...extra });
const json = value => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const sse = text => new Response(text, { headers: { "content-type": "text/event-stream" } });

test("PREVIEW_RITA is true, false or unset, and needs the gateway", () => {
  assert.equal(readConfig(env).rita, false);
  assert.equal(readConfig(RITA).rita, true);
  assert.equal(readConfig({ ...env, PREVIEW_RITA: "false" }).rita, false);
  assert.throws(() => readConfig({ ...env, PREVIEW_RITA: "yes" }), /PREVIEW_RITA/);
  const noGateway = { ...RITA }; delete noGateway.BACKEND_GATEWAY_ORIGIN; delete noGateway.BACKEND_GATEWAY_TOKEN;
  assert.throws(() => readConfig(noGateway), /PREVIEW_RITA/);
});

test("off, /ai answers as it always did here", async t => {
  const { call, calls } = await fixture(t, { environment: env, fetchUpstream: async () => json({}) });
  assert.equal((await call("/ai/agents.json", { headers: await signedIn() })).status, 404);
  assert.equal((await call("/ai/v1/query", { method: "POST", body: QUERY, headers: await signedIn() })).status, 405);
  assert.equal(calls.length, 0);
});

test("her document is fetched with the gateway token and the user's id, and nothing of the browser's", async t => {
  const { call, calls } = await fixture(t, { fetchUpstream: async () => json({ openbb_agent_rita: { name: "Agent Rita" } }) });
  const answer = await call("/ai/agents.json", { headers: await signedIn({ authorization: "client", "x-rita-principal": "github:1" }) });
  assert.equal(answer.status, 200);
  assert.deepEqual(JSON.parse(answer.text), { openbb_agent_rita: { name: "Agent Rita" } });
  assert.equal(calls[0].url, env.BACKEND_GATEWAY_ORIGIN + "/ai/agents.json");
  assert.deepEqual(calls[0].init.headers, { Authorization: "Bearer " + env.BACKEND_GATEWAY_TOKEN,
    Accept: "application/json", "X-Rita-Principal": "github:42" });
  assert.equal(calls[0].init.redirect, "error");
});

test("a signed-out caller reaches nothing", async t => {
  const { call, calls } = await fixture(t, { fetchUpstream: async () => json({}) });
  assert.equal((await call("/ai/agents.json")).status, 401);
  assert.equal((await call("/ai/v1/query", { method: "POST", body: QUERY, headers: { origin: env.APP_ORIGIN } })).status, 401);
  assert.equal(calls.length, 0);
});

test("a query goes to the door as sent, and her stream comes back as it arrives", async t => {
  let release;
  const held = new Promise(r => { release = r; });
  const { port, calls } = await fixture(t, { fetchUpstream: async () => new Response(new ReadableStream({
    async start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"type":"first"}\n\n'));
      await held;
      controller.enqueue(new TextEncoder().encode('data: {"type":"last"}\n\n'));
      controller.close();
    },
  }), { headers: { "content-type": "text/event-stream" } }) });
  const headers = { ...(await signedIn()), host: "preview.example.com", "content-type": "application/json",
    "content-length": String(Buffer.byteLength(QUERY)), "sec-fetch-site": "same-origin" };
  const text = await new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path: "/ai/v1/query", method: "POST", headers }, res => {
      assert.equal(res.statusCode, 200);
      assert.match(res.headers["content-type"], /^text\/event-stream/);
      assert.equal(res.headers["cache-control"], "no-store");
      let seen = "";
      res.on("data", c => { seen += c; if (seen.includes("first") && !seen.includes("last")) release(); });
      res.on("end", () => resolve(seen));
    });
    req.on("error", reject); req.end(QUERY);
  });
  assert.match(text, /first[\s\S]*last/);
  assert.equal(calls[0].url, env.BACKEND_GATEWAY_ORIGIN + "/ai/v1/query");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(Buffer.from(calls[0].init.body).toString(), QUERY);
  assert.deepEqual(calls[0].init.headers, { Authorization: "Bearer " + env.BACKEND_GATEWAY_TOKEN,
    Accept: "text/event-stream", "Content-Type": "application/json", "X-Rita-Principal": "github:42" });
});

test("a query from anywhere but this page, or not JSON, or too big, reaches no one", async t => {
  const { call, calls } = await fixture(t, { fetchUpstream: async () => sse("data: {}\n\n") });
  const post = (headers, body = QUERY) => call("/ai/v1/query", { method: "POST", body, headers });
  const c = await cookie();
  assert.equal((await post({ cookie: c })).status, 403, "no Origin");
  assert.equal((await post({ cookie: c, origin: "https://evil.example" })).status, 403);
  assert.equal((await post({ ...(await signedIn()), "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await post({ ...(await signedIn()), "content-type": "text/plain" })).status, 415);
  assert.equal((await post(await signedIn(), "{")).status, 400);
  assert.equal((await post(await signedIn(), JSON.stringify({ messages: ["x".repeat(1024 * 1024)] }))).status, 413);
  assert.equal(calls.length, 0);
});

test("her limits reach the user; anything else she or the door says is a 502", async t => {
  for (const [upstream, status] of [
    [new Response('{"error":"busy"}', { status: 429, headers: { "content-type": "application/json" } }), 429],
    [new Response("bad", { status: 400 }), 400],
    [new Response("private", { status: 500 }), 502],
    [json({ not: "a stream" }), 502],
  ]) {
    const { call } = await fixture(t, { fetchUpstream: async () => upstream });
    const answer = await call("/ai/v1/query", { method: "POST", body: QUERY, headers: await signedIn() });
    assert.equal(answer.status, status);
    assert.ok(!answer.text.includes("private"));
  }
  const { call } = await fixture(t, { fetchUpstream: async () => new Response("<p>", { headers: { "content-type": "text/html" } }) });
  assert.equal((await call("/ai/agents.json", { headers: await signedIn() })).status, 502);
});

test("only her two routes exist", async t => {
  const { call, calls } = await fixture(t, { fetchUpstream: async () => json({}) });
  for (const [path, method] of [["/ai/v1/query", "GET"], ["/ai/agents.json", "POST"], ["/ai/agents.json?x=1", "GET"],
    ["/ai/v1/query?x=1", "POST"], ["/ai/v1/generate/code", "POST"], ["/ai/status", "GET"], ["/ai/", "GET"]]) {
    const answer = await call(path, { method, body: method === "POST" ? QUERY : undefined, headers: await signedIn() });
    assert.equal(answer.status, 404, `${method} ${path}`);
  }
  assert.equal(calls.length, 0);
});

test("the seed points Rita at /ai, and a saved settings file gains it unless it names another Rita", () => {
  const on = readConfig(RITA), off = readConfig(env);
  const seeded = config => JSON.parse(/window\.__bdobbSeed=(.*);\n/.exec(bootstrap(config, {}))[1]);
  const savedWith = (config, saved) => JSON.parse(/window\.__bdobbSeed=(.*);\n/.exec(bootstrap(config, saved))[1]);
  assert.deepEqual(JSON.parse(seeded(on)["settings.json"]), { ritaUrl: env.APP_ORIGIN + "/ai" });
  assert.deepEqual(JSON.parse(seeded(off)["settings.json"]), {});
  const dash = { "dashboards/a.json": '{"id":"a"}' };
  assert.deepEqual(JSON.parse(savedWith(on, { ...dash, "settings.json": '{"theme":"dark"}' })["settings.json"]),
    { theme: "dark", ritaUrl: env.APP_ORIGIN + "/ai" });
  // "" is what the app saves when no Rita URL was ever set (DEFAULT_SETTINGS), so it is unset here.
  assert.deepEqual(JSON.parse(savedWith(on, { ...dash, "settings.json": '{"ritaUrl":""}' })["settings.json"]), { ritaUrl: env.APP_ORIGIN + "/ai" });
  assert.deepEqual(JSON.parse(savedWith(on, { ...dash, "settings.json": '{"ritaUrl":"https://other.example/rita"}' })["settings.json"]),
    { ritaUrl: "https://other.example/rita" });
  assert.deepEqual(JSON.parse(savedWith(on, dash)["settings.json"]), { ritaUrl: env.APP_ORIGIN + "/ai" });
  assert.equal(savedWith(on, dash)["dashboards/a.json"], '{"id":"a"}');
  assert.equal(savedWith(on, { ...dash, "settings.json": "not json" })["settings.json"], "not json");
  assert.equal(savedWith(off, { ...dash, "settings.json": '{"theme":"dark"}' })["settings.json"], '{"theme":"dark"}');
});
