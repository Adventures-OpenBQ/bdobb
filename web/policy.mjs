// vendored from openbq-docker v9.0.0 funnel-gateway/policy.mjs sha256:9bb645fcc139e399f36a03fd53521a21942c92884d0253c9d7d35705a6876361
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The route contract of the stack's public door: openbq-docker's funnel-gateway,
 * the opt-in `web` compose profile (openbq-docker v8.0.0). Ported from
 * bdobb-dev/openbb-docker v8.0.3 (775354f) funnel-gateway/policy.mjs, with the
 * /ai (Rita) family removed and nothing else changed in what is admitted. This
 * file is CANONICAL: BDOBB's web layer vendors a pinned copy (web/policy.mjs)
 * and tests its hash, so the app and the stack can never disagree about what is
 * admitted.
 *
 * Not a generic reverse proxy. If a path is not matched below, it is refused.
 * At this tag the stack serves three upstreams behind the door, plus /state and,
 * when the opt-in `table` profile runs, the managed table service:
 *   /api/...   -> openbq-api    (the whole ODP widget catalogue)
 *   /ref/...   -> openbq-reference (Episode 3's keyless reference backend; its one
 *                 socket, /ref/live_grid_ws, through the ticketed socket door below)
 *   /news/...  -> rss-ticker    (the wire: approved feeds only)
 *   /state/... -> the gateway's own per-user store (server.mjs, stateFile below)
 *   /table/... -> table-service  (tableRoute below)
 * /ai (Rita) is not served by openbq-docker. MCP, provider-key paths and the
 * API's own /docs, /openapi.json and /redoc are never routes this door forwards.
 *
 * The /news family is where the contract stops being HTTP-only: /news/ws/news
 * is the first route served over a socket, so this file gains a second kind of
 * rule -- newsSubscription, which validates the ONE frame a client may send --
 * beside the path-and-query rules every other route takes.
 */

/**
 * The openbq-api side, since the owner's 2026-09-20 decision to "make all
 * widgets available in vercel". openbq-api's real /widgets.json IS the whole
 * OpenBB catalogue -- 331 widgets over 181 distinct endpoints at v12.4 -- and
 * the GitHub allowlist, not a curated manifest, is what gates the preview. So
 * the /api side forwards the catalogue unfiltered, and the widgets' data calls
 * are admitted by ONE structurally-bounded rule instead of 181 per-route
 * regexes nobody could keep in step with the backend.
 *
 * The bounds ARE the contract:
 *   path    OPENBB_ROUTE_RE -- lowercase OpenBB route segments only. No dot,
 *           so neither ".." nor ".json"; no "%", so no percent-encoded
 *           traversal reaches the stack (URL leaves the pathname encoded, and
 *           new URL() folds a literal ".." before the rule ever sees it).
 *   length  the forwarded path+query is capped at MAX_URL_CHARS, the same
 *           number at both layers because it measures what LEAVES rather than
 *           the caller's absolute URL (whose origin differs per layer).
 *   query   at most MAX_QUERY_PAIRS pairs -- the widest widget in the real
 *           catalogue declares 20 -- each name PARAM_NAME_RE, each value at
 *           most MAX_VALUE_CHARS and free of control characters (hasControlChar,
 *           CR and LF included), so a value can never forge a header or a
 *           second request upstream.
 * The query that leaves is RE-SERIALISED from the parsed pairs, never the raw
 * string a caller wrote.
 *
 * Verified against the live v12.4 catalogue on 2026-09-20: all 181 widget
 * endpoints and all 11 parameter optionsEndpoints match OPENBB_ROUTE_RE, and
 * no declared paramName fails PARAM_NAME_RE. What stays refused is everything
 * OUTSIDE /api/api/v1/: openbq-api's /docs, /openapi.json and /redoc are not
 * routes the client fetches, so they are not routes this door forwards.
 */
