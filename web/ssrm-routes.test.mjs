// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readConfig } from "./config.mjs";
import { tableRoute, validSsrmRoutes } from "./policy.mjs";

// The stack's SSRM route list, vendored by scripts/gateway-vendor.mjs next to policy.mjs.
const here = dirname(fileURLToPath(import.meta.url));
const routes = JSON.parse(readFileSync(join(here, "ssrm-routes.vendored.json"), "utf8"));

const env = {
  APP_ORIGIN: "https://app.example.com/", AUTH_SECRET: "x".repeat(32),
  AUTH_GITHUB_ID: "id", AUTH_GITHUB_SECRET: "secret", SESSION_EPOCH: "1",
  SSRM_ROUTES_JSON: JSON.stringify(routes),
};

test("the vendored SSRM route list is 23 valid routes the web config accepts", () => {
  assert.equal(routes.length, 23);
  assert.ok(validSsrmRoutes(routes));
  assert.deepEqual(readConfig(env).ssrmRoutes, routes);
});

test("the web preview admits exactly the vendored SSRM POSTs", () => {
  const config = { ssrmRoutes: routes };
  for (const path of routes) {
    assert.ok(tableRoute(new URL(path, "https://example.com"), "POST", config), path);
  }
  assert.equal(tableRoute(new URL("/api/api/v1/not/listed/ssrm", "https://example.com"), "POST", config), null);
});

test("an unset SSRM_ROUTES_JSON admits the vendored list; a set one still wins", () => {
  const unset = { ...env };
  delete unset.SSRM_ROUTES_JSON;
  assert.deepEqual(readConfig(unset).ssrmRoutes, routes);
  assert.deepEqual(readConfig({ ...env, SSRM_ROUTES_JSON: "[]" }).ssrmRoutes, []);
});
