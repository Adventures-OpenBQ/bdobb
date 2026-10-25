// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e", testMatch: "ipad-editing.spec.ts", outputDir: "e2e-results/ipad-editing", workers: 1, retries: 0, reporter: "list",
  use: { browserName: "webkit", viewport: { width: 1210, height: 834 }, hasTouch: true, isMobile: true, baseURL: `http://localhost:${process.env.BDOBB_BROWSER_PORT ?? 19473}`, trace: "retain-on-failure" },
  webServer: { command: "node scripts/browser.mjs", url: `http://localhost:${process.env.BDOBB_BROWSER_PORT ?? 19473}`, reuseExistingServer: false, timeout: 60000 },
});