const OPENBB_ROUTE_RE = /^\/api\/api\/v1\/[a-z0-9_/-]{1,200}$/;
// The reference backend's routes (Episode 3): same lowercase-segment class as /api/api/v1.
// No empty segments, so "//" can never reach the upstream URL parser as a host.
const REF_ROUTE_RE = /^\/ref\/[a-z0-9_-]{1,100}(?:\/[a-z0-9_-]{1,100})*$/;
// Its root documents and logo, forwarded as exact paths with no query (dotted, so outside
// REF_ROUTE_RE; the four extra ones ruled in 2026-10-15).
const REF_DOCUMENTS = new Set(["/ref/widgets.json", "/ref/apps.json", "/ref/agents.json",
  "/ref/bundle.apps.json", "/ref/market-examples.apps.json", "/ref/assets/bdobb-logo.svg"]);
const PARAM_NAME_RE = /^[A-Za-z_][A-Za-z0-9_.[\]-]{0,63}$/;
// Not a regex: a control-character class is exactly what eslint's
// no-control-regex forbids, and a comparison says the same thing plainly.
// Iterating code POINTS keeps a surrogate pair from ever reading as a control
// character -- an astral character arrives as a two-unit string, which is
// never below " ".
const hasControlChar = value => [...value].some(c => c < " " || c === "");
const MAX_QUERY_PAIRS = 40;
const MAX_VALUE_CHARS = 1024;
const MAX_URL_CHARS = 4096;

// calendar/trading (openbb-docker feat/calendar-trading-endpoint): a MIC and
// a year inside the client's own window (1990-2040; tradingCalendar.ts never
// queries outside it, so wider years here would only widen the attack set).
const MIC_RE = /^[A-Z]{4}$/;
const YEAR_RE = /^(?:199\d|20[0-3]\d|2040)$/;

function onlyKeys(params, allowed) {
  return ![...params.keys()].some(k => !allowed.includes(k));
}

/** The one bounded-query rule shared by /api/api/v1 and /ref: pairs, names, lengths, control chars, re-serialised. */
function boundedForward(url) {
  const pairs = [...url.searchParams];
  if (pairs.length > MAX_QUERY_PAIRS) return null;
  for (const [name, value] of pairs) {
    if (!PARAM_NAME_RE.test(name) || value.length > MAX_VALUE_CHARS || hasControlChar(value)) return null;
  }
  const forwarded = url.pathname + (pairs.length ? "?" + url.searchParams.toString() : "");
  return forwarded.length <= MAX_URL_CHARS ? forwarded : null;
}

