// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { defineConfig, devices } from "@playwright/test";

/**
 * Drives the app in real Chromium with no Tauri runtime. The webServer is
 * scripts/browser.mjs (mock backend on :4174, vite --mode browser on :4173).
 * Opt-in gate, same status as `pnpm smoke`: not part of `pnpm test:run`.
 */
export default defineConfig({
  testDir: "e2e",
  outputDir: "e2e-results",
  workers: 1,
  // A net for a lost race, not a substitute for fixing the race: only CI
  // retries, and only once. A test that fails twice in a row is still red.
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${process.env.BDOBB_BROWSER_PORT ?? 4173}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // devices["Desktop Chrome"] fixes the viewport at 1280x720; a top-level
  // use.viewport would be overridden by this spread.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node scripts/browser.mjs",
    reuseExistingServer: true,
    url: `http://localhost:${process.env.BDOBB_BROWSER_PORT ?? 4173}`,
    timeout: 60_000,
  },
});
