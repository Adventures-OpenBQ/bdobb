// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { readConfig } from "./config.mjs";
import { handleAuth, identity } from "./auth.mjs";
import { socketTarget, socketTicket, stateFile, upstreamPath } from "./policy.mjs";
import { bootstrap } from "./bootstrap.mjs";

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  ".pfb": "application/octet-stream", ".bcmap": "application/octet-stream",
};
// Branding only. Never broaden this to public/*, an extension rule, or a
// directory prefix: all dashboard content still requires authentication.
const PUBLIC_BRANDING = new Set([
  "/favicon.ico", "/favicon.svg", "/favicon-16.png", "/favicon-32.png", "/favicon-48.png",
  "/apple-touch-icon.png", "/safari-pinned-tab.svg", "/site.webmanifest",
  "/icon-192.png", "/icon-512.png", "/icon-maskable-192.png", "/icon-maskable-512.png",
]);
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; " +
  "worker-src 'self' blob:; frame-src https://www.youtube.com; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; " +
  // form-action governs a form's redirect chain too, not just its own action URL, and
  // Chromium/WebKit enforce that on the OAuth hop after /auth/signin/github's 302 --
  // Firefox does not enforce it there, which is how this silently broke in only two browsers.
  "form-action 'self' https://github.com";
const LOGIN = `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml" sizes="any">
<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180">
<link rel="mask-icon" href="/safari-pinned-tab.svg" color="#22c99b">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#12161d">
<title>BDOBB private preview</title><style>
body{margin:0;background:#12161d;color:#e8edf4;font:16px system-ui;display:grid;min-height:100vh;place-items:center}
main{max-width:440px;padding:40px}h1{font-size:30px}p{line-height:1.6;color:#aeb9c8}
a{display:inline-block;background:#82b5f5;color:#12161d;padding:12px 20px;border-radius:6px;text-decoration:none}
small{display:block;margin-top:28px;color:#aeb9c8}
</style><main><svg width="40" height="40" viewBox="0 0 32 32" role="img" aria-label="BDOBB" fill="#22c99b"><path d="M4 4h2v22h22v2H4z"/><path d="M10 16h3v6h-3zM16 10h3v12h-3zM22 4h3v18h-3z"/></svg>
<h1>Private preview</h1><p>Sign in with an approved GitHub account to open BDOBB.
Signing in does not automatically grant access.</p><a href="/auth/signin">Continue with GitHub</a>
<small>Preview dashboards are temporary and reset on reload.</small></main></html>`;