/** The /api and /ref families take bounds; the /news family takes reviewed routes with their own tests. */
export function upstreamPath(url, config) {
  const params = url.searchParams;
  if (new Set(params.keys()).size !== [...params.keys()].length) return null;

  // The two root documents the client fetches from a backend -- dataClient.ts'
  // fetchWidgetsJson (required; a 404 is what marks a backend offline) and
  // fetchAppsJson (optional). There is no third: the API answers 404 for
  // templates.json, and agents.json is a Rita host's document, not a backend's.
  // Exact path, no query.
  if (url.pathname === "/api/widgets.json" || url.pathname === "/api/apps.json") {
    if (url.search) return null;
    return url.pathname;
  }

  // The EODHD v2 trading-calendar envelope the client consults for bd
  // resolution. A 404 from an older backend is the designed "no calendar"
  // answer, so this route against a v10.1.2/12.4.0 upstream without the
  // endpoint degrades exactly like a client with no calendar at all.
  //
  // This is the one /api route that KEEPS its own narrow grammar after the
  // catalogue was opened up, because it adds protection the generic rule below
  // cannot: no widget in the real catalogue calls it, so the client's own
  // helper is its only caller and a MIC plus a year inside the client's window
  // is the whole legitimate parameter space. The generic rule never sees it --
  // this block refuses definitively rather than falling through.
  if (url.pathname === "/api/api/v1/calendar/trading") {
    if (!onlyKeys(params, ["exchange", "year"])) return null;
    if (!MIC_RE.test(params.get("exchange") ?? "")) return null;
    if (!YEAR_RE.test(params.get("year") ?? "")) return null;
    return "/api/api/v1/calendar/trading?" + params.toString();
  }

  // Every widget's own data call, and every parameter dropdown's
  // optionsEndpoint, under the bounds documented at the top of this file.
  if (url.pathname.startsWith("/api/api/v1/")) {
    if (!OPENBB_ROUTE_RE.test(url.pathname)) return null;
    return boundedForward(url);
  }

  // --- the reference backend (Episode 3), offered whole through /ref. The upstream is
  // openbq-reference:17783, a keyless local fixture, so NO credential is injected
  // (server.mjs target()). The root documents exactly, no query; every other GET
  // under the SAME structural bounds as /api/api/v1 (lowercase segments, no dot, no %,
  // bounded query, re-serialised). /ref/omni* is refused so no code-executing Omni route
  // is ever forwarded. Dotted paths pass only as the exact REF_DOCUMENTS.
  if (REF_DOCUMENTS.has(url.pathname)) {
    if (url.search) return null;
    return url.pathname;
  }
  if (url.pathname.startsWith("/ref/")) {
    if (!REF_ROUTE_RE.test(url.pathname) || url.pathname.length > 200) return null;
    // Any segment starting "omni", at any depth, is refused.
    if (url.pathname.split("/").some(segment => segment.startsWith("omni"))) return null;
    return boundedForward(url);
  }

  // The wire's history page: rss-ticker's own /api/news, and nothing else under
  // /news/. `feed_id` must be one of the APPROVED ids -- config.feeds is the
  // allowlist, so a caller can name a feed the operator approved and no other,
  // and never a URL: the gateway has no route that takes one. `limit` is 1..50,
  // the range the News card asks for; anything else fails closed rather than
  // being clamped, because a clamped parameter hides a client that is wrong.
  if (url.pathname === "/news/api/news") {
    if (!onlyKeys(params, ["feed_id", "limit"])) return null;
    // `config?.feeds ?? {}`: this file is vendored by the web layer, and a caller that
    // forgets the second argument must get the honest refusal (no feed is approved) rather
    // than a TypeError the gateway would only turn into a 502.
    if (!/^[1-9]\d*$/.test(params.get("feed_id") ?? "") ||
        !Object.values(config?.feeds ?? {}).includes(Number(params.get("feed_id")))) return null;
    if (!/^(?:[1-9]|[1-4]\d|50)$/.test(params.get("limit") ?? "")) return null;
    return "/news/api/news?" + params.toString();
  }

  return null;
}

/**
 * The ONE frame a /news/ws/news client may send, and the only shape that ever
 * reaches rss-ticker. A viewer cannot add feeds, rename feeds, unsubscribe,
 * or send an admin frame: the frame is parsed, its single `subscribe` key
 * checked, and a NEW frame built from the approved urls alone -- the caller's
 * own object is never forwarded, so no extra property of theirs survives.
 * Returns the frame to forward, or null to close the socket.
 */
export function newsSubscription(data, config) {
  let frame;
  try { frame = JSON.parse(data.toString()); } catch { return null; }
  if (!frame || Object.keys(frame).join() !== "subscribe" || !Array.isArray(frame.subscribe) ||
      !frame.subscribe.length || frame.subscribe.length > 50) return null;
  const urls = frame.subscribe.map(f => f?.url);
  if (new Set(urls).size !== urls.length || urls.some(url => typeof url !== "string")) return null;
  // A feed that is not approved is DROPPED, not a reason to refuse the rest: one stray
  // feed in a dashboard (the v8 example carries one) blanked the whole card. It is
  // never forwarded, so what reaches rss-ticker is approved feeds and nothing else.
  const approved = urls.filter(url => Object.hasOwn(config.feeds, url));
  if (!approved.length) return null;
  // Strip display names and all extra properties instead of forwarding mutations.
  return JSON.stringify({ subscribe: approved.map(url => ({ url })) });
}

