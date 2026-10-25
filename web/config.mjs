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
 * NEWS_APPROVED_FEEDS_JSON mirrors the gateway's own `feeds` setting
 * (openbq-docker funnel-gateway): approved HTTPS feed URL -> rss-ticker feed id.
 * Two feeds may not share one id, as the gateway refuses them. Empty (the
 * default) means no News tab, no /news/api/news id admitted and a 503 for a news
 * socket ticket.
 */
export function readConfig(env = process.env) {
  const ids = (env.GITHUB_ALLOWED_USER_IDS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  if (ids.some(id => !/^[1-9]\d*$/.test(id))) throw new Error("GITHUB_ALLOWED_USER_IDS: numeric IDs only");
  for (const name of ["AUTH_GITHUB_ID", "AUTH_GITHUB_SECRET", "SESSION_EPOCH"]) {
    if (!env[name]) throw new Error(`${name}: missing`);
  }
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) throw new Error("AUTH_SECRET: at least 32 characters");
  let feeds;
  try { feeds = JSON.parse(env.NEWS_APPROVED_FEEDS_JSON || "{}"); } catch { throw new Error("NEWS_APPROVED_FEEDS_JSON: not JSON"); }
  if (!feeds || Array.isArray(feeds) || typeof feeds !== "object") throw new Error("NEWS_APPROVED_FEEDS_JSON: expected an object");
  if (Object.keys(feeds).length > 50) throw new Error("NEWS_APPROVED_FEEDS_JSON: at most 50 feeds");
  const seen = new Set();
  for (const [url, id] of Object.entries(feeds)) {
    let parsed;
    try { parsed = new URL(url); } catch { throw new Error("NEWS_APPROVED_FEEDS_JSON: a key is not a URL"); }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash ||
        !Number.isSafeInteger(id) || id < 1) throw new Error("NEWS_APPROVED_FEEDS_JSON: keys are bare HTTPS URLs, values positive integers");
    // As the gateway's own `feeds` check: one rss-ticker feed id names one approved URL.
    if (seen.has(id)) throw new Error("NEWS_APPROVED_FEEDS_JSON: two feeds share one id");
    seen.add(id);
  }
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
    origin: origin(env.APP_ORIGIN, "APP_ORIGIN"), allowedIds: new Set(ids), feeds, backend, token,
    secret: env.AUTH_SECRET, githubId: env.AUTH_GITHUB_ID, githubSecret: env.AUTH_GITHUB_SECRET,
    epoch: env.SESSION_EPOCH,
  };
}
