// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { fileURLToPath } from "node:url";
import { createPreviewServer } from "./server.mjs";

// The build places the browser bundle INSIDE this function, never in public CDN output.
export default createPreviewServer({ assets: fileURLToPath(new URL("./ui", import.meta.url)) });
