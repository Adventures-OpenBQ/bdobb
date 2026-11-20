// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {defineConfig,devices} from "@playwright/test";
import base from "./playwright.config";
/** Opt-in WebKit control for behavior also exercised in the macOS wrapper. */
export default defineConfig({...base,reporter:[["list"]],outputDir:process.env.OPENBQ_WEBKIT_OUTPUT??"e2e-results-webkit",projects:[{name:"webkit",use:{...devices["Desktop Safari"]}}]});
