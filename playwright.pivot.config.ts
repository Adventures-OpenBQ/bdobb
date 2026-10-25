// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
 testDir:'e2e',testMatch:['rust-pivot.spec.ts','rust-pivot-resources.spec.ts'],outputDir:'e2e-results/pivot',workers:1,retries:0,
 timeout:120_000,reporter:'list',
 use:{ignoreHTTPSErrors:true,trace:'retain-on-failure'},
 projects:[{name:'pivot-chromium',use:{...devices['Desktop Chrome']}},{name:'pivot-webkit',use:{...devices['Desktop Safari']}}],
 webServer:{command:'node scripts/pivot-browser-server.mjs',url:'https://localhost:4177/',ignoreHTTPSErrors:true,reuseExistingServer:false,timeout:120_000},
});
