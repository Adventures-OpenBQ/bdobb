// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// /mcp (openbq-mcp) through the preview: off unless PREVIEW_MCP=true, then one POST route relayed
// to openbq-docker's door, which filters every message and binds each session to its user.

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
const MCP = { ...env, PREVIEW_MCP: "true" };
const INIT = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } });
const MCP_URL = env.APP_ORIGIN + "/mcp";
async function cookie() {
  return `${SESSION_COOKIE}=${await encode({
    token: { githubId: "42", epoch: "test-1", deadline: Date.now() / 1000 + 3600 },
    secret: env.AUTH_SECRET, salt: SESSION_COOKIE, maxAge: 3600,
  })}`;
}
async function fixture(t, { environment = MCP, fetchUpstream } = {}) {
  const assets = await mkdtemp(join(tmpdir(), "bdobb-mcp-"));
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
  const post = (body, headers = {}, path = "/mcp") => new Promise((resolve, reject) => {
    const h = { host: "preview.example.com", "content-type": "application/json", "content-length": String(Buffer.byteLength(body)), ...headers };
    const req = request({ hostname: "127.0.0.1", port, path, method: "POST", headers: h }, res => {
      const parts = []; res.on("data", c => parts.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(parts).toString() }));
    });
    req.on("error", error => { if (error.code !== "EPIPE") reject(error); }); req.end(body);
  });
  return { post, calls };
}
const signedIn = async (extra = {}) => ({ cookie: await cookie(), origin: env.APP_ORIGIN, ...extra });
const sse = (text, headers = {}) => new Response(text, { headers: { "content-type": "text/event-stream", ...headers } });

test("PREVIEW_MCP is true, false or unset, and needs the gateway", () => {
  assert.equal(readConfig(env).mcp, false);
  assert.equal(readConfig(MCP).mcp, true);
  assert.throws(() => readConfig({ ...env, PREVIEW_MCP: "yes" }), /PREVIEW_MCP/);
  const noGateway = { ...MCP }; delete noGateway.BACKEND_GATEWAY_ORIGIN; delete noGateway.BACKEND_GATEWAY_TOKEN;
  assert.throws(() => readConfig(noGateway), /PREVIEW_MCP/);
});

test("off, /mcp answers as it always did here", async t => {
  const { post, calls } = await fixture(t, { environment: env, fetchUpstream: async () => sse("") });
  assert.equal((await post(INIT, await signedIn())).status, 405);
  assert.equal(calls.length, 0);
});

test("a message goes to the door with the session's principal and MCP's own headers, and nothing else of the browser's", async t => {
  const { post, calls } = await fixture(t, { fetchUpstream: async () => sse('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\n', { "mcp-session-id": "s1" }) });
  const answer = await post(INIT, await signedIn({ "mcp-session-id": "s0", "mcp-protocol-version": "2025-06-18",
    authorization: "Bearer client-token", "x-preview-principal": "github:1", "sec-fetch-site": "same-origin" }));
  assert.equal(answer.status, 200);
  assert.match(answer.headers["content-type"], /^text\/event-stream/);
  assert.equal(answer.headers["mcp-session-id"], "s1");
  assert.match(answer.text, /"result"/);
  assert.equal(calls[0].url, env.BACKEND_GATEWAY_ORIGIN + "/mcp");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(Buffer.from(calls[0].init.body).toString(), INIT);
  assert.deepEqual(calls[0].init.headers, { Authorization: "Bearer " + env.BACKEND_GATEWAY_TOKEN,
    Accept: "application/json, text/event-stream", "Content-Type": "application/json", "X-Preview-Principal": "github:42",
    "Mcp-Session-Id": "s0", "MCP-Protocol-Version": "2025-06-18" });
});

