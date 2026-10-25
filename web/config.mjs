// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { validSsrmRoutes } from "./policy.mjs";
// The stack's SSRM door paths, vendored with policy.mjs (scripts/gateway-vendor.mjs).
import vendoredSsrmRoutes from "./ssrm-routes.vendored.json" with { type: "json" };

export const SESSION_COOKIE = "__Host-bdobb-session";
export const SESSION_SECONDS = 3600;

// Every rejection names the VARIABLE, never its value: the server logs the
// message so an operator can tell which of the settings below failed closed.
function origin(value, name) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name}: not a URL`); }
  if (url.protocol !== "https:" || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) throw new Error(`${name}: expected a bare HTTPS origin`);
  return url.origin;
}

/**
 * Missing or malformed configuration never becomes an anonymous preview.
 *
 * No NEWS_APPROVED_FEEDS_JSON at this line: the news family (and its
 * feeds-config surface) arrives with the gateway's /news route at Ep. 8 --
 * the built-in RSS widget this line ships fetches feeds directly, with no
 * server-side approved list to configure.
 */
export function readConfig(env = process.env) {
  const ids = (env.GITHUB_ALLOWED_USER_IDS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  if (ids.some(id => !/^[1-9]\d*$/.test(id))) throw new Error("GITHUB_ALLOWED_USER_IDS: numeric IDs only");
  for (const name of ["AUTH_GITHUB_ID", "AUTH_GITHUB_SECRET", "SESSION_EPOCH"]) {
    if (!env[name]) throw new Error(`${name}: missing`);
  }
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) throw new Error("AUTH_SECRET: at least 32 characters");
  const backend = env.BACKEND_GATEWAY_ORIGIN ? origin(env.BACKEND_GATEWAY_ORIGIN, "BACKEND_GATEWAY_ORIGIN") : null;
  const token = env.BACKEND_GATEWAY_TOKEN || null;
  if (Boolean(backend) !== Boolean(token)) throw new Error("BACKEND_GATEWAY_ORIGIN and BACKEND_GATEWAY_TOKEN: set both or neither");
  if (token && !/^[A-Za-z0-9_-]{32,}$/.test(token)) throw new Error("BACKEND_GATEWAY_TOKEN: 32+ base64url characters, nothing else");
  const tableTimeoutMs = Number(env.TABLE_TIMEOUT_MS ?? 65000);
  if (!Number.isInteger(tableTimeoutMs) || tableTimeoutMs < 1000 || tableTimeoutMs > 65000) throw new Error("TABLE_TIMEOUT_MS: expected 1000 through 65000");
  // SSRM pages can be cold-computed upstream (the stack allows 300 s), so they
  // get their own deadline; managed table routes keep TABLE_TIMEOUT_MS.
  const ssrmTimeoutMs = Number(env.SSRM_TIMEOUT_MS ?? 170000);
  if (!Number.isInteger(ssrmTimeoutMs) || ssrmTimeoutMs < 1000 || ssrmTimeoutMs > 300000) throw new Error("SSRM_TIMEOUT_MS: expected 1000 through 300000");
  const tableRelayToken = env.TABLE_RELAY_TOKEN || null;
  if (tableRelayToken && (!backend || !/^[A-Za-z0-9_-]{32,256}$/.test(tableRelayToken) || tableRelayToken === token)) throw new Error("TABLE_RELAY_TOKEN: distinct private credential required");
  let ssrmRoutes; try { ssrmRoutes = env.SSRM_ROUTES_JSON === undefined ? vendoredSsrmRoutes : JSON.parse(env.SSRM_ROUTES_JSON || "[]"); } catch { throw new Error("SSRM_ROUTES_JSON: invalid JSON"); }
  if (!validSsrmRoutes(ssrmRoutes)) throw new Error("SSRM_ROUTES_JSON: invalid routes");
  return {
    tableRelayToken, ssrmRoutes, tableTimeoutMs, ssrmTimeoutMs,
    origin: origin(env.APP_ORIGIN, "APP_ORIGIN"), allowedIds: new Set(ids), backend, token,
    secret: env.AUTH_SECRET, githubId: env.AUTH_GITHUB_ID, githubSecret: env.AUTH_GITHUB_SECRET,
    epoch: env.SESSION_EPOCH,
  };
}
