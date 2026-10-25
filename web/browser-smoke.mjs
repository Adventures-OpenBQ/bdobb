// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Real HTTPS/browser auth smoke test. Synthetic identities and quote data only.
 * Requires the web build, Playwright Chromium and openssl; never calls GitHub.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { createServer } from "node:https";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { encode } from "@auth/core/jwt";
import { createPreviewServer } from "./server.mjs";
import { readConfig, SESSION_COOKIE } from "./config.mjs";

const dir = await mkdtemp(join(tmpdir(), "bdobb-browser-"));
let server, browser;
try {
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"), "-days", "1",
    "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"], { stdio: "ignore" });
  server = createServer({ key: await readFile(join(dir, "key.pem")), cert: await readFile(join(dir, "cert.pem")) });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const origin = `https://localhost:${server.address().port}`;
  const config = readConfig({
    APP_ORIGIN: origin, AUTH_SECRET: randomBytes(32).toString("hex"),
    AUTH_GITHUB_ID: "synthetic-client", AUTH_GITHUB_SECRET: "synthetic-secret",
    SESSION_EPOCH: "browser-test", GITHUB_ALLOWED_USER_IDS: "42",
    BACKEND_GATEWAY_ORIGIN: "https://gateway.example.com",
    BACKEND_GATEWAY_TOKEN: randomBytes(32).toString("base64url"),
  });
  // The gateway's per-user state store, in memory: what the page saves, and is seeded from.
  const saved = new Map();
  const app = createPreviewServer({ config, fetchUpstream: async (url, init = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith("/state/")) {
      const name = parsed.pathname.split("/").slice(3).join("/");
      if (!name) return json({ files: Object.fromEntries(saved) });
      if (init.method === "PUT") saved.set(name, init.body.toString()); else saved.delete(name);
      return new Response(null, { status: 204 });
    }
    return new Response("unrouted", { status: 404 });
  } });
  function json(body) {
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  }
  server.on("request", (req, res) => app.emit("request", req, res));
  server.on("upgrade", (req, socket, head) => app.emit("upgrade", req, socket, head));
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
  // A mistaken external request must never reach GitHub or a live provider.
  const external = [];
  await context.route("**/*", route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage();
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto(origin);
  assert.equal((await context.request.get(origin + "/api/widgets.json")).status(), 401);
  await page.getByRole("link", { name: "Continue with GitHub" }).click();
  await page.getByRole("button", { name: /Sign in with GitHub/ }).waitFor();
  const value = await encode({
    token: { githubId: "42", epoch: config.epoch, deadline: Date.now() / 1000 + 3600 },
    secret: config.secret, salt: SESSION_COOKIE, maxAge: 3600,
  });
  await context.addCookies([{ name: SESSION_COOKIE, value, domain: "localhost", path: "/",
    secure: true, httpOnly: true, sameSite: "Lax" }]);
  await page.goto(origin);
  // The seed at this line is the built-ins dashboard (web/bootstrap.mjs): no /api
  // card, so the edit-save-reseed round trip runs on the Grouping tab's Parameter
  // echo card (found by its Ticker field: the Note above it names the card in its
  // text), whose Ticker starts at the group's AAPL.
  const grouping = page.getByRole("tab", { name: "Grouping" });
  const echoCard = page.locator(".widget-card")
    .filter({ has: page.getByRole("textbox", { name: "Ticker" }) }).first();
  const echoed = text => echoCard.getByRole("definition").filter({ hasText: new RegExp(`^${text}$`) }).waitFor();
  await grouping.click();
  await echoed("AAPL");
  // The notice bar takes 28px off the top of the page, and the app shell is sized
  // from the VIEWPORT (100dvh), not from #root -- so unless the web build gives
  // those 28px back, the shell runs past the bottom and carries the rail's last
  // bottom-pinned row, Help, below the fold. Found 2026-09-20 ("no help on the app").
  const helpBox = await page.getByRole("button", { name: "Help", exact: true }).boundingBox();
  assert.ok(helpBox && helpBox.y + helpBox.height <= page.viewportSize().height,
    `Help is below the fold: ${JSON.stringify(helpBox)} in ${JSON.stringify(page.viewportSize())}`);
  await echoCard.getByRole("textbox", { name: "Ticker" }).fill("MSFT");
  await echoCard.getByRole("textbox", { name: "Ticker" }).press("Enter");
  await echoed("MSFT");
  // "vercel is not saving the configuration" (2026-09-20): the change is mirrored to the
  // signed-in user's state -- the whole store on this first save, the seeded dashboard included.
  for (let i = 0; i < 50 && !saved.get("dashboards/preview.json")?.includes("MSFT"); i++) await new Promise(r => setTimeout(r, 100));
  assert.ok(saved.get("dashboards/preview.json")?.includes("MSFT"), JSON.stringify([...saved.keys()]));
  assert.ok(saved.has("backends.json"), JSON.stringify([...saved.keys()]));
  // A session that lapses while the app is open (it is a hard one-hour deadline): the next
  // request to this origin answers 401, and the app goes to the sign-in page rather than
  // reporting every backend offline, which is what it did until 2026-09-20.
  const session = await context.cookies();
  await context.clearCookies();
  await echoCard.getByRole("textbox", { name: "Ticker" }).fill("NVDA");
  await echoCard.getByRole("textbox", { name: "Ticker" }).press("Enter");
  await page.waitForURL(/\/auth\/signin/);
  await context.addCookies(session);
  await page.goto(origin);
  await grouping.click();
  await echoed("MSFT");
  assert.ok(!saved.get("dashboards/preview.json").includes("NVDA"));
  await page.getByRole("link", { name: "Sign out", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("link", { name: "Continue with GitHub" }).waitFor();
  assert.equal((await context.cookies()).filter(c => c.name === SESSION_COOKIE).length, 0);
  assert.equal((await context.request.get(origin + "/api/widgets.json")).status(), 401);
  await page.setViewportSize({ width: 375, height: 812 });
  // Runs in the page's browser context, not this Node process: window is a
  // page global there, not a lint violation.
  /* eslint-disable no-undef */
  assert.equal(await page.evaluate(
    () => window.document.documentElement.scrollWidth > window.innerWidth), false);
  /* eslint-enable no-undef */
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log("PASS: HTTPS login form, private assets, seeded built-ins dashboard, per-user state saved + reseeded on reload, lapsed session goes to sign-in, CSRF logout, mobile login; no external requests.");
} finally {
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await rm(dir, { recursive: true, force: true });
}
