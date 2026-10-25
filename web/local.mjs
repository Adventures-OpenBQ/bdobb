// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { createPreviewServer } from "./server.mjs";

// For tests/local TLS reverse proxies only. No 0.0.0.0 bind or automatic public exposure.
createPreviewServer().listen(Number(process.env.PORT ?? 3100), "127.0.0.1", () => {
  console.log("Preview server listening on loopback; canonical HTTPS host and secure cookies required.");
});
