// vendored from openbq-docker 45d26cb8bee9cba565668e4546c5b2c6495c6503 funnel-gateway/charts-policy.mjs sha256:a73e791e59a2b60dd5b3c6698d09759b7bbafa3a0f2ac0da03010de68f12ed65
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

/**
 * The /charts family on the door (openbq-docker v12 part 1): Art's Charts, the opt-in
 * `charts-v12` profile, on with settings.json's "charts": true. Additive like
 * temporal-policy.mjs: policy.mjs, the contract BDOBB's web layer vendors, is unchanged. The
 * web preview vendors THIS file the same way (part 2, B14).
 *
 * Door paths ARE arts-charts' own paths, at the door's root, forwarded verbatim: no prefix to
 * strip. Every route needs the gateway token, and the gateway presents the stack's Basic pair
 * on the bridge -- except TOKEN_ROUTES: an ntfy push's click link, its picture and its
 * buttons, which carry their own signed token (arts-charts auth.link_ok and /watches/action)
 * and are forwarded with NO credential, so a forged token can never ride the pair.
 * The query that leaves is re-serialised from the pairs that passed, never the caller's text.
 */
const ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const exact = source => new RegExp(`^${source}$`);
const INSTANT = /^[0-9T:.Z+-]{1,40}$/;
const VALUES = {
  symbol: /^[A-Za-z0-9.^_-]{1,24}(?:=[FX])?$/, interval: /^[1-9][0-9]{0,2}[smhdwM]$/,
  start: INSTANT, end: INSTANT, anchor: INSTANT,
  provider: /^(?:yfinance|eodhd|temporaldb)$/, session: /^(?:extended|regular|24hr)$/,
  source: /^(?:local|eodhd)$/, macro: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,
  indicators: /^[A-Za-z0-9:=.,+_-]{0,240}$/, basis: /^(?:adjusted|raw)$/,
  warmup: /^(?:auto|none)$/, fresh: /^(?:true|false)$/,
  width: /^[1-9][0-9]{2,3}$/, height: /^[1-9][0-9]{2,3}$/, theme: /^(?:light|dark)$/,
  limit: /^(?:[1-9]|[1-9][0-9]|1[0-9]{2}|200)$/, before: /^[A-Za-z0-9_-]{1,512}$/,
  chart_id: exact(ID), t: /^[A-Za-z0-9_-]{1,2048}\.[A-Za-z0-9_-]{16,128}$/,
};
const SERIES = ["symbol", "interval", "start", "end", "provider", "session"];
// What /ta_series_ws reads (arts_charts router.ta_series_ws); /ta_snapshot adds `fresh`.
const STUDY = [...SERIES, "source", "macro", "indicators", "anchor", "basis", "warmup"];
// [methods, path, query keys, kind]
const ROUTES = [
  ["GET|POST", /^\/charts$/, [], "json"],
  ["GET", /^\/charts\/events$/, [], "sse"],
  // BDOBB's companion widgets (v12 part 5, trimmed by the 2026-11-04 engine split): read-only GETs, no query. The bars widget is live-grid's.
  ["GET", /^\/charts\/widgets\.json$/, [], "json"],
  ["GET", /^\/charts\/widgets\/documents$/, [], "json"],
  ["GET", /^\/charts\/widgets\/alerts$/, [], "json"],
  ["POST", /^\/charts\/mcp$/, [], "mcp"],
  ["GET|PUT|DELETE", exact(`/charts/${ID}`), [], "json"],
  ["GET", exact(`/charts/${ID}/history`), [], "json"],
  ["POST", exact(`/charts/${ID}/restore/[1-9][0-9]{0,8}`), [], "json"],
  ["GET", exact(`/charts/${ID}/snapshot\\.png`), ["width", "height", "theme"], "png"],
  ["GET", exact(`/charts/${ID}/snapshots/${ID}\\.png`), [], "png"],
  ["GET", /^\/series$/, SERIES, "json"],
  ["GET", /^\/ta_registry$/, [], "json"],
  ["GET", /^\/ta_macros$/, [], "json"],
  ["GET", /^\/ta_snapshot$/, [...STUDY, "fresh"], "json"],
  ["GET", /^\/inbox$/, ["limit", "before"], "json"],
  ["GET|DELETE", exact(`/inbox/${ID}`), [], "json"],
  ["GET", exact(`/inbox/${ID}/snapshots/[0-9]{1,6}\\.png`), [], "png"],
  ["POST", exact(`/inbox/${ID}/read`), [], "json"],
  ["GET", /^\/watches$/, ["chart_id"], "json"],
  ["GET", /^\/schedules$/, [], "json"],
];
const TOKEN_ROUTES = [
  ["GET", exact(`/inbox/${ID}`), ["t"], "json"],
  ["GET", exact(`/inbox/${ID}/snapshots/[0-9]{1,6}\\.png`), ["t"], "png"],
  ["POST", /^\/watches\/action$/, [], "json"],
];
// POSTs that take no body: restore and mark-read.
const NO_BODY = /\/(?:restore\/[0-9]+|read)$/;

