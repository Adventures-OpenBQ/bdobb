// vendored from openbb-docker v3.0.1 funnel-gateway/policy.mjs sha256:639fce5a9663a831b10876823a05a21b15eea5e45de43d1fc9be5f2e916f52f2
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The route contract of the stack's public door (the funnel-gateway service,
 * openbb-docker v2.1.0). This file is CANONICAL: bdobb-v2's web layer vendors
 * a pinned copy (web/policy.mjs, `pnpm gateway:vendor <tag>`) and tests its
 * hash, so the app and the stack can never disagree about what is admitted.
 *
 * Not a generic reverse proxy. If a path is not matched below, it is refused.
 * At this tag the stack serves one upstream behind the door:
 *   /api/...   -> openbb-api   (the whole OpenBB widget catalogue)
 * Later episodes add their families with their tags (news at Ep. 8, live-grid
 * at Ep. 10, Rita at Ep. 6); at each tag this file holds exactly the families
 * that tag's stack serves. MCP, key-maint, provider-key paths and openbb-api's
 * own /docs, /openapi.json and /redoc are never routes this door forwards.
 */

/**
 * The openbb-api side, since the owner's 2026-09-20 decision to "make all
 * widgets available in vercel". openbb-api's real /widgets.json IS the whole
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
 * OUTSIDE /api/api/v1/: openbb-api's /docs, /openapi.json and /redoc are not
 * routes the client fetches, so they are not routes this door forwards.
 */
const OPENBB_ROUTE_RE = /^\/api\/api\/v1\/[a-z0-9_/-]{1,200}$/;
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

/** The /api family takes bounds; a later family takes a reviewed route with its own tests. */
export function upstreamPath(url) {
  const params = url.searchParams;
  if (new Set(params.keys()).size !== [...params.keys()].length) return null;

  // The two root documents the client fetches from a backend -- dataClient.ts'
  // fetchWidgetsJson (required; a 404 is what marks a backend offline) and
  // fetchAppsJson (optional). There is no third: openbb-api answers 404 for
  // templates.json, and agents.json is a Rita host's document, not a backend's.
  // Exact path, no query.
  if (url.pathname === "/api/widgets.json" || url.pathname === "/api/apps.json") {
    if (url.search) return null;
    return url.pathname;
  }

  // Every widget's own data call, and every parameter dropdown's
  // optionsEndpoint, under the bounds documented at the top of this file.
  if (url.pathname.startsWith("/api/api/v1/")) {
    if (!OPENBB_ROUTE_RE.test(url.pathname)) return null;
    const pairs = [...params];
    if (pairs.length > MAX_QUERY_PAIRS) return null;
    for (const [name, value] of pairs) {
      if (!PARAM_NAME_RE.test(name) || value.length > MAX_VALUE_CHARS ||
          hasControlChar(value)) return null;
    }
    const forwarded = url.pathname + (pairs.length ? "?" + params.toString() : "");
    return forwarded.length <= MAX_URL_CHARS ? forwarded : null;
  }

  return null;
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
 * At v2.1.0 the verifier ships and no socket route does: the first socket family
 * arrives with the news feed (Ep. 8). The verifier is here so the contract the web
 * layer signs against is the stack's from the first tag that has a door.
 */
const TICKET_MS = 30_000;
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
  if (now > expiry || expiry - now > TICKET_MS) return null;
  const given = Buffer.from(match[3], "base64url");
  const wanted = ticketSignature(token, expiry, match[2], target);
  return given.length === wanted.length && timingSafeEqual(given, wanted) ? match[2] : null;
}
export const socketTicketValid = (...args) => socketTicketNonce(...args) !== null;

/**
 * The socket a ticket may name, under exactly the rules the upgrade handler applies.
 * Returns the canonical target, or null. No upgrade route exists at this tag, so
 * every target is null; Ep. 8 adds /news/ws/news, Ep. 10 /grid/live_grid_ws.
 */
export function socketTarget(raw, origin) {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) return null;
  let url; try { url = new URL(raw, origin); } catch { return null; }
  if (url.origin !== origin || url.hash) return null;
  return null;
}

/**
 * The files the web preview may keep per GitHub user (gateway /state, web /state):
 * the app's own JSON stores by their exact names, and one flat dashboards/ level.
 * Not files/ (uploads), logs/, skills/, nor the .tmp and .corrupt siblings the
 * app's atomic writer and quarantine leave beside them.
 */
const STATE_FILE_RE = /^(?:(?:settings|backends|folders|chat|chart-presets)\.json|dashboards\/[A-Za-z0-9_-]{1,80}\.json)$/;
export const stateFile = name => typeof name === "string" && STATE_FILE_RE.test(name);