function reply(res, status, body = "", type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type }); res.end(body);
}
function reject(socket, code) {
  socket.end(`HTTP/1.1 ${code} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
function requestUrl(req, config) {
  // Ignore forwarded-host/proto completely; OAuth may only use the canonical host.
  if (req.headers.host !== new URL(config.origin).host) return null;
  if (!req.url?.startsWith("/") || req.url.startsWith("//") ||
      /[%\\]/.test(req.url.split("?")[0])) return null;
  const url = new URL(req.url, config.origin);
  if (url.origin !== config.origin || url.pathname !== req.url.split("?")[0]) return null;
  return url;
}
async function boundedBody(stream, max) {
  const parts = []; let size = 0;
  for await (const part of stream) {
    size += part.length;
    if (size > max) throw new Error("Body limit");
    parts.push(Buffer.from(part));
  }
  return Buffer.concat(parts);
}

/** Dependency injection is test-only code composition, never an environment auth bypass. */
export function createPreviewServer({ config: supplied, assets = resolve("dist/web"),
  fetchUpstream = fetch } = {}) {
  const config = () => supplied ?? readConfig();
  const budgets = new Map();
  function spend(id, cost = 1) {
    const now = Date.now();
    for (const [key, value] of budgets) if (value.until <= now) budgets.delete(key);
    // 240 a minute per user (2026-09-21; it was 60): what the gateway behind this allows in
    // all. Sixty was spent by five chip clicks on one chart, after which the chart's bars
    // were refused and it kept the old ones under the new chip.
    const budget = budgets.get(id) ?? { left: 240, until: now + 60000 };
    budgets.set(id, budget);
    if (budget.left < cost) return false;
    budget.left -= cost;
    return true;
  }
  /**
   * Per-user state (owner's ruling 2026-09-20: on the NAS, behind the gateway). The only
   * route here that takes a method other than GET -- so it asks for more than a
   * GET does: an Origin that is present AND ours, Sec-Fetch-Site same-origin when the
   * browser sends it, JSON, 256 KiB. The user in the upstream path is the session's GitHub
   * id and nothing the browser sent; the file is an allow-listed name (policy.mjs stateFile).
   */
  const gatewayHeaders = cfg => ({ Authorization: `Bearer ${cfg.token}`, Accept: "application/json" });
  /** What the two non-GET routes ask for beyond a session: our Origin, present; same-origin when the browser says. */
  const foreign = (req, cfg) => req.headers.origin !== cfg.origin ||
    (req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin");
  /** A bounded JSON request body, or the status that refuses it. Parsed only to prove it parses. */
  async function jsonBody(req, max) {
    if (!req.headers["content-type"]?.startsWith("application/json")) return 415;
    if (Number(req.headers["content-length"]) > max) { req.resume(); return 413; }
    let body;
    try { body = await boundedBody(req, max); } catch (e) { if (e.message !== "Body limit") throw e; return 413; }
    try { JSON.parse(body.toString("utf8")); } catch { return 400; }
    return body;
  }
  async function saveState(req, res, url, cfg, who) {
    const name = url.pathname.slice("/state/".length);
    if (url.search || !stateFile(name)) return reply(res, 404);
    if (req.method !== "PUT" && req.method !== "DELETE") return reply(res, 405);
    if (foreign(req, cfg)) return reply(res, 403);
    if (!cfg.backend || !/^\d{1,20}$/.test(who.id)) return reply(res, 503, "Backend ingress is not configured.");
    if (!spend(who.id)) return reply(res, 429, "Preview request budget exceeded.");
    let body;
    if (req.method === "PUT") {
      body = await jsonBody(req, 262144);
      if (typeof body === "number") return reply(res, body);
    }
    const response = await fetchUpstream(`${cfg.backend}/state/${who.id}/${name}`, {
      method: req.method, body, redirect: "error", signal: AbortSignal.timeout(12000),
      headers: { ...gatewayHeaders(cfg), ...(body ? { "Content-Type": "application/json" } : {}) },
    });
    await response.body?.cancel();
    // The user's own quota is theirs to hear about; nothing else the gateway says is.
    return reply(res, response.status === 204 ? 204 : response.status === 413 ? 413 : 502);
  }
  /** The files to seed the page with: {} when nothing is saved, null when the store cannot be trusted. */
  async function savedState(cfg, who) {
    if (!cfg.backend || !/^\d{1,20}$/.test(who.id)) return null;
    try {
      const response = await fetchUpstream(`${cfg.backend}/state/${who.id}`, {
        headers: gatewayHeaders(cfg), redirect: "error", signal: AbortSignal.timeout(8000) });
      if (!response.ok) { await response.body?.cancel(); return null; }
      const { files } = JSON.parse((await boundedBody(response.body, 3 * 1024 * 1024)).toString("utf8"));
      const entries = Object.entries(files);
      return entries.every(([name, text]) => stateFile(name) && typeof text === "string") ? Object.fromEntries(entries) : null;
    } catch { return null; }
  }
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Vercel-CDN-Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Keep same-origin form POST Origin usable; no-referrer can turn it into
    // "null" in Chromium. Cross-origin OAuth navigation still sends no Referer.
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Content-Security-Policy", CSP);
    res.setHeader("X-Frame-Options", "DENY");
    try {
      let cfg;
      try { cfg = config(); } catch (error) {
        // The message names the variable, never a value (config.mjs).
        console.error("Private preview is not configured:", error.message);
        return reply(res, 503, "Private preview is not configured.");
      }
      // The gateway origin is here for the sockets alone (socket tickets, below): a
      // socket relayed through a Vercel Function bills function time while it is open,
      // so the browser opens them on the gateway.
      res.setHeader("Content-Security-Policy", CSP.replace("connect-src 'self'",
        `connect-src 'self' ${cfg.origin.replace("https:", "wss:")}` +
        (cfg.backend ? ` ${cfg.backend.replace("https:", "wss:")}` : "")));
      const url = requestUrl(req, cfg);
      if (!url) return reply(res, 421, "Canonical preview host required.");
      // Sec-Fetch-Site reflects the WHOLE redirect chain, not just the final hop: the GitHub
      // OAuth callback 302s from github.com to "/", and the browser reports that landing GET
      // as cross-site even though it is same-origin and just set the session cookie. A plain
      // visitor link from another site (email, chat) looks identical. Refusing either one here
      // stranded every successful sign-in behind a 403.
      // A top-level document navigation is safe to exempt: the other site cannot read this
      // response, this server answers GET only, framing is already forbidden
      // (frame-ancestors 'none'), and the session cookie's own SameSite policy already governs
      // whether it rides along. Everything else this check exists to stop -- cross-site
      // fetch/XHR, subresource loads (img/script/iframe), form posts, websocket upgrades --
      // is not a navigation and stays refused. Sec-Fetch-User is deliberately NOT part of this
      // test: a post-OAuth redirect does not reliably carry it.
      const navigation = req.method === "GET" && req.headers["sec-fetch-mode"] === "navigate" &&
        req.headers["sec-fetch-dest"] === "document";
      if (req.headers["sec-fetch-site"] === "cross-site" && !navigation && !url.pathname.startsWith("/auth/")) {
        return reply(res, 403, "Cross-site request refused.");
      }
      if (url.pathname.startsWith("/auth/")) {
        if (!["GET", "POST"].includes(req.method)) return reply(res, 405);
        if (cfg.allowedIds.size === 0) return reply(res, 403, "Access has not been opened to any accounts.");
        if (req.method === "POST" && req.headers.origin !== cfg.origin) return reply(res, 403);
        const headers = new Headers();
        for (const key of ["cookie", "content-type"]) if (req.headers[key]) headers.set(key, req.headers[key]);
        const response = await handleAuth(new Request(url, {
          method: req.method, headers,
          body: req.method === "POST" ? await boundedBody(req, 16384) : undefined,
        }), cfg);
        // Auth.js renders its own static sign-in form. Its inline script is not needed.
        for (const key of ["content-type", "location"]) {
          if (response.headers.has(key)) res.setHeader(key, response.headers.get(key));
        }
        const cookies = response.headers.getSetCookie();
        if (cookies.length) res.setHeader("Set-Cookie", cookies);
        res.statusCode = response.status;
        return res.end(Buffer.from(await response.arrayBuffer()));
      }
      // Browser tabs and OS installation surfaces may fetch branding before
      // they have a session cookie. Only literal, non-sensitive asset names
      // are admitted, with GET and no query; cross-site checks still apply.
      if (PUBLIC_BRANDING.has(url.pathname) && req.method === "GET" && !url.search) {
        try { return reply(res, 200, await readFile(resolve(assets, "." + url.pathname)), MIME[extname(url.pathname)]); }
        catch { return reply(res, 404); }
      }
      const who = await identity(req.headers, cfg);
      if (!who) {
        if (url.pathname === "/" && req.method === "GET") return reply(res, 200, LOGIN, MIME[".html"]);
        return reply(res, 401, "Sign in with an approved GitHub account.");
      }
      if (url.pathname.startsWith("/state/")) return await saveState(req, res, url, cfg, who);
      // No /ai/v1/query at this line: Rita's route arrives with the gateway's
      // /ai family at od v6.0.2. A POST there falls through to the 405 below.
      if (req.method !== "GET") return reply(res, 405);
      if (req.headers.origin && req.headers.origin !== cfg.origin) return reply(res, 403);
      if (url.pathname === "/preview-bootstrap.js") return reply(res, 200, bootstrap(cfg, await savedState(cfg, who)), MIME[".js"]);
      // A ticket is what a signed-in browser shows the gateway instead of the machine
      // token it must never hold (policy.mjs socketTicket). It names one validated socket
      // target and lasts thirty seconds. At this line socketTarget always returns null --
      // no socket route exists yet (the first one arrives with news at od v8.0.3) -- so
      // this route always 404s. It stays wired exactly like this so the day a route does
      // exist, only policy.mjs's vendored copy has to change.
      if (url.pathname === "/socket-ticket") {
        const asked = url.searchParams.getAll("for");
        const target = asked.length === 1 && [...url.searchParams.keys()].length === 1
          ? socketTarget(asked[0], cfg.origin) : null;
        if (!target) return reply(res, 404);
        if (!cfg.backend) return reply(res, 503, "Backend ingress is not configured.");
        // One unit: a ticket is a signature, not a socket this layer holds open (which is
        // what six paid for, and still does for the relay below).
        if (!spend(who.id)) return reply(res, 429, "Preview request budget exceeded.");
        const ticket = socketTicket(cfg.token, target);
        return reply(res, 200, JSON.stringify({
          url: cfg.backend.replace("https:", "wss:") + target + (target.includes("?") ? "&" : "?") + "ticket=" + ticket,
        }), MIME[".json"]);
      }
      // /api/widgets.json and /api/apps.json were answered here while the /api
      // side was curated. They are openbb-api's own documents now and go
      // through upstreamPath like every other forwarded route -- which is how
      // the v8 and v9 example dashboards reach the web at all.
      const path = upstreamPath(url, cfg);
      if (path) {
        if (!cfg.backend) return reply(res, 503, "Backend ingress is not configured.");
        if (!spend(who.id)) return reply(res, 429, "Preview request budget exceeded.");
        const response = await fetchUpstream(cfg.backend + path, {
          headers: gatewayHeaders(cfg),
          redirect: "error", signal: AbortSignal.timeout(12000),
        });
        // Never relay backend authentication challenges, redirects, cookies, or error bodies.
        if (!response.ok) { await response.body?.cancel(); return reply(res, 502, "Backend request failed."); }
        if (!response.headers.get("content-type")?.includes("application/json")) {
          await response.body?.cancel(); return reply(res, 502, "Unexpected backend response.");
        }
        const body = await boundedBody(response.body, 2 * 1024 * 1024);
        return reply(res, 200, body, MIME[".json"]);
      }
      // No /preview-feeds.json at this line: the built-in RSS widget takes a
      // feed URL directly, and there is no server-side approved feed list to
      // publish (that arrives with the news family, od v8.0.3).
      // No SPA fallback for arbitrary paths. No source maps, dotfiles, or filesystem traversal.
      const name = url.pathname === "/" ? "/index.html" : url.pathname;
      if (url.search || (name !== "/index.html" && !/^\/(?:assets|standard_fonts)\/[A-Za-z0-9_./-]+$/.test(name)) ||
          name.split("/").some(s => s.startsWith(".")) || !MIME[extname(name)]) return reply(res, 404);
      const filename = resolve(assets, "." + name);
      if (!filename.startsWith(resolve(assets) + "/")) return reply(res, 404);
      try { return reply(res, 200, await readFile(filename), MIME[extname(name)]); }
      catch { return reply(res, 404); }
    } catch {
      // Internal errors are intentionally not serialized or logged with secrets.
      if (!res.headersSent) reply(res, 502, "Preview request failed.");
      else res.destroy();
    }
  });

  // /state reads a request body, so a request may no longer take as long as it likes to
  // arrive. The gateway's own figures. Responses (SSE, sockets) are not bounded by these.
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  server.on("upgrade", async (req, socket) => {
    socket.on("error", () => {});
    socket.setTimeout(15000, () => socket.destroy());
    // No socket route exists at this line -- socketTarget (policy.mjs) always
    // returns null, matching this rejection. The first family to arrive (news,
    // od v8.0.3) gives this handler a real body; until then every upgrade is
    // refused the same way a request naming an unmatched path would be.
    try {
      const cfg = config();
      const url = requestUrl(req, cfg);
      if (!url || req.method !== "GET" || req.headers.origin !== cfg.origin) return reject(socket, 403);
      const who = await identity(req.headers, cfg);
      if (!who) return reject(socket, 401);
      return reject(socket, 404);
    } catch { reject(socket, 503); }
  });
  return server;
}
