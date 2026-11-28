// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { once } from "node:events";
import { encode } from "@auth/core/jwt";
import { createPreviewServer } from "./server.mjs";
import { readConfig, SESSION_COOKIE } from "./config.mjs";

const env = {
  APP_ORIGIN: "https://preview.example.com",
  AUTH_SECRET: "state-target-test-only-not-production",
  AUTH_GITHUB_ID: "test", AUTH_GITHUB_SECRET: "synthetic",
  SESSION_EPOCH: "state-target", GITHUB_ALLOWED_USER_IDS: "42",
  BACKEND_GATEWAY_ORIGIN: "https://gateway.example.com",
  BACKEND_GATEWAY_TOKEN: "state-target-test-only-gateway-token",
};

async function listen(t, server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function fixture(t, redirect = false) {
  const gatewayRequests = [], redirectedRequests = [];
  const redirectOrigin = await listen(t, createServer((req, res) => {
    redirectedRequests.push(req.url);
    res.writeHead(204); res.end();
  }));
  const gatewayOrigin = await listen(t, createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    gatewayRequests.push({ path: req.url, method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString() });
    res.writeHead(redirect ? 302 : 204, redirect ? { Location: `${redirectOrigin}/refused-target` } : {});
    res.end();
  }));
  const config = readConfig(env);
  const preview = createPreviewServer({ config, fetchUpstream: (target, init) => {
    // Transport the exact configured gateway request to a loopback fixture.
    // No test can resolve or contact an external host, even on a regression.
    const url = new URL(target);
    assert.equal(url.origin, config.backend);
    return fetch(gatewayOrigin + url.pathname + url.search, init);
  } });
  const previewOrigin = await listen(t, preview);
  const jwt = await encode({ token: { githubId: "42", epoch: config.epoch, deadline: Date.now() / 1000 + 3600 },
    secret: config.secret, salt: SESSION_COOKIE, maxAge: 3600 });
  const call = (path, { method = "PUT", body = '{"theme":"dark"}', headers = {} } = {}) => new Promise((resolve, reject) => {
    // Preserve the raw request target so the HTTP client's URL parser cannot
    // remove a fragment, dot segment or backslash before the server sees it.
    const req = request({ hostname: "127.0.0.1", port: new URL(previewOrigin).port, path, method, headers: {
      Host: new URL(config.origin).host, Origin: config.origin,
      Cookie: `${SESSION_COOKIE}=${jwt}`, "Content-Type": "application/json",
      "Sec-Fetch-Site": "same-origin", ...headers,
    } }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject); req.end(method === "DELETE" ? undefined : body);
  });
  return { call, config, gatewayRequests, redirectedRequests };
}

test("allowed state writes keep their gateway, account, filename and server-only credential", async t => {
  const { call, config, gatewayRequests, redirectedRequests } = await fixture(t);
  const names = ["settings.json", "backends.json", "folders.json", "chat.json", "chart-presets.json",
    "dashboards/Demo-01.json", "workspaces/Workspace_2.json", "layouts/Layout_3.json"];
  for (const name of names) for (const method of ["PUT", "DELETE"]) {
    assert.equal((await call(`/state/${name}`, { method, headers: {
      Authorization: "browser-credential", "X-Api-Key": "browser-key", "X-Forwarded-Host": "ignored.example.com",
    } })).status, 204);
    const sent = gatewayRequests.at(-1);
    assert.equal(sent.path, `/state/42/${name}`);
    assert.equal(sent.method, method);
    assert.equal(sent.body, method === "PUT" ? '{"theme":"dark"}' : "");
    assert.equal(sent.headers.authorization, `Bearer ${config.token}`);
    for (const name of ["cookie", "origin", "x-api-key", "x-forwarded-host"]) assert.equal(sent.headers[name], undefined);
  }
  assert.equal(gatewayRequests.length, names.length * 2);
  assert.deepEqual(redirectedRequests, []);
});

test("state URL spellings cannot select another origin, account or route", async t => {
  const { call, gatewayRequests, redirectedRequests } = await fixture(t);
  const rejected = [
    ["/state/https://other.example.com/settings.json", 404],
    ["/state//other.example.com/settings.json", 404],
    ["/state/43/settings.json", 404],
    ["/state/settings.json?target=http://127.0.0.1/", 404],
    ["/state/settings.json#fragment", 421],
    ["/state/dashboards%2Fmine.json", 421],
    ["/state/dashboards\\mine.json", 421],
    ["/state/dashboards/../settings.json", 421],
    ["/state/%2e%2e/settings.json", 421],
    ["/state/files/report.json", 404],
  ];
  for (const [path, status] of rejected) assert.equal((await call(path)).status, status, path);
  assert.equal((await call("/state/settings.json", { headers: { Cookie: "" } })).status, 401);
  assert.equal((await call("/state/settings.json", { headers: { Origin: "https://other.example.com" } })).status, 403);
  assert.deepEqual(gatewayRequests, []);
  assert.deepEqual(redirectedRequests, []);
});

test("a state gateway redirect never forwards a write or credential to its destination", async t => {
  const { call, gatewayRequests, redirectedRequests } = await fixture(t, true);
  const response = await call("/state/settings.json");
  assert.equal(response.status, 502);
  assert.equal(response.body, "Preview request failed.");
  assert.equal(gatewayRequests.length, 1);
  assert.equal(gatewayRequests[0].path, "/state/42/settings.json");
  assert.deepEqual(redirectedRequests, []);
});
