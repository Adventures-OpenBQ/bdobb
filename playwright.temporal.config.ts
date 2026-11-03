// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'e2e',testMatch:'v11-temporal-*.spec.ts',workers:1,retries:0,timeout:180000,reporter:'list',use:{ignoreHTTPSErrors:true},outputDir:'e2e-results/temporal-gateway'});
