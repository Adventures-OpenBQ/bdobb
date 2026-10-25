// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {defineConfig,devices} from '@playwright/test';
export default defineConfig({testDir:'e2e',testMatch:['ssrm-widget.spec.ts','ssrm-resources.spec.ts'],outputDir:'e2e-results/ssrm-native',workers:1,timeout:120_000,retries:0,reporter:'list',use:{ignoreHTTPSErrors:true,trace:'retain-on-failure'},projects:[{name:'chromium',use:{...devices['Desktop Chrome']}},{name:'webkit',use:{...devices['Desktop Safari']}}]});