test("the door's own answers reach the client; anything else is a 502", async t => {
  for (const [upstream, status] of [
    [new Response(null, { status: 202 }), 202],
    [new Response('{"error":"Request refused"}', { status: 400, headers: { "content-type": "application/json" } }), 400],
    [new Response('{"error":"Request refused"}', { status: 404, headers: { "content-type": "application/json" } }), 404],
    [new Response('{"error":"Request refused"}', { status: 429, headers: { "content-type": "application/json" } }), 429],
    [new Response("private", { status: 500 }), 502],
    [new Response("<p>", { headers: { "content-type": "text/html" } }), 502],
  ]) {
    const { post } = await fixture(t, { fetchUpstream: async () => upstream });
    const answer = await post(INIT, await signedIn());
    assert.equal(answer.status, status);
    assert.ok(!answer.text.includes("private"));
  }
});

test("a message from anywhere but this page, or not JSON, or too big, or off the one route, reaches no one", async t => {
  const { post, calls } = await fixture(t, { fetchUpstream: async () => sse("") });
  const c = await cookie();
  assert.equal((await post(INIT, {})).status, 401);
  assert.equal((await post(INIT, { cookie: c })).status, 403, "no Origin");
  assert.equal((await post(INIT, { cookie: c, origin: "https://evil.example" })).status, 403);
  assert.equal((await post(INIT, await signedIn({ "content-type": "text/plain" }))).status, 415);
  assert.equal((await post("{", await signedIn())).status, 400);
  assert.equal((await post(JSON.stringify({ x: "y".repeat(1024 * 1024) }), await signedIn())).status, 413);
  for (const path of ["/mcp/", "/mcp/mcp", "/mcp?x=1"]) assert.equal((await post(INIT, await signedIn(), path)).status, 404, path);
  assert.equal((await post(INIT, await signedIn({ "mcp-session-id": "a\tb" }))).status, 400);
  assert.equal(calls.length, 0);
});

test("the AI Library gets the stack's MCP server, with its writing tools off, unless the user has servers", () => {
  const on = readConfig({ ...MCP, PREVIEW_RITA: "true" }), off = readConfig(env);
  const seedOf = (config, saved = {}) => JSON.parse(JSON.parse(/window\.__bdobbSeed=(.*);\n/.exec(bootstrap(config, saved))[1])["settings.json"] ?? "null");
  const server = { id: "openbq-mcp", name: "OpenBQ MCP", url: MCP_URL, enabled: true };
  const disabled = { [MCP_URL]: ["install_skill", "run_pipeline"] };
  assert.deepEqual(seedOf(on), { ritaUrl: env.APP_ORIGIN + "/ai", mcpServers: [server], mcpDisabledTools: disabled });
  assert.deepEqual(seedOf(off), {});
  const dash = { "dashboards/a.json": '{"id":"a"}' };
  // [] is what the app saves when no server was ever added (DEFAULT_SETTINGS), so it is unset here.
  assert.deepEqual(seedOf(on, { ...dash, "settings.json": '{"theme":"dark","ritaUrl":"","mcpServers":[],"mcpDisabledTools":{"https://x/mcp":["a"]}}' }),
    { theme: "dark", ritaUrl: env.APP_ORIGIN + "/ai", mcpServers: [server], mcpDisabledTools: { "https://x/mcp": ["a"], ...disabled } });
  const mine = [{ id: "m", url: "https://mine.example/mcp", enabled: true }];
  assert.deepEqual(seedOf(on, { ...dash, "settings.json": JSON.stringify({ mcpServers: mine }) }).mcpServers, mine);
  assert.deepEqual(seedOf(readConfig(MCP), dash), { mcpServers: [server], mcpDisabledTools: disabled });
});

test("a saved settings file that already names its own Rita and servers is passed through byte for byte", () => {
  const on = readConfig({ ...MCP, PREVIEW_RITA: "true" });
  const text = '{"ritaUrl":"https://mine.example/rita","mcpServers":[{"id":"m","url":"https://mine.example/mcp","enabled":true}],"maxDecimalPlaces":2.0}';
  const seeded = JSON.parse(/window\.__bdobbSeed=(.*);\n/.exec(bootstrap(on, { "settings.json": text }))[1]);
  assert.equal(seeded["settings.json"], text);
});