/**
 * Socket tickets. A socket relayed through a Vercel Function bills function time
 * for as long as it stays open (and needs the WebSockets beta permission), and the
 * preview's sockets are always open. So the browser opens them on the gateway
 * directly, which costs Vercel nothing -- and a browser cannot put the machine token
 * on a WebSocket. The web layer, which HAS checked the GitHub session, signs a
 * ticket instead: `<expiry ms>.<nonce>.<HMAC-SHA256>` over the exact target
 * (path plus canonical query) the socket will name. The gateway recomputes it
 * with the same token, so no new secret is provisioned; the key is derived, so
 * the bearer itself never signs anything a browser sees. Thirty seconds covers
 * a connect; the gateway also refuses a nonce it has already admitted.
 *
 * The first socket route, /ref/live_grid_ws, arrived with the reference backend (v3); at
 * this tag /news/ws/news joins it, the first socket family of its own (Ep. 8). Ep. 10
 * adds /grid/live_grid_ws.
 */
const TICKET_MS = 30_000;
// The signer (the web layer, on Vercel) and this verifier keep separate clocks; a signer a
// few seconds ahead must not fail every ticket. Expiry itself stays exact.
const TICKET_SKEW_MS = 5_000;
const ticketKey = token => createHmac("sha256", token).update("bdobb socket ticket v1").digest();
const ticketSignature = (token, expiry, nonce, target) =>
  createHmac("sha256", ticketKey(token)).update(`${expiry}.${nonce}.${target}`).digest();

export function socketTicket(token, target, now = Date.now()) {
  const expiry = now + TICKET_MS, nonce = randomBytes(16).toString("base64url");
  return `${expiry}.${nonce}.${ticketSignature(token, expiry, nonce, target).toString("base64url")}`;
}

/** The nonce of a valid ticket (for the gateway's single-use set), else null. */
export function socketTicketNonce(token, target, ticket, now = Date.now()) {
  const match = typeof ticket === "string" && /^(\d{13})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(ticket);
  if (!match || typeof token !== "string" || !token) return null;
  const expiry = Number(match[1]);
  if (now > expiry || expiry - now > TICKET_MS + TICKET_SKEW_MS) return null;
  const given = Buffer.from(match[3], "base64url");
  const wanted = ticketSignature(token, expiry, match[2], target);
  return given.length === wanted.length && timingSafeEqual(given, wanted) ? match[2] : null;
}
export const socketTicketValid = (...args) => socketTicketNonce(...args) !== null;

/**
 * The socket a ticket may name, under exactly the rules the upgrade handler applies -- and
 * the SAME function the web layer's ticket signer calls, so the two can never drift. Two
 * routes at this tag, /ref/live_grid_ws and /news/ws/news; neither takes a query: the
 * whole subscription is the frame. Ep. 10 adds /grid/live_grid_ws.
 */
export function socketTarget(raw, origin) {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) return null;
  let url; try { url = new URL(raw, origin); } catch { return null; }
  if (url.origin !== origin || url.hash) return null;
  // raw === pathname: no query (not even a bare "?"), and no "..", "%" or case folding.
  if (url.pathname === "/ref/live_grid_ws" && raw === url.pathname) return url.pathname;
  if (url.pathname === "/news/ws/news") return url.search ? null : url.pathname;
  return null;
}

// The reference live grid's symbol grammar: one symbol, or a comma watchlist (user ruling
// 2026-10-15). `^` for an index symbol (^GSPC), `.` for an exchange suffix (AAPL.US).
const SYMBOL_LIST_RE = /^[A-Za-z0-9.^_,-]{1,240}$/;

/**
 * A /ref/live_grid_ws frame: `{"params":{"symbol":"A,B"}}`, sent on open and again on
 * every symbol change over the same open socket. Re-validated on every frame (not just the
 * first). The frame that reaches the reference is rebuilt from the one value that passed,
 * so no extra property, no second key and no display name of the caller's is ever forwarded.
 * Returns the frame to forward, or null to close the socket.
 */
