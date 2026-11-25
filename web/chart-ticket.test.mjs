// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request } from "node:http";
import { encode } from "@auth/core/jwt";
import { createPreviewServer } from "./server.mjs";
import { readConfig, SESSION_COOKIE } from "./config.mjs";
import * as policy from "./policy.mjs";

const env = {
  APP_ORIGIN: "https://chart-demo.vercel.app",
  AUTH_SECRET: "qualification-session-secret-never-deploy-this-value",
  AUTH_GITHUB_ID: "test", AUTH_GITHUB_SECRET: "test-secret",
  SESSION_EPOCH: "chart-1", GITHUB_ALLOWED_USER_IDS: "42",
  BACKEND_GATEWAY_ORIGIN: "https://charts.example.ts.net:10000",
  BACKEND_GATEWAY_TOKEN: "qualification-gateway-token-never-deploy-this-value",
};
const target = "/grid/chart_stream_ws";

async function fixture(t, identity = {}) {
  const config = readConfig(env);
  const server = createPreviewServer({ config, policy });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  });
  const session = await encode({ secret: config.secret, salt: SESSION_COOKIE, maxAge: 3600,
    token: { githubId: "42", epoch: config.epoch, deadline: Date.now() / 1000 + 3600, ...identity } });
  const cookie = `${SESSION_COOKIE}=${session}`;
  const call = (headers = {}, method = "GET") => new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port: server.address().port,
      path: `/socket-ticket?for=${encodeURIComponent(target)}`, method,
      headers: { Host: "chart-demo.vercel.app", cookie, ...headers } }, res => {
      let body = ""; res.on("data", chunk => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject); req.end();
  });
  return { config, call };
}

test("Vercel chart ticket is bound to its exact page origin and Funnel target", async t => {
  const { config, call } = await fixture(t);
  const response = await call({ Origin: config.origin, "Sec-Fetch-Site": "same-origin" });
  assert.equal(response.status, 200);
  const url = new URL(JSON.parse(response.body).url);
  assert.equal(url.origin, "wss://charts.example.ts.net:10000");
  assert.equal(url.pathname, target);
  const ticket = url.searchParams.get("ticket");
  assert.ok(policy.socketTicketNonce(config.token, config.origin + target, ticket, Date.now()));
  assert.equal(policy.socketTicketNonce(config.token, "https://lookalike.vercel.app" + target, ticket, Date.now()), null);
  assert.equal(policy.socketTicketNonce(config.token, target, ticket, Date.now()), null);
  assert.equal(response.body.includes(config.token), false);
  assert.match(response.headers["content-security-policy"], /wss:\/\/charts\.example\.ts\.net:10000/);
  assert.equal(response.headers["vercel-cdn-cache-control"], "no-store");
  const next = new URL(JSON.parse((await call()).body).url);
  assert.notEqual(next.searchParams.get("ticket"), ticket);
});

test("chart broker rejects anonymous, expired, foreign-origin and cross-site requests", async t => {
  const { call } = await fixture(t);
  assert.equal((await call({ cookie: "" })).status, 401);
  assert.equal((await call({ Origin: "https://chart-demo.vercel.app.attacker.example" })).status, 403);
  assert.equal((await call({ "Sec-Fetch-Site": "cross-site" })).status, 403);
  const expired = await fixture(t, { deadline: Date.now() / 1000 - 1 });
  assert.equal((await expired.call()).status, 401);
  const preflight = await call({ Origin: "https://unapproved.vercel.app" }, "OPTIONS");
  assert.notEqual(preflight.status, 200);
  assert.equal(preflight.headers["access-control-allow-origin"], undefined);
});
