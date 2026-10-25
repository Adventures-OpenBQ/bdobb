#!/usr/bin/env node
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Boots the app for a real browser with no Tauri runtime: the canned mock
 * backend on a fixed port, then `vite --mode browser` (which aliases the Tauri
 * modules to src/browser-shim/). Playwright uses this as its webServer; it is
 * also fine to run by hand and open http://localhost:4173.
 *
 * Deliberately independent of scripts/smoke.mjs: smoke tests the UN-shimmed
 * module graph and must stay that way.
 *
 * Requires Node >= 23.6 (type stripping) to import mockServer.ts directly.
 */
import { spawn } from "node:child_process";
import { MOCK_PORT, MOCK_URL, routes } from "./browser-fixtures.mjs";
import { startMockServer } from "../src/test/mockServer.ts";

const VITE_PORT = Number(process.env.BDOBB_BROWSER_PORT ?? 4173);

const mock = await startMockServer(routes, MOCK_PORT);

const vite = spawn(
  "pnpm",
  ["exec", "vite", "--mode", "browser", "--port", String(VITE_PORT), "--strictPort"],
  // On Windows pnpm is pnpm.cmd, which Node spawns only through a shell.
  { stdio: ["ignore", "inherit", "inherit"], shell: process.platform === "win32" },
);

let shuttingDown = false;
async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  vite.kill();
  await mock.close();
  process.exit(code);
}
process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));
vite.on("exit", (code) => void shutdown(code ?? 1));

// Playwright does its own readiness polling (webServer.url in
// playwright.config.ts), so this wait gates nothing but the line below it:
// run by hand, that line is how you know the app is actually up.
const url = `http://localhost:${VITE_PORT}/`;
console.log(`browser: starting ${url} (mock ${MOCK_URL})`);
const answers = () => fetch(url).then(() => true, () => false);
while (!(await answers())) await new Promise((r) => setTimeout(r, 100));
console.log(`browser: listening on ${url}`);