function match(rules, url, method) {
  if (url.hash || url.pathname.length + url.search.length > 4096) return null;
  const rule = rules.find(([methods, path]) => methods.split("|").includes(method) && path.test(url.pathname));
  if (!rule) return null;
  const pairs = [...url.searchParams];
  if (new Set(pairs.map(([key]) => key)).size !== pairs.length) return null;
  for (const [key, value] of pairs) if (!rule[2].includes(key) || !VALUES[key].test(value)) return null;
  return { method, kind: rule[3], body: method === "PUT" || (method === "POST" && !NO_BODY.test(url.pathname)),
           path: url.pathname + (pairs.length ? "?" + url.searchParams.toString() : "") };
}

export const chartsRoute = (url, method) => match(ROUTES, url, method);

/** A link or button request: its own token is its whole credential, so the GETs need `t`. */
export function chartsTokenRoute(url, method) {
  const route = match(TOKEN_ROUTES, url, method);
  return route && (method === "POST" || url.searchParams.has("t")) ? route : null;
}

/**
 * The study socket a ticket (web preview or /charts/ws_ticket) or the machine path may open:
 * /ta_series_ws, push-only, its query the whole subscription. Same contract as policy.mjs'
 * socketTarget: the canonical target, or null. The query takes /ta_snapshot's grammar minus
 * `fresh`, because the socket reads exactly those keys.
 */
export function chartsSocketTarget(raw, origin) {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) return null;
  let url; try { url = new URL(raw, origin); } catch { return null; }
  if (url.origin !== origin || url.hash || url.pathname !== "/ta_series_ws") return null;
  return match([["GET", /^\/ta_series_ws$/, STUDY, "socket"]], url, "GET")?.path ?? null;
}

/** Only known semantic statuses survive the relay. */
export function chartsStatus(status) {
  return [200, 201, 202, 204, 400, 401, 404, 409, 413, 415, 422, 428, 429, 503].includes(status) ? status : 502;
}

/**
 * The /ntfy family (v12): the phone app's subscribe endpoints for the ONE topic, JSON stream
 * and websocket. ntfy's own deny-all account protects it; the door injects nothing and
 * forwards the caller's single Authorization header. Publishing stays on the bridge (the
 * worker); no publish, account or web-app path is ever matched.
 */
const SINCE = /^(?:all|latest|none|[0-9]{1,12}[smhd]?|[A-Za-z0-9]{12})$/;
export function ntfyRoute(url, method, topic) {
  if (!topic || method !== "GET" || url.hash) return null;
  const found = /^\/ntfy\/([A-Za-z0-9_-]{1,64})\/(json|ws)$/.exec(url.pathname);
  if (!found || found[1] !== topic) return null;
  const pairs = [...url.searchParams];
  if (new Set(pairs.map(([key]) => key)).size !== pairs.length) return null;
  for (const [key, value] of pairs) {
    if (!(key === "since" && SINCE.test(value)) && !(key === "poll" && value === "1")) return null;
  }
  return { kind: found[2], path: `/${topic}/${found[2]}` + (pairs.length ? "?" + url.searchParams.toString() : "") };
}
