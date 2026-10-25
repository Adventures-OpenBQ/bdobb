// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The app document must never be framable: a cross-origin widget frame given
 * `allow-same-origin` could otherwise navigate itself onto the app's own http
 * origin (dev, browser mode, Tauri on Windows) and reach the parent. The Vite
 * server's copy is asserted end to end, against the header it really sends,
 * by e2e/iframe.spec.ts. The packaged app gets its copy from tauri.conf.json,
 * which no other gate reads — so this pins that one.
 */
describe("frame-ancestors CSP", () => {
  const expected = "frame-ancestors 'none'";

  it("is set for the packaged app", () => {
    const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")) as {
      app?: { security?: { csp?: unknown } };
    };
    expect(conf.app?.security?.csp).toBe(expected);
  });
});
