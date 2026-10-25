#!/usr/bin/env node
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Does the app actually render?
 *
 * Every other gate in this project runs under Node or jsdom, where `global`
 * exists — so a dependency that references a Node global at module scope
 * passes 2,000 unit tests and then dies on the first line in a real browser,
 * leaving a blank window. That happened: has-hover, a transitive dep of
 * plotly.js, evaluates `typeof global.matchMedia` at import time.
 *
 * This loads the built app in headless Chromium and asserts React mounted.
 * It is deliberately shallow — it does not click anything — because the bug
 * class it exists for kills the page before any interaction is possible.
 *
 * The DEV server, not `vite preview`, and deliberately WITHOUT
 * `--mode browser`: smoke is the one gate that exercises the real, un-shimmed
 * Tauri module graph. e2e (scripts/browser.mjs) is the shimmed counterpart.
 */
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

const PORT = 4173;
const URL = `http://localhost:${PORT}/`;

const vite = spawn("pnpm", ["exec", "vite", "--port", String(PORT), "--strictPort"], {
  stdio: ["ignore", "ignore", "inherit"],
});

const errors = [];
let mounted = 0;
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));

  // Playwright has no webServer here (that is playwright.config.ts's job for
  // e2e), so the retry IS the readiness wait: goto fails until vite listens.
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      await page.goto(URL, { waitUntil: "load" });
      break;
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  // React mounting is what this asserts; #root exists in index.html either way.
  await page.waitForSelector("#root > *", { timeout: 30_000 }).catch(() => {});
  mounted = (await page.locator("#root").innerHTML()).trim().length;
} finally {
  await browser.close();
  vite.kill();
}

if (errors.length > 0) {
  console.error("smoke: console errors:");
  for (const e of errors) console.error("  " + e);
}
if (mounted === 0) {
  console.error("smoke: FAILED — #root is empty, React did not mount");
  process.exit(1);
}
if (errors.length > 0) {
  console.error(`smoke: FAILED — ${errors.length} uncaught console error(s)`);
  process.exit(1);
}

console.log(`smoke: clean — React mounted (${mounted} bytes under #root), no console errors`);