export function refSubscription(data) {
  let frame;
  try { frame = JSON.parse(data.toString()); } catch { return null; }
  if (!frame || typeof frame !== "object" || Object.keys(frame).join() !== "params") return null;
  const params = frame.params;
  if (!params || typeof params !== "object" || Object.keys(params).join() !== "symbol") return null;
  const raw = params.symbol;
  if (typeof raw !== "string" || !SYMBOL_LIST_RE.test(raw)) return null;
  return JSON.stringify({ params: { symbol: raw } });
}

/**
 * The files the web preview may keep per GitHub user (gateway /state, web /state):
 * the app's own JSON stores by their exact names, and one flat level each of
 * dashboards/, workspaces/ and layouts/ (BDOBB v5's workspaces and saved layouts).
 * Not files/ (uploads), logs/, skills/, nor the .tmp and .corrupt siblings the
 * app's atomic writer and quarantine leave beside them.
 */
const STATE_FILE_RE = /^(?:(?:settings|backends|folders|chat|chart-presets)\.json|(?:dashboards|workspaces|layouts)\/[A-Za-z0-9_-]{1,80}\.json)$/;
export const stateFile = name => typeof name === "string" && STATE_FILE_RE.test(name);


// Managed HTTP routes are deliberately independent of the broad read-only API rule.
export const TABLE_RESPONSE_BYTES = 8 * 1024 * 1024;
// The BDOBB web door (web/server.mjs) vendors this file and falls back to this deadline.
export const TABLE_DEADLINE_MS = 65000;
export function validSsrmRoutes(routes) {
  return Array.isArray(routes) && routes.length <= 100 && new Set(routes).size === routes.length &&
    routes.every(path => typeof path === "string" && OPENBB_ROUTE_RE.test(path) &&
      !path.includes("//") && !path.endsWith("/"));
}
export function tableRoute(url, method, config = {}) {
  const path = url.pathname;
  if (method === "POST" && config.ssrmRoutes?.includes(path)) {
    const admitted = upstreamPath(url, config);
    return admitted ? {path: admitted, managed: false, maxBody: 2097152, upload: false} : null;
  }
  if (!path.startsWith("/table/")) return null;
  let admitted = false;
  if (method === "GET") {
    admitted = /^\/table\/(?:healthz|capabilities|widgets\.json|sources\/backends)$/.test(path) && !url.search;
    if (/^\/table\/exports\/[A-Za-z0-9_-]{1,128}\/batches$/.test(path)) {
      const pairs = [...url.searchParams];
      admitted = pairs.length === 1 && pairs[0][0] === "sequence" && /^(?:0|[1-9][0-9]{0,14})$/.test(pairs[0][1]);
    }
  } else if (method === "POST" && !url.search) {
    admitted = /^\/table\/(?:sources\/(?:uploads|backends)|sessions(?:\/[A-Za-z0-9_-]{1,128}\/(?:commands|derive|cancel|exports))?)$/.test(path);
  } else if (method === "DELETE" && !url.search) {
    admitted = /^\/table\/(?:sources|sessions|exports)\/[A-Za-z0-9_-]{1,128}$/.test(path);
  }
  const upload = path === "/table/sources/uploads";
  return admitted ? {path: path + url.search, managed: true, upload,
    maxBody: method === "POST" ? (upload ? 16777216 : 2097152) : 0} : null;
}

// Only validated managed cancellation and cleanup may use reserved admission.
// Matching the complete canonical path also excludes queries and trailing slashes.
export const TABLE_CONTROL_CONCURRENCY = 2;
export function tableControlRoute(route, method) {
  if (!route?.managed) return false;
  return (method === "POST" && /^\/table\/sessions\/[A-Za-z0-9_-]{1,128}\/cancel$/.test(route.path)) ||
    (method === "DELETE" && /^\/table\/(?:sessions|exports)\/[A-Za-z0-9_-]{1,128}$/.test(route.path));
}
