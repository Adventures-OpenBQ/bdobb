// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {defineConfig,devices} from '@playwright/test';
const port=Number(process.env.BDOBB_BROWSER_PORT??4283);
export default defineConfig({testDir:'e2e',testMatch:['sec-linked-qualification.spec.ts','sec-linked-persistence.spec.ts'],workers:1,retries:0,outputDir:'e2e-results/qualification',reporter:[['list'],['json',{outputFile:'e2e-results/qualification/report.json'}]],use:{baseURL:`http://localhost:${port}`,trace:'retain-on-failure',screenshot:'only-on-failure'},projects:[{name:'chromium',use:{...devices['Desktop Chrome']}},{name:'webkit',use:{...devices['Desktop Safari']}}],webServer:{command:'node scripts/browser.mjs',env:{BDOBB_BROWSER_PORT:String(port),BDOBB_MOCK_PORT:process.env.BDOBB_MOCK_PORT??'4284'},url:`http://localhost:${port}`,reuseExistingServer:false,timeout:120000}});
