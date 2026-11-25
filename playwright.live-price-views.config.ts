// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { defineConfig, devices } from '@playwright/test';
import browser from './playwright.config';

export default defineConfig({
  ...browser,
  testMatch: ['live-price-views.spec.ts', 'installed-price-views.spec.ts'],
  outputDir: 'e2e-results/live-price-views',
  workers: 1,
  retries: 0,
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: { ...browser.webServer, reuseExistingServer: false },
});
